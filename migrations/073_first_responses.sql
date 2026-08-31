-- Keep each person's FIRST answer, not just their current one.
--
-- The two are different measurements. The first is what they thought before
-- the room's tally was in front of them; everything after is a revision made
-- with that tally visible. Overwriting the first loses the only uninfluenced
-- reading the poll will ever get — you cannot reconstruct it later.
--
-- Written once, on INSERT, and never touched again: the UPSERT's DO UPDATE
-- clause deliberately does not mention these columns.
ALTER TABLE lab_poll_ballots ADD COLUMN first_ranking       TEXT;
ALTER TABLE lab_poll_ballots ADD COLUMN first_ranking_least TEXT;
ALTER TABLE lab_poll_ballots ADD COLUMN first_at            TEXT;

-- Ballots cast before this existed: their current answer is the best available
-- evidence of what they first said, and leaving it NULL would read as "never
-- answered" rather than "we weren't recording that yet".
UPDATE lab_poll_ballots
   SET first_ranking       = ranking,
       first_ranking_least = ranking_least,
       first_at            = submitted_at
 WHERE first_ranking IS NULL;
