const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require("child_process");
const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/
const segmentationService = require('../services/segmentationService');
const { getProgress, clearProgress } = require('../services/progressStore');
const lasProcessingService = require('../services/lasProcessingService');
const { encryptFileTo, decryptToStream } = require('../utils/fileCrypto');


const formatFileRecord = (dbRecord) => {
    if (!dbRecord) return null;

    // --- COMBINATION LOGIC START ---
    let combinedTreeData = {}; // Initialize as an empty object

    // Check if tree_midpoints exists and is an object
    if (dbRecord.tree_midpoints && typeof dbRecord.tree_midpoints === 'object') {
        for (const treeId in dbRecord.tree_midpoints) {
            // Make sure treeId is an own property of dbRecord.tree_midpoints
            if (Object.prototype.hasOwnProperty.call(dbRecord.tree_midpoints, treeId)) {
                // Initialize the entry for this treeId with its lat/lon
                // Ensure dbRecord.tree_midpoints[treeId] is an object before accessing properties
                const currentMidpoint = dbRecord.tree_midpoints[treeId];
                if (currentMidpoint && typeof currentMidpoint.latitude === 'number' && typeof currentMidpoint.longitude === 'number') {
                    combinedTreeData[treeId] = {
                        latitude: currentMidpoint.latitude,
                        longitude: currentMidpoint.longitude,
                    };

                    // Add height if available from tree_heights_adjusted
                    if (dbRecord.tree_heights_adjusted && dbRecord.tree_heights_adjusted[treeId] !== undefined) {
                        combinedTreeData[treeId].height_m = dbRecord.tree_heights_adjusted[treeId];
                    }
                    // Add DBH if available
                    if (dbRecord.tree_dbhs_cm && dbRecord.tree_dbhs_cm[treeId] !== undefined) {
                        combinedTreeData[treeId].dbh_cm = dbRecord.tree_dbhs_cm[treeId];
                    }
                    // Add stem volume if available
                    if (dbRecord.tree_stem_volumes_m3 && dbRecord.tree_stem_volumes_m3[treeId] !== undefined) {
                        combinedTreeData[treeId].stem_volume_m3 = dbRecord.tree_stem_volumes_m3[treeId];
                    }
                    // Add carbon if available
                    if (dbRecord.tree_carbon_tonnes && dbRecord.tree_carbon_tonnes[treeId] !== undefined) {
                        combinedTreeData[treeId].carbon_tonnes = dbRecord.tree_carbon_tonnes[treeId];
                    }
                    // Add ag_volume_m3 if available
                    if (dbRecord.tree_above_ground_volumes_m3 && dbRecord.tree_above_ground_volumes_m3[treeId] !== undefined) {
                        combinedTreeData[treeId].ag_volume_m3 = dbRecord.tree_above_ground_volumes_m3[treeId];
                    }
                    // Add total_volume_m3 if available
                    if (dbRecord.tree_total_volumes_m3 && dbRecord.tree_total_volumes_m3[treeId] !== undefined) {
                        combinedTreeData[treeId].total_volume_m3 = dbRecord.tree_total_volumes_m3[treeId];
                    }
                    // Add biomass_tonnes if available
                    if (dbRecord.tree_biomass_tonnes && dbRecord.tree_biomass_tonnes[treeId] !== undefined) {
                        combinedTreeData[treeId].biomass_tonnes = dbRecord.tree_biomass_tonnes[treeId];
                    }
                    // Add co2_equivalent_tonnes if available
                    if (dbRecord.tree_co2_equivalent_tonnes && dbRecord.tree_co2_equivalent_tonnes[treeId] !== undefined) {
                        combinedTreeData[treeId].co2_equivalent_tonnes = dbRecord.tree_co2_equivalent_tonnes[treeId];
                    }
                    // Add any other metrics you need here, following the same pattern
                } else {
                    // Log if a treeId in tree_midpoints doesn't have valid lat/lon
                    console.warn(`Skipping treeId ${treeId} for file ${dbRecord.id}: missing or invalid latitude/longitude in tree_midpoints.`);
                }
            }
        }
    }
    // --- COMBINATION LOGIC END ---

    return {
        id: dbRecord.id,
        name: dbRecord.original_name || dbRecord.name,
        size_bytes: dbRecord.size_bytes,
        upload_date: dbRecord.upload_date,
        stored_path: dbRecord.stored_path,
        // Potree URL removed - files now use point cloud viewer directly
        project_id: dbRecord.project_id,
        plot_name: dbRecord.plot_name,
        latitude: dbRecord.latitude,
        longitude: dbRecord.longitude,
        status: dbRecord.status || 'unknown',
        processing_error: dbRecord.processing_error || null,
        tree_midpoints: combinedTreeData,
        tree_heights_adjusted: dbRecord.tree_heights_adjusted || null,
        tree_dbhs_cm: dbRecord.tree_dbhs_cm || null,
        assumed_d2_cm_for_volume: dbRecord.assumed_d2_cm_for_volume !== undefined ? dbRecord.assumed_d2_cm_for_volume : null,
        tree_stem_volumes_m3: dbRecord.tree_stem_volumes_m3 || null,
        tree_above_ground_volumes_m3: dbRecord.tree_above_ground_volumes_m3 || null,
        tree_total_volumes_m3: dbRecord.tree_total_volumes_m3 || null,
        tree_biomass_tonnes: dbRecord.tree_biomass_tonnes || null,
        tree_carbon_tonnes: dbRecord.tree_carbon_tonnes || null,
        tree_co2_equivalent_tonnes: dbRecord.tree_co2_equivalent_tonnes || null,
        // -----------------------------------------

        // Derived fields
        size: dbRecord.size_bytes ? `${(dbRecord.size_bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
        uploadDate: dbRecord.upload_date ? new Date(dbRecord.upload_date).toLocaleDateString() : 'N/A',
        downloadLink: `/api/files/download/${dbRecord.id}`,
        divisionName: dbRecord.division_name || "Unassigned",
        projectName: dbRecord.project_name || "Unassigned",
        division_id: dbRecord.division_id || null,
        // Transient runtime field (in-memory progress parsed from terminal)
        progress_percent: getProgress(typeof dbRecord.id === 'number' ? dbRecord.id : parseInt(dbRecord.id)) || null,
    };
};

// --- Controller Functions ---
exports.uploadFile = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const { originalname, filename, path: stored_path_absolute, mimetype, size } = req.file;
    const { plot_name, project_id, skipSegmentation } = req.body; 
    const shouldSkipSegmentation = skipSegmentation === 'true';
    const stored_path_relative = path.join('uploads', filename);

    const projectRootDir = path.resolve(__dirname, '..'); 
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
        if (cleanProjectId !== null) {
            const projectCheck = await pool.query("SELECT id, name FROM projects WHERE id = $1", [cleanProjectId]);
            if (projectCheck.rowCount === 0) {
                fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload for non-existent project:", err); });
                return res.status(404).json({ success: false, message: `Project with ID ${cleanProjectId} not found.` });
            }
        }

        // MODIFIED: The RETURNING clause includes the new columns.
        // They will be NULL initially but formatFileRecord will handle it.
        const insertQuery = `
            INSERT INTO uploaded_files
                (original_name, stored_filename, stored_path, mime_type, size_bytes, plot_name, project_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')
            RETURNING
                id, original_name, size_bytes, upload_date, stored_path, project_id, plot_name, status,
                latitude, longitude, tree_midpoints, tree_heights_adjusted, tree_dbhs_cm,
                assumed_d2_cm_for_volume,
                -- New columns from your table:
                tree_stem_volumes_m3,          -- If you renamed tree_volumes_m3 to this
                tree_above_ground_volumes_m3,
                tree_total_volumes_m3,
                tree_biomass_tonnes,
                tree_carbon_tonnes,
                tree_co2_equivalent_tonnes,
                -- End of new columns
                (SELECT name FROM projects WHERE id = $7) AS project_name,
                (SELECT d.name FROM divisions d JOIN projects p ON p.division_id = d.id WHERE p.id = $7) AS division_name,
                (SELECT d.id FROM divisions d JOIN projects p ON p.division_id = d.id WHERE p.id = $7) AS division_id
            `;
        const insertValues = [
            originalname,
            filename,
            stored_path_relative,
            mimetype,
            size,
            plot_name || null, 
            cleanProjectId     
        ];
        const insertResult = await pool.query(insertQuery, insertValues);

        if (insertResult.rows.length === 0 || !insertResult.rows[0].id) {
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload after failed DB insert:", err); });
            throw new Error("Failed to insert file record or retrieve its ID.");
        }

        fileIdToUpdate = insertResult.rows[0].id;
        savedFileRecordData = insertResult.rows[0]; 

        res.status(201).json({
            success: true,
            message: "File upload accepted. Processing initiated in background.",
            file: formatFileRecord(savedFileRecordData) // Use formatted record
        });

        (async () => {
            let currentFileId = fileIdToUpdate;
            try {
                console.log(`[Controller BG] (FileID ${currentFileId}): Initiating LAS processing for ${originalname}.`);
                await lasProcessingService.processLasData(currentFileId, stored_path_absolute);
                console.log(`[Controller BG] (FileID ${currentFileId}): LAS processing service call completed.`);

                // Define the expected status after successful LAS processing
                const statusAfterLasProcessing = 'processed_ready_for_potree';

                // Verify that LAS processing was successful before proceeding
                let statusCheckAfterLas = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [currentFileId]);

                if (statusCheckAfterLas.rows.length > 0 && statusCheckAfterLas.rows[0].status === statusAfterLasProcessing) {
                    
                    // --- The crucial check is here ---
                    // Now that we have the base data, we check if the user wanted to skip the heavy AI part.
                    if (shouldSkipSegmentation) {
                        // --- PATH A: SKIP SEGMENTATION ---
                        console.log(`[Controller BG] (FileID ${currentFileId}): LAS processing successful. Skipping segmentation as requested.`);
                        console.log(`[Controller BG] (FileID ${currentFileId}): Setting status to ready for point cloud viewer.`);

                        // Set status to ready for point cloud viewer instead of Potree conversion
                        await pool.query("UPDATE uploaded_files SET status = 'ready' WHERE id = $1", [currentFileId]);
                        try { clearProgress(currentFileId); } catch (_) {}

                        // Encrypt file at rest now that processing is complete
                        try {
                            const encPathAbsolute = `${stored_path_absolute}.enc`;
                            await encryptFileTo(stored_path_absolute, encPathAbsolute);
                            // Update DB to point to encrypted file and remove plaintext
                            const encPathRelative = `${path.join('uploads', filename)}.enc`;
                            await pool.query("UPDATE uploaded_files SET stored_path = $1 WHERE id = $2", [encPathRelative, currentFileId]);
                            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error(`[Controller BG] (FileID ${currentFileId}) error deleting plaintext after encryption:`, err); });
                            console.log(`[Controller BG] (FileID ${currentFileId}): File encrypted and plaintext removed.`);
                        } catch (encErr) {
                            console.error(`[Controller BG] (FileID ${currentFileId}) Encryption error:`, encErr);
                            // Do not fail the pipeline; file remains plaintext if encryption fails
                        }

                        console.log(`[Controller BG] (FileID ${currentFileId}): File ready for point cloud viewer.`);

                    } else {
                        // --- PATH B: FULL PIPELINE WITH SEGMENTATION ---
                        console.log(`[Controller BG] (FileID ${currentFileId}): LAS processing successful. Proceeding with segmentation.`);
                        
                        const statusAfterSegmentationReadyForPotree = 'segmented_ready_for_las';

                        // --- 2. Segmentation ---
                        await segmentationService.runSegmentation(currentFileId, stored_path_absolute, projectRootDir);
                        console.log(`[Controller BG] (FileID ${currentFileId}): Segmentation completed.`);

                        // Check status after segmentation to ensure it's ready for point cloud viewer
                        let statusCheckAfterSegmentation = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [currentFileId]);

                        if (statusCheckAfterSegmentation.rows.length > 0 && statusCheckAfterSegmentation.rows[0].status === statusAfterSegmentationReadyForPotree) {
                            // --- 3. Set ready for point cloud viewer ---
                            console.log(`[Controller BG] (FileID ${currentFileId}): Setting status to ready for point cloud viewer.`);
                            await pool.query("UPDATE uploaded_files SET status = 'ready' WHERE id = $1", [currentFileId]);
                            try { clearProgress(currentFileId); } catch (_) {}

                            // Encrypt file at rest now that processing is complete
                            try {
                                const encPathAbsolute = `${stored_path_absolute}.enc`;
                                await encryptFileTo(stored_path_absolute, encPathAbsolute);
                                const encPathRelative = `${path.join('uploads', filename)}.enc`;
                                await pool.query("UPDATE uploaded_files SET stored_path = $1 WHERE id = $2", [encPathRelative, currentFileId]);
                                fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error(`[Controller BG] (FileID ${currentFileId}) error deleting plaintext after encryption:`, err); });
                                console.log(`[Controller BG] (FileID ${currentFileId}): File encrypted and plaintext removed.`);
                            } catch (encErr) {
                                console.error(`[Controller BG] (FileID ${currentFileId}) Encryption error:`, encErr);
                            }

                            console.log(`[Controller BG] (FileID ${currentFileId}): File ready for point cloud viewer.`);
                        } else {
                            const currentStatus = statusCheckAfterSegmentation.rows.length > 0 ? statusCheckAfterSegmentation.rows[0].status : 'unknown';
                            console.warn(`[Controller BG] (FileID ${currentFileId}): Skipping point cloud viewer setup for ${originalname}. Status after Segmentation: ${currentStatus}. Expected '${statusAfterSegmentationReadyForPotree}'.`);
                        }
                    }
                } else {
                    // This 'else' catches cases where the initial LAS processing failed.
                    const currentStatus = statusCheckAfterLas.rows.length > 0 ? statusCheckAfterLas.rows[0].status : 'unknown';
                    console.warn(`[Controller BG] (FileID ${currentFileId}): Skipping all subsequent steps for ${originalname}. Status after LAS Processing: ${currentStatus}. Expected '${statusAfterLasProcessing}'.`);
                }

            } catch (pipelineError) {
                // This single catch block will correctly handle errors from any stage in either path (short or full).
                console.error(`[Controller BG] Error (FileID ${currentFileId}): Background processing pipeline for ${originalname} failed: ${pipelineError.message}`);
                try {
                    const { rows } = await pool.query("SELECT status FROM uploaded_files WHERE id = $1", [currentFileId]);
                    if (rows.length > 0 && !['failed', 'error_segmentation', 'error_las_processing'].includes(rows[0].status)) {
                        const errMsgForDb = (pipelineError.message || "Unknown background pipeline error").substring(0, 250);

                        let failureStatus = 'failed';
                        if (pipelineError.message.toLowerCase().includes('las processing') || pipelineError.message.toLowerCase().includes('lasdata')) {
                            failureStatus = 'error_las_processing';
                        } else if (pipelineError.message.toLowerCase().includes('segmentation')) {
                            failureStatus = 'error_segmentation';
                        }

                        await pool.query(
                            "UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3",
                            [failureStatus, errMsgForDb, currentFileId]
                        );
                        console.log(`[Controller BG] (FileID ${currentFileId}): Set status to '${failureStatus}' due to pipeline error for ${originalname}.`);
                    } else if (rows.length > 0) {
                        console.log(`[Controller BG] (FileID ${currentFileId}): Status already '${rows[0].status}'. Error occurred: ${pipelineError.message}. No generic 'failed' status update by controller.`);
                    } else {
                        console.log(`[Controller BG] (FileID ${currentFileId}): File record not found during error handling. Error occurred: ${pipelineError.message}.`);
                    }
                } catch (dbErr) {
                    console.error(`[Controller BG] DB Error (FileID ${currentFileId}): Failed to update status after pipeline error for ${originalname}:`, dbErr);
                }
            }
        })(); 

    } catch (initialError) {
        console.error("[Controller] Initial file upload/DB error:", initialError);
        if (stored_path_absolute && fs.existsSync(stored_path_absolute)) {
            fs.unlink(stored_path_absolute, (err) => {
                if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload on initial failure:", err);
            });
        }
        if (!res.headersSent) {
             if (initialError.code === '23503' && initialError.constraint && initialError.constraint.startsWith('fk_')) {
                res.status(400).json({ success: false, message: "Invalid input: " + (initialError.detail || "Related data not found.") });
             } else {
                 res.status(500).json({ success: false, message: initialError.message || "Server error during file upload process." });
             }
        }
    }
};


// --- Manual Potree Conversion Endpoint - REMOVED ---
// This endpoint has been removed as we no longer use Potree conversion.
// Files are now directly ready for the point cloud viewer after processing.

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

        res.json({ data: formattedTimeline });

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
    const { projectId, divisionId, plotName } = req.query;

    let query = `
      SELECT
          f.id,
          f.original_name,
          f.size_bytes,
          f.upload_date,
          f.stored_path,
          f.plot_name,
          f.project_id,
          f.latitude,
          f.longitude,
          f.status,
          f.processing_error,
          f.tree_midpoints,
          f.tree_heights_adjusted,       
          f.tree_dbhs_cm,                
          f.tree_count,                 
          f.tree_stem_volumes_m3,        
          f.assumed_d2_cm_for_volume,    
          f.tree_above_ground_volumes_m3, 
          f.tree_total_volumes_m3,        
          f.tree_biomass_tonnes,          
          f.tree_carbon_tonnes,           
          f.tree_co2_equivalent_tonnes,   
          p.name AS project_name,
          p.division_id,
          d.name AS division_name
      FROM uploaded_files f
      LEFT JOIN projects p ON f.project_id = p.id
      LEFT JOIN divisions d ON p.division_id = d.id
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

    // Filter by Division ID (via project)
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`p.division_id = $${queryParams.length}`);
    }

    // ADD PLOT NAME FILTER LOGIC
    if (plotName && typeof plotName === 'string' && plotName.trim() !== '' && plotName.toLowerCase() !== 'all') {
        queryParams.push(plotName.trim());
        whereConditions.push(`f.plot_name = $${queryParams.length}`);
    }

    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    query += ` ORDER BY f.upload_date DESC`;

    try {

        const result = await pool.query(query, queryParams);

        const formattedFiles = result.rows.map(formatFileRecord); // formatFileRecord should now get these new fields

        res.json(formattedFiles);
    } catch (error) {
        console.error("Database error fetching files. Query:", query, "Params:", queryParams, "Full Error:", error);
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
            const isEncrypted = file.stored_path.endsWith('.enc');
            if (isEncrypted) {
                try {
                    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
                    const stream = decryptToStream(absoluteFilePath, res);
                    stream.on('error', (err) => {
                        console.error(`Decryption stream error for ${file.original_name} (ID: ${fileId}):`, err);
                        if (!res.headersSent) res.status(500).json({ message: 'Error decrypting file for download.' });
                    });
                    stream.pipe(res);
                } catch (e) {
                    console.error(`Error preparing decryption for ${file.original_name} (ID: ${fileId}):`, e);
                    return res.status(500).json({ message: 'Error preparing encrypted file for download.' });
                }
            } else {
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
            }
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

    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN');

        const fileResult = await poolClient.query(
            "SELECT stored_path FROM uploaded_files WHERE id = $1 FOR UPDATE",
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


// --- Manual Potree Conversion Endpoint - REMOVED ---
// This endpoint has been removed as we no longer use Potree conversion.
// Files are now directly ready for the point cloud viewer after processing.

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
        const result = await pool.query(query, queryParams);
        let allDbhs = [];
        result.rows.forEach(row => {
            if (row.tree_dbhs_cm) {
                // Assuming tree_dbhs_cm is an object like {"treeID1": dbh1_cm, "treeID2": dbh2_cm}
                // We want to collect all the individual DBH values (which are numbers)
                allDbhs.push(...Object.values(row.tree_dbhs_cm).filter(d => typeof d === 'number'));
            }
        });
        res.json({ dbhs_cm: allDbhs }); // Send an array of DBH values in cm
    } catch (error) {
        console.error("Error fetching all tree DBHs (cm):", error);
        res.status(500).json({ message: "Server error fetching tree diameter data." });
    }
};

// --- NEW: Get SUM of all Tree Volumes (m³) for a card ---
exports.getSumTreeVolumesM3 = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query;

    // Base query structure
    let query = `
        SELECT f.tree_volumes_m3
        FROM uploaded_files f
    `;
    const queryParams = [];
    let joins = []; // To store necessary JOIN clauses
    let whereConditions = [
        "(f.status = 'ready' OR f.status = 'processed_ready_for_potree')", // Only from successfully processed files
        "f.tree_volumes_m3 IS NOT NULL" // Ensure the volume data exists
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
        // No need to add join again if already added for division
        if (!projectJoinAdded && divisionId && divisionId !== 'all') {
             // This case is unlikely if divisionId implies a project, but good for standalone project filter
        } else if (!projectJoinAdded) {
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
            projectJoinAdded = true; // Mark as added if filtering by project ID alone
        }
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

    // Append joins and where conditions to the base query
    if (joins.length > 0) {
        query += ` ${joins.join(' ')}`;
    }
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    try {
        console.log("Executing getSumTreeVolumesM3 query:", query, queryParams);
        const result = await pool.query(query, queryParams);
        let totalSum = 0;
        result.rows.forEach(row => {
            if (row.tree_volumes_m3) { // tree_volumes_m3 is like {"treeID1": vol1, "treeID2": vol2}
                Object.values(row.tree_volumes_m3).forEach(volume => {
                    if (typeof volume === 'number' && !isNaN(volume)) {
                        totalSum += volume;
                    }
                });
            }
        });
        res.json({ sum: totalSum }); // Send the sum
    } catch (error) {
        console.error("Error fetching sum of tree volumes (m³):", error);
        console.error("Query:", query);
        console.error("Params:", queryParams);
        res.status(500).json({ message: "Server error fetching sum of tree volume data." });
    }
};

// --- NEW: Get ALL Tree Volumes (m³) for histogram chart ---
exports.getAllTreeVolumesM3Data = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query;
    let query = `
        SELECT f.tree_stem_volumes_m3
        FROM uploaded_files f
    `;
    const queryParams = [];
    let joins = [];
    const whereConditions = [
        "(f.status = 'ready' OR f.status = 'processed_ready_for_potree')",
        "f.tree_stem_volumes_m3 IS NOT NULL"
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
        if (!projectJoinAdded && divisionId && divisionId !== 'all') {
            // Join already added if divisionId is present
        } else if (!projectJoinAdded) {
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
            projectJoinAdded = true;
        }
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
        const result = await pool.query(query, queryParams);
        let allVolumes = [];
        result.rows.forEach(row => {
            if (row.tree_stem_volumes_m3) { // <<< MUST MATCH YOUR DB COLUMN
                allVolumes.push(...Object.values(row.tree_stem_volumes_m3).filter(v => typeof v === 'number' && !isNaN(v)));
            }
        });
        res.json({ volumes_m3: allVolumes }); // Send an array of volume values in m³
    } catch (error) {
        console.error("Error fetching all tree volumes (m³) for chart:", error);
        console.error("Query:", query);
        console.error("Params:", queryParams);
        res.status(500).json({ message: "Server error fetching tree volume data for chart." });
    }
};

// --- NEW: Get SUM of all Tree Carbon (tonnes) for a card ---
exports.getSumTreeCarbonTonnes = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query;

    // Base query structure
    let query = `
        SELECT f.tree_carbon_tonnes -- Select the carbon data column
        FROM uploaded_files f
    `;
    const queryParams = [];
    let joins = []; // To store necessary JOIN clauses
    let whereConditions = [
        "(f.status = 'ready' OR f.status = 'processed_ready_for_potree')", // Only from successfully processed files
        "f.tree_carbon_tonnes IS NOT NULL" // Ensure the carbon data exists
    ];

    let projectJoinAdded = false;

    // --- Filtering logic (consistent with your other sum/get all endpoints) ---
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
        // No need to add join again if already added for division
        if (!projectJoinAdded) { // Only add join if not already added by division filter
            joins.push('LEFT JOIN projects p ON f.project_id = p.id');
            // projectJoinAdded = true; // Not strictly necessary to set again, but good for clarity if this block was standalone
        }
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
    // --- End of Filtering Logic ---

    // Append joins and where conditions to the base query
    if (joins.length > 0) {
        query += ` ${joins.join(' ')}`;
    }
    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    try {
        const result = await pool.query(query, queryParams);
        let totalCarbonSum = 0;

        result.rows.forEach(row => {
            if (row.tree_carbon_tonnes) { // tree_carbon_tonnes is like {"treeID1": carbon1, "treeID2": carbon2}
                Object.values(row.tree_carbon_tonnes).forEach(carbonValue => {
                    if (typeof carbonValue === 'number' && !isNaN(carbonValue)) {
                        totalCarbonSum += carbonValue;
                    }
                });
            }
        });

        // Round to a reasonable number of decimal places, e.g., 3 for tonnes
        totalCarbonSum = parseFloat(totalCarbonSum.toFixed(3));

        res.json({ sum_carbon_tonnes: totalCarbonSum }); // Send the sum
    } catch (error) {
        console.error("Error fetching sum of tree carbon (tonnes):", error);
        console.error("Query:", query);
        console.error("Params:", queryParams);
        res.status(500).json({ message: "Server error fetching sum of tree carbon data." });
    }
}

// --- NEW: Get detailed tree data for Excel export ---
exports.getDetailedTreeDataForExport = async (req, res) => {
    const { projectId, divisionId, plotName } = req.query;
    
    let query = `
        SELECT 
            f.id as file_id,
            f.original_name as file_name,
            f.plot_name,
            f.tree_count,
            f.latitude as file_latitude,
            f.longitude as file_longitude,
            f.tree_midpoints,
            f.tree_heights_adjusted,
            f.tree_dbhs_cm,
            f.tree_stem_volumes_m3,
            f.tree_above_ground_volumes_m3,
            f.tree_total_volumes_m3,
            f.tree_biomass_tonnes,
            f.tree_carbon_tonnes,
            f.tree_co2_equivalent_tonnes,
            f.assumed_d2_cm_for_volume,
            f.upload_date,
            p.name as project_name,
            d.name as division_name
        FROM uploaded_files f
        LEFT JOIN projects p ON f.project_id = p.id
        LEFT JOIN divisions d ON p.division_id = d.id
    `;
    
    const queryParams = [];
    const whereConditions = [
        "f.status = 'ready'" // Only export data from successfully processed files
    ];

    // Filter by Division ID
    if (divisionId && divisionId !== 'all' && !isNaN(parseInt(divisionId))) {
        queryParams.push(parseInt(divisionId));
        whereConditions.push(`d.id = $${queryParams.length}`);
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

    if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    query += ` ORDER BY f.upload_date DESC`;

    try {
        const result = await pool.query(query, queryParams);
        
        // Transform the data into a flat structure for Excel export
        const exportData = [];
        
        result.rows.forEach(file => {
            if (file.tree_midpoints && typeof file.tree_midpoints === 'object') {
                // Process each tree in the file
                Object.keys(file.tree_midpoints).forEach(treeId => {
                    const midpoint = file.tree_midpoints[treeId];
                    if (midpoint && typeof midpoint.latitude === 'number' && typeof midpoint.longitude === 'number') {
                        const treeData = {
                            // File information
                            file_id: file.file_id,
                            file_name: file.file_name,
                            plot_name: file.plot_name || 'N/A',
                            division_name: file.division_name || 'N/A',
                            project_name: file.project_name || 'Unassigned',
                            upload_date: file.upload_date ? new Date(file.upload_date).toLocaleDateString() : 'N/A',
                            
                            // Tree information
                            tree_id: treeId,
                            tree_latitude: midpoint.latitude,
                            tree_longitude: midpoint.longitude,
                            
                            // Tree measurements
                            tree_height_m: file.tree_heights_adjusted && file.tree_heights_adjusted[treeId] !== undefined 
                                ? file.tree_heights_adjusted[treeId] : 'N/A',
                            tree_dbh_cm: file.tree_dbhs_cm && file.tree_dbhs_cm[treeId] !== undefined 
                                ? file.tree_dbhs_cm[treeId] : 'N/A',
                            tree_stem_volume_m3: file.tree_stem_volumes_m3 && file.tree_stem_volumes_m3[treeId] !== undefined 
                                ? file.tree_stem_volumes_m3[treeId] : 'N/A',
                            tree_above_ground_volume_m3: file.tree_above_ground_volumes_m3 && file.tree_above_ground_volumes_m3[treeId] !== undefined 
                                ? file.tree_above_ground_volumes_m3[treeId] : 'N/A',
                            tree_total_volume_m3: file.tree_total_volumes_m3 && file.tree_total_volumes_m3[treeId] !== undefined 
                                ? file.tree_total_volumes_m3[treeId] : 'N/A',
                            tree_biomass_tonnes: file.tree_biomass_tonnes && file.tree_biomass_tonnes[treeId] !== undefined 
                                ? file.tree_biomass_tonnes[treeId] : 'N/A',
                            tree_carbon_tonnes: file.tree_carbon_tonnes && file.tree_carbon_tonnes[treeId] !== undefined 
                                ? file.tree_carbon_tonnes[treeId] : 'N/A',
                            tree_co2_equivalent_tonnes: file.tree_co2_equivalent_tonnes && file.tree_co2_equivalent_tonnes[treeId] !== undefined 
                                ? file.tree_co2_equivalent_tonnes[treeId] : 'N/A',
                            
                            // Additional file-level data
                            file_latitude: file.file_latitude,
                            file_longitude: file.file_longitude,
                            tree_count_in_file: file.tree_count || 0,
                            assumed_d2_cm_for_volume: file.assumed_d2_cm_for_volume || 'N/A'
                        };
                        
                        exportData.push(treeData);
                    }
                });
            }
        });

        res.json({ 
            success: true, 
            data: exportData,
            total_trees: exportData.length,
            total_files: result.rows.length
        });
        
    } catch (error) {
        console.error("Error fetching detailed tree data for export:", error);
        console.error("Query:", query);
        console.error("Params:", queryParams);
        res.status(500).json({ message: "Server error fetching detailed tree data for export." });
    }
};;