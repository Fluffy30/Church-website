// routes/registration.js
// -----------------------------------------------------------------------
// A lightweight "connect with us / new visitor" form. This is separate
// from creating a login account (routes/auth.js) — it's for anyone,
// including people who just want the church to follow up with them,
// without needing to set a password.
// -----------------------------------------------------------------------
const express = require("express");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many submissions. Please try again later." },
});

// POST /api/registrations — public
router.post(
    "/",
    submitLimiter,
    [
        body("full_name").trim().notEmpty().withMessage("Name is required."),
        body("contact_preference").isIn(["phone", "whatsapp", "email"]).withMessage("Select a valid contact method."),
        body("email").optional({ checkFalsy: true }).isEmail().withMessage("Enter a valid email."),
        body("phone").optional({ checkFalsy: true }).trim(),
        body("notes").optional({ checkFalsy: true }).trim(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { full_name, email, phone, contact_preference, notes } = req.body;

        // Require at least one way to reach the person, matching their preference.
        if (contact_preference === "email" && !email) {
            return res.status(400).json({ error: "Email is required when email is your preferred contact method." });
        }
        if ((contact_preference === "phone" || contact_preference === "whatsapp") && !phone) {
            return res.status(400).json({ error: "Phone number is required for phone/WhatsApp contact." });
        }

        const result = db
            .prepare(
                `INSERT INTO registrations (full_name, email, phone, contact_preference, notes)
         VALUES (?, ?, ?, ?, ?)`
            )
            .run(full_name, email || null, phone || null, contact_preference, notes || null);

        res.status(201).json({ success: true, id: result.lastInsertRowid });
    }
);

// GET /api/registrations — admin/leader only (follow-up dashboard)
router.get("/", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const followedUp = req.query.followed_up;
    let rows;
    if (followedUp === "true" || followedUp === "false") {
        rows = db
            .prepare("SELECT * FROM registrations WHERE followed_up = ? ORDER BY created_at DESC")
            .all(followedUp === "true" ? 1 : 0);
    } else {
        rows = db.prepare("SELECT * FROM registrations ORDER BY created_at DESC").all();
    }
    res.json({ registrations: rows });
});

// PATCH /api/registrations/:id/followed-up — admin/leader marks as contacted
router.patch("/:id/followed-up", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const result = db
        .prepare("UPDATE registrations SET followed_up = 1 WHERE id = ?")
        .run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Registration not found." });
    res.json({ success: true });
});

module.exports = router;
