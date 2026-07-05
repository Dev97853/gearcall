# GearCall — Mechanic Booking Platform (with real backend)

A full-stack prototype: customers book car/bike mechanics, mechanics accept jobs,
admins run the platform. This version has a **real backend** — login/signup,
password hashing, sessions, and a **SQLite database** that persists between
restarts.

Zero npm dependencies — it only uses Node.js's built-in modules
(`http`, `crypto`, and the new built-in `node:sqlite`). Nothing to `npm install`.

## Requirements

- **Node.js 22.5 or newer** (needed for the built-in `node:sqlite` module).
  Check your version: `node -v`

## Run it

```bash
cd gearcall-backend
npm start
```

Then open **http://localhost:3000** in your browser.

(`npm start` runs `node --experimental-sqlite server.js`. On very recent Node
versions the flag isn't required anymore, but passing it is harmless.)

## Demo logins

The database is seeded automatically the first time you run it:

| Role           | Email                  | Password  |
|----------------|-------------------------|-----------|
| Admin          | admin@gearcall.com      | admin123  |
| Car mechanic   | sanjay@gearcall.com     | mech123   |
| Bike mechanic  | amit@gearcall.com       | mech123   |
| Customer       | rohan@example.com       | cust123   |

You can also sign up new customer or mechanic accounts from the app itself.
New mechanic sign-ups start as **pending** and need admin approval
(log in as admin → "Mechanic approvals") before they can see job requests.

## Project structure

```
gearcall-backend/
├── server.js          → HTTP server + all REST API routes
├── lib/
│   ├── db.js          → SQLite schema + seed data
│   └── auth.js        → password hashing + session tokens (no external libs)
├── public/
│   ├── index.html      → login/signup + customer/mechanic/admin dashboards
│   ├── style.css
│   └── app.js          → talks to the API with fetch()
├── data/
│   └── gearcall.db     → created automatically on first run (SQLite database)
└── package.json
```

## How data flows

- **Customer** logs in → picks vehicle + service → submits a booking →
  `POST /api/bookings`.
- **Mechanic** logs in → sees only pending jobs matching their vehicle
  specialisation → accepts/declines → `POST /api/bookings/:id/accept|reject`.
  Once accepted, they mark it complete → `POST /api/bookings/:id/complete`.
- **Admin** logs in → sees every booking, revenue, and mechanic approval queue →
  approves/rejects mechanic applications → `POST /api/admin/mechanics/:id/approve|reject`.

All of this is backed by two SQLite tables (`users`, `bookings`) in
`data/gearcall.db` — restart the server and your data is still there.

## Security notes (read before deploying anywhere public)

This is a learning/prototype backend. Before putting it in front of real users:
- Set a strong, secret `GEARCALL_SECRET` environment variable (used to sign
  login tokens). Right now it falls back to a default dev value.
- Add HTTPS (put it behind a reverse proxy like Caddy/Nginx, or a host that
  terminates TLS for you).
- Add rate-limiting on `/api/auth/login` and `/api/auth/signup` to slow down
  brute-force attempts.
- Add input validation/length limits beyond the basic checks already in place.
- Consider moving off the experimental `node:sqlite` module to a stable
  driver (e.g. `better-sqlite3`) once you're ready to add real dependencies.

## Next steps you might want

- Real-time updates (WebSockets) instead of manual refresh
- Payments integration
- Live location tracking for mechanics
- Email/SMS notifications on booking status changes
