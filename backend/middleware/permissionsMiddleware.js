const { pool } = require('../config/db'); // Import the pool
const ROLES = require('../config/roles'); // Import roles

// Function: Check Role Middleware
const checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ success: false, message: 'Not authorized, user role not found.' });
        }
        // Allow Administrator to access everything
        if (req.user.role === ROLES.ADMIN) { // Use ROLES constant
            return next();
        }
        // Check if the user has the required role
        const hasRole = Array.isArray(requiredRole)
            ? requiredRole.includes(req.user.role)
            : req.user.role === requiredRole;

        if (hasRole) {
            next();
        } else {
            return res.status(403).json({ success: false, message: `Forbidden: Role ${req.user.role} not authorized.` });
        }
    };
};

// Function: Check Data Manager Project Assignment Middleware
const checkProjectAssignment = async (req, res, next) => {
    // Admins always have access
    if (req.user.role === ROLES.ADMIN) { // Use ROLES constant
        return next();
    }
    // Only applies to Data Managers for specific checks
    if (req.user.role !== ROLES.DATA_MANAGER) { // Use ROLES constant
        return next(); // Other roles pass through, main checkRole handles general access
    }

    const userId = req.user.userId;
    // Try to get fileId from different potential param names
    const fileIdParam = req.params.id || req.params.fileId;
    const fileId = fileIdParam ? parseInt(fileIdParam) : null;

    // If the action *requires* a file ID and it's missing, the route handler should fail.
    // Here, we only proceed with the check if a valid file ID is present.
    if (!fileId || isNaN(fileId)) {
        console.warn("checkProjectAssignment: No valid file ID found in params for Data Manager check. Letting route handle potential errors.");
        return next(); // Let the route decide if fileId was mandatory
    }

    let poolClient; // Use a temporary client from the main pool
    try {
         // Use the main pool here
        poolClient = await pool.connect();
        const fileResult = await poolClient.query(
            "SELECT project_id FROM uploaded_files WHERE id = $1",
            [fileId]
        );

        if (fileResult.rows.length === 0) {
            // File not found - let the main route handler return 404
            return next();
        }

        const fileProjectId = fileResult.rows[0].project_id;

        // Data Managers CANNOT act on unassigned files (for restricted actions like delete/patch/download)
        if (fileProjectId === null) {
            console.log(`Data Manager (${userId}) access denied for UNASSIGNED file (${fileId})`);
             // Check the requested method or path pattern if needed for more fine-grained control
            // Example: if (['DELETE', 'PATCH'].includes(req.method)) { ... }
            return res.status(403).json({ success: false, message: "Forbidden: Data Managers cannot perform this action on unassigned files." });
        }

        // Check if the Data Manager is assigned to this project
        const assignmentResult = await poolClient.query(
            "SELECT 1 FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
            [userId, fileProjectId]
        );

        if (assignmentResult.rowCount > 0) {
            return next(); // Assigned, allow access
        } else {
            console.log(`Data Manager (${userId}) access denied for file (${fileId}) in project (${fileProjectId}) - Not assigned.`);
            return res.status(403).json({ success: false, message: "Forbidden: You are not assigned to manage this project's files." });
        }
    } catch (error) {
        console.error("Error in checkProjectAssignment:", error);
        return res.status(500).json({ success: false, message: "Server error checking project permissions." });
    } finally {
        if (poolClient) poolClient.release(); // Release client back to the pool
    }
};

module.exports = { checkRole, checkProjectAssignment };