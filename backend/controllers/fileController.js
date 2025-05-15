const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require("child_process");
const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/
const segmentationService = require('../services/segmentationService');
const lasProcessingService = require('../services/lasProcessingService');
const potreeConversionService = require('../services/potreeConversionService');
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
        project_id: dbRecord.project_id,
        plot_name: dbRecord.plot_name,
        latitude: dbRecord.latitude,
        longitude: dbRecord.longitude,
        status: dbRecord.status || 'unknown',
        processing_error: dbRecord.processing_error || null,
        tree_midpoints: dbRecord.tree_midpoints || null, // Access from dbRecord, default to null
        tree_heights_adjusted: dbRecord.tree_heights_adjusted || null, // For displaying if needed later
        tree_dbhs_cm: dbRecord.tree_dbhs_cm || null,

        // Derived fields
        size: dbRecord.size_bytes ? `${(dbRecord.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
        uploadDate: dbRecord.upload_date ? new Date(dbRecord.upload_date).toLocaleDateString() : 'N/A',
        downloadLink: `/api/files/download/${dbRecord.id}`,
        divisionName: dbRecord.division_name || "Unassigned", // Comes from join
        projectName: dbRecord.project_name || "Unassigned", // Comes from join
        // Pass through raw joined fields if needed elsewhere
        division_id: dbRecord.division_id || null,
        division_name: dbRecord.division_name || null,
        project_name: dbRecord.project_name || null
    };
};

// --- Controller Functions ---
exports.uploadFile = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const { originalname, filename, path: stored_path_absolute, mimetype, size } = req.file;
    const { plot_name, project_id } = req.body; // plot_name and project_id are optional from client
    const stored_path_relative = path.join('uploads', filename);

    const projectRootDir = path.resolve(__dirname, '..'); // Assumes controllers/ is one level down from project root
    console.log(`[Controller] projectRootDir determined as: ${projectRootDir}`);

    let cleanProjectId = null;
    if (project_id !== undefined && project_id !== null && String(project_id).trim() !== '') {
        cleanProjectId = parseInt(project_id);
        if (isNaN(cleanProjectId)) {
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload on invalid project ID:", err); });
            return res.status(400).json({ success: false, message: "Invalid Project ID format." });
        }
    }

    let fileIdToUpdate;
    let savedFileRecordData;

    try {
        // 1. Validate project_id if provided (ensures project exists before inserting file record)
        if (cleanProjectId !== null) {
            const projectCheck = await pool.query("SELECT id, name FROM projects WHERE id = $1", [cleanProjectId]);
            if (projectCheck.rowCount === 0) {
                fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload for non-existent project:", err); });
                return res.status(404).json({ success: false, message: `Project with ID ${cleanProjectId} not found.` });
            }
        }

        // 2. Initial Database Insert for the uploaded file
        // The status is 'uploaded', and other fields like latitude, longitude, tree_data will be filled by background processing
        const insertQuery = `
            INSERT INTO uploaded_files
                (original_name, stored_filename, stored_path, mime_type, size_bytes, plot_name, project_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')
            RETURNING 
                id, original_name, size_bytes, upload_date, stored_path, project_id, plot_name, status,
                (SELECT name FROM projects WHERE id = $7) AS project_name,
                (SELECT d.name FROM divisions d JOIN projects p ON p.division_id = d.id WHERE p.id = $7) AS division_name,
                (SELECT d.id FROM divisions d JOIN projects p ON p.division_id = d.id WHERE p.id = $7) AS division_id 
                -- Add other fields needed for formatFileRecord immediately if possible, or ensure formatFileRecord handles missing ones
            `;
        const insertValues = [
            originalname,
            filename,
            stored_path_relative,
            mimetype,
            size,
            plot_name || null, // Ensure plot_name can be null
            cleanProjectId     // Can be null if no project assigned
        ];
        const insertResult = await pool.query(insertQuery, insertValues);

        if (insertResult.rows.length === 0 || !insertResult.rows[0].id) {
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload after failed DB insert:", err); });
            throw new Error("Failed to insert file record or retrieve its ID.");
        }

        fileIdToUpdate = insertResult.rows[0].id;
        savedFileRecordData = insertResult.rows[0]; // Data from RETURNING

        // 3. Respond Immediately to Client (201 Created)
        // The client gets a confirmation that the upload was received.
        // The actual processing happens in the background.
        res.status(201).json({
            success: true,
            message: "File upload accepted. Processing initiated in background.",
            file: formatFileRecord(savedFileRecordData) // Use formatted record
        });

        // 4. Asynchronous Background Processing Chain (IIFE)
        (async () => {
            let currentFileId = fileIdToUpdate; // Use a local variable inside IIFE
            try {
                console.log(`[Controller BG] (FileID ${currentFileId}): Initiating LAS processing service for ${originalname}.`);
                // lasProcessingService.processLasData is expected to:
                // 1. Set status to 'processing_las_data'
                // 2. Run the Python script
                // 3. Parse Python output
                // 4. Update the database with:
                //    - latitude, longitude
                //    - tree_midpoints (JSONB)
                //    - tree_count (INTEGER)
                //    - tree_heights_adjusted (JSONB) <<<< THIS IS THE NEW PART FOR THE SERVICE
                //    - status to 'processed_ready_for_potree' (or 'failed' if Python script errors out)
                //    - processing_error if applicable
                await lasProcessingService.processLasData(currentFileId, stored_path_absolute);
                // Note: lasProcessingService.processLasData must be robust and handle its own DB updates for success/failure.
                console.log(`[Controller BG] (FileID ${currentFileId}): LAS processing service call completed for ${originalname}.`);

                // After successful LAS processing, check status before Potree (optional but good practice)
                const statusCheck = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [currentFileId]);
                if (statusCheck.rows.length > 0 && statusCheck.rows[0].status === 'processed_ready_for_potree') {
                    console.log(`[Controller BG] (FileID ${currentFileId}): Initiating Potree conversion for ${originalname}.`);
                    await potreeConversionService.initiatePotree(currentFileId, stored_path_absolute, projectRootDir);
                    console.log(`[Controller BG] (FileID ${currentFileId}): Potree conversion service call completed/initiated for ${originalname}.`);
                } else {
                    const currentStatus = statusCheck.rows.length > 0 ? statusCheck.rows[0].status : 'unknown';
                    console.warn(`[Controller BG] (FileID ${currentFileId}): Skipping Potree for ${originalname}. Status after LAS processing: ${currentStatus}. Expected 'processed_ready_for_potree'.`);
                }

            } catch (pipelineError) {
                console.error(`[Controller BG] Error (FileID ${currentFileId}): Background processing pipeline for ${originalname} failed: ${pipelineError.message}`);
                // Services (lasProcessingService, potreeConversionService) should ideally handle their own specific 'failed' status updates.
                // This is a fallback for errors bubbling up to the controller or for orchestration issues.
                try {
                    const { rows } = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [currentFileId]);
                    // Avoid overwriting a more specific error status set by a service
                    if (rows.length > 0 && !['failed', 'error_segmentation', 'error_las_processing', 'error_potree'].includes(rows[0].status)) {
                        const errMsgForDb = (pipelineError.message || "Unknown background pipeline error").substring(0, 250);
                        await pool.query(
                            "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                            [errMsgForDb, currentFileId]
                        );
                        console.log(`[Controller BG] (FileID ${currentFileId}): Set status to 'failed' due to unhandled pipeline error for ${originalname}.`);
                    }
                } catch (dbErr) {
                    console.error(`[Controller BG] DB Error (FileID ${currentFileId}): Failed to update status after pipeline error for ${originalname}:`, dbErr);
                }
            }
        })(); // End of async IIFE for background tasks

    } catch (initialError) {
        console.error("[Controller] Initial file upload/DB error:", initialError);
        // Attempt cleanup of the uploaded file if an error occurs before the background processing starts
        if (stored_path_absolute && fs.existsSync(stored_path_absolute)) {
            fs.unlink(stored_path_absolute, (err) => {
                if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload on initial failure:", err);
            });
        }
        // Send error response if not already sent (e.g., by project_id validation)
        if (!res.headersSent) {
             if (initialError.code === '23503' && initialError.constraint && initialError.constraint.startsWith('fk_')) {
                res.status(400).json({ success: false, message: "Invalid input: " + (initialError.detail || "Related data not found.") });
             } else {
                 res.status(500).json({ success: false, message: initialError.message || "Server error during file upload process." });
             }
        }
    }
};


// --- Manual Potree Conversion Endpoint ---
exports.convertFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        return res.status(400).json({ success: false, message: "Invalid file ID." });
    }

    // --- IMPORTANT: Define projectRootDir correctly (same as in uploadFile) ---
    const projectRootDir = path.resolve(__dirname, '..');
    console.log(`[Controller] (convertFile) projectRootDir determined as: ${projectRootDir}`);

    let poolClient; // For transaction during initial checks

    try {
        // --- Step 1: Initial Checks and Status (within transaction) ---
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileRes = await poolClient.query(
            "SELECT stored_path, potree_metadata_path, status FROM uploaded_files WHERE id = $1 FOR UPDATE", // Lock row
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
        // Check against all active processing states
        const activeProcessingStates = ['segmenting', 'segmented_ready_for_las', 'processing_las_data', 'processed_ready_for_potree', 'converting_potree'];
        if (activeProcessingStates.includes(file.status)) {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(400).json({ success: false, message: `File is already in the processing pipeline (status: ${file.status}). Cannot start manual conversion.` });
        }
        if (!file.stored_path) {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(500).json({ success: false, message: `File record (ID: ${fileId}) exists but has no stored path for conversion.` });
        }
        // If status is 'failed', but the failure was not related to Potree itself, user might want to retry Potree.
        // If status is 'processed' (meaning LAS data extracted, but auto-Potree was skipped or failed before 'converting_potree' stage), allow manual.

        // Commit transaction for checks if all good
        await poolClient.query('COMMIT');
        poolClient.release(); // Release client from this transaction
        poolClient = null;    // Nullify to prevent issues in outer catch

        // Resolve the absolute path to the LAS file using projectRootDir
        // Assumes file.stored_path is relative to projectRootDir (e.g., 'uploads/filename.las')
        const lasPath = path.resolve(projectRootDir, file.stored_path);

        if (!fs.existsSync(lasPath)) {
            // Update DB status to failed if file is missing, as conversion can't proceed.
            await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = 'LAS file missing on disk for manual conversion' WHERE id = $1", [fileId]);
            return res.status(500).json({ success: false, message: `Input LAS file missing on disk for manual conversion: ${lasPath}` });
        }

        // --- Step 2: Send 202 Accepted Response ---
        res.status(202).json({
            success: true,
            message: "Manual Potree conversion accepted. Processing in background.",
            fileId: fileId
        });

        // --- Step 3: Call Potree Conversion Service Asynchronously ---
        // The potreeConversionService.initiatePotree will:
        // 1. Set status to 'converting_potree'
        // 2. Spawn PotreeConverter.exe
        // 3. On completion, set status to 'ready' or 'failed'
        potreeConversionService.initiatePotree(fileId, lasPath, projectRootDir)
            .then(conversionResult => {
                console.log(`[Controller] (FileID ${fileId}): Manual Potree conversion via service successful. Message: ${conversionResult.message}`);
                // DB updates are handled by the service
            })
            .catch(conversionError => {
                console.error(`[Controller] Error (FileID ${fileId}): Manual Potree conversion via service failed. Err: ${conversionError.message}`);
                // DB updates for failure are handled by the service
            });

    } catch (error) {
        if (poolClient) { // If error occurred during the transaction
             try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error in convertFile:", rbErr); }
             finally { poolClient.release(); }
        }
        console.error(`[Controller] Error during manual Potree conversion setup (FileID: ${fileId}):`, error.message);
         if (!res.headersSent) {
            let statusCode = 500;
            let responseMessage = error.message || "Server error during Potree conversion setup.";
            if (error.message.includes("File not found")) statusCode = 404;
            else if (error.message.includes("already converted") || error.message.includes("already in processing pipeline")) statusCode = 400;

            res.status(statusCode).json({ success: false, message: responseMessage });
         }
    }
};

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
        LEFT JOIN projects p ON f.project_id = p.id      -- Join files to projects
        LEFT JOIN divisions d ON p.division_id = d.id    -- Join projects to divisions
    `; // <<< --- BASE QUERY ALWAYS INCLUDES JOINS NOW ---

    const queryParams = [];
    // REMOVED: joins array, as joins are now always included in base query
    const whereConditions = [];

    // Filter by Division ID (if not 'all')
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    // Filter by Project ID (if not 'all')
    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }
    // --- End of filtering logic ---

    // Append WHERE clause only if there are conditions
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    // Append ORDER BY and LIMIT
    query += ` ORDER BY f.upload_date DESC LIMIT $${queryParams.length + 1}`; // LIMIT is the next parameter index
    queryParams.push(limit); // Add limit value to params array

    try {
        console.log("Executing filtered recent files query:", query); // Log query
        console.log("Query parameters:", queryParams); // Log params

        const result = await pool.query(query, queryParams);

        // Formatting logic remains the same
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
        // <<< --- MORE DETAILED LOGGING FOR ERRORS --- >>>
        console.error("Database error fetching recent files. Query attempted:");
        console.error("Query:", query);
        console.error("Parameters:", queryParams);
        console.error("Full Error:", error); // Log the full error object
        // <<< ---------------------------------------- >>>
        res.status(500).json({ message: "Server error fetching recent file list." });
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
          f.status,             
          f.processing_error,   
          f.tree_midpoints,     
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
                 potreeOutputDirPath = path.resolve(__dirname, "..", "pointclouds", outputDirName);
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


exports.convertFile = async (req, res) => {
    const fileId = parseInt(req.params.id);
    if (isNaN(fileId)) {
        // No DB transaction needed for basic validation error
        return res.status(400).json({ success: false, message: "Invalid file ID." });
    }

    let poolClient;
    let outDir = null; // Keep track of the potential output directory for cleanup on *conversion* failure

    try {
        // --- Step 1: Initial Checks and Status Update (Synchronous) ---
        poolClient = await pool.connect(); // Acquire client
        await poolClient.query('BEGIN'); // Start transaction

        // Select necessary fields including the new 'status'
        const fileRes = await poolClient.query(
            "SELECT stored_path, potree_metadata_path, status FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );

        if (fileRes.rows.length === 0) {
            await poolClient.query('ROLLBACK'); // Rollback before releasing
            poolClient.release();
            return res.status(404).json({ success: false, message: "File not found." });
        }

        const file = fileRes.rows[0];
        // Check current state based on existing data and status column
        if (file.potree_metadata_path) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(400).json({ success: false, message: "File already converted." });
        }
        if (file.status === 'processing') {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(400).json({ success: false, message: "File is already being processed." });
        }
        // Check if the original file path exists and is valid
        if (!file.stored_path) {
             await poolClient.query('ROLLBACK');
             poolClient.release();
             return res.status(500).json({ success: false, message: `File record (ID: ${fileId}) exists but has no stored path.` });
        }

        const lasPath = path.resolve(__dirname, '..', file.stored_path);
        const converterPath = path.resolve(__dirname, "..", "potreeconverter", "PotreeConverter.exe"); // Keep .exe for Windows environment
        const outDirName = fileId.toString(); // Use file ID for output directory name
        const outBase = path.resolve(__dirname, "..", "pointclouds"); // Base directory for Potree data
        outDir = path.join(outBase, outDirName); // Full output directory path

        // Validate file and converter existence before proceeding
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

        // Create output directories if they don't exist
        try {
            fs.mkdirSync(outBase, { recursive: true });
            fs.mkdirSync(outDir, { recursive: true }); // Create the specific output directory for this conversion
        } catch (mkdirErr) {
             console.error(`Error creating directories for Potree output (ID: ${fileId}):`, mkdirErr);
             await poolClient.query('ROLLBACK');
             poolClient.release();
             // Attempt cleanup of the specific output dir if mkdirSync failed partially
             if (outDir && fs.existsSync(outDir)) {
                 fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                    if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after mkdir failure:`, rmErr);
                 });
             }
             return res.status(500).json({ success: false, message: "Server error preparing output directory for conversion." });
        }


        // --- IMPORTANT: Update status to 'processing' BEFORE spawning the heavy task ---
        // This update is committed to the DB immediately so the frontend can see the status change.
        await poolClient.query(
            "UPDATE uploaded_files SET status = 'processing', processing_error = NULL WHERE id = $1", // Clear previous errors on retry
            [fileId]
        );
        await poolClient.query('COMMIT'); // Commit the status update transaction
        poolClient.release(); // Release the client immediately after the commit

        // *** FIX for double release: Set poolClient variable to null after releasing ***
        poolClient = null; // Ensures the 'if (poolClient)' check in the catch block works correctly


        // --- Step 2: Send Response Immediately (Conversion Started) ---
        // Use 202 Accepted status code to indicate that the request has been
        // accepted for processing, but the processing is not complete.
        // The frontend should receive this quickly and update its UI state.
        res.status(202).json({
            success: true,
            message: "Potree conversion started. Processing in background.",
            fileId: fileId // Return file ID so frontend knows which file is being processed
        });

        // --- Step 3: Spawn PotreeConverter Process Asynchronously (AFTER sending response) ---
        // This part runs in the background relative to the HTTP request.
        const converterArgs = [
            lasPath,
            '-o', outDir,
            '--output-format', 'LAS' // Or BINARY, PLY etc. depending on converter version/needs
        ];
        console.log(`Spawning PotreeConverter (ID: ${fileId}). Command: "${converterPath}" ${converterArgs.join(' ')}`);

        // Using spawn with arguments array is safer than execSync with a single string
        // stdio: 'inherit' pipes child process output to the parent Node.js process's console.
        // You could also use 'pipe' to capture stdout/stderr programmatically if needed.
        const potreeProcess = spawn(converterPath, converterArgs, { stdio: ['inherit', 'inherit', 'pipe'] });

        let stderrData = ''; // Buffer stderr for potential logging on failure
        potreeProcess.stderr.on('data', (data) => {
             const errorMsg = data.toString().trim();
              if (errorMsg) {
                  stderrData += errorMsg + '\n';
                  // You might want to limit how much you log here for very verbose converters
                  // console.error(`PotreeConverter stderr (FileID ${fileId}): ${errorMsg}`);
              }
        });

        // Handle errors specifically related to *spawning* the process (e.g., converter not found, permissions)
        potreeProcess.on('error', async (error) => {
            console.error(`Node Error (FileID ${fileId}): Failed to start PotreeConverter process. Err: ${error.message}`);
            let client; // Acquire a new client for this background update
            try {
                client = await pool.connect();
                 await client.query(
                    "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                    [`Failed to start converter process: ${error.message}`, fileId] // Store specific error message
                 );
                console.log(`Node (FileID ${fileId}): DB status updated to 'failed' due to spawn error.`);
            } catch (dbError) {
                console.error(`Node DB Error (FileID ${fileId}): Error updating status after spawn error:`, dbError);
            } finally {
                if (client) client.release(); // Always release the client
                 // Attempt cleanup of the specific output dir on failure *to spawn*
                 if (outDir && fs.existsSync(outDir)) {
                     fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                        if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after spawn error:`, rmErr);
                        else console.log(`Cleaned up Potree dir ${outDir} after spawn error.`);
                     });
                }
            }
        });

        // Handle the process finishing (either success or non-zero exit code)
        potreeProcess.on('close', async (code) => {
            console.log(`Node (FileID ${fileId}): PotreeConverter exited with code ${code}.`);
            let client; // Acquire a new client for this background update
            try {
                client = await pool.connect(); // Get a new client for this background DB operation

                if (code === 0) {
                    // Conversion successful based on exit code
                    const metaPath = `/pointclouds/${outDirName}/metadata.json`; // Path relative to public directory
                    const fullMetaFilePath = path.join(outDir, 'metadata.json'); // Full path to check existence

                    // Basic check if the expected metadata file was actually created
                    if (fs.existsSync(fullMetaFilePath)) {
                         await client.query(
                            "UPDATE uploaded_files SET potree_metadata_path = $1, status = 'ready', processing_error = NULL WHERE id = $2",
                            [metaPath, fileId]
                         );
                         console.log(`Node (FileID ${fileId}): DB status updated to 'ready', potree_metadata_path set.`);
                         // Optionally, log success message or emit a WebSocket event to frontend
                    } else {
                         // Conversion exited with 0 but metadata file is missing (unexpected scenario)
                         console.error(`Node Error (FileID ${fileId}): PotreeConverter exited code 0, but metadata.json not found at ${fullMetaFilePath}.`);
                          await client.query(
                             "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                             [`Converter exited 0, but output missing: ${fullMetaFilePath}`, fileId] // Record the error
                         );
                         console.log(`Node (FileId ${fileId}): DB status updated to 'failed'.`);
                         // Attempt cleanup of the specific output dir on this specific failure
                         if (outDir && fs.existsSync(outDir)) {
                             fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                                if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after metadata missing error:`, rmErr);
                                else console.log(`Cleaned up Potree dir ${outDir} after metadata missing error.`);
                             });
                         }
                    }

                } else {
                    // Conversion failed (non-zero exit code)
                    console.error(`Node Error (FileID ${fileId}): Potree conversion failed (code ${code}). Stderr:\n${stderrData}`);
                    // Update status to 'failed' and store the error message from stderr
                    await client.query(
                       "UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2",
                       [`Conversion failed (code ${code}): ${stderrData.substring(0, 500)}...`, fileId] // Store first 500 chars of stderr
                    );
                    console.log(`Node (FileId ${fileId}): DB status updated to 'failed'.`);

                    // Attempt cleanup of the specific output dir on failure
                     if (outDir && fs.existsSync(outDir)) {
                         fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                            if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after conversion failure:`, rmErr);
                            else console.log(`Cleaned up Potree dir ${outDir} after conversion failure.`);
                         });
                    }
                }
            } catch (dbError) {
                console.error(`Node DB Error (FileID ${fileId}): Error updating status after conversion process finished:`, dbError);
                // Note: If the update to 'failed' itself fails, the status might remain 'processing'
                // or the previous state, requiring manual intervention or a cleanup job.
            } finally {
                if (client) client.release(); // Always release the client acquired in this block
            }
        });

        // The main async function `exports.convertFile` finishes here after sending the 202 response.
        // The spawned process and its event handlers continue in the background.

    } catch (error) {
        // This outer catch handles errors that occur *before* the 202 response is sent.
        // These are typically synchronous errors during the initial setup phase.
        console.error(`Error during initial Potree conversion setup (ID: ${fileId}):`, error.message);

        // *** FIX for double release (continued): Only attempt rollback/release if poolClient was acquired and NOT set to null (released) ***
        if (poolClient) { // This checks if poolClient was successfully assigned a client from the pool
             try {
                 // Only rollback the transaction if we successfully started one and committed before error
                 // Most errors caught here will happen *before* the commit, so rollback is appropriate
                 await poolClient.query('ROLLBACK');
                 console.warn(`Rolled back transaction for file ${fileId} due to setup error.`);
             } catch (rbErr) { console.error("Rollback error in outer catch:", rbErr); }
             finally {
                 poolClient.release(); // Release the client if it was acquired
             }
        }

        // Attempt cleanup of the output directory if it was created but conversion setup failed
         if (outDir && fs.existsSync(outDir)) {
             fs.rm(outDir, { recursive: true, force: true }, (rmErr) => {
                if (rmErr) console.error(`Error cleaning up Potree dir ${outDir} after setup failure:`, rmErr);
             });
         }

        // Send an appropriate error response if headers haven't been sent already.
         if (!res.headersSent) {
            let statusCode = 500;
            let responseMessage = "Server error during Potree conversion setup."; // Default message

             if (error.message === "File not found.") statusCode = 404;
             else if (error.message === "File already converted.") statusCode = 400;
             else if (error.message === "File is already being processed.") statusCode = 400;
             else if (error.message.includes("missing on disk") || error.message.includes("not found at")) statusCode = 500; // Indicate server-side file issue
             else if (error.message.includes("preparing output directory")) statusCode = 500; // Specific mkdir error
             else if (error.message.includes("Cannot read properties of null")) { // Catch the specific spawn error during setup
                 statusCode = 500;
                 responseMessage = "Server failed to start the conversion process. Check server logs.";
             }


             res.status(statusCode).json({ success: false, message: error.message || responseMessage });
         }
    }
    // No 'finally' block needed for the outer try...catch because poolClient is explicitly
    // released in the try block (on success) or the catch block (on synchronous error).
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

exports.reassignFileDetails = async (req, res) => {
    const fileId = parseInt(req.params.id);
    const { projectId, plotName } = req.body; // Expecting new project ID and plot name
    const requestingUserId = req.user.userId;
    const requestingUserRole = req.user.role;

    // --- Input Validation ---
    if (isNaN(fileId)) {
        return res.status(400).json({ success: false, message: "Invalid file ID." });
    }
    // Allow projectId to be null (for unassigning), otherwise validate as integer
    let cleanProjectId = null;
    if (projectId !== null && projectId !== undefined && projectId !== '') {
        cleanProjectId = parseInt(projectId);
        if (isNaN(cleanProjectId)) {
            return res.status(400).json({ success: false, message: "Invalid project ID format. Must be an integer or null." });
        }
    }
    // Validate plotName (e.g., require it to be a non-empty string)
    if (!plotName || typeof plotName !== 'string' || plotName.trim() === '') {
         return res.status(400).json({ success: false, message: "Plot name is required and cannot be empty." });
    }
    const cleanPlotName = plotName.trim();

    let poolClient;
    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN'); // Start transaction

        // --- Fetch Current File Info (and lock row) ---
        const fileCheckResult = await poolClient.query(
            "SELECT project_id FROM uploaded_files WHERE id = $1 FOR UPDATE",
            [fileId]
        );
        if (fileCheckResult.rowCount === 0) {
            await poolClient.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "File not found." });
        }
        const currentProjectId = fileCheckResult.rows[0].project_id;

        // --- Permission Checks ---
        let canProceed = false;
        if (requestingUserRole === ROLES.ADMIN) {
            canProceed = true; // Admins can reassign any file
        } else if (requestingUserRole === ROLES.DATA_MANAGER) {
            // Data Manager Checks:
            // 1. Can they modify the *current* file? (Must manage current project OR it's unassigned)
            let canAccessCurrent = false;
            if (currentProjectId === null) {
                canAccessCurrent = true; // Can reassign currently unassigned files
            } else {
                const currentAssignmentCheck = await poolClient.query(
                    "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
                    [requestingUserId, currentProjectId]
                );
                canAccessCurrent = currentAssignmentCheck.rowCount > 0;
            }

            // 2. Can they assign TO the *target* project? (Must manage target project OR target is null)
            let canAssignToTarget = false;
            if (cleanProjectId === null) {
                canAssignToTarget = true; // Can always unassign (to null)
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
            return res.status(403).json({ success: false, message: "Forbidden: You do not have permission to perform this reassignment." });
        }

        // --- Check if Target Project Exists (if not null) ---
        if (cleanProjectId !== null) {
            const projectExistsCheck = await poolClient.query("SELECT 1 FROM projects WHERE id = $1", [cleanProjectId]);
            if (projectExistsCheck.rowCount === 0) {
                await poolClient.query('ROLLBACK');
                return res.status(404).json({ success: false, message: "Target project not found." });
            }
        }

        // --- Perform Update ---
        const updateResult = await poolClient.query(
            `UPDATE uploaded_files
             SET project_id = $1, plot_name = $2
             WHERE id = $3`,
            [cleanProjectId, cleanPlotName, fileId]
        );

        if (updateResult.rowCount === 0) {
             // Should not happen due to previous checks, but safety first
             await poolClient.query('ROLLBACK');
             console.warn(`File reassignment update failed for ID ${fileId} after checks.`);
             return res.status(404).json({ message: "File not found during update operation (concurrency?)." });
        }

        await poolClient.query('COMMIT'); // Commit transaction

        // --- Fetch Full Updated Record to Return ---
        // (Same query as in getFiles or assignProjectToFile for consistency)
         const updatedFileResult = await poolClient.query( // Use the same client
            `SELECT
                f.id, f.original_name, f.size_bytes, f.upload_date, f.stored_path,
                f.potree_metadata_path, f.project_id, f.plot_name, f.latitude, f.longitude,
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
             // This is unlikely if commit succeeded, but handle it
             console.error(`Failed to fetch updated file details for ID ${fileId} after successful reassignment.`);
             return res.status(200).json({ success: true, message: "File reassignment updated, but failed to retrieve updated details.", file: null });
        }

        // Format and send response
        const updatedFile = formatFileRecord(updatedFileResult.rows[0]); // Use your helper
        res.json({ success: true, message: "File details updated successfully.", file: updatedFile });


    } catch (error) {
        console.error(`Error reassigning file details for ID ${fileId}:`, error);
         if (poolClient) { // Attempt rollback on error
             try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
         }
        // Check for specific errors like foreign key violations if needed
        if (error.code === '23503' && error.constraint === 'fk_project') { // Check if constraint name is correct
            return res.status(404).json({ success: false, message: "Update failed: Target project does not exist." });
        }
        res.status(500).json({ success: false, message: "Server error updating file details." });
    } finally {
        if (poolClient) {
            poolClient.release(); // Always release client
        }
    }
};


// --- NEW: Get File Count ---
exports.getFileCount = async (req, res) => {
    const { projectId, divisionId } = req.query;

    // Base query
    let query = `
        SELECT COUNT(f.id)
        FROM uploaded_files f
    `;
    const queryParams = [];
    const joins = []; // To store necessary JOIN clauses
    const whereConditions = [];

    // Need to join with projects if filtering by divisionId or projectId (to access division_id or project name if needed, although count just needs IDs)
    // Join is needed for DIVISION filtering
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        // Ensure joins are added only once if needed for multiple conditions
        if (!joins.includes('LEFT JOIN projects p ON f.project_id = p.id')) {
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
        }
        // Join to divisions only needed if filtering by division
        if (!joins.includes('LEFT JOIN divisions d ON p.division_id = d.id')){
            joins.push('LEFT JOIN divisions d ON p.division_id = d.id');
        }

        queryParams.push(parseInt(divisionId));
        // Filter on the division_id associated with the project
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    // Filter by Project ID
    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
         // No extra join needed if already joined for division filter
        if (!joins.includes('LEFT JOIN projects p ON f.project_id = p.id') && !divisionId ) { // Add join only if not already added
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
        }
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }


    // Append joins and where conditions to the base query
    if (joins.length > 0) {
        query += ` ${joins.join(' ')}`;
    }
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    try {
        console.log("Executing file count query:", query, queryParams); // Debug log
        const result = await pool.query(query, queryParams);
        const count = parseInt(result.rows[0].count, 10); // Ensure count is a number
        console.log("File count result:", count); // Debug log

        res.json({ count: count }); // Return count in the expected format
    } catch (error) {
        console.error("Database error fetching file count:", error);
        res.status(500).json({ message: "Server error fetching file count." });
    }
};

// --- NEW: Get Distinct Plot Names for Filtering ---
exports.getDistinctPlotNames = async (req, res) => {
    const { projectId, divisionId } = req.query;

    let query = `
        SELECT DISTINCT f.plot_name
        FROM uploaded_files f
    `;
    const queryParams = [];
    const joins = [];
    const whereConditions = ["f.plot_name IS NOT NULL", "f.plot_name <> ''"]; // Always exclude null/empty

    // Filter by Division ID (if provided and not 'all')
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        if (!joins.includes('LEFT JOIN projects p ON f.project_id = p.id')) {
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
        }
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    // Filter by Project ID (if provided and not 'all')
    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        // No extra join needed if already joined for division filter
        if (!joins.includes('LEFT JOIN projects p ON f.project_id = p.id') && !(divisionId && divisionId !== 'all')) {
            joins.push('LEFT JOIN projects p ON f.project_id = p.id'); // Join if not filtering by division
        }
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
    query += ` ORDER BY f.plot_name ASC`;

    try {
        const result = await pool.query(query, queryParams);
        const plots = result.rows.map(row => row.plot_name);
        res.json({ plots });
    } catch (error) {
        console.error("Database error fetching distinct plot names:", error);
        console.error("Query:", query);
        console.error("Params:", queryParams);
        res.status(500).json({ message: "Server error fetching plot names." });
    }
};

exports.getTreeCount = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query; // Added plotName

    let query = `
        SELECT SUM(COALESCE(f.tree_count, 0)) AS total_trees
        FROM uploaded_files f
    `;
    const queryParams = [];
    const joins = [];
    const whereConditions = [
        // Only count trees for successfully processed files with tree data
        "(f.status = 'ready' OR f.status = 'processed_ready_for_potree')"
    ];

    let projectJoinAdded = false;

    // Filter by Division ID
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        if (!projectJoinAdded) {
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
            projectJoinAdded = true;
        }
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }
    // Filter by Project ID
    if (projectId && projectId !== 'all' && !isNaN(parseInt(projectId))) {
        // The 'projects' table (aliased as 'p') is only strictly needed if we were also filtering by division_id.
        // For f.project_id, no join is strictly needed.
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }

    // --- NEW: Filter by Plot Name ---
    // Ensure plotName is a non-empty string and not a specific 'all' value (case-insensitive for 'all').
    // The actual plot name comparison in SQL (f.plot_name = $X) will be case-sensitive by default.
    if (plotName && typeof plotName === 'string' && plotName.trim() !== '' && plotName.toLowerCase() !== 'all') {
        queryParams.push(plotName.trim()); // Use the trimmed, original case plotName for the query
        whereConditions.push(`f.plot_name = $${queryParams.length}`);
    }
    // If you needed to filter for files with plot_name IS NULL or plot_name = '',
    // you would need specific values for plotName like 'IS_NULL' or 'IS_EMPTY'
    // and handle them accordingly. For now, this handles specific plot names.
    // --- End of Plot Name Filter ---

    if (joins.length > 0) {
        query += ` ${joins.join(' ')}`;
    }
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    try {
        console.log("Executing total tree count query:", query);
        console.log("Query parameters:", queryParams);
        const result = await pool.query(query, queryParams);

        const totalTrees = result.rows[0] && result.rows[0].total_trees !== null
            ? parseInt(result.rows[0].total_trees, 10)
            : 0;

        console.log("Total tree count result:", totalTrees);
        res.json({ count: totalTrees });
    } catch (error) {
        console.error("Database error fetching total tree count. Query:", query, "Params:", queryParams, "Full Error:", error);
        res.status(500).json({ message: "Server error fetching total tree count." });
    }
};


// Example Backend Endpoint (in fileController.js or similar)
exports.getAllAdjustedTreeHeights = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query;
    let query = `
        SELECT f.tree_heights_adjusted
        FROM uploaded_files f
    `;
    const queryParams = [];
    const joins = [];
    const whereConditions = [
        "(f.status = 'ready' OR f.status = 'processed_ready_for_potree')",
        "f.tree_heights_adjusted IS NOT NULL"
    ];

    let projectJoinAdded = false;
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        if (!projectJoinAdded) { joins.push('LEFT JOIN projects p ON f.project_id = p.id'); projectJoinAdded = true;}
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }
    if (projectId && projectId !== 'all' && projectId !== 'unassigned') {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }
    if (plotName && plotName !== 'all') {
        queryParams.push(plotName);
        whereConditions.push(`f.plot_name = $${queryParams.length}`);
    }

    if (joins.length > 0) query += ` ${joins.join(' ')}`;
    if (whereConditions.length > 0) query += ` WHERE ${whereConditions.join(' AND ')}`;

    try {
        const result = await pool.query(query, queryParams);
        let allHeights = [];
        result.rows.forEach(row => {
            if (row.tree_heights_adjusted) {
                // Assuming tree_heights_adjusted is an object like {"treeID1": height1, "treeID2": height2}
                allHeights.push(...Object.values(row.tree_heights_adjusted).filter(h => typeof h === 'number'));
            }
        });
        res.json({ heights: allHeights });
    } catch (error) {
        console.error("Error fetching all adjusted tree heights:", error);
        res.status(500).json({ message: "Server error." });
    }
};


exports.getAllTreeDbhsCm = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query;
    let query = `
        SELECT f.tree_dbhs_cm
        FROM uploaded_files f
    `;
    const queryParams = [];
    const joins = [];
    const whereConditions = [
        "(f.status = 'ready' OR f.status = 'processed_ready_for_potree')", // Only from successfully processed files
        "f.tree_dbhs_cm IS NOT NULL" // Ensure the DBH data exists
    ];

    let projectJoinAdded = false;

    // Filter by Division ID
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        if (!projectJoinAdded) { 
            joins.push('LEFT JOIN projects p ON f.project_id = p.id'); 
            projectJoinAdded = true;
        }
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    // Filter by Project ID
    if (projectId && projectId !== 'all' && projectId !== 'unassigned' && !isNaN(parseInt(projectId))) {
        queryParams.push(parseInt(projectId));
        whereConditions.push(`f.project_id = $${queryParams.length}`);
    } else if (projectId === 'unassigned') {
        whereConditions.push(`f.project_id IS NULL`);
    }

    // Filter by Plot Name
    if (plotName && plotName !== 'all' && typeof plotName === 'string' && plotName.trim() !== '') {
        queryParams.push(plotName.trim());
        whereConditions.push(`f.plot_name = $${queryParams.length}`);
    }

    if (joins.length > 0) query += ` ${joins.join(' ')}`;
    if (whereConditions.length > 0) query += ` WHERE ${whereConditions.join(' AND ')}`;

    try {
        console.log("Executing getAllTreeDbhsCm query:", query, queryParams);
        const result = await pool.query(query, queryParams);
        let allDbhs = [];
        result.rows.forEach(row => {
            if (row.tree_dbhs_cm) {
                // Assuming tree_dbhs_cm is an object like {"treeID1": dbh1_cm, "treeID2": dbh2_cm}
                // We want to collect all the individual DBH values (which are numbers)
                allDbhs.push(...Object.values(row.tree_dbhs_cm).filter(d => typeof d === 'number'));
            }
        });
        console.log("Fetched all DBHs (cm):", allDbhs.length, "values.");
        res.json({ dbhs_cm: allDbhs }); // Send an array of DBH values in cm
    } catch (error) {
        console.error("Error fetching all tree DBHs (cm):", error);
        res.status(500).json({ message: "Server error fetching tree diameter data." });
    }
};