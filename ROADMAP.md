# Roadmap

## Vision
Create a public, living archive of weekly class highlights with a private, authenticated space for submissions and conversation. The site should feel playful, tactile, and typographically bold.

## Product Pillars
- Public archive: weekly highlights, assignments, and curated artifacts.
- Authenticated community: student logins, submissions, and chat/message board.
- Media pipeline: R2-backed uploads for images, audio, video, and scans.
- Studio-grade design: an engaging homepage and interactive typography.

## Phase 0 — Setup (Week 0)
- Create new Turso database.
- Create new Cloudflare R2 bucket and access keys.
- Configure Vercel project and environment variables.
- Add `.env` template for local dev (already present).

## Phase 1 — Core Data Model (Week 1)
- Define schema for:
  - `users` (or map to Auth.js provider).
  - `weeks` (week number, title, dates, theme).
  - `assignments` (week_id, prompt, due_date).
  - `highlights` (week_id, title, body, media_key, author_id, created_at).
  - `submissions` (assignment_id, author_id, body, media_key, created_at).
  - `messages` (channel_id, author_id, body, created_at).
  - `channels` (name, is_public).
- Seed initial weeks and first assignment.

## Phase 2 — Auth + Roles (Week 1–2)
- Add Auth.js integration (Google + email allowlist).
- Roles: `admin` (you), `student` (class), optional `guest` (read-only).
- Protected routes: submissions + messaging behind login.

## Phase 3 — Public Archive (Week 2–3)
- Weekly index page with highlight cards.
- Detail pages per week.
- Media galleries fed by R2 objects + Turso metadata.
- Public API endpoints for highlights (read-only).

## Phase 4 — Submissions + Chat (Week 3–4)
- Submission form per assignment (text + optional media).
- Message board / chat channels (threaded or linear).
- Moderation tools for admin (delete, pin, feature).

## Phase 5 — Design System + Home Page (Ongoing)
- Landing page: interactive typography, playful motion, curated story.
- Consistent card system for weeks, highlights, and chats.
- Accessibility pass (focus states, contrast, reduced-motion).

## Phase 6 — Polish + Launch
- Performance review (image sizing, cache headers).
- Content seeding and final copy.
- Production deploy and announcement.

## Success Criteria
- Students can log in and submit work in under 2 minutes.
- Highlights are publicly readable and easy to browse by week.
- Chat/messaging is active and discoverable after login.
- The homepage feels unique, fun, and memorable.
