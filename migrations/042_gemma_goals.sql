-- Personal goals harvested by the Gemma digest: statements of intent in a
-- user's own chat messages ("I want to make…", "I plan to study…") become
-- checkbox items on the Gemma page — a personal list, distinct from the
-- assignment-fueled action items. Deduped per user by label.
CREATE TABLE IF NOT EXISTS gemma_goals (
	id         TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL,
	label      TEXT NOT NULL,
	source     TEXT DEFAULT 'chat',
	done       INTEGER DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	done_at    TEXT,
	UNIQUE(user_id, label)
);
