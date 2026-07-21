// routes/prayers.js
// -----------------------------------------------------------------------
// Prayer requests are sensitive/private by nature:
//  - Anyone (logged in or not) can SUBMIT a request, optionally anonymously.
//  - Only admins/leaders can LIST or view requests.
//  - A member can view their OWN submitted requests if logged in.
// -----------------------------------------------------------------------
const express = require("express");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const db = require("../config/db");
const { requireAuth, requireRole, optionalAuth } = require("../middleware/auth");
const { sendEmail } = require("../utils/mailer");
const { sendSms } = require("../utils/sms");

const router = express.Router();

// Very small helper — just enough to decide whether contact_info looks
// like an email address (vs. a phone number) before trying to send to it.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Prevent spam/abuse of the public submission endpoint.
const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests submitted. Please try again later." },
});

// POST /api/prayers — public (optionalAuth links it to a logged-in user if available)
router.post(
    "/",
    submitLimiter,
    optionalAuth,
    [
        body("full_name").trim().notEmpty().withMessage("Name is required (use 'Anonymous' if you prefer not to share)."),
        body("request_text").trim().isLength({ min: 3 }).withMessage("Please share a bit more detail about your request."),
        body("contact_info").optional({ checkFalsy: true }).trim(),
        body("is_anonymous").optional().isBoolean(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { full_name, request_text, contact_info, is_anonymous } = req.body;
        const userId = req.user ? req.user.id : null;

        const result = db
            .prepare(
                `INSERT INTO prayer_requests (user_id, full_name, contact_info, request_text, is_anonymous)
         VALUES (?, ?, ?, ?, ?)`
            )
            .run(userId, full_name, contact_info || null, request_text, is_anonymous ? 1 : 0);

        // Deliberately return only a confirmation, not the stored data, to
        // reinforce that this information is private once submitted.
        res.status(201).json({ success: true, id: result.lastInsertRowid });

        // Send confirmation + staff notification AFTER responding, so a slow
        // or failed email/SMS never delays or breaks the person's submission.
        // If we know their email (logged in, or they typed an email-shaped
        // contact_info), confirm by email. Otherwise, if contact_info looks
        // like a phone number, try SMS instead — either way, whoever left
        // contact info hears back on the channel they actually gave us.
        const confirmEmail = req.user ? req.user.email : (contact_info && EMAIL_PATTERN.test(contact_info) ? contact_info : null);

        if (confirmEmail) {
            sendEmail({
                to: confirmEmail,
                subject: "We received your prayer request — Grace Community Church",
                text: `Hi ${is_anonymous ? "there" : full_name},\n\nYour prayer request has been received privately by our pastoral team. We are praying for you.\n\nGrace Community Church`,
            }).catch((err) => console.error("[prayers] confirmation email failed:", err.message));
        } else if (contact_info && !EMAIL_PATTERN.test(contact_info)) {
            // contact_info was provided but isn't email-shaped — treat it as a
            // phone number and try SMS. sendSms() itself validates the format
            // and safely no-ops (with a log) if it still doesn't look right.
            sendSms({
                to: contact_info,
                body: `Hi ${is_anonymous ? "there" : full_name}, your prayer request to Grace Community Church has been received privately. We are praying for you.`,
            }).catch((err) => console.error("[prayers] confirmation SMS failed:", err.message));
        }

        if (process.env.ADMIN_NOTIFICATION_EMAIL) {
            sendEmail({
                to: process.env.ADMIN_NOTIFICATION_EMAIL,
                subject: "New prayer request submitted",
                text: `A new prayer request was submitted${is_anonymous ? " (anonymous)" : ` by ${full_name}`}.\n\nView it in the dashboard: ${process.env.FRONTEND_ORIGIN}/dashboard.html`,
            }).catch((err) => console.error("[prayers] staff notification email failed:", err.message));
        }
    }
);

// GET /api/prayers — admin/leader only (this is the private inbox)
router.get("/", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const status = req.query.status;
    const rows = status
        ? db.prepare("SELECT * FROM prayer_requests WHERE status = ? ORDER BY created_at DESC").all(status)
        : db.prepare("SELECT * FROM prayer_requests ORDER BY created_at DESC").all();

    // Mask names/contact info for requests marked anonymous, even from staff view.
    const sanitized = rows.map((r) =>
        r.is_anonymous
            ? { ...r, full_name: "Anonymous", contact_info: null }
            : r
    );

    res.json({ prayers: sanitized });
});

// GET /api/prayers/mine — a logged-in member's own submitted requests
router.get("/mine", requireAuth, (req, res) => {
    const rows = db
        .prepare("SELECT * FROM prayer_requests WHERE user_id = ? ORDER BY created_at DESC")
        .all(req.user.id);
    res.json({ prayers: rows });
});

// PATCH /api/prayers/:id/status — admin/leader updates status (new/in_progress/prayed_for)
router.patch(
    "/:id/status",
    requireAuth,
    requireRole("admin", "leader"),
    [body("status").isIn(["new", "in_progress", "prayed_for"])],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const result = db
            .prepare("UPDATE prayer_requests SET status = ? WHERE id = ?")
            .run(req.body.status, req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: "Request not found." });

        res.json({ success: true });
    }
);

module.exports = router;
