// middleware/auth.js
// -----------------------------------------------------------------------
// Authentication (who are you?) and authorization (are you allowed?)
// middleware. The token is a signed JWT sent as:
//   Authorization: Bearer <token>
//
// SESSION REVOCATION: JWTs are normally stateless — once issued, they're
// valid until they expire, with no way to "log someone out early". To
// allow revocation (e.g. an admin locking out a compromised account, or
// a member hitting "log out of all devices"), every user has a
// `token_version` counter. Each JWT embeds the token_version that was
// current when it was issued. On every authenticated request, we check
// that against the CURRENT value in the database — if an admin (or the
// user themselves) has bumped it since, the token is treated as revoked
// even though it hasn't technically expired yet. This costs one extra
// database lookup per request, which is negligible with SQLite/better-sqlite3.
// -----------------------------------------------------------------------
const jwt = require("jsonwebtoken");
const db = require("../config/db");

// Verifies the JWT, checks it hasn't been revoked, and attaches the
// current user record to req.user. Blocks the request with 401 if
// missing/invalid/expired/revoked/deactivated.
function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: "Authentication required." });
    }

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired session." });
    }

    const user = db.prepare("SELECT id, name, email, role, is_active, token_version FROM users WHERE id = ?").get(payload.id);

    if (!user || !user.is_active) {
        return res.status(401).json({ error: "This account is no longer active." });
    }

    // If the token's version doesn't match the current one, it was issued
    // before a revocation event (password reset, admin action, or a
    // "log out everywhere" request) — treat it as invalid.
    if ((payload.tokenVersion ?? 0) !== user.token_version) {
        return res.status(401).json({ error: "Your session has been signed out. Please log in again." });
    }

    // Use the fresh DB values for role/name/email rather than trusting
    // whatever was baked into the token at login time — this way a role
    // change (e.g. promoted to admin) takes effect immediately, not only
    // after the token naturally expires and is reissued.
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
}

// Restricts a route to one or more roles, e.g. requireRole("admin","leader")
// Must be used AFTER requireAuth.
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: "Authentication required." });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: "You do not have permission to do that." });
        }
        next();
    };
}

// Optional auth: attaches req.user if a valid, non-revoked token is
// present, but does NOT block the request if it's missing or invalid.
// Useful for endpoints that behave differently for logged-in vs
// anonymous users (e.g. prayer requests).
function optionalAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            const user = db.prepare("SELECT id, name, email, role, is_active, token_version FROM users WHERE id = ?").get(payload.id);
            if (user && user.is_active && (payload.tokenVersion ?? 0) === user.token_version) {
                req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
            }
        } catch (err) {
            // Ignore invalid token for optional auth; treat as anonymous.
        }
    }
    next();
}

module.exports = { requireAuth, requireRole, optionalAuth };
