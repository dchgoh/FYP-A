// src/services/lasProcessingService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db');
const potreeConversionService = require('./potreeConversionService'); // Will call this

async function processLasData(fileId, inputFileAbsolutePath, projectRootDir) {
    console.log(`[LasProcessingService] (FileID ${fileId}): Starting for ${inputFileAbsolutePath}`);
    await pool.query("UPDATE uploaded_files SET status = 'processing_las_data', processing_error = NULL WHERE id = $1", [fileId]);

    return new Promise(async (resolve, reject) => {
        const pythonScriptName = 'process_las.py';
        const pythonScriptPath = path.join(projectRootDir, pythonScriptName);
        const pythonCommand = 'python';

        if (!fs.existsSync(pythonScriptPath)) {
            const errMsg = `[LasProcessingService] Script not found: ${pythonScriptPath}.`;
            try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]); } catch (dbErr) {/* log */}
            return reject(new Error(errMsg));
        }

        console.log(`[LasProcessingService] (FileID ${fileId}): Spawning: "${pythonCommand}" "${pythonScriptPath}" "${inputFileAbsolutePath}"`);
        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, inputFileAbsolutePath], { cwd: projectRootDir });
        let stdoutData = '', stderrData = '';
        pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { const m = data.toString().trim(); if (m) { stderrData += m + '\n'; console.error(`[LASPy STDERR FID ${fileId}]: ${m}`); } });

        pythonProcess.on('error', async (error) => {
            const errMsg = `[LasProcessingService] Failed to start Python process: ${error.message}`;
            try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]); } catch (dbErr) {/* log */}
            reject(new Error(errMsg));
        });

        pythonProcess.on('close', async (code) => {
            console.log(`[LasProcessingService] (FileID ${fileId}): Script exited with code ${code}.`);
            if (code === 0 && stdoutData) {
                try {
                    const resultData = JSON.parse(stdoutData.trim());
                    const { latitude, longitude, tree_midpoints_wgs84, errors = [] } = resultData;
                    const midpointsJsonString = tree_midpoints_wgs84 ? JSON.stringify(tree_midpoints_wgs84) : null;
                    let nextStatus = 'processed_ready_for_potree';
                    let processingErrorMsg = null;

                    if (errors.length > 0) {
                        processingErrorMsg = `[LasProcessingService] LAS Py reported errors: ${errors.join('; ')}`;
                        // If LAS errors mean we shouldn't proceed to Potree:
                        nextStatus = 'failed';
                        console.warn(`[LasProcessingService] (FileID ${fileId}): Errors from Python, setting status to failed: ${processingErrorMsg}`);
                    }
                    
                    await pool.query(
                        `UPDATE uploaded_files SET latitude = $1, longitude = $2, tree_midpoints = $3, status = $4, processing_error = $5 WHERE id = $6`,
                        [latitude, longitude, midpointsJsonString, nextStatus, processingErrorMsg, fileId]
                    );
                    console.log(`[LasProcessingService] (FileID ${fileId}): DB update. Status: ${nextStatus}.`);

                    if (nextStatus === 'processed_ready_for_potree') {
                        const lcFileName = path.basename(inputFileAbsolutePath).toLowerCase();
                        if (lcFileName.endsWith('.las') || lcFileName.endsWith('.laz')) {
                            console.log(`[LasProcessingService] (FileID ${fileId}): Auto-initiating Potree.`);
                            // Potree service will set 'converting_potree'
                            potreeConversionService.initiatePotree(fileId, inputFileAbsolutePath, projectRootDir)
                                .then(potreeResult => console.log(`[LasProcessingService] (FileID ${fileId}): Auto Potree call successful:`, potreeResult.message))
                                .catch(potreeError => {
                                     console.error(`[LasProcessingService] Error (FileID ${fileId}): Auto Potree call failed: ${potreeError.message}`);
                                     // potreeConversionService should handle its own failure status update
                                 });
                        } else {
                             await pool.query("UPDATE uploaded_files SET status = 'processed' WHERE id = $1", [fileId]); // Final if not convertible
                             console.log(`[LasProcessingService] (FileID ${fileId}): ${lcFileName} not LAS/LAZ, status 'processed'.`);
                        }
                    }
                    resolve({ success: true, data: resultData });

                } catch (parseOrDbErr) {
                    const errMsg = `[LasProcessingService] Error post-LAS Py: ${parseOrDbErr.message.substring(0,200)}`;
                    try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]); } catch (dbErr) {/* log */}
                    reject(new Error(errMsg));
                }
            } else { // Python script failed or no output
                const errMsg = `[LasProcessingService] LAS Python script error. Code: ${code}. Stderr: ${stderrData.substring(0, 200)}`;
                try { await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileId]); } catch (dbErr) {/* log */}
                reject(new Error(errMsg));
            }
        });
    });
}

module.exports = { processLasData };