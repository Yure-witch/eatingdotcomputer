-- Telegram special-effect opt-in flag. Set when the sender checked the
-- "special effect" toggle on a jumbo (emoji-only) message containing an
-- av>0 Telegram emote. Compact RTDB field: `tfx: 1`.
ALTER TABLE chat_messages ADD COLUMN tg_fx INTEGER DEFAULT 0;
