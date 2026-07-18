// routes/messages.js
// -----------------------------------------------------------------------
// "WhatsApp-like" group messaging system.
//  - Only admins/leaders can CREATE groups and ADD members to them.
//  - A user can only read/send messages in groups they belong to.
//  - Real-time delivery happens over Socket.IO (see sockets/chat.js);
//    these REST routes handle history + group management, and the
//    socket layer also writes to the same `messages` table so both
//    stay in sync.
// -----------------------------------------------------------------------
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Helper: is this user a member of this group?
function isMember(groupId, userId) {
    return !!db
        .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
        .get(groupId, userId);
}

// GET /api/groups — list groups the current user belongs to
// (admins/leaders also see every group, so they can manage them)
router.get("/", requireAuth, (req, res) => {
    let groups;
    if (["admin", "leader"].includes(req.user.role)) {
        groups = db.prepare("SELECT * FROM groups ORDER BY created_at DESC").all();
    } else {
        groups = db
            .prepare(
                `SELECT g.* FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = ?
         ORDER BY g.created_at DESC`
            )
            .all(req.user.id);
    }
    res.json({ groups });
});

// POST /api/groups — admin/leader only: create a new group
router.post(
    "/",
    requireAuth,
    requireRole("admin", "leader"),
    [body("name").trim().notEmpty().withMessage("Group name is required.")],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, description } = req.body;
        const result = db
            .prepare("INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?)")
            .run(name, description || null, req.user.id);

        const groupId = result.lastInsertRowid;
        // The creator is automatically a member so they can message right away.
        db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").run(groupId, req.user.id);

        res.status(201).json({ group: db.prepare("SELECT * FROM groups WHERE id = ?").get(groupId) });
    }
);

// POST /api/groups/:id/members — admin/leader only: add a member (new or existing) to a group
router.post(
    "/:id/members",
    requireAuth,
    requireRole("admin", "leader"),
    [body("user_id").isInt().withMessage("A valid user_id is required.")],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(req.params.id);
        if (!group) return res.status(404).json({ error: "Group not found." });

        const user = db.prepare("SELECT id FROM users WHERE id = ?").get(req.body.user_id);
        if (!user) return res.status(404).json({ error: "User not found." });

        db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)").run(
            group.id,
            user.id
        );

        res.status(201).json({ success: true });
    }
);

// DELETE /api/groups/:id/members/:userId — admin/leader only: remove a member
router.delete("/:id/members/:userId", requireAuth, requireRole("admin", "leader"), (req, res) => {
    db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(
        req.params.id,
        req.params.userId
    );
    res.json({ success: true });
});

// GET /api/groups/:id/members — see who is in a group (must be a member, or staff)
router.get("/:id/members", requireAuth, (req, res) => {
    const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found." });

    const allowed = ["admin", "leader"].includes(req.user.role) || isMember(req.params.id, req.user.id);
    if (!allowed) return res.status(403).json({ error: "You are not a member of this group." });

    const members = db
        .prepare(
            `SELECT u.id, u.name, u.email, u.role FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       WHERE gm.group_id = ?`
        )
        .all(req.params.id);

    res.json({ members });
});

// GET /api/groups/:id/messages — message history (must be a member, or staff)
router.get("/:id/messages", requireAuth, (req, res) => {
    const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found." });

    const allowed = ["admin", "leader"].includes(req.user.role) || isMember(req.params.id, req.user.id);
    if (!allowed) return res.status(403).json({ error: "You are not a member of this group." });

    const messages = db
        .prepare(
            `SELECT m.id, m.content, m.created_at, u.id as sender_id, u.name as sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = ?
       ORDER BY m.created_at ASC
       LIMIT 200`
        )
        .all(req.params.id);

    res.json({ messages });
});

// POST /api/groups/:id/messages — send a message via plain HTTP (fallback if
// sockets aren't connected). The socket handler in sockets/chat.js does the
// same insert for real-time delivery.
router.post(
    "/:id/messages",
    requireAuth,
    [body("content").trim().notEmpty().withMessage("Message cannot be empty.")],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(req.params.id);
        if (!group) return res.status(404).json({ error: "Group not found." });

        const allowed = ["admin", "leader"].includes(req.user.role) || isMember(req.params.id, req.user.id);
        if (!allowed) return res.status(403).json({ error: "You are not a member of this group." });

        const result = db
            .prepare("INSERT INTO messages (group_id, sender_id, content) VALUES (?, ?, ?)")
            .run(req.params.id, req.user.id, req.body.content);

        const message = db
            .prepare(
                `SELECT m.id, m.content, m.created_at, u.id as sender_id, u.name as sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
            )
            .get(result.lastInsertRowid);

        // Broadcast to anyone connected via socket too, so REST-sent messages
        // still show up live for other members. `req.app.get("io")` is set in server.js.
        const io = req.app.get("io");
        if (io) io.to(`group:${req.params.id}`).emit("new_message", message);

        res.status(201).json({ message });
    }
);

module.exports = router;
