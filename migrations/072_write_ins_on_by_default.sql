-- Write-ins are the normal case, not the exception: a pool people can add to
-- is what this format is for, and an instructor who doesn't want it unticks
-- the box at creation.
--
-- SQLite can't alter a column default in place, and it isn't worth a table
-- rebuild — the create endpoint always writes the column explicitly, so the
-- stored default only ever applied to rows made before this. This turns those
-- on so existing favorites polls behave like new ones. 'full'-format polls are
-- left alone: they can't take write-ins at all.
UPDATE lab_polls SET allow_write_ins = 1 WHERE format = 'favorites' AND status = 'open';
