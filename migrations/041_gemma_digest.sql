-- Gemma daily digest (opt-in).
--   users.gemma_digest — 1 = user opted into the daily Gemma digest DM.
--     For instructors this doubles as the class master switch: the cron only
--     runs for a class when at least one of its instructors has opted in.
--   users.interests — instructor-entered interests / goals for a student,
--     fed to Gemma so the digest can suggest inspiration.
-- Also seeds the Gemma bot user row: server-side digest DMs are written as
-- this user (dms/{convId} with u='gemma'), and /api/chat/sync resolves
-- names from this table at archive time. Not a class member, so it never
-- appears in rosters (member queries are membership-scoped).
ALTER TABLE users ADD COLUMN gemma_digest INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN interests TEXT;
INSERT OR IGNORE INTO users (id, email, name, role) VALUES ('gemma', 'gemma@eating.computer', 'Gemma', 'student');
