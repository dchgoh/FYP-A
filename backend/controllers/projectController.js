const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/

// Create a new Project (Admin Only)
exports.createProject = async (req, res) => {
    const { name, description } = req.body;
    if (!name || name.trim() === "") {
        return res.status(400).json({ success: false, message: "Project name required." });
    }
    try {
        const result = await pool.query(
            "INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at",
            [name.trim(), description || null]
        );
        res.status(201).json({ success: true, project: result.rows[0] });
    } catch (error) {
        console.error("Error creating project:", error);
        if (error.code === '23505' && error.constraint === 'projects_name_key') {
            return res.status(409).json({ success: false, message: `Project with name "${name.trim()}" already exists.` });
        }
        res.status(500).json({ success: false, message: "Server error creating project." });
    }
};

// Get all Projects (All logged-in users)
exports.getProjects = async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name FROM projects ORDER BY name ASC");
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
        // Can use the pool directly for the simple insert or the client
        await pool.query( // Changed back to pool for simplicity, as ON CONFLICT handles race conditions
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
        return res.json({ assignedProjectIds: [] }); // Return empty for non-DMs
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

    // Note: DB constraints handle related record cleanup (files set to NULL, assignments deleted)

    let poolClient;
    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN'); // Start transaction

        // Check if project exists
        const checkResult = await poolClient.query("SELECT 1 FROM projects WHERE id = $1 FOR UPDATE", [projectId]); // Lock row
        if (checkResult.rowCount === 0) {
            await poolClient.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Project not found." });
        }

        // Perform the deletion
        // Constraints ON DELETE SET NULL (files) and ON DELETE CASCADE (assignments) handle related data
        await poolClient.query("DELETE FROM projects WHERE id = $1", [projectId]);

        await poolClient.query('COMMIT'); // Commit transaction

        res.status(200).json({ success: true, message: "Project deleted successfully." });

    } catch (error) {
        console.error(`Error deleting project ${projectId}:`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
        }
        res.status(500).json({ success: false, message: "Server error deleting project." });
    } finally {
        if (poolClient) {
            poolClient.release(); // Release client back to the pool
        }
    }
};