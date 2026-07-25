# Chat storage — how messages move between Firebase RTDB and Turso

Chat is a two-tier system: **Firebase RTDB holds the live window (~24h)**
for realtime delivery, and **Turso holds durable history forever**. A cron
hits `/api/chat/sync` (Bearer `CRON_SECRET`) to move anything older than
24h from RTDB into Turso and delete it from RTDB.

Source of truth for this contract: `src/routes/api/chat/sync/+server.js`.
If that file and this doc disagree, the code wins — then fix this doc.

## RTDB paths (live tier)

```
channels/{channelId}/messages/{pushId}      channel messages
channels/{channelId}/reactions/{msgId}      live reactions
channels/{channelId}/lastAt                 last-activity stamp (unread dots)
dms/{convId}/messages/{pushId}              DM messages
dms/{convId}/reactions/{msgId}              live reactions
threads/{convId}/{parentMsgId}/messages/{pushId}   thread replies (Slack-style)
lastRead/{uid}/{convId}                     read cursors
threadReads/{uid}/{parentMsgId}             per-thread read cursors (ms)
unreadCounts/{uid}/{convId}                 unread counters
typing/{convId}/{uid}                       typing indicators
notifications/{uid}/{pushId}                bell notifications (also synced)
convReads/{convId}/{uid}                    DM read receipts
```

## Message shape (compact)

Live messages are written **compact** to keep RTDB payloads small:

```js
{
  u: userId,          // required
  c: content,         // required — raw text incl. PUA effect chars & [tokens]
  rt:  { id, ... },   // optional: flat reply-to
  att: { url, name, type, size },   // optional: R2 attachment
  fx,                 // optional: whole-bubble effect name
  fs, fw, wdth,       // optional: font size / weight / stretch
  nsp,                // optional: no-split flag for per-word effects
  tfx,                // optional: 1 = Telegram special-effect opt-in (jumbo av>0 emote; archived to chat_messages.tg_fx)
  mn: [{ u, o, l }]   // optional: mentions (uid, offset, len)
}
```

- **No timestamp field** — the creation time is decoded from the first 8
  chars of the Firebase push ID (`pushIdToTimestamp`).
- **No name/role** — resolved client-side from the member list, and at
  archive time from the Turso `users` table. A legacy verbose shape
  (`{ userId, userName, userRole, content }`) is still accepted on read.
- Thread replies use the same contract, currently only `{ u, c }`
  (no attachments/effects in the thread composer yet).

**Writes are server-side.** RTDB rules keep all message paths read-only
for clients; sends go through session-authed API routes that write with
the admin SDK (`POST /api/chat` for channel/DM messages, `POST
/api/chat/thread` for thread replies). Clients only write their own
presence/lastRead/unreadCounts/typing/convReads nodes.

## Turso tables (durable tier)

| Table | Holds | Written by |
|---|---|---|
| `chat_messages` | channel + DM messages (id = the RTDB push ID) | sync; also edit/delete APIs for archived msgs |
| `message_reactions` | reactions, one row per (msg, emoji-or-token, user) | sync + react API for archived msgs |
| `thread_messages` | thread replies, keyed by `parent_msg_id` + `conversation_id` | sync |
| `conversations` / `conversation_members` | conv registry (channels seeded, DMs inserted on first archive) | sync |
| `notifications` | bell entries older than 24h | sync |

Note: `thread_messages` deliberately has **no FK to `conversations`** —
a thread's conversation row may not exist yet at archive time (the DM
auto-insert lives in the main message pass), and thread archival must
never fail on that.

## Sync pass (`/api/chat/sync`)

For each channel, DM, and thread node:

1. Read messages, decode push-ID timestamps, keep those `<= now − 24h`.
2. Resolve `user_name`/`user_role` from Turso `users` (falls back to the
   legacy fields, then `Unknown`/`student`).
3. `INSERT OR IGNORE` into the matching table with ISO `created_at`
   (idempotent — re-running sync never duplicates).
4. Archive that message's reactions into `message_reactions`.
5. Null-update the archived keys out of RTDB (messages + reactions).
6. Sweep orphaned reactions (reactions on already-archived messages).

## Client read path

Pages load archived history from Turso (`/api/chat/history`,
`/api/chat/thread`) and subscribe to the RTDB path for the live window,
merging by message id (the id is the same push ID in both tiers, so
dedupe is trivial). Thread counts shown on parent bubbles =
Turso count (`/api/chat/thread?counts=1`) + live RTDB count; an open
ThreadPanel reports its exact merged count which takes precedence.

## Adding a new live surface — checklist

1. Write compact (`{ u, c, … }`) **from a server route via the admin
   SDK**, rely on push-ID time, no names.
2. Give it a sync pass: cutoff, userMap resolution, `INSERT OR IGNORE`,
   ISO timestamps, RTDB cleanup.
3. Give it a Turso-backed fetch endpoint (session-authed).
4. Merge archived + live client-side, dedupe by push ID.
5. **Add the new top-level path to the RTDB security rules** — they live
   in `database.rules.json` at the repo root. Deploy with
   `firebase deploy --only database` (after `firebase login`), or via the
   REST endpoint (`PUT {FIREBASE_DATABASE_URL}/.settings/rules.json`)
   authorised with the admin service account from `.env`.
