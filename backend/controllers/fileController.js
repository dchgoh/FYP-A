const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require("child_process");
const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/
// Optional: Import the utility if you created it
// const { processLasFile } = require('../utils/processLas'); // Adjust path

// --- Helper Function (Consider moving to utils/fileHelpers.js) ---
// No change needed here IF the input dbRecord has the correct fields from joins
const formatFileRecord = (dbRecord) => {
    if (!dbRecord) return null;
    return {
        id: dbRecord.id,
        name: dbRecord.original_name || dbRecord.name,
        size_bytes: dbRecord.size_bytes,
        upload_date: dbRecord.upload_date,
        stored_path: dbRecord.stored_path,
        potreeUrl: dbRecord.potree_metadata_path || dbRecord.potreeUrl || null,
        // division_id: dbRecord.division_id, // Now comes from the project join
        project_id: dbRecord.project_id,
        plot_name: dbRecord.plot_name,
        latitude: dbRecord.latitude,
        longitude: dbRecord.longitude,
        // Derived fields
        size: dbRecord.size_bytes ? `${(dbRecord.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
        uploadDate: dbRecord.upload_date ? new Date(dbRecord.upload_date).toLocaleDateString() : 'N/A',
        downloadLink: `/api/files/download/${dbRecord.id}`,
        divisionName: dbRecord.division_name || "Unassigned", // Comes from join
        projectName: dbRecord.project_name || "Unassigned", // Comes from join
        // Pass through raw joined fields if needed elsewhere
        division_id: dbRecord.division_id || null, // Ensure this exists if needed downstream
        division_name: dbRecord.division_name || null,
        project_name: dbRecord.project_name || null
    };
};

// --- Controller Functions ---

// File Upload
exports.uploadFile = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const { originalname, filename, path: stored_path_absolute, mimetype, size } = req.file;
    // *** MODIFIED: Removed division_id extraction ***
    const { plot_name, project_id } = req.body;
    const stored_path_relative = path.join('uploads', filename);

    // Validate project_id if provided
    let cleanProjectId = null;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
        cleanProjectId = parseInt(project_id);
        if (isNaN(cleanProjectId)) {
            // Cleanup uploaded file immediately if project ID is invalid format
             fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload file on invalid project ID:", err); });
            return res.status(400).json({ success: false, message: "Invalid Project ID format." });
        }
    }

    let savedFileRecord;
    let fileIdToUpdate;

    try {
        // *** ADDED: Check if Project exists if project_id is provided ***
         if (cleanProjectId !== null) {
            const projectCheck = await pool.query("SELECT 1 FROM projects WHERE id = $1", [cleanProjectId]);
             if (projectCheck.rowCount === 0) {
                 // Cleanup uploaded file
                 fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload file for non-existent project:", err); });
                 return res.status(404).json({ success: false, message: `Project with ID ${cleanProjectId} not found.` });
             }
         }

        // *** MODIFIED: Removed division_id from INSERT and RETURNING ***
        const result = await pool.query(
            `INSERT INTO uploaded_files
             (original_name, stored_filename, stored_path, mime_type, size_bytes, latitude, longitude, plot_name, project_id)
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7)
             RETURNING id, original_name, size_bytes, upload_date, stored_path, project_id, plot_name, latitude, longitude`, // Removed division_id
            [originalname, filename, stored_path_relative, mimetype, size, plot_name || null, cleanProjectId] // Use cleanProjectId (can be null)
        );

        if (result.rows.length === 0 || !result.rows[0].id) {
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload file after failed DB insert:", err); });
            throw new Error("Failed to insert file record or retrieve its ID.");
        }

        fileIdToUpdate = result.rows[0].id;
        // *** MODIFIED: Initial format won't have division info unless we query again ***
        // Format with available data. Division/Project names will be populated later by getFiles etc.
        savedFileRecord = formatFileRecord({
             ...result.rows[0],
             division_id: null, // Not available directly
             division_name: null, // Not available directly
             project_name: null // Not available directly (unless we queried project name too)
        });

        // --- Respond Immediately ---
        res.status(201).json({
            success: true,
            message: "File upload accepted, processing coordinates in background.",
            file: savedFileRecord // Send back what we have
        });

        // --- Trigger Python Script Asynchronously (AFTER RESPONSE) ---
        const pythonScriptName = 'process_las.py';
        const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName);
        const pythonCommand = 'python'; // Or 'python3'

        if (!fs.existsSync(pythonScriptPath)) {
             console.error(`Node Error (FileID ${fileIdToUpdate}): Python script not found at ${pythonScriptPath}. Cannot process coordinates.`);
             return;
        }

        console.log(`Node (FileID ${fileIdToUpdate}): Spawning Python script "${pythonScriptPath}" with arg "${stored_path_absolute}"`);
        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, stored_path_absolute]);
        // ... (rest of python spawning logic remains the same) ...
        let stdoutData = '';
        let stderrData = '';
        pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString().trim();
             if (errorMsg) { stderrData += errorMsg + '\n'; console.error(`Python stderr (FileID ${fileIdToUpdate}): ${errorMsg}`); }
        });
        pythonProcess.on('error', (error) => { console.error(`Node Error (FileID ${fileIdToUpdate}): Failed to start Python process. Cmd: ${pythonCommand}. Err: ${error.message}`); });
        pythonProcess.on('close', async (code) => {
            console.log(`Node (FileID ${fileIdToUpdate}): Python script exited with code ${code}.`);
            if (code === 0 && stdoutData) {
                try {
                    const resultData = JSON.parse(stdoutData.trim());
                    if (resultData && (typeof resultData.latitude === 'number' || resultData.latitude === null) && (typeof resultData.longitude === 'number' || resultData.longitude === null)) {
                        const { latitude: calculatedLat, longitude: calculatedLon } = resultData;
                        console.log(`Node (FileID ${fileIdToUpdate}): Received coords Lat: ${calculatedLat}, Lon: ${calculatedLon}. Updating DB...`);
                        try {
                           const updateResult = await pool.query( `UPDATE uploaded_files SET latitude = $1, longitude = $2 WHERE id = $3`, [calculatedLat, calculatedLon, fileIdToUpdate] );
                            if (updateResult.rowCount > 0) console.log(`Node (FileID ${fileIdToUpdate}): DB coord update successful.`);
                            else console.warn(`Node Warn (FileID ${fileIdToUpdate}): DB coord update affected 0 rows (ID ${fileIdToUpdate} gone?).`);
                       } catch (dbError) { console.error(`Node DB Error (FileID ${fileIdToUpdate}): Error updating coords:`, dbError); }
                   } else { console.error(`Node Error (FileID ${fileIdToUpdate}): Invalid JSON from Python: ${stdoutData}`); }
               } catch (parseError) { console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing Python JSON: ${parseError}\nRaw: >>>${stdoutData}<<<`); }
           } else if (code !== 0) { console.error(`Node Error (FileID ${fileIdToUpdate}): Python script error (code ${code}). Check stderr logs.`); }
            else if (code === 0 && !stdoutData) { console.warn(`Node Warn (FileID ${fileIdToUpdate}): Python script OK (code 0) but no stdout.`); }
       });

    } catch (error) {
        console.error("Node Error: Error during initial file upload processing or Python spawn:", error);
        if (!res.headersSent) {
            if (stored_path_absolute && fs.existsSync(stored_path_absolute)) {
                 fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload file on failure:", err); });
            }
            // Check for specific foreign key error if project_id was invalid (though we check earlier now)
             if (error.code === '23503' && error.constraint === 'fk_project') {
                res.status(404).json({ success: false, message: "Assign failed: Target project does not exist." });
             } else {
                 res.status(500).json({ success: false, message: "Server error during file upload process." });
             }
        } else {
             console.error(`Node Error occurred after response was sent for file ${filename}. Background processing might be incomplete.`);
        }
    }
};

// Get List of Files
exports.getFiles = async (req, res) => {
    const { projectId, divisionId } = req.query;

    // *** MODIFIED: Join logic and SELECT list ***
    let query = `
      SELECT
          f.id,
          f.original_name,
          f.size_bytes,
          f.upload_date,
          f.stored_path,
          f.potree_metadata_path,
          f.plot_name,
          f.project_id,
          f.latitude,
          f.longitude,
          p.name AS project_name,
          p.division_id,        -- Get division_id from the project
          d.name AS division_name -- Get division_name via the project's division_id
      FROM uploaded_files f
      LEFT JOIN projects p ON f.project_id = p.id      -- Join files to projects
      LEFT JOIN divisions d ON p.division_id = d.id    -- Join projects to divisions
    `;
    const queryParams = [];
    const whereConditions = [];

    // Filter by Project ID
    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }

    // *** MODIFIED: Filter by Division ID (via project) ***
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        // Filter on the division_id associated with the project
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }
    // Note: Filtering by 'unassigned' division isn't directly meaningful unless
    // you want files whose assigned project *itself* has no division (which shouldn't happen).
    // You might filter for files with NULL project_id if you want 'unassigned' in the broader sense.

    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    query += ` ORDER BY f.upload_date DESC`;

    try {
        const result = await pool.query(query, queryParams);
        const formattedFiles = result.rows.map(formatFileRecord);
        // console.log('Backend sending formattedFiles (check types):', formattedFiles);
        res.json(formattedFiles);
    } catch (error) {
        console.error("Database error fetching files:", error);
        res.status(500).json({ success: false, message: "Server error fetching file list." });
    }
};

// File Download
// --- NO CHANGES NEEDED ---
exports.downloadFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }

    try {
        const result = await pool.query(
            "SELECT original_name, stored_path FROM uploaded_files WHERE id = $1",
            [fileId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "File record not found." });
        }

        const file = result.rows[0];
        const absoluteFilePath = path.resolve(__dirname, '..', file.stored_path);

        if (fs.existsSync(absoluteFilePath)) {
            res.download(absoluteFilePath, file.original_name, (err) => {
                if (err) {
                    console.error(`Error sending file ${file.original_name} (ID: ${fileId}) for download:`, err);
                    if (!res.headersSent) {
                        res.status(500).json({ message: "Error preparing file for download." });
                    }
                } else {
                     console.log(`Successfully sent ${file.original_name} for download.`);
                }
            });
        } else {
            console.error(`Download error: File source missing on disk for ID ${fileId}. Expected at: ${absoluteFilePath}`);
            res.status(404).json({ message: "File source missing on server." });
        }
    } catch (error) {
        console.error(`Error retrieving file info (ID: ${fileId}) for download:`, error);
         if (!res.headersSent) {
             res.status(500).json({ message: "Server error during download preparation." });
         }
    }
};

// File Deletion
// --- NO CHANGES NEEDED --- (Operates on file ID, paths retrieved directly)
exports.deleteFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }

    let poolClient;
    let originalFilePath = null;
    let potreeOutputDirPath = null;

    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileResult = await poolClient.query(
            "SELECT stored_path, potree_metadata_path FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );

        if (fileResult.rows.length === 0) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(404).json({ message: "File not found in database." });
        }

        const fileData = fileResult.rows[0];

        if (fileData.stored_path) {
            originalFilePath = path.resolve(__dirname, '..', fileData.stored_path);
        }
        if (fileData.potree_metadata_path) {
             const parts = fileData.potree_metadata_path.split('/');
             if (parts.length >= 3 && parts[1] === 'pointclouds') {
                 const outputDirName = parts[2];
                 potreeOutputDirPath = path.resolve(__dirname, "../..", "public", "pointclouds", outputDirName);
             }
        }

        const deleteResult = await poolClient.query("DELETE FROM uploaded_files WHERE id = $1", [fileId]);

        if (deleteResult.rowCount === 0) {
            await poolClient.query('ROLLBACK');
             console.warn(`File deletion failed for ID ${fileId} after lock acquisition.`);
            poolClient.release();
            return res.status(404).json({ message: "File deletion failed (concurrency issue?)." });
        }

        await poolClient.query('COMMIT');
        poolClient.release();

        // --- File System Cleanup ---
        if (originalFilePath) {
            fs.unlink(originalFilePath, (err) => {
                if (err && err.code !== 'ENOENT') { console.error(`Error deleting original file ${originalFilePath} (ID: ${fileId}):`, err); }
                else { console.log(`Attempted deletion of original file (ID: ${fileId}): ${originalFilePath}. ${err ? '(Already gone)' : ''}`); }
            });
        }
        if (potreeOutputDirPath) {
            fs.rm(potreeOutputDirPath, { recursive: true, force: true }, (err) => {
                 if (err && err.code !== 'ENOENT') { console.error(`Error deleting Potree output directory ${potreeOutputDirPath} (ID: ${fileId}):`, err); }
                 else { console.log(`Attempted deletion of Potree directory (ID: ${fileId}): ${potreeOutputDirPath}. ${err ? '(Already gone)' : ''}`); }
             });
        }

        res.status(200).json({ success: true, message: "File deleted successfully." });

    } catch (error) {
        console.error(`Error during file deletion process (ID: ${fileId}):`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
            finally { poolClient.release(); }
        }
         // Avoid sending response if headers might be sent by error handlers higher up? Check framework.
         // Assuming we can send here if poolClient existed and failed.
         if (!res.headersSent) {
            res.status(500).json({ message: "Server error during file deletion." });
         }
    }
};


// Potree Conversion
// --- NO CHANGES NEEDED --- (Operates on file ID, paths retrieved directly)
exports.convertFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }

    let poolClient;
    let outDir = null;

    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileRes = await poolClient.query(
            "SELECT stored_path, potree_metadata_path FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );

        if (fileRes.rows.length === 0) { throw new Error("File not found."); } // Throw to central catch

        const file = fileRes.rows[0];
        if (file.potree_metadata_path) { throw new Error("File already converted."); }
        if (!file.stored_path) { throw new Error(`File record (ID: ${fileId}) exists but has no stored path.`); }

        const lasPath = path.resolve(__dirname, '..', file.stored_path);
        const converterPath = path.resolve(__dirname, "..", "potreeconverter", "PotreeConverter.exe");
        const outDirName = fileId.toString();
        const outBase = path.resolve(__dirname, "../..", "public", "pointclouds");
        outDir = path.join(outBase, outDirName);

        if (!fs.existsSync(lasPath)) { throw new Error(`Input LAS file missing on disk: ${lasPath}`); }
        if (!fs.existsSync(converterPath)) { throw new Error(`PotreeConverter not found at: ${converterPath}`); }

        fs.mkdirSync(outBase, { recursive: true });
        fs.mkdirSync(outDir, { recursive: true });

        const command = `"${converterPath}" "${lasPath}" -o "${outDir}" --output-format LAS`;
        console.log(`Executing PotreeConverter (ID: ${fileId}): ${command}`);
        try {
            execSync(command, { stdio: 'inherit' });
        } catch (convErr) {
            // Re-throw specific error for central catch block to handle rollback/cleanup
             throw new Error(`Potree conversion command failed. ${convErr.message}`);
        }

        const metaPath = `/pointclouds/${outDirName}/metadata.json`;
        await poolClient.query(
            "UPDATE uploaded_files SET potree_metadata_path = $1 WHERE id = $2",
            [metaPath, fileId]
        );

        await poolClient.query('COMMIT');
        poolClient.release();

        res.json({ success: true, message: "Potree conversion complete!", potreeUrl: metaPath });

    } catch (error) {
        console.error(`Error during Potree conversion process (ID: ${fileId}):`, error.message); // Log just message
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
            finally { poolClient.release(); }
        }
         // Attempt cleanup only if converter likely failed and created the directory
         if (error.message.includes("Potree conversion command failed") && outDir && fs.existsSync(outDir)) {
             fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after conversion failure:`, rmErr);
                else console.log(`Cleaned up Potree dir ${outDir} after conversion failure.`);
             });
        }

         if (!res.headersSent) {
            let statusCode = 500;
            let responseMessage = "Server error during Potree conversion.";
             if (error.message === "File not found.") statusCode = 404;
             else if (error.message === "File already converted.") statusCode = 400;
             else if (error.message.includes("missing on disk") || error.message.includes("not found at")) statusCode = 500; // Or 404 maybe?
             else if (error.message.includes("Potree conversion command failed")) statusCode = 500;

             res.status(statusCode).json({ success: false, message: error.message || responseMessage });
         }
    }
};


// Assign Project to File (PATCH)
exports.assignProjectToFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    const { projectId } = req.body; // Can be number or null

    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }
    if (projectId !== null && (typeof projectId !== 'number' || !Number.isInteger(projectId))) {
        return res.status(400).json({ message: "Invalid project ID format. Must be an integer or null." });
    }

    try {
        // --- Authorization & Validation ---
        const fileCheck = await pool.query("SELECT 1 FROM uploaded_files WHERE id = $1", [fileId]); // Reduced select
        if (fileCheck.rowCount === 0) {
            return res.status(404).json({ message: "File not found." });
        }

        let targetDivisionId = null; // To store the division ID of the target project
        if (projectId !== null) {
            // *** MODIFIED: Fetch division_id along with project check ***
            const projectResult = await pool.query("SELECT division_id FROM projects WHERE id = $1", [projectId]);
            if (projectResult.rowCount === 0) {
                return res.status(404).json({ message: "Target project not found." });
            }
            targetDivisionId = projectResult.rows[0].division_id; // Store the division ID
        }

        // DM check (no change needed here, checks assignment to project)
        if (req.user.role === ROLES.DATA_MANAGER && projectId !== null) {
            const assignmentResult = await pool.query(
                "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
                [req.user.userId, projectId]
            );
            if (assignmentResult.rowCount === 0) {
                return res.status(403).json({ success: false, message: "Forbidden: Data Managers can only assign files to projects they manage." });
            }
        }

        // --- Perform Update ---
        // *** UPDATE: No need to update division_id separately in the file table ***
        const result = await pool.query(
            "UPDATE uploaded_files SET project_id = $1 WHERE id = $2 RETURNING id",
            [projectId, fileId] // Only update project_id
        );

        if (result.rowCount === 0) {
             console.warn(`File assignment update failed for ID ${fileId} after existence check.`);
             return res.status(404).json({ message: "File not found during update operation." });
        }

        // *** MODIFIED: Fetch updated details with correct JOINS ***
        const updatedFileResult = await pool.query(
            `SELECT
                f.id, f.original_name, f.size_bytes, f.upload_date, f.stored_path,
                f.potree_metadata_path, f.project_id, f.plot_name, f.latitude, f.longitude,
                p.name AS project_name,
                p.division_id,        -- Get division_id from the project
                d.name AS division_name -- Get division_name via the project's division_id
            FROM uploaded_files f
            LEFT JOIN projects p ON f.project_id = p.id      -- Join files to projects
            LEFT JOIN divisions d ON p.division_id = d.id    -- Join projects to divisions
            WHERE f.id = $1`,
            [fileId]
        );

        if (updatedFileResult.rows.length === 0) {
             console.error(`Failed to fetch updated file details for ID ${fileId} after successful assignment.`);
             return res.status(200).json({ success: true, message: "File assignment updated, but failed to retrieve updated details.", file: null });
        }

        const updatedFile = formatFileRecord(updatedFileResult.rows[0]);
        res.json({ success: true, message: "File assignment updated successfully.", file: updatedFile });

    } catch (error) {
        console.error(`Error assigning project for file ID ${fileId}:`, error);
        if (error.code === '23503' && error.constraint === 'fk_project') {
            return res.status(404).json({ message: "Assign failed: Target project does not exist (foreign key violation)." });
        }
        res.status(500).json({ message: "Server error assigning project to file." });
    }
};