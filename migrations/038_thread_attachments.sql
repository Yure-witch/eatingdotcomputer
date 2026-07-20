-- Thread replies can carry attachments (images/files via R2), same columns
-- as chat_messages. Live shape: msg.att = { url, name, type, size }.
ALTER TABLE thread_messages ADD COLUMN attachment_url      TEXT;
ALTER TABLE thread_messages ADD COLUMN attachment_filename TEXT;
ALTER TABLE thread_messages ADD COLUMN attachment_mimetype TEXT;
ALTER TABLE thread_messages ADD COLUMN attachment_size     INTEGER;
