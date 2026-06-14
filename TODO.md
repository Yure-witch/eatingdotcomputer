# eating.computer — TODO
*Last updated: June 7, 2026*

Items roughly ordered by priority. See `NORTH_STAR.md` for the big picture.

---

## New / Recently Added
- [ ] **Giphy GIF search** — GIF picker with Giphy API (built — needs testing)
- [ ] **Animated Word Art** — decorative animated text styling formatted as text with CSS animations
- [ ] **Gamification & Achievements** — achievement system with unlockable badges, animated celebrations, progress tracking
- [ ] **Homepage week checklist** — finish the week plan checklist system (branch: gome-page-week-checklist); migration, CRUD, student/instructor views
- [x] **Lab tab** — new top-level nav (was "Playground"), route at `/app/playground`, flask icon, placeholder page built
- [ ] **Lab: GitHub-backed projects** — paste a public GitHub repo URL, app fetches files via GitHub API, caches in R2, serves `index.html` at `/lab/[projectId]`; manual "Sync" button + periodic polling for new commits (check latest SHA via Commits API); webhook support as upgrade; class gallery of all published projects; fork/remix
- [ ] **Chat box skins & color schemes** — customizable chat bubble themes per user
- [ ] **Emoji reactions to assignments** — let students react to assignment items with emoji

---

## Chat & Messaging
- [ ] **Gate read receipts on green presence** — read receipts must only be applied while the user is `active` (green). If the user is `idle` (yellow) or offline, suppress the lastRead write entirely. When they next become green and the message is still on-screen / in viewport, queue the read-receipt write then. Bug today: receipts fire while a tab is backgrounded, so the sender sees "read" before the recipient has actually looked at it.
- [ ] **Mentions (@username)** — parse @name in message content, highlight in bubbles, notify mentioned user
- [ ] **Unread notifications bell** — icon in top-right showing count badge; reactions, replies, @mentions overlay
- [ ] **Message action bar** — hover/tap to reveal Reply, React, Star, Thread + quick-react emoji
- [ ] **Reply in thread** — threaded replies in side panel (desktop) / pushed view (mobile)
- [ ] **Saved messages** — private star/save, viewable in Files tab
- [ ] **Chat timer** — countdown/stopwatch visible to all, fullscreen for projector
- [ ] **Chat polls** — live voting in channels + DMs
- [ ] **Sticker placement** — iOS-style drag-and-place stickers on message bubbles
- [ ] **Copy effects with text** — clipboard preserves PUA effect markup on partial selections
- [ ] **Variable font weight transitions** — animate wght axis smoothly
- [ ] **Email reminders**
- [ ] Scope chat channels to a class (currently global)

---

## Expression & Styling
- [ ] **Fix shake animation** — shake effect should go side to side (currently wrong axis/direction)
- [ ] **Lockable font variation defaults** — allow setting font weight and width as defaults for all future messages (persisted per user); size is excluded (always resets to 1.0 between messages); include a reset-to-default option
- [ ] **Expression picker** — whimsical moments (emoji/EK/custom emotes/GIFs partially done)
- [ ] **Word Art** — arched, shadowed, outlined, gradient text effects
- [ ] **Emoji Kitchen popularity** — scrape emoji.mx/funbox, surface popular mixes first
- [ ] **Fix scalloped edge corners** — corner peaks have two bezier points where there should be one; needs a single properly-tuned control point connecting to the edges
- [ ] **Fancy text / Unicode fonts** — integrate Unicode math-symbol serif/script/bold/etc. character mappings into text formatting (the decorative fonts made from mathematical alphanumeric symbols)

---

## User Profiles & Social
- [ ] **Custom & generative avatars** — three flavors, all replacing the current initial-on-tint placeholder used in chat read receipts, mention picker, notification bell, etc.:
	- *Custom upload*: pick a photo, upload to R2, mirror to users.avatar_url.
	- *Generative procedural*: pregenerated/random-seed procedural avatars (e.g. blob/shape/pattern compositions) the user can pick from without uploading.
	- *Animated emoji avatar*: pick a Telegram-style animated emoji (re-use the existing Lottie pipeline + emote-mount.js) as a looping avatar that animates everywhere the static Avatar component renders today.
- [ ] **MySpace-style user profiles** — customizable decorated profile pages
- [ ] **Profile "last seen" accuracy** — profile pages don't accurately show last seen time
- [ ] **Spotify / Apple Music integration** — show what users are listening to
- [ ] Work showcase / public gallery

---

## Platform & Admin
- [ ] **Enrollment approval UX** — welcome email + auto-refresh session on approval
- [ ] **Lecture Notes** — dashboard placeholder exists, needs content
- [ ] **Class factions / enrollment system** — multi-class scoping, all data scoped to a class
- [ ] **Slack integration** — bidirectional message/notification flow

---

## Infrastructure / Ops
- [ ] Run `npm run migrate` in production for migrations 010 + 011

---

## Dev & Testing
- [ ] **Bot/simulation framework** — fake students for stress testing
- [ ] **ClawdBot** — AI bot on local LLM (Ollama) for chat simulation
- [ ] **Local AI integration** — LLM for bot personas, content gen, in-app AI
