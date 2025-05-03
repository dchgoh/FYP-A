const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/

// Create a new Division (Admin Only)
exports.createDivision = async (req, res) => {
    const { name, description } = req.body;
    if (!name || name.trim() === "") {
        return res.status(400).json({ success: false, message: "Division name required." });
    }
    try {
        const result = await pool.query(
            "INSERT INTO divisions (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at",
            [name.trim(), description || null]
        );
        res.status(201).json({ success: true, division: result.rows[0] });
    } catch (error) {
        console.error("Error creating division:", error);
        if (error.code === '23505' && error.constraint === 'divisions_name_key') {
            return res.status(409).json({ success: false, message: `Division with name "${name.trim()}" already exists.` });
        }
        res.status(500).json({ success: false, message: "Server error creating division." });
    }
};

// Get all Divisions (All logged-in users)
exports.getDivisions = async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name FROM divisions ORDER BY name ASC");
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching divisions:", error);
        res.status(500).json({ success: false, message: "Server error fetching divisions." });
    }
};

// Delete a Division (Admin Only)
exports.deleteDivision = async (req, res) => {
    const divisionId = parseInt(req.params.divisionId);

    if (isNaN(divisionId)) {
        return res.status(400).json({ success: false, message: "Invalid division ID." });
    }

    // Note: DB constraints handle related record cleanup (files set to NULL, assignments deleted)

    let poolClient;
    try {
        poolClient = await pool.connect();
        await poolClient.query('BEGIN'); // Start transaction

        // Check if division exists
        const checkResult = await poolClient.query("SELECT 1 FROM divisions WHERE id = $1 FOR UPDATE", [divisionId]); // Lock row
        if (checkResult.rowCount === 0) {
            await poolClient.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Division not found." });
        }

        // Perform the deletion
        // Constraints ON DELETE SET NULL (files) and ON DELETE CASCADE (assignments) handle related data
        await poolClient.query("DELETE FROM divisions WHERE id = $1", [divisionId]);

        await poolClient.query('COMMIT'); // Commit transaction

        res.status(200).json({ success: true, message: "Division deleted successfully." });

    } catch (error) {
        console.error(`Error deleting division ${divisionId}:`, error);
        if (poolClient) {
            try { await poolClient.query('ROLLBACK'); } catch (rbErr) { console.error("Rollback error:", rbErr); }
        }
        res.status(500).json({ success: false, message: "Server error deleting division." });
    } finally {
        if (poolClient) {
            poolClient.release(); // Release client back to the pool
        }
    }
};