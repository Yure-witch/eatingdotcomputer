-- Read-quota fix: the presence endpoint computed each user's "last seen" with
--   SELECT user_id, MAX(logged_at) FROM user_activity GROUP BY user_id
-- which FULL-SCANS the ~23k-row user_activity table on every presence poll, from
-- every client. Keep a denormalised last_active on the (18-row) users table so
-- the presence GET reads ~18 rows instead. user_activity is still appended for
-- history (notify-inactive), but no longer read on the hot path.

ALTER TABLE users ADD COLUMN last_active TEXT;

-- Composite index so any remaining per-user MAX(logged_at) (notify-inactive)
-- resolves via an index seek instead of scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_user_activity_user_time ON user_activity (user_id, logged_at);

-- One-time backfill from existing history.
UPDATE users SET last_active = (
	SELECT MAX(logged_at) FROM user_activity WHERE user_activity.user_id = users.id
);
