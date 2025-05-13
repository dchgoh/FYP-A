const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { jwtSecret, jwtExpiresIn } = require('../config/auth');
const { sendMfaCode } = require('../utils/mailer'); // Import the utility

exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
         
        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid email or password." });
        }

        const user = userResult.rows[0];

        if (user.is_locked) {
            return res.status(403).json({ success: false, message: "Your account is locked. Contact support." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
         
        if (isMatch) {
             await pool.query("UPDATE users SET failed_attempts = 0 WHERE email = $1", [email]);
             await sendMfaCode(email); // Use imported function
             return res.json({ success: true, mfaRequired: true, message: "MFA code sent." });
         } else {
            let failedAttempts = user.failed_attempts + 1;
            if (failedAttempts >= 3) {
                await pool.query("UPDATE users SET is_locked = TRUE WHERE email = $1", [email]);
                return res.status(403).json({ success: false, message: "Account locked due to too many failed attempts." });
            } else {
                await pool.query("UPDATE users SET failed_attempts = $1 WHERE email = $2", [failedAttempts, email]);
                return res.status(401).json({ success: false, message: `Invalid credentials. Attempts left: ${3 - failedAttempts}` });
            }
         }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Server error during login." });
    }
};

exports.verifyMfa = async (req, res) => {
    const { email, code } = req.body;
    try {
        const userResult = await pool.query(
            "SELECT id, username, mfa_code, mfa_expires_at, role FROM users WHERE email = $1",
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: "User not found." });
        }

        const user = userResult.rows[0];
        const { id, username, mfa_code, mfa_expires_at, role } = user; // Get user ID

        if (!mfa_code) {
            return res.status(400).json({ success: false, message: "MFA not active for this user." });
        }

        if (new Date(mfa_expires_at) < new Date()) {
             // Don't resend code here on expired, force login again
             // await sendMfaCode(email);
            return res.status(400).json({ success: false, message: "MFA code expired. Please log in again to get a new code." });
        }

        const isMatch = await bcrypt.compare(code, mfa_code);

        if (!isMatch) {
            // Consider attempt limits for MFA
             // Don't resend on incorrect - prevents brute force
            // await sendMfaCode(email);
            return res.status(401).json({ success: false, message: "Incorrect MFA code. Please try again." });
        }

        // MFA Successful! Clear MFA data
        await pool.query("UPDATE users SET mfa_code = NULL, mfa_expires_at = NULL WHERE email = $1", [email]);

        // --- GENERATE JWT ---
        const payload = {
            userId: id, // Include user ID - CRITICAL for permission checks
            username: username,
            role: role,
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' } // Use expiry from .env or default
        );

        // --- SEND TOKEN TO CLIENT ---
        res.json({
            success: true,
            message: "MFA verified! Access granted.",
            token: token,
            role: role, // Keep sending role/username if needed directly on frontend
            username: username,
            userId: id // Send userId too if useful on frontend (though it's in token)
        });
        
    } catch (error) {
        console.error("MFA Verify error:", error);
        res.status(500).json({ success: false, message: "Server error during MFA verification." });
    }
};