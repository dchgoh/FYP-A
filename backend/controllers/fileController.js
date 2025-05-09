const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require("child_process");
const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/
// Optional: Import the utility if you created it
// const { processLasFile } = require('../utils/processLas'); // Adjust path

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
        status: dbRecord.status || 'unknown',
        processing_error: dbRecord.processing_error || null,
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

    const { originalname, filename, path: stored_path_absolute_original_upload, mimetype /*, size: original_size_before_segmentation */ } = req.file;
    const { plot_name, project_id } = req.body;
    const stored_path_relative_for_db = path.join('uploads', filename);

    let cleanProjectId = null;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
        cleanProjectId = parseInt(project_id);
        if (isNaN(cleanProjectId)) {
            // Clean up the uploaded file if project ID is immediately invalid before any processing
            fs.unlink(stored_path_absolute_original_upload, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload on invalid project ID:", err); });
            return res.status(400).json({ success: false, message: "Invalid Project ID format." });
        }
    }

    let fileIdToUpdate; // Will be set after DB insert
    let originalFileBackupPath = null; // To keep track of the backup file path

    const projectRootDir = path.resolve(__dirname, '..');
    const pythonVenvExecutable = process.platform === "win32"
        ? path.join(projectRootDir, 'venv', 'Scripts', 'python.exe')
        : path.join(projectRootDir, 'venv', 'bin', 'python');
    const pythonSegmentScriptName = 'inference_full_cloud.py';
    const pythonSegmentScriptToExecute = path.join(projectRootDir, pythonSegmentScriptName);
    const checkpointDirName = 'checkpoints';
    const checkpointFileName = 'pointnet2_msg_best_model.pth'; // Make sure this is the correct checkpoint
    const checkpointRelativePath = path.join(checkpointDirName, checkpointFileName); // Relative to projectRootDir for the script
    const checkpointAbsolutePathForCheck = path.join(projectRootDir, checkpointDirName, checkpointFileName);
    const modelNameForScript = 'pointnet2_sem_seg_msg'; // Ensure this is correct for your script

    // --- Asynchronous Segmentation Function (with backup & restore) ---
    const performSegmentation = () => {
        return new Promise((resolve, reject) => {
            console.log(`Node: Starting ASYNC segmentation for ${stored_path_absolute_original_upload}. This will attempt to overwrite the file if successful.`);

            if (!fs.existsSync(pythonVenvExecutable)) return reject(new Error(`Python venv executable not found: ${pythonVenvExecutable}`));
            if (!fs.existsSync(pythonSegmentScriptToExecute)) return reject(new Error(`Python segmentation script not found: ${pythonSegmentScriptToExecute}`));
            if (!fs.existsSync(checkpointAbsolutePathForCheck)) return reject(new Error(`Segmentation checkpoint file not found: ${checkpointAbsolutePathForCheck}`));

            originalFileBackupPath = stored_path_absolute_original_upload + ".bak"; // Define backup path
            try {
                fs.copyFileSync(stored_path_absolute_original_upload, originalFileBackupPath);
                console.log(`Node: Created backup of original file at ${originalFileBackupPath}`);
            } catch (copyError) {
                originalFileBackupPath = null; // Ensure it's null if copy failed
                return reject(new Error(`Failed to create backup for segmentation: ${copyError.message}`));
            }

            const segmentArgs = [
                pythonSegmentScriptToExecute,
                '--model', modelNameForScript,
                '--checkpoint_path', checkpointRelativePath, // Pass relative path, script CWD is projectRootDir
                '--input_file', stored_path_absolute_original_upload, // Script will read this
                '--output_dir', path.dirname(stored_path_absolute_original_upload), // Script will write here, hopefully overwriting input_file
                '--num_point_model', '1024', // Example, adjust as per your script
                '--num_features', '6',       // Example, adjust
                '--batch_size_inference', '16',// Example, adjust
                '--stride_ratio', '0.5',     // Example, adjust
                '--output_format', 'las',    // Crucial: ensures output is LAS
                // Add '--gpu -1' if you want to force CPU, assuming your script supports it.
                // '--gpu', '-1'
            ];

            console.log(`Node: Spawning segmentation script ASYNC: "${pythonVenvExecutable}" with CWD "${projectRootDir}" and args: ${segmentArgs.join(' ')}`);
            const segmentationProcess = spawn(
                pythonVenvExecutable,
                segmentArgs,
                {
                    cwd: projectRootDir,
                    stdio: 'pipe' // Pipe stdio to capture/log output
                }
            );

            // Real-time output handling
            segmentationProcess.stdout.on('data', (data) => {
                process.stdout.write(`[SegPy STDOUT] ${data.toString()}`);
            });
            segmentationProcess.stderr.on('data', (data) => {
                process.stderr.write(`[SegPy STDERR] ${data.toString()}`);
            });

            segmentationProcess.on('error', (error) => {
                console.error(`Node Error: Failed to start segmentation process. Err: ${error.message}`);
                if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                    try {
                        fs.renameSync(originalFileBackupPath, stored_path_absolute_original_upload);
                        console.log("Node: Restored original file from backup due to segmentation spawn error.");
                    } catch (renameErr) {
                        console.error("Node Error: Failed to restore backup after spawn error:", renameErr);
                    }
                }
                originalFileBackupPath = null;
                reject(new Error(`Segmentation script spawn error: ${error.message}`));
            });

            segmentationProcess.on('close', (code) => {
                console.log(`\nNode: Segmentation script exited with code ${code}.`);
                if (code === 0) {
                    // Script exited successfully, verify output (overwritten original file)
                    if (!fs.existsSync(stored_path_absolute_original_upload) || fs.statSync(stored_path_absolute_original_upload).size === 0) {
                        console.error("Node Error: Segmentation script exited 0, but output file is missing or empty.");
                        if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                            try {
                                fs.renameSync(originalFileBackupPath, stored_path_absolute_original_upload);
                                console.log("Node: Restored original file from backup due to invalid segmentation output.");
                            } catch (renameErr) {
                                 console.error("Node Error: Failed to restore backup after invalid output:", renameErr);
                            }
                        }
                        originalFileBackupPath = null;
                        reject(new Error("Segmentation completed but output file (overwritten original) is invalid."));
                    } else {
                        console.log(`Node: Segmentation successful. Original file ${stored_path_absolute_original_upload} is now the segmented version.`);
                        if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                            try {
                                fs.unlinkSync(originalFileBackupPath);
                                console.log("Node: Deleted backup file after successful segmentation.");
                            } catch (unlinkErr) {
                                console.error("Node Error: Failed to delete backup file:", unlinkErr);
                            }
                        }
                        originalFileBackupPath = null;
                        resolve(); // Segmentation successful
                    }
                } else {
                    console.error(`Node Error: Segmentation script failed with exit code ${code}.`);
                    if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) {
                         try {
                            fs.renameSync(originalFileBackupPath, stored_path_absolute_original_upload);
                            console.log("Node: Restored original file from backup due to segmentation script error.");
                        } catch (renameErr) {
                             console.error("Node Error: Failed to restore backup after script error:", renameErr);
                        }
                    }
                    originalFileBackupPath = null;
                    reject(new Error(`Segmentation script failed. Exit code: ${code}.`));
                }
            });
        });
    };

    // --- Main try-catch for the overall upload and processing flow ---
    try {
        // --- STAGE 1: Send 202 Accepted and Start Background Processing ---
        // Respond to client immediately that processing has started.
        res.status(202).json({
            success: true,
            message: "File upload received. Segmentation and further processing will occur in the background.",
            // No 'file' attribute with full details yet, as it's not finalized/in DB.
        });

        // Validate project existence (if project_id was provided)
        // This runs after 202, so errors here are logged, and cleanProjectId might be nulled.
        if (cleanProjectId !== null) {
            const projectCheck = await pool.query("SELECT 1 FROM projects WHERE id = $1", [cleanProjectId]);
            if (projectCheck.rowCount === 0) {
                console.error(`Node Warning: Project with ID ${cleanProjectId} not found for file ${originalname}. File will be processed and saved as unassigned.`);
                cleanProjectId = null; // Set to null, so file is saved as unassigned
            }
        }

        // Perform segmentation (await the promise)
        // This will overwrite stored_path_absolute_original_upload with the segmented version
        // or restore backup on failure.
        await performSegmentation();

        // --- STAGE 2: DB INSERT (after successful segmentation) ---
        // Get the size of the (now segmented and overwritten) file
        const segmentedFileSize = fs.statSync(stored_path_absolute_original_upload).size;

        const dbResult = await pool.query(
            `INSERT INTO uploaded_files
             (original_name, stored_filename, stored_path, mime_type, size_bytes, latitude, longitude, plot_name, project_id, status, processing_error)
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, 'processing_coords', NULL)
             RETURNING id, original_name, size_bytes, upload_date, stored_path, project_id, plot_name, latitude, longitude, status, processing_error`,
            [originalname, filename, stored_path_relative_for_db, mimetype, segmentedFileSize, plot_name || null, cleanProjectId]
        );

        if (dbResult.rows.length === 0 || !dbResult.rows[0].id) {
            // This is a critical error: segmentation succeeded, but DB insert failed.
            // The segmented file exists on disk.
            console.error(`CRITICAL Node Error: Failed to insert DB record for successfully segmented file ${stored_path_absolute_original_upload}. Manual cleanup of file may be needed.`);
            throw new Error("Failed to insert file record into database after successful segmentation."); // Caught by outer catch
        }

        fileIdToUpdate = dbResult.rows[0].id;
        console.log(`Node: DB record created for segmented file. FileID: ${fileIdToUpdate}, Path: ${stored_path_relative_for_db}, Size: ${segmentedFileSize}`);

        // --- STAGE 3: Trigger Coordinate Extraction (process_las.py) Asynchronously ---
        const coordPythonScriptName = 'process_las.py';
        const coordPythonScriptPath = path.resolve(__dirname, '..', coordPythonScriptName);
        const coordPythonCommand = pythonVenvExecutable; // Assuming same venv

        if (!fs.existsSync(coordPythonScriptPath)) {
            console.error(`Node Error (FileID ${fileIdToUpdate}): process_las.py script not found. Updating status to coords_failed.`);
            await pool.query("UPDATE uploaded_files SET status = 'coords_failed', processing_error = $1 WHERE id = $2", ["process_las.py script not found", fileIdToUpdate]);
            return; // End processing for this file here
        }

        console.log(`Node (FileID ${fileIdToUpdate}): Spawning coord extraction script "${coordPythonScriptPath}" for segmented file "${stored_path_absolute_original_upload}"`);
        const coordPythonProcess = spawn(coordPythonCommand, [coordPythonScriptPath, stored_path_absolute_original_upload]);

        let coordStdoutData = '';
        let coordStderrData = '';
        coordPythonProcess.stdout.on('data', (data) => { coordStdoutData += data.toString(); });
        coordPythonProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString().trim();
            if (errorMsg) { coordStderrData += errorMsg + '\n'; console.error(`[CoordPy STDERR] (FileID ${fileIdToUpdate}): ${errorMsg}`); }
        });

        coordPythonProcess.on('error', async (error) => {
            console.error(`Node Error (FileID ${fileIdToUpdate}): Failed to start process_las.py. Err: ${error.message}`);
            await pool.query("UPDATE uploaded_files SET status = 'coords_failed', processing_error = $1 WHERE id = $2", [`process_las.py spawn error: ${error.message}`, fileIdToUpdate]);
        });

        coordPythonProcess.on('close', async (code) => {
            console.log(`Node (FileID ${fileIdToUpdate}): process_las.py script exited with code ${code}.`);
            if (coordStdoutData.trim().length > 0) console.log(`[CoordPy STDOUT] (FileID ${fileIdToUpdate}):\n${coordStdoutData.trim()}`);

            if (code === 0 && coordStdoutData) {
                try {
                    const resultData = JSON.parse(coordStdoutData.trim());
                    if (resultData && (typeof resultData.latitude === 'number' || resultData.latitude === null) && (typeof resultData.longitude === 'number' || resultData.longitude === null)) {
                        const { latitude: calculatedLat, longitude: calculatedLon } = resultData;
                        console.log(`Node (FileID ${fileIdToUpdate}): Received coords Lat: ${calculatedLat}, Lon: ${calculatedLon}. Updating DB...`);
                        await pool.query(
                            `UPDATE uploaded_files SET latitude = $1, longitude = $2, status = 'processed_coords', processing_error = NULL WHERE id = $3`,
                            [calculatedLat, calculatedLon, fileIdToUpdate]
                        );
                        console.log(`Node (FileID ${fileIdToUpdate}): DB coord update successful. File fully processed.`);
                    } else {
                        console.error(`Node Error (FileID ${fileIdToUpdate}): Invalid JSON or missing lat/lon from process_las.py: ${coordStdoutData}`);
                        await pool.query("UPDATE uploaded_files SET status = 'coords_failed', processing_error = $1 WHERE id = $2", [`Invalid JSON from process_las.py: ${coordStdoutData.substring(0,250)}`, fileIdToUpdate]);
                    }
                } catch (parseError) {
                    console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing process_las.py JSON: ${parseError}\nRaw: >>>${coordStdoutData.trim()}<<<`);
                    await pool.query("UPDATE uploaded_files SET status = 'coords_failed', processing_error = $1 WHERE id = $2", [`Error parsing process_las.py JSON: ${parseError.message.substring(0,250)}`, fileIdToUpdate]);
                }
            } else if (code !== 0) {
                console.error(`Node Error (FileID ${fileIdToUpdate}): process_las.py failed (code ${code}). Stderr: ${coordStderrData}`);
                await pool.query("UPDATE uploaded_files SET status = 'coords_failed', processing_error = $1 WHERE id = $2", [`process_las.py error (code ${code}): ${coordStderrData.substring(0,250)}`, fileIdToUpdate]);
            } else if (code === 0 && !coordStdoutData.trim()) {
                console.warn(`Node Warn (FileID ${fileIdToUpdate}): process_las.py script OK (code 0) but no stdout data (lat/lon expected).`);
                // Consider if this should be 'coords_failed' or a specific warning status
                await pool.query("UPDATE uploaded_files SET status = 'coords_warning', processing_error = $1 WHERE id = $2", ["process_las.py no stdout (lat/lon expected)", fileIdToUpdate]);
            }
        });
        // End of STAGE 3 - coordPythonProcess runs in background. Main function exits.

    } catch (error) { // Catches errors from performSegmentation or DB insert primarily.
        console.error(`Node Error (FileID ${fileIdToUpdate || 'N/A'} during background processing for ${originalname}): ${error.message}`, error.stack);
        // Backup restoration for segmentation errors is handled within performSegmentation's promise.
        // If originalFileBackupPath is not null here, it means an error occurred outside performSegmentation
        // after backup creation but before it was handled. This is unlikely with current flow.

        // res.headersSent should be true if error occurs after the 202 response.
        if (res.headersSent) {
            console.error(`Node: Error occurred for file ${originalname} after 202 response was sent. Client was notified of processing start.`);
            // If fileIdToUpdate is set, it means DB insert was attempted or happened,
            // but something failed during or after that (e.g., spawning coord script).
            // If fileIdToUpdate is NOT set, it means segmentation failed OR the DB insert itself failed.
            // No specific DB update here as the relevant stage (segmentation or DB insert) would have failed,
            // and performSegmentation handles its own file cleanup/restoration.
            // If DB insert failed, the critical error is logged, and the segmented file remains (manual cleanup).
            // If segmentation failed, original file is restored (by performSegmentation).
            // Status update for file in DB is handled by specific error points (e.g. coord process failing).
            // This catch mainly logs that a background step (segmentation or initial DB insert) failed.
        } else {
            // This block would execute if an error happened *before* the 202 response.
            // Given the current structure, only very early synchronous errors before `res.status(202)`
            // (like the initial `!req.file` or `isNaN(cleanProjectId)`) would lead here,
            // and those already return their own responses.
            // However, as a safeguard:
            console.error(`Node: Error occurred for file ${originalname} BEFORE 202 response could be sent.`);
            if (fs.existsSync(stored_path_absolute_original_upload)) {
                fs.unlink(stored_path_absolute_original_upload, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting original upload on very early failure:", err); });
            }
            if (originalFileBackupPath && fs.existsSync(originalFileBackupPath)) { // Should be null if backup wasn't made or handled
                fs.unlink(originalFileBackupPath, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting backup file on very early failure:", err); });
            }
            // Ensure not to send response if one was already sent by early validation.
            // This res.status(500) is a last resort.
            if (!res.headersSent) {
                 res.status(500).json({ success: false, message: `Server error during file upload initiation: ${error.message}` });
            }
        }
    }
};

// ... rest of the controller functions (getRecentFiles, getFiles, downloadFile, deleteFile, convertFile, assignProjectToFile, reassignFileDetails, getFileCount)
// remain the same as in your provided code. I'll include them below for completeness if needed,
// but the main change was to uploadFile.

// --- NEW: Get Recent Files for Timeline ---
exports.getRecentFiles = async (req, res) => {
    const { projectId, divisionId } = req.query;
    const limit = parseInt(req.query.limit, 10) || 5;

    if (limit <= 0) {
        return res.status(400).json({ message: "Limit must be a positive integer." });
    }

    let query = `
        SELECT
            f.id,
            f.original_name,
            f.upload_date,
            p.name AS project_name,
            d.name AS division_name
        FROM uploaded_files f
        LEFT JOIN projects p ON f.project_id = p.id
        LEFT JOIN divisions d ON p.division_id = d.id
    `;

    const queryParams = [];
    const whereConditions = [];

    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }

    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    query += ` ORDER BY f.upload_date DESC LIMIT $${queryParams.length + 1}`;
    queryParams.push(limit);

    try {
        // console.log("Executing filtered recent files query:", query);
        // console.log("Query parameters:", queryParams);
        const result = await pool.query(query, queryParams);
        const formattedTimeline = result.rows.map(row => {
            const uploadDate = new Date(row.upload_date);
            return {
                id: row.id,
                date: uploadDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
                time: uploadDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true }),
                file: row.original_name,
                context: row.project_name ? `${row.project_name} (${row.division_name || 'No Div'})` : 'Unassigned'
            };
        });
        res.json(formattedTimeline);
    } catch (error) {
        console.error("Database error fetching recent files. Query attempted:");
        console.error("Query:", query);
        console.error("Parameters:", queryParams);
        console.error("Full Error:", error);
        res.status(500).json({ message: "Server error fetching recent file list." });
    }
};


// Get List of Files
exports.getFiles = async (req, res) => {
    const { projectId, divisionId } = req.query;
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
          f.status,             -- Added status
          f.processing_error,   -- Added processing_error
          p.name AS project_name,
          p.division_id,
          d.name AS division_name
      FROM uploaded_files f
      LEFT JOIN projects p ON f.project_id = p.id
      LEFT JOIN divisions d ON p.division_id = d.id
    `;
    const queryParams = [];
    const whereConditions = [];

    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }

    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    query += ` ORDER BY f.upload_date DESC`;

    try {
        const result = await pool.query(query, queryParams);
        const formattedFiles = result.rows.map(formatFileRecord);
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
         if (!res.headersSent) {
            res.status(500).json({ message: "Server error during file deletion." });
         }
    }
};

// Potree Conversion
exports.convertFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ success: false, message: "Invalid file ID." });
    }

    let poolClient;
    let outDir = null;

    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileRes = await poolClient.query(
            "SELECT stored_path, potree_metadata_path, status FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );

        if (fileRes.rows.length === 0) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(404).json({ success: false, message: "File not found." });
        }

        const file = fileRes.rows[0];
        if (file.potree_metadata_path) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(400).json({ success: false, message: "File already converted." });
        }
        if (file.status === 'processing') { // Assuming 'processing' is for Potree
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(400).json({ success: false, message: "File is already being processed for Potree conversion." });
        }
        if (!file.stored_path) {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(500).json({ success: false, message: `File record (ID: ${fileId}) exists but has no stored path.` });
        }

        const lasPath = path.resolve(__dirname, '..', file.stored_path);
        const converterPath = path.resolve(__dirname, "..", "potreeconverter", "PotreeConverter.exe");
        const outDirName = fileId.toString();
        const outBase = path.resolve(__dirname, "../..", "public", "pointclouds");
        outDir = path.join(outBase, outDirName);

        if (!fs.existsSync(lasPath)) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(500).json({ success: false, message: `Input LAS file missing on disk: ${lasPath}` });
        }
        if (!fs.existsSync(converterPath)) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(500).json({ success: false, message: `PotreeConverter not found at: ${converterPath}` });
        }

        try {
            fs.mkdirSync(outBase, { recursive: true });
            fs.mkdirSync(outDir, { recursive: true });
        } catch (mkdirErr) {
             console.error(`Error creating directories for Potree output (ID: ${fileId}):`, mkdirErr);
             await poolClient.query('ROLLBACK');
             poolClient.release();
             if (outDir && fs.existsSync(outDir)) {
                 fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                    if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after mkdir failure:`, rmErr);
                 });
             }
             return res.status(500).json({ success: false, message: "Server error preparing output directory for conversion." });
        }

        await poolClient.query(
            "UPDATE uploaded_files SET status = 'processing', processing_error = NULL WHERE id = $1",
            [fileId]
        );
        await poolClient.query('COMMIT');
        poolClient.release();
        poolClient = null;


        res.status(202).json({
            success: true,
            message: "Potree conversion started. Processing in background.",
            fileId: fileId
        });

        const converterArgs = [ lasPath, '-o', outDir, '--output-format', 'LAS' ];
        console.log(`Spawning PotreeConverter (ID: ${fileId}). Command: "${converterPath}" ${converterArgs.join(' ')}`);
        const potreeProcess = spawn(converterPath, converterArgs, { stdio: ['inherit', 'inherit', 'pipe'] });
        let stderrData = '';
        potreeProcess.stderr.on('data', (data) => {
             const errorMsg = data.toString().trim();
              if (errorMsg) { stderrData += errorMsg + '\n'; }
        });

        potreeProcess.on('error', async (error) => {
            console.error(`Node Error (FileID ${fileId}): Failed to start PotreeConverter process. Err: ${error.message}`);
            let client;
            try {
                client = await pool.connect();
                 await client.query(
                    "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                    [`Failed to start converter process: ${error.message}`, fileId]
                 );
            } catch (dbError) {
                console.error(`Node DB Error (FileID ${fileId}): Error updating status after spawn error:`, dbError);
            } finally {
                if (client) client.release();
                 if (outDir && fs.existsSync(outDir)) {
                     fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                        if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after spawn error:`, rmErr);
                        else console.log(`Cleaned up Potree dir ${outDir} after spawn error.`);
                     });
                }
            }
        });

        potreeProcess.on('close', async (code) => {
            console.log(`Node (FileID ${fileId}): PotreeConverter exited with code ${code}.`);
            let client;
            try {
                client = await pool.connect();
                if (code === 0) {
                    const metaPath = `/pointclouds/${outDirName}/metadata.json`;
                    const fullMetaFilePath = path.join(outDir, 'metadata.json');
                    if (fs.existsSync(fullMetaFilePath)) {
                         await client.query(
                            "UPDATE uploaded_files SET potree_metadata_path = $1, status = 'ready', processing_error = NULL WHERE id = $2",
                            [metaPath, fileId]
                         );
                    } else {
                         console.error(`Node Error (FileID ${fileId}): PotreeConverter exited code 0, but metadata.json not found at ${fullMetaFilePath}.`);
                          await client.query(
                             "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                             [`Converter exited 0, but output missing: ${fullMetaFilePath}`, fileId]
                         );
                         if (outDir && fs.existsSync(outDir)) {
                             fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                                if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after metadata missing error:`, rmErr);
                                else console.log(`Cleaned up Potree dir ${outDir} after metadata missing error.`);
                             });
                         }
                    }
                } else {
                    console.error(`Node Error (FileID ${fileId}): Potree conversion failed (code ${code}). Stderr:\n${stderrData}`);
                    await client.query(
                       "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                       [`Conversion failed (code ${code}): ${stderrData.substring(0, 500)}...`, fileId]
                    );
                     if (outDir && fs.existsSync(outDir)) {
                         fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                            if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after conversion failure:`, rmErr);
                            else console.log(`Cleaned up Potree dir ${outDir} after conversion failure.`);
                         });
                    }
                }
            } catch (dbError) {
                console.error(`Node DB Error (FileID ${fileId}): Error updating status after conversion process finished:`, dbError);
            } finally {
                if (client) client.release();
            }
        });

    } catch (error) {
        console.error(`Error during initial Potree conversion setup (ID: ${fileId}):`, error.message, error.stack);
        if (poolClient) {
             try { await poolClient.query('ROLLBACK'); }
             catch (rbErr) { console.error("Rollback error in outer catch:", rbErr); }
             finally { poolClient.release(); }
        }
         if (outDir && fs.existsSync(outDir)) {
             fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after setup failure:`, rmErr);
             });
         }
         if (!res.headersSent) {
             let statusCode = 500;
             if (error.message.includes("File not found")) statusCode = 404;
             else if (error.message.includes("already converted") || error.message.includes("already being processed")) statusCode = 400;
             res.status(statusCode).json({ success: false, message: error.message || "Server error during Potree conversion setup." });
         }
    }
};


// Assign Project to File (PATCH)
exports.assignProjectToFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    const { projectId } = req.body;

    if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID." });
    }
    if (projectId !== null && (typeof projectId !== 'number' || !Number.isInteger(projectId))) {
        return res.status(400).json({ message: "Invalid project ID format. Must be an integer or null." });
    }

    try {
        const fileCheck = await pool.query("SELECT 1 FROM uploaded_files WHERE id = $1", [fileId]);
        if (fileCheck.rowCount === 0) {
            return res.status(404).json({ message: "File not found." });
        }

        if (projectId !== null) {
            const projectResult = await pool.query("SELECT division_id FROM projects WHERE id = $1", [projectId]);
            if (projectResult.rowCount === 0) {
                return res.status(404).json({ message: "Target project not found." });
            }
        }

        if (req.user.role === ROLES.DATA_MANAGER && projectId !== null) {
            const assignmentResult = await pool.query(
                "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
                [req.user.userId, projectId]
            );
            if (assignmentResult.rowCount === 0) {
                return res.status(403).json({ success: false, message: "Forbidden: Data Managers can only assign files to projects they manage." });
            }
        }

        const result = await pool.query(
            "UPDATE uploaded_files SET project_id = $1 WHERE id = $2 RETURNING id",
            [projectId, fileId]
        );

        if (result.rowCount === 0) {
             return res.status(404).json({ message: "File not found during update operation." });
        }

        const updatedFileResult = await pool.query(
            `SELECT
                f.id, f.original_name, f.size_bytes, f.upload_date, f.stored_path,
                f.potree_metadata_path, f.project_id, f.plot_name, f.latitude, f.longitude,
                f.status, f.processing_error, -- Added
                p.name AS project_name,
                p.division_id,
                d.name AS division_name
            FROM uploaded_files f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN divisions d ON p.division_id = d.id
            WHERE f.id = $1`,
            [fileId]
        );

        if (updatedFileResult.rows.length === 0) {
             return res.status(200).json({ success: true, message: "File assignment updated, but failed to retrieve updated details.", file: null });
        }
        const updatedFile = formatFileRecord(updatedFileResult.rows[0]);
        res.json({ success: true, message: "File assignment updated successfully.", file: updatedFile });

    } catch (error) {
        console.error(`Error assigning project for file ID ${fileId}:`, error);
        if (error.code === '23503' && error.constraint === 'fk_project') { // Ensure 'fk_project' is your actual constraint name
            return res.status(404).json({ message: "Assign failed: Target project does not exist (foreign key violation)." });
        }
        res.status(500).json({ message: "Server error assigning project to file." });
    }
};

exports.reassignFileDetails = async (req, res) => {
    const fileId = parseInt(req.params.id);
    const { projectId, plotName } = req.body;
    const requestingUserId = req.user.userId;
    const requestingUserRole = req.user.role;

    if (isNaN(fileId)) {
        return res.status(400).json({ success: false, message: "Invalid file ID." });
    }
    let cleanProjectId = null;
    if (projectId !== null && projectId !== undefined && projectId !== '') {
        cleanProjectId = parseInt(projectId);
        if (isNaN(cleanProjectId)) {
            return res.status(400).json({ success: false, message: "Invalid project ID format. Must be an integer or null." });
        }
    }
    if (!plotName || typeof plotName !== 'string' || plotName.trim() === '') {
         return res.status(400).json({ success: false, message: "Plot name is required and cannot be empty." });
    }
    const cleanPlotName = plotName.trim();

    let poolClient;
    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileCheckResult = await poolClient.query(
            "SELECT project_id FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );
        if (fileCheckResult.rowCount === 0) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(404).json({ success: false, message: "File not found." });
        }
        const currentProjectId = fileCheckResult.rows[0].project_id;

        let canProceed = false;
        if (requestingUserRole === ROLES.ADMIN) {
            canProceed = true;
        } else if (requestingUserRole === ROLES.DATA_MANAGER) {
            let canAccessCurrent = false;
            if (currentProjectId === null) {
                canAccessCurrent = true;
            } else {
                const currentAssignmentCheck = await poolClient.query(
                    "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
                    [requestingUserId, currentProjectId]
                );
                canAccessCurrent = currentAssignmentCheck.rowCount > 0;
            }
            let canAssignToTarget = false;
            if (cleanProjectId === null) {
                canAssignToTarget = true;
            } else {
                const targetAssignmentCheck = await poolClient.query(
                    "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
                    [requestingUserId, cleanProjectId]
                );
                canAssignToTarget = targetAssignmentCheck.rowCount > 0;
            }
            if (canAccessCurrent && canAssignToTarget) {
                canProceed = true;
            }
        }

        if (!canProceed) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(403).json({ success: false, message: "Forbidden: You do not have permission to perform this reassignment." });
        }

        if (cleanProjectId !== null) {
            const projectExistsCheck = await poolClient.query("SELECT 1 FROM projects WHERE id = $1", [cleanProjectId]);
            if (projectExistsCheck.rowCount === 0) {
                await poolClient.query('ROLLBACK');
                poolClient.release();
                return res.status(404).json({ success: false, message: "Target project not found." });
            }
        }

        const updateResult = await poolClient.query(
            `UPDATE uploaded_files SET project_id = $1, plot_name = $2 WHERE id = $3`,
            [cleanProjectId, cleanPlotName, fileId]
        );

        if (updateResult.rowCount === 0) {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(404).json({ message: "File not found during update operation (concurrency?)." });
        }
        await poolClient.query('COMMIT');

         const updatedFileResult = await poolClient.query(
            `SELECT
                f.id, f.original_name, f.size_bytes, f.upload_date, f.stored_path,
                f.potree_metadata_path, f.project_id, f.plot_name, f.latitude, f.longitude,
                f.status, f.processing_error, -- Added
                p.name AS project_name,
                p.division_id,
                d.name AS division_name
            FROM uploaded_files f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN divisions d ON p.division_id = d.id
            WHERE f.id = $1`,
            [fileId]
        );
        poolClient.release(); // Release after last query within this client's scope

        if (updatedFileResult.rows.length === 0) {
             return res.status(200).json({ success: true, message: "File reassignment updated, but failed to retrieve updated details.", file: null });
        }
        const updatedFile = formatFileRecord(updatedFileResult.rows[0]);
        res.json({ success: true, message: "File details updated successfully.", file: updatedFile });

    } catch (error) {
        console.error(`Error reassigning file details for ID ${fileId}:`, error);
         if (poolClient && !poolClient.released) { // Check if client exists and not already released
             try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
             finally { poolClient.release(); }
         }
        if (error.code === '23503' && error.constraint === 'fk_project') {
            return res.status(404).json({ success: false, message: "Update failed: Target project does not exist." });
        }
        res.status(500).json({ success: false, message: "Server error updating file details." });
    }
    // No finally needed if client is released within try or catch
};


// --- NEW: Get File Count ---
exports.getFileCount = async (req, res) => {
    const { projectId, divisionId } = req.query;
    let query = `SELECT COUNT(f.id) FROM uploaded_files f`;
    const queryParams = [];
    const joins = [];
    const whereConditions = [];

    if ((divisionId && divisionId !== 'all') || (projectId && projectId !== 'all' && projectId !== 'unassigned')) {
        joins.push('LEFT JOIN projects p ON f.project_id = p.id');
    }
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        // This join depends on the 'projects' join already being present
        if (joins.includes('LEFT JOIN projects p ON f.project_id = p.id')) {
            joins.push('LEFT JOIN divisions d ON p.division_id = d.id');
        }
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }

    if (joins.length > 0) {
        query += ` ${joins.join(' ')}`;
    }
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    try {
        // console.log("Executing file count query:", query, queryParams);
        const result = await pool.query(query, queryParams);
        const count = parseInt(result.rows[0].count, 10);
        // console.log("File count result:", count);
        res.json({ count: count });
    } catch (error) {
        console.error("Database error fetching file count:", error);
        console.error("Query:", query);
        console.error("Parameters:", queryParams);
        res.status(500).json({ message: "Server error fetching file count." });
    }
};