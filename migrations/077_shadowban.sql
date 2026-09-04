-- Shadowban: the account keeps working normally for its owner — they can sign
-- in, post, react, and see their own messages exactly as before — but everyone
-- else stops seeing them and everything they produce.
--
-- Distinct from blocked_users, which is per-viewer and self-service. This is
-- class-wide and set by an instructor. Filtering happens in the API layer and
-- in the chat clients (chat content lives in RTDB, which clients read directly),
-- so treat this as a UI-level hide, NOT a security boundary.
ALTER TABLE users ADD COLUMN shadowbanned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_shadowbanned ON users (shadowbanned) WHERE shadowbanned = 1;
