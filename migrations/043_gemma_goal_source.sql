-- Where a Gemma goal came from: the chat message it was harvested out of.
-- Rendered as a "↗ source" deep link (/app/chat/channel/{conv}?msg={id})
-- on the Gemma page's personal-goals checklist.
ALTER TABLE gemma_goals ADD COLUMN source_conv_id TEXT;
ALTER TABLE gemma_goals ADD COLUMN source_msg_id TEXT;
