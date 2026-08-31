-- Lab → Rank It: a second format.
--
-- 'full'      — drag the whole list into order (what this started as).
-- 'favorites' — pick and rank your favorites AND your least favorites out of a
--               named pool, at least N of each, as many more as you like, and
--               leave anything you have no feeling about unranked.
--
-- The second one exists because a pool of twenty things has no honest total
-- ordering in anyone's head: people know their top few and their bottom few
-- and are guessing in the middle. Asking only for the ends collects the part
-- that's real.
ALTER TABLE lab_polls ADD COLUMN format TEXT NOT NULL DEFAULT 'full';

-- Floors, not quotas: rank more than this if you want to.
ALTER TABLE lab_polls ADD COLUMN min_favorites INTEGER NOT NULL DEFAULT 3;
ALTER TABLE lab_polls ADD COLUMN min_least     INTEGER NOT NULL DEFAULT 3;

-- The favorites half of a ballot stays in `ranking` (so one column means "the
-- list they ranked best-first" in both formats, and every existing ballot
-- keeps its meaning); the least-favorites half lands here, worst-LAST, i.e.
-- also best-first within its own bucket. NULL in 'full' format.
ALTER TABLE lab_poll_ballots ADD COLUMN ranking_least TEXT;
