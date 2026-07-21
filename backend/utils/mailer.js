// utils/mailer.js
// -----------------------------------------------------------------------
// Sends real email through any standard SMTP provider — SendGrid, Mailgun,
// Postmark, Amazon SES, Gmail SMTP, your church's own mail host, etc. all
// work here without provider-specific SDKs, because they all speak SMTP.
//
// If SMTP isn't configured yet (no SMTP_HOST in .env), emails are written
// to the console instead of failing — so the app is fully usable in local
// development before you've set up a mail provider. The moment you add
// SMTP_HOST/SMTP_USER/SMTP_PASS to .env, real emails start sending with
// zero code changes anywhere else in the app.
// -----------------------------------------------------------------------
const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
    if (!process.env.SMTP_HOST) return null; // not configured — caller falls back to console
    if (transporter) return transporter;

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/25 (STARTTLS)
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    });
    return transporter;
}

// sendEmail({ to, subject, text, html }) — html is optional, text is always sent as a fallback.
async function sendEmail({ to, subject, text, html }) {
    const from = process.env.SMTP_FROM || "Grace Community Church <no-reply@example.com>";
    const t = getTransporter();

    if (!t) {
        // Dev fallback: no SMTP configured yet. Print clearly to the console
        // so nothing is silently lost, and it's obvious this needs setup.
        console.log(`\n[mailer] SMTP not configured — email NOT actually sent. Add SMTP_HOST etc. to .env to enable real sending.`);
        console.log(`[mailer] To: ${to}`);
        console.log(`[mailer] Subject: ${subject}`);
        console.log(`[mailer] Body:\n${text}\n`);
        return { sent: false, reason: "smtp_not_configured" };
    }

    try {
        await t.sendMail({ from, to, subject, text, html: html || undefined });
        return { sent: true };
    } catch (err) {
        // Never let an email failure crash the request that triggered it
        // (e.g. someone submitting a prayer request shouldn't see an error
        // just because a notification email bounced). Log it and move on.
        console.error(`[mailer] Failed to send email to ${to}:`, err.message);
        return { sent: false, reason: "send_failed", error: err.message };
    }
}

module.exports = { sendEmail };
