-- "Left early" is a flag, not a status.
--
-- It can't be a fifth value of `status`, because it isn't exclusive with the
-- others: a student can arrive late AND leave early (the case that prompted
-- this — Isaiah, 2026-09-10, late, gone after an hour). As a status he could
-- only be one of the two, and the register would lose half of what happened.
--
-- Only meaningful alongside 'present' or 'late' — you can't leave a session
-- you weren't at. The app clears it whenever a mark moves to absent/excused.
ALTER TABLE attendance ADD COLUMN left_early INTEGER NOT NULL DEFAULT 0;
