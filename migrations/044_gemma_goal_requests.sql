-- Requests-to-you as goals: "Can you…" / "Will you…" from OTHER people (in
-- your DMs or aimed at you in channels), and your own acknowledgments ("I
-- can do that"), harvest as todos annotated with who asked.
--   requested_by — display name of the requester (null = self-stated goal)
--   source_kind  — 'channel' | 'dm', so the source deep link routes right
ALTER TABLE gemma_goals ADD COLUMN requested_by TEXT;
ALTER TABLE gemma_goals ADD COLUMN source_kind TEXT DEFAULT 'channel';
