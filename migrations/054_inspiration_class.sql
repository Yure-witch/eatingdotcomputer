-- Class inspiration feed + per-student reactions to shared items.
--
-- The CLASS feed is one shared set of items (owner_id = 'class:<classId>'
-- in inspiration_items), generated from the syllabus. Every student reacts
-- to the SAME items, so their reactions can't live in the item row —
-- they go here, one per (student, item). The class "algorithm" is the
-- aggregate of these reactions.
CREATE TABLE IF NOT EXISTS inspiration_reactions (
	user_id    TEXT NOT NULL,
	item_id    INTEGER NOT NULL REFERENCES inspiration_items(id) ON DELETE CASCADE,
	rating     INTEGER NOT NULL DEFAULT 0,   -- 1 like, -1 dislike, 0 none
	saved      INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_inspiration_reactions_item ON inspiration_reactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inspiration_reactions_user ON inspiration_reactions(user_id);
