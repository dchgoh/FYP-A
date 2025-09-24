// src/services/segmentationService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db'); // Assuming shared DB config

async function runSegmentation(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[SegmentationService] (FileID ${fileId}): Starting for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'segmenting', processing_error = NULL WHERE id = $1", [fileId]);

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
            '--stride_ratio', '0.5', '--output_format', 'las',
        ];

        console.log(`[SegmentationService] (FileID ${fileId}): Spawning: "${pythonVenvExecutable}" CWD "${projectRootDir}" args: ${segmentArgs.join(' ')}`);
        const segmentationProcess = spawn(pythonVenvExecutable, segmentArgs, { cwd: projectRootDir, stdio: 'pipe' });
        let segStdout = '', segStderr = '';
        let progressData = null;
        
        segmentationProcess.stdout.on('data', (data) => { 
            segStdout += data.toString(); 
            process.stdout.write(`[SegPy STDOUT FID ${fileId}] ${data.toString()}`);
        });
        
        segmentationProcess.stderr.on('data', (data) => { 
            const output = data.toString();
            segStderr += output;
            process.stderr.write(`[SegPy STDERR FID ${fileId}] ${output}`);
            
            // Parse progress information from tqdm output
            // Try multiple regex patterns to handle different tqdm formats
            let progressMatch = output.match(/Inferring Chunks:\s*(\d+)%\|[^|]*\|\s*(\d+)\/(\d+)\s*\[([^\]]+)\]/);
            
            // Fallback pattern for the exact format we're seeing: "Inferring Chunks:  49%|####9     | 95/192 [01:22<01:23,  1.16it/s]"
            if (!progressMatch) {
                progressMatch = output.match(/Inferring Chunks:\s*(\d+)%\|\S+\|\s*(\d+)\/(\d+)\s*\[([^\]]+)\]/);
            }
            
            // Another fallback for the specific format with extra spaces
            if (!progressMatch) {
                progressMatch = output.match(/Inferring Chunks:\s+(\d+)%\|\S+\|\s+(\d+)\/(\d+)\s+\[([^\]]+)\]/);
            }
            
            if (progressMatch) {
                const percentage = parseInt(progressMatch[1]);
                const current = parseInt(progressMatch[2]);
                const total = parseInt(progressMatch[3]);
                const timeInfo = progressMatch[4];
                
                console.log(`[SegmentationService] Progress detected: ${percentage}% (${current}/${total}) - ${timeInfo}`);
                
                // Parse time information (e.g., "01:22<01:23,  1.16it/s")
                const timeMatch = timeInfo.match(/(\d+:\d+)<(\d+:\d+),\s*([\d.]+)it\/s/);
                if (timeMatch) {
                    const elapsed = timeMatch[1];
                    const eta = timeMatch[2];
                    const rate = timeMatch[3];
                    
                    progressData = {
                        percentage,
                        current,
                        total,
                        elapsed,
                        eta,
                        rate: `${rate} chunks/s`
                    };
                    
                    console.log(`[SegmentationService] Updating progress for FileID ${fileId}:`, progressData);
                    
                    // Update database with progress information
                    pool.query(
                        "UPDATE uploaded_files SET processing_progress = $1 WHERE id = $2",
                        [JSON.stringify(progressData), fileId]
                    ).then(() => {
                        console.log(`[SegmentationService] Progress updated successfully for FileID ${fileId}`);
                    }).catch(dbErr => {
                        console.error(`[SegmentationService] Error updating progress (FileID ${fileId}):`, dbErr);
                    });
                } else {
                    console.log(`[SegmentationService] Time info parsing failed for: ${timeInfo}`);
                }
            } else {
                // Log when we don't match to help debug
                if (output.includes('Inferring Chunks') || output.includes('%')) {
                    console.log(`[SegmentationService] Progress line detected but didn't match regex: ${output.trim()}`);
                }
            }
        });

        segmentationProcess.on('error', async (error) => {
            console.error(`[SegmentationService] Error (FileID ${fileId}): Failed to start. Err: ${error.message}`);
            if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { /* restore backup */ try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {console.error('Backup restore failed', e)} }
            try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Seg Spawn Err: ${error.message.substring(0,200)}`, fileId]); } catch (dbErr) {/* log */}
            reject(new Error(`[SegmentationService] Spawn error: ${error.message}. Stderr: ${segStderr.substring(0, 100)}`));
        });

        segmentationProcess.on('close', async (code) => {
            console.log(`\n[SegmentationService] (FileID ${fileId}): Script exited with code ${code}.`);
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
                    console.log(`[SegmentationService] (FileID ${fileId}): Success. Status 'segmented_ready_for_las'.`);
                    resolve({ success: true, message: "Segmentation successful.", stdout: segStdout });
                }
            } else {
                const errMsg = `[SegmentationService] Script failed. Code: ${code}. Stderr: ${segStderr.substring(0,200)}`;
                if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { /* restore backup */ try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {console.error('Backup restore failed', e)}}
                try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]); } catch (dbErr) {/* log */}
                reject(new Error(errMsg));
            }
        });
    });
}

module.exports = { runSegmentation };