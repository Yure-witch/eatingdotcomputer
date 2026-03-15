CREATE TABLE IF NOT EXISTS starred_messages (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id             TEXT NOT NULL,
    message_id          TEXT NOT NULL,
    conv_id             TEXT NOT NULL,
    conv_name           TEXT,
    content             TEXT,
    author_name         TEXT,
    author_id           TEXT,
    attachment_url      TEXT,
    attachment_filename TEXT,
    attachment_mimetype TEXT,
    starred_at          DATETIME DEFAULT (datetime('now')),
    UNIQUE(user_id, message_id)
);

ALTER TABLE chat_messages ADD COLUMN is_edited INTEGER DEFAULT 0;
