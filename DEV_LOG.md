# eating.computer — Development Log

This document is a running record of what has been attempted, what is in progress, and what has been confirmed successful. Only mark something as successful when the user explicitly confirms it.

---

### 2026-08-24 — Scroll jumps on resized text: the un-skip the anchor can't fix
- **Status**: `attempted` (mechanism verified in dev: resized rows get
  class big-text and stay painted; pending user confirmation on device)
- **Symptom**: scrolling up in chat jumps when the history holds resized
  text. The existing chat-scroll-anchor (d87e0ac) handles most height
  changes — but on iOS a programmatic scrollTop write can be DROPPED
  during momentum scrolling, so when a `content-visibility: auto` row
  un-skips from its 60px placeholder to a 300px+ real height mid-flick,
  the corrective write never lands and the raw shove shows.
- **Fix**: make the big corrections unnecessary instead of trying to win
  the write. `msgSizeFactor(msg)` = max(whole-message fs, largest inline
  [sz:] span — PUA <percent> in the content). Rows ≥1.5× get
  `class="big-text"` → `content-visibility: visible` (always painted;
  they're rare, the paint cost is noise, and a row that never un-skips
  can never jump). 1.01–1.5× rows get a size-scaled
  `contain-intrinsic-size` reservation so their correction is pixels.
- **Reverted along the way**: a scrollHeight-delta compensation in
  loadMoreHistory and a WebKit anchoring polyfill — both duplicated what
  chat-scroll-anchor.js already owns (its header explicitly warns that
  delta-patches double-compensate). One anchoring system, better inputs.

---

## Scroll & gesture listeners: use the bus (`$lib/scroll-bus.js`)

Components were each attaching their own `scroll` / `wheel` / `touch` listeners.
There is now ONE capture-phase `scroll` listener on the document and ONE each of
`wheel` / `touchstart` / `touchmove` on the window; everything else subscribes.
See **SCROLL_BUS.md** for usage and the reasoning.

Two things worth carrying forward:

- Derive scroll DIRECTION from wheel/touch deltas, never from `scrollTop`.
  Virtualised grids nudge `scrollTop` as rows mount, so the last event of a
  gesture is often a correction the other way (measured: a downward flick
  settling 400 → 393, an upward one 93 → 99). Reading that inverts the
  direction on every flick.
- This is hygiene, NOT the fix for emote jank. Profiled at 6x CPU throttle with
  ~15 gesture listeners: zero long tasks during idle, vertical scroll and
  horizontal swipe. The real steady-state cost is ~63 simultaneously animating
  canvases plus a 10-worker rlottie pool — GPU/compositor work that never
  appears as main-thread blocking.

---

## Format

Each entry includes:
- **Date**: When it was attempted
- **What**: What was tried
- **Status**: `attempted` | `in progress` | `successful` | `abandoned`
- **Notes**: Relevant context, blockers, or outcomes

---

### 2026-08-21 — CRITICAL: service worker served one user's data to another
- **Status**: `attempted` (fix deployed; hard-refresh signal fired to purge
  every client's poisoned caches)
- **Symptom**: switching accounts landed you in the WRONG account — log in
  as a student, see the instructor's app (name, role, class, data).
- **Root cause**: the service worker's asset handler cache-first'd EVERY
  same-origin GET, not just static assets — including SvelteKit's
  `__data.json` payloads and `/api/*` GETs, which are per-user. After an
  account switch the first loads were served from the previous user's
  cache. Also a privacy hole (user B could be shown user A's data).
- **Fix**: the cache-first path is now an allowlist — `/_app/immutable/*`
  (content-hashed) + the precached static files. Everything else passes to
  the network untouched. Old caches self-purge on deploy (versioned cache
  name, cleared on activate), and the dev/refreshNeeded hard-refresh
  (unregister SW + clear caches + cache-busted reload) was fired to clean
  every open client immediately.
- **RULE, carved in stone**: a service worker must NEVER cache anything
  session-scoped. If a response can differ by cookie, it does not go in
  Cache Storage.

### 2026-08-21 — Avatar picker round 2: the tap that never landed
- **Status**: `attempted` (all four verified in dev; hit-testing checked with
  elementFromPoint, not synthetic .click())
- **Why the checkmark "didn't save" on real phones while every test passed**:
  `.ap-expr-backdrop` is fixed inset-0 z-index 998; `.ap-confirm` had NO
  z-index — the invisible backdrop sat ON TOP of the tick, so a real tap hit
  the backdrop → cancelExpr → pick silently discarded. Synthetic
  `element.click()` bypasses hit-testing, which is why browser-driven tests
  kept "passing". Fix: z-index 1000 on the tick. LESSON: verify
  tap-reachability with `document.elementFromPoint`, not .click().
- **Indicator misalignment (avatar popover only, chat fine)**: the tab-strip
  pitch was measured ONCE and cached; in the popover the first measurement
  runs during initial paint and catches squeezed/unsettled slot widths, then
  every park steps by the stale pitch. Now re-measures whenever the
  indicator parks on a whole tab (open/tab-tap — alignToTab's settle retries
  at 80/200/450ms self-heal it), cache reused only for fractional swipe
  frames. Also the 48px circle now sizes itself to the slot (a full-size
  circle "centred" on a 34px squeezed icon bled 7px over both neighbours).
- **Nav: no selected state off-tab**: activeSlot fell back to 0 when no item
  matched, parking the pill on Home from /app/profile/* and /app/theme.
  `anyActive` now fades the pill out (opacity, not unmount, so it glides
  back in) whenever the route maps to no slot.
- **Live avatar propagation (RTDB)**: avatar endpoint + edit-profile action
  bump `membersRev`; the app layout listens (skip-first) and invalidateAll()s
  — verified: external bump → client refetched /app/__data.json. New
  avatars/names now appear for everyone with the app open, no reload.

### 2026-08-21 — Expression avatar: instant save + the form-submit hijack
- **Status**: `attempted` (verified: pick 😭 → "saved" → DB row expr/😭 →
  header avatar updated with no reload)
- **The actual bug behind "picking an expression doesn't stick"**: the
  AvatarPicker renders INSIDE the edit-profile `<form>`, and the
  ExpressionPicker's cells are `<button>`s with no explicit type — default
  type is SUBMIT, so tapping any emoji submitted the whole profile form
  (saving the OLD avatar) and navigated away. Fixed with an onclick guard on
  `.ap-expr-popover` that preventDefaults button clicks (their own handlers
  still run) — one point that covers every picker tab, including
  TelegramEmojiPanel which another session owns.
- **Instant save**: AvatarPicker gains an optional `oncommit` prop (fired on
  expression confirm + generative re-pick, NOT photos — those need the
  form's upload path). Edit profile wires it to the new
  POST /api/profile/avatar (session user only, gen|expr, token ≤200 chars)
  and then `invalidateAll()` — which re-runs every load so the new avatar
  shows in the header/sidebar/chat immediately. Onboarding passes no
  oncommit and keeps submit-time behaviour.

### 2026-08-21 — Self-serve account creation (/signup)
- **Status**: `attempted` (verified: create → auto sign-in → onboarding with
  name prefilled; test user deleted after)
- **/signup**: name + username + optional email (synthesized
  `${username}@accounts.eating.computer` when blank — the credentials
  provider matches on email OR username, so the synthetic address is
  collision-checked like a real one) + password (min 8, bcrypt 10). New
  accounts are role student at onboarding_step 'profile', so they enter the
  same onboarding as OAuth signups; class approval still gates all content.
  Login page gained "New here? Create an account".
- **Auto sign-in gotcha**: the first attempt used a pre-rendered hidden
  credentials form submitted from an $effect on `form.created` — it RACED
  enhance's default post-submit work (reset + invalidateAll) and posted
  empty fields (server log: CredentialsSignin 500). Fix: custom enhance
  callback — `update({reset:false, invalidateAll:false})`, then BUILD the
  sign-in form dynamically from local state and submit it as a full-page
  POST to /login (the login page's default signIn action owns the cookie
  handshake + /app redirect; onboarding guard routes from there).

### 2026-08-21 — User blocking (Guideline 1.2) + demo auto-approval flow
- **Status**: `attempted` (both verified end-to-end in the browser)
- **Blocking**: `blocked_users` table (migration 064), `/api/moderation/block`
  (GET/POST/DELETE, self-service; instructors + gemma unblockable — 400 with
  message, verified). "Block user" in the message ⋮ menu (channels + DMs,
  non-instructor authors only); blocked users' messages filtered from render
  via `visibleMessages` derived in both chat pages; DM with a blocked user
  shows a notice + inline Unblock; Edit profile gets a "Blocked users" list
  with Unblock. Server: /api/chat send now skips blockers of the sender for
  unread ticks, mention/reply notification rows, chat-list bumps, and push —
  message still lands in the conv node so unblocking restores history.
  Verified: blocked Maya Okonkwo as navtest → #studio dropped 14→11 messages,
  unblocked from Edit profile → restored.
- **Demo auto-approval** (for the App Review recording): `classes.auto_approve`
  (=1 for idc-review, which is now enrollment_open so it appears in the
  sign-up class picker). The pending screen shows "Waiting for instructor to
  approve enrollment" IMMEDIATELY for auto-approve classes (30s-delayed for
  real ones, unchanged), then after 5s calls `/api/class/auto-approve`
  (validates auto_approve=1 server-side; real classes 403; reviewed_by =
  the user's own id — an 'auto' sentinel violates the users FK, learned the
  hard way). Approval flows through the same approvals/{uid} RTDB signal as
  a manual approve. Landing in /app shows a dismissable "🎉 You've been
  accepted into {class} — welcome!" pill for 8s (sessionStorage handoff from
  the pending screen — manual instructor approvals get the banner too).
  Verified: pending → 5s → auto-approved → banner, on a throwaway account,
  then deleted via the account-deletion endpoint (clean, incomplete: []).

### 2026-08-21 — In-app account deletion (Guideline 5.1.1(v)) + privacy policy
- **Status**: `attempted` (verified end-to-end: throwaway account created,
  deleted through the UI flow, all rows confirmed gone)
- **UI**: Profile → Edit profile → "Delete account" danger zone; two-step
  (reveal, then type DELETE to arm the button). On success the page submits
  the same `/app?/signout` action the user menu uses — cookie cleared after
  the row is already gone → lands on /login.
- **API**: POST `/api/profile/delete-account` (self-service only, requires
  `{confirm:'DELETE'}`). Deletes: users row (last, and required to succeed —
  everything else is best-effort so a partial failure can be retried),
  memberships, submissions/completions, stars, notifications both directions,
  push + APNs tokens, activity/sessions/AI keys, Gemma goals/links,
  inspiration rows, reactions, uploaded_files + their R2 objects, avatar R2
  prefix, conversation_members, and the RTDB nodes userChats/lastRead/
  presence/notifications/gemmaDigestState/recs for the uid. Messages are
  KEPT but anonymised: user_name -> 'Deleted user' across chat_messages,
  thread_messages, messages, direct_messages, starred author names, report
  names, emote/reaction-image credits. Live RTDB messages only store the uid,
  which stops resolving once the row is gone.
- **Guard**: the only remaining instructor cannot self-delete (409 with
  explanation) — the class would be ownerless.
- **Privacy policy**: new "Deleting your account" section describing the
  in-app flow and the messages-anonymised split, with email escalation for
  full message-text removal; "Your choices" updated; the old "ask the
  instructor" wording removed.
- **Recording note**: don't delete the Apple demo account on camera — use a
  throwaway (scripts/create-reviewer.js makes one) or re-run the script after.

### 2026-08-21 — Message reporting + native shell offline/instant open
- **Status**: `attempted` (reporting verified end-to-end in browser; native
  changes need an Xcode build to take effect)
- **Reporting (App Store Guideline 1.2)**: `message_reports` table (migration
  063, APPLIED to prod), `/api/moderation/report` (POST any member / GET+PATCH
  instructor), kebab menu on other people's messages now shows **Report** for
  everyone (Delete stays instructor-only) in both channel + DM pages; content
  is snapshotted at report time so it survives edits/deletes. Instructors get a
  push notification per report and review in Manage → Moderation ("Reported
  messages" section, open-count badge on the tab, Resolve/Reopen). Verified:
  filed report → badge → card → resolve → reopen all work.
- **Native shell instant open + offline**: WKAppBoundDomains
  (eating.computer) in Info.plist + `limitsNavigationsToAppBoundDomains: true`
  in capacitor.config.ts — this is what grants WKWebView service-worker
  support. Root layout now REGISTERS the SW in the native shell instead of
  tearing it down (old policy predated ABD; safe now because the SW is
  network-first for HTML, assets are content-hashed, and
  installChunkErrorRecovery hard-refreshes as backstop). Old installed
  binaries without the plist key simply have no `navigator.serviceWorker` —
  no-op. Result once the new binary ships: cold start serves the full
  JS/CSS/font bundle from the SW disk cache; app opens offline.
- **Resume where you left off**: root layout saves the last `/app` route
  (localStorage `ec-last-route`) on every navigation; a launch landing on
  exactly `/app` in the native shell or installed PWA jumps back to it
  (replaceState). Deep links (push notifications) are untouched — they never
  land on bare `/app`.
- **Known limits**: the HTML document still loads from network when online
  (deliberate — it is the SSR session/data carrier); "new version" handling is
  the existing `updated.check()` + chunk-recovery path. The webDir offline
  fallback page may not load under ABD, but the SW offline fallback replaces
  it with the real app.

### 2026-08-21 — Mobile-web compose bar cut off: real root cause found
- **Status**: `attempted` (verified in emulation; pending user confirmation on a
  real phone — NOT deployed, App Review still pending)
- **Root cause was NOT (only) browser chrome.** `.pager-track`'s
  `margin-top: var(--header-h)` (~64px on mobile web) **margin-collapsed
  through `.app-shell`**, pushing the whole shell down 64px. The conversation
  layer (`.fwd-host.conv-layer`, `position:absolute; top:0; height:100dvh`)
  anchors to the shifted shell, so it hung 64px past the screen bottom on EVERY
  mobile browser — chrome or no chrome. Reproduced in the desktop-Chrome mobile
  emulator (no browser chrome at all): input-area bottom at 876 in an 812px
  viewport. Native never collapsed because `body.native-app .app-shell` has
  `padding-top` (notch inset), which blocks margin collapse — exactly why the
  shell looked perfect. Browser chrome (Safari bottom bar) ADDS its slice on
  top of the 64px on real devices.
- **Fix**:
  - `.app-shell.layered { display: flow-root }` — keeps the pager margin
    inside; shell starts at y=0 like native. Pager visual position unchanged
    (its margin now pushes from inside).
  - New `--vvh` var (keyboard-metrics.js): visible-bottom in layout-viewport
    coords (`vv.height + vv.offsetTop`); equals `window.innerHeight` while the
    keyboard is open or pinch-zoomed, so kb geometry is untouched; equals
    100dvh on native/desktop. `.fwd-host.conv-layer`, all mobile `.chat-wrap`
    heights, and `.pager-track` now size from `var(--vvh, 100dvh)`.
  - Chat heights/margins use measured `var(--header-h)` instead of hardcoded
    `52px + var(--native-top-inset)` (the mobile conv header is really ~62-64px;
    on native --header-h already includes the notch padding, so same value).
  - REVERTED the `padding-bottom: var(--browser-chrome-h)` on `.input-area`
    (both chat pages) — container now ends at the visible bottom, padding would
    double-lift. `--browser-chrome-h` still lifts the fixed-position things:
    nav pill, `.compose-picker-pop` (now `bottom: var(--browser-chrome-h)`),
    `.compose-kitchen-pop`.
- **Verified in mobile emulation (375x812, no chrome)**: shell top 0, layer
  0-812, chat-wrap 62-812, input-area bottom exactly 812. With simulated
  chrome (`--vvh:762; --browser-chrome-h:50`): compose bottom 762, pager-track
  ends 762, nav pill 696-756 — all above the "toolbar". Desktop unchanged.
- **Debug aid**: open any page with `?vvdbg=1` (or `localStorage.vvdbg='1'`)
  for a live on-screen readout of innerHeight / vv.height / dvh-svh-lvh probes /
  hidden / chrome / --vvh. Temporary — remove when this work settles.

### 2026-08-21 — App Store review class + emote/emoji defaults
- **Status**: `attempted` (built + captured, pending user confirmation)
- **Why**: the listing screenshots were being taken in the live `#class` channel,
  which carries development traffic — a `192.168.86.136:5199/renderprobe` link and
  a `rasterise 1821ms/s (30 emotes, 141 queued)` perf dump were both in frame.
- **Review class**: new `scripts/seed-review-class.js` builds class `idc-review`
  (channel `studio`), four invented classmates who never sign in, 4 week plans,
  3 assignments, 6 syllabus blocks, and a 14-message conversation written to
  exercise inline sizing, colour spans, `[wave]`, a jumbo lone emoji with a
  `shake` bubble effect, a `[ce:laugh_cat]` custom emote, a JS code block,
  replies and reactions. Ordered so the expressive messages are the most recent
  — chat opens pinned to the bottom, which is all a screenshot ever sees.
  Idempotent; rebuilds the RTDB node each run (push IDs encode their own time).
  The two review accounts are moved OUT of `idc-fall-2026` so they land here.
- **Channel id is the display name**: the channel page publishes
  `'# ' + data.channelId`, ignoring `conversations.name` — hence `studio` as the
  id rather than a prettier name column that would never be read.
- **emoji_font** (migration 062): per-user default emoji face, plumbed through
  `app/+layout.server.js` -> `app/+layout.svelte`, applied only when localStorage
  has no saved choice. Review accounts set to `system` (Apple/iOS glyphs) —
  localStorage is per-profile, so a fresh capture profile fell back to Noto.
- **Apple sign-ups** now insert with `hide_tg_emoji = 1` (src/auth.js), so the
  Telegram packs and Emoji Kitchen are off by default; Manage -> Members gained a
  per-user **3rd-party** checkbox (`setThirdPartyEmotes`) to turn them back on.
- **Code block headers** show the language's real name — `LANG_LABEL` in
  message-render.js, so it reads "JavaScript" beside the JS mark, not "js".
- **Capture fixes** (`_capture-session.mjs`): wait on `document.fonts.ready`
  before every shot (a fallback face was showing where the app uses its own);
  hide `.msg-actions-bar` (Puppeteer's touch emulation left `:hover` stuck);
  hide `.conv-kebab`; raise `protocolTimeout` for the picker click, and RETRY
  the picker open up to 3x (it times out intermittently and used to leave a
  second plain chat shot standing in for the picker).
- **Bottom nav in captures**: the override was inflating the pill to
  `56px + 34px` with matching `padding-bottom`, leaving a slab of dead surface
  under the icons on every shot. The app's nav is a FIXED 60px pill that floats
  via `bottom: max(6px, env(safe-area-inset-bottom))` — it never grows — so the
  capture now just lifts it with `bottom: 34px`.
- **Open, not fixed**: `.conv-kebab` from the SIDEBAR renders through the chat
  layer along the right edge at 430px — hidden in the capture, but worth a look
  in the app itself. Also `manage/+page.svelte`'s member table has a
  pre-existing thead/tbody column mismatch (Device/Notif vs Emotes order).
- **Not yet deployed** — the shell loads the live site, so the reviewer only
  sees any of this after a Vercel deploy.

---

### 2026-08-27 — WeChat emoticon set added to the emote library
- **Status**: `attempted` (built + verified in-browser, pending user confirmation)
- **What**: All 114 WeChat emoticons (the proprietary `[Smile]` / `[Doge]`
  stickers, catalogued at https://emojipedia.org/wechat) are now a built-in
  emote set — a **WeChat** section at the bottom of the Telegram picker's flow,
  inserting the same `[ce:…]` token a class upload does, so they render inline
  everywhere custom emotes already do.
- **Art**: WeChat 8.0.2 for iOS (the crisper of the two sets Emojipedia lists;
  the Android 7.0.21 art is 80px against iOS's 97–128px). Normalised to
  128x128 webp in `static/wechat/` — 1.34 MB of mixed-size PNG down to 0.56 MB.
  Bundled rather than uploaded to R2 so there is no per-class setup and no
  network hop before the first paint.
- **Shortcodes**: `wc_` + slug (`wc_smile`, `wc_pooh_pooh`, `wc_bah_l`). The
  prefix means they can never collide with an instructor upload, and `:wc_` in
  the compose box lists the whole set.
- **`src/lib/wechat-emoji.js`** (new) — the table, plus `WECHAT_BY_SHORTCODE`
  and `isWechatShortcode`.
- **`custom-emoji-store.js` is the whole trick.** The shortcode→url map now has
  two layers: the WeChat set as a synchronous BASE (present from module load,
  so no `[ce:wc_…]` ever renders as a `:shortcode:` fallback while a fetch is
  in flight), with `/api/custom-emoji` uploads applied on top so the database
  still wins any collision. ~40 call sites read this map and none of them
  changed.
  - Two of them had to: `Avatar.svelte` and `ExpressionPicker.svelte` used
    **map-emptiness** as their "uploads not fetched yet" signal. With built-ins
    seeded the map is never empty, so uploads would never have loaded at all.
    Both now call the new `isCustomEmojiLoaded()`.
  - `invalidateCustomEmojiCache()` drops only the uploads layer — clearing the
    built-ins would blank every WeChat emote on screen until the refetch landed.
- **`TelegramEmojiPanel.svelte`** — the set is a library the panel owns (like
  the Telegram packs), not a prop each host supplies. It reuses the existing
  `upload: true` image-cell shape, since it inserts the same token and needs the
  same plain `<img>`; a new `builtin` flag suppresses the delete affordance
  (there is no row to delete). Placed **last** in `flowingCats`, so every pack's
  position is unchanged from before it existed.
- **Search now reaches image cells at all**, which is a pre-existing bug this
  surfaced: `_searchPool` keyed uploads as `u:${it.cp}` and uploads have no
  `cp`, so all of them collapsed onto the single key `u:undefined` — and the
  filter below then dropped even that one. Image cells get their own `i:${shortcode}`
  key space and match on shortcode **or** display name, so the set answers to
  "smile" and "Pooh-pooh", not only "wc_smile". The flat search grid grew an
  `{#if it.upload}` branch to render them (its one branch — noted inline why the
  remount cost is acceptable where the sticker's is not).
- **Held behind `isTgHidden()`** — the per-user hide-third-party-emotes switch
  the App Store review account uses. That flag is named for Telegram because
  Telegram packs were the only vendor emote art when it was added; this is 114
  more pieces of it. Class uploads deliberately stay visible under the flag.
  Note `message-render` still does **not** strip `[ce:]` under the flag, so a
  WeChat emote inside an existing message would still render for that account —
  same as any class upload does today.
- **Verified** in-browser on a throwaway `ssr=false` route (since the picker is
  login-gated), then deleted: 114 cells in a WeChat section at the bottom of the
  flow, WeChat last in the tab rail, click fires `[ce:wc_worship]`, no delete
  button even with `onDeleteUpload` passed, `contentHtml('[ce:wc_smile]')` emits
  the same `<img class="ce-img">` an upload does (and an unknown `wc_` code still
  falls back to `:shortcode:`), search on "pooh" → `wc_pooh_pooh`, search on
  "doge" → 40 Doge-pack canvases + the one WeChat image together, all
  `/wechat/*.webp` 200, no console errors.
- **Licensing**: the artwork is Tencent's, same footing as the Telegram packs
  already bundled.

**Follow-up (same day) — the whole library is searchable by name now.**
- **What was broken**: a unicode Telegram emote matched only `it.e.includes(q)`
  — the emoji *character* — so "smile" found no 😀 at all, and a pack emote's
  CLDR name sat behind a per-pack "emoji-name search" checkbox that defaulted
  off. The naming data was already loaded the whole time; nothing read it.
- **`emoji-data.js`** — `buildByCp`'s meta now also carries `st`, emoji-data's
  pre-tokenised, pre-**lowercased** search terms (name words + shortcodes +
  aliases like ":d" + keywords). By reference, so no copy and no per-item
  `toLowerCase()` on the hot path.
- **`metaByCp` is now component state** on the panel, not an onMount local —
  a unicode emote has no name of its own (the TG manifest is glyph + codepoint
  + category), so scoring one means looking its CLDR entry up at search time.
- **Ranked, not just filtered** — `searchScore` in three bands, each ordered
  exact → prefix → substring:
  1. the emote's OWN name/shortcode/keywords (unicode CLDR, upload shortcode,
     WeChat display name), or the pasted glyph;
  2. the emote's PACK title ("cursed" → all 100 Cursed Emoji);
  3. a pack emote's name INHERITED from the emoji it's keyed to.
  Ties break on flow position, so within a band the picker's own order
  (Effects, Smileys, …, packs, WeChat) survives — which also keeps each *kind*
  of cell arriving in a run, which is what the flat grid's one `{#if}` wants.
- **Band 3 is why the per-pack toggle could go.** It existed because a pack's
  art often has nothing to do with its alt emoji (a cat filed under 😀), so the
  inherited name is a guess. Guesses now show but sort last, instead of being
  hidden behind a checkbox nobody would find. `cldrEnabled`, `togglePackCldr`,
  the `.tg-cldr-toggle` markup + CSS and the pack-header control are all
  removed; the `tgCldrEnabled` localStorage key is abandoned, nothing reads it.
- **Verified** in-browser: "smile" → 162 hits, 23 animated unicode smileys, then
  WeChat *Smile*, then 138 inherited pack matches — bands in exactly that order;
  "rose" → 🌹, WeChat *Rose*, FlowersFont rose, and nothing else; "happy"
  (a keyword in no name) → 193 led by 😁😂🤣🥳😇😀; "cursed" → the 100-emote
  pack; "zzqqxx" → the empty state. One broad keystroke ("fac", 279 hits over
  ~2400 items) logs no long task; ten rapid ones batch into a single 75 ms
  frame. No console errors.

---

### 2026-08-20 — iPhone-only + portrait lock (App Store prep)
- **Status**: `attempted` (built + verified in the bundle, pending user confirmation)
- **What**: `UISupportedInterfaceOrientations` in `ios/App/App/Info.plist` cut from
  portrait + landscapeLeft + landscapeRight down to **portrait only**. The
  `~ipad` key is untouched.
- **Why**: the web app has no landscape layout at all — zero
  `@media (orientation: landscape)` anywhere in `src/`. A reviewer rotating the
  device would have seen a broken UI, which is a Guideline 2.1 rejection.
- **Verified**: `plutil -lint` OK; Release build for `generic/platform=iOS`
  succeeds and the compiled `App.app/Info.plist` contains only
  `UIInterfaceOrientationPortrait`.
- **Also**: `TARGETED_DEVICE_FAMILY` changed `"1,2"` → `1` in both Debug and
  Release. The target no longer claims **iPad** support, which (a) drops the App
  Store Connect requirement for a 13" iPad screenshot set we don't have, and
  (b) keeps the app away from an iPad reviewer and that same missing landscape
  layout. Still installable on iPad in iPhone-compatibility mode. Verified in
  the built bundle: `UIDeviceFamily = [1]`. (`AppIcon76x76@2x~ipad.png` is still
  emitted by the asset catalog — inert leftover, iOS ignores it.)

---

### 2026-08-20 — Theme: green maxed default + onboarding swatches use resolved tokens
- **Status**: `attempted` (built, pending user confirmation)
- **What**: Two changes, both requested.
  1. **New default**: the `default` preset is now green (`#00c853`, vibrant) with `contrastLevel: 1`, `vibrance: 200` and `masterChroma: 80` (= `MASTER_CHROMA_MAX`) — full contrast, full vibrance, full saturation. `DEFAULTS` mirrors it exactly *including* `dark: true`, so a brand-new account opens on it and onboarding's mode toggle starts on Dark. Still labelled "Default".
  2. **Onboarding swatches** (`onboarding/profile/+page.svelte`) painted from `p.seed` — the raw generator input, identical in light and dark — so the mode toggle above them visibly did nothing to the grid it claims to recolour. Now uses `previewRolesForPreset` and renders resolved primary/secondary on that theme's resolved surface, same as the desktop picker, ThemeSwitcher and the mobile tiles.
- **Design change**: presets are now **self-describing** — `presetRecord` resets `vibrance` to 100 and `masterChroma` to null unless the preset names them, where previously both persisted across preset changes as a standing taste preference. Had to change: with Default carrying 200/80, the old rule meant tapping Default then Porcelain gave a blasted Porcelain, and no preset could be trusted to look like itself. Cost is that a slider tweak is dropped when auditioning another palette.
- **Measured** (`previewRoles` on the new default):
  - DARK (the default): surface `#001804`, onSurface `#ffffff`, primary `#c2ffc3`, secondary `#baffd9`, tertiary `#b2ffeb`. onSurface/surface contrast **18.5**. Looks the way it was asked for.
  - LIGHT: surface `#00933e` — a saturated MID-green page, not a light theme. onSurface `#000000`, contrast 5.2 (AA passes); primary `#003410` against surface is only 3.5. Legible but bold. This is `masterChroma 80` meeting `SURFACE_TONE_SHIFT_MAX = 45` (raised earlier at the user's request), which walks light surfaces from tone 98 down to ~53. **Flagged to the user, not silently altered** — full saturation was specified for the dark default, and chroma is a single value that applies to whichever mode is live.
- **Notes**: build verified green (`npx vite build` → done) since main had been red earlier in the day.


### 2026-08-20 — Theme: no-flash cold start (full palette replayed before first paint)
- **Status**: `attempted` (built, pending user confirmation)
- **What**: The theme only applied once `theme-store.js` had loaded and hydration ran, so every cold start — and every native WebView reload — painted the app.css DEFAULT palette first. app.html restored only the background colour, which made it worse rather than better: the page got the user's dark background while cards stayed cream, text stayed near-black and the accent stayed the default red.
  - **Measured baseline** (dark Iris @160% vibrance): pre-hydration `--paper #f7f2ea` / `--ink #0a0a0a` / `--accent #b61d3e` / `theme-dark false`, with `<html>` background `#e04d00` left over from a *stale* `theme-bg`. Post-hydration `#0f1223 / #fafafa / #bac3ff / true`. Three inconsistent palettes on screen at once.
  - `applyTokens` now writes a full boot snapshot to `localStorage['theme-boot']` (`{v, dark, bg, tokens}` — 34 tokens, ~1.5 KB) alongside the live writes, so the snapshot is exactly what was painted with no second derivation to drift. It also retints `<meta name="theme-color">`, which had been hardcoded `#0c0c0c` forever.
  - app.html replays the whole snapshot synchronously in `<head>`: every `--md-sys-color-*`, the `theme-dark` class, `color-scheme`, the element background and the theme-color meta. Placed AFTER the theme-color meta so it can rewrite it.
  - **Result**: every token identical pre- and post-hydration, in both light and dark, custom seeds and master chroma included. Verified on `/login` too — the first screen most users see.
- **Follow-up same day**: user reported *still* seeing a cream flash on Reload — in the NATIVE iOS app, which the web-side fix cannot reach. Cause was three hardcoded creams in the shell, none of them in the page: `capacitor.config.ts` `ios.backgroundColor: '#f7f2ea'` (the WKWebView's own background, painted whenever web content isn't — i.e. the whole window during `location.reload()`), the same cream hardcoded as RGB in `AppDelegate.swift` for the window + root view, and `manifest.json` `background_color` (installed-PWA only).
  - `AppDelegate` now paints the shell from the user's own saved surface colour: `applyShellBackground()` reads `UserDefaults["ec_shell_bg"]` at launch and applies it to window, root view, web view and scroll view; `cacheShellBackground()` copies `localStorage['theme-bg']` out of the web view via `evaluateJavaScript` on resign-active and ~1.5s after becoming active. No Capacitor plugin and no script-message bridge needed just to move one hex string. Corrupt/short values return nil from the hex parser and leave the current colour alone.
  - `capacitor.config.ts` seed changed cream → `#fff8f7` (the actual current default theme surface). It now only matters for the very first launch after install, before the cache has been written once.
  - This is why `theme-bg` was worth keeping when the boot snapshot superseded it — Swift reads that exact key.
  - **Verified**: `xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator` → BUILD SUCCEEDED (compiles against the real Capacitor APIs). NOT verified visually on a simulator: `xcode-select` points away from Xcode.app and the fix needs sudo. Requires an app rebuild to reach a device; the web half is already live.
  - Still cream: `capacitor-shell/index.html` (offline fallback, `#faf7ef`) and `manifest.json`. The offline page is a different origin from the live site so it cannot read the theme from localStorage at all.
- **Notes**:
  - **Bug found while testing the degraded path**: applying `theme-dark` without a surface to go with it flips `--ink` to near-white against the cream fallback paper — white on cream, i.e. invisible text (measured 1.0:1). The script now only claims dark when it actually has a surface; with nothing stored it stays entirely on the self-consistent light defaults. Fallback matrix checked: valid / corrupt JSON / future version / null tokens / nothing at all / legacy `theme-bg` only — all render, none below 17.8:1.
  - `theme-bg` is still written for one release, because HTML cached by an older service worker still runs the previous background-only boot script.
  - **Not fixed**: a brand-new device has no localStorage, so its very first paint is still the default palette until theme-sync pulls the account theme. Fixing that needs the theme server-side (cookie or a Turso mirror), not localStorage.
  - **Not fixed**: `static/manifest.json` `background_color` is a static `#f7f2ea`, so Android's PWA launch splash is cream for dark-theme users. A per-user manifest isn't reliable — the OS caches it at install time.


### 2026-08-20 — Theme: mobile picker, RTDB cross-device sync, vibrance slider
- **Status**: `attempted` (built, pending user confirmation)
- **What**: Four changes to the colour scheme picker.
  1. **Vibrance** — new `vibrance` field on the theme record (0–200%, default 100). In `buildSchemeRoles` it multiplies the effective chroma of every family INCLUDING both neutral palettes, so it moves backgrounds/cards, not just accents. Composes with the per-family chroma sliders (they set the base, vibrance scales it). Deliberately does NOT clear `presetId` — like `dark`, it rides on top of the selected palette, and `setPreset` preserves it.
  2. **Mobile picker** — `MobileThemePicker.svelte`, shown by `/app/theme` under 640px. Light/dark segmented toggle, a grid of preset tiles each painted in its OWN resolved palette (new `previewRolesForPreset` / `previewRoles` in theme-store, memoised), a Custom tile wrapping a native colour input, the vibrance slider, and the live sample. Full desktop picker stays reachable behind a "Show all controls" disclosure so nothing is lost on mobile.
  3. **Role demo** — `ThemeDemo.svelte`: surface ladder, filled/tonal/outlined buttons, chips with a real selected state + a switch, chat bubbles, card with tertiary badge / error badge / themed link. Used by both pickers ("In context" section on desktop).
  4. **Cross-device sync** — `theme-sync.js` mirrors the theme record + saved schemes to RTDB `themes/{uid}`; init'd from `/app/+layout.svelte` after the Firebase client authenticates. Last-write-wins on `updatedAt`; `by: <deviceId>` marks our own echo. `theme-store` gained `themeUpdatedAt`, `stampThemeUpdatedAt`, `applyRemoteTheme`, `isApplyingRemoteTheme`, `sanitizeTheme`. The applying-remote guard is load-bearing: without it, applying a received theme schedules a push of that same theme back with a newer stamp, the sender re-applies and re-pushes, and the two devices volley forever.
- **Notes**:
  - **`database.rules.json` gained a `themes/$uid` node (own-read/own-write) and must be deployed (`firebase deploy --only database`) before sync works in production.** Until then writes are rejected and each device just keeps its local theme.
  - **Follow-up same day**: vibrance now moves light-mode surfaces across the full range. Chroma alone couldn't — see below — so above 100% `buildSchemeRoles` also walks the surface roles down in TONE (up to 10 steps at 200%) and re-applies the target chroma at the deeper tone. Light surface now reads #f9f9f9 → #fff8f7 → #ffe6e2 → #ffd3cd across 0/100/150/200%, with on-surface untouched at ~tone 10 so contrast only improves. Dark mode skips the pass entirely (it already responded).
  - **Follow-up same day**: preset dots in the desktop picker and the header ThemeSwitcher painted from the raw SEED, which is a generator input rather than a colour the theme renders — Raspberry's red seed produces a blue primary under `expressive`, and a seed dot looks identical in light and dark though the themes don't. Both now use `previewRolesForPreset` and render resolved primary over resolved surface, matching the mobile tiles.
  - **Follow-up same day**: added a master **Chroma** slider under Vibrance (mobile + desktop). `masterChroma` (null | 0–80, matching the Surface slider's ceiling) replaces the base chroma of EVERY family — primary/secondary/tertiary and both neutrals. It must win over the per-family overrides, not defer to them: presets ship their own `neutralChroma` (Red Peony sets 12), so a master that yielded would leave surfaces untouched on the themes people actually use. Moving any per-family slider clears `masterChroma` (manual control), so the two are mutually exclusive modes. Persists across preset changes and keeps `presetId`, same as vibrance.
    - The surface-deepening pass was re-keyed from "vibrance > 100%" to "effective neutral chroma exceeds its resting value", so the new slider gets the same tone treatment; keying it to vibrance would have left Chroma clipping exactly the way Vibrance used to. Excess 0 ⇒ shift 0, so untouched themes render byte-identically.
    - `SURFACE_TONE_SHIFT_MAX` raised 10 → 30 with a 0.85/chroma rate (calibrated so vibrance 200% still lands at ~10 steps). Tried 45: light surface keeps moving to chroma 80, but on-surface contrast falls to 4.3 (under AA) and the hue jumps (#dd5f80 pink at 60 → #d9541b orange at 70) as Hct's chroma setter trades hue for gamut. At 30 the ramp is hue-stable and contrast never drops below 7.0; light surface runs #f9f9f9 → #ffdfdb → #f89cb3 → #f8866c across chroma 0/20/40/50. Surfaces saturate out around 50; accents keep climbing to 80.
  - **Follow-up same day (user call)**: `SURFACE_TONE_SHIFT_MAX` raised 30 → 45 at the user's explicit request, trading contrast for intensity so the FULL master-chroma range keeps moving light surfaces (previously dead above ~50). Measured at 45: surface runs #f9f9f9 / #ffdfdb / #f89cb3 / #f08167 / #dd5f80 / #d9541b / #e04d00 across chroma 0/20/40/50/60/70/80. On-surface contrast stays ≥4.9 (AA) through chroma 60 and dips to 4.3 (just under AA for body text, still fine for large) at 70–80. Hue drifts at the top — the surface goes orange while the accents stay crimson — because Hct's chroma setter trades hue for gamut past the sRGB edge. Vibrance-only path verified unchanged. Revert = set the constant back to 30.
  - ORIGINAL FINDING (superseded by the tone fix above): vibrance above 100% barely moves LIGHT-mode surfaces: M3 puts surface at tone 98 / surface-variant at 90, where sRGB has almost no chroma headroom, so the extra chroma clips. Verified: light 100% vs 200% gives identical `surface`/`surface-container`/`surface-variant` while `secondary` and `outline` do move. Dark mode uses the full range (surface `#1f0f10` → `#28080c`). The 0→100 half is dramatic in both modes (0% is fully greyscale). Making the top half bite in light mode would mean shifting surface TONES down, not chroma — not attempted.


### 2026-07-28 — Chat: links, attachment parity, drag-drop, opt-in link chips
- **Status**: `attempted` (built + pushed, pending user confirmation)
- **What**: Four-phase chat upgrade after user asked for files/images to render everywhere, pasted links to be clickable, and an opt-in favicon+title link chip.
  1. **Linkify** — `linkifyRaw` in `src/lib/message-render.js` auto-links http(s)/www URLs in plain-text bubbles (runs on raw text pre-escape so `&` in query strings is safe; trims trailing punctuation, keeps balanced brackets; skips code blocks + effect spans). `.chat-link` styled in app.css. Lights up channel, DM, thread via the shared renderer.
  2. **Attachment parity** — new shared `MessageAttachment.svelte` (+ `file-utils.js`) with self-contained styles, optional in-app `onView` callback, and `compact` mode. Wired into ThreadPanel replies (was a bare 📎), the thread PARENT (rendered nothing for file-only), and the react-preview/pinned bubbles in channel + DM (empty bubble for image/file-only msgs). Channel/DM main loops kept their existing inline markup.
  3. **Drag-and-drop** — shared depth-counter drag handlers + "Drop to send" overlay on channel, DM, thread (any file → /api/upload → pendingAttachment). Gemma composer accepts dropped images only (vision model), warns on non-image drops. Chat previously had paste + picker only, no drop target.
  4. **Opt-in link chip** — proactive bar above the composer: paste/type a URL → favicon+title suggestion (title from existing `/api/link-meta`, favicon from host via Google S2). Tap → opts the URL in; it renders as an inline chip in place of the raw link. Message model: `lk:[{u,t}]` on the RTDB node ↔ `links:[{url,title}]` in `normaliseMessage`, written by `/api/chat`. Renderer threads `links` through `contentHtml`/`bubbleHtmlM`; cache key includes a link signature so chips never leak into plain messages. Opt-in only.
- **Gemma files**: confirmed model is vision-only (chatterbox OpenAI-compatible endpoint); reads images, not PDFs/docs. User chose images-only, so no file text extraction added.
- **Notes**: Legacy `app/chat/[convId]` page (plain-text, no attachments) left untouched — appears unused vs `dm/[convId]`. Unread-badge favicon override still forces the dark PNG on all themes (separate, not addressed here).

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

## Onboarding — Cooper Union 3-step wizard

### Revamped onboarding profile step — 2026-07-24
- **Status**: `attempted`
- **What**: `/onboarding/profile` rebuilt from one long generic form into a 3-step wizard (single form, one POST — steps are client-side):
  1. **Who are you** — avatar, name, pronouns.
  2. **You at Cooper** — school as three picker cards (Architecture 🏛️ / Art 🎨 / Engineering ⚙️, with full school names: Irwin S. Chanin / School of Art / Albert Nerken), year as pills (1st–5th year + Other), focus/concentration. REQUIRED for students (server-validated); instructors skip this step entirely.
  3. **What do you make?** — "Tell me about your interests" textarea that saves to `users.interests` — the SAME column Gemma's digest inspiration reads and the instructor can edit in Manage → Gemma. Bio + portfolio moved here as optional.
- Progress dots with back-navigation, per-step validation, generic "School / University" free-text replaced.
- **Notes**: students now self-report interests at onboarding; instructor edits in Manage still override/augment the same field.

## Gemma — DM-scan scope opt-in

### Instructor-DMs-only default + all-DMs opt-in — 2026-07-24
- **Status**: `attempted`
- **What**: Migration 046 (applied): `users.gemma_scan_dms` (default 0). Goal harvesting previously read ALL of a user's DMs; the default is now PRIVACY-TIGHTER — only DM conversations with instructors (plus class channels). Students opt in to full-DM scanning via a new "Let Gemma read all my DMs" checkbox on Profile → Edit (instant save via /api/gemma/settings {scanDms}; GET returns it for server-truth syncing). Scope enforced in gatherDMLines (instructor-id set from users table, conv other-participant check).
- **Committed**: the entire session shipped in `1262799` (Gemma system, Goals page, docx reader, GIF Studio scenes, chat polish — 41 files); this DM-scope feature follows in the next commit.

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

## Profile — customizable "vibe" profiles

### Gradient bg + name font + mouse effect + signature expression — 2026-07-25
- **Status**: `attempted`
- **What**: First slice of the MySpace-style profiles roadmap item. `users.profile_style` (migration `047_profile_style.sql`, applied) holds a JSON blob `{ bg, font, fx, sig }` validated against whitelists in the new shared module `src/lib/profile-style.js`. New endpoint `POST /api/profile-style` saves the caller's own style. `/app/profile/[userId]` revamped:
  - **Background** — 8 animated gradient presets (Sunset, Ocean, Candy, Vaporwave, Forest, Lava, Aurora — the heatmap palette, Goth) rendered full-bleed with a slow CSS `background-position` drift; the profile card + header go translucent with backdrop blur so text stays on `--ink` in both themes.
  - **Name font** — Avara (default, matches the old look), Sans, Cambridge (`@font-face` from `/fonts/Cambridge.otf`), Space Grotesk, Typewriter, Comic Sans, Impact.
  - **Mouse effect** — full-page canvas particles on pointermove: Sparkles / Hearts / Confetti / Bubbles / Glow trail (hue-cycling additive glow). Capped at 140 particles, spawn-throttled, DPR-aware, pointer-events: none.
  - **Signature expression** — any emoji / EK / custom / Telegram emote token shown big (2.4rem wrapper → 1.4em emote) next to the name with a bob animation; animated emotes animate via `contentHtml` + `mountStaticEmotes` (same pipeline as bio). Picked with the inline `ExpressionPicker` (same token mapping AvatarPicker uses).
  - **Customizer** — owner-only "✨ Customize" button on the profile toggles a panel (gradient swatches, font chips rendered in their own font, effect chips, sig picker w/ Clear); every change previews live and autosaves (debounced 500ms, "saved ✓" status).

### Custom HTML profile pages (full MySpace mode) — 2026-07-25
- **Status**: `attempted`
- **What**: Users can author a complete HTML document — their own CSS and arbitrary JS — that replaces the standard profile card for all visitors. `users.profile_html` (migration `048_profile_html.sql`, applied); `POST /api/profile-style` extended to accept `{ html }` (100KB cap, null clears). **Security model**: the document only ever renders in `<iframe sandbox="allow-scripts allow-popups allow-modals" srcdoc>` — no `allow-same-origin`, so scripts run under an opaque origin with no cookies, no session, no app API access, no parent DOM reach. Never add `allow-same-origin` to this iframe.
  - Custom page takes over the viewport under the header + a slim bar (back link, "X's custom page", Customize/Message button). Preset gradient/fx/sig are suppressed while a custom page is live.
  - Customizer group "Custom page — MySpace mode": Build your own page → seeds a starter template (their name/bio/current gradient, a marquee, a sparkle-trail script) → editor modal with side-by-side textarea + debounced live-preview iframe (same sandbox), Tab-inserts-tab, char counter, Save & publish. Remove is two-step.
  - Owner clicking ✨ Customize while a custom page is live falls back to the standard card view so preset controls stay reachable; toggling off returns to the custom page.

## Inspiration — library access, link reliability, load

### OpenAthens (Cooper Library), landing-page links, polling cap — 2026-07-26
- **Status**: `attempted`
- **Cooper library proxy**: found via library.cooper.edu/offsite/prefix — Cooper uses **OpenAthens**, not EZProxy. Prefix `https://go.openathens.net/redirector/cooper.edu?url=<enc>`. Verified it 302s to the resource's Shibboleth SP with Cooper's IdP (idp.cooper.edu). Paywalled papers' links are wrapped in this prefix client-side (`linkFor`) so students sign in with Cooper creds and land on the article. Added a `<details>` explainer on the Inspiration page describing the login flow.
- **Dead OA links (user hit "file couldn't be found on the server")**: worker preferred `best_oa_location.pdf_url` — direct repository PDF links rot/404. Now prefers `landing_page_url` (stable article page with the download) over pdf_url. Label simplified to "free to read".
- **Catalog-stub OA links (round 2)**: OpenAlex also lists library union-catalog RECORD resolvers (e.g. bib-bvb.de `F?func=service`) as OA locations — these are bibliographic stubs, no fulltext → 404. New `bestOaUrl(w)` vets ALL of a work's locations: rejects junk hosts (bib-bvb, worldcat, base-search, `func=service`/`doc_library=`/`func_code=` resolver patterns), scores by version (publishedVersion≫submitted) + stable-resolver bonus (doi.org, arxiv, PMC, hal, figshare) + landing-over-pdf, picks the best; null → paywalled → OpenAthens. One-time DB purge of unsaved paper items with junk URLs already in feeds.
- **Request load**: page polled every 6s with NO cap while a batch was pending → a stuck batch hammered the API from every open tab forever. Now bounded: 10 polls × 10s then stop, and skips backgrounded tabs. Worker POLL_MS 15s→30s (default + kahan scout.env).

### Papers: always DOI + always Cooper OpenAthens — 2026-07-26
- **Status**: `attempted`
- **What**: Per user, stopped trying to pick a free OA copy (OpenAlex OA URLs point at rotting repository files AND malformed catalog stubs — one bib-bvb.de record was even stored with literal `&amp;`). Now every paper links to its **DOI** (`w.doi`, canonical/permanent) and the app **always** routes papers through Cooper's OpenAthens proxy (`linkFor` wraps `kind==='paper'`, not just paywalled). DOI resolves to the live article; Cooper login serves it free (OA) or unlocked (subscription). Removed `bestOaUrl`/`JUNK_OA`. `open_access.is_oa` kept only as an "open access" label. Icon changed lock→`account_balance` (library) on all papers, "via Cooper Library" on every paper. `cleanUrl` de-mangles legacy `&amp;`. Purged all non-DOI paper items; verified fresh batch = 100% DOI, wrapped correctly.

### Don't hide no-DOI papers — surface books as "find a copy" — 2026-07-26
- **Status**: `attempted`
- **What**: The always-DOI guard was silently DROPPING valuable no-DOI works — which turn out to be canonical BOOKS (Bringhurst *Elements of Typographic Style*, Geuss *Idea of a Critical Theory*, *Designing Interaction*). Books rarely have DOIs and can't route through OpenAthens (that's for e-journals). Now: DOI present → DOI link + Cooper OpenAthens (article); no DOI → **Google Books search** by title+author (`google.com/search?tbm=bks`) — never hidden, always lands on the book (preview + borrow/buy), linked direct. materialize `usableUrl` accepts doi.org OR google-books search for papers (still rejects catalog stubs). Frontend: `isDoiPaper` splits routing + icon (account_balance vs menu_book) + label (via Cooper Library vs book·find a copy). Verified a book-heavy query returns 10 papers, books as find-links, zero dropped.

## Recommendations — visual redesign (exhibition-catalog direction)

### Editorial redesign of the Recommendations tab — 2026-07-27
- **Status**: `attempted`
- **What**: Reworked the page's visual design (frontend-design skill) within the brand system (cream #f7f2ea / ink / amber #ffa305 / Avara serif). Direction: an **exhibition-catalog / gallery wall-label** treatment fitting the art+reading discovery subject.
  - Masthead: "Curated finds" amber kicker + large Avara "Recommendations" + a sources byline (V&A · Ars Electronica · … · Cooper Library) + scope-aware sub.
  - Section headers: Avara serif name + item count + hairline rule (catalog divider) — replaced the tiny uppercase-amber eyebrows.
  - Artworks: framed image plates (1px frame + soft shadow, hover lift) with a museum WALL-LABEL beneath — title / italic creator·date / uppercase institution. Actions reveal on hover (always shown on touch).
  - Readings: a hairline-separated bibliography (title hover→amber, source citation line) instead of bordered cards.
  - Week dividers: amber "WEEK N" kicker + big Avara topic + ink underline.
  - All chunky 1.5px borders → 1px hairlines for precision. No logic changed. Verified via headless-Chrome preview screenshot.

## Recommendations — moved storage to Firebase RTDB

### Recs + reactions now live in RTDB (was Turso); stable order — 2026-07-27
- **Status**: `attempted`
- **What**: The "recs change on the same page" was Turso re-materializing + re-sorting on every poll. Moved the STORE to **Firebase RTDB** (Turso keeps only the scout_jobs QUEUE + syllabus + users). New modules: `recs-filter.js` (pure filter/quota, DB-free) and `recs-rtdb.js` (read/write via firebase-admin). Paths: `recs/users/{uid}/items/{k}` (personal, saved/rating on the node), `recs/class/{cid}/blended/{k}`, `recs/class/{cid}/weeks/{n}/{k}`, `recs/class/{cid}/reactions/{k}/{uid}` (every student's like visible → instructor Students view aggregates them). `k` = sha1(url) so re-writing a batch never reshuffles — items keep their original createdAt, order is stable.
  - **"kahan posts to RTDB"**: the worker POSTs results to `/api/scout/jobs` as before; that handler now calls `writeJobRecs(tag, query, results)` — the app (which holds the Firebase creds) writes them straight to RTDB. Kahan itself stays credential-free.
  - `inspiration.js` rewritten: enqueue/queue logic stays in Turso, all reads + reactions go through RTDB. Reaction itemId is now the RTDB key (string), not an int — API + frontend already pass `item.id`.
  - Migrated existing Turso rows → RTDB (99 personal, 42 blended, 16 weekly items).
- **Latent bug the migration surfaced + fixed**: the paper-URL check `/(^|\.)doi\.org\//` REJECTED every real DOI (host is preceded by `//`, not `.`). It went unnoticed because old DOI papers persisted in Turso from before the check was added — fresh RTDB exposed it (no papers). Fixed to `/^https?:\/\/([a-z0-9-]+\.)*doi\.org\//` (+ spoof-safe). Old Turso tables left in place (unused, non-destructive).

## Recommendations — de-dup All-topics vs By-week

### Class 'All topics' excludes what 'By week' already shows — 2026-07-27
- **Status**: `attempted`
- **What**: The two Class sub-views repeated a few entries — both queries include the class SUBJECT, so subject-level finds landed in the blended feed AND every week. `readSharedItems` gained an optional `excludeLike` (user_id LIKE pattern) that drops items whose URL also appears under those owners; `getClassFeed` passes `class:<id>:w%` so "All topics" excludes anything in the per-week feeds — making it a distinct, complementary blend. Verified: blended 12 / weekly 16 / overlap 0 (was a few). Blended stays healthy; as weeks grow, Refresh/Fetch-more keeps unique items flowing.

## Recommendations — on-demand Refresh + responsiveness

### Refresh button + faster polling; class-feed materialize was a deploy lag — 2026-07-27
- **Status**: `attempted`
- **What**: User's class blended feed showed empty with "Scout is out fetching…" — diagnosed: job 53 was DONE with 36 items but 0 materialized. Local getClassFeed worked fine (materialized 20) → it was a Vercel DEPLOY LAG, not a code bug (running getClassFeed locally against shared Turso populated it). To make refresh feel on-the-fly: (1) explicit "↻ Refresh" chip in the Mine + Class-All view-rows (enqueue + poll, spinner while pending) — discoverable even when the feed is empty; (2) client poll cadence 10s→6s, attempts 10→16 (~96s window); (3) worker POLL_MS 30s→15s (the cost concern that drove 30s was resolved by the capped client polling). 
- **Note**: recurring theme — Vercel deploys lag this session, so server-code changes (materialize, getClassFeed) don't take effect until deploy; running the function locally against shared Turso is the manual workaround.

## Recommendations — Rijksmuseum (new keyless Linked Art API)

### Rijksmuseum source — prints / graphic design / typography — 2026-07-26
- **Status**: `attempted`
- **What**: Rijksmuseum's legacy keyed API is gone (410); moved to a keyless **Linked Art** API. Worked out the shape: `GET data.rijksmuseum.nl/search/collection?description=<q>&imageAvailable=true` → `orderedItems[].id` (Linked Open Data IDs), and the image is FOUR hops deep — object (`identified_by` Name = title, Identifier = object number for the web URL; `shows` → VisualItem) → VisualItem (`digitally_shown_by` → DigitalObject) → DigitalObject (`access_point[].id` = IIIF `.../full/max/0/default.jpg`, resized to `/full/400,/`). So `searchRijks` resolves only the top 2 hits (rot-rotated) to bound the fetch cost. Trusted like V&A (its English `description` search is genuinely on-topic; Dutch titles wouldn't survive a keyword re-filter). source 'rijks' (not strict). Verified typography/graphic-design/poster → real prints (Escher-adjacent, cover designs) with loading IIIF images.

## Recommendations — Harvard Art Museums + better stemming

### Harvard source (Bauhaus/design/typography) — 2026-07-26
- **Status**: `attempted`
- **What**: Added Harvard Art Museums (`searchHarvard`, needs HARVARD_KEY — stored in .env + kahan scout.env, NOT committed). Strong on Bauhaus/design/typography/modern (Moholy-Nagy et al.) but encyclopedic, so strict-filtered like Met/AIC (added 'harvard' to materialize MUSEUM_STRICT): contributes for design topics, nothing for generative (its "generative art" search returns 225k junk). IIIF images resized via ?height/width. Also **improved the stemmer** (both worker + materialize) — was too weak: "typography" didn't match "typographical". Now strips ical/ic/y/ism/ist/ance/… so typography/typographic/typographical→typograph, generative→generat, algorithmic→algorithm. Verified Harvard "typography" → Otto Rittweger typographic designs (Bauhaus era), zero junk.

## Recommendations — pioneer-artist search (Molnár, Mohr, …)

### Named generative-art pioneers via V&A artist search — 2026-07-26
- **Status**: `attempted`
- **What**: User wanted Vera Molnár "from the Met" — but the Met genuinely doesn't have her (its 8 "Vera Molnar" hits are Hans Memling etc., false keyword matches; verification rejected them). The V&A DOES hold the canon: Molnár, Mohr, Csuri, Nake, Nees, Schwartz all verified by maker name. So `searchPioneers` (fires when the query is in GEN_DOMAIN — generative/algorithm/computational/procedural/media art) searches the V&A for a seed-rotated trio of pioneers, verifies `_primaryMaker.name` (de-accented — "Molnár" vs "Molnar"), and returns one work each as source `museum_artist` (trusted, bypasses the keyword filter). Verified: "generative art, algorithms" now includes Molnár "Letters from my Mother", Mohr "Scratch Code", Schwartz "Fish". Rotation surfaces different pioneers on Fetch More.
- **Dead ends**: Met has none (encyclopedic); Europeana's `who:`/creator index is too sparse for these artists (0 for Molnár/Nake/Nees). V&A is the reliable holder.
- **Rijksmuseum**: user notes it's now keyless, but the legacy endpoints 410/400 — needs the new data.rijksmuseum.nl Linked-Art endpoint worked out before adding.

## Recommendations — added Europeana (Ars Electronica / ZKM / media art)

### Europeana source — the media/generative/design archives US museums lack — 2026-07-26
- **Status**: `attempted`
- **What**: User asked what the Met has on generative art (answer: almost nothing — 0 Manfred Mohr, 8 Vera Molnár; and its topic-search ranks classical art on top, so trusting it = junk). Added **Europeana** (`searchEuropeana`) — aggregates 3,000+ European institutions incl. **Ars Electronica** and **ZKM**, the media/computer/generative-art archives. Relevance-ranked + genuinely on-topic, so trusted like V&A (lenient keyword filter, fallback to top). Each result labels its real provider (Ars Electronica, Computer Museum, Museum of Things…). Free API; `api2demo` key works, `EUROPEANA_KEY` env overrides for a higher rate limit. artwork BASE_QUOTA 9→12 for the extra good sources; section renamed "From the museums & archives". Verified "generative art, algorithms" → V&A + Ars Electronica, zero Met/AIC.
- **Other options noted for the user**: Smithsonian/Cooper Hewitt, Harvard Art Museums, Rijksmuseum — all strong + public APIs but need a free key.

## Recommendations — stop stale jobs re-injecting museum junk

### materialize() museum-relevance guard — 2026-07-26
- **Status**: `attempted`
- **What**: The junk kept COMING BACK after deletion — same class of bug as the bib-bvb link. `materialize()` re-inserts from cached scout jobs (done, <2 days), and those jobs were generated by the OLD worker (pre museum-filter), so their results still carried Botticelli/Seurat/porcelain. Deleting feed items was futile; the next page load re-materialized them. Fix: `materialize`/`materializeOwner` now select the job's `query`, compute stems, and drop fine-art-museum (met/artic/cleveland) artwork whose shown fields don't contain a query word — mirroring the worker, so stale cached results can't reintroduce junk. V&A + are.na images trusted (ranking). Verified: deleted 27 junk, re-ran feed → artwork back to V&A-only (17), no re-injection.

## Recommendations — museum relevance, take 3 (V&A trust + stemming)

### Fine-art museums no longer flood design topics; V&A trusted — 2026-07-26
- **Status**: `attempted`
- **What**: For "generative art, algorithms" the genuinely-relevant museum pieces (Verostko/Nake/Nees/Hébert/Hammersley/Neagu) are ALL V&A — it holds the computer-art collection — while Met/AIC returned classical filler (Botticelli, Seurat, porcelain). But V&A's search records don't expose the metadata it matched on, so a perfect hit's TITLE often lacks the query word → the strict keyword filter would wrongly drop Nake too. Fix: (1) **V&A trusts its own ranking** — keyword-filter only when that still leaves ≥2, else take the top results as-is (it's the design museum, authoritative for these topics). Met/AIC/Cleveland stay strict (must contain a query stem in title/medium/classification), so their classical noise drops to nothing when they have no real match. (2) **Stemming** (`generative`→`generat`, `algorithms`→`algorithm`) so morphological variants match. Verified "generative art, algorithms" → V&A Neagu/Hammersley/Hébert/Verostko/Nake, zero Met/AIC junk. (3) One-time cleanup: purged the user's 40 accumulated irrelevant Met/AIC/Cleveland artworks (kept 17 V&A).

## Recommendations — museum keyword-relevance guard

### Museums must contain a query word (no more On Kawara for text adventure) — 2026-07-26
- **Status**: `attempted`
- **What**: Top-ranking alone still let coincidental metadata matches through (On Kawara date paintings "matched" text adventure via the word "text" in a description). Added `matchesQuery`: a museum piece is kept only if a real query word (≥4 chars, minus generic filler like design/concepts/studio) appears in the title/artist/medium/classification we actually show. When a topic has no true museum hits, that source returns nothing instead of junk. Applied to Met/AIC/Cleveland/V&A (each now fetches ~15 and filters, Met fetches top 6 details and keeps ≤3 matches). Verified "text adventure" → Adventures of Ulysses, Alice's Adventures in Wonderland, a Dickens manuscript — not On Kawara.
- **Refresh note**: class feeds cache for REFRESH_MS (20h) so a worker change doesn't auto-refresh existing feeds; cleared the class blended + per-week items/jobs to force regeneration. Users can force it themselves with "Fetch more for every week".

## Recommendations — museum relevance

### Museum results actually relate to the query — 2026-07-26
- **Status**: `attempted`
- **What**: "From the museums" was returning a few relevant pieces + lots of unrelated ones. Cause: the Fetch-More rotation paged DEEP (Met slice up to idx 21, AIC page 8, Cleveland skip 21, V&A page 8) into loosely-keyword-matched tails. Museum APIs are relevance-ranked, so now all four stay in the TOP ~9 and rotate which 3 within that window (`topSlice` = slice rot(3)*3). AIC additionally drops weak matches below 35% of the top _score. Verified "typography" → Typography / Design for lettering / Colophon… instead of random works.

## Recommendations — Class: All topics vs By week

### Weekly per-topic feeds under the Class tab — 2026-07-26
- **Status**: `attempted`
- **What**: Class scope gained a sub-mode toggle: **All topics** (whole syllabus blended — the existing class feed) and **By week** (a full content suite per week topic). Refactored the class backend into generic shared-feed helpers (`enqueueSharedBatch`, `materializeOwner`, `readSharedItems`, `jobAge`, `isPending`) reused by both the blended feed (owner `class:<id>`) and each week (owner `class:<id>:w<n>`, tag `inspo:class:<id>:w<n>`). `getWeekList` folds the class SUBJECT into every week's query so a terse week ("Text adventure") still pulls papers/images/artwork/channels in the right context. `getClassWeeklyFeeds` returns [{week,headline,topic,items,pending}]; `requestMoreWeekly` fans a fresh batch to every week. API: `?scope=class&mode=weekly`, POST `{more,scope:class,mode:weekly}`. Frontend: extracted the kind-section rendering into a reusable `feedSections(list)` snippet, used by the flat feed and each week block; per-week scout jobs enqueue on first view and poll in. Verified: Week 1 filled with 17 items across paper/artwork/channel/article.

## Recommendations — arena_img quota + class parity

### are.na images now surface; class feed matches personal — 2026-07-26
- **Status**: `attempted`
- **What**: Two fixes. (1) `arena_img` wasn't in BASE_QUOTA (defaulted to 4) and — more importantly — every existing feed item predated the arena_img worker deploy, so NO are.na images were stored. Added `arena_img: 6` to BASE_QUOTA; regenerating batches now stores + shows them. (2) Class feed was thin (6 artwork from the lone vague syllabus topic "Text adventure") and structurally unlike the personal feed. `getClassTopics` now seeds with the **class SUBJECT** (`classes.name` = "Interactive Design Concepts") first, then week topics, then trending student likes — guaranteeing the class feed pulls the same diverse types (paper/arena_img/artwork/channel/article) even when the syllabus is sparse. Verified both feeds materialize all 5 kinds incl. arena_img.
- **Note**: existing feeds only backfill on the next batch (fetch more / daily refresh); regenerated the instructor's personal + class feeds to confirm.

## Inspiration — liked/disliked views + are.na images

### See what you've liked/disliked + are.na topical images — 2026-07-26
- **Status**: `attempted`
- **What**:
  - **Liked / Disliked views**: Mine view-row gained 👍 Liked / 👎 Disliked / 🔖 Saved / History chips (Class got All / Liked / Saved). Liked/disliked/history load the FULL set (`?history=1`) since disliked + expired items are excluded from the default feed; `visible` filters by rating. Leaving a full view back to a live one refetches.
  - **are.na images**: replaced the flaky block-search (`searchArenaBlocks`, kind 'link') with `searchArenaImages` (kind `arena_img`) — pulls Image blocks from the CONTENTS of the top 2 topical channels (curation-by-followed-channel is the quality signal; are.na search doesn't expose per-block likes and its block-search endpoint intermittently 503s HTML). Seed rotates the slice for Fetch More. New "are.na images" section renders in the image grid (IMAGE_KINDS = artwork + arena_img). Verified: "risograph" → 6 images from real channels + 4 channels.

## Inspiration — Class feed + personal + instructor view

### Two feeds (Class / Mine) + Students insights — 2026-07-26
- **Status**: `attempted`
- **What**: Three scope tabs on /app/inspiration.
  - **Class** — one SHARED feed (inspiration_items owner_id `class:<classId>`) built from the syllabus (week_plans headlines, `cleanTopic` strips [tg:]/PUA/emoji chat tokens). Everyone sees the same items; per-student reactions live in new `inspiration_reactions` table (054); items ordered by AGGREGATE reaction score (SUM ratings across students) so class favorites float up. Shows "👍 N in class" per item.
  - **Mine** — the existing personal feed (unchanged): interests-driven, personal reactions, Fresh/Saved/History, editable topics, export.
  - **Students** (instructor only) — `getStudentInsights`: every student's personal likes/saves + their interests + class-favorite reactions, plus class aggregate favorites. Links to profiles.
  - **Cross-influence**: class query = syllabus topics + "trending" personal-liked titles across ≥2 students (getClassTopics). Aggregate class reactions drive class ordering.
  - API: `?scope=class`, `?insights=1`, POST `{scope,itemId,rating|saved}` → reactClassItem, POST `{more,scope}`. Class uses DEFAULT_CLASS.
- **Note**: current syllabus has 1 week ("Text adventure") so the class feed is thin (6 artworks) — it enriches as week topics are added. Verified: class feed generates from cleaned topics, insights lists 19 students, all compiles.

### ⚠️ Vercel deploy stalled — 2026-07-26
- **Blocker**: Auto-deploy stopped after commit `a112577` (basic Inspiration tab). SIX commits unshipped (Fetch More, feedback loop, header fixes, topics/export, OA links, paywall+OpenAthens). Confirmed via production sanitizer probe: POSTing a result with `paywalled:true` stored WITHOUT the field = old endpoint code live. `npm run build` passes clean locally (only optional-dep warnings), so it is NOT a build failure — appears Vercel-side (stuck/paused/queued). Worker changes take effect regardless (kahan), but all frontend + server-route changes are gated on this deploy. USER must check Vercel dashboard.

## Scout — kahan web-research worker for Gemma

### Pull-worker scraper API (are.na + Wikipedia inspiration links) — 2026-07-25
- **Status**: `attempted`
- **What**: Kahan (`cooper-kahan` SSH alias → kahanctrl.ee.cooper.edu:31415) has a public DNS record but firewalled inbound ports (only chatterbox got a public HTTPS front), so instead of an inbound API the scraper is a **puller**: `scout/scout.js` (single-file Node ≥18, zero deps) polls `GET /api/scout/jobs` over outbound HTTPS with `Bearer SCOUT_TOKEN`, runs searches, `POST`s results back. No ports, no tunnel.
  - **Sources**: are.na official API (channel + block search, unauthenticated) and Wikipedia REST search; interests split on commas (≤3 sub-queries); politeness baked in (identified UA with contact email, ≥1s per-host spacing, 12s timeouts, official APIs only). ~14 results deduped by URL.
  - **App side**: `scout_jobs` + `scout_state` tables (migration `049`, applied); `/api/scout/jobs` (GET claims ≤3 queued→running, heartbeats, requeues jobs stuck running >5min; POST stores capped/sanitized link arrays); `src/lib/server/scout.js` (`enqueueSearch` dedupes vs pending + <12h-fresh results, `searchWithWait` waits ≤15s only when the worker heartbeat is <90s old, falls back to ≤7-day cache, else null).
  - **Gemma wiring**: `sendGemmaDigestInner` fetches webFinds for `users.interests`; prompt gains a "WEB FINDS" section + system-prompt rule to ground the inspiration in ONE find with its URL verbatim as a markdown link (never with no finds); `templateDigest` fallback links the first find. Fingerprint unchanged → link-only changes never trigger a re-send.
  - **Observability**: `?status=all` response now carries `scout: {online, lastSeen, queued}`; Manage → Gemma shows "● Scout online / ○ offline (last seen …)".
  - **Deploy**: `scp -r scout cooper-kahan:~/scout`, paste token into `scout.env`, `nohup ./run.sh &` (or the included systemd user unit). `SCOUT_TOKEN` generated into local `.env` — must also be added to Vercel env.
  - **Verified E2E locally**: queued a job in Turso, ran the worker against localhost:5175 — claimed job #1, posted 14 real results (are.na channels + Wikipedia), heartbeat recorded, bad token → 401.
- **Deployed 2026-07-25**: worker live on kahan at `/zooper2/richard.yurewitch/scout` (nohup, Node v22; AFS home is broken so everything lives in /zooper2 and key auth is impossible — password via expect). GOTCHA: `EATING_URL` must be `https://www.eating.computer` — the apex 307-redirects to www and Node fetch drops the Authorization header on cross-host redirects (worker got 401s until pointed at www). Also: pkill patterns in ssh commands must use `scout[.]js` bracket trick or they kill their own session. Verified in prod: heartbeat 4s, test job → 14 real results.
- **Note**: while testing, a bare `GET /api/gemma/digest` locally ran the real cron path (local .env has no `CRON_SECRET`, and the guard is `if (env.CRON_SECRET && …)`) — sent one real digest to the instructor account.

### Inspiration tab (daily finds + save-to-keep) — 2026-07-25
- **Status**: `attempted`
- **What**: Sidebar "✨ Inspiration" under Goals → /app/inspiration. Scout gained 4 keyless museum sources (Met, AIC, Cleveland, V&A — Cooper Hewitt needs a token, Harvard needs a key) + OpenAlex seminal papers. KEY LESSONS: (1) OpenAlex must use EXACT-PHRASE search + relevance-then-citation rerank — unquoted, anything containing "generative" drowns in generative-AI megapapers; quoted, "generative art" surfaces Galanter/Boden (the actual canon). (2) Meta-phrases stripped in splitQuery ("academic writing on X" → X). (3) Single ultra-broad words ("algorithms") still return generic famous papers — interests should be specific topical phrases. Museum/are.na sources rotate result pages daily (dayRot) so repeat queries bring new finds; papers deliberately don't rotate. Feed mechanics: inspiration_items per user, URL-unique (every batch genuinely new), unsaved items fade from the feed after 7 days (History view keeps all), saves are permanent AND seed the next batch's query. V&A for "generative art" returned Frieder Nake/Verostko/Hébert — the actual algorithmic-art pioneers. Verified E2E locally (38 items) and in prod through kahan. Set the instructor account's empty interests to "academic writing on generative art, algorithms" for testing (kept — shared Turso means that feed is already live).

### Fetch More + like/dislike feedback loop — 2026-07-25
- **Status**: `attempted`
- **What**: Inspiration items gained 👍/👎 (migration 051 `rating`). Feedback shapes batches three ways: liked/saved titles fold into the next Scout query; per-kind quotas move with the like−dislike tally (BASE±tally, clamped [1, 2×base] so taste can recover); words appearing in ≥2 disliked titles are blocked from new items. Disliked items leave the feed immediately (History keeps them). **Batch seeds**: each batch's query ends in `#sN` (N = user's prior job count); the worker parses the seed and pushes every source deeper — museum/are.na page rotation, OpenAlex citation-window slide (batch 0 stays canonical top-5). Seed-in-query also busts the scout result cache naturally. **Async model**: POST `{more:true}` enqueues and returns; GET materializes finished jobs idempotently (per-user URL unique index) + reports `pending`; the page polls every 6s — no long serverless holds, immune to Vercel function timeouts. Verified E2E: disliking 3 generic algorithm papers shrank the paper quota (5→2 on next batch), liking Galanter + a Nake piece steered the next query, Fetch More delivered 16 genuinely new items.
- **Gotcha**: two commands ran from `scout/` cwd (a `cd scout` python block persisted) — dev server failed with "missing script" and debugtmp landed in `scout/src/...`. Watch cwd after cd-ing in Bash blocks.

### Inspiration papers: serve the article, not the paywall — 2026-07-26
- **Status**: `attempted`
- **What**: OpenAlex knows each work's legal open-access copy (`best_oa_location`: publisher OA / arXiv / PubMed Central / author repos / green OA). Scout now links papers to `best_oa_location.pdf_url` (or its OA landing page) when `open_access.is_oa`, falling back to the DOI only for genuinely closed papers. Access is labeled in `meta`: "free PDF" / "free to read" / "may be paywalled" so students know before clicking. NOT a paywall bypass — closed papers stay closed (labeled); we just stop routing students to a paywall when a legal free copy exists. All 8 canon "generative art" papers had OA copies; verified in prod (PMC + eScholarship free links surfaced, closed ones labeled).

## App-wide — fixed header overlap

### Every page now pads by the real measured header height — 2026-07-26
- **Status**: `attempted`
- **What**: The layout's fixed AppHeader publishes its true rendered height as `--header-h` (ResizeObserver), but pages compensated with a hardcoded 52px (wrong whenever the class-switcher subtitle/notch makes the header taller) or not at all. Audit + fix of every /app page:
  - 52px → `var(--header-h, 52px)`: home, orbit, lab, manage (desktop rule; their mobile pager panels keep the reset), weeks, ai, lab/gif (incl. its sticky rail + fixed sidebar offsets).
  - Added missing compensation: goals, inspiration (had none — always overlapped).
  - **Removed legacy in-flow headers** (wordmark + ClassSwitcher rendered UNDER the fixed AppHeader = double header): files, assignments, profile/[userId], profile/edit. Files' mobile fixed-header CSS went too. Profile takeover mode (custom HTML page) pads the shell by --header-h.
- **Rule for new pages**: never hardcode 52px; pad top-level content with `calc(<spacing> + var(--header-h, 52px))`, and mobile pager panels (home/orbit/lab/manage) reset it because .pager-track already offsets.

### Inspiration: editable topics + algorithm export — 2026-07-26
- **Status**: `attempted`
- **What**: `users.inspo_topics` (migration 052) — user-editable search topics for the feed, falling back to profile interests when empty. "Searching for: … [Edit topics]" row on the page; saving immediately enqueues a fresh batch (and "Reset to interests" clears the override). "Export my algorithm" downloads `inspiration-algorithm.json`: topics, interests, the exact next-batch query, derived taste model (kind tallies → quotas, blocked words), and full saved/liked/disliked item lists (format `eating.computer-inspiration-v1`).

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

## Dev tooling — remote hard refresh via RTDB

### `dev/refreshNeeded` forces every client to drop its cache and reload — 2026-08-20
- **Status**: `attempted`
- **What**: A DEV-ONLY kill switch for the stale-build problem: the installed iOS app serves whatever its service worker cached (`cache-${version}`, cache-first on static assets), so a device can sit several deploys behind with nothing on screen to say so — which makes "is this fixed yet?" unanswerable during a debugging session.
  - **RTDB path**: `dev/refreshNeeded`. Write a NEW value (a `Date.now()` timestamp is the obvious choice) and every signed-in client unregisters its service worker, deletes every Cache Storage entry, and reloads with a cache-busting query param.
  - **Rules** (`database.rules.json`): `dev` is `.read: auth != null`, `dev/refreshNeeded` is `.write: false` — only the Admin SDK or the Firebase console can set it, so nothing in the app can fire it by accident. **Needs `firebase deploy --only database` to take effect**; until the rules ship, clients get permission-denied on the read and the watcher does nothing.
  - **Client**: `watchDevRefresh()` in `src/routes/app/+layout.svelte`, started once Firebase auth lands (alongside presence + theme-sync). The last-seen value is kept per device in `localStorage['dev:refreshNeeded']`, so joining the app never reloads — only a value that CHANGES while you are running does. Without that it is a boot loop.
- **Notes**: Not a product feature and not surfaced in the UI. Setting the value again to the SAME number does nothing; it has to change.

## Chat — scroll anchoring

### The message list stops jumping while you read — 2026-08-20
- **Status**: `attempted`
- **What**: Scrolling back through a channel or DM would randomly lurch up or down. Every cause was the same shape: something ABOVE the reader changed height after the fact, and nothing put the reader back.
  - **`src/lib/chat-scroll-anchor.js`** (new) — remembers which row is at the top of the viewport and how far into it, then restores that row's exact position after any change. Wired into both chat pages via `createScrollAnchor(listEl)` in an `$effect`.
    - It observes the list's **children**, never the list itself. A `ResizeObserver` on the list fires on every viewport height change, so it runs all through the mobile keyboard animation and fights `native.js` — that's the observer the compose-picker code deliberately removed. Row heights are keyboard-independent.
    - It measures **actual drift** (where is the anchor now vs. where it was) instead of predicting a delta from `scrollHeight`. That composes with Chrome's native scroll anchoring — drift reads as 0 and it no-ops — rather than double-correcting against it, which is what the old per-site patches did. Safari has no native anchoring at all, so there it does all the work.
    - `MutationObserver` on `childList` covers height added by new rows (history prepends, the load-more spinner) that no row resize would report.
  - **Removed the two hand-rolled compensations** it replaces: the `requestAnimationFrame` `scrollHeight`-delta fixup in `loadMoreHistory()`, and the `scrollTopBefore/scrollHeightBefore` snapshot in `toggleReaction()`. Both fought native anchoring and each corrected a frame late.
  - **An incoming message no longer yanks you to the bottom.** `onChildAdded` called `scrollToBottom()` unconditionally, so anyone else posting while you read history hauled you down to the latest bubble. Now it only follows if you were already at the bottom.
  - **`scrollIfNearBottom()` asks the scroller where it is** instead of trusting `userScrolledUp`, which only updates on scroll events and so was stale right after mount — a late image load could yank a reader who had already scrolled away.
  - **`src/lib/img-dims.js`** (new) — attachments are stored without dimensions (see CHAT_STORAGE.md), so an `<img>` occupies zero height until it decodes and then snaps to size. The `reserveAspect` action learns each URL's ratio on first load, keeps it in `localStorage` (500 entries, insertion-ordered), and declares `aspect-ratio` on every later render, so the box is reserved up front. That also makes `loading="lazy"` + `decoding="async"` safe to add to attachment images.
  - **History prefetch at 600px** from the top instead of 200 — the fetch lands while there's still something to scroll, rather than the reader hitting the top, stopping dead, and having history appear underneath them.
  - **`.message.has-media { contain-intrinsic-size: auto 300px }`** — the mobile `content-visibility: auto` placeholder was 60px for every row, which is fine for a text bubble and ~5x too small for a photo. Closer guess, fewer and smaller corrections mid-flick.
- **Follow-up (2026-08-20, same day)**: user reported loads still landing above the bottom. Two causes, both outside the anchor's sight:
  - **Late bottom padding.** The list's `padding-bottom` is `inputAreaHeight`, which starts at 0 and is measured by `bind:clientHeight` a frame or two after mount — after `scrollToBottom()`'s last re-pin shot. Padding isn't a child, so the anchor never saw `scrollHeight` grow, and the reader was left exactly one input-bar (~96px) above the bottom. Persistent, because the incoming-message follow is now gated on `atBottom()` (80px), which the 96px miss fails. Fixed with a page-level `$effect` on `inputAreaHeight`: if the anchor is pinned, re-pin next frame; a mid-history reader is untouched (bottom padding doesn't move rows above it). Also covers the compose growing (multi-line drafts).
  - **Stale saved position.** `onListScroll` persisted distance-from-bottom even while the compose picker sheet had the list's `clientHeight` shrunk, inflating the saved value by the sheet's height — the next load "restored" that far up. Saves are now skipped while `_anyComposePicker`.
  - Initial placement also moved from `onMount` (where it sat behind a Firebase `get()` round-trip, letting the reader watch the list parked at the top on slow networks) into the anchor-creation `$effect` — `loadChatScroll` is a sync localStorage read, so there was never anything to wait for.
- **Follow-up 2 (2026-08-20)**: user decided a load should ALWAYS land at the bottom — the restore-reading-position feature (7032ce2) is removed entirely: `src/lib/chat-scroll-store.js` deleted, both pages no longer save or read `chatpos:*`. Stale localStorage entries are harmless (nothing reads them; they had a 30-min expiry anyway).
- **Verified**: both pages compile; the anchor module was exercised in-browser with `overflow-anchor: none` (the Safari case) — a 300px growth above the reader, a 10-row/710px prepend, a shrink above, growth below (correctly ignored), and a bottom-pinned reader all hold position exactly. Not yet confirmed by the user on a real device.

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
