// services/queueService.js
const Queue = require('bull');
const Redis = require('ioredis');
const { pool } = require('../config/db');
const lasProcessingService = require('./lasProcessingService');
const segmentationService = require('./segmentationService');
const { setProgress, clearProgress } = require('./progressStore');
const fs = require('fs');
const path = require('path');
const { encryptFileTo } = require('../utils/fileCrypto');

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

// Job processor
processingQueue.process('process-file', RESOURCE_LIMITS.MAX_CONCURRENT_JOBS, async (job) => {
    const { fileId, filePath, projectRootDir, skipSegmentation } = job.data;
    
    console.log(`[Queue] Starting job ${job.id} for file ${fileId}`);
    
    try {
        // Check if file was stopped before starting any processing
        const initialStatusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
        if (initialStatusCheck.rows.length === 0 || ['failed', 'stopped'].includes(initialStatusCheck.rows[0].status)) {
            console.log(`[Queue] Job ${job.id}: File ${fileId} was stopped by user, aborting job (this is expected)`);
            // Don't treat this as an error - it's expected behavior when user stops processing
            return { success: false, message: 'File processing was stopped by user', aborted: true };
        }
        
        // Check resource availability before starting
        if (!await checkResourceAvailability()) {
            throw new Error('Insufficient system resources available');
        }

        // Update job status
        await updateJobStatus(fileId, 'processing', 'Job started');
        activeJobs.set(job.id, { fileId, startTime: Date.now() });
        resourceUsage.activeProcesses++;

        // Step 1: LAS Processing
        console.log(`[Queue] Job ${job.id}: Starting LAS processing for file ${fileId}`);
        
        // Check if file was stopped before starting LAS processing
        const preLasStatusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
        if (preLasStatusCheck.rows.length === 0 || ['failed', 'stopped'].includes(preLasStatusCheck.rows[0].status)) {
            console.log(`[Queue] Job ${job.id}: File ${fileId} was stopped by user, aborting LAS processing (expected)`);
            return { success: false, message: 'File processing was stopped by user', aborted: true };
        }
        
        await updateJobStatus(fileId, 'processing_las_data', 'Processing LAS data');
        await lasProcessingService.processLasData(fileId, filePath);
        
        // Verify LAS processing success and check if file was stopped during processing
        const statusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
        if (statusCheck.rows.length === 0 || ['failed', 'stopped'].includes(statusCheck.rows[0].status)) {
            console.log(`[Queue] Job ${job.id}: File ${fileId} was stopped during LAS processing (expected)`);
            return { success: false, message: 'File processing was stopped by user', aborted: true };
        }
        if (statusCheck.rows[0].status !== 'processed_ready_for_potree') {
            throw new Error('LAS processing failed');
        }

        if (skipSegmentation) {
            // Skip segmentation path
            console.log(`[Queue] Job ${job.id}: Skipping segmentation for file ${fileId}`);
            await updateJobStatus(fileId, 'ready', 'Processing complete - ready for viewer');
            
            // Encrypt file
            await encryptProcessedFile(fileId, filePath);
            
        } else {
            // Full pipeline with segmentation
            console.log(`[Queue] Job ${job.id}: Starting segmentation for file ${fileId}`);
            
            // Check if file was stopped before starting segmentation
            const preSegStatusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
            if (preSegStatusCheck.rows.length === 0 || ['failed', 'stopped'].includes(preSegStatusCheck.rows[0].status)) {
                console.log(`[Queue] Job ${job.id}: File ${fileId} was stopped by user, aborting segmentation (expected)`);
                return { success: false, message: 'File processing was stopped by user', aborted: true };
            }
            
            await updateJobStatus(fileId, 'segmenting', 'Running AI segmentation');
            await segmentationService.runSegmentation(fileId, filePath, projectRootDir);
            
            // Verify segmentation success and check if file was stopped during processing
            const segStatusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
            if (segStatusCheck.rows.length === 0 || ['failed', 'stopped'].includes(segStatusCheck.rows[0].status)) {
                console.log(`[Queue] Job ${job.id}: File ${fileId} was stopped during segmentation (expected)`);
                return { success: false, message: 'File processing was stopped by user', aborted: true };
            }
            if (segStatusCheck.rows[0].status !== 'segmented_ready_for_las') {
                throw new Error('Segmentation failed');
            }

            // Final processing steps
            await updateJobStatus(fileId, 'ready', 'Processing complete - ready for viewer');
            await encryptProcessedFile(fileId, filePath);
        }

        // Clear progress tracking
        try { clearProgress(fileId); } catch (_) {}

        console.log(`[Queue] Job ${job.id} completed successfully for file ${fileId}`);
        return { success: true, fileId };

    } catch (error) {
        console.error(`[Queue] Job ${job.id} failed for file ${fileId}:`, error);
        
        // Update file status to failed
        try {
            await pool.query(
                "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                [error.message, fileId]
            );
        } catch (dbError) {
            console.error(`[Queue] Failed to update error status for file ${fileId}:`, dbError);
        }

        // Clear progress tracking
        try { clearProgress(fileId); } catch (_) {}

        throw error;
    } finally {
        // Clean up resources
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
            delay: 1000, // Small delay to allow for proper status updates
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

async function stopFileProcessing(fileId) {
    try {
        console.log(`[Queue] Attempting to stop processing for file ${fileId}`);
        
        // Check if file is currently being processed
        const fileStatus = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [fileId]);
        if (fileStatus.rows.length === 0) {
            throw new Error(`File ${fileId} not found`);
        }
        
        const currentStatus = fileStatus.rows[0].status;
        
        // First, try to remove any waiting jobs for this file from the queue
        try {
            const waitingJobs = await processingQueue.getWaiting();
            for (const job of waitingJobs) {
                if (job.data.fileId === fileId) {
                    await job.remove();
                    console.log(`[Queue] Removed waiting job ${job.id} for file ${fileId}`);
                }
            }
        } catch (queueError) {
            console.warn(`[Queue] Could not remove waiting jobs for file ${fileId}:`, queueError);
        }
        
        if (currentStatus === 'segmenting') {
            // Stop segmentation process
            const result = await segmentationService.stopSegmentation(fileId);
            console.log(`[Queue] Stopped segmentation for file ${fileId}`);
            return result;
        } else if (['uploaded', 'processing_las_data', 'processing'].includes(currentStatus)) {
            // For files in queue or LAS processing, update the status to stopped
            await pool.query(
                "UPDATE uploaded_files SET status = 'stopped', processing_error = 'Processing stopped by user' WHERE id = $1",
                [fileId]
            );
            clearProgress(fileId);
            console.log(`[Queue] Marked file ${fileId} as stopped (stopped by user)`);
            return { success: true, message: "Processing stopped successfully" };
        } else {
            throw new Error(`Cannot stop processing for file ${fileId} with status: ${currentStatus}`);
        }
        
    } catch (error) {
        console.error(`[Queue] Error stopping processing for file ${fileId}:`, error);
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

async function startFileProcessing(fileId) {
    try {
        console.log(`[Queue] Attempting to start processing for file ${fileId}`);
        
        // Check if file exists and is in a startable state
        const fileStatus = await pool.query("SELECT status, stored_path FROM uploaded_files WHERE id = $1", [fileId]);
        if (fileStatus.rows.length === 0) {
            throw new Error(`File ${fileId} not found`);
        }
        
        const currentStatus = fileStatus.rows[0].status;
        const filePath = fileStatus.rows[0].stored_path;
        
        if (currentStatus === 'stopped') {
            // Reset status and add to queue for processing
            await pool.query(
                "UPDATE uploaded_files SET status = 'uploaded', processing_error = NULL WHERE id = $1",
                [fileId]
            );
            
            // Add file back to processing queue
            const projectRootDir = path.resolve(__dirname, '..');
            const absoluteFilePath = path.resolve(__dirname, '..', filePath);
            
            const job = await processingQueue.add('process-file', {
                fileId,
                filePath: absoluteFilePath,
                projectRootDir,
                skipSegmentation: false, // Always run full pipeline when restarting
            }, {
                priority: 0,
                delay: 1000,
            });
            
            console.log(`[Queue] Restarted processing for file ${fileId}, added job ${job.id}`);
            return { success: true, message: "Processing restarted successfully" };
        } else {
            throw new Error(`Cannot start processing for file ${fileId} with status: ${currentStatus}`);
        }
        
    } catch (error) {
        console.error(`[Queue] Error starting processing for file ${fileId}:`, error);
        throw error;
    }
}

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
