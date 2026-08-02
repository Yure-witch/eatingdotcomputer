-- Task prioritisation. Gemma auto-ranks a user's open tasks (writing
-- `priority`, higher = more important) so the daily digest can nudge the
-- single top one. `priority_locked` = the user pinned it themselves, so
-- Gemma's ranker leaves it alone and it sorts above the auto-ranked ones.
ALTER TABLE gemma_goals ADD COLUMN priority REAL NOT NULL DEFAULT 0;
ALTER TABLE gemma_goals ADD COLUMN priority_locked INTEGER NOT NULL DEFAULT 0;
