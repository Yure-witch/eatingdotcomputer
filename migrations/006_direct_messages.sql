CREATE TABLE IF NOT EXISTS direct_messages (
	id              TEXT NOT NULL PRIMARY KEY,
	conversation_id TEXT NOT NULL,
	user_id         TEXT NOT NULL,
	user_name       TEXT NOT NULL,
	content         TEXT NOT NULL,
	created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dm_conv_idx ON direct_messages(conversation_id, created_at);
