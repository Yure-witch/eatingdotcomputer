-- Class enrollment window. The instructor toggles this on/off from
-- /manage and (optionally) sets a date range; the student
-- onboarding/class picker only lists classes whose enrollment is
-- open AND we're currently inside the window. Without this, every
-- class in the DB (Fall 2026, Fall 2027, …) showed up forever, which
-- isn't what we want once a term is over or hasn't started yet.
--
-- enrollment_open  — master switch. 0 = always hidden, 1 = visible
--                    within the window below.
-- enrollment_start / enrollment_end — ISO date strings (YYYY-MM-DD).
--                    NULL on either side means "no lower / upper
--                    bound", so leaving both NULL with enrollment_open=1
--                    gives an open-ended enrollment.
ALTER TABLE classes ADD COLUMN enrollment_open  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE classes ADD COLUMN enrollment_start TEXT;
ALTER TABLE classes ADD COLUMN enrollment_end   TEXT;
