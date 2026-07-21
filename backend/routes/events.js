// routes/events.js
// -----------------------------------------------------------------------
// Events (outreaches, services, programs). Reading the list is public
// (anyone visiting the site can see upcoming events). Creating, editing,
// and deleting events requires admin or leader role.
// -----------------------------------------------------------------------
const express = require("express");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/events — public. Optionally ?upcoming=true to filter to future events.
router.get("/", (req, res) => {
    const upcomingOnly = req.query.upcoming === "true";
    const query = upcomingOnly
        ? "SELECT * FROM events WHERE event_date >= datetime('now') ORDER BY event_date ASC"
        : "SELECT * FROM events ORDER BY event_date ASC";
    const events = db.prepare(query).all();
    res.json({ events });
});

// GET /api/events/:id — public
router.get("/:id", (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found." });
    res.json({ event });
});

// POST /api/events — admin/leader only
router.post(
    "/",
    requireAuth,
    requireRole("admin", "leader"),
    [
        body("title").trim().notEmpty().withMessage("Title is required."),
        body("description").trim().notEmpty().withMessage("Description is required."),
        body("location").trim().notEmpty().withMessage("Location is required."),
        body("event_date").isISO8601().withMessage("A valid event date is required."),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { title, description, location, event_date } = req.body;
        const result = db
            .prepare(
                `INSERT INTO events (title, description, location, event_date, created_by)
                 VALUES (?, ?, ?, ?, ?)`
            )
            .run(title, description, location, event_date, req.user.id);

        const event = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
        res.status(201).json({ event });
    }
);

// PUT /api/events/:id — admin/leader only
router.put(
    "/:id",
    requireAuth,
    requireRole("admin", "leader"),
    [
        body("title").optional().trim().notEmpty(),
        body("description").optional().trim().notEmpty(),
        body("location").optional().trim().notEmpty(),
        body("event_date").optional().isISO8601(),
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const existing = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
        if (!existing) return res.status(404).json({ error: "Event not found." });

        const updated = {
            title: req.body.title ?? existing.title,
            description: req.body.description ?? existing.description,
            location: req.body.location ?? existing.location,
            event_date: req.body.event_date ?? existing.event_date,
        };

        db.prepare(
            `UPDATE events SET title = ?, description = ?, location = ?, event_date = ? WHERE id = ?`
        ).run(updated.title, updated.description, updated.location, updated.event_date, req.params.id);

        res.json({ event: db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id) });
    }
);

// DELETE /api/events/:id — admin/leader only
router.delete("/:id", requireAuth, requireRole("admin", "leader"), (req, res) => {
    const result = db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Event not found." });
    res.json({ success: true });
});

module.exports = router;
