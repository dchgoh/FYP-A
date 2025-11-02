// src/services/segmentationService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db'); // Assuming shared DB config
const { setProgress, clearProgress } = require('./progressStore');
const gpuManager = require('./gpuResourceManager');

async function runISBNetInference(inputLas, outputLas, configPath, checkpointPath, projectRootDir) {
    return new Promise((resolve, reject) => {
        // Helper to convert Windows path to WSL path
        function toWSLPath(winPath) {
            if (typeof winPath !== 'string') return winPath;
            if (winPath.startsWith('/mnt/')) return winPath; // Already WSL path
            const drive = winPath[0].toLowerCase();
            const rest = winPath.slice(2).replace(/\\/g, '/');
            return `/mnt/${drive}${rest}`;
        }

        // Convert all paths to WSL paths
        const inputWSL = toWSLPath(inputLas);
        const outputWSL = toWSLPath(outputLas);
        const configWSL = toWSLPath(configPath);
        const checkpointWSL = toWSLPath(checkpointPath);
        const projectWSL = toWSLPath(projectRootDir);

        const wslCondaEnv = process.env.WSL_CONDA_ENV || 'isbnet_env';
        const wslPythonPath = process.env.WSL_PYTHON || ('/home/localadmin/miniconda3/envs/' + wslCondaEnv + '/bin/python');

        const pyArgs = [
            'run_inference_local.py',
            inputWSL,
            outputWSL,
            configWSL,
            checkpointWSL
        ].join(' ');

        const fullCmd = [
            'cd "' + projectWSL + '" && ',
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

        console.log(`[ISBNet] Running inference in WSL...`);

        const isbnetProcess = spawn('wsl', ['-e', 'bash', '-lc', fullCmd], { stdio: 'pipe' });
        let stdout = "", stderr = "";

        isbnetProcess.stdout.on("data", (data) => {
            const msg = data.toString();
            stdout += msg;
            process.stdout.write(`[ISBNet STDOUT] ${msg}`);
        });

        isbnetProcess.stderr.on("data", (data) => {
            const msg = data.toString();
            stderr += msg;
            process.stderr.write(`[ISBNet STDERR] ${msg}`);
        });

        isbnetProcess.on("close", (code) => {
            if (code === 0) {
                console.log("[ISBNet] Inference completed successfully.");
                resolve({ success: true, stdout });
            } else {
                console.error(`[ISBNet] Inference failed with code ${code}`);
                reject(new Error(`ISBNet failed: ${stderr}`));
            }
        });
    });
}

// Track active segmentation processes
const activeProcesses = new Map();

async function runSegmentation(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[SegmentationService] (FileID ${fileId}): Starting for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'segmenting', processing_error = NULL WHERE id = $1", [fileId]);

    // Allocate GPU for this job
    const allocatedGpuId = await gpuManager.allocateGPU(fileId, 2000); // Request 2GB GPU memory
    const gpuArg = allocatedGpuId !== null ? allocatedGpuId.toString() : 'cpu';

    return new Promise(async (resolve, reject) => {
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

        // Pre-checks
        if (!fs.existsSync(checkpointAbsolutePathForCheck))
            return reject(new Error(`[SegmentationService] Checkpoint file not found: ${checkpointAbsolutePathForCheck}`));

        originalFileBackupPath = inputFileAbsolutePath + ".bak";
        try {
            fs.copyFileSync(inputFileAbsolutePath, originalFileBackupPath);
            console.log(`[SegmentationService] (FileID ${fileId}): Created backup: ${originalFileBackupPath}`);
        } catch (copyError) {
            return reject(new Error(`[SegmentationService] Failed to create backup: ${copyError.message}`));
        }

        // ---------- 🧠 STEP 1: Run ISBNet FIRST ----------
        try {
            console.log(`[SegmentationService] (FileID ${fileId}): Running ISBNet inference FIRST.`);

            const inputLas = inputFileAbsolutePath;
            const outputLas = inputFileAbsolutePath;
            const configPath = path.join(projectRootDir, 'configs', 'config_forinstance.yaml');
            const checkpointPath = path.join(projectRootDir, 'configs', 'best.pth');

            const isbnetResult = await runISBNetInference(
                inputLas,
                outputLas,
                configPath,
                checkpointPath,
                projectRootDir
            );

            console.log(`[SegmentationService] (FileID ${fileId}): ISBNet completed successfully.`);
            await pool.query("UPDATE uploaded_files SET status = 'isbnet_completed', processing_error = NULL WHERE id = $1", [fileId]);
        } catch (isbErr) {
            console.error(`[SegmentationService] (FileID ${fileId}): ISBNet failed:`, isbErr);
            gpuManager.releaseGPU(fileId);
            return reject(new Error(`[SegmentationService] ISBNet failed first: ${isbErr.message}`));
        }

        // ---------- 🧩 STEP 2: Run Semantic Segmentation (PointNet++) ----------
        try {
            console.log(`[SegmentationService] (FileID ${fileId}): Running Semantic Segmentation next.`);

            // Helper to map Windows path to WSL path
            function toWSLPath(winPath) {
                const drive = winPath[0].toLowerCase();
                const rest = winPath.slice(2).replace(/\\/g, '/');
                return `/mnt/${drive}${rest}`;
            }

            let segmentationProcess;
            const preferWSL = process.platform === 'win32';
            if (preferWSL) {
                const scriptWSL = toWSLPath(pythonSegmentScriptToExecute);
                const inputWSL = toWSLPath(inputFileAbsolutePath);
                const outputDirWSL = toWSLPath(path.dirname(inputFileAbsolutePath));
                const checkpointWSL = toWSLPath(checkpointAbsolutePathForCheck);

                const wslCondaEnv = process.env.WSL_CONDA_ENV || 'isbnet_env';
                const wslPythonPath = process.env.WSL_PYTHON || ('/home/localadmin/miniconda3/envs/' + wslCondaEnv + '/bin/python');

                const pyArgs = [
                    scriptWSL,
                    '--model', modelNameForScript,
                    '--checkpoint_path', checkpointWSL,
                    '--input_file', inputWSL,
                    '--output_dir', outputDirWSL,
                    '--num_point_model', '1024',
                    '--num_features', '6',
                    '--batch_size_inference', '16',
                    '--stride_ratio', '0.5',
                    '--output_format', 'las',
                    '--gpu', gpuArg
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

                console.log(`[SegmentationService] (FileID ${fileId}): Spawning WSL segmentation process...`);
                segmentationProcess = spawn('wsl', ['-e', 'bash', '-lc', fullCmd], { cwd: projectRootDir, stdio: 'pipe' });
            } else {
                segmentationProcess = spawn(pythonVenvExecutable, [
                    pythonSegmentScriptToExecute, '--model', modelNameForScript,
                    '--checkpoint_path', checkpointRelativePath,
                    '--input_file', inputFileAbsolutePath,
                    '--output_dir', path.dirname(inputFileAbsolutePath),
                    '--num_point_model', '1024', '--num_features', '6',
                    '--batch_size_inference', '16',
                    '--stride_ratio', '0.5',
                    '--output_format', 'las',
                    '--gpu', gpuArg,
                ], { cwd: projectRootDir, stdio: 'pipe' });
            }

            let segStdout = '', segStderr = '';
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
                const match = output.match(/(\d{1,3})%/);
                if (match) setProgress(fileId, parseInt(match[1], 10));
            });

            segmentationProcess.stderr.on('data', (data) => {
                const output = data.toString();
                segStderr += output;
                process.stderr.write(`[SegPy STDERR FID ${fileId}] ${output}`);
            });

            segmentationProcess.on('close', async (code) => {
                activeProcesses.delete(fileId);
                if (code === 0) {
                    console.log(`[SegmentationService] (FileID ${fileId}): Semantic segmentation completed successfully.`);
                    await pool.query("UPDATE uploaded_files SET status = 'segmentation_completed', processing_error = NULL WHERE id = $1", [fileId]);
                    gpuManager.releaseGPU(fileId);
                    resolve({ success: true, message: "ISBNet + Semantic segmentation completed.", stdout: segStdout });
                } else {
                    const errMsg = `[SegmentationService] Semantic segmentation failed (code ${code}): ${segStderr}`;
                    console.error(errMsg);
                    gpuManager.releaseGPU(fileId);
                    reject(new Error(errMsg));
                }
            });
        } catch (segErr) {
            gpuManager.releaseGPU(fileId);
            reject(new Error(`[SegmentationService] Semantic segmentation error: ${segErr.message}`));
        }
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

