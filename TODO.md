# eating.computer — TODO

Items roughly ordered by priority. See `NORTH_STAR.md` for the big picture.

---

## Infrastructure / Ops

- [ ] Run `npm run migrate` in production for migrations 010 + 011

---

## Class / Enrollment System

- [ ] Class factions / enrollment — classes exist in DB (first: "Interactive Design Concepts, Fall 2026")
  - On first login, users are prompted to request to join a class
  - Instructor approves / denies requests
  - All data (assignments, chat channels, files, notes) scoped to a class
  - Users outside a class see nothing

---

## Chat

- [ ] Scope chat channels to a class (currently global)
- [ ] Message replies — `reply_to` field in Firebase + Turso archival + UI
- [ ] Emoji reactions — `reactions` map in Firebase + Turso reactions table + UI
- [ ] Expression picker in chat keyboard
  - Emoji (Google spec)
  - Emoji kitchen
  - Tenor GIFs
  - Whimsical moments / custom emotes
- [ ] Profile hover card on message bubbles (already on sidebar, not on bubbles)

---

## Notifications

- [ ] Email reminders for assignments / deadlines (fallback for non-PWA users)
- [ ] Students re-subscribe to push after iOS double-requestPermission fix

---

## Content

- [ ] Lecture Notes — dashboard placeholder exists, needs implementation
- [ ] Files / file sharing — dashboard placeholder exists, needs implementation

---

## Social / Profile

- [ ] Work showcase / public gallery — display student work publicly
- [ ] Spotify / Apple Music integration
  - Connect account
  - Show what you're listening to on profile, chat presence, etc.
