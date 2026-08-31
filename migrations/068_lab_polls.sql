-- Lab → Rank It: ranked polls. The instructor writes a list of things, the
-- class drags them into their own order, and the results are the class's
-- collective ordering.
--
-- A ballot is stored as ONE row holding the whole ordering, not a row per
-- (item, rank). A ranking is only meaningful as a complete list — half a
-- ballot is not half an opinion — so keeping it atomic means a resubmit is
-- one UPSERT and there is no way to end up with a partially-written ballot.
CREATE TABLE IF NOT EXISTS lab_polls (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	title      TEXT NOT NULL,
	prompt     TEXT,                              -- the instructions above the list
	status     TEXT NOT NULL DEFAULT 'open',      -- open | closed
	-- When students may see the tally. 'closed' keeps the room from anchoring
	-- on the running order while they are still ranking; 'always' is for when
	-- watching it move together is the point.
	reveal     TEXT NOT NULL DEFAULT 'closed',    -- closed | always
	created_by TEXT,
	-- Recorded for provenance and future per-class filtering. Not filtered on
	-- today: Lab tools are one shared surface (see lab_websites), and the
	-- instructor picks which poll to run.
	class_id   TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	closed_at  TEXT
);

CREATE TABLE IF NOT EXISTS lab_poll_items (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	poll_id  INTEGER NOT NULL REFERENCES lab_polls (id) ON DELETE CASCADE,
	label    TEXT NOT NULL,
	-- The order the instructor typed them in. Ballots are SHUFFLED from this
	-- for each student, so nobody's ranking is nudged by the list order.
	position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lab_poll_items_poll ON lab_poll_items (poll_id, position, id);

CREATE TABLE IF NOT EXISTS lab_poll_ballots (
	poll_id      INTEGER NOT NULL REFERENCES lab_polls (id) ON DELETE CASCADE,
	user_id      TEXT NOT NULL,
	-- JSON array of item ids, best first. Ids the poll no longer has are
	-- ignored at read time, so editing a poll's items never corrupts a ballot.
	ranking      TEXT NOT NULL,
	submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_poll_ballots_poll ON lab_poll_ballots (poll_id);
