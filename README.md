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
│   ├── utils/passwordReset.js # secure token generation/verification for password resets
│   ├── .env.example           # copy to .env and edit
│   └── package.json
│
└── frontend/
    ├── index.html              # homepage
    ├── events.html              # public events list
    ├── prayer.html              # private prayer request form
    ├── register.html            # registration / follow-up form
    ├── login.html / signup.html # member auth
    ├── forgot-password.html / reset-password.html # password reset flow
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

### Password reset (added)

Two flows are supported:

1. **Self-service**: a member visits `forgot-password.html`, enters their email, and hits `POST /api/auth/forgot-password`. **No email provider is wired up yet**, so the actual reset link is written to the **server console log only** — not returned to the browser — for a staff member with server access to relay manually. Once you add a real email provider (see "Suggested Roadmap" below), replace the `console.log` in `routes/auth.js` with an actual send-email call; nothing else needs to change.
2. **Admin-assisted**: from the Dashboard → Members tab, staff can click "Reset Password" next to any member to instantly generate a one-time reset link, shown in a copyable modal, to send manually (text/WhatsApp/in person). Useful right now, before email is automated.

Reset tokens: random 256-bit values, only a SHA-256 hash is ever stored (same principle as password hashing), expire after 60 minutes, and are single-use.

### Email system (added)

**Sending emails**: `backend/utils/mailer.js` sends through any standard SMTP provider — SendGrid, Mailgun, Postmark, Amazon SES, Gmail SMTP, or your own mail host. Configure it via `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — examples for common providers are in `.env.example`). **If `SMTP_HOST` is left blank, emails are printed to the server console instead of sent** — so the app works out of the box for local testing, but you must fill this in before real launch.

**Email verification**: every new signup automatically gets a verification email (24-hour link). Verification is currently *non-blocking* — unverified members can still log in — so a delayed or missed email never locks someone out. Instead, a small dismissible banner appears site-wide reminding them to verify, with a one-click resend. Endpoints: `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`.

**Automatic notifications now wired up**:
- Verification email on signup
- Password reset email (self-service) — same token system as before, now actually emailed instead of console-only
- Confirmation email to anyone who submits a prayer request with an email address
- Confirmation email to anyone who submits the "Connect With Us" form with an email
- Optional: set `ADMIN_NOTIFICATION_EMAIL` in `.env` to get an email alert whenever a new prayer request or registration comes in

All of the above degrade gracefully — if SMTP isn't configured, or an email fails to send, the person's action (signup, prayer request, etc.) still succeeds; only the email itself is skipped/logged.

**Not yet covered by email** (still on the roadmap): staff-initiated bulk emails to members, digest/newsletter emails.

### Account lockout (added)

After 5 consecutive failed login attempts, an account is locked for 15 minutes — even a correct password is rejected while locked, so an attacker can't tell they've found the right one. This is separate from (and on top of) the IP-based rate limiting on the login endpoint: rate limiting slows down one IP hitting many accounts, lockout protects one account even if attempts are spread across many IPs. A successful login resets the counter. Staff can unlock an account early from the Dashboard → Members tab instead of making someone wait out the full window. Thresholds are set in `routes/auth.js` (`LOCKOUT_THRESHOLD`, `LOCKOUT_MINUTES`).

### Session revocation (added)

JWTs are normally stateless — once issued, valid until they expire, with no way to invalidate one early. To allow revocation, every user has a `token_version` counter in the database, embedded in each JWT at login. Every authenticated request checks the token's version against the current database value; if they don't match, the session is treated as revoked even though the token hasn't technically expired.

This powers:
- **"Log out everywhere"** — a link next to the normal Logout link (added via `nav.js`) for any logged-in user, in case they think a device is lost or a session looks compromised.
- **Admin "Force Logout"** — a button per member in the Dashboard → Members tab, for staff to instantly sign someone out of every device without changing their password.
- **Automatic revocation on password reset** — resetting a password (self-service or admin-assisted) signs out every existing session, in case the old password was compromised.
- **Immediate effect on deactivation** — deactivating a member's account now kills their active session on their very next request, not just the next time they try to log in.

### Uptime monitoring (added)

`GET /api/health` now actually queries the database rather than just confirming the Node process is alive, so it correctly reports unhealthy if the database is unreachable. Point a free monitoring service at it:

1. Sign up for [UptimeRobot](https://uptimerobot.com), [Better Uptime](https://betterstack.com/better-uptime), or similar (most have a free tier).
2. Add an HTTP(s) monitor pointed at `https://your-backend-url/api/health`, checked every 1–5 minutes.
3. Set it to alert (email/SMS) if the response isn't a 200 with `"status":"ok"` in the body, or if the request times out.
4. This only monitors the backend — GitHub Pages/static frontend hosting is generally very reliable and doesn't typically need separate monitoring, but you can add a second monitor for your frontend URL too if you want full coverage.

### SMS & WhatsApp (added)

`backend/utils/sms.js` sends real SMS and WhatsApp messages via Twilio, configured through `.env` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — see `.env.example` for setup notes and a link to the Twilio console). **If Twilio isn't configured, messages are printed to the server console instead of sent** — same safe-fallback pattern as the email system.

This is now wired into:
- **Registration confirmations** — sent via whichever channel the person actually chose (email → email; phone → SMS; WhatsApp → WhatsApp), instead of always defaulting to email regardless of stated preference.
- **Prayer request confirmations** — if the contact info they left looks like an email, they get an email; if it looks like a phone number instead, they get an SMS.

Twilio was chosen because — unlike email, where SMTP is a shared standard across providers — SMS/WhatsApp providers don't share a common protocol, so there's no equivalent provider-agnostic abstraction. If you'd rather use a different provider, `utils/sms.js` is the one file you'd need to change.

### Privacy policy (added)

`frontend/privacy.html` is a plain-language starting-point privacy policy explaining what's collected, why, and who can see it. It's linked from the footer of every page, plus called out directly on the prayer request, registration, and signup forms — right where people are actually handing over personal information.

**Before you launch, you need to:**
- Replace `[DATE]` with a real date, and keep it updated when you change the policy.
- Replace the placeholder `privacy@example.com` with your church's real contact email for privacy requests.
- Have someone familiar with your local privacy/data protection laws review it — this is a solid starting template, not legal advice, and requirements vary by country/state.

---

## Extending the Project

- **New page**: copy an existing `.html` file's header/footer markup, add a new `js/yourpage.js`, and link it from the nav in every page (`nav-links` in each `.html` file).
- **New API resource**: add a new file in `backend/routes/`, add its schema to `backend/config/db.js`, and register it in `backend/server.js` with `app.use("/api/yourthing", yourRoutes)`.
- **Styling**: everything is driven by CSS variables at the top of `frontend/css/styles.css` — change `--color-primary`, fonts, etc. in one place to reskin the whole site.
