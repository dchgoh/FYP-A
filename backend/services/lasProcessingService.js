// services/lasProcessingService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db'); // Assuming shared DB config
// const potreeConversionService = require('./potreeConversionService'); // Uncomment if you auto-trigger Potree

async function processLasData (fileIdToUpdate, stored_path_absolute) {
    return new Promise(async (resolve, reject) => {
        const pythonScriptName = 'process_las.py'; // Assuming your Python script is named this
        // Correct path to python_scripts assuming services and python_scripts are sibling dirs in 'backend'
        const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName);
        const pythonCommand = 'python';

        if (!fs.existsSync(pythonScriptPath)) {
            const errMsg = `Python script not found at ${pythonScriptPath}. Cannot process file.`;
            console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${errMsg}`);
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Python script missing: ${pythonScriptName}`, fileIdToUpdate]);
            } catch (dbErr) { console.error(`[LAS Service] DB Error (FileID ${fileIdToUpdate}): Failed to update status after script missing error:`, dbErr); }
            return reject(new Error(errMsg));
        }

        console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Spawning LAS processing script "${pythonScriptPath}" with arg "${stored_path_absolute}"`);
        try {
             // Update status to 'processing_las_data' BEFORE spawning
            await pool.query(
                "UPDATE uploaded_files SET status = 'processing_las_data', processing_error = NULL WHERE id = $1",
                [fileIdToUpdate]
            );
            console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Status set to 'processing_las_data'.`);
        } catch (dbErr) {
            const errMsg = `[LAS Service] DB Error (FileID ${fileIdToUpdate}) setting status to 'processing_las_data': ${dbErr.message}`;
            console.error(errMsg);
            return reject(new Error(errMsg)); // Reject if initial status update fails
        }


        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, stored_path_absolute]);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => {
            const logMsg = data.toString().trim();
            if (logMsg) {
                stderrData += logMsg + '\n';
                console.log(`[Python stderr] (FileID ${fileIdToUpdate}): ${logMsg}`); // Changed from console.error to .log for Python's own logs
            }
        });

        pythonProcess.on('error', async (spawnError) => {
            const errMsg = `Failed to start LAS processing Python process. Cmd: ${pythonCommand}. Err: ${spawnError.message}`;
            console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${errMsg}`);
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg.substring(0,250), fileIdToUpdate]);
            } catch (dbErr) { console.error(`[LAS Service] DB Error (FileID ${fileIdToUpdate}): Failed to update status after spawn error:`, dbErr); }
            reject(new Error(errMsg)); // Ensure promise is rejected
        });

        pythonProcess.on('close', async (code) => {
            console.log(`[LAS Service] (FileID ${fileIdToUpdate}): LAS processing script (${pythonScriptName}) exited with code ${code}.`);
            console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Raw stdout:\n---\n${stdoutData}\n---`);
            if(stderrData) console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Accumulated stderr:\n---\n${stderrData}\n---`);


            let updateQueryText = '';
            let queryParams = [];
            let finalStatus = 'failed'; // Default to failed
            let processingErrorMsgForDb = `LAS Python script exited with code ${code}.`;
            let processingSuccess = false;

            if (code === 0 && stdoutData.trim()) {
                try {
                    const resultData = JSON.parse(stdoutData.trim());
                    console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Parsed JSON from Python:`, JSON.stringify(resultData, null, 2));

                    // Check for functional error reported by Python script in its JSON output
                    if (resultData.error) {
                        processingErrorMsgForDb = `Python script error: ${resultData.error}`;
                        console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${processingErrorMsgForDb}`);
                        // finalStatus remains 'failed'
                    } else {
                        const calculatedLat = resultData.latitude !== undefined ? resultData.latitude : null;
                        const calculatedLon = resultData.longitude !== undefined ? resultData.longitude : null;
                        const midpointsWGS84 = resultData.tree_midpoints_wgs84 !== undefined ? resultData.tree_midpoints_wgs84 : null;
                        // --- GET TREE COUNT ---
                        const treeCount = (resultData.num_trees !== null && resultData.num_trees !== undefined)
                                        ? parseInt(resultData.num_trees, 10)
                                        : 0;
                        if (isNaN(treeCount)) {
                             console.warn(`[LAS Service] (FileID ${fileIdToUpdate}): num_trees from Python was NaN after parsing. Defaulting to 0. Raw: ${resultData.num_trees}`);
                             resultData.num_trees = 0; // Correct for DB
                        } else {
                            resultData.num_trees = treeCount; // Ensure it's the parsed integer
                        }
                        // --------------------

                        const pythonWarnings = resultData.warnings || [];
                        const pythonErrorsInJson = resultData.errors || []; // Errors reported within the JSON structure

                        if (pythonWarnings.length > 0) console.warn(`[LAS Service] Warn (FileID ${fileIdToUpdate}): Python reported warnings:`, pythonWarnings);
                        if (pythonErrorsInJson.length > 0) console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): Python reported errors in JSON:`, pythonErrorsInJson);


                        const midpointsJsonString = midpointsWGS84 ? JSON.stringify(midpointsWGS84) : null;

                        if (pythonErrorsInJson.length > 0) {
                            finalStatus = 'processed_with_errors'; // Or 'failed' depending on severity
                            processingErrorMsgForDb = `Python processing completed with errors: ${pythonErrorsInJson.join('; ').substring(0,200)}`;
                        } else {
                            finalStatus = 'processed_ready_for_potree'; // Assuming Potree is the next automatic step
                            processingErrorMsgForDb = null; // Clear previous errors on success
                            processingSuccess = true;
                        }

                        // --- UPDATE QUERY WITH tree_count ---
                        updateQueryText = `
                            UPDATE uploaded_files SET
                                latitude = $1,
                                longitude = $2,
                                tree_midpoints = $3,
                                tree_count = $4, -- <<<< ADDED tree_count HERE
                                status = $5,
                                processing_error = $6
                            WHERE id = $7`;
                        queryParams = [
                            calculatedLat,
                            calculatedLon,
                            midpointsJsonString,
                            resultData.num_trees, // Pass the tree_count
                            finalStatus,
                            processingErrorMsgForDb,
                            fileIdToUpdate
                        ];
                        // ------------------------------------
                        if (processingSuccess) {
                            resolve(resultData); // Resolve the promise with parsed data on success
                        } else {
                            reject(new Error(processingErrorMsgForDb || "LAS processing completed with errors reported by Python script."));
                        }
                    }
                } catch (parseError) {
                    processingErrorMsgForDb = `Failed to parse LAS Python JSON: ${parseError.message.substring(0,150)}`;
                    console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${processingErrorMsgForDb}\nRaw stdout: >>>${stdoutData.substring(0,300)}<<<`);
                    finalStatus = 'failed'; // Ensure status is failed
                    // updateQueryText and queryParams will be set in the 'else' block below if code was 0 but parsing failed
                    reject(new Error(processingErrorMsgForDb)); // Reject promise
                }
            }

            // This 'else' block handles:
            // 1. Python script exit code was non-zero.
            // 2. Python script exit code was 0, BUT stdoutData was empty (no JSON to parse).
            // 3. Python script exit code was 0, stdoutData was present, BUT JSON parsing failed (caught above, now we build the DB update).
            if (!updateQueryText) { // If not already set by successful parse block
                if (code !== 0) {
                    processingErrorMsgForDb = `LAS Python script failed (code ${code}). Stderr: ${stderrData.substring(0, 200)}...`;
                } else if (!stdoutData.trim()) { // code === 0 but no output
                    processingErrorMsgForDb = `LAS Python script (code 0) produced no JSON output. Check Python stderr.`;
                } else { // code === 0, output present, but parseError happened
                     // processingErrorMsgForDb is already set from the catch (parseError) block
                }
                console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): Setting status to failed. Reason: ${processingErrorMsgForDb}`);
                finalStatus = 'failed';
                updateQueryText = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                queryParams = [finalStatus, processingErrorMsgForDb.substring(0,250), fileIdToUpdate];
                if (!processingSuccess) reject(new Error(processingErrorMsgForDb)); // Ensure promise is rejected if not already
            }


            if (updateQueryText) {
                let clientForUpdate; // Use a separate client variable for this scope
                try {
                    clientForUpdate = await pool.connect();
                    const updateResult = await clientForUpdate.query(updateQueryText, queryParams);
                    if (updateResult.rowCount > 0) {
                        console.log(`[LAS Service] (FileID ${fileIdToUpdate}): DB status/data update after LAS processing successful (New Status: ${finalStatus}).`);
                    } else {
                        console.warn(`[LAS Service] Warn (FileID ${fileIdToUpdate}): DB status/data update for LAS processing affected 0 rows. This might indicate the file ID was already deleted or an issue.`);
                    }
                } catch (dbError) {
                    console.error(`[LAS Service] DB Error (FileID ${fileIdToUpdate}): Error updating DB after LAS Python script:`, dbError);
                    if (!processingSuccess) reject(new Error(`DB update failed after LAS processing error: ${dbError.message}`)); // Reject if not already resolved
                    else resolve({success: false, message: "LAS processed but DB update failed", error: dbError.message, fileId: fileIdToUpdate }); // Resolve with error if main processing was "ok"
                } finally {
                    if (clientForUpdate) clientForUpdate.release();
                }
            }
        });
    });
}

module.exports = { processLasData };