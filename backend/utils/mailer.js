const bcrypt = require('bcrypt');
const transporter = require('../config/mailer'); // Import configured transporter
const { pool } = require('../config/db'); // Import pool for DB operations
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Ensure env vars loaded

const sendMfaCode = async (email) => {
    const rawMfaCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedMfaCode = await bcrypt.hash(rawMfaCode, 10);
    const expiryTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    try {
        // Use the shared pool
        await pool.query(
            "UPDATE users SET mfa_code = $1, mfa_expires_at = $2 WHERE email = $3",
            [hashedMfaCode, expiryTime, email]
        );

        await transporter.sendMail({
            from: process.env.MAIL_USER,
            to: email,
            subject: "Your MFA Code",
            text: `Your MFA code is: ${rawMfaCode}. It expires in 5 minutes.`,
        });
        console.log(`MFA code sent to ${email}`);
        return true; // Indicate success
    } catch (error) {
        console.error(`Failed to send MFA code to ${email}:`, error);
        return false; // Indicate failure
    }
};

module.exports = { sendMfaCode };