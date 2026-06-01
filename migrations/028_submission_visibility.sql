-- Add submission visibility toggles
ALTER TABLE week_plans ADD COLUMN show_submissions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE week_items ADD COLUMN show_submissions INTEGER;
