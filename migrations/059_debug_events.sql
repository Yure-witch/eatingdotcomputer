-- Temporary capture for native sign-in diagnostics. The failure only happens on
-- a physical device, where there is no console to read and the raw SDK response
-- is the only thing that distinguishes the failure modes. Drop this table once
-- native Google/Apple sign-in is confirmed working.
CREATE TABLE IF NOT EXISTS debug_events (
	id         TEXT PRIMARY KEY,
	kind       TEXT NOT NULL,
	payload    TEXT NOT NULL,
	user_agent TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_debug_events_created ON debug_events (created_at);
