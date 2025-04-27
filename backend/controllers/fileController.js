const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require("child_process");
const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/
// Optional: Import the utility if you created it
// const { processLasFile } = require('../utils/processLas'); // Adjust path

// --- Helper Function (Consider moving to utils/fileHelpers.js) ---
const formatFileRecord = (dbRecord) => {
    if (!dbRecord) return null;
    return {
        id: dbRecord.id,
        name: dbRecord.original_name || dbRecord.name, // Handle potential alias
        size_bytes: dbRecord.size_bytes,
        upload_date: dbRecord.upload_date,
        stored_path: dbRecord.stored_path,
        potreeUrl: dbRecord.potree_metadata_path || dbRecord.potreeUrl || null, // Handle potential alias
        division_id: dbRecord.division_id,
        project_id: dbRecord.project_id,
        plot_name: dbRecord.plot_name,
        latitude: dbRecord.latitude,
        longitude: dbRecord.longitude,
        // Derived fields
        size: dbRecord.size_bytes ? `${(dbRecord.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
        uploadDate: dbRecord.upload_date ? new Date(dbRecord.upload_date).toLocaleDateString() : 'N/A',
        downloadLink: `/api/files/download/${dbRecord.id}`, // Assuming API structure
        divisionName: dbRecord.division_name || "Unassigned",
        projectName: dbRecord.project_name || "Unassigned",
        division_name: dbRecord.division_name || null,
        project_name: dbRecord.project_name || null // Keep original if needed
    };
};

// --- Controller Functions ---

// File Upload
exports.uploadFile = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const { originalname, filename, path: stored_path_absolute, mimetype, size } = req.file;
    const { plot_name, division_id, project_id } = req.body; // ✅ extract from body
    // Path stored in DB should be relative to the 'backend' root for consistency
    const stored_path_relative = path.join('uploads', filename); // e.g., 'uploads/uniquefilename.las'

    let savedFileRecord;
    let fileIdToUpdate;

    try {
        // Insert initial record (lat/lon are null)
        const result = await pool.query(
            `INSERT INTO uploaded_files
             (original_name, stored_filename, stored_path, mime_type, size_bytes, latitude, longitude, plot_name, division_id, project_id)
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8)
             RETURNING id, original_name, size_bytes, upload_date, stored_path, project_id, division_id, plot_name, latitude, longitude`,
            [originalname, filename, stored_path_relative, mimetype, size, plot_name, division_id || null, project_id || null]
        );

        if (result.rows.length === 0 || !result.rows[0].id) {
            // Cleanup orphaned file if DB insert fails
            fs.unlink(stored_path_absolute, (err) => {
                if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload file after failed DB insert:", err);
            });
            throw new Error("Failed to insert file record or retrieve its ID.");
        }

        fileIdToUpdate = result.rows[0].id;
        savedFileRecord = formatFileRecord(result.rows[0]); // Format for initial response

        // --- Respond Immediately ---
        res.status(201).json({
            success: true,
            message: "File upload accepted, processing coordinates in background.",
            file: savedFileRecord
        });

        // --- Trigger Python Script Asynchronously (AFTER RESPONSE) ---
        // Option 1: Use utility function
        // processLasFile(stored_path_absolute, fileIdToUpdate);

        // Option 2: Inline the spawning logic (as in the original code)
        const pythonScriptName = 'process_las.py';
        // Resolve path relative to the backend directory
        const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName); // Points to backend/process_las.py
        const pythonCommand = 'python'; // Or 'python3'

        if (!fs.existsSync(pythonScriptPath)) {
             console.error(`Node Error (FileID ${fileIdToUpdate}): Python script not found at ${pythonScriptPath}. Cannot process coordinates.`);
             return; // Stop background processing for this file
        }

        console.log(`Node (FileID ${fileIdToUpdate}): Spawning Python script "${pythonScriptPath}" with arg "${stored_path_absolute}"`);
        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, stored_path_absolute]);

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
                           // Use the shared pool for the update
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
        // End Python spawn logic

    } catch (error) {
        console.error("Node Error: Error during initial file upload processing or Python spawn:", error);
        if (!res.headersSent) {
            // Attempt cleanup only if response not sent
            if (stored_path_absolute && fs.existsSync(stored_path_absolute)) {
                 fs.unlink(stored_path_absolute, (err) => {
                    if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload file on failure:", err);
                });
            }
            res.status(500).json({ success: false, message: "Server error during file upload process." });
        } else {
             console.error(`Node Error occurred after response was sent for file ${filename}. Background processing might be incomplete.`);
        }
    }
};

// Get List of Files
exports.getFiles = async (req, res) => {
    const { projectId, divisionId } = req.query;

    let query = `
      SELECT
          f.id,
          f.original_name, -- Keep original column name for formatting helper
          f.size_bytes,
          f.upload_date,
          f.stored_path,
          f.potree_metadata_path, -- Keep original column name
          f.plot_name,
          f.project_id,
          f.division_id,
          f.latitude,
          f.longitude,
          p.name AS project_name, -- Keep original column name
          d.name AS division_name -- New addition for division name
      FROM uploaded_files f
      LEFT JOIN projects p ON f.project_id = p.id
      LEFT JOIN divisions d ON f.division_id = d.id -- Join divisions to get division name
    `;
    const queryParams = [];
    const whereConditions = [];

    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`); // Use dynamic parameter index
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`); // No parameter needed
    }

    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`f.division_id = $${queryParams.length}`); // Use dynamic parameter index
    }
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`; // Join conditions with AND
    }

    query += ` ORDER BY f.upload_date DESC`;

    try {
        const result = await pool.query(query, queryParams);
        const formattedFiles = result.rows.map(formatFileRecord); // Use helper
         console.log('Backend sending formattedFiles (check types):', formattedFiles); // Keep logging for debug
        res.json(formattedFiles);
    } catch (error) {
        console.error("Database error fetching files:", error);
        res.status(500).json({ success: false, message: "Server error fetching file list." });
    }
};

// File Download
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
        // stored_path is relative to backend root (e.g., 'uploads/...')
        // Resolve it to an absolute path for downloading
        const absoluteFilePath = path.resolve(__dirname, '..', file.stored_path); // Go up from controllers/ then into stored_path

        if (fs.existsSync(absoluteFilePath)) {
            res.download(absoluteFilePath, file.original_name, (err) => {
                if (err) {
                    // Handle errors that occur *after* headers may have been sent
                    console.error(`Error sending file ${file.original_name} (ID: ${fileId}) for download:`, err);
                    // Avoid sending another response if headers are already sent
                    if (!res.headersSent) {
                         // If headers not sent, maybe the file was inaccessible despite existsSync check
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
exports.deleteFile = async (req, res) => {
    // Permissions (Admin or Assigned DM) are checked by middleware before this runs
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }

    let poolClient;
    let originalFilePath = null; // Keep track for cleanup outside transaction
    let potreeOutputDirPath = null; // Keep track for cleanup

    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        // Get file paths and lock the row
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

        // Resolve paths relative to backend root for potential FS operations
        if (fileData.stored_path) {
            originalFilePath = path.resolve(__dirname, '..', fileData.stored_path);
        }
        if (fileData.potree_metadata_path) {
             // Parse /pointclouds/ID/metadata.json
             const parts = fileData.potree_metadata_path.split('/');
             if (parts.length >= 3 && parts[1] === 'pointclouds') {
                 const outputDirName = parts[2];
                 // Path relative to backend/public/
                 potreeOutputDirPath = path.resolve(__dirname, "..", "public", "pointclouds", outputDirName);
             }
        }

        // Delete DB record first
        const deleteResult = await poolClient.query("DELETE FROM uploaded_files WHERE id = $1", [fileId]);

        if (deleteResult.rowCount === 0) {
            // Should not happen if FOR UPDATE found the row, but safety check
            await poolClient.query('ROLLBACK');
             console.warn(`File deletion failed for ID ${fileId} after lock acquisition.`);
            poolClient.release();
            return res.status(404).json({ message: "File deletion failed (concurrency issue?)." });
        }

        await poolClient.query('COMMIT');
        poolClient.release(); // Release client AFTER commit/rollback

        // --- Perform File System Cleanup (AFTER successful DB commit) ---
        if (originalFilePath) {
            fs.unlink(originalFilePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.error(`Error deleting original file ${originalFilePath} (ID: ${fileId}):`, err);
                } else if (!err || err.code === 'ENOENT') {
                    console.log(`Attempted deletion of original file (ID: ${fileId}): ${originalFilePath}. ${err ? '(Already gone)' : ''}`);
                }
            });
        }

        if (potreeOutputDirPath) {
            fs.rm(potreeOutputDirPath, { recursive: true, force: true }, (err) => {
                 if (err && err.code !== 'ENOENT') {
                    console.error(`Error deleting Potree output directory ${potreeOutputDirPath} (ID: ${fileId}):`, err);
                 } else if (!err || err.code === 'ENOENT') {
                    console.log(`Attempted deletion of Potree directory (ID: ${fileId}): ${potreeOutputDirPath}. ${err ? '(Already gone)' : ''}`);
                 }
             });
        }

        res.status(200).json({ success: true, message: "File deleted successfully." }); // Use 200 for DELETE with body

    } catch (error) {
        console.error(`Error during file deletion process (ID: ${fileId}):`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
            poolClient.release(); // Ensure release even on rollback error
        }
        res.status(500).json({ message: "Server error during file deletion." });
    }
    // No finally block needed for release as it's handled in try/catch paths
};

// Potree Conversion
exports.convertFile = async (req, res) => {
    // Permissions (Admin/Regular/DM) checked by route definition
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }

    let poolClient;
    let outDir = null; // Track for potential cleanup on error

    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileRes = await poolClient.query(
            "SELECT stored_path, potree_metadata_path FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );

        if (fileRes.rows.length === 0) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(404).json({ message: "File not found." });
        }

        const file = fileRes.rows[0];
        if (file.potree_metadata_path) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(400).json({ success: false, message: "File already converted." });
        }
        if (!file.stored_path) {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(404).json({ success: false, message: `File record (ID: ${fileId}) exists but has no stored path.` });
        }

        // Resolve paths relative to backend root
        const lasPath = path.resolve(__dirname, '..', file.stored_path);
        const converterPath = path.resolve(__dirname, "..", "potreeconverter", "PotreeConverter.exe");
        const outDirName = fileId.toString();
        const outBase = path.resolve(__dirname, "../..", "public", "pointclouds");
        outDir = path.join(outBase, outDirName); // Store for potential cleanup

        // Pre-checks
        if (!fs.existsSync(lasPath)) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(404).json({ success: false, message: `Input LAS file missing on disk: ${lasPath}` });
        }
        if (!fs.existsSync(converterPath)) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(500).json({ success: false, message: `PotreeConverter not found at: ${converterPath}` });
        }

        // Ensure output directories exist
        fs.mkdirSync(outBase, { recursive: true });
        fs.mkdirSync(outDir, { recursive: true }); // Create specific dir for this conversion

        // Execute converter
        const command = `"${converterPath}" "${lasPath}" -o "${outDir}" --output-format LAS`; // Specify LAS output maybe? Check PotreeConverter docs
        console.log(`Executing PotreeConverter (ID: ${fileId}): ${command}`);
        try {
            execSync(command, { stdio: 'inherit' }); // Show converter output in server console
        } catch (convErr) {
            console.error(`PotreeConverter failed for ID ${fileId}:`, convErr);
            await poolClient.query('ROLLBACK');
            poolClient.release();
            // Optional: Attempt to clean up partially created outDir on conversion failure
            if (outDir && fs.existsSync(outDir)) {
                 fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                    if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after conversion failure:`, rmErr);
                    else console.log(`Cleaned up Potree dir ${outDir} after conversion failure.`);
                 });
            }
            return res.status(500).json({ success: false, message: `Potree conversion command failed. ${convErr.message}` });
        }

        // Update database record
        const metaPath = `/pointclouds/${outDirName}/metadata.json`; // Path relative to web root ('public')
        await poolClient.query(
            "UPDATE uploaded_files SET potree_metadata_path = $1 WHERE id = $2",
            [metaPath, fileId]
        );

        await poolClient.query('COMMIT');
        poolClient.release();

        res.json({ success: true, message: "Potree conversion complete!", potreeUrl: metaPath });

    } catch (error) {
        console.error(`Error during Potree conversion process (ID: ${fileId}):`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
            poolClient.release();
        }
        res.status(500).json({ success: false, message: "Server error during Potree conversion." });
    }
};

// Assign Project to File (PATCH)
exports.assignProjectToFile = async (req, res) => {
    // Permissions (Admin or DM) checked by middleware
    const fileId = parseInt(req.params.id);
    const { projectId } = req.body; // Can be number or null

    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }
    // Allow null (unassign) or a valid number
    if (projectId !== null && (typeof projectId !== 'number' || !Number.isInteger(projectId))) {
        return res.status(400).json({ message: "Invalid project ID format. Must be an integer or null." });
    }

    try {
        // --- Authorization & Validation ---
        // 1. Check if file exists
        const fileCheck = await pool.query("SELECT project_id FROM uploaded_files WHERE id = $1", [fileId]);
        if (fileCheck.rowCount === 0) {
            return res.status(404).json({ message: "File not found." });
        }
        // const currentProjectId = fileCheck.rows[0].project_id; // Needed?

        // 2. Check if target project exists (if assigning, not unassigning)
        if (projectId !== null) {
            const projectExists = await pool.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
            if (projectExists.rowCount === 0) {
                return res.status(404).json({ message: "Target project not found." });
            }
        }

        // 3. Data Manager specific check: Can only assign TO a project they manage
        if (req.user.role === ROLES.DATA_MANAGER && projectId !== null) {
            const assignmentResult = await pool.query(
                "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
                [req.user.userId, projectId]
            );
            if (assignmentResult.rowCount === 0) {
                return res.status(403).json({ success: false, message: "Forbidden: Data Managers can only assign files to projects they manage." });
            }
        }
        // Admins can assign to any project or null.
        // Data Managers can assign to null (unassign) any file (permissions middleware checked they can access the *file*).

        // --- Perform Update ---
        const result = await pool.query(
            "UPDATE uploaded_files SET project_id = $1 WHERE id = $2 RETURNING id", // Only need ID back
            [projectId, fileId]
        );

        if (result.rowCount === 0) {
             // Should not happen if fileCheck passed, but safety first
             console.warn(`File assignment update failed for ID ${fileId} after existence check.`);
             return res.status(404).json({ message: "File not found during update operation." });
        }

        // Fetch full updated file details to return to client
        const updatedFileResult = await pool.query(
            `SELECT
                f.id, f.original_name, f.size_bytes, f.upload_date, f.stored_path,
                f.potree_metadata_path, f.project_id, f.division_id, f.plot_name, f.latitude, f.longitude,
                p.name AS project_name, 
                d.name AS division_name -- Added division name here
            FROM uploaded_files f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN divisions d ON f.division_id = d.id -- Join divisions to get division name
            WHERE f.id = $1`,
            [fileId]
        );

        if (updatedFileResult.rows.length === 0) {
             console.error(`Failed to fetch updated file details for ID ${fileId} after successful assignment.`);
             // Technically the assignment worked, but we can't return the updated record
             return res.status(200).json({ success: true, message: "File assignment updated, but failed to retrieve updated details.", file: null });
        }

        const updatedFile = formatFileRecord(updatedFileResult.rows[0]); // Use helper
        res.json({ success: true, message: "File assignment updated successfully.", file: updatedFile });

    } catch (error) {
        console.error(`Error assigning project for file ID ${fileId}:`, error);
        // Check for foreign key violation specifically (though project existence check should prevent this)
        if (error.code === '23503' && error.constraint === 'fk_project') {
            return res.status(404).json({ message: "Assign failed: Target project does not exist (foreign key violation)." });
        }
        res.status(500).json({ message: "Server error assigning project to file." });
    }
};