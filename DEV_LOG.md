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

## Chat — Telegram emote hover tooltips

### TG emote hover card (tab + pack name) — 2026-07-20
- **Status**: `attempted`
- **What**: Hovering a Telegram emote in chat (sent inline, jumbo, or on a reaction chip) now shows the same floating card EK/custom emotes get:
  - `ExpressionTip.svelte` — new `.tg-emoji` branch in `onMove`: default `[tg:]` emotes show resting-frame thumb + emoji name + the picker tab as "<tab icon emoji> <category>" (appends "✨ Special effects" for av>0 emotes); custom `[tgc:]` emotes show thumb + alt-emoji name + the pack's tab icon (first emote's thumb, as in the picker rail) + pack title. Per user feedback: no "Telegram" word — the tab icon carries it. Adaptive (white-silhouette) pack thumbs are skipped so the card doesn't show a blank image. Manifests warmed in onMount.
  - `telegram-emoji-store.js` — new `TG_CAT_ICONS` export (category → tab icon emoji), now the single source for TelegramEmojiPanel's tab rail and the tooltip meta line.
  - `emoji-tip.js` — new `tgReactionName(token)` helper naming `[tg:]`/`[tgc:]` reaction keys (e.g. "grinning face (😀 Smileys)", "fire (HotCherry)").
  - Channel + DM pages — reaction-chip tooltip "reacted with …" now uses `tgReactionName` instead of falling through to the raw token string.
- **Follow-up (same day)**: card image is now a live animated preview via `LottieSticker` (plays animated emotes; freezes static packs at the resting frame; flags render as webp; adaptive packs get tinted to --ink so the big preview works even though their webp thumbs are white). Meta line shows the expression-picker tab's Material icon (`animated_images` for Animated-tab emotes/packs, `sentiment_very_satisfied` for static Library packs). Custom packs additionally show the pack's own tab icon (first emote's thumb) + title; default emotes show only picker icon + category text (per user: no mini category-emoji icon for non-pack emotes — TG_CAT_ICONS stays in the store for the panel's tab rail only). Same picker-tab icon treatment on the other cards: EK `blender` + "Emoji Kitchen", custom `[ce:]` `sentiment_very_satisfied` + "Custom emotes", plain emoji pops (wrapEmojiInText) `mood` + "Emoji".
- **Follow-up (2026-07-22)**: picker's Animated tab renamed "Animated stickers" → "Animated emotes". TG hover card meta restructured into TWO lines: line 1 = picker tab (`animated_images` + "Animated emotes", or `sentiment_very_satisfied` + "Emotes" for static packs); line 2 = the pack (thumb icon + title) for [tgc:], or just the category name for default [tg:] emoji (special-effects suffix dropped).
- **Notes**: The inlined `onMsgListMousemove`/`emojiTooltip` handlers in both chat pages are dead code (ExpressionTip is the live path) — left untouched.

## Roadmap — Syllabus section

### Expandable syllabus outline on /app/orbit — 2026-07-22
- **Status**: `attempted`
- **What**: The Roadmap page now shows the class's KEY syllabus between the roadmap window and Files:
  - `src/lib/server/syllabus.js` — new `getKeySyllabusOutline(classId)`: ordered `[{ week, title, weekOf, topics[] }]` from the key syllabus's week blocks (hidden blocks/topics excluded), mirroring what the rendered syllabus document shows.
  - `orbit/+page.server.js` — loads the outline + computes `syllabusNextWeek` (current plan's week + 1, falling back to current week, then week 1).
  - `orbit/+page.svelte` — "Syllabus" section: collapsed by default showing ONLY the next week's card (header + topics, highlighted with a "next" tag); an "All N weeks / Just the next week" button expands to the full detailed outline of every week. Cards styled to match the roadmap rows (`sylo-*` classes); weekOf dates render as "September 1" style.
- **Notes**: Section hides entirely when no key syllabus is set (helper returns []).
- **Follow-ups (same day, user feedback)**: "next" tag renamed to an "upcoming" pill sitting ABOVE the card; upcoming-card tint softened (8% primary over surface — full primary-container was too dark on light theme); the expand toggle moved below the entries as a "See all N weeks" link-style button. The Roadmap window got the same inline expand treatment (replacing the old /app/weeks link). In both expanded lists, weeks that have already passed collapse to just their name (no status/due/topics) and render dimmed.

## Gemma — opt-in daily digest

### Daily digest engine + Manage tab + opt-ins — 2026-07-23
- **Status**: `attempted`
- **What**: Opt-in daily digest DM'd by a new `gemma` bot user:
  - Migration 041 (applied): `users.gemma_digest` (opt-in; instructor's flag doubles as the class master switch), `users.interests` (instructor-entered, feeds inspiration), + seeds the `gemma` users row (not a class member → never appears in rosters).
  - `src/lib/server/gemma-digest.js`: recap from the RTDB live tier (which IS the last ~24h by design), incomplete items via getWeekPlans+getCompletionsForStudent (current + next plan), interests; text written by the OpenAI-compatible LLM (recipient's own user_ai_keys row, else any instructor's — same endpoint as Gemma chat) with a plain templated fallback when keyless; delivered as a real DM from `gemma` (compact {u,c} + userChats + unreadCounts increment) + push via notifyUsers.
  - `/api/gemma/digest`: GET = cron (Bearer CRON_SECRET, master-switch gated), POST = instructor "send now" ({userId?} defaults to caller and BYPASSES the master switch for testing; {all:true} runs the full batch). vercel.json cron `0 13 * * *` (9am ET).
  - `/api/gemma/settings`: POST {optIn} (own flag, any user) or {userId, interests} (instructor-only).
  - Manage → new "Gemma" tab: master toggle, "✨ Send me a test digest now" button (reports LLM vs template), per-student interests editor with opt-in status chips.
  - Profile → Edit: "Daily Gemma digest" checkbox for students (instant save).
  - DM page: gemma resolved explicitly (otherUser fallback + userMap entry) so the conv doesn't show "Unknown".
- **Notes**: NO web-search tooling exists in the Gemma integration (chat proxy is a pure pass-through) — inspiration comes from model knowledge + entered interests; user informed. Digest DM appears as a normal DM conversation; archived by the nightly sync like any DM (gemma users row makes name resolution work).
- **Follow-up 23 (2026-07-24) — COMPLETE SET ACHIEVED: 8/8 goals, 9s, 0 dupes/junk**: (a) ARCHIVE-AWARE HARVEST — the user's 3-goal message had been archived out of the live RTDB tier by the nightly sync (root cause of the "missed message"); gatherRecapLines + gatherDMLines now merge the Turso archive (last 48h, deduped by push id, live tier wins) so the harvest window is a true rolling window immune to cron timing; verified: identities + gemma-integration + "Send the syllabus out" all restored. (b) refine's rename path had NO guards — write emitted "Explain functions to me", refine rewrote with the WRONG name ("…Ricky…" = the member) via unguarded UPDATE; refine targeting now includes self-named labels and its rewrites pass the same junk/self-name/similarity gauntlet as inserts; every refine deletion is now console.warn-logged with the offending fix. Final verified accumulate: all 8 expected goals, correctly framed, "Explain functions to Richard Yurewitch" restored. Debug endpoint deleted.
- **Follow-up 22 (2026-07-24) — STABILIZED & VERIFIED (5 goals, 2 identical runs, 0 dupes, 0 junk)**: (a) markdown digests — generator emits "- " lists, digest bubbles parse via digestMd (breaks:true + "•"→"-" repair for stored digests); (b) temp 0 experiment FAILED (greedy under-extracts + hallucinates — "Remind Ricky to update Ricky"); steps stay 0.35+no-think; (c) accepted the model's per-run variance and made the SYSTEM converge instead: goals accumulate across harvests (verified 5→8 over two runs), count prompt gets the ALREADY-TRACKED list to skip, near-duplicate paraphrases blocked by token-Jaccard ≥0.5 at insert; (d) hallucination guards — JUNK_RE (the recipient/user/member placeholder-speak) + self-name guard (a goal naming the member's own full name is model confusion; requester names like "Richard Yurewitch" unaffected); (e) NOTE: 3 goals from the Thursday message aged out of the 24h chat window mid-testing (nightly sync archived it) — not an extraction bug; real usage accumulates before archival. Reset-testing kept wiping that history, which masked this. Debug endpoint deleted.
- **Follow-up 21 (2026-07-24) — GOALS GET THEIR OWN HOME**: new "Gemma" sidebar section ABOVE Channels (her chat entry with digest preview/unread badge moved here + a "🎯 Goals" entry → new /app/goals page). The Goals page is the historical todo list: assignment items, Open goals, Completed history (struck-through with ✓ date) — checkboxes, "asked by" chips, Show-source highlighted citations, two-step ✕ removal all preserved (getAllGoals + GET /api/gemma/goal). The Gemma chat page is now pure chat + digests (checklist card removed; opt in/out stays as a centered footer control); digests notify about list changes — harvestGoals returns the inserted count, and both prompt + template add "N new goals added — see your Goals list" when > 0. Also: live "Generating now" got a spinner + 1s-ticking elapsed time.
- **Follow-up 20 (2026-07-24) — PIPELINE SOLVED, VERIFIED 17s/7-goals**: multi-step count→write→verify pipeline (user's design) + three compounding root causes found by direct probing: (1) temp 0.1 → deterministic rumination loops; (2) VERBOSE prompts (few-shot + "candidate by candidate") → 24k-char reasoning spirals, finish=length, content:null — minimal terse prompts extract perfectly (8/8 in isolation); (3) even minimal prompts spiral NONDETERMINISTICALLY at any temp — the kill shot is `chat_template_kwargs: {enable_thinking: false}` (probed: reasoning 0 chars, instant; reasoning_effort/reasoning.max_tokens/no_think all ineffective), now on every llmChat call. Final verified run: 17 SECONDS total, 7 goals incl. subjectless present-tense + request framed with requester name, LLM digest, zero retries. Also: per-user in-flight lock (RTDB lockAt, 8-min staleness, try/finally) + GET ?status=1/?status=all + Manage live "Generating now: name (Ns)" line polling 5s + honest button states. Debug endpoint deleted. Note: "Send out the syllabus" (1 of the 8) didn't land this run — its phrasing ("send it out later") is pronoun-dependent; next harvest typically catches it. the 30k budget BACKFIRED — reset test was slow and thin (only the 2 regex-union goals landed; "Help me…" kept the requester's "me"). Diagnosis: with 30k to burn, the reasoning model thinks past the 120s timeout → extraction fails ×3 retries (≈6 min = "took forever"), regex union salvaged 2 goals, digest write eventually succeeded. Budgets right-sized: extraction/refine 6k, digest 5k (reasoning ~2k + answer fits comfortably). "me" framing: prompt now requires request labels written from the MEMBER's perspective (requester's "me"/"my" → their name); refine targets requested goals containing me/my/us/our (SELECT gained requested_by).
- **Follow-up 18 (2026-07-24)**: gemma-integration goal vanished between harvests — DB check confirmed the row is simply GONE: sampling variance (curator returns a different goal set each run; an earlier vague variant had been refined away, then the next harvest didn't re-extract). Fixes: (1) temperature threaded through llmChat — extraction + refine run at 0.1 (near-deterministic), digest write at 0.6; (2) regex catches now UNION with LLM results every harvest (label-deduped) instead of being fallback-only; (3) prompt: "Be EXHAUSTIVE — extract EVERY distinct goal; re-listing tracked goals is harmless." DM-request pipeline confirmed working in the same test ("Help Richard understand functions better — asked by Richard").
- **Follow-up 17 (2026-07-24)**: (a) goals pane redesign — card widened (min(560px, 92%)) with 1rem padding, rows get 0.55rem vertical rhythm + soft hairline separators, section tags spaced, labels line-height 1.45; (b) present-tense detection — prompt: "building/designing/writing X" → "Finish X", "helping Sarah with her zine" → "Help Sarah finish her zine"; FINISH_RE gains building/making/designing/writing/drafting/editing/fixing/prototyping/developing, new HELP_RE → "Help …" labels; (c) token budgets 10k → 30k (all three call sites — the upstream caps at whatever it caps, over-asking is harmless).
- **Follow-up 16 (2026-07-24)**: (a) opt-in root cause — all toggle surfaces showed STALE page-load state (opt-out saved fine, "opt back in" only looked broken); new GET on /api/gemma/settings returns live state, Gemma page + profile edit + Manage master all sync at mount, Gemma page button now two-way ("Digests are off — opt back in"). Digest text now ALWAYS lists open goals ("Your goals:" bullets, both LLM + template paths). (b) source previews collapsed behind a per-goal "Show source" button (chat msi icon); (c) detection broadened — prompt adds "I want X" (no verb), "I should X", self-directed "can I…"; fallback gains BARE_RE + CANI_RE.
- **Follow-up 15 (2026-07-24)**: polish round. Migration 045 (applied): gemma_goals.source_text/source_quote/congratulated. (1) renamed "Personal goals" → "Goals"; (2) opt-out button lives inside the summary card (POST optIn:false, confirms inline); (3) two-step removal — ✕ arms a red "Remove?" for 3s, second click deletes; (4) congratulations — completed goals surface as GOALS THEY JUST COMPLETED in the next digest prompt (+ 🎉 line in the template), congratulated flag flips after send so each is celebrated exactly once; done labels join the fingerprint; (5) source previews — the extractor returns a VERBATIM "quote" per goal (regex fallback uses its match), stored with the full message text; the goal card renders the message preview with the grounding span <mark>-highlighted, clicking navigates to the message; (6) acknowledgment examples extended ("yes, I'll work on that", "I'll do that" → resolve the task from surrounding messages).
- **Follow-up 14 (2026-07-24)**: REQUESTS-TO-YOU as goals. Migration 044 (applied): gemma_goals.requested_by + source_kind ('channel'|'dm'). Harvest now also reads the member's DM conversations (userChats → dms/{convId}, gemma conv excluded) — both sides. Candidates = member's messages + others' messages (DMs + channels); curator prompt extracts (1) self-stated goals AND (2) requests aimed at the member ("can you… / will you…", incl. when the member acknowledges "I can do that" — resolving what "that" is), with "by" = requester name. Regex fallback gained CAN_RE (others' messages only). Goals with a requester render an "asked by Sarah"-style chip and "↗ from Sarah's message" (DM deep links use /app/chat/dm/{conv}?msg=, verified supported); reminder + digest prompt annotate "(asked by X)". Checkboxes also restyled to match the homepage checklist (24px, ink fill) same day.
- **Follow-up 13 (2026-07-24)**: live test missed 3 new goals — root cause: the SUBJ_RE+INTENT_RE candidate pre-filter required an explicit "I/we", but chat speech omits subjects ("working on more kinetic type"). Pre-filter DELETED — all of the member's own messages (last 40) go to the curator, which now also has an implied-subject instruction ("working on X" → "Finish the kinetic type work"). Display: goals ranked newest-intent-first (ORDER BY created_at DESC, limit 30) with a 5-item preview + "See all N goals" expander on the Gemma page.
- **Follow-up 12 (2026-07-24)**: token budgets raised to 10,000 everywhere per user. In-progress phrasings now count as goals framed as "Finish X": curator prompt instructs "working on X / almost done with X / wrapping up X → Finish X" (incl. "syllabus is basically done" → "Finish the syllabus"); candidate filter widened (almost done / done with / wrapping up / finishing); regex fallback gained FINISH_RE producing "Finish …" labels.
- **Follow-up 11 (2026-07-24) — ROOT CAUSE FOUND & VERIFIED**: the chatterbox model (nvidia/Gemma-4-26B-A4B-NVFP4) is a REASONING model — every completion burns 1.2-1.7k chars of hidden reasoning against max_tokens, so the 400-token extraction budget returned content:null (HTTP 200!) every single time, and the 700-token digest often did too → template + regex-only goals. Fix: budgets raised (default 2500, extraction/refine 2000) + llmChat retries ×3 with backoff (user asked for "prompt it a couple times"). Verified end-to-end via a temporary debug endpoint (reset + full run): usedLlm:true, all 3 goals from the test message extracted, pronoun-resolved ("Send the syllabus out", "students' related interests"), each with source link. Debug endpoint deleted.
- **Follow-up 10 (same day)**: reset-test yielded only ONE goal from a 3-goal message + a TEMPLATE digest. Diagnosed with a direct node script against the stored key: chatterbox endpoint is healthy (models → nvidia/Gemma-4-26B-A4B-NVFP4, completion OK) — so (a) the curator prompt implied one-goal-per-message; both extractor + refiner now say explicitly "one message often contains SEVERAL distinct goals — one entry PER GOAL, entries may share src; when in doubt, include"; (b) llmChat had NO logging and a 60s timeout — every failure path now console.warns (status + body snippet, TIMEOUT flagged), timeouts raised to 15s models / 120s completion. Next failed run will say exactly why in the vite dev log.
- **Follow-up 9 (same day)**: vague goals STILL survived the user's live test (refine likely failed silently). Hardened: `parseJsonLoose` (cuts the outermost {...} out of fence/prose-wrapped output) used by extract + refine; console.warn on LLM-call/parse failures; HARD GUARANTEE in refine — a label still matching VAGUE_RE after the model's "fix" is deleted, so vague goals cannot outlive a refine pass with working creds. Refine also backfills source links now (conversation numbered → model cites "src" → source cols updated, own-message check). New first-time-experience test: `resetGemmaForUser` (wipes gemma conv live+archived, unreadCounts, gemmaDigestState, gemma_goals) + POST {reset:true} + Manage "🧪 Reset & send first-time digest" button; Gemma page prunes locally-cached digest bubbles the server no longer has (guarded: only when server list <40 = complete).
- **Follow-up 8 (same day)**: user's stored goals still showed vague labels harvested BEFORE context-framing ("Send it out later"). Three fixes: (1) `refineGoals` pass runs each digest — batched LLM call rewrites any stored open goal whose label carries bare deixis (VAGUE_RE) using the conversation + its source message, or DROPS it when the referent can't be determined (UNIQUE collision after rewrite → duplicate, deleted); (2) regex fallback now refuses to insert vague labels at all; (3) goals got a ✕ remove button (POST {goalId, remove:true} → DELETE, ownership-checked). Also the reminder template no longer runs "Still open:" into "And your own goals:" when there are no assignment items.
- **Follow-up 7 (same day)**: context framing — the curator now receives the WHOLE recap window (author names + channels, capped 80 lines) as CONVERSATION context ahead of the numbered candidates, with hard instructions to resolve every deictic reference ("send it to you" replying to Sarah about the syllabus → "Send the syllabus to Sarah") and never leave a bare it/that/you/them in a label; goals still extracted ONLY from the member's own candidate messages.
- **Follow-up 6 (same day)**: (a) meta-prompt restructure — a LOOSE candidate filter (subject I/we + any intent word) forwards everything intent-ish to the LLM, which CURATES (decides which qualify and how many; zero allowed); tight capture regex demoted to keyless/LLM-failure fallback. (b) Source links — migration 043 (applied): gemma_goals.source_conv_id/source_msg_id; recap lines now carry push id + chId; candidates go to the LLM NUMBERED and it cites "src" per goal; regex fallback tracks the matched line. getOpenGoals builds `/app/chat/channel/{conv}?msg={id}` (the ?msg= deep-link the bell already uses) and the Gemma page renders "↗ from your message" under each goal. Caveat: the deep link scrolls only if the message is in the loaded history window.
- **Follow-up 5 (same day)**: goal extraction missed "I need to send it out later" in user's live test. Fixed twice over: (1) regex broadened — subjects I/we, verbs + need/have/gotta/should/'re going; (2) LLM-assisted extraction when creds reachable (`llmExtractGoals` — strict-JSON prompt that RESOLVES PRONOUNS: "send it out" → "send the syllabus out"; merged with regex results, deduped). `llmChat(creds, messages, maxTokens)` factored out of llmWrite; pickCreds moved before harvest.
- **Follow-up 4 (same day)**: PERSONAL GOALS. Migration 042 (applied): `gemma_goals` table (id, user_id, label, source, done, done_at; UNIQUE user_id+label). Digest generation mines the recipient's OWN recap messages for intent ("I want/wanna/plan/intend/hope/am going to …", regex, ≤90-char clause, capped 8/harvest) → INSERT OR IGNORE. Recap refactored to structured {uid, ch, name, text} lines to know authorship. Open goals ride the prompt ("acknowledge one warmly"), the fingerprint (new goal = fresh digest), the reminder ("And your own goals:"), the ?history=1 payload, and the Gemma page as a separate "🎯 Personal goals" checkbox list — toggling hits new `/api/gemma/goal` POST {goalId, done} (ownership-checked UPDATE). Distinct from the assignment-fueled "✅ Action items" list.
- **Follow-up 3 (same day)**: renamed "daily digest" → "digest" everywhere user-visible (push title, page tag, Manage/profile copy). Change detection added: sha1 fingerprint of (recap + open items) stored per-user in RTDB `gemmaDigestState/{uid}`; if unchanged since last send → NO repeat digest — a short templated reminder listing still-open items goes out instead (push title "Gemma — reminder"), or NOTHING when there are no open items. Testing note: sending twice in a row with no class activity now yields a reminder the second time.
- **Follow-up 2 (same day)**: action items are now INTERACTIVE, not just prose. `getOpenActionItems(classId, studentId)` exported from gemma-digest.js ({itemId, label, week, dueDate, requiresSubmission}); `?history=1` returns them LIVE (current state, not a digest-time snapshot; instructors get []); Gemma page renders a "✅ Action items" card pinned after the thread — checkboxes write REAL `item_completions` rows via new `/api/gemma/action` POST {itemId, done} (completeItem/uncompleteItem — same table as the home checklist; submission-required items are refused server-side and render as "needs submission ↗ /app" links instead). Digest prompt now demands "Reminders:" as a bulleted • list.
- **Follow-up (same day)**: user got the push but couldn't find the digest — the DM conv had NO sidebar entry (DM rows are generated from the member roster; gemma isn't a member). Unified everything into the Gemma tab: sidebar Gemma entry now shows the digest preview + unread badge (script $deriveds — first attempt with {@const} inside a plain div 500'd: const_tag_invalid_placement); the Gemma chat page fetches `/api/gemma/digest?history=1` (session-authed: Turso archive + RTDB live merged, clears the conv's unreadCounts) and merges digests into the localStorage thread deduped by digestId, rendered with a "📬 Daily digest — <date>" tag; push URL now points to /app/chat/gemma.

## GIF Studio — Heatmap scene (Apple thermal type, shader port)

### WebGL Heatmap scene — 2026-07-23
- **Status**: `attempted`
- **What**: Browser/shader port of the "Apple Heatmap Effect in After Effects" tutorial (youtube 4ThUsDmgLUQ) the user linked. New `sceneHeatmap` in gen-art.js (SCENES id `heatmap`, after Extrude OG): AE recipe → GLSL — blurred ALL-CAPS word-stack (same layout as Extrude, blur H*0.014) uploaded as the heat-source texture; 4-octave value-noise FBM in the fragment shader for atmospheric shimmer, sampling along a CLOSED CIRCLE in the 3D noise domain (radius 0.8) so the loop is exactly seamless; edge-roughening term m*(1-m)*(n-.5) wobbles the glyph halos; thermal gradient map in-shader (navy → violet → magenta → red-orange → amber → hot white ≈ AE Colorama). Renders on an offscreen WebGL canvas (preserveDrawingBuffer), composited to the scene's 2D ctx via drawImage — so preview + GIF/WebP export work unchanged. Text texture cached per text/font with the live-measure key; graceful 2D fallback if WebGL is unavailable.
- **Follow-up (same day)**: added fade behaviours (inner glow, vertical fade, temporal brightness pulse) — still not matching.
- **Follow-up 5 (same day, tuning rounds)**: inner glow 0.35 → 0.16; per-letter directional gradient added (vertical derivative of tight-halo channel, offset 0.014, weight 0.62 — dominant model) with global gradient demoted on letters (0.60 weight); bg gradient from the TOP only (whites top-centre, blacks bottom corners); halo cut twice more (0.15/0.12, cov 0.75); grain switched to Hoskins hash12 (sin-hash repeated visibly) at half amplitude, letters-weighted (0.004 + s*0.025); line breaks now EXPLICIT via "/" in the text (words no longer force one-per-line; heatmap only, Extrude keeps word-per-line).
- **Follow-up 4 (same day)**: transcript re-read caught the real miss — in AE the 4-colour B/W gradient IS the text's fill, so letters span (nearly) the FULL black→white range; Ltext was compressing to 0.30–0.85 which flattened the look. Now `s*(0.04+0.96*g)`. Span raised 0.45 → 0.65 (~3 of 5 colours ride the letters at once, window still slides). Gradient whites now at bottom-centre AND top-centre (blacks at side middles) — heat pours in from both. Crunchy edge fixed with ~2px blur on the sharp channel. No forced uppercase (heatmap only).
- **Follow-up 3 (same day)**: user tuning — halo weights cut roughly in half (0.30*gBig + 0.24*gMid, cov ramp 1.1), grain 0.04 → 0.015, Colorama stops set to user's exact colors (#12002a, #4e03ca, #0090ff, #ffe610, #ed0038) and bg = the darkest stop #12002a so nothing renders solid black.
- **Follow-up 2 (same day, user transcribed the video)**: rebuilt to the ACTUAL AE recipe. Key insight: there is NO turbulent noise (dropped the FBM entirely; only 2% grain), and the animation is Colorama's PHASE SHIFT — the 5-colour output cycle itself rotates (`cycle5(L*0.92 + phase)`, wrapping), so colours flow THROUGH the letterforms; brightness never pulses. Luminance stack per the tutorial: 4-Color Gradient (2 white points high / 2 black low, inverse-square blend → uneven top→bottom drain) lights the text; inner glow `s*(1-gMid)*0.4` rims inside edges; the glow comps (fast blur 75 scaled + 22/13/5) are folded into two texture channels (G = wide H*0.055, B = tight H*0.014) matted ALPHA-INVERTED so the halo exists only OUTSIDE glyphs; beyond the halo the Colorama has nothing to grade (masking: alpha) → flat dark-blue bg. Texture: R sharp / G wide / B tight, additive on black.

## GIF Studio — Extrude scenes (Madeon "Gonna Be Good" type)

### Extrude Warm / Extrude Cool — 2026-07-22
- **Status**: `attempted`
- **What**: New `sceneExtrude` engine in `src/lib/gen-art.js` + two SCENES entries ("Extrude Warm" `extrudew`, "Extrude Cool" `extrudec`, after Wave Wall). Renders the studio's text bold (weight 800, fitted), builds an exact inside-distance field (two-pass chamfer), then per-pixel: gradient bands follow the field's iso-lines (contour-parallel = extruded look), offset by Perlin noise (noisy spacing across the letter surface), crawling one full band per loop (seamless); cylindrical luminance (bright crown at stroke centreline → dark edges) sells the 3D tube; edges feather over ~half the stroke radius (smoothstep) for the soft look; palettes carry dark stops so each cycle fades out Madeon-style. Warm (reds/oranges/gold) + cool (blues/purples/teal) stop sets. Field cached per text/font/dims with a live-measurement key so it rebuilds when the real font loads (Garble's trick).
- **Notes**: Live preview + GIF/WebP export both drive through the same scene contract, nothing else touched.
- **Follow-up (same day, user direction)**: reworked per feedback — ALL CAPS, max weight (1000, clamps to the font's axis max), one word per line each fitted to ~88% width (stack scaled to fit ~86% height). Gradient is now a top→bottom sweep (one wrap per loop, travelling downward) that the letters BEND: the distance field bows the bands around each letterform (INFLUENCE 0.65) and still drives the cylindrical fade + feathered edges; noise scatter reduced to 0.25.
- **Follow-up 5 (2026-07-23)**: the dn-dome still creased at the medial axis ("mountain peak"). Switched the bright grade to the canonical "puffy text" technique (per the Envato Photoshop glossy-puffy tutorial approach): the binary mask is Gaussian-blurred HARD (radius ≈ distMax*0.85) and that blurred alpha IS the surface height — a blurred plateau has no medial ridge, the crest rounds into a genuine bulb. Lighting = ambient + bulb height, times a smooth top-light from ∂h/∂y (gradients of a Gaussian surface are creaseless), times the even vertical fade. Falls back to the dn dome if ctx.filter is unsupported.
- **Follow-up 4 (same day)**: two grievances fixed in the bright grade (OG untouched): (1) perlin pattern was visible — noise features now larger than the frame (1/(H*1.6), amp 0.18) so it's just a slow invisible warp; (2) normal/specular lighting made sharp points at stroke ridges — bright grade now uses NO normals/spec: a smooth sin dome per stroke (no ridge spike) times an even top→bottom light fade (VFADE 0.40) across the whole frame, background included.
- **Follow-up 3 (same day)**: user liked the direction but it read "dark souls". The dark grade is preserved VERBATIM as a third scene "Extrude OG" (`extrudeog`, classic flag — old palette, old lighting, sharp type). Extrude Warm/Cool are now the bright Madeon grade: no blacks anywhere — palettes are bright pastel-neons whose pale stop is the fade-out (cycles wash toward near-white, not black), ground plane 0.68, ambient 0.60. Type mask is blurred (H*0.022) + re-thresholded at 92 so letters go round and blobby (corners round off, tight counters fill, close strokes fuse).
- **Follow-up 2 (same day)**: split into a two-layer pipeline per feedback. Layer 1 = grayscale LIT render baked with the field: directional light from upper-left, normals from distance-field central differences → diffuse + specular hot-spot (pow 10) + centreline crown, feathered edges, dim ground plane (0.30) for the background. Layer 2 = per-frame colour filter: the travelling gradient now covers the WHOLE frame (bg included, letters bend it) and multiplies the grayscale layer — highlights can exceed 1.0 for hot spots, dark palette stops fade the whole frame out each cycle.

## Sidebar — animated emotes in message previews

### Live Lottie emotes in conversation previews — 2026-07-22
- **Status**: `attempted`
- **What**: `previewHtml` in `app/+layout.svelte` rendered `[tg:]`/`[tgc:]` tokens as static webp thumbs in the sidebar's last-message previews. Now it emits real `.tg-emoji` spans (flags stay static webp) and an `$effect` runs `mountStaticEmotes` (emote-mount.js — despite the name it attaches live, IO-gated Lottie players) over every `.conv-last` after each preview change. Spans sized 1.2em to match the old thumb footprint. Covers desktop sidebar + mobile chat panel (same snippet).

## Chat — in-app Word (docx) reader

### mammoth-based docx preview in the file viewer — 2026-07-22
- **Status**: `attempted`
- **What**: docx attachments were unbearably slow to preview on the mobile PWA (opened externally via R2 URL → browser/QuickLook). Now they render in-app:
  - `mammoth` npm package (docx → HTML, dynamically imported only when a doc is opened).
  - Both chat pages: `isViewableFile` now marks `.docx` viewable (own 15 MB cap vs the 500 KB text cap); `viewFile` branches to `viewDocx` which fetches bytes via `/api/file-proxy`, converts locally, and renders rich HTML in the existing file-viewer overlay (`.file-viewer-doc` — white page, serif, styled headings/tables/images) with a loading state. Copy button hidden for docs; Source/Download unchanged.
  - **Bug found while wiring**: `/api/file-proxy` did `res.text()` and returned everything as text/plain — corrupting ALL binary files (docx, zips, images) fetched through it, including the existing `downloadFile` path. Now passes bytes through untouched with the upstream content-type.
- **Notes**: mammoth only handles `.docx` (not legacy `.doc`) — .doc still falls back to Source/Download.
- **Follow-up (same day)**: swapped mammoth → `docx-preview` per user feedback ("formatting should respect original output") — mammoth emits semantic HTML and discards fonts/colors/alignment; docx-preview reproduces the original layout as real pages. Render happens via a `use:renderDocx` Svelte action on the overlay container (the lib needs a DOM node); PDF-viewer-style gray backdrop, pages keep their fixed real width and pan horizontally on narrow screens. mammoth uninstalled.

## Chat — desktop margin scrolling

### Wheel over page margins scrolls the chat — 2026-07-22
- **Status**: `attempted`
- **What**: `.message-list` is both the scroll container AND the centered 840px column, so on wide desktops the side margins sit outside it — wheel there scrolled nothing. Both chat pages now have a `svelte:window` wheel handler that forwards deltaY to `listEl` when the event lands on dead space (excludes the list itself, input area, pickers/popovers, file viewer, asides/navs so their own scrolling wins; handles line-mode deltas ×16).

## Chat — Telegram special-effect opt-in toggle

### Special-effect checkbox on jumbo emote sends — 2026-07-20
- **Status**: `attempted`
- **What**: The big special-effect overlay (`playTgInteraction`, the tg-interaction emanation for av>0 Telegram emotes) used to auto-play for ANY fresh/unseen jumbo emote and on any click. Now it's sender-controlled:
  - New compact RTDB field `tfx: 1` → normalised as `msg.tgFx` → archived to new `chat_messages.tg_fx` column (migration `040_chat_messages_tg_fx.sql`, applied). Flows through `/api/chat` POST, `chat.js` normaliseMessage, `/api/chat/sync`, `/api/chat/history`, and both chat `+page.server.js` loaders. Documented in CHAT_STORAGE.md.
  - Compose (channel + DM): a 40×40px checkbox (`.tgfx-check`, ✓ fills on check) appears inside the input bar (between compose and the effects button) ONLY when the input renders jumbo (emoji-only) and contains an av>0 `[tg:]` emote (`tgFxEligible` derived). Off by default, resets after send. Title tooltip "Send with special effect".
  - Render gating (both pages): auto-play now requires `msg.tgFx` in addition to fresh/unseen; click-to-play (`playTgInteraction`) only plays the dedicated effect variant when the emote is in a jumbo bubble of a `tgFx` message — small/inline emotes and effect-off jumbos get the plain enlarged base animation instead. Small sends can never trigger the special effect.
- **Notes**: First version was a labeled pill above the input bar; user feedback moved it into the input bar as a 40px checkbox, then added the visible "Send with special effect" text next to it.
- **Follow-up (2026-07-21)**: click-to-play on a jumbo av>0 emote now ALWAYS plays the special-effect variant (first version gated clicks on `msg.tgFx` too, which made old/unflagged messages play a lame plain enlarge). The checkbox now only gates the on-receipt auto-play; small/inline emotes still never render the special effect.

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
