-- Slack-style threads: replies branch off a parent chat message.
-- Live replies sit in Firebase RTDB at threads/{convId}/{parentMsgId}/messages
-- (compact { u, c } shape, push-ID timestamps — same contract as channel/DM
-- messages) and are archived here by /api/chat/sync after 24h.
CREATE TABLE IF NOT EXISTS thread_messages (
	id              TEXT NOT NULL PRIMARY KEY,
	parent_msg_id   TEXT NOT NULL,
	conversation_id TEXT NOT NULL,
	user_id         TEXT NOT NULL,
	user_name       TEXT NOT NULL,
	user_role       TEXT NOT NULL DEFAULT 'student',
	content         TEXT NOT NULL,
	created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS thread_messages_parent_idx ON thread_messages(parent_msg_id, created_at);
CREATE INDEX IF NOT EXISTS thread_messages_conv_idx ON thread_messages(conversation_id, created_at);
