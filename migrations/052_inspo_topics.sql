-- Inspiration search topics: user-editable override of users.interests
-- for the Inspiration feed. Empty → falls back to interests.
ALTER TABLE users ADD COLUMN inspo_topics TEXT;
