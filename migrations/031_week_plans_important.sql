-- Flag a week_plan as "important" — midterms, finals, milestone
-- crits, etc. The /app/weeks progress rail surfaces these as
-- larger / more prominent dots so students can see at a glance
-- which weeks carry extra weight.
ALTER TABLE week_plans ADD COLUMN important INTEGER NOT NULL DEFAULT 0;
