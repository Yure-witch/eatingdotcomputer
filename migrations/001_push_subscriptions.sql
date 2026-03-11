CREATE TABLE IF NOT EXISTS push_subscriptions (
	id       TEXT NOT NULL PRIMARY KEY,
	user_id  TEXT,
	endpoint TEXT NOT NULL UNIQUE,
	p256dh   TEXT NOT NULL,
	auth     TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
