-- URLs Gemma has already DM'd a user in a digest. The daily inspiration link
-- is filtered against this so it's always something NEW — previously the same
-- Scout result (cached per interests query) was linked for days in a row.
CREATE TABLE IF NOT EXISTS gemma_sent_links (
	user_id TEXT NOT NULL,
	url TEXT NOT NULL,
	sent_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, url)
);
