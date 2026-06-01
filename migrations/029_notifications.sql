-- Notifications: durable archive of @mentions and replies. Live entries
-- land in Firebase RTDB under `notifications/{uid}/{notifId}` for instant
-- UI updates; the existing /api/chat/sync cron archives entries older
-- than 24h into this table and deletes them from RTDB (same pattern as
-- chat messages + reactions).
--
-- Read state lives in Firebase only: `notifReadAt/{uid}` = ms timestamp.
-- Anything with `created_at` > that value counts as unread for the bell
-- badge. No `read_at` column here — keeps writes cheap and matches the
-- existing chat-unread mechanism (`lastRead/{uid}/{convId}`).

CREATE TABLE IF NOT EXISTS notifications (
	id            TEXT PRIMARY KEY,
	recipient_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	type          TEXT NOT NULL,  -- 'mention' | 'reply'
	from_uid      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	from_name     TEXT NOT NULL,
	conv_type     TEXT NOT NULL,  -- 'channel' | 'dm'
	conv_id       TEXT NOT NULL,
	msg_id        TEXT NOT NULL,
	snippet       TEXT NOT NULL,
	created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
	ON notifications(recipient_id, created_at DESC);
