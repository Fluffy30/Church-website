// routes/auth.js
// -----------------------------------------------------------------------
// Handles account creation (member sign-up) and login.
// Passwords are hashed with bcrypt (never stored or logged in plain text).
// -----------------------------------------------------------------------
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Slow down brute-force login/signup attempts.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
});

function signToken(user) {
    return jwt.sign(
        { id: user.id, name: user.name, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );
}

// ---------------------------------------------------------------------
// POST /api/auth/register  — creates a member account with a password
// (separate from the public "registration/follow-up" form, which does
// not require a password — see routes/registration.js)
// ---------------------------------------------------------------------
router.post(
    "/register",
    authLimiter,
    [
        body("name").trim().notEmpty().withMessage("Name is required."),
        body("email").isEmail().normalizeEmail().withMessage("Valid email is required."),
        body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters."),
        body("phone").optional({ checkFalsy: true }).trim(),
        body("contact_preference").optional().isIn(["phone", "whatsapp", "email"]),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, email, password, phone, contact_preference } = req.body;

        const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
        if (existing) {
            return res.status(409).json({ error: "An account with that email already exists." });
        }

        const hash = bcrypt.hashSync(password, 12);

        const result = db
            .prepare(
                `INSERT INTO users (name, email, phone, password_hash, role, contact_preference)
         VALUES (?, ?, ?, ?, 'member', ?)`
            )
            .run(name, email, phone || null, hash, contact_preference || "email");

        const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(result.lastInsertRowid);
        const token = signToken(user);

        res.status(201).json({ token, user });
    }
);

// ---------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------
router.post(
    "/login",
    authLimiter,
    [
        body("email").isEmail().normalizeEmail(),
        body("password").notEmpty(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: "Email and password are required." });

        const { email, password } = req.body;
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

        // Use a generic error message for both "no user" and "wrong password"
        // so attackers can't tell which emails are registered.
        if (!user || !user.is_active) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const token = signToken(user);
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
    }
);

// ---------------------------------------------------------------------
// GET /api/auth/me — returns the currently logged-in user's profile
// ---------------------------------------------------------------------
router.get("/me", requireAuth, (req, res) => {
    const user = db
        .prepare("SELECT id, name, email, phone, role, contact_preference, created_at FROM users WHERE id = ?")
        .get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ user });
});

module.exports = router;
