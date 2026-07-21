// routes/users.js
// -----------------------------------------------------------------------
// Member management. Only admins/leaders can list members (so member
// contact details are never exposed to the public or to other members).
// -----------------------------------------------------------------------
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createAuthToken, TOKEN_TTL_MINUTES } = require("../utils/authTokens");

const router = express.Router();

// GET /api/users — admin/leader only: list members (for adding to groups, etc.)
router.get("/", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const search = req.query.search;
    const rows = search
        ? db
            .prepare(
                "SELECT id, name, email, phone, role, contact_preference, locked_until, created_at FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name"
            )
            .all(`%${search}%`, `%${search}%`)
        : db
            .prepare(
                "SELECT id, name, email, phone, role, contact_preference, locked_until, created_at FROM users ORDER BY name"
            )
            .all();
    const now = new Date();
    res.json({
        users: rows.map((u) => ({ ...u, is_locked: !!(u.locked_until && new Date(u.locked_until) > now) })),
    });
});

// PATCH /api/users/:id/role — admin only: promote/demote a member to leader/admin
router.patch(
    "/:id/role",
    requireAuth,
    requireRole("admin"),
    [body("role").isIn(["admin", "leader", "member"])],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const result = db.prepare("UPDATE users SET role = ? WHERE id = ?").run(req.body.role, req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: "User not found." });
        res.json({ success: true });
    }
);

// PATCH /api/users/:id/deactivate — admin only: disable a member's login (soft delete)
router.patch("/:id/deactivate", requireAuth, requireRole("admin"), (req, res) => {
    const result = db
        .prepare("UPDATE users SET is_active = 0, token_version = token_version + 1 WHERE id = ?")
        .run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "User not found." });
    // Bumping token_version too means any session this person currently has
    // open is rejected on their very next request, not just on their next login.
    res.json({ success: true });
});

// POST /api/users/:id/revoke-sessions — admin/leader only: force-logout a
// member from every device immediately, WITHOUT changing their password.
// Useful if a device is lost/stolen or a session looks suspicious, but you
// don't necessarily want to make them set a whole new password too.
router.post("/:id/revoke-sessions", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const user = db.prepare("SELECT id, name FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(user.id);
    res.json({ success: true, message: `${user.name} has been signed out of all devices.` });
});

// POST /api/users/:id/reset-password — admin/leader only: generate a reset
// link for a member who's locked out, so staff can hand it to them
// directly (text, WhatsApp, in person) until real email sending is set up.
// The raw link is only ever returned to the admin making this request —
// it is never stored anywhere in plain form. Note: once this link is used
// (via POST /api/auth/reset-password), all of that member's existing
// sessions are automatically revoked too — see routes/auth.js.
router.post("/:id/reset-password", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    const rawToken = createAuthToken(user.id, "password_reset", "admin");
    const resetLink = `${process.env.FRONTEND_ORIGIN}/reset-password.html?token=${rawToken}`;

    res.json({
        success: true,
        resetLink,
        expiresInMinutes: TOKEN_TTL_MINUTES.password_reset,
        message: `Share this link with ${user.name} directly. It expires in ${TOKEN_TTL_MINUTES.password_reset} minutes and can only be used once.`,
    });
});

// PATCH /api/users/:id/unlock — admin/leader only: clear a login lockout
// early, so a member doesn't have to wait out the full lockout window.
router.patch("/:id/unlock", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const result = db
        .prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?")
        .run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "User not found." });
    res.json({ success: true });
});

module.exports = router;
