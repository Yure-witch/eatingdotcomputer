-- User sessions: one row per contiguous online session (start → end).
-- Replaces per-ping user_activity rows with space-efficient ranges.
-- Populated by the /api/presence/archive cron (reads RTDB sessionStart + lastSeen).
CREATE TABLE IF NOT EXISTS user_sessions (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id       TEXT    NOT NULL,
	session_start TEXT    NOT NULL,  -- ISO datetime (UTC)
	session_end   TEXT,              -- NULL while session is open / not yet archived
	device_type   TEXT,              -- 'mobile' | 'desktop'
	is_pwa        INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_start   ON user_sessions(session_start);

-- Seed from existing user_activity: treat each user's pings per day as one session.
INSERT INTO user_sessions (user_id, session_start, session_end, device_type, is_pwa)
SELECT
	user_id,
	MIN(logged_at) AS session_start,
	MAX(logged_at) AS session_end,
	COALESCE(device_type, 'desktop'),
	COALESCE(is_pwa, 0)
FROM user_activity
GROUP BY user_id, date(logged_at), COALESCE(device_type, 'desktop'), COALESCE(is_pwa, 0);
