ALTER TABLE chat_messages ADD COLUMN reply_to_id TEXT;

CREATE TABLE IF NOT EXISTS message_reactions (
	message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
	emoji      TEXT NOT NULL,
	user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (message_id, emoji, user_id)
);
