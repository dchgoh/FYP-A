const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db'); // Assuming shared DB config

async function processLasData (fileIdToUpdate, stored_path_absolute) { // stored_path_absolute is now the segmented file
    return new Promise(async (resolve, reject) => { // Make it async to use await for DB updates
        const pythonScriptName = 'process_las.py';
        const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName);
        const pythonCommand = 'python'; // Or 'python3'

        if (!fs.existsSync(pythonScriptPath)) {
            const errMsg = `Python script not found at ${pythonScriptPath}. Cannot process file.`;
            console.error(`Node Error (FileID ${fileIdToUpdate}): ${errMsg}`);
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Python script not found: ${pythonScriptName}`, fileIdToUpdate]);
            } catch (dbErr) { console.error(`Node DB Error (FileID ${fileIdToUpdate}): Failed to update status after script missing error:`, dbErr); }
            return reject(new Error(errMsg));
        }

        console.log(`Node (FileID ${fileIdToUpdate}): Spawning LAS processing script "${pythonScriptPath}" with arg "${stored_path_absolute}"`);
        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, stored_path_absolute]);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString().trim();
            if (errorMsg) {
                stderrData += errorMsg + '\n';
                console.error(`Python stderr (LAS Process - FileID ${fileIdToUpdate}): ${errorMsg}`);
            }
        });

        pythonProcess.on('error', async (error) => {
            const errMsg = `Failed to start LAS processing Python process. Cmd: ${pythonCommand}. Err: ${error.message}`;
            console.error(`Node Error (FileID ${fileIdToUpdate}): ${errMsg}`);
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg, fileIdToUpdate]);
            } catch (dbErr) { console.error(`Node DB Error (FileID ${fileIdToUpdate}): Failed to update status after spawn error:`, dbErr); }
            reject(new Error(errMsg));
        });

        pythonProcess.on('close', async (code) => {
            console.log(`Node (FileID ${fileIdToUpdate}): LAS processing script (${pythonScriptName}) exited with code ${code}.`);

            let updateQuery = '';
            let queryParams = [];
            let finalStatus = 'failed';
            let processingErrorMsg = `LAS processing Python script exited with code ${code}. Stderr: ${stderrData.substring(0, 200)}`;

            if (code === 0 && stdoutData) {
                try {
                    const resultData = JSON.parse(stdoutData.trim());
                    console.log(`Node (FileID ${fileIdToUpdate}): Received and parsed JSON from LAS processing Python.`);

                    const calculatedLat = resultData.latitude !== undefined ? resultData.latitude : null;
                    const calculatedLon = resultData.longitude !== undefined ? resultData.longitude : null;
                    const midpointsWGS84 = resultData.tree_midpoints_wgs84 !== undefined ? resultData.tree_midpoints_wgs84 : null;
                    const pythonWarnings = resultData.warnings || [];
                    const pythonErrors = resultData.errors || [];

                    if (pythonWarnings.length > 0) console.warn(`Node Warn (FileID ${fileIdToUpdate}): LAS Py reported warnings:`, pythonWarnings);
                    if (pythonErrors.length > 0) console.error(`Node Error (FileID ${fileIdToUpdate}): LAS Py reported errors:`, pythonErrors);

                    if (midpointsWGS84 && typeof midpointsWGS84 === 'object' && Object.keys(midpointsWGS84).length > 0) {
                        // console.info(`--- Calculated Tree Midpoints (WGS84 Lon/Lat) for File ID: ${fileIdToUpdate} ---`);
                        // ... (logging logic for midpoints) ...
                    } else {
                        console.info(`Node (FileID ${fileIdToUpdate}): No tree midpoints were calculated by LAS processing Python.`);
                    }

                    const midpointsJsonString = midpointsWGS84 ? JSON.stringify(midpointsWGS84) : null;

                    if (pythonErrors.length > 0) {
                        finalStatus = 'processed_with_errors';
                        processingErrorMsg = `LAS processing Python completed with errors: ${pythonErrors.join('; ')}`;
                    } else {
                        finalStatus = 'processed'; // Or 'ready_for_potree' if Potree is next
                        processingErrorMsg = null;
                    }

                    updateQuery = `UPDATE uploaded_files SET latitude = $1, longitude = $2, tree_midpoints = $3, status = $4, processing_error = $5 WHERE id = $6`;
                    queryParams = [calculatedLat, calculatedLon, midpointsJsonString, finalStatus, processingErrorMsg, fileIdToUpdate];
                    resolve(resultData); // Resolve the promise with parsed data

                } catch (parseError) {
                    console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing LAS Python JSON: ${parseError}\nRaw stdout: >>>${stdoutData}<<<`);
                    processingErrorMsg = `Failed to parse LAS Python output: ${parseError.message}`;
                    finalStatus = 'failed';
                    updateQuery = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                    queryParams = [finalStatus, processingErrorMsg, fileIdToUpdate];
                    reject(new Error(processingErrorMsg));
                }
            } else {
                if (code !== 0) {
                    processingErrorMsg = `LAS Python script failed (code ${code}). Stderr: ${stderrData.substring(0, 500)}...`;
                    console.error(`Node Error (FileID ${fileIdToUpdate}): ${processingErrorMsg}`);
                } else {
                    processingErrorMsg = `LAS Python script finished (code 0) but produced no JSON output.`;
                    console.warn(`Node Warn (FileID ${fileIdToUpdate}): ${processingErrorMsg}`);
                }
                finalStatus = 'failed';
                updateQuery = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                queryParams = [finalStatus, processingErrorMsg, fileIdToUpdate];
                reject(new Error(processingErrorMsg));
            }

            if (updateQuery) {
                try {
                    const updateResult = await pool.query(updateQuery, queryParams);
                    if (updateResult.rowCount > 0) {
                        console.log(`Node (FileID ${fileIdToUpdate}): DB status/data update after LAS processing successful (Status: ${finalStatus}).`);
                    } else {
                        console.warn(`Node Warn (FileID ${fileIdToUpdate}): DB status/data update for LAS processing affected 0 rows.`);
                    }
                } catch (dbError) {
                    console.error(`Node DB Error (FileID ${fileIdToUpdate}): Error updating status/data after LAS Python script:`, dbError);
                    // If the DB update itself fails, the promise might have already been rejected/resolved,
                    // but this logs the secondary failure.
                }
            }
        });
    });
}

module.exports = { processLasData };