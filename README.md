# Grace Community Church — Website Platform

A simple, professional, full-stack church website with:

1. **Events page** — upcoming outreaches with dates, descriptions, and locations.
2. **Private prayer requests** — anyone can submit, only staff can view.
3. **WhatsApp-like member messaging** — real-time groups, leaders can add new/existing members.
4. **Registration & follow-up** — visitors choose phone call, WhatsApp, or email as their preferred contact method.
5. **Secure backend** — JWT auth, bcrypt password hashing, role-based access control (admin/leader/member), input validation, and rate limiting.
6. **Clean, commented code** — plain HTML/CSS/JS frontend (no build step) + a small, well-organized Express backend, so it's easy to extend.

---

## Tech Stack

| Layer      | Choice                                             | Why |
|------------|-----------------------------------------------------|-----|
| Backend    | Node.js + Express                                   | Simple, huge ecosystem, easy to read/extend |
| Database   | SQLite (via `better-sqlite3`)                       | Zero setup — it's just a file, no separate DB server to install |
| Auth       | JWT + bcrypt                                        | Stateless, industry-standard |
| Real-time  | Socket.IO                                           | Powers the group chat / messaging feature |
| Frontend   | Plain HTML + CSS + vanilla JS                       | No build tools, no framework lock-in — open a file and edit it |

You can swap SQLite for Postgres/MySQL later by only touching `backend/config/db.js` and the SQL in the route files — the rest of the app doesn't care what database is underneath.

---

## Project Structure

```
church-website/
├── backend/
│   ├── server.js              # App entry point — security middleware, route wiring
│   ├── config/db.js           # SQLite connection + schema (tables created automatically)
│   ├── middleware/auth.js     # requireAuth / requireRole / optionalAuth
│   ├── routes/
│   │   ├── auth.js            # register, login, /me
│   │   ├── events.js          # public read, staff-only write
│   │   ├── prayers.js         # public submit, staff-only read (private!)
│   │   ├── registration.js    # public "connect with us" form + staff follow-up list
│   │   ├── messages.js        # groups + message history (REST)
│   │   └── users.js           # staff-only member management
│   ├── sockets/chat.js        # Socket.IO real-time messaging, JWT-authenticated
│   ├── utils/seedAdmin.js     # creates the first admin account from .env
│   ├── .env.example           # copy to .env and edit
│   └── package.json
│
└── frontend/
    ├── index.html              # homepage
    ├── events.html              # public events list
    ├── prayer.html              # private prayer request form
    ├── register.html            # registration / follow-up form
    ├── login.html / signup.html # member auth
    ├── messages.html             # real-time group chat
    ├── dashboard.html            # staff dashboard (events, prayers, follow-ups, members, groups)
    ├── css/styles.css            # single shared stylesheet — change design tokens at the top
    └── js/
        ├── config.js            # API_BASE_URL / SOCKET_URL — edit this when you deploy
        ├── api.js               # fetch wrapper + auth/localStorage helpers
        ├── nav.js                # nav bar + auth-aware link visibility
        └── events.js / prayer.js / register.js / messages.js / dashboard.js
```

---

## Getting Started

### 1. Backend

```bash
cd backend
cp .env.example .env      # then edit .env — see below
npm install
npm start                 # or: npm run dev  (auto-restarts on file changes)
```

The server starts on `http://localhost:4000` and creates a SQLite file at `backend/data/church.db` automatically — no separate database installation needed.

**Edit `.env` before running in anything but local testing:**
- `JWT_SECRET` — generate a strong random value, e.g. `openssl rand -hex 64`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the first admin login. **Change the password immediately after your first login** — it's printed to the console as a reminder.
- `FRONTEND_ORIGIN` — must match wherever you're serving the frontend from (for CORS).

### 2. Frontend

The frontend is plain static files — no build step. Serve it with any static file server, for example:

```bash
cd frontend
python3 -m http.server 5500
# then open http://localhost:5500
```

If your frontend runs on a different port/host, update `frontend/js/config.js`:

```js
const CONFIG = {
  API_BASE_URL: "http://localhost:4000/api",
  SOCKET_URL: "http://localhost:4000",
};
```

### 3. Log in

Go to `login.html` and use the admin credentials from your `.env` file. From the **Dashboard** you can:
- Create/edit/delete events
- View & triage prayer requests, and mark their status
- See new registrations and mark them as followed up
- Promote members to "leader" or "admin", and create/manage chat groups

---

## Security Notes (what's already in place, and what to consider)

- **Passwords**: hashed with bcrypt (12 rounds), never stored or logged in plain text.
- **Auth**: JWTs signed with a server-only secret; every protected route checks both authentication *and* role (`requireAuth` + `requireRole`).
- **Prayer request privacy**: the list endpoint is staff-only; anonymous submissions have their name/contact masked even in the staff view.
- **Messaging privacy**: a user can only join/read/send in Socket.IO rooms and REST endpoints for groups they are actually a member of — checked server-side on every action, not just at the UI level.
- **SQL injection**: all queries use parameterized statements (`?` placeholders) via `better-sqlite3` — user input is never concatenated into SQL.
- **Rate limiting**: login, signup, prayer submission, and registration endpoints are all rate-limited to slow down abuse/brute force.
- **HTTP headers**: `helmet` sets sane security headers by default.
- **CORS**: locked to a single configured frontend origin (edit `FRONTEND_ORIGIN` in `.env`).
- **Input validation**: `express-validator` checks and sanitizes all incoming data before it touches the database.

**Things to add before a real production launch:**
- Serve everything over HTTPS (e.g. behind Nginx/Caddy, or a platform like Render/Railway/Fly.io that provides TLS).
- Consider moving the JWT from `localStorage` to an httpOnly cookie for extra XSS protection (noted in `frontend/js/api.js`).
- Add real email/SMS/WhatsApp integration for follow-up notifications (currently, staff just see a dashboard list — wiring up Twilio/WhatsApp Business API or an email provider is a natural next step).
- Set up regular backups of the `backend/data/church.db` file (or migrate to a managed Postgres instance for larger congregations).
- Add a password-reset flow (not included in this first version).

---

## Extending the Project

- **New page**: copy an existing `.html` file's header/footer markup, add a new `js/yourpage.js`, and link it from the nav in every page (`nav-links` in each `.html` file).
- **New API resource**: add a new file in `backend/routes/`, add its schema to `backend/config/db.js`, and register it in `backend/server.js` with `app.use("/api/yourthing", yourRoutes)`.
- **Styling**: everything is driven by CSS variables at the top of `frontend/css/styles.css` — change `--color-primary`, fonts, etc. in one place to reskin the whole site.
