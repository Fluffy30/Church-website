// utils/seedAdmin.js
// -----------------------------------------------------------------------
// Creates the first admin account from .env values, but only if no admin
// account exists yet. Safe to run every time the server starts.
// -----------------------------------------------------------------------
const bcrypt = require("bcryptjs");
const db = require("../config/db");

function seedAdmin() {
    const existingAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (existingAdmin) return;

    const name = process.env.ADMIN_NAME || "Church Admin";
    const email = process.env.ADMIN_EMAIL || "admin@example.com";
    const password = process.env.ADMIN_PASSWORD || "ChangeMe_Now123!";

    const hash = bcrypt.hashSync(password, 12);

    db.prepare(
        `INSERT INTO users (name, email, password_hash, role, contact_preference)
         VALUES (?, ?, ?, 'admin', 'email')`
    ).run(name, email, hash);

    console.log(`\n[seed] First admin account created:`);
    console.log(`[seed]   email:    ${email}`);
    console.log(`[seed]   password: ${password}`);
    console.log(`[seed] Please log in and change this password immediately.\n`);
}

module.exports = seedAdmin;

// Allow running directly: `npm run seed`
if (require.main === module) {
    require("dotenv").config();
    seedAdmin();
}
