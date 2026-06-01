-- Add a column to archive the per-message mentions list so historical
-- messages (synced from Firebase RTDB → Turso by /api/chat/sync) retain
-- their `@user` pill data when the chat page loads from history. Stored
-- as JSON: `[{"uid":"...","offset":...,"len":...}, ...]`.
--
-- Backfill: existing rows get NULL → renders as no mentions, which is
-- correct (they were authored before mentions shipped).

ALTER TABLE chat_messages ADD COLUMN mentions TEXT;
