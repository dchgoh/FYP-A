// src/services/segmentationService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db'); // Assuming shared DB config
const { setProgress, clearProgress } = require('./progressStore');
const gpuManager = require('./gpuResourceManager');

// Track active segmentation processes
const activeProcesses = new Map();

async function runSegmentation(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[SegmentationService] (FileID ${fileId}): Starting for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'segmenting', processing_error = NULL WHERE id = $1", [fileId]);

    // Allocate GPU for this job
    const allocatedGpuId = await gpuManager.allocateGPU(fileId, 2000); // Request 2GB GPU memory
    const gpuArg = allocatedGpuId !== null ? allocatedGpuId.toString() : 'cpu';

    return new Promise((resolve, reject) => {
        const pythonVenvExecutable = process.platform === "win32"
            ? path.join(projectRootDir, 'venv', 'Scripts', 'python.exe')
            : path.join(projectRootDir, 'venv', 'bin', 'python');
        const pythonSegmentScriptName = 'inference_full_cloud.py';
        const pythonSegmentScriptToExecute = path.join(projectRootDir, pythonSegmentScriptName);
        const checkpointDirName = 'checkpoints';
        const checkpointFileName = 'pointnet2_msg_best_model.pth';
        const checkpointRelativePath = path.join(checkpointDirName, checkpointFileName);
        const checkpointAbsolutePathForCheck = path.join(projectRootDir, checkpointDirName, checkpointFileName);
        const modelNameForScript = 'pointnet2_sem_seg_msg';
        let originalFileBackupPath = null;

        // Pre-checks (moved from controller/single service)
        if (!fs.existsSync(pythonVenvExecutable)) return reject(new Error(`[SegmentationService] Python venv executable not found: ${pythonVenvExecutable}`));
        if (!fs.existsSync(pythonSegmentScriptToExecute)) return reject(new Error(`[SegmentationService] Python segmentation script not found: ${pythonSegmentScriptToExecute}`));
        if (!fs.existsSync(checkpointAbsolutePathForCheck)) return reject(new Error(`[SegmentationService] Segmentation checkpoint file not found: ${checkpointAbsolutePathForCheck}`));

        originalFileBackupPath = inputFileAbsolutePath + ".bak";
        try {
            fs.copyFileSync(inputFileAbsolutePath, originalFileBackupPath);
            console.log(`[SegmentationService] (FileID ${fileId}): Created backup: ${originalFileBackupPath}`);
        } catch (copyError) {
            return reject(new Error(`[SegmentationService] Failed to create backup: ${copyError.message}`));
        }

        const segmentArgs = [
            pythonSegmentScriptToExecute, '--model', modelNameForScript, '--checkpoint_path', checkpointRelativePath,
            '--input_file', inputFileAbsolutePath, '--output_dir', path.dirname(inputFileAbsolutePath),
            '--num_point_model', '1024', '--num_features', '6', '--batch_size_inference', '16',
            '--stride_ratio', '0.5', '--output_format', 'las', '--gpu', gpuArg,
        ];

        console.log(`[SegmentationService] (FileID ${fileId}): Spawning: "${pythonVenvExecutable}" CWD "${projectRootDir}" args: ${segmentArgs.join(' ')}`);
        const segmentationProcess = spawn(pythonVenvExecutable, segmentArgs, { cwd: projectRootDir, stdio: 'pipe' });
        let segStdout = '', segStderr = '';
        
        // Track the active process
        activeProcesses.set(fileId, {
            process: segmentationProcess,
            startTime: Date.now(),
            filePath: inputFileAbsolutePath,
            backupPath: originalFileBackupPath
        });
        
        segmentationProcess.stdout.on('data', (data) => { 
            const output = data.toString();
            segStdout += output; 
            process.stdout.write(`[SegPy STDOUT FID ${fileId}] ${output}`);
            try {
                const match = output.match(/(\d{1,3})%/);
                if (match) {
                    const pct = parseInt(match[1], 10);
                    if (!isNaN(pct)) setProgress(fileId, pct);
                }
            } catch (_) { /* noop */ }
            
            // Check if process was stopped during execution
            if (!activeProcesses.has(fileId)) {
                console.log(`[SegmentationService] Process ${fileId} was stopped, killing segmentation process`);
                segmentationProcess.kill('SIGTERM');
            }
        });
        
        segmentationProcess.stderr.on('data', (data) => { 
            const output = data.toString();
            segStderr += output;
            process.stderr.write(`[SegPy STDERR FID ${fileId}] ${output}`);
            try {
                const match = output.match(/(\d{1,3})%/);
                if (match) {
                    const pct = parseInt(match[1], 10);
                    if (!isNaN(pct)) setProgress(fileId, pct);
                }
            } catch (_) { /* noop */ }
            
            // Check if process was stopped during execution
            if (!activeProcesses.has(fileId)) {
                console.log(`[SegmentationService] Process ${fileId} was stopped, killing segmentation process`);
                segmentationProcess.kill('SIGTERM');
            }
        });

        segmentationProcess.on('error', async (error) => {
            console.error(`[SegmentationService] Error (FileID ${fileId}): Failed to start. Err: ${error.message}`);
            
            // Remove from active processes
            activeProcesses.delete(fileId);
            
            if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { /* restore backup */ try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {console.error('Backup restore failed', e)} }
            try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Seg Spawn Err: ${error.message.substring(0,200)}`, fileId]); } catch (dbErr) {/* log */}
            // Release GPU allocation on process error
            gpuManager.releaseGPU(fileId);
            reject(new Error(`[SegmentationService] Spawn error: ${error.message}. Stderr: ${segStderr.substring(0, 100)}`));
        });

        segmentationProcess.on('close', async (code) => {
            console.log(`\n[SegmentationService] (FileID ${fileId}): Script exited with code ${code}.`);
            
            // Remove from active processes
            activeProcesses.delete(fileId);
            
            if (code === 0) {
                // Check for the output file created by segmentation script
                // Match the Python script's sanitization: Path(args.input_file).stem.replace(" ", "_")
                const inputFileName = path.basename(inputFileAbsolutePath, path.extname(inputFileAbsolutePath));
                const sanitizedInputStem = inputFileName.replace(/ /g, '_'); // Replace spaces with underscores like Python script
                const outputFileName = sanitizedInputStem + '.las';
                const outputFileAbsolutePath = path.join(path.dirname(inputFileAbsolutePath), outputFileName);
                
                console.log(`[SegmentationService] (FileID ${fileId}): Checking for output file: ${outputFileAbsolutePath}`);
                
                // List all files in the output directory for debugging
                const outputDir = path.dirname(inputFileAbsolutePath);
                try {
                    const filesInDir = fs.readdirSync(outputDir);
                    console.log(`[SegmentationService] (FileID ${fileId}): Files in output directory:`, filesInDir);
                } catch (listError) {
                    console.error(`[SegmentationService] (FileID ${fileId}): Error listing directory:`, listError);
                }
                
                if (!fs.existsSync(outputFileAbsolutePath) || fs.statSync(outputFileAbsolutePath).size === 0) {
                    if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { /* restore backup */ try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {console.error('Backup restore failed', e)}}
                    try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = 'Seg invalid output' WHERE id = $1", [fileId]); } catch (dbErr) {/* log */}
                    reject(new Error("[SegmentationService] Output file invalid."));
                } else {
                    // Replace the original file with the segmented output
                    try {
                        fs.renameSync(outputFileAbsolutePath, inputFileAbsolutePath);
                        console.log(`[SegmentationService] (FileID ${fileId}): Replaced original file with segmented output.`);
                    } catch (renameError) {
                        console.error(`[SegmentationService] (FileID ${fileId}): Error replacing file:`, renameError);
                        // Continue anyway, the output file exists
                    }
                    
                    if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { /* delete backup */ try {fs.unlinkSync(originalFileBackupPath); } catch(e){console.error('Backup delete failed',e)}}
                    // Successfully segmented, don't change status yet, let controller do it or next service
                    // Or set to 'segmented_ready_for_las_processing'
                    await pool.query("UPDATE uploaded_files SET status = 'segmented_ready_for_las', processing_error = NULL WHERE id = $1", [fileId]);
                    try { setProgress(fileId, 100); } catch (_) { /* noop */ }
                    console.log(`[SegmentationService] (FileID ${fileId}): Success. Status 'segmented_ready_for_las'.`);
                    // Release GPU allocation
                    gpuManager.releaseGPU(fileId);
                    resolve({ success: true, message: "Segmentation successful.", stdout: segStdout });
                }
            } else {
                const errMsg = `[SegmentationService] Script failed. Code: ${code}. Stderr: ${segStderr.substring(0,200)}`;
                if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { /* restore backup */ try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {console.error('Backup restore failed', e)}}
                try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]); } catch (dbErr) {/* log */}
                try { clearProgress(fileId); } catch (_) { /* noop */ }
                // Release GPU allocation on failure
                gpuManager.releaseGPU(fileId);
                reject(new Error(errMsg));
            }
        });
    });
}

async function stopSegmentation(fileId) {
    console.log(`[SegmentationService] Stopping segmentation for file ${fileId}`);
    
    const processInfo = activeProcesses.get(fileId);
    if (!processInfo) {
        throw new Error(`No active segmentation process found for file ${fileId}`);
    }
    
    try {
        // Kill the process
        processInfo.process.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Force kill if still running
        if (!processInfo.process.killed) {
            processInfo.process.kill('SIGKILL');
        }
        
        // Clean up files
        if (processInfo.backupPath && fs.existsSync(processInfo.backupPath)) {
            try {
                fs.renameSync(processInfo.backupPath, processInfo.filePath);
                console.log(`[SegmentationService] Restored backup for file ${fileId}`);
            } catch (e) {
                console.error(`[SegmentationService] Failed to restore backup for file ${fileId}:`, e);
            }
        }
        
        // Update database status
        await pool.query("UPDATE uploaded_files SET status = 'stopped', processing_error = 'Segmentation stopped by user' WHERE id = $1", [fileId]);
        
        // Clear progress
        clearProgress(fileId);
        
        // Release GPU allocation
        gpuManager.releaseGPU(fileId);
        
        // Remove from active processes
        activeProcesses.delete(fileId);
        
        console.log(`[SegmentationService] Successfully stopped segmentation for file ${fileId}`);
        return { success: true, message: "Segmentation stopped successfully" };
        
    } catch (error) {
        console.error(`[SegmentationService] Error stopping segmentation for file ${fileId}:`, error);
        activeProcesses.delete(fileId);
        throw error;
    }
}

function getActiveSegmentationProcesses() {
    return Array.from(activeProcesses.keys());
}

module.exports = { runSegmentation, stopSegmentation, getActiveSegmentationProcesses };

