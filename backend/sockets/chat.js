// sockets/chat.js
// -----------------------------------------------------------------------
// Real-time layer for the "WhatsApp-like" messaging system.
// Every socket connection must present a valid JWT (same token used for
// the REST API) — anonymous sockets are rejected. A user can only join
// rooms for groups they actually belong to, verified against the DB on
// every join and every message send (never trust the client).
// -----------------------------------------------------------------------
const jwt = require("jsonwebtoken");
const db = require("../config/db");

function isMember(groupId, userId) {
    return !!db
        .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
        .get(groupId, userId);
}

function initChatSockets(io) {
    // Authenticate every socket connection using the JWT sent by the client.
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("Authentication required."));
        try {
            socket.user = jwt.verify(token, process.env.JWT_SECRET);
            next();
        } catch (err) {
            next(new Error("Invalid or expired session."));
        }
    });

    io.on("connection", (socket) => {
        // Client asks to join a specific group's room.
        socket.on("join_group", (groupId, callback) => {
            const group = db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId);
            if (!group) return callback?.({ error: "Group not found." });

            const allowed = ["admin", "leader"].includes(socket.user.role) || isMember(groupId, socket.user.id);
            if (!allowed) return callback?.({ error: "You are not a member of this group." });

            socket.join(`group:${groupId}`);
            callback?.({ success: true });
        });

        socket.on("leave_group", (groupId) => {
            socket.leave(`group:${groupId}`);
        });

        // Client sends a chat message.
        socket.on("send_message", (data, callback) => {
            const { groupId, content } = data || {};
            if (!groupId || !content || !content.trim()) {
                return callback?.({ error: "groupId and non-empty content are required." });
            }

            const group = db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId);
            if (!group) return callback?.({ error: "Group not found." });

            const allowed = ["admin", "leader"].includes(socket.user.role) || isMember(groupId, socket.user.id);
            if (!allowed) return callback?.({ error: "You are not a member of this group." });

            const result = db
                .prepare("INSERT INTO messages (group_id, sender_id, content) VALUES (?, ?, ?)")
                .run(groupId, socket.user.id, content.trim());

            const message = {
                id: result.lastInsertRowid,
                content: content.trim(),
                created_at: new Date().toISOString(),
                sender_id: socket.user.id,
                sender_name: socket.user.name,
            };

            // Deliver to everyone in the room (including the sender, for consistency
            // across multiple open tabs/devices).
            io.to(`group:${groupId}`).emit("new_message", message);
            callback?.({ success: true, message });
        });

        // Typing indicator, purely cosmetic — no DB write.
        socket.on("typing", (groupId) => {
            socket.to(`group:${groupId}`).emit("user_typing", {
                userId: socket.user.id,
                name: socket.user.name,
            });
        });
    });
}

module.exports = initChatSockets;
