const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db'); // Needs pool to update DB

const processLasFile = (absoluteFilePathForPython, fileIdToUpdate) => {
    const pythonScriptName = 'process_las.py';
    const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName); // Path relative to utils dir
    const pythonCommand = 'python'; // Or 'python3'

    if (!fs.existsSync(pythonScriptPath)) {
        console.error(`Node Error (FileID ${fileIdToUpdate}): Python script not found at ${pythonScriptPath}.`);
        return; // Stop processing for this file
    }

    console.log(`Node (FileID ${fileIdToUpdate}): Spawning Python script "${pythonScriptPath}" with arg "${absoluteFilePathForPython}"`);
    const pythonProcess = spawn(pythonCommand, [pythonScriptPath, absoluteFilePathForPython]);

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
    pythonProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
         if (errorMsg) {
            stderrData += errorMsg + '\n';
            console.error(`Python stderr (FileID ${fileIdToUpdate}): ${errorMsg}`);
         }
    });

    pythonProcess.on('error', (error) => {
        console.error(`Node Error (FileID ${fileIdToUpdate}): Failed to start Python process. Cmd: ${pythonCommand}. Err: ${error.message}`);
    });

    pythonProcess.on('close', async (code) => {
        console.log(`Node (FileID ${fileIdToUpdate}): Python script exited with code ${code}.`);
        if (code === 0 && stdoutData) {
            try {
                const resultData = JSON.parse(stdoutData.trim());
                if (resultData && (typeof resultData.latitude === 'number' || resultData.latitude === null) && (typeof resultData.longitude === 'number' || resultData.longitude === null)) {
                    const { latitude: calculatedLat, longitude: calculatedLon } = resultData;
                     console.log(`Node (FileID ${fileIdToUpdate}): Received coords Lat: ${calculatedLat}, Lon: ${calculatedLon}. Updating DB...`);
                     try {
                        const updateResult = await pool.query(
                            `UPDATE uploaded_files SET latitude = $1, longitude = $2 WHERE id = $3`,
                            [calculatedLat, calculatedLon, fileIdToUpdate]
                        );
                         if (updateResult.rowCount > 0) console.log(`Node (FileID ${fileIdToUpdate}): DB update successful.`);
                         else console.warn(`Node Warn (FileID ${fileIdToUpdate}): DB update affected 0 rows (ID ${fileIdToUpdate} gone?).`);
                    } catch (dbError) { console.error(`Node DB Error (FileID ${fileIdToUpdate}): Error updating coords:`, dbError); }
                } else { console.error(`Node Error (FileID ${fileIdToUpdate}): Invalid JSON from Python: ${stdoutData}`); }
            } catch (parseError) { console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing Python JSON: ${parseError}\nRaw: >>>${stdoutData}<<<`); }
        } else if (code !== 0) { console.error(`Node Error (FileID ${fileIdToUpdate}): Python script error (code ${code}). Check stderr logs.`); }
         else if (code === 0 && !stdoutData) { console.warn(`Node Warn (FileID ${fileIdToUpdate}): Python script OK (code 0) but no stdout.`); }
    });
};

module.exports = { processLasFile };