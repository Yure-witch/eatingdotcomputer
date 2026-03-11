-- Unified conversation model: channels, DMs, future group chats
CREATE TABLE IF NOT EXISTS conversations (
	id         TEXT NOT NULL PRIMARY KEY,  -- slug for channels (e.g. 'class'), uuid for DMs
	type       TEXT NOT NULL CHECK(type IN ('channel', 'dm', 'group')),
	name       TEXT,                        -- display name for channels/groups
	created_by TEXT REFERENCES users(id),
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Members: explicit for DMs and groups; channels are open to all authenticated users
CREATE TABLE IF NOT EXISTS conversation_members (
	conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
	user_id         TEXT NOT NULL REFERENCES users(id),
	joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (conversation_id, user_id)
);

-- Unified archived messages for all conversation types
CREATE TABLE IF NOT EXISTS chat_messages (
	id              TEXT NOT NULL PRIMARY KEY,
	conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
	user_id         TEXT NOT NULL,
	user_name       TEXT NOT NULL,
	user_role       TEXT NOT NULL DEFAULT 'student',
	content         TEXT NOT NULL,
	created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages(conversation_id, created_at);

-- Seed the default class channel
INSERT OR IGNORE INTO conversations (id, type, name, created_at)
VALUES ('class', 'channel', 'class', datetime('now'));

-- Migrate existing class messages into the new table
INSERT OR IGNORE INTO chat_messages (id, conversation_id, user_id, user_name, user_role, content, created_at)
SELECT id, 'class', user_id, user_name, user_role, content, created_at FROM messages;

-- Migrate existing DMs
INSERT OR IGNORE INTO conversations (id, type, name, created_at)
SELECT DISTINCT conversation_id, 'dm', NULL, datetime('now') FROM direct_messages;

INSERT OR IGNORE INTO chat_messages (id, conversation_id, user_id, user_name, user_role, content, created_at)
SELECT id, conversation_id, user_id, user_name, 'student', content, created_at FROM direct_messages;
