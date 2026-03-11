CREATE TABLE IF NOT EXISTS assignments (
	id          TEXT NOT NULL PRIMARY KEY,
	week        INTEGER NOT NULL,
	title       TEXT NOT NULL,
	description TEXT,
	due_date    TEXT,                        -- ISO date string, nullable
	created_by  TEXT NOT NULL REFERENCES users(id),
	created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
