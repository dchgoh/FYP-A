const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db'); // Needs pool to update DB

const processLasFile = (absoluteFilePathForPython, fileIdToUpdate) => {
    // --- Configuration ---
    const pythonScriptName = 'process_las.py'; // <<<--- Still using this name as requested
    const pythonScriptPath = path.resolve(__dirname, '..', 'scripts', pythonScriptName); // <<<--- ADJUST PATH IF NEEDED
    const pythonCommand = 'python'; // Or 'python3'

    // --- Check if Python Script Exists ---
    if (!fs.existsSync(pythonScriptPath)) {
        console.error(`Node Error (FileID ${fileIdToUpdate}): Python script not found at ${pythonScriptPath}.`);
        // Update DB status to failed as the script is missing
        pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                   [`Python script not found: ${pythonScriptName}`, fileIdToUpdate])
            .catch(dbErr => console.error(`Node DB Error (FileID ${fileIdToUpdate}): Failed to update status after script missing error:`, dbErr));
        return; // Stop processing for this file
    }

    console.log(`Node (FileID ${fileIdToUpdate}): Spawning Python script "${pythonScriptPath}" with arg "${absoluteFilePathForPython}"`);
    const pythonProcess = spawn(pythonCommand, [pythonScriptPath, absoluteFilePathForPython]);

    let stdoutData = ''; // Buffer for Python's standard output
    let stderrData = ''; // Buffer for Python's standard error

    // Capture stdout
    pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
    // Capture stderr
    pythonProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
         if (errorMsg) {
            stderrData += errorMsg + '\n';
            // Log Python's stderr messages immediately for debugging
            console.error(`Python stderr (FileID ${fileIdToUpdate}): ${errorMsg}`);
         }
    });

    // Handle errors related to *starting* the Python process
    pythonProcess.on('error', (error) => {
        console.error(`Node Error (FileID ${fileIdToUpdate}): Failed to start Python process. Cmd: ${pythonCommand}. Err: ${error.message}`);
        // Update DB status to failed
        pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                   [`Failed to start Python process: ${error.message}`, fileIdToUpdate])
            .catch(dbErr => console.error(`Node DB Error (FileID ${fileIdToUpdate}): Failed to update status after spawn error:`, dbErr));
    });

    // --- UPDATED pythonProcess.on('close') HANDLER ---
    pythonProcess.on('close', async (code) => {
        console.log(`Node (FileID ${fileIdToUpdate}): Python script (${pythonScriptName}) exited with code ${code}.`);

        let updateQuery = ''; // SQL query string
        let queryParams = []; // Parameters for the SQL query
        let finalStatus = 'failed'; // Default to failed unless successful
        let processingError = `Python script exited with code ${code}. Check Python stderr logs.`; // Default error message

        // --- Process Python Output if Exit Code is 0 (Success) ---
        if (code === 0 && stdoutData) {
            try {
                // Attempt to parse the JSON output from Python's stdout
                const resultData = JSON.parse(stdoutData.trim());
                console.log(`Node (FileID ${fileIdToUpdate}): Received and parsed JSON from Python.`);

                // Safely extract all relevant data from the parsed JSON
                const calculatedLat = resultData.latitude !== undefined ? resultData.latitude : null;
                const calculatedLon = resultData.longitude !== undefined ? resultData.longitude : null;
                // *** Extract Midpoints ***
                const midpointsWGS84 = resultData.tree_midpoints_wgs84 !== undefined ? resultData.tree_midpoints_wgs84 : null;
                // Also capture any warnings/errors reported *within* the JSON by Python
                const pythonWarnings = resultData.warnings || [];
                const pythonErrors = resultData.errors || [];

                // Log Python's internal warnings/errors if any
                if (pythonWarnings.length > 0) console.warn(`Node Warn (FileID ${fileIdToUpdate}): Python reported warnings:`, pythonWarnings);
                if (pythonErrors.length > 0) console.error(`Node Error (FileID ${fileIdToUpdate}): Python reported errors:`, pythonErrors);

                // *** Prepare midpoints data for DB (stringify the object) ***
                const midpointsJsonString = midpointsWGS84 ? JSON.stringify(midpointsWGS84) : null;

                // Determine the final status based on Python's internal errors
                if (pythonErrors.length > 0) {
                    finalStatus = 'processed_with_errors'; // Python finished but had issues
                    processingError = `Python completed with errors: ${pythonErrors.join('; ')}`;
                } else {
                    finalStatus = 'processed'; // Python finished cleanly
                    processingError = null; // Clear any previous errors
                }

                // *** Construct the UPDATE query to store all extracted data ***
                updateQuery = `UPDATE uploaded_files
                               SET latitude = $1,
                                   longitude = $2,
                                   tree_midpoints = $3, -- Include midpoints column
                                   status = $4,
                                   processing_error = $5
                               WHERE id = $6`;
                queryParams = [calculatedLat, calculatedLon, midpointsJsonString, finalStatus, processingError, fileIdToUpdate];

            } catch (parseError) {
                // Handle cases where Python's stdout wasn't valid JSON
                console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing Python JSON output: ${parseError}\nRaw Python stdout: >>>${stdoutData}<<<`);
                processingError = `Failed to parse Python output: ${parseError.message}`;
                finalStatus = 'failed';
                // Prepare query to only update status and error
                updateQuery = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                queryParams = [finalStatus, processingError, fileIdToUpdate];
            }
        } else {
            // Handle cases where Python exited non-zero or produced no output
            if (code !== 0) {
                processingError = `Python script failed (exit code ${code}). Stderr: ${stderrData.substring(0, 500)}...`; // Include captured stderr
                console.error(`Node Error (FileID ${fileIdToUpdate}): ${processingError}`);
            } else { // code === 0 but no stdoutData
                processingError = `Python script finished successfully but produced no JSON output.`;
                console.warn(`Node Warn (FileID ${fileIdToUpdate}): ${processingError}`);
            }
            finalStatus = 'failed';
            // Prepare query to only update status and error
            updateQuery = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
            queryParams = [finalStatus, processingError, fileIdToUpdate];
        }

        // --- Execute the Database Update ---
        if (updateQuery) {
            try {
                const updateResult = await pool.query(updateQuery, queryParams);
                if (updateResult.rowCount > 0) {
                    console.log(`Node (FileID ${fileIdToUpdate}): DB status/data update successful (Status: ${finalStatus}).`);
                } else {
                    // This might happen if the file record was deleted between the initial insert and this update
                    console.warn(`Node Warn (FileID ${fileIdToUpdate}): DB status/data update affected 0 rows (ID ${fileIdToUpdate} might have been deleted?).`);
                }
            } catch (dbError) {
                // Log errors during the final DB update
                console.error(`Node DB Error (FileID ${fileIdToUpdate}): Error updating status/data after Python script:`, dbError);
                console.error(`Attempted Query: ${updateQuery}`); // Log the query that failed
                console.error(`Attempted Params:`, queryParams); // Log the parameters
            }
        }
    }); // --- End of pythonProcess.on('close') ---
};

module.exports = { processLasFile };