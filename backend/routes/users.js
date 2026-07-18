// routes/users.js
// -----------------------------------------------------------------------
// Member management. Only admins/leaders can list members (so member
// contact details are never exposed to the public or to other members).
// -----------------------------------------------------------------------
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/users — admin/leader only: list members (for adding to groups, etc.)
router.get("/", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const search = req.query.search;
    const rows = search
        ? db
            .prepare(
                "SELECT id, name, email, phone, role, contact_preference, created_at FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY name"
            )
            .all(`%${search}%`, `%${search}%`)
        : db
            .prepare(
                "SELECT id, name, email, phone, role, contact_preference, created_at FROM users ORDER BY name"
            )
            .all();
    res.json({ users: rows });
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
    const result = db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "User not found." });
    res.json({ success: true });
});

module.exports = router;
