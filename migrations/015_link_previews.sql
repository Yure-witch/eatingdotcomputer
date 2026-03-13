CREATE TABLE IF NOT EXISTS link_previews (
	url        TEXT NOT NULL PRIMARY KEY,
	title      TEXT,
	fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
