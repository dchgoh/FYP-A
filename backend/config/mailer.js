const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Prefer explicit SMTP to align with your domain's SPF/DKIM
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465;
const smtpUser = process.env.SMTP_USER || process.env.MAIL_USER;
const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASS;

/**
 * Optional DKIM configuration
 * Set DKIM_DOMAIN, DKIM_SELECTOR and DKIM_PRIVATE_KEY_PATH in .env
 */
let dkimConfig = undefined;
try {
    const dkimDomain = process.env.DKIM_DOMAIN;
    const dkimSelector = process.env.DKIM_SELECTOR;
    const dkimKeyPath = process.env.DKIM_PRIVATE_KEY_PATH;
    if (dkimDomain && dkimSelector && dkimKeyPath) {
        const privateKey = fs.readFileSync(path.resolve(dkimKeyPath), 'utf8');
        dkimConfig = {
            domainName: dkimDomain,
            keySelector: dkimSelector,
            privateKey
        };
    }
} catch (_) {
    // DKIM is optional; ignore errors reading key
}

const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 5),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
    auth: smtpUser && smtpPass ? {
        user: smtpUser,
        pass: smtpPass
    } : undefined,
    tls: {
        rejectUnauthorized: String(process.env.SMTP_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true'
    },
    dkim: dkimConfig
});

module.exports = transporter;