ALTER TABLE chat_messages ADD COLUMN attachment_url      TEXT;
ALTER TABLE chat_messages ADD COLUMN attachment_filename TEXT;
ALTER TABLE chat_messages ADD COLUMN attachment_mimetype TEXT;
ALTER TABLE chat_messages ADD COLUMN attachment_size     INTEGER;
