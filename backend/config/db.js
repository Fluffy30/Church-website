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
    email_verified INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT, -- NULL = not locked; otherwise an ISO timestamp in the future
    token_version INTEGER NOT NULL DEFAULT 0, -- bumping this invalidates all previously issued JWTs
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

  -- Generic one-time tokens: used for password resets AND email
  -- verification (see "purpose"). We store a HASH of the token, never the
  -- raw token itself — same principle as password storage. The raw token
  -- is only ever seen by the person it's for (via email, or the
  -- admin-assisted reset flow), never persisted anywhere.
  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('password_reset','email_verification')),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT 'self' CHECK (created_by IN ('self','admin','system')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);
`);

// -----------------------------------------------------------------------
// Lightweight migrations for databases created by an earlier version of
// this app (e.g. before `email_verified` or `auth_tokens` existed).
// Safe to run every time the server starts — each check is a no-op if
// already applied.
// -----------------------------------------------------------------------
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.includes("failed_login_attempts")) {
    db.exec("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.includes("locked_until")) {
    db.exec("ALTER TABLE users ADD COLUMN locked_until TEXT");
}
if (!userColumns.includes("token_version")) {
    db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
}

// Older versions of this app used a `password_resets` table instead of the
// generic `auth_tokens` table. Migrate any still-valid rows over, then
// leave the old table in place (harmless) rather than risk a destructive
// DROP TABLE on someone's live data.
const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
if (tableNames.includes("password_resets")) {
    db.exec(`
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, used, created_by, created_at)
    SELECT user_id, 'password_reset', token_hash, expires_at, used, created_by, created_at
    FROM password_resets
    WHERE used = 0
  `);
}

module.exports = db;
