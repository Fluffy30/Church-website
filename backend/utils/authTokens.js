// utils/authTokens.js
// -----------------------------------------------------------------------
// Shared one-time-token logic for both password resets and email
// verification. Each purpose gets its own token TTL, but the create /
// verify / consume logic is identical, so it lives here once.
//
// Security model: we generate a random 256-bit token, give the RAW token
// to the user (via email or the admin-assisted flow), but store only a
// SHA-256 HASH of it in the database — same principle as password
// hashing. If the database ever leaked, stored tokens would be useless.
// -----------------------------------------------------------------------
const crypto = require("crypto");
const db = require("../config/db");

const TOKEN_TTL_MINUTES = {
    password_reset: 60,        // 1 hour
    email_verification: 60 * 24, // 24 hours — less urgent, give people time
};

function hashToken(rawToken) {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Creates a new token for a user + purpose, invalidating any previous
// unused ones for that SAME purpose first (so only the latest link works).
// `createdBy`: 'self' (user-initiated), 'admin' (staff-initiated), or
// 'system' (e.g. auto-sent on signup).
function createAuthToken(userId, purpose, createdBy = "self") {
    db.prepare("UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND purpose = ? AND used = 0").run(userId, purpose);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const ttlMinutes = TOKEN_TTL_MINUTES[purpose];
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    db.prepare(
        `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, purpose, tokenHash, expiresAt, createdBy);

    return rawToken; // caller delivers this to the user (email, or shows it to an admin)
}

// Looks up a valid (unused, unexpired) token matching the raw value and
// purpose. Returns the row (with user_id) or null.
function findValidAuthToken(purpose, rawToken) {
    const tokenHash = hashToken(rawToken);
    const row = db
        .prepare(
            `SELECT * FROM auth_tokens
       WHERE purpose = ? AND token_hash = ? AND used = 0 AND expires_at > datetime('now')`
        )
        .get(purpose, tokenHash);
    return row || null;
}

function markAuthTokenUsed(id) {
    db.prepare("UPDATE auth_tokens SET used = 1 WHERE id = ?").run(id);
}

module.exports = { createAuthToken, findValidAuthToken, markAuthTokenUsed, TOKEN_TTL_MINUTES };
