// server.js
// -----------------------------------------------------------------------
// Main entry point. Wires together security middleware, REST routes, and
// the Socket.IO real-time chat layer.
//
// Security measures applied here:
//   - helmet: sets safe HTTP headers
//   - cors: only allows the configured frontend origin
//   - express-rate-limit: applied globally (extra limits on auth routes)
//   - JSON body size limit: mitigates payload-based DoS
//   - all secrets read from .env, never hard-coded
// -----------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");

const seedAdmin = require("./utils/seedAdmin");
const initChatSockets = require("./sockets/chat");

const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const prayerRoutes = require("./routes/prayers");
const registrationRoutes = require("./routes/registration");
const groupRoutes = require("./routes/messages");
const userRoutes = require("./routes/users");

// Fail fast if critical secrets are missing.
if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET is not set. Copy .env.example to .env and configure it.");
    process.exit(1);
}

// Create the first admin account if one doesn't exist yet.
seedAdmin();

const app = express();
const server = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5500";

// --- Core security middleware -------------------------------------------
app.use(helmet());
app.use(
    cors({
        origin: FRONTEND_ORIGIN,
        credentials: true,
    })
);
app.use(express.json({ limit: "50kb" })); // small limit: this app has no file uploads
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Global rate limit (in addition to the stricter ones on auth/prayers/registration).
app.use(
    rateLimit({
        windowMs: 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
    })
);

// --- Routes ---------------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/prayers", prayerRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/users", userRoutes);

// 404 handler for unknown API routes.
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Central error handler — never leak stack traces to clients in production.
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === "production" ? "Something went wrong." : err.message,
    });
});

// --- Socket.IO (real-time messaging) --------------------------------------
const io = new Server(server, {
    cors: { origin: FRONTEND_ORIGIN, credentials: true },
});
app.set("io", io); // so REST routes can also emit events
initChatSockets(io);

// --- Start ------------------------------------------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Church website backend running on http://localhost:${PORT}`);
});
