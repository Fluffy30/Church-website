// routes/auth.js
// -----------------------------------------------------------------------
// Handles account creation (member sign-up), login, email verification,
// and password reset. Passwords are hashed with bcrypt (never stored or
// logged in plain text).
//
// ACCOUNT LOCKOUT: after LOCKOUT_THRESHOLD consecutive failed password
// attempts, an account is locked for LOCKOUT_MINUTES. This is on top of
// (not instead of) the IP-based rate limiting below — rate limiting slows
// down an attacker hammering many accounts from one IP; lockout protects
// one specific account even if the attacker spreads attempts across many
// IPs. A successful login resets the counter.
// -----------------------------------------------------------------------
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { createAuthToken, findValidAuthToken, markAuthTokenUsed, TOKEN_TTL_MINUTES } = require("../utils/authTokens");
const { sendEmail } = require("../utils/mailer");

const router = express.Router();

const LOCKOUT_THRESHOLD = 5; // failed attempts before locking
const LOCKOUT_MINUTES = 15;

// Slow down brute-force login/signup attempts.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
});

// Stricter limit on password reset / verification requests specifically —
// these are common targets for email-enumeration and spam abuse.
const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
});

function signToken(user) {
    return jwt.sign(
        { id: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.token_version || 0 },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );
}

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        email_verified: !!user.email_verified,
    };
}

// Invalidates every JWT previously issued to this user by bumping their
// token_version — used after a password reset (in case the old password
// was compromised) and available on-demand via /logout-all.
function revokeAllSessions(userId) {
    db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(userId);
}

// Sends the "verify your email" message. Used on signup and on resend.
async function sendVerificationEmail(user) {
    const rawToken = createAuthToken(user.id, "email_verification", "system");
    const link = `${process.env.FRONTEND_ORIGIN}/verify-email.html?token=${rawToken}`;
    await sendEmail({
        to: user.email,
        subject: "Verify your email — Grace Community Church",
        text: `Hi ${user.name},\n\nPlease verify your email by visiting this link:\n${link}\n\nThis link expires in ${TOKEN_TTL_MINUTES.email_verification / 60} hours.\n\nIf you didn't create this account, you can ignore this email.`,
        html: `<p>Hi ${user.name},</p><p>Please verify your email by clicking the link below:</p><p><a href="${link}">${link}</a></p><p>This link expires in ${TOKEN_TTL_MINUTES.email_verification / 60} hours.</p><p>If you didn't create this account, you can ignore this email.</p>`,
    });
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
    async (req, res) => {
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

        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
        const token = signToken(user);

        // Fire off the verification email, but don't let a mail failure block
        // account creation — the user can always hit "resend" later.
        sendVerificationEmail(user).catch((err) => console.error("[auth] verification email failed:", err.message));

        res.status(201).json({ token, user: publicUser(user) });
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

        // Check lockout BEFORE verifying the password, so a locked account
        // gives the same "locked" response regardless of whether the
        // password guess would have been correct.
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
            return res.status(423).json({
                error: `Too many failed attempts. This account is temporarily locked. Please try again in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}, or reset your password.`,
            });
        }

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) {
            const attempts = user.failed_login_attempts + 1;
            if (attempts >= LOCKOUT_THRESHOLD) {
                const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
                db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?").run(lockedUntil, user.id);
                return res.status(423).json({
                    error: `Too many failed attempts. This account is now locked for ${LOCKOUT_MINUTES} minutes for its protection.`,
                });
            }
            db.prepare("UPDATE users SET failed_login_attempts = ? WHERE id = ?").run(attempts, user.id);
            return res.status(401).json({ error: "Invalid email or password." });
        }

        // Successful login — clear any lockout state.
        if (user.failed_login_attempts > 0 || user.locked_until) {
            db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);
        }

        // Note: unverified users are still allowed to log in (see README) —
        // we don't want a missed/delayed email to lock someone out entirely.
        // The frontend shows a "please verify" banner instead.
        const token = signToken(user);
        res.json({ token, user: publicUser(user) });
    }
);

// ---------------------------------------------------------------------
// POST /api/auth/logout-all — invalidates every session for the current
// user, including the one making this request. The frontend should clear
// its stored token immediately after calling this (the token used to call
// it becomes invalid the instant this runs).
// ---------------------------------------------------------------------
router.post("/logout-all", requireAuth, (req, res) => {
    revokeAllSessions(req.user.id);
    res.json({ success: true, message: "You have been logged out of all devices." });
});

// ---------------------------------------------------------------------
// POST /api/auth/verify-email — completes email verification via token
// ---------------------------------------------------------------------
router.post(
    "/verify-email",
    authLimiter,
    [body("token").notEmpty().withMessage("Verification token is required.")],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const tokenRow = findValidAuthToken("email_verification", req.body.token);
        if (!tokenRow) {
            return res.status(400).json({ error: "This verification link is invalid or has expired. Please request a new one." });
        }

        db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(tokenRow.user_id);
        markAuthTokenUsed(tokenRow.id);

        res.json({ success: true, message: "Your email has been verified. Thank you!" });
    }
);

// ---------------------------------------------------------------------
// POST /api/auth/resend-verification — self-service resend
// ---------------------------------------------------------------------
router.post(
    "/resend-verification",
    resetLimiter,
    [body("email").isEmail().normalizeEmail().withMessage("Enter a valid email address.")],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const user = db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(req.body.email);

        // Same generic response regardless of whether the account exists or
        // is already verified — avoids leaking which emails are registered.
        const genericResponse = { success: true, message: "If that account needs verifying, a new email has been sent." };

        if (!user || user.email_verified) return res.json(genericResponse);

        await sendVerificationEmail(user);
        res.json(genericResponse);
    }
);

// ---------------------------------------------------------------------
// POST /api/auth/forgot-password — self-service password reset request
// ---------------------------------------------------------------------
router.post(
    "/forgot-password",
    resetLimiter,
    [body("email").isEmail().normalizeEmail().withMessage("Enter a valid email address.")],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const user = db.prepare("SELECT id, name, email FROM users WHERE email = ? AND is_active = 1").get(req.body.email);

        // Always return the same generic response whether or not the account
        // exists — this prevents attackers from using this endpoint to figure
        // out which emails are registered members.
        const genericResponse = {
            success: true,
            message: "If an account with that email exists, a password reset link has been sent.",
        };

        if (!user) return res.json(genericResponse);

        const rawToken = createAuthToken(user.id, "password_reset", "self");
        const resetLink = `${process.env.FRONTEND_ORIGIN}/reset-password.html?token=${rawToken}`;

        await sendEmail({
            to: user.email,
            subject: "Reset your password — Grace Community Church",
            text: `Hi ${user.name},\n\nYou requested a password reset. Visit this link to set a new password:\n${resetLink}\n\nThis link expires in ${TOKEN_TTL_MINUTES.password_reset} minutes and can only be used once.\n\nIf you didn't request this, you can safely ignore this email.`,
            html: `<p>Hi ${user.name},</p><p>You requested a password reset. Click below to set a new password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in ${TOKEN_TTL_MINUTES.password_reset} minutes and can only be used once.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
        });

        res.json(genericResponse);
    }
);

// ---------------------------------------------------------------------
// POST /api/auth/reset-password — completes a reset using a valid token
// ---------------------------------------------------------------------
router.post(
    "/reset-password",
    authLimiter,
    [
        body("token").notEmpty().withMessage("Reset token is required."),
        body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters."),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const tokenRow = findValidAuthToken("password_reset", req.body.token);
        if (!tokenRow) {
            return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
        }

        const hash = bcrypt.hashSync(req.body.password, 12);
        db.prepare("UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(hash, tokenRow.user_id);
        markAuthTokenUsed(tokenRow.id);

        // A password reset is a strong signal the old password may have been
        // compromised (or the person forgot it and wants a clean slate) —
        // either way, sign every existing session out so only the new
        // password can be used going forward.
        revokeAllSessions(tokenRow.user_id);

        res.json({ success: true, message: "Your password has been reset. You can now log in." });
    }
);

// ---------------------------------------------------------------------
// GET /api/auth/me — returns the currently logged-in user's profile
// ---------------------------------------------------------------------
router.get("/me", requireAuth, (req, res) => {
    const user = db
        .prepare("SELECT id, name, email, phone, role, contact_preference, email_verified, created_at FROM users WHERE id = ?")
        .get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ user: { ...user, email_verified: !!user.email_verified } });
});

module.exports = router;
