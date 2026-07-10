-- Username sign-in (nullable; unique when set) + per-user flag to hide
-- Telegram emoji surfaces (used for the App Store review account).
ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

ALTER TABLE users ADD COLUMN hide_tg_emoji INTEGER NOT NULL DEFAULT 0;
