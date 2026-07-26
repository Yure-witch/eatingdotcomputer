-- Inspiration feed: per-user daily recommendations materialized from
-- Scout search results. Saving an item keeps it forever (and is a strong
-- interest signal); unsaved items expire out of the main feed after 7
-- days but stay visible in the History view.
CREATE TABLE IF NOT EXISTS inspiration_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'link',   -- paper | artwork | channel | article | link
	source TEXT,                          -- openalex | met | artic | cleveland | vam | are.na | wikipedia
	title TEXT NOT NULL,
	url TEXT NOT NULL,
	snippet TEXT,
	meta TEXT,                            -- e.g. "1,234 citations", museum name
	image TEXT,
	saved INTEGER NOT NULL DEFAULT 0,
	saved_at TEXT,
	created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inspiration_user ON inspiration_items(user_id, saved, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_user_url ON inspiration_items(user_id, url);
