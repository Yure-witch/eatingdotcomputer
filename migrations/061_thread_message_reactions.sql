-- Reactions on THREAD replies.
--
-- message_reactions can't carry these: its message_id is a foreign key into
-- chat_messages, and thread replies live in thread_messages. Same shape,
-- pointed at the right table.
--
-- Firebase holds live thread reactions at threads/{convId}/{parentId}/reactions;
-- this is where they land once /api/chat/sync archives the reply out of RTDB,
-- so a reaction outlives the 24h live window like every other one does.
CREATE TABLE IF NOT EXISTS thread_message_reactions (
	message_id TEXT NOT NULL REFERENCES thread_messages(id) ON DELETE CASCADE,
	emoji      TEXT NOT NULL,
	user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (message_id, emoji, user_id)
);

CREATE INDEX IF NOT EXISTS thread_message_reactions_msg_idx
	ON thread_message_reactions(message_id);
