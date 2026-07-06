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

## Lab — GIF Studio

### Fix Random Walk + Metaballs, add 4 generative-typography modes — 2026-07-01
- **Status**: `attempted`
- **What**: In `src/lib/gen-art.js` + `src/routes/app/lab/gif/+page.svelte`:
  - **Random Walk fixed** — trail fade was overpainting the bg at 2% alpha on an opaque buffer (8-bit rounding never clears → permanent grey mush). Now trails live on a transparent buffer faded with `destination-out`; walkers get a soft spring back to their seed point so the web stays gathered on the letterforms; per-walker accent↔fg colour; faint title ghost underlay for legibility.
  - **Metaballs fixed** — ball placement mask was rasterised at the coarse blob-grid resolution (title drawn ~5px tall → unreadable smear). Now a 480-wide mask is point-sampled at cell centres. Wobble is now sine-periodic (whole cycles per loop → seamless GIF seam); "Reaction speed" slider relabelled "Wobble" (× cycles) for this mode; ctx.filter feature-detect with low-res-upscale blur fallback for older Safari.
  - **New modes**: Halftone (full-page dot grid, type = big dots, travelling wave; Dot size slider), Micro Type (title rebuilt from tiny copies of its own letters, weight wave via variable font; Cell size slider), Particles (title assembles/explodes from particles, seamless; Scatter slider), Slit Scan (animated type carved into wave-displaced horizontal slices).
  - Reaction-speed slider now only shows for modes that consume it (`SIM_MODES`).
  - Also in working tree from a prior pass (kept): Step & Repeat **Columns** slider, Wave Wall mode, Cascade baseline lock.
- **Notes**: Vite compiles both modules; visual check in browser pending user confirmation.

### Round 2 — user feedback pass on the new modes — 2026-07-01
- **Status**: `attempted`
- **Feedback**: Particles "budget", Slit Scan "doesn't make sense", Micro Type "sloppy", Halftone "cool but illegible", Step & Repeat needs column-gap control.
- **What**:
  - **Halftone legibility** — dot radius now comes almost entirely from mask coverage (letters stay solid); the travelling wave rides colour + a light shimmer instead of pounding dot size; grid ~50% denser (W/84 pitch); coverage supersampled 4×/cell → clean halftone edge gradients.
  - **Particles redesign** — peel sweep (word disassembles left→right via per-particle phase offset), curved swirling flight paths instead of a straight radial burst, soft accent halo + sharp core per particle (premium glow without additive blow-out on light palettes), pulse envelope with a dead zone so the assembled word holds on screen for a beat each loop.
  - **Micro Type cleanup** — coverage supersampled 4×/cell, edge cells fade+shrink continuously (no ragged hard cutoff), denser grid (W/56), background whisper field pushed way down (alpha 0.06, thin 100-weight), font strings quantised for canvas font-cache reuse.
  - **Slit Scan removed → Echo added** — concentric stroked copies of the title expand outward on a geometric scale ladder (g^(i+phase)); ring i lands where ring i+1 started at the loop seam and newborn rings are hidden behind the solid fill → perfectly seamless sound-wave pulse. `drawFittedText` gained a stroke mode.
  - **Step & Repeat** — new **Column gap** slider (0–12% of width, shows when Columns > 1); scene reads `o.tileGap`.
- **Notes**: Vite compiles clean; visual check pending user confirmation.

### Round 3 — BZ export fidelity (crispness + preview/export match) — 2026-07-02
- **Status**: `attempted`
- **Feedback**: BZ export much lower res than Step & Repeat even at 1920; roundedness and spacing in the export don't match the preview.
- **What** (`src/lib/gen-art.js`):
  - **Crispness**: BZ grid cap raised 760 → 960 and CCA 680 → 900, so the sim grid stays ~0.5×/0.45× of the output at every resolution (constant ~2× upscale; 1920 exports were upscaling 2.5×+ → crunchy).
  - **Scale-invariance fix (the real bug)**: pattern parameters were double-scaling with the grid factor. Ring spacing = wave speed (∝ neighbourhood radius) × refractory period N, and BOTH radius and N (plus iterations/frame) were multiplied by gridF → exports had ~2× the spacing/roundedness of the preview. Now ONLY the radius scales with gridF; N and reaction speed are pure time quantities. Verified numerically: ring spacing as a canvas fraction is now constant across grid scales (was ∝ gridF).
  - Roundedness radius cap (6.5 cells) removed — it saturated at export grids while the preview stayed under it, changing wavefront shape with resolution. Affordable via new per-row prefix-sum neighbour counting (O(r) per cell vs O(r²)); verified exactly equivalent to the old offset scan (0 mismatches at r = 1–16).
  - CCA: state count N now scales with gridF (spiral wavelength = constant canvas fraction instead of shrinking at export res).
  - BZ warm-up now always covers one full wave period (old 90-iteration cap cut it short at export grids).
- **Notes**: Preview ≤ 900px renders at export dims (identical by construction); above that, the sim is scale-invariant so the look matches at ~2× the detail. Pending user confirmation.

### Round 4 — BZ type overlay + Color Metaballs / Blob Color modes — 2026-07-04
- **Status**: `attempted`
- **What** (`src/lib/gen-art.js`, `+page.svelte`):
  - **BZ crisp-type overlay** — letters redrawn as vector text at full output res over the sim (the source letters lived on the half-res grid → crunchy edges). Sim layer renders the letter region + a fade-in clearance zone as background so grid-res wavefront fringes never touch the crisp edge. Counters (holes in e/a/o) flood-filled at reset and blocked from firing (they saturated near-fg and looked solid).
  - **Color Metaballs (`cmeta`)** — hairline (wght 100) gray type on white; hidden metaball influence field swells the letterform (blurred-bold "inflation field" × influence crosses a threshold, contour slides outward with influence) filled with a vibrant hue-shifting palette derived from the accent, iso-shaded. Beads: even Poisson-thinned chain along ALL strokes, sized from the FITTED letter height (raw font size made them ~2× too big). Static geometry; 5 pod envelopes with expanding reach are the only animation. Selecting the mode auto-sets white bg + gray fg.
  - **Blob Color (`blobc`)** — same engine, `twoState` flag: influence saturates so touched regions snap to ONE fixed blob state (rounded bold contour THB=0.34); colour strictly bounded by that max-blob silhouette.
  - Key lesson logged: canvas `destination-in` clips must be a single composite (letter-by-letter clipping erased the whole layer).
- **Notes**: Pending user confirmation on the blobc look.

### Round 6 — Blob 3 family + Blob 4 creature (user: "perfect") — 2026-07-05
- **Status**: `successful` (user: "godd this is perfecttttt")
- **Modes added**: Blob 3-C (cellular letter-organism: 30/50/20 branch/stay/edge-die per ~½s, letter-swallow commitment, tenure, ~10-letter cap, golden-ratio breathing), Blob 3-N (loop-seamless pod noise), Blob 3-C Fast (2× + Speed slider), Blob 4 (single-mass creature), all on one GPU factory (`blob3Scene`) with step & repeat wall support (Repeats/Columns/Gap).
- **Blob 4 final architecture**: permanent full-weight head disc glides at constant velocity (goal-seeking far treks ≥45% canvas, arc-capped steering, waypoint navigation ALONG the text); trail segments born at zero weight and matured by a CONTINUOUS HANDOFF (segment weight = exactly what the head's gaussian stopped contributing → summed field constant, no drop cadence); rear retired by a CONTINUOUS TAIL POINT sliding a smoothstep window along the path (mirror of the front). Whole creature = two smooth scalars (headDist, tailDist). Splits = orphaned rear lobe fading in place.
- **Debugging lessons (each "stutter" had a distinct mechanism)**:
  1. WebGL context-per-scene exhausted the ~16-context browser cap → silent fallback to CPU Blob 2 (fixes appeared to "change nothing"). Fix: ONE shared GL context, per-render state re-establishment.
  2. `willReadFrequently: true` on the preview canvas forced GPU→CPU readback per frame → few-fps preview. Never set it on a canvas that only draws.
  3. Preview was capped at GIF fps by design; `smooth: true` scenes now preview at display rate (export unchanged).
  4. Full-weight trail drops doubled the field at the head every 0.25s → front advanced at 4-5Hz despite a smooth head. Per-node death timers did the same to the rear. BOTH edges must be continuous functions of scalars, not per-node timers.
  5. Per-frame `measureText`/text redraw caused GC frame spikes → cache the wall to a canvas.
  6. Arrival-smoothing crutches (flat reach curve, low gate) became a "sudden minimum footprint" once the field was truly continuous — reverted to match Blob 3.
- **Meta-lesson**: the user's concrete perceptual reports ("updates 5×/sec", "fps is high but…", "smooth fading, popping arriving") were more diagnostic than code inference; quantitative symptom → mechanism matching is what cracked each one.

### Round 5 — Blob Color refined to final form — 2026-07-04
- **Status**: `in progress` (user reacting very positively — "looking really great", "I love it", "you're doing amazing"; not yet formally confirmed done)
- **What** (`gen-art.js`, `+page.svelte`): blobc rebuilt on a chamfer DISTANCE FIELD from the exact hairline letterform (seed must be the SAME weight as the visible text — variable-font advances shift with weight and misaligned the film). Influence drives a `reach` from the letter silhouette outward → growth order is text-shape-first, blobs at peak, ferrofluid shrink-back on fade. Pod envelopes pow 3.2 + offsets packed into 75% of the loop → quiet plain-text beat each loop. Hue = lagged/compressed intensity drive: long red hold, LONG red→yellow crossfade (user's favourite moment — red text visible under amber goo), pink only at the crest (~top 3% of drive). Mode entry defaults: white bg, gray hairline, Wobble 1×, 4s loop.
- **Key numbers**: hue lag ×0.3, compression pow 2.0, pink at I>0.8; reach = sat^1.6, maxReach = 0.7·letterH; magnet = 0.2+1.6·n.

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
