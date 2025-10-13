// services/isbnetInstanceSegmentationService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db');
const { setProgress, clearProgress } = require('./progressStore');
const gpuManager = require('./gpuResourceManager');

async function runInstanceSegmentation(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[ISBNetService] (FileID ${fileId}): Starting instance segmentation for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'instance_segmenting', processing_error = NULL WHERE id = $1", [fileId]);

    // Allocate GPU for this job
    const allocatedGpuId = await gpuManager.allocateGPU(fileId, 3000); // Request 3GB GPU memory for instance segmentation
    const gpuArg = allocatedGpuId !== null ? allocatedGpuId.toString() : 'cpu';

    return new Promise((resolve, reject) => {
        // Path to the ISBNet inference script
        const isbnetScriptPath = path.join(projectRootDir, 'run_inference_local.py');
        
        // Check if ISBNet engine exists
        if (!fs.existsSync(isbnetScriptPath)) {
            const errMsg = `[ISBNetService] ISBNet inference script not found: ${isbnetScriptPath}`;
            console.error(errMsg);
            gpuManager.releaseGPU(fileId);
            return reject(new Error(errMsg));
        }

        // ISBNet configuration paths
        const configPath = path.join(projectRootDir, 'configs', 'config_forinstance.yaml');
        const checkpointPath = path.join(projectRootDir, 'configs', 'best.pth');

        // Check if config and checkpoint exist
        if (!fs.existsSync(configPath)) {
            const errMsg = `[ISBNetService] ISBNet config file not found: ${configPath}`;
            console.error(errMsg);
            gpuManager.releaseGPU(fileId);
            return reject(new Error(errMsg));
        }

        if (!fs.existsSync(checkpointPath)) {
            const errMsg = `[ISBNetService] ISBNet checkpoint file not found: ${checkpointPath}`;
            console.error(errMsg);
            gpuManager.releaseGPU(fileId);
            return reject(new Error(errMsg));
        }

        // Create output directory
        const outputDir = path.dirname(inputFileAbsolutePath);
        const inputFileName = path.basename(inputFileAbsolutePath, path.extname(inputFileAbsolutePath));
        const outputFileName = `${inputFileName}_instance_segmented.las`;
        const outputFileAbsolutePath = path.join(outputDir, outputFileName);

        // Create backup of original file
        const originalFileBackupPath = inputFileAbsolutePath + ".isbnet_bak";
        try {
            fs.copyFileSync(inputFileAbsolutePath, originalFileBackupPath);
            console.log(`[ISBNetService] (FileID ${fileId}): Created backup: ${originalFileBackupPath}`);
        } catch (copyError) {
            gpuManager.releaseGPU(fileId);
            return reject(new Error(`[ISBNetService] Failed to create backup: ${copyError.message}`));
        }

        // Prepare ISBNet command arguments
        const isbnetArgs = [
            isbnetScriptPath,
            inputFileAbsolutePath,        // input_las
            outputFileAbsolutePath,       // output_las
            configPath,                   // config
            checkpointPath                // checkpoint
        ];

        console.log(`[ISBNetService] (FileID ${fileId}): Spawning ISBNet inference with args: ${isbnetArgs.join(' ')}`);
        
        // Set environment variables for GPU usage
        const env = { ...process.env };
        if (allocatedGpuId !== null) {
            env.CUDA_VISIBLE_DEVICES = allocatedGpuId.toString();
        }

        // Spawn the ISBNet process
        const isbnetProcess = spawn('python', isbnetArgs, { 
            cwd: projectRootDir,
            stdio: 'pipe',
            env: env
        });

        let isbnetStdout = '', isbnetStderr = '';
        
        // Handle stdout
        isbnetProcess.stdout.on('data', (data) => {
            const output = data.toString();
            isbnetStdout += output;
            process.stdout.write(`[ISBNet STDOUT FID ${fileId}] ${output}`);
            
            // Try to extract progress from output
            try {
                const match = output.match(/(\d{1,3})%/);
                if (match) {
                    const pct = parseInt(match[1], 10);
                    if (!isNaN(pct)) setProgress(fileId, pct);
                }
            } catch (_) { /* noop */ }
        });
        
        // Handle stderr
        isbnetProcess.stderr.on('data', (data) => {
            const output = data.toString();
            isbnetStderr += output;
            process.stderr.write(`[ISBNet STDERR FID ${fileId}] ${output}`);
        });

        // Handle process errors
        isbnetProcess.on('error', async (error) => {
            console.error(`[ISBNetService] Error (FileID ${fileId}): Failed to start ISBNet process: ${error.message}`);
            
            // Restore backup
            if (fs.existsSync(originalFileBackupPath)) {
                try {
                    fs.renameSync(originalFileBackupPath, inputFileAbsolutePath);
                } catch (e) {
                    console.error('Backup restore failed', e);
                }
            }
            
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", 
                    [`ISBNet Spawn Error: ${error.message.substring(0, 200)}`, fileId]);
            } catch (dbErr) {
                console.error(`[ISBNetService] DB Error (FileID ${fileId}):`, dbErr);
            }
            
            gpuManager.releaseGPU(fileId);
            reject(new Error(`[ISBNetService] Spawn error: ${error.message}`));
        });

        // Handle process completion
        isbnetProcess.on('close', async (code) => {
            console.log(`[ISBNetService] (FileID ${fileId}): ISBNet process exited with code ${code}`);
            
            if (code === 0) {
                // Check if output file was created and is valid
                console.log(`[ISBNetService] (FileID ${fileId}): Checking for output file: ${outputFileAbsolutePath}`);
                
                if (!fs.existsSync(outputFileAbsolutePath) || fs.statSync(outputFileAbsolutePath).size === 0) {
                    // Restore backup
                    if (fs.existsSync(originalFileBackupPath)) {
                        try {
                            fs.renameSync(originalFileBackupPath, inputFileAbsolutePath);
                        } catch (e) {
                            console.error('Backup restore failed', e);
                        }
                    }
                    
                    try {
                        await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = 'ISBNet output file invalid' WHERE id = $1", [fileId]);
                    } catch (dbErr) {
                        console.error(`[ISBNetService] DB Error (FileID ${fileId}):`, dbErr);
                    }
                    
                    gpuManager.releaseGPU(fileId);
                    reject(new Error("[ISBNetService] Output file invalid or empty"));
                    return;
                }

                // Replace the original file with the instance segmented output
                try {
                    fs.renameSync(outputFileAbsolutePath, inputFileAbsolutePath);
                    console.log(`[ISBNetService] (FileID ${fileId}): Replaced original file with instance segmented output`);
                } catch (renameError) {
                    console.error(`[ISBNetService] (FileID ${fileId}): Error replacing file:`, renameError);
                    // Continue anyway, the output file exists
                }

                // Clean up backup
                if (fs.existsSync(originalFileBackupPath)) {
                    try {
                        fs.unlinkSync(originalFileBackupPath);
                    } catch (e) {
                        console.error('Backup delete failed', e);
                    }
                }

                // Update database status
                await pool.query("UPDATE uploaded_files SET status = 'instance_segmented_ready', processing_error = NULL WHERE id = $1", [fileId]);
                try {
                    setProgress(fileId, 100);
                } catch (_) { /* noop */ }

                console.log(`[ISBNetService] (FileID ${fileId}): Instance segmentation completed successfully`);
                gpuManager.releaseGPU(fileId);
                resolve({ 
                    success: true, 
                    message: "Instance segmentation successful.", 
                    stdout: isbnetStdout,
                    outputFile: inputFileAbsolutePath
                });

            } else {
                // Process failed
                const errMsg = `[ISBNetService] ISBNet process failed. Code: ${code}. Stderr: ${isbnetStderr.substring(0, 200)}`;
                
                // Restore backup
                if (fs.existsSync(originalFileBackupPath)) {
                    try {
                        fs.renameSync(originalFileBackupPath, inputFileAbsolutePath);
                    } catch (e) {
                        console.error('Backup restore failed', e);
                    }
                }
                
                try {
                    await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]);
                } catch (dbErr) {
                    console.error(`[ISBNetService] DB Error (FileID ${fileId}):`, dbErr);
                }
                
                try {
                    clearProgress(fileId);
                } catch (_) { /* noop */ }
                
                gpuManager.releaseGPU(fileId);
                reject(new Error(errMsg));
            }
        });
    });
}

module.exports = {
    runInstanceSegmentation
};
