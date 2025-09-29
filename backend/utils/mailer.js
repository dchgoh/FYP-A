const bcrypt = require('bcrypt');
const transporter = require('../config/mailer'); // Import configured transporter
const { pool } = require('../config/db'); // Import pool for DB operations
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Ensure env vars loaded

const brandName = process.env.MAIL_FROM_NAME || 'UAS';
const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.MAIL_USER;
const replyTo = process.env.MAIL_REPLY_TO || mailFrom;
const unsubscribeMailto = process.env.LIST_UNSUBSCRIBE_MAILTO; // e.g. <mailto:unsubscribe@yourdomain.com?subject=unsubscribe>
const unsubscribeHttp = process.env.LIST_UNSUBSCRIBE_HTTP; // e.g. <https://yourdomain.com/unsubscribe?email={email}>

function buildListUnsubscribeHeader(recipientEmail) {
    const parts = [];
    if (unsubscribeMailto) parts.push(unsubscribeMailto);
    if (unsubscribeHttp) parts.push(unsubscribeHttp.replace('{email}', encodeURIComponent(recipientEmail)));
    return parts.length ? parts.join(', ') : undefined;
}

function buildMfaHtml(code) {
    const preheader = `Your ${brandName} MFA code is ${code}. Expires in 5 minutes.`;
    return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${brandName} MFA Code</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; background:#f6f9fc; margin:0; padding:24px; }
      .container { max-width: 520px; margin: 0 auto; background:#ffffff; border:1px solid #e6ebf1; border-radius:8px; padding:24px; }
      .code { font-size: 28px; letter-spacing: 4px; font-weight: 700; background:#f1f5f9; padding:12px 16px; border-radius:6px; display:inline-block; }
      .muted { color:#64748b; font-size:14px; }
      .brand { font-weight:700; font-size:18px; }
    </style>
  </head>
  <body>
    <span style="display:none!important;opacity:0;color:transparent;visibility:hidden;height:0;width:0;overflow:hidden">${preheader}</span>
    <div class="container">
      <div class="brand">${brandName}</div>
      <p>Here is your one-time MFA code:</p>
      <div class="code">${code}</div>
      <p class="muted">This code expires in 5 minutes. If you did not request this, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
}

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

        const listUnsubHeader = buildListUnsubscribeHeader(email);
        await transporter.sendMail({
            from: mailFrom ? `${brandName} <${mailFrom}>` : undefined,
            sender: mailFrom,
            replyTo,
            to: email,
            subject: `${brandName}: Your MFA Code`,
            text: `Your ${brandName} MFA code is: ${rawMfaCode}. It expires in 5 minutes. If you did not request this, you can ignore this email.`,
            html: buildMfaHtml(rawMfaCode),
            headers: {
                'List-Unsubscribe': listUnsubHeader,
                'List-Unsubscribe-Post': listUnsubHeader ? 'List-Unsubscribe=One-Click' : undefined,
                'Precedence': 'list',
                'Auto-Submitted': 'no',
                'X-Auto-Response-Suppress': 'OOF, AutoReply',
            },
            priority: 'high'
        });
        console.log(`MFA code sent to ${email}`);
        return true; // Indicate success
    } catch (error) {
        console.error(`Failed to send MFA code to ${email}:`, error);
        return false; // Indicate failure
    }
};

module.exports = { sendMfaCode };