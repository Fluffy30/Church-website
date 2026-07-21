// utils/sms.js
// -----------------------------------------------------------------------
// Sends real SMS and WhatsApp messages via Twilio. Mirrors utils/mailer.js:
// if Twilio isn't configured yet (no TWILIO_ACCOUNT_SID in .env), messages
// are written to the console instead of failing — so the app is fully
// usable in local development before you've set up a Twilio account. The
// moment you add TWILIO_* to .env, real messages start sending with zero
// code changes anywhere else in the app.
//
// Why Twilio specifically (and not a generic multi-provider abstraction
// like the email side): SMS/WhatsApp providers don't share a common
// protocol the way email providers share SMTP, so there's no
// provider-agnostic equivalent. Twilio is the most widely used option and
// supports both SMS and WhatsApp through one API — if you'd rather use a
// different provider, this is the one file you'd need to change.
// -----------------------------------------------------------------------
let twilioClient = null;

function getClient() {
    if (!process.env.TWILIO_ACCOUNT_SID) return null; // not configured — caller falls back to console
    if (twilioClient) return twilioClient;

    const twilio = require("twilio");
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    return twilioClient;
}

// Very light phone-number sanity check — not full E.164 validation, just
// enough to catch obviously-wrong input before we try to send.
const PHONE_PATTERN = /^\+?[0-9\s\-()]{7,20}$/;
function looksLikePhoneNumber(value) {
    return typeof value === "string" && PHONE_PATTERN.test(value.trim());
}

// sendSms({ to, body, channel }) — channel is 'sms' (default) or 'whatsapp'.
async function sendSms({ to, body, channel = "sms" }) {
    const client = getClient();

    if (!client) {
        console.log(`\n[sms] Twilio not configured — message NOT actually sent. Add TWILIO_* to .env to enable real sending.`);
        console.log(`[sms] Channel: ${channel}`);
        console.log(`[sms] To: ${to}`);
        console.log(`[sms] Body: ${body}\n`);
        return { sent: false, reason: "twilio_not_configured" };
    }

    if (!looksLikePhoneNumber(to)) {
        console.error(`[sms] Skipped sending — "${to}" doesn't look like a valid phone number.`);
        return { sent: false, reason: "invalid_phone_number" };
    }

    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const isWhatsapp = channel === "whatsapp";

    try {
        await client.messages.create({
            body,
            from: isWhatsapp ? `whatsapp:${fromNumber}` : fromNumber,
            to: isWhatsapp ? `whatsapp:${to}` : to,
        });
        return { sent: true };
    } catch (err) {
        // Never let an SMS failure crash the request that triggered it (e.g.
        // someone submitting the registration form shouldn't see an error
        // just because a confirmation text failed). Log it and move on.
        console.error(`[sms] Failed to send ${channel} message to ${to}:`, err.message);
        return { sent: false, reason: "send_failed", error: err.message };
    }
}

module.exports = { sendSms };
