CREATE TABLE IF NOT EXISTS messages (
	id         TEXT NOT NULL PRIMARY KEY,
	user_id    TEXT NOT NULL,
	user_name  TEXT NOT NULL,
	user_role  TEXT NOT NULL DEFAULT 'student',
	content    TEXT NOT NULL,
	created_at TEXT NOT NULL
);
