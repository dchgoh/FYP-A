const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/

// Create a new Project (Admin Only)
exports.createProject = async (req, res) => {
    // *** MODIFIED: Added divisionId ***
    const { name, description, divisionId } = req.body;

    // --- Validation ---
    if (!name || name.trim() === "") {
        return res.status(400).json({ success: false, message: "Project name required." });
    }
    // *** MODIFIED: Validate divisionId ***
    if (!divisionId || isNaN(parseInt(divisionId))) {
        return res.status(400).json({ success: false, message: "Valid Division ID required." });
    }
    const cleanDivisionId = parseInt(divisionId);
    const cleanName = name.trim();

    let poolClient;
    try {
        poolClient = await pool.connect();

        // *** MODIFIED: Check if Division exists ***
        const divisionCheck = await poolClient.query("SELECT 1 FROM divisions WHERE id = $1", [cleanDivisionId]);
        if (divisionCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: `Division with ID ${cleanDivisionId} not found.` });
        }

        // *** MODIFIED: Include division_id in INSERT ***
        const result = await poolClient.query(
            "INSERT INTO projects (name, description, division_id) VALUES ($1, $2, $3) RETURNING id, name, description, division_id, created_at",
            [cleanName, description || null, cleanDivisionId]
        );

        res.status(201).json({ success: true, project: result.rows[0] });

    } catch (error) {
        console.error("Error creating project:", error);
        // *** MODIFIED: Update unique constraint name and message ***
        if (error.code === '23505' && error.constraint === 'uq_division_project_name') { // Adjusted constraint name
            return res.status(409).json({ success: false, message: `Project with name "${cleanName}" already exists in this division.` });
        }
        res.status(500).json({ success: false, message: "Server error creating project." });
    } finally {
         if (poolClient) {
            try { poolClient.release(); } catch (e) { console.error("Error releasing client", e)}
         }
    }
};

// Get all Projects, optionally filtered by division (All logged-in users)
exports.getProjects = async (req, res) => {
    // *** MODIFIED: Optional filtering and join with divisions ***
    const { divisionId } = req.query; // Get optional divisionId from query string

    let query = `
        SELECT
            p.id,
            p.name,
            p.description,
            p.division_id,
            d.name AS division_name
        FROM projects p
        JOIN divisions d ON p.division_id = d.id
    `;
    const queryParams = [];

    if (divisionId && !isNaN(parseInt(divisionId))) {
        query += " WHERE p.division_id = $1";
        queryParams.push(parseInt(divisionId));
    }

    query += " ORDER BY d.name ASC, p.name ASC"; // Order by division name, then project name

    try {
        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching projects:", error);
        res.status(500).json({ success: false, message: "Server error fetching projects." });
    }
};

// Assign Data Manager to Project (Admin Only)
exports.assignDataManager = async (req, res) => {
    const projectId = parseInt(req.params.projectId);
    const { userId } = req.body;

    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: "Invalid project ID." });
    }
    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({ success: false, message: "Invalid or missing user ID." });
    }
    const managerUserId = parseInt(userId);

    let poolClient;
    try {
        poolClient = await pool.connect(); // Use a client for validation checks

        // --- Validation Step 1: Check if project exists ---
        const projectCheck = await poolClient.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
        if (projectCheck.rowCount === 0) {
             poolClient.release();
            return res.status(404).json({ success: false, message: "Project not found." });
        }

        // --- Validation Step 2: Check if user exists and is a Data Manager ---
        const userCheck = await poolClient.query("SELECT role FROM users WHERE id = $1", [managerUserId]);
        if (userCheck.rowCount === 0) {
             poolClient.release();
            return res.status(404).json({ success: false, message: "User not found." });
        }
        if (userCheck.rows[0].role !== ROLES.DATA_MANAGER) {
             poolClient.release();
            return res.status(400).json({ success: false, message: "User is not a Data Manager." });
        }

        // --- Perform Assignment ---
        await pool.query( // Can use pool directly, ON CONFLICT handles potential races
            "INSERT INTO project_data_managers (user_id, project_id) VALUES ($1, $2) ON CONFLICT (user_id, project_id) DO NOTHING",
            [managerUserId, projectId]
        );

        res.status(201).json({ success: true, message: "Data Manager assigned successfully." });

    } catch (error) {
        console.error("Error assigning data manager:", error);
        res.status(500).json({ success: false, message: "Server error assigning data manager." });
    } finally {
        if (poolClient) {
             poolClient.release(); // Ensure client is always released
        }
    }
};

// Get Data Managers for a Project (Admin Only)
exports.getProjectDataManagers = async (req, res) => {
    const projectId = parseInt(req.params.projectId);

    if (isNaN(projectId)) {
        return res.status(400).json({ message: "Invalid project ID." });
    }

    try {
        // Verify project exists
        const projectResult = await pool.query("SELECT 1 FROM projects WHERE id = $1", [projectId]);
        if (projectResult.rowCount === 0) {
            return res.status(404).json({ message: "Project not found." });
        }

        // Query users joined with assignments for this project
        const assignmentsResult = await pool.query(
            `SELECT u.id, u.username, u.email
             FROM users u
             JOIN project_data_managers pdm ON u.id = pdm.user_id
             WHERE pdm.project_id = $1 AND u.role = $2 -- Use role parameter
             ORDER BY u.username ASC`,
            [projectId, ROLES.DATA_MANAGER] // Pass role as parameter
        );

        res.json(assignmentsResult.rows);

    } catch (error) {
        console.error(`Error fetching data managers for project ${projectId}:`, error);
        res.status(500).json({ message: "Server error fetching assigned data managers." });
    }
};

// Unassign Data Manager from Project (Admin Only)
exports.unassignDataManager = async (req, res) => {
    const projectId = parseInt(req.params.projectId);
    const managerUserId = parseInt(req.params.userId);

    if (isNaN(projectId) || isNaN(managerUserId)) {
        return res.status(400).json({ message: "Invalid project ID or user ID." });
    }

    try {
        const result = await pool.query(
            "DELETE FROM project_data_managers WHERE user_id = $1 AND project_id = $2",
            [managerUserId, projectId]
        );

        if (result.rowCount === 0) {
            // It's okay if not found, might have been already unassigned or IDs were wrong
            return res.status(404).json({ message: "Assignment not found or user/project invalid." });
        }

        res.status(200).json({ success: true, message: "Data Manager unassigned from project successfully." });

    } catch (error) {
        console.error("Error unassigning data manager:", error);
        res.status(500).json({ message: "Server error unassigning data manager." });
    }
};

// Get Projects assigned to the Current User (Data Managers mainly)
exports.getMyAssignedProjects = async (req, res) => {
    const userId = req.user.userId; // From protect middleware
    const userRole = req.user.role;

    // Admins/Regulars conceptually have access to all/none via this specific mechanism
    if (userRole === ROLES.ADMIN || userRole === ROLES.REGULAR) {
        // Admins could potentially see *all* projects via getProjects.
        // Regulars see none via this route.
        return res.json({ assignedProjectIds: [] });
    }

    if (userRole === ROLES.DATA_MANAGER) {
        try {
            const result = await pool.query(
                "SELECT project_id FROM project_data_managers WHERE user_id = $1",
                [userId]
            );
            const assignedIds = result.rows.map(row => row.project_id);
            res.json({ assignedProjectIds: assignedIds });
        } catch (error) {
            console.error("Error fetching user's assigned projects:", error);
            res.status(500).json({ success: false, message: "Server error fetching assigned projects." });
        }
    } else {
        // Fallback for unexpected roles
        console.warn(`User ${userId} has unexpected role ${userRole} accessing assigned projects.`);
        res.json({ assignedProjectIds: [] });
    }
};

// Delete a Project (Admin Only)
exports.deleteProject = async (req, res) => {
    const projectId = parseInt(req.params.projectId);

    if (isNaN(projectId)) {
        return res.status(400).json({ success: false, message: "Invalid project ID." });
    }

    let poolClient;
    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN'); // Start transaction

        // Check if project exists
        const checkResult = await poolClient.query("SELECT 1 FROM projects WHERE id = $1 FOR UPDATE", [projectId]); // Lock row
        if (checkResult.rowCount === 0) {
            await poolClient.query('ROLLBACK');
            poolClient.release();
            return res.status(404).json({ success: false, message: "Project not found." });
        }

        // Perform the deletion - Cascades will handle related data
        await poolClient.query("DELETE FROM projects WHERE id = $1", [projectId]);

        await poolClient.query('COMMIT'); // Commit transaction
        poolClient.release();

        res.status(200).json({ success: true, message: "Project deleted successfully." });

    } catch (error) {
        console.error(`Error deleting project ${projectId}:`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
            finally { poolClient.release(); } // Ensure release even on rollback error
        }
        res.status(500).json({ success: false, message: "Server error deleting project." });
    }
    // No finally block needed here as it's handled within try/catch for poolClient
};