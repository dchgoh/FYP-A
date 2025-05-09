const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require("child_process");
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
        project_id: dbRecord.project_id,
        plot_name: dbRecord.plot_name,
        latitude: dbRecord.latitude,
        longitude: dbRecord.longitude,
        status: dbRecord.status || 'unknown',
        processing_error: dbRecord.processing_error || null,
        // --- CORRECTED LINE ---
        tree_midpoints: dbRecord.tree_midpoints || null, // Access from dbRecord, default to null
        // ----------------------
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

// --- File Upload Controller Function ---
exports.uploadFile = async (req, res) => {
    // 1. Check if file exists in request
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    // 2. Extract details from request file and body
    const { originalname, filename, path: stored_path_absolute, mimetype, size } = req.file;
    const { plot_name, project_id } = req.body;
    const stored_path_relative = path.join('uploads', filename); // Relative path for DB

    // 3. Validate project_id input
    let cleanProjectId = null;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
        cleanProjectId = parseInt(project_id);
        if (isNaN(cleanProjectId)) {
            // Cleanup file if ID is invalid and return error
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload file on invalid project ID:", err); });
            return res.status(400).json({ success: false, message: "Invalid Project ID format." });
        }
    }

    let savedFileRecord;
    let fileIdToUpdate;

    try {
        // 4. Check if target Project exists in DB (if provided)
        if (cleanProjectId !== null) {
            const projectCheck = await pool.query("SELECT 1 FROM projects WHERE id = $1", [cleanProjectId]);
            if (projectCheck.rowCount === 0) {
                // Cleanup file if project doesn't exist and return error
                fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting upload file for non-existent project:", err); });
                return res.status(404).json({ success: false, message: `Project with ID ${cleanProjectId} not found.` });
            }
        }

        // 5. Initial Database Insert
        // Insert the basic file record, setting calculated fields to NULL initially
        const result = await pool.query(
            `INSERT INTO uploaded_files
             (original_name, stored_filename, stored_path, mime_type, size_bytes, latitude, longitude, plot_name, project_id, tree_midpoints, status)
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, NULL, 'uploaded')
             RETURNING id, original_name, size_bytes, upload_date, stored_path, project_id, plot_name, latitude, longitude, status, tree_midpoints`, // Return the newly inserted data, including null tree_midpoints
            [originalname, filename, stored_path_relative, mimetype, size, plot_name || null, cleanProjectId]
        );

        // Check if insert was successful and returned an ID
        if (result.rows.length === 0 || !result.rows[0].id) {
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload file after failed DB insert:", err); });
            throw new Error("Failed to insert file record or retrieve its ID.");
        }

        fileIdToUpdate = result.rows[0].id; // Get the ID of the new record
        // Format the initially saved record (includes tree_midpoints: null)
        savedFileRecord = formatFileRecord({
             ...result.rows[0],
             division_id: null, // Not available from this query
             division_name: null,
             project_name: null
        });


        // 6. Respond Immediately to Client (201 Created)
        // Let the client know the upload was accepted and processing will start
        res.status(201).json({
            success: true,
            message: "File upload accepted, processing coordinates and tree data in background.",
            file: savedFileRecord // Send back the initial record data
        });

        // ---------------------------------------------------------------------
        // 7. Trigger Python Script Asynchronously (AFTER RESPONSE HAS BEEN SENT)
        // ---------------------------------------------------------------------
        const pythonScriptName = 'process_las.py'; // Keeping the name as requested
        const pythonScriptPath = path.resolve(__dirname, '..', pythonScriptName); // Adjust path if needed
        const pythonCommand = 'python'; // Or 'python3'

        // Check if the script file exists
        if (!fs.existsSync(pythonScriptPath)) {
            console.error(`Node Error (FileID ${fileIdToUpdate}): Python script not found at ${pythonScriptPath}. Cannot process file.`);
            // Update DB status to 'failed' because the script is missing
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Python script not found: ${pythonScriptName}`, fileIdToUpdate]);
            } catch (dbErr) { console.error(`Node DB Error (FileID ${fileIdToUpdate}): Failed to update status after script missing error:`, dbErr); }
            return; // Stop processing for this file
        }

        console.log(`Node (FileID ${fileIdToUpdate}): Spawning Python script "${pythonScriptPath}" with arg "${stored_path_absolute}"`);
        // Spawn the Python process, passing the absolute path to the uploaded file
        const pythonProcess = spawn(pythonCommand, [pythonScriptPath, stored_path_absolute]);

        let stdoutData = ''; // Buffer for Python's standard output (expected JSON)
        let stderrData = ''; // Buffer for Python's standard error (logs/errors)

        // Capture standard output
        pythonProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });
        // Capture standard error
        pythonProcess.stderr.on('data', (data) => {
            const errorMsg = data.toString().trim();
            if (errorMsg) {
                stderrData += errorMsg + '\n';
                // Log Python's stderr messages immediately for debugging
                console.error(`Python stderr (FileID ${fileIdToUpdate}): ${errorMsg}`);
            }
        });

        // Handle errors related to *starting* the Python process itself
        pythonProcess.on('error', async (error) => {
            console.error(`Node Error (FileID ${fileIdToUpdate}): Failed to start Python process. Cmd: ${pythonCommand}. Err: ${error.message}`);
            // Update DB status to 'failed'
            try {
                await pool.query("UPDATE uploaded_files SET status = 'failed', processing_error = $1 WHERE id = $2", [`Failed to start Python process: ${error.message}`, fileIdToUpdate]);
            } catch (dbErr) { console.error(`Node DB Error (FileID ${fileIdToUpdate}): Failed to update status after spawn error:`, dbErr); }
        });

        // --- Handle Python Process Completion ---
        pythonProcess.on('close', async (code) => {
            console.log(`Node (FileID ${fileIdToUpdate}): Python script (${pythonScriptName}) exited with code ${code}.`);

            let updateQuery = ''; // To build the final SQL UPDATE statement
            let queryParams = []; // Parameters for the SQL query
            let finalStatus = 'failed'; // Default status assumes failure
            let processingError = `Python script exited with code ${code}. Check Python stderr logs.`; // Default error message

            // --- Process Python Output if Exit Code is 0 (Success) AND stdout has data ---
            if (code === 0 && stdoutData) {
                try {
                    // Attempt to parse the JSON output from Python's stdout
                    const resultData = JSON.parse(stdoutData.trim());
                    console.log(`Node (FileID ${fileIdToUpdate}): Received and parsed JSON from Python.`);

                    // Safely extract all expected data fields from the parsed JSON
                    const calculatedLat = resultData.latitude !== undefined ? resultData.latitude : null;
                    const calculatedLon = resultData.longitude !== undefined ? resultData.longitude : null;
                    const midpointsWGS84 = resultData.tree_midpoints_wgs84 !== undefined ? resultData.tree_midpoints_wgs84 : null;
                    const pythonWarnings = resultData.warnings || [];
                    const pythonErrors = resultData.errors || [];

                    // Log any warnings or non-fatal errors reported *within* the JSON by Python
                    if (pythonWarnings.length > 0) console.warn(`Node Warn (FileID ${fileIdToUpdate}): Python reported warnings:`, pythonWarnings);
                    if (pythonErrors.length > 0) console.error(`Node Error (FileID ${fileIdToUpdate}): Python reported errors:`, pythonErrors);

                    // --- Print Midpoints to Node.js Console (as requested) ---
                    if (midpointsWGS84 && typeof midpointsWGS84 === 'object' && Object.keys(midpointsWGS84).length > 0) {
                        console.info(`--- Calculated Tree Midpoints (WGS84 Lon/Lat) for File ID: ${fileIdToUpdate} ---`);
                        const sortedTreeIds = Object.keys(midpointsWGS84).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
                        for (const treeId of sortedTreeIds) {
                            const midpoint = midpointsWGS84[treeId];
                            if (midpoint && midpoint.longitude !== null && midpoint.latitude !== null) {
                                console.info(`  Tree ID ${treeId}: Lon=${midpoint.longitude.toFixed(6)}, Lat=${midpoint.latitude.toFixed(6)} (Z Orig=${midpoint.z_original.toFixed(2)})`);
                            } else if (midpoint && midpoint.error) {
                                console.warn(`  Tree ID ${treeId}: Midpoint transformation failed (${midpoint.error})`);
                            } else {
                                console.warn(`  Tree ID ${treeId}: Midpoint data incomplete or missing.`);
                            }
                        }
                        console.info(`---------------------------------------------------------------`);
                    } else {
                        console.info(`Node (FileID ${fileIdToUpdate}): No tree midpoints were calculated or returned by Python.`);
                    }
                    // --- End of Printing Midpoints ---

                    // Prepare midpoints data for DB (stringify the object, handle null)
                    const midpointsJsonString = midpointsWGS84 ? JSON.stringify(midpointsWGS84) : null;

                    // Determine the final database status based on Python's internal errors
                    if (pythonErrors.length > 0) {
                        finalStatus = 'processed_with_errors'; // Python finished but reported problems
                        processingError = `Python completed with errors: ${pythonErrors.join('; ')}`;
                    } else {
                        finalStatus = 'processed'; // Python finished cleanly
                        // If Potree conversion is a separate step, 'processed' is appropriate here.
                        // If this IS the final step, you might use 'ready'.
                        processingError = null; // Clear any previous errors
                    }

                    // Construct the final UPDATE query
                    updateQuery = `UPDATE uploaded_files
                                   SET latitude = $1,
                                       longitude = $2,
                                       tree_midpoints = $3,
                                       status = $4,
                                       processing_error = $5
                                   WHERE id = $6`;
                    queryParams = [calculatedLat, calculatedLon, midpointsJsonString, finalStatus, processingError, fileIdToUpdate];

                } catch (parseError) {
                    // Handle cases where Python's stdout wasn't valid JSON
                    console.error(`Node Error (FileID ${fileIdToUpdate}): Error parsing Python JSON output: ${parseError}\nRaw Python stdout: >>>${stdoutData}<<<`);
                    processingError = `Failed to parse Python output: ${parseError.message}`;
                    finalStatus = 'failed';
                    // Prepare query to only update status and error message
                    updateQuery = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                    queryParams = [finalStatus, processingError, fileIdToUpdate];
                }
            } else {
                // Handle cases where Python exited non-zero or produced no stdout data
                if (code !== 0) {
                    processingError = `Python script failed (exit code ${code}). Stderr: ${stderrData.substring(0, 500)}...`; // Include captured stderr
                    console.error(`Node Error (FileID ${fileIdToUpdate}): ${processingError}`);
                } else { // code === 0 but no stdoutData
                    processingError = `Python script finished successfully but produced no JSON output.`;
                    console.warn(`Node Warn (FileID ${fileIdToUpdate}): ${processingError}`);
                }
                finalStatus = 'failed';
                // Prepare query to only update status and error message
                updateQuery = `UPDATE uploaded_files SET status = $1, processing_error = $2 WHERE id = $3`;
                queryParams = [finalStatus, processingError, fileIdToUpdate];
            }

            // --- Execute the Database Update Query ---
            if (updateQuery) {
                try {
                    const updateResult = await pool.query(updateQuery, queryParams);
                    if (updateResult.rowCount > 0) {
                        console.log(`Node (FileID ${fileIdToUpdate}): DB status/data update successful (Status: ${finalStatus}).`);
                    } else {
                        // This might happen if the file record was deleted manually between steps
                        console.warn(`Node Warn (FileID ${fileIdToUpdate}): DB status/data update affected 0 rows (ID ${fileIdToUpdate} might have been deleted?).`);
                    }
                } catch (dbError) {
                    // Log errors during the final database update attempt
                    console.error(`Node DB Error (FileID ${fileIdToUpdate}): Error updating status/data after Python script:`, dbError);
                    console.error(`Attempted Query: ${updateQuery}`); // Log the query
                    console.error(`Attempted Params:`, queryParams); // Log the parameters
                }
            }
        }); // --- End of pythonProcess.on('close') ---

    } catch (error) { // Catch errors from the initial synchronous part (DB insert, checks, etc.)
        console.error("Node Error: Error during initial file upload processing or Python spawn setup:", error);
        // Attempt cleanup only if the file path was determined
        if (stored_path_absolute && fs.existsSync(stored_path_absolute)) {
            fs.unlink(stored_path_absolute, (err) => { if (err && err.code !== 'ENOENT') console.error("Error deleting orphaned upload file on initial failure:", err); });
        }
        // Send error response if not already sent
        if (!res.headersSent) {
             if (error.code === '23503' && error.constraint === 'fk_project') { // Specific FK error
                res.status(404).json({ success: false, message: "Assign failed: Target project does not exist." });
             } else { // Generic server error
                 res.status(500).json({ success: false, message: "Server error during file upload process." });
             }
        } else {
             // Log error if response was already sent (background processing failed)
             console.error(`Node Error occurred after response was sent for file ${filename || 'unknown'}. Background processing failed.`);
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
        const outBase = path.resolve(__dirname, "../..", "public", "pointclouds"); // Base directory for Potree data
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