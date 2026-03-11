CREATE TABLE IF NOT EXISTS users (
	id            TEXT NOT NULL PRIMARY KEY,
	email         TEXT NOT NULL UNIQUE,
	name          TEXT,
	password_hash TEXT,        -- null for OAuth-only users
	role          TEXT NOT NULL DEFAULT 'student',  -- 'student' | 'instructor'
	created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
