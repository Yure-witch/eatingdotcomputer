-- Gemma DM-scan scope (opt-in). Default 0: goal harvesting only reads a
-- student's DM conversations WITH INSTRUCTORS (plus class channels).
-- 1 = the student has opted in to Gemma reading ALL their DMs.
ALTER TABLE users ADD COLUMN gemma_scan_dms INTEGER DEFAULT 0;
