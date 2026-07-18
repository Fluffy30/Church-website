// config/db.js
// -----------------------------------------------------------------------
// Sets up the SQLite database connection and creates all tables if they
// don't already exist. Using better-sqlite3 gives us fast, synchronous,
// prepared-statement queries which protect against SQL injection as long
// as we always use `?` placeholders (never string-concatenate user input).
// -----------------------------------------------------------------------
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || "./data/church.db";

// Make sure the folder for the database file exists.
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// Enforce foreign key constraints (off by default in SQLite).
db.pragma("foreign_keys = ON");
// journal_mode WAL = better concurrency for reads/writes.
db.pragma("journal_mode = WAL");

// -----------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','leader','member')),
    contact_preference TEXT DEFAULT 'email' CHECK (contact_preference IN ('phone','whatsapp','email')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    event_date TEXT NOT NULL, -- ISO date/time string
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Prayer requests are private by design: only admins/leaders can list them.
  CREATE TABLE IF NOT EXISTS prayer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- null if submitted anonymously
    full_name TEXT NOT NULL,
    contact_info TEXT, -- email or phone, optional, for follow-up only
    request_text TEXT NOT NULL,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','prayed_for')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    contact_preference TEXT NOT NULL DEFAULT 'email' CHECK (contact_preference IN ('phone','whatsapp','email')),
    notes TEXT,
    followed_up INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Messaging system: groups (like WhatsApp groups) + members + messages.
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
`);

module.exports = db;
