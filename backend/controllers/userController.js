const bcrypt = require('bcrypt');
const { pool } = require('../config/db'); // Adjust path relative to controllers/
const ROLES = require('../config/roles'); // Adjust path relative to controllers/

// Get all users
exports.getUsers = async (req, res) => {
    try {
        // Select only necessary, non-sensitive fields
        const result = await pool.query("SELECT id, username, email, age, role, is_locked FROM users ORDER BY id ASC");
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Server error fetching users." });
    }
};

// Add a new user (Admin Only)
exports.addUser = async (req, res) => {
    const { username, email, password, age, role } = req.body;

    // Basic validation
    if (!username || !email || !password || !role) {
        return res.status(400).json({ message: "Username, email, password, and role are required." });
    }
    if (![ROLES.ADMIN, ROLES.DATA_MANAGER, ROLES.REGULAR].includes(role)) {
        return res.status(400).json({ message: "Invalid role specified." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            "INSERT INTO users (username, email, password, age, role) VALUES ($1, $2, $3, $4, $5)",
            [username, email, hashedPassword, age, role]
        );
        res.status(201).json({ message: "User added successfully" });
    } catch (error) {
        console.error("Error adding user:", error);
        if (error.code === '23505') { // Unique violation
            // Determine which field caused the violation (more specific message)
            const constraint = error.constraint;
            let field = 'field';
            if (constraint === 'users_username_key') field = 'username';
            if (constraint === 'users_email_key') field = 'email';
            return res.status(409).json({ message: `Error: The ${field} '${req.body[field]}' already exists.` });
        }
        res.status(500).json({ message: "Server error adding user." });
    }
};

// Update a user (Admin Only)
exports.updateUser = async (req, res) => {
    const userId = parseInt(req.params.id);
    const { username, email, password, age, role } = req.body;

    if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    if (role && ![ROLES.ADMIN, ROLES.DATA_MANAGER, ROLES.REGULAR].includes(role)) {
        return res.status(400).json({ message: "Invalid role specified." });
    }

    let query = "UPDATE users SET ";
    const values = [];
    let valueIndex = 1;

    if (username !== undefined) { query += `username = $${valueIndex++}, `; values.push(username); }
    if (email !== undefined) { query += `email = $${valueIndex++}, `; values.push(email); }
    if (password) {
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += `password = $${valueIndex++}, `;
            values.push(hashedPassword);
        } catch (hashError) {
            console.error("Error hashing password during update:", hashError);
            return res.status(500).json({ message: "Server error hashing password." });
        }
    }
    if (age !== undefined) { query += `age = $${valueIndex++}, `; values.push(age); }
    if (role !== undefined) { query += `role = $${valueIndex++}, `; values.push(role); }

    if (values.length === 0) {
        return res.status(400).json({ message: "No fields provided for update." });
    }

    query = query.slice(0, -2); // Remove trailing comma and space
    query += ` WHERE id = $${valueIndex}`;
    values.push(userId);

    try {
        const result = await pool.query(query, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json({ message: "User updated successfully" });
    } catch (error) {
        console.error("Error updating user:", error);
        if (error.code === '23505') {
             const constraint = error.constraint;
             let field = 'field';
             if (constraint === 'users_username_key') field = 'username';
             if (constraint === 'users_email_key') field = 'email';
             // Find the conflicting value from the request body
             const conflictingValue = req.body[field];
             return res.status(409).json({ message: `Error: The ${field} '${conflictingValue}' already exists.` });
        }
        res.status(500).json({ message: "Server error updating user." });
    }
};

// Delete a user (Admin Only)
exports.deleteUser = async (req, res) => {
    const userIdToDelete = parseInt(req.params.id);

    if (isNaN(userIdToDelete)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    // Prevent self-deletion
    if (userIdToDelete === req.user.userId) { // req.user attached by 'protect' middleware
        return res.status(400).json({ message: "Cannot delete your own account." });
    }

    try {
        // CASCADE constraint on project_data_managers handles assignment removal automatically
        const result = await pool.query("DELETE FROM users WHERE id = $1", [userIdToDelete]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.status(204).send(); // No Content - Standard for successful DELETE
    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ message: "Server error deleting user." });
    }
};

// Get user count
exports.getUserCount = async (req, res) => {
    try {
        const result = await pool.query("SELECT COUNT(*) FROM users");
        const count = parseInt(result.rows[0].count, 10);
        res.json({ count: count });
    } catch (error) {
        console.error("Error fetching user count:", error);
        res.status(500).json({ message: "Server error fetching user count." });
    }
};

// Unlock a user (Admin Only)
exports.unlockUser = async (req, res) => {
    const userIdToUnlock = parseInt(req.params.id);
    if (isNaN(userIdToUnlock)) {
        return res.status(400).json({ message: "Invalid user ID." });
    }
    try {
        const result = await pool.query(
            "UPDATE users SET is_locked = FALSE, failed_attempts = 0 WHERE id = $1",
            [userIdToUnlock]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "User not found." });
        }
        res.json({ success: true, message: "User unlocked successfully" });
    } catch (error) {
        console.error("Error unlocking user:", error);
        res.status(500).json({ message: "Server error unlocking user." });
    }
};