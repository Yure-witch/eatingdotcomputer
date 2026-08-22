-- User-facing content reporting (App Store Guideline 1.2: UGC apps need a way
-- to flag objectionable content). Any member can report a message from the
-- chat kebab menu; instructors review reports in Manage → Moderation.
-- The message content is SNAPSHOTTED at report time — live messages can be
-- edited or deleted afterwards, and the report has to keep showing what was
-- actually reported.
CREATE TABLE IF NOT EXISTS message_reports (
	id                 TEXT PRIMARY KEY,
	message_id         TEXT NOT NULL,
	conversation_id    TEXT NOT NULL,
	message_content    TEXT NOT NULL DEFAULT '',
	message_user_id    TEXT NOT NULL DEFAULT '',
	message_user_name  TEXT NOT NULL DEFAULT '',
	reporter_id        TEXT NOT NULL,
	reporter_name      TEXT NOT NULL DEFAULT '',
	reason             TEXT NOT NULL DEFAULT '',
	status             TEXT NOT NULL DEFAULT 'open',   -- open | resolved
	created_at         TEXT NOT NULL DEFAULT (datetime('now')),
	resolved_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_message_reports_status ON message_reports (status, created_at);
