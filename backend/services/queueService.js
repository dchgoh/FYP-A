// services/queueService.js
const Queue = require('bull');
const Redis = require('ioredis');
const { pool } = require('../config/db');
const lasProcessingService = require('./lasProcessingService');
const enhancedSegmentationService = require('./segmentationService');
const { setProgress, clearProgress } = require('./progressStore');
const fs = require('fs');
const path = require('path');
const { encryptFileTo, decryptFileTo } = require('../utils/fileCrypto');
const { execSync } = require('child_process');

// Try to locate a laszip executable bundled with the repo (backend/tools/LAStools)
// or fall back to system 'laszip' if available on PATH.
function getLaszipExecutable() {
    try {
        const repoRoot = path.resolve(__dirname, '..', '..'); // project root containing backend/
        const candidates = [
            path.join(repoRoot, 'backend', 'tools', 'LAStools','LAStools', 'bin', process.platform === 'win32' ? 'laszip.exe' : 'laszip'),
            path.join(repoRoot, 'backend', 'tools', 'LAStools','LAStools', process.platform === 'win32' ? 'laszip.exe' : 'laszip'),
        ];

        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }

        // As a last resort, check if 'laszip' is available on PATH by trying to run it with '--help'
        try {
            execSync('laszip --help', { stdio: 'ignore' });
            return 'laszip';
        } catch (_) {
            return null;
        }
    } catch (err) {
        return null;
    }
}

// Redis configuration
const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
};

// Create Redis connection
const redis = new Redis(redisConfig);

// Create processing queue
const processingQueue = new Queue('file processing', {
    redis: redisConfig,
    defaultJobOptions: {
        removeOnComplete: 10, // Keep last 10 completed jobs
        removeOnFail: 50,     // Keep last 50 failed jobs
        attempts: 3,          // Retry failed jobs 3 times
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
    },
});

// Resource management
const RESOURCE_LIMITS = {
    MAX_CONCURRENT_JOBS: parseInt(process.env.MAX_CONCURRENT_JOBS) || 5,
    MAX_GPU_MEMORY_MB: parseInt(process.env.MAX_GPU_MEMORY_MB) || 8000,
    MAX_SYSTEM_MEMORY_MB: parseInt(process.env.MAX_SYSTEM_MEMORY_MB) || 16000,
};

// Track active jobs and resource usage
let activeJobs = new Map();
let resourceUsage = {
    gpuMemory: 0,
    systemMemory: 0,
    activeProcesses: 0,
};

// Helper function to check if job should continue
async function shouldJobContinue(job, fileId) {
    // Check if job was removed/cancelled
    try {
        const currentJob = await processingQueue.getJob(job.id);
        if (!currentJob) {
            console.log(`[Queue] Job ${job.id} was removed, stopping processing for file ${fileId}`);
            return false;
        }
    } catch (err) {
        console.log(`[Queue] Job ${job.id} no longer exists, stopping processing for file ${fileId}`);
        return false;
    }
    
    // Check database status to see if file was stopped
    try {
        const statusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
        if (statusCheck.rows.length > 0 && statusCheck.rows[0].status === 'stopped') {
            console.log(`[Queue] File ${fileId} status is 'stopped', cancelling job ${job.id}`);
            return false;
        }
    } catch (dbErr) {
        console.warn(`[Queue] Error checking file status for ${fileId}:`, dbErr.message);
    }
    
    return true;
}

// Job processor
processingQueue.process('process-file', RESOURCE_LIMITS.MAX_CONCURRENT_JOBS, async (job) => {
    const { fileId, filePath, projectRootDir, skipSegmentation } = job.data;
    console.log(`[Queue] Starting job ${job.id} for file ${fileId}`);

    // --- NEW: Variables for LAZ decompression ---
    let processingFilePath = filePath; // This will hold the path to the file we actually process (.las)
    let decompressedFilePath = null;   // To track the temporary .las file for cleanup
    let originalUploadedFileIsLaz = false; // Flag to know if we should clean up the original .laz

    try {
        // Check if job should continue before starting
        if (!(await shouldJobContinue(job, fileId))) {
            console.log(`[Queue] Job ${job.id} cancelled before starting for file ${fileId}`);
            return { success: false, fileId, cancelled: true };
        }
        
        // --- NEW: LAZ Decompression Logic ---
        // 1. Get the original filename from the database to check its extension.
        const fileResult = await pool.query("SELECT original_name FROM uploaded_files WHERE id = $1", [fileId]);
        if (fileResult.rows.length === 0) {
            throw new Error(`File with ID ${fileId} not found in database.`);
        }
        const originalName = fileResult.rows[0].original_name;

        // 2. Check if the original file was a .laz file.
        if (originalName.toLowerCase().endsWith('.laz')) {
            console.log(`[Queue] Job ${job.id}: Detected LAZ file for file ${fileId}. Decompressing...`);
            await updateJobStatus(fileId, 'decompressing', 'Decompressing LAZ file...');
            originalUploadedFileIsLaz = true;

            // 3. Define the path for the temporary, decompressed .las file.
            // Example: /path/to/uploads/abc.tmp -> /path/to/uploads/abc.tmp.las
            decompressedFilePath = `${filePath}.las`;

            // 4. Execute the laszip command.
            // Find laszip either bundled with the repository or on the system PATH
            const laszipExec = getLaszipExecutable();
            if (!laszipExec) {
                const hint = `Cannot find 'laszip' executable. Install LAStools (https://rapidlasso.com/lastools/) or run the project launcher that downloads LAStools into backend/tools/LAStools. On Windows the binary should be named 'laszip.exe'.`;
                console.error(`[Queue] Job ${job.id}: ${hint}`);
                throw new Error(`LAZ decompression failed: 'laszip' not found. ${hint}`);
            }

            // Wrap path in quotes to handle spaces
            const laszipCmd = laszipExec.includes(' ') ? `"${laszipExec}"` : laszipExec;
            const command = `${laszipCmd} -i "${filePath}" -o "${decompressedFilePath}"`;
            try {
                execSync(command, { stdio: 'inherit' }); // stdio: 'inherit' shows command output in logs
                console.log(`[Queue] Job ${job.id}: Decompressed LAZ successfully to ${decompressedFilePath}`);

                // 5. CRITICAL: Update the processing path to point to the new .las file.
                processingFilePath = decompressedFilePath;
            } catch (decompressionError) {
                console.error(`[Queue] Job ${job.id}: Failed to decompress LAZ file.`, decompressionError);
                const suggestion = `Make sure the LAZ file is valid and that 'laszip' is installed and executable. ${laszipExec ? `Tried to run: ${laszipExec}` : ''}`;
                throw new Error('LAZ decompression failed. ' + suggestion);
            }
        }
        // --- END OF LAZ Decompression Logic ---


        if (!await checkResourceAvailability()) {
            throw new Error('Insufficient system resources available');
        }

        await updateJobStatus(fileId, 'processing', 'Job started');
        activeJobs.set(job.id, { fileId, startTime: Date.now() });
        resourceUsage.activeProcesses++;

        if (skipSegmentation) {
            // Check again before processing
            if (!(await shouldJobContinue(job, fileId))) {
                throw new Error('Job was cancelled');
            }

            // Step 2: LAS Processing
            console.log(`[Queue] Job ${job.id}: Starting LAS processing for file ${fileId}`);
            await updateJobStatus(fileId, 'processing_las_data', 'Processing LAS data');
            // --- MODIFIED: Use the correct file path ---
            await lasProcessingService.processLasData(fileId, processingFilePath);

            // ... (rest of the skipSegmentation block, no changes needed)
            
            console.log(`[Queue] Job ${job.id}: Skipping segmentation for file ${fileId}`);
            await updateJobStatus(fileId, 'ready', 'Processing complete - ready for viewer');
            // --- MODIFIED: Use the correct file path for encryption ---
            await encryptProcessedFile(fileId, processingFilePath);

        } else {
            // Check before starting segmentation
            if (!(await shouldJobContinue(job, fileId))) {
                throw new Error('Job was cancelled');
            }
            
            // Step 1: Run AI Segmentation
            console.log(`[Queue] Job ${job.id}: Starting enhanced segmentation for file ${fileId}`);
            await updateJobStatus(fileId, 'segmenting', 'Running AI semantic and instance segmentation');
            
            let segmentationResult;
            try {
                // --- MODIFIED: Use the correct file path ---
                segmentationResult = await enhancedSegmentationService.runSegmentation(fileId, processingFilePath, projectRootDir);
            } catch (segError) {
                // ... (rest of the segmentation block)
                if (!(await shouldJobContinue(job, fileId))) {
                    console.log(`[Queue] Job ${job.id} was cancelled during segmentation for file ${fileId}`);
                    throw new Error('Segmentation cancelled by user');
                }
                throw segError;
            }

            // ... (rest of the verification logic, no changes needed)
            // ...

            // Check before LAS processing
            if (!(await shouldJobContinue(job, fileId))) {
                throw new Error('Job was cancelled before LAS processing');
            }

            // Step 2: LAS Processing (now runs AFTER AI)
            console.log(`[Queue] Job ${job.id}: Starting LAS processing after segmentation for file ${fileId}`);
            await updateJobStatus(fileId, 'processing_las_data', 'Processing LAS data after AI segmentation');
            // --- MODIFIED: Use the correct file path ---
            await lasProcessingService.processLasData(fileId, processingFilePath);

            // ... (rest of the LAS processing verification, no changes needed)
            // ...

            // Step 3: Final status and encryption
            await updateJobStatus(fileId, 'ready', 'Processing complete - ready for viewer');
            // --- MODIFIED: Use the correct file path for encryption ---
            await encryptProcessedFile(fileId, processingFilePath);
        }

        try { clearProgress(fileId); } catch (_) {}
        console.log(`[Queue] Job ${job.id} completed successfully for file ${fileId}`);
        return { success: true, fileId };

    } catch (error) {
        // ... (Error handling block, no changes needed)
        // ...
    } finally {
        // --- NEW: Cleanup Logic ---
        // Clean up the temporary decompressed .las file if it was created.
        if (decompressedFilePath && fs.existsSync(decompressedFilePath)) {
            fs.unlink(decompressedFilePath, (err) => {
                if (err) console.error(`[Queue] Job ${job.id}: Failed to clean up temporary file ${decompressedFilePath}`, err);
                else console.log(`[Queue] Job ${job.id}: Cleaned up temporary file ${decompressedFilePath}`);
            });
        }
        // If the original upload was a LAZ file, it is now redundant after processing and encryption.
        // It will be cleaned up by the encryptProcessedFile function if it was the source,
        // but if we decompressed it, we need to clean it up ourselves. The `encryptProcessedFile`
        // function already deletes its source, which will be our `decompressedFilePath`.
        if (originalUploadedFileIsLaz && fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (err) console.error(`[Queue] Job ${job.id}: Failed to clean up original LAZ file ${filePath}`, err);
                else console.log(`[Queue] Job ${job.id}: Cleaned up original LAZ file ${filePath}`);
            });
        }
        // --- END OF NEW Cleanup Logic ---

        activeJobs.delete(job.id);
        resourceUsage.activeProcesses = Math.max(0, resourceUsage.activeProcesses - 1);
        updateResourceUsage();
    }
});

// Helper functions
async function checkResourceAvailability() {
    // Check if we have available slots
    if (resourceUsage.activeProcesses >= RESOURCE_LIMITS.MAX_CONCURRENT_JOBS) {
        return false;
    }

    // Check system memory (simplified check)
    const memUsage = process.memoryUsage();
    const memUsageMB = memUsage.heapUsed / 1024 / 1024;
    
    if (memUsageMB > RESOURCE_LIMITS.MAX_SYSTEM_MEMORY_MB * 0.8) { // 80% threshold
        console.warn(`[Queue] High memory usage: ${memUsageMB.toFixed(2)}MB`);
        return false;
    }

    return true;
}

async function updateJobStatus(fileId, status, message) {
    try {
        await pool.query(
            "UPDATE uploaded_files SET status = $1, processing_error = NULL WHERE id = $2",
            [status, fileId]
        );
        console.log(`[Queue] File ${fileId} status updated to: ${status} - ${message}`);
    } catch (error) {
        console.error(`[Queue] Failed to update status for file ${fileId}:`, error);
    }
}

async function encryptProcessedFile(fileId, filePath) {
    try {
        const encPathAbsolute = `${filePath}.enc`;
        await encryptFileTo(filePath, encPathAbsolute);
        
        // Update DB to point to encrypted file
        const filename = path.basename(filePath);
        const encPathRelative = `${path.join('uploads', filename)}.enc`;
        await pool.query("UPDATE uploaded_files SET stored_path = $1 WHERE id = $2", [encPathRelative, fileId]);
        
        // Remove plaintext file
        fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.error(`[Queue] Error deleting plaintext after encryption for file ${fileId}:`, err);
            }
        });
        
        console.log(`[Queue] File ${fileId} encrypted and plaintext removed`);
    } catch (error) {
        console.error(`[Queue] Encryption failed for file ${fileId}:`, error);
        // Don't fail the pipeline if encryption fails
    }
}

function updateResourceUsage() {
    // Update resource usage tracking
    const memUsage = process.memoryUsage();
    resourceUsage.systemMemory = memUsage.heapUsed / 1024 / 1024;
    
    console.log(`[Queue] Resource usage - Active jobs: ${resourceUsage.activeProcesses}/${RESOURCE_LIMITS.MAX_CONCURRENT_JOBS}, Memory: ${resourceUsage.systemMemory.toFixed(2)}MB`);
}

// Queue event listeners
processingQueue.on('completed', (job, result) => {
    console.log(`[Queue] Job ${job.id} completed:`, result);
});

processingQueue.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job.id} failed:`, err.message);
});

processingQueue.on('stalled', (job) => {
    console.warn(`[Queue] Job ${job.id} stalled`);
});

// Queue management functions
async function addFileProcessingJob(fileId, filePath, projectRootDir, skipSegmentation = false) {
    try {
        const job = await processingQueue.add('process-file', {
            fileId,
            filePath,
            projectRootDir,
            skipSegmentation,
        }, {
            priority: skipSegmentation ? 1 : 0, // Higher priority for files without segmentation
            delay: 0, // No delay - start processing immediately
        });

        console.log(`[Queue] Added job ${job.id} for file ${fileId}`);
        return job;
    } catch (error) {
        console.error(`[Queue] Failed to add job for file ${fileId}:`, error);
        throw error;
    }
}

async function getQueueStatus() {
    const waiting = await processingQueue.getWaiting();
    const active = await processingQueue.getActive();
    const completed = await processingQueue.getCompleted();
    const failed = await processingQueue.getFailed();

    return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        resourceUsage,
        limits: RESOURCE_LIMITS,
    };
}

async function pauseQueue() {
    await processingQueue.pause();
    console.log('[Queue] Processing queue paused');
}

async function resumeQueue() {
    await processingQueue.resume();
    console.log('[Queue] Processing queue resumed');
}

async function clearQueue() {
    await processingQueue.empty();
    console.log('[Queue] Processing queue cleared');
}

// Stop file processing
async function stopFileProcessing(fileId) {
    // Validate fileId
    if (!fileId || (typeof fileId !== 'number' && isNaN(parseInt(fileId, 10)))) {
        throw new Error(`Invalid fileId: ${fileId}`);
    }
    
    // Ensure fileId is a number
    fileId = parseInt(fileId, 10);
    
    console.log(`[Queue] Stopping processing for file ${fileId}`);
    
    try {
        // Step 1: Stop active segmentation if running
        try {
            if (enhancedSegmentationService && typeof enhancedSegmentationService.getActiveSegmentationProcesses === 'function') {
                const activeSegProcesses = enhancedSegmentationService.getActiveSegmentationProcesses();
                if (Array.isArray(activeSegProcesses)) {
                    // Convert fileId to string/number for comparison since Map keys might be either
                    const fileIdStr = String(fileId);
                    const fileIdNum = parseInt(fileId, 10);
                    const hasActiveProcess = activeSegProcesses.some(id => 
                        id === fileId || String(id) === fileIdStr || parseInt(id, 10) === fileIdNum
                    );
                    
                    if (hasActiveProcess) {
                        console.log(`[Queue] Stopping active segmentation for file ${fileId}`);
                        await enhancedSegmentationService.stopSegmentation(fileId);
                    }
                }
            }
        } catch (segError) {
            // If segmentation is not active, continue with queue cleanup
            const errorMsg = (segError && segError.message) ? segError.message : String(segError || '');
            if (!errorMsg.includes('No active segmentation process') && !errorMsg.includes('not found')) {
                console.warn(`[Queue] Error stopping segmentation for file ${fileId}:`, errorMsg);
            }
        }

        // Step 2: Find and remove jobs from queue
        let waiting = [];
        let active = [];
        try {
            waiting = await processingQueue.getWaiting();
            active = await processingQueue.getActive();
        } catch (queueError) {
            console.warn(`[Queue] Error getting queue jobs:`, queueError.message);
            // Continue anyway - we'll still update the database
        }
        
        let removedCount = 0;
        
        // Remove waiting jobs
        if (Array.isArray(waiting)) {
            for (const job of waiting) {
                if (!job) continue;
                try {
                    // Compare fileId accounting for type differences
                    const jobFileId = job.data?.fileId;
                    if (jobFileId && (jobFileId === fileId || parseInt(jobFileId, 10) === fileId || String(jobFileId) === String(fileId))) {
                        await job.remove();
                        removedCount++;
                        console.log(`[Queue] Removed waiting job ${job.id} for file ${fileId}`);
                    }
                } catch (jobError) {
                    const jobId = job?.id || 'unknown';
                    console.warn(`[Queue] Error removing waiting job ${jobId}:`, jobError?.message || String(jobError));
                }
            }
        }
        
        // Remove active jobs (these will be cancelled)
        // First, check activeJobs map to track which jobs belong to this file
        const trackedJobIds = new Set();
        for (const [jobId, jobInfo] of activeJobs.entries()) {
            if (jobInfo.fileId === fileId) {
                trackedJobIds.add(jobId);
            }
        }
        
        // Now cancel/remove jobs from Bull queue
        const removedJobIds = new Set();
        if (Array.isArray(active)) {
            for (const job of active) {
                if (!job) continue;
                try {
                    // Compare fileId accounting for type differences
                    const jobFileId = job.data?.fileId;
                    if (jobFileId && (jobFileId === fileId || parseInt(jobFileId, 10) === fileId || String(jobFileId) === String(fileId))) {
                        try {
                            // For active jobs, we should move them to failed or remove them
                            // First try to remove (which cancels active jobs in Bull)
                            await job.remove();
                            removedJobIds.add(job.id);
                            // Also remove from activeJobs tracking
                            activeJobs.delete(job.id);
                            resourceUsage.activeProcesses = Math.max(0, resourceUsage.activeProcesses - 1);
                            removedCount++;
                            console.log(`[Queue] Cancelled and removed active job ${job.id} for file ${fileId}`);
                        } catch (jobError) {
                            // If remove fails, try to move to failed state
                            try {
                                await job.moveToFailed(new Error('Processing stopped by user'), true);
                                removedJobIds.add(job.id);
                                activeJobs.delete(job.id);
                                resourceUsage.activeProcesses = Math.max(0, resourceUsage.activeProcesses - 1);
                                removedCount++;
                                console.log(`[Queue] Moved active job ${job.id} to failed state for file ${fileId}`);
                            } catch (moveError) {
                                console.warn(`[Queue] Could not cancel active job ${job.id}:`, moveError?.message || String(moveError));
                                // Still mark as handled
                                removedJobIds.add(job.id);
                                activeJobs.delete(job.id);
                                resourceUsage.activeProcesses = Math.max(0, resourceUsage.activeProcesses - 1);
                                removedCount++;
                            }
                        }
                    }
                } catch (jobError) {
                    const jobId = job?.id || 'unknown';
                    console.warn(`[Queue] Error checking active job ${jobId}:`, jobError?.message || String(jobError));
                }
            }
        }
        
        // Also try to cancel/remove any jobs tracked in activeJobs that weren't in Bull's active list
        for (const jobId of trackedJobIds) {
            if (!removedJobIds.has(jobId)) {
                try {
                    const job = await processingQueue.getJob(jobId);
                    if (job) {
                        try {
                            await job.remove();
                        } catch (removeErr) {
                            // Try moving to failed if remove doesn't work
                            await job.moveToFailed(new Error('Processing stopped by user'), true);
                        }
                        removedCount++;
                        activeJobs.delete(jobId);
                        resourceUsage.activeProcesses = Math.max(0, resourceUsage.activeProcesses - 1);
                        console.log(`[Queue] Cancelled tracked job ${jobId} for file ${fileId}`);
                    }
                } catch (jobError) {
                    // Job may have already completed or been removed
                    activeJobs.delete(jobId);
                    resourceUsage.activeProcesses = Math.max(0, resourceUsage.activeProcesses - 1);
                    console.log(`[Queue] Job ${jobId} was already removed or completed`);
                }
            }
        }
        
        // Step 3: Update database status (always do this even if no jobs found)
        try {
            await pool.query(
                "UPDATE uploaded_files SET status = 'stopped', processing_error = 'Processing stopped by user' WHERE id = $1",
                [fileId]
            );
        } catch (dbError) {
            console.error(`[Queue] Error updating database status for file ${fileId}:`, dbError);
            throw new Error(`Failed to update database status: ${dbError.message}`);
        }
        
        // Step 4: Clear progress
        try {
            clearProgress(fileId);
        } catch (progressError) {
            console.warn(`[Queue] Error clearing progress for file ${fileId}:`, progressError);
        }
        
        const message = removedCount > 0 
            ? `Processing stopped successfully. Removed ${removedCount} job(s) from queue.`
            : `Processing stopped successfully. No jobs found in queue.`;
        
        console.log(`[Queue] Successfully stopped processing for file ${fileId}. Removed ${removedCount} job(s).`);
        return { 
            success: true, 
            message 
        };
        
    } catch (error) {
        console.error(`[Queue] Error stopping processing for file ${fileId}:`, error);
        throw error;
    }
}

// Start file processing
async function startFileProcessing(fileId) {
    console.log(`[Queue] Starting processing for file ${fileId}`);
    
    try {
        // Step 1: Get file information from database
        const fileResult = await pool.query(
            "SELECT stored_path, status FROM uploaded_files WHERE id = $1",
            [fileId]
        );
        
        if (fileResult.rows.length === 0) {
            throw new Error(`File with id ${fileId} not found`);
        }
        
        const file = fileResult.rows[0];
        const fileStatus = file.status;
        
        // Step 2: Check if file can be restarted
        const restartableStatuses = ['stopped', 'failed', 'uploaded', 'pending'];
        if (!restartableStatuses.includes(fileStatus)) {
            throw new Error(`File status "${fileStatus}" cannot be restarted. File must be in one of: ${restartableStatuses.join(', ')}`);
        }
        
        // Step 3: Check if file already has a job in queue
        const waiting = await processingQueue.getWaiting();
        const active = await processingQueue.getActive();
        
        for (const job of [...waiting, ...active]) {
            if (job.data && job.data.fileId === fileId) {
                throw new Error(`File ${fileId} already has a job in the queue (job ${job.id})`);
            }
        }
        
        // Step 4: Get project root directory (from environment or config)
        const projectRootDir = process.env.PROJECT_ROOT_DIR || process.cwd();
        
        // Step 5: Resolve file path (handle encrypted files)
        let filePath = file.stored_path;
        if (!path.isAbsolute(filePath)) {
            filePath = path.resolve(process.cwd(), filePath);
        }
        
        // Step 6: Handle encrypted files - decrypt if needed
        const isEncrypted = filePath.endsWith('.enc');
        if (isEncrypted) {
            // Decrypt file to a temporary location for processing
            const decryptedPath = filePath.replace(/\.enc$/, '');
            console.log(`[Queue] Decrypting file ${fileId} from ${filePath} to ${decryptedPath}`);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`Encrypted file not found at ${filePath}`);
            }
            
            await decryptFileTo(filePath, decryptedPath);
            filePath = decryptedPath;
            console.log(`[Queue] Successfully decrypted file ${fileId}`);
        } else {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found at ${filePath}`);
            }
        }
        
        // Step 7: Determine if segmentation should be skipped
        // Only skip if file was already processed (but this shouldn't happen for restartable statuses)
        const skipSegmentation = false;
        
        // Step 8: Update database status to indicate job is queued
        await pool.query(
            "UPDATE uploaded_files SET status = 'pending', processing_error = NULL WHERE id = $1",
            [fileId]
        );

        // Step 9: Add job to queue
        const job = await addFileProcessingJob(fileId, filePath, projectRootDir, skipSegmentation);
        console.log(`[Queue] Added job ${job.id} to start processing for file ${fileId}`);

        // Step 10: Get updated file status to return to client
        const updatedFileResult = await pool.query(
            "SELECT status FROM uploaded_files WHERE id = $1",
            [fileId]
        );
        const updatedStatus = updatedFileResult.rows.length > 0 ? updatedFileResult.rows[0].status : 'pending';

        return { 
            success: true, 
            message: `Processing started successfully for file ${fileId}`,
            status: updatedStatus,
            jobId: job.id
        };
        
    } catch (error) {
        console.error(`[Queue] Error starting processing for file ${fileId}:`, error);
        throw error;
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[Queue] Received SIGTERM, shutting down gracefully');
    await processingQueue.close();
    await redis.quit();
});

process.on('SIGINT', async () => {
    console.log('[Queue] Received SIGINT, shutting down gracefully');
    await processingQueue.close();
    await redis.quit();
});

module.exports = {
    addFileProcessingJob,
    getQueueStatus,
    pauseQueue,
    resumeQueue,
    clearQueue,
    stopFileProcessing,
    startFileProcessing,
    processingQueue,
    redis,
};