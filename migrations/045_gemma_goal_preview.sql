-- Goal source previews + congratulations.
--   source_text   — full text of the message the goal was harvested from
--   source_quote  — the exact span the model grounded the goal in (rendered
--                   highlighted inside the preview on the Gemma page)
--   congratulated — 1 once a digest has celebrated this completed goal, so
--                   the model congratulates exactly once
ALTER TABLE gemma_goals ADD COLUMN source_text TEXT;
ALTER TABLE gemma_goals ADD COLUMN source_quote TEXT;
ALTER TABLE gemma_goals ADD COLUMN congratulated INTEGER DEFAULT 0;
