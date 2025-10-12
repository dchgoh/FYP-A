// services/lasProcessingService.js
const fs = require('fs');
const path = require('path');
const { spawn } = require("child_process");
const { pool } = require('../config/db'); // Assuming shared DB config

async function processLasData (fileIdToUpdate, stored_path_absolute) {
    return new Promise(async (resolve, reject) => {
        const pythonScriptName = 'process_las.py';
        const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName);
        const pythonCommand = path.resolve(__dirname, '..', 'venv', 'Scripts', 'python.exe');

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
            await pool.query(
                "UPDATE uploaded_files SET status = 'processing_las_data', processing_error = NULL WHERE id = $1",
                [fileIdToUpdate]
            );
            console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Status set to 'processing_las_data'.`);
        } catch (dbErr) {
            const errMsg = `[LAS Service] DB Error (FileID ${fileIdToUpdate}) setting status to 'processing_las_data': ${dbErr.message}`;
            console.error(errMsg);
            return reject(new Error(errMsg));
        }

        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, stored_path_absolute]);

        let stdoutData = '';
        let stderrData = '';

        pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => {
            const logMsg = data.toString().trim();
            if (logMsg) {
                stderrData += logMsg + '\n';
                console.log(`[Python stderr] (FileID ${fileIdToUpdate}): ${logMsg}`);
            }
        });

        pythonProcess.on('error', async (spawnError) => {
            const errMsg = `Failed to start LAS processing Python process. Cmd: ${pythonCommand}. Err: ${spawnError.message}`;
            console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${errMsg}`);
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [errMsg.substring(0,250), fileIdToUpdate]);
            } catch (dbErr) { console.error(`[LAS Service] DB Error (FileID ${fileIdToUpdate}): Failed to update status after spawn error:`, dbErr); }
            reject(new Error(errMsg));
        });

        pythonProcess.on('close', async (code) => {
            console.log(`[LAS Service] (FileID ${fileIdToUpdate}): LAS processing script (${pythonScriptName}) exited with code ${code}.`);
            if (stdoutData.trim()) console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Raw stdout:\n---\n${stdoutData.trim()}\n---`);
            if (stderrData.trim()) console.log(`[LAS Service] (FileID ${fileIdToUpdate}): Accumulated stderr:\n---\n${stderrData.trim()}\n---`);

            let updateQueryText = '';
            let queryParams = [];
            let finalStatus = 'failed';
            let processingErrorMsgForDb = `LAS Python script exited with code ${code}.`;
            let processingSuccess = false;
            let pythonResultData = null;

            if (code === 0 && stdoutData.trim()) {
                try {
                    pythonResultData = JSON.parse(stdoutData.trim());

                    if (pythonResultData.error) {
                        processingErrorMsgForDb = `Python script error: ${pythonResultData.error}`;
                        console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${processingErrorMsgForDb}`);
                    } else {
                        // --- Existing fields ---
                        const calculatedLat = pythonResultData.latitude !== undefined ? pythonResultData.latitude : null;
                        const calculatedLon = pythonResultData.longitude !== undefined ? pythonResultData.longitude : null;
                        const midpointsWGS84 = pythonResultData.tree_midpoints_wgs84 !== undefined ? pythonResultData.tree_midpoints_wgs84 : null;
                        let treeCount = (pythonResultData.num_trees !== null && pythonResultData.num_trees !== undefined)
                                        ? parseInt(pythonResultData.num_trees, 10) : 0;
                        if (isNaN(treeCount)) {
                             console.warn(`[LAS Service] (FileID ${fileIdToUpdate}): num_trees was NaN, defaulting to 0. Raw: ${pythonResultData.num_trees}`);
                             treeCount = 0;
                        }
                        const segmentLengthsLM = pythonResultData.tree_segment_lengths_L_m !== undefined ? pythonResultData.tree_segment_lengths_L_m : null;
                        const treeDbhsD1Cm = pythonResultData.tree_dbhs_d1_cm !== undefined ? pythonResultData.tree_dbhs_d1_cm : null;
                        const assumedD2Cm = pythonResultData.assumed_d2_cm_for_volume !== undefined ? pythonResultData.assumed_d2_cm_for_volume : null;

                        // --- NEW FIELDS from Python output based on your table ---
                        const treeStemVolumesM3 = pythonResultData.tree_stem_volumes_m3 !== undefined ? pythonResultData.tree_stem_volumes_m3 : null;
                        const treeAboveGroundVolumesM3 = pythonResultData.tree_above_ground_volumes_m3 !== undefined ? pythonResultData.tree_above_ground_volumes_m3 : null;
                        const treeTotalVolumesM3 = pythonResultData.tree_total_volumes_m3 !== undefined ? pythonResultData.tree_total_volumes_m3 : null;
                        const treeBiomassTonnes = pythonResultData.tree_biomass_tonnes !== undefined ? pythonResultData.tree_biomass_tonnes : null;
                        const treeCarbonTonnes = pythonResultData.tree_carbon_tonnes !== undefined ? pythonResultData.tree_carbon_tonnes : null;
                        const treeCo2EquivalentTonnes = pythonResultData.tree_co2_equivalent_tonnes !== undefined ? pythonResultData.tree_co2_equivalent_tonnes : null;
                        // ----------------------------------------------------------

                        // --- Stringify JSONB fields ---
                        const midpointsJsonString = midpointsWGS84 ? JSON.stringify(midpointsWGS84) : null;
                        const segmentLengthsJsonString = segmentLengthsLM ? JSON.stringify(segmentLengthsLM) : null;
                        const treeDbhsD1CmJsonString = treeDbhsD1Cm ? JSON.stringify(treeDbhsD1Cm) : null;

                        // --- Stringify NEW JSONB fields ---
                        const treeStemVolumesM3JsonString = treeStemVolumesM3 ? JSON.stringify(treeStemVolumesM3) : null;
                        const treeAboveGroundVolumesM3JsonString = treeAboveGroundVolumesM3 ? JSON.stringify(treeAboveGroundVolumesM3) : null;
                        const treeTotalVolumesM3JsonString = treeTotalVolumesM3 ? JSON.stringify(treeTotalVolumesM3) : null;
                        const treeBiomassTonnesJsonString = treeBiomassTonnes ? JSON.stringify(treeBiomassTonnes) : null;
                        const treeCarbonTonnesJsonString = treeCarbonTonnes ? JSON.stringify(treeCarbonTonnes) : null;
                        const treeCo2EquivalentTonnesJsonString = treeCo2EquivalentTonnes ? JSON.stringify(treeCo2EquivalentTonnes) : null;
                        // -----------------------------------

                        const pythonErrorsInJson = pythonResultData.errors || [];
                        if (pythonErrorsInJson.length > 0) {
                             console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): Python reported errors in JSON:`, pythonErrorsInJson);
                             finalStatus = 'processed_with_errors';
                             processingErrorMsgForDb = `Python processing completed with errors: ${pythonErrorsInJson.join('; ').substring(0,200)}`;
                        } else {
                             finalStatus = 'processed_ready_for_potree'; // Or your desired success status
                             processingErrorMsgForDb = null;
                             processingSuccess = true;
                        }

                        // --- UPDATE QUERY WITH ALL NEW FIELDS ---
                        updateQueryText = `
                            UPDATE uploaded_files SET
                                latitude = $1,
                                longitude = $2,
                                tree_midpoints = $3,
                                tree_count = $4,
                                tree_heights_adjusted = $5,
                                tree_dbhs_cm = $6,
                                assumed_d2_cm_for_volume = $7,
                                tree_stem_volumes_m3 = $8,        -- New
                                tree_above_ground_volumes_m3 = $9, -- New
                                tree_total_volumes_m3 = $10,      -- New
                                tree_biomass_tonnes = $11,        -- New
                                tree_carbon_tonnes = $12,         -- New
                                tree_co2_equivalent_tonnes = $13, -- New
                                status = $14,
                                processing_error = $15
                            WHERE id = $16`;
                        queryParams = [
                            calculatedLat,                  // $1
                            calculatedLon,                  // $2
                            midpointsJsonString,            // $3
                            treeCount,                      // $4
                            segmentLengthsJsonString,       // $5
                            treeDbhsD1CmJsonString,         // $6
                            assumedD2Cm,                    // $7
                            treeStemVolumesM3JsonString,    // $8
                            treeAboveGroundVolumesM3JsonString, // $9
                            treeTotalVolumesM3JsonString,   // $10
                            treeBiomassTonnesJsonString,    // $11
                            treeCarbonTonnesJsonString,     // $12
                            treeCo2EquivalentTonnesJsonString, // $13
                            finalStatus,                    // $14
                            processingErrorMsgForDb,        // $15
                            fileIdToUpdate                  // $16
                        ];
                        // -----------------------------------------------------------
                    }
                } catch (parseError) {
                    processingErrorMsgForDb = `Failed to parse LAS Python JSON: ${parseError.message.substring(0,150)}`;
                    console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): ${processingErrorMsgForDb}. Raw stdout was: >>>${stdoutData.substring(0,300)}<<<`);
                }
            }

            if (!updateQueryText) { // Fallback if parsing failed or script error
                if (code !== 0) {
                    processingErrorMsgForDb = `LAS Python script failed (code ${code}). Stderr: ${stderrData.substring(0, 200)}...`;
                } else if (!stdoutData.trim() && code === 0) {
                    processingErrorMsgForDb = `LAS Python script (code 0) produced no JSON output. Check Python logs via stderr.`;
                }
                console.error(`[LAS Service] Error (FileID ${fileIdToUpdate}): Defaulting to failure update. Reason: ${processingErrorMsgForDb}`);
                finalStatus = 'failed';
                updateQueryText = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                queryParams = [finalStatus, processingErrorMsgForDb.substring(0,250), fileIdToUpdate];
            }

            if (updateQueryText) {
                let clientForFinalUpdate;
                try {
                    clientForFinalUpdate = await pool.connect();
                    const updateResult = await clientForFinalUpdate.query(updateQueryText, queryParams);
                    if (updateResult.rowCount > 0) {
                        console.log(`[LAS Service] (FileID ${fileIdToUpdate}): DB update after LAS processing finished (Status: ${finalStatus}).`);
                    } else {
                        console.error(`[LAS Service] CRITICAL Error (FileID ${fileIdToUpdate}): DB update for LAS processing affected 0 rows. File ID may not exist or concurrent delete.`);
                        if(processingSuccess) processingSuccess = false;
                        if (!processingErrorMsgForDb) processingErrorMsgForDb = "DB update failed to find file record after processing.";
                    }
                } catch (dbError) {
                    console.error(`[LAS Service] DB Error (FileID ${fileIdToUpdate}): Error updating DB after LAS Python script:`, dbError);
                    if(processingSuccess) processingSuccess = false;
                    if (!processingErrorMsgForDb) processingErrorMsgForDb = `DB update error: ${dbError.message}`;
                } finally {
                    if (clientForFinalUpdate) clientForFinalUpdate.release();
                }
            }

            if (processingSuccess) {
                resolve({
                    message: "LAS data processed successfully with all metrics.",
                    fileId: fileIdToUpdate,
                    data: pythonResultData // Contains all data from Python
                });
            } else {
                reject(new Error(processingErrorMsgForDb || `LAS processing failed for unknown reason (FileID: ${fileIdToUpdate}).`));
            }
        });
    });
}

module.exports = { processLasData };