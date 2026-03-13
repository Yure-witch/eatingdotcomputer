-- Scope core content to a class
ALTER TABLE assignments ADD COLUMN class_id TEXT REFERENCES classes(id);
ALTER TABLE conversations ADD COLUMN class_id TEXT REFERENCES classes(id);

-- Backfill existing content to the initial class
UPDATE assignments SET class_id = 'idc-fall-2026' WHERE class_id IS NULL;
UPDATE conversations SET class_id = 'idc-fall-2026' WHERE class_id IS NULL AND type = 'channel';
