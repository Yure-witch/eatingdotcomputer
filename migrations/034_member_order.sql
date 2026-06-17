-- Per-user, cross-device ordering of the members list in chat (drag & drop).
-- Stored as a JSON array of user ids. Null = default (server) order.
ALTER TABLE users ADD COLUMN member_order TEXT;
