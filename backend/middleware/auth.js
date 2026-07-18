// middleware/auth.js
// -----------------------------------------------------------------------
// Authentication (who are you?) and authorization (are you allowed?)
// middleware. The token is a signed JWT sent as:
//   Authorization: Bearer <token>
// -----------------------------------------------------------------------
const jwt = require("jsonwebtoken");

// Verifies the JWT and attaches the decoded payload to req.user.
// Blocks the request with 401 if missing/invalid/expired.
function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: "Authentication required." });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload; // { id, role, name, email }
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired session." });
    }
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

// Optional auth: attaches req.user if a valid token is present, but does
// NOT block the request if it's missing. Useful for endpoints that behave
// differently for logged-in vs anonymous users (e.g. prayer requests).
function optionalAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
        try {
            req.user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            // Ignore invalid token for optional auth; treat as anonymous.
        }
    }
    next();
}

module.exports = { requireAuth, requireRole, optionalAuth };
