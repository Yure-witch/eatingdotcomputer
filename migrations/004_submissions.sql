ALTER TABLE assignments ADD COLUMN accepted_types TEXT NOT NULL DEFAULT '["link"]';

CREATE TABLE IF NOT EXISTS submissions (
	id            TEXT NOT NULL PRIMARY KEY,
	assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
	student_id    TEXT NOT NULL REFERENCES users(id),
	type          TEXT NOT NULL,   -- 'link' | 'image' | 'video'
	value         TEXT NOT NULL,   -- URL for links, R2 key for files
	created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
