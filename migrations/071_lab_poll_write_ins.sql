-- Lab → Rank It: let participants add their own things to the pool.
--
-- Only meaningful in the 'favorites' format. A 'full' ballot has to be a
-- COMPLETE ordering of the pool, so adding an item mid-session would make
-- every ballot already cast incomplete; a 'favorites' ballot is partial by
-- design and absorbs a new item without invalidating anything.
ALTER TABLE lab_polls ADD COLUMN allow_write_ins INTEGER NOT NULL DEFAULT 0;

-- Who added it. NULL = the instructor typed it when the pool was created.
-- The name is DENORMALISED on purpose: a QR guest has no users row to join
-- against, and the instructor needs to see whose suggestion this was in order
-- to decide whether to keep it.
ALTER TABLE lab_poll_items ADD COLUMN added_by      TEXT;
ALTER TABLE lab_poll_items ADD COLUMN added_by_name TEXT;
