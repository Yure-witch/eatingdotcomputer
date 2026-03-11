# eating.computer — Development Log

This document is a running record of what has been attempted, what is in progress, and what has been confirmed successful. Only mark something as successful when the user explicitly confirms it.

---

## Format

Each entry includes:
- **Date**: When it was attempted
- **What**: What was tried
- **Status**: `attempted` | `in progress` | `successful` | `abandoned`
- **Notes**: Relevant context, blockers, or outcomes

---

## Project Scaffold

### Initial scaffold — 2026-03-08
- **Status**: `successful` (pre-existing, confirmed working)
- **What**: SvelteKit project initialized with:
  - Turso (SQLite) client wired up in `src/lib/server/turso.js`
  - Cloudflare R2 client wired up in `src/lib/server/r2.js`
  - Landing page at `src/routes/+page.svelte` with animated "eating.computer" typography (font-swapping on hover across Cambridge, Space Grotesk, Pacifico, Press Start 2P)
  - Custom Cambridge font in `static/fonts/`
  - Basic layout in `src/routes/+layout.svelte`

---

## Planning & Documentation

### North star + dev log created — 2026-03-08
- **Status**: `attempted`
- **What**: Created `NORTH_STAR.md` (project goals) and `DEV_LOG.md` (this file) in the project root
- **Notes**: User has not yet confirmed these documents are satisfactory

---

---

## Goal 1 — PWA Foundation + Push Notifications

### PWA manifest, service worker, push infrastructure — 2026-03-08
- **Status**: `attempted`
- **What**: Set up PWA foundation with push notification support
  - `static/manifest.json` — web app manifest (name, icons, theme, display: standalone)
  - `src/app.html` — added manifest link, theme-color, apple-mobile-web-app meta tags
  - `src/service-worker.js` — SvelteKit native service worker with install/activate/fetch caching + push event handler + notificationclick handler
  - `src/lib/push.js` — client-side helpers: `subscribeToPush()`, `unsubscribeFromPush()`, `isPushSubscribed()`
  - `src/lib/server/push.js` — server-side VAPID/web-push utility with lazy initialization
  - `src/routes/api/push/subscribe/+server.js` — POST endpoint to save push subscription to Turso
  - `src/routes/api/push/unsubscribe/+server.js` — POST endpoint to remove push subscription
  - `src/routes/api/push/send/+server.js` — POST endpoint to broadcast push to all subscribers (auto-cleans expired subscriptions)
  - `migrations/001_push_subscriptions.sql` — Turso schema for push_subscriptions table
  - `scripts/generate-vapid.js` — script to generate VAPID key pair
  - `npm run generate-vapid` script added to package.json
  - `.env` and `.env.example` updated with VAPID key placeholders
  - `web-push` package installed
- **Blocker**: VAPID keys need to be generated and added to `.env` before push works. Run `npm run generate-vapid` and fill in the values. The Turso migration also needs to be applied manually.
- **Key fix**: Used `$env/dynamic/private` + lazy `setVapidDetails()` to avoid build-time crash when env vars are empty.
- **Build**: Passes cleanly.

---

## To Do (from North Star)

The following major areas need to be built. None are started yet.

---

## Goal 3 — Authentication

### Auth system (Google + email/password login) — 2026-03-08
- **Status**: `attempted`
- **What**: Built full auth with Auth.js v5 (`@auth/sveltekit`)
  - `src/auth.js` — Auth.js config: Google OAuth + Credentials (email/password via bcryptjs), JWT sessions, role stored in token
  - `src/hooks.server.js` — exports `handle` from auth.js
  - `migrations/002_users.sql` — users table (id, email, name, password_hash nullable, role, created_at)
  - `src/routes/login/+page.server.js` — form actions calling `signIn()`, redirects to `/app`; load redirects logged-in users away
  - `src/routes/login/+page.svelte` — login page matching site aesthetic: "Continue with Google" button, email/password form, error state
  - Homepage — added subtle "log in" link at the bottom of the stage
  - `bcryptjs` installed for password hashing
  - Google sign-in auto-creates a student user record in Turso on first login
  - Build passes cleanly
- **To activate**: Set `AUTH_SECRET` (random string), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` in `.env`. Apply `migrations/002_users.sql` to Turso. The `/app` route doesn't exist yet (Goal 3 continues).

---

- [ ] Authentication system (login/logout, student vs instructor roles)
- [ ] Public vs private route split (public landing, gated app)
- [ ] PWA manifest + service worker setup
- [ ] Push notification infrastructure
- [ ] Email reminder system
- [ ] Week-by-week assignments/homework management
- [ ] Notes sharing (week-by-week)
- [ ] File upload and sharing (using R2)
- [ ] Class chat
- [ ] Work showcase (public gallery of student work)
