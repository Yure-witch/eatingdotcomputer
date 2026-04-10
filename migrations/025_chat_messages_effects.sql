ALTER TABLE chat_messages ADD COLUMN fx          TEXT;
ALTER TABLE chat_messages ADD COLUMN font_size   REAL;
ALTER TABLE chat_messages ADD COLUMN font_weight INTEGER;
ALTER TABLE chat_messages ADD COLUMN font_stretch REAL;
ALTER TABLE chat_messages ADD COLUMN no_split    INTEGER DEFAULT 0;
