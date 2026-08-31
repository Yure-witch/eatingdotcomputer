-- Lab → Rank It: let a room rank a poll WITHOUT accounts.
--
-- The instructor puts a QR on the projector, phones scan it, people type a
-- name and drag the list. No sign-up stands between a visitor and taking part
-- — the same bargain /m/[room] makes for the marquee.
--
-- `share_code` is the public join code (NULL = never shared, so the poll is
-- app-only). It's short and typable as well as scannable, from the same
-- ambiguity-free alphabet the marquee room codes use.
ALTER TABLE lab_polls ADD COLUMN share_code TEXT;

-- Multiple NULLs are allowed by a UNIQUE index in SQLite, which is exactly the
-- shape wanted here: at most one poll per live code, any number unshared.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_polls_share_code ON lab_polls (share_code);

-- Guest ballots reuse the (poll_id, user_id) key with a synthetic
-- `guest:<uuid>` id kept in the phone's localStorage, so re-ranking from the
-- same phone UPDATES rather than stacking up a second ballot — and the tally
-- needs no special case for them.
ALTER TABLE lab_poll_ballots ADD COLUMN guest_name TEXT;

-- Set when a guest ballot is later attached to a real account. Nullable and
-- unused by the tally; it's here so attaching is an UPDATE and not a migration
-- written under time pressure later.
ALTER TABLE lab_poll_ballots ADD COLUMN claimed_by TEXT;
