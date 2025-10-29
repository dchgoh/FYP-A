// services/enhancedSegmentationService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db');
const { setProgress, clearProgress } = require('./progressStore');
const gpuManager = require('./gpuResourceManager');

async function runEnhancedSegmentation(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[EnhancedSegmentationService] (FileID ${fileId}): Starting for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'segmenting', processing_error = NULL WHERE id = $1", [fileId]);

    // Allocate GPU for this job
    const allocatedGpuId = await gpuManager.allocateGPU(fileId, 2000);
    const gpuArg = allocatedGpuId !== null ? allocatedGpuId.toString() : 'cpu';

    return new Promise((resolve, reject) => {
        // Set up paths for both semantic and instance segmentation
        const pythonVenvExecutable = process.platform === "win32"
            ? path.join(projectRootDir, 'venv', 'Scripts', 'python.exe')
            : path.join(projectRootDir, 'venv', 'bin', 'python');
        const pythonScript = 'run_inference_local_enhanced.py';
        const scriptPath = path.join(projectRootDir, pythonScript);
        
        // Set up checkpoint paths
        const semanticCheckpoint = path.join(projectRootDir, 'checkpoints', 'pointnet_sem_seg.pth');
        const instanceCheckpoint = path.join(projectRootDir, 'checkpoints', 'pointnet2_msg_best_model.pth');
        const instanceConfig = path.join(projectRootDir, 'configs', 'config_forinstance.yaml');
        let originalFileBackupPath = null;

        // Pre-checks
        // If on Windows, we will prefer running via WSL Python (CUDA-enabled) instead of the local venv
        const preferWSL = process.platform === 'win32';
        if (!preferWSL) {
            if (!fs.existsSync(pythonVenvExecutable)) {
                return reject(new Error(`Python venv executable not found: ${pythonVenvExecutable}`));
            }
        }
        if (!fs.existsSync(scriptPath)) {
            return reject(new Error(`Enhanced segmentation script not found: ${scriptPath}`));
        }
        if (!fs.existsSync(semanticCheckpoint)) {
            return reject(new Error(`Semantic checkpoint not found: ${semanticCheckpoint}`));
        }
        if (!fs.existsSync(instanceCheckpoint)) {
            return reject(new Error(`Instance checkpoint not found: ${instanceCheckpoint}`));
        }
        if (!fs.existsSync(instanceConfig)) {
            return reject(new Error(`Instance config not found: ${instanceConfig}`));
        }

        // Create backup of original file
        originalFileBackupPath = inputFileAbsolutePath + ".bak";
        try {
            fs.copyFileSync(inputFileAbsolutePath, originalFileBackupPath);
            console.log(`[EnhancedSegmentationService] (FileID ${fileId}): Created backup: ${originalFileBackupPath}`);
        } catch (copyError) {
            return reject(new Error(`Failed to create backup: ${copyError.message}`));
        }

        // Helper to map Windows path to WSL path
        function toWSLPath(winPath) {
            // e.g. C:\Users\... -> /mnt/c/Users/...
            const drive = winPath[0].toLowerCase();
            const rest = winPath.slice(2).replace(/\\/g, '/');
            return `/mnt/${drive}${rest}`;
        }

        // Set up arguments for the enhanced segmentation script
        const outputLasPath = inputFileAbsolutePath.replace('.las', '_processed.las');

        let segmentationProcess;
        console.log(`[EnhancedSegmentationService] (FileID ${fileId}): Spawning enhanced segmentation process...`);
        if (preferWSL) {
            // Use WSL conda env python if available; otherwise source conda and activate before running python
            const scriptWSL = toWSLPath(scriptPath);
            const inputWSL = toWSLPath(inputFileAbsolutePath);
            const outputWSL = toWSLPath(outputLasPath);
            const instCfgWSL = toWSLPath(instanceConfig);
            const instCkptWSL = toWSLPath(instanceCheckpoint);
            const semCkptWSL = toWSLPath(semanticCheckpoint);

            const wslCondaEnv = process.env.WSL_CONDA_ENV || 'isbnet_env';
            const wslPythonPath = process.env.WSL_PYTHON || ('/home/localadmin/miniconda3/envs/' + wslCondaEnv + '/bin/python');

            const pyArgs = [
                scriptWSL,
                inputWSL,
                outputWSL,
                instCfgWSL,
                instCkptWSL,
                '--sem_model', 'pointnet_sem_seg',
                '--sem_checkpoint', semCkptWSL,
                '--gpu', gpuArg,
                '--num_point_model', '1024',
                '--batch_size', '16'
            ].join(' ');

            const fullCmd = [
                'WSL_PY="' + wslPythonPath + '"; ',
                'if [ -x "$WSL_PY" ]; then ',
                '  "$WSL_PY" ' + pyArgs + '; ',
                'else ',
                '  (',
                '    source ~/miniconda3/etc/profile.d/conda.sh >/dev/null 2>&1 || ',
                '    source ~/.bashrc >/dev/null 2>&1 || ',
                '    source /opt/conda/etc/profile.d/conda.sh >/dev/null 2>&1 || true; ',
                '    if command -v conda >/dev/null 2>&1; then ',
                '      conda activate ' + wslCondaEnv + ' >/dev/null 2>&1 || true; ',
                '    fi; ',
                '    python3 ' + pyArgs + '; ',
                '  ); ',
                'fi'
            ].join('');

            segmentationProcess = spawn('wsl', ['-e', 'bash', '-lc', fullCmd], { cwd: projectRootDir });
        } else {
            const segmentArgs = [
                scriptPath,
                inputFileAbsolutePath,
                outputLasPath,
                instanceConfig,
                instanceCheckpoint,
                '--sem_model', 'pointnet_sem_seg',
                '--sem_checkpoint', semanticCheckpoint,
                '--gpu', gpuArg,
                '--num_point_model', '1024',
                '--batch_size', '16'
            ];
            segmentationProcess = spawn(pythonVenvExecutable, segmentArgs, { cwd: projectRootDir });
        }
        
        let segStdout = '', segStderr = '';
        
        segmentationProcess.stdout.on('data', (data) => {
            const output = data.toString();
            segStdout += output;
            process.stdout.write(`[EnhancedSegPy STDOUT FID ${fileId}] ${output}`);
            try {
                const match = output.match(/(\d{1,3})%/);
                if (match) {
                    const pct = parseInt(match[1], 10);
                    if (!isNaN(pct)) setProgress(fileId, pct);
                }
            } catch (_) { /* noop */ }
        });

        segmentationProcess.stderr.on('data', (data) => {
            const output = data.toString();
            segStderr += output;
            process.stderr.write(`[EnhancedSegPy STDERR FID ${fileId}] ${output}`);
        });

        segmentationProcess.on('error', async (error) => {
            console.error(`[EnhancedSegmentationService] Error (FileID ${fileId}): ${error.message}`);
            if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {
                    console.error('Backup restore failed', e);
                }
            }
            try {
                await pool.query(
                    "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                    [`Enhanced segmentation error: ${error.message.substring(0,200)}`, fileId]
                );
            } catch (dbErr) {
                console.error('Database update failed:', dbErr);
            }
            gpuManager.releaseGPU(fileId);
            reject(new Error(`Enhanced segmentation error: ${error.message}`));
        });

        segmentationProcess.on('close', async (code) => {
            console.log(`[EnhancedSegmentationService] (FileID ${fileId}): Process exited with code ${code}`);
            
            if (code === 0) {
                const outputPath = inputFileAbsolutePath.replace('.las', '_processed.las');
                
                if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                    const errMsg = 'Enhanced segmentation output file invalid or empty';
                    if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                        try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {
                            console.error('Backup restore failed', e);
                        }
                    }
                    try {
                        await pool.query(
                            "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                            [errMsg, fileId]
                        );
                    } catch (dbErr) {
                        console.error('Database update failed:', dbErr);
                    }
                    gpuManager.releaseGPU(fileId);
                    reject(new Error(errMsg));
                } else {
                    // Replace original file with processed file
                    try {
                        fs.renameSync(outputPath, inputFileAbsolutePath);
                        console.log(`[EnhancedSegmentationService] (FileID ${fileId}): Replaced original with processed file`);
                    } catch (renameError) {
                        console.error(`[EnhancedSegmentationService] (FileID ${fileId}): Error replacing file:`, renameError);
                    }

                    // Clean up backup
                    if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                        try { fs.unlinkSync(originalFileBackupPath); } catch (e) {
                            console.error('Backup delete failed', e);
                        }
                    }

                    // Update status
                    await pool.query(
                        "UPDATE uploaded_files SET status = 'enhanced_segmentation_complete', processing_error = NULL WHERE id = $1",
                        [fileId]
                    );
                    setProgress(fileId, 100);
                    gpuManager.releaseGPU(fileId);
                    resolve({
                        success: true,
                        message: "Enhanced segmentation completed successfully",
                        stdout: segStdout
                    });
                }
            } else {
                const errMsg = `Enhanced segmentation failed with code ${code}. Error: ${segStderr.substring(0,200)}`;
                if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                    try { fs.renameSync(originalFileBackupPath, inputFileAbsolutePath); } catch (e) {
                        console.error('Backup restore failed', e);
                    }
                }
                try {
                    await pool.query(
                        "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                        [errMsg, fileId]
                    );
                } catch (dbErr) {
                    console.error('Database update failed:', dbErr);
                }
                clearProgress(fileId);
                gpuManager.releaseGPU(fileId);
                reject(new Error(errMsg));
            }
        });
    });
}

module.exports = { runEnhancedSegmentation };