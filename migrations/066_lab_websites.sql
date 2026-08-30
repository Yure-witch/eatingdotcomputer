-- Lab → Inspiration: the instructor's curated list of websites and pages.
--
-- Distinct from the `inspiration` feed (Scout/Gemma's per-student
-- recommendations). This one is hand-picked and the same for everyone, which
-- is why it has no per-user reaction columns.
--
-- Previews are CACHED, not hotlinked: `image_key` / `icon_key` point at R2
-- objects we fetched and re-encoded ourselves, so the gallery keeps working
-- when a site reorganises its assets, and a class browsing the page doesn't
-- fan out a request to twenty third parties.
CREATE TABLE IF NOT EXISTS lab_websites (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	url         TEXT NOT NULL UNIQUE,
	title       TEXT,
	description TEXT,
	site_name   TEXT,
	image_key   TEXT,           -- R2 key of the cached preview image
	icon_key    TEXT,           -- R2 key of the cached favicon
	accent      TEXT,           -- dominant colour, for cards with no preview image
	note        TEXT,           -- the instructor's own words about the link
	position    INTEGER NOT NULL DEFAULT 0,  -- paste order is meaningful; keep it
	status      TEXT NOT NULL DEFAULT 'pending', -- pending | ready | failed
	error       TEXT,
	added_by    TEXT,
	created_at  TEXT NOT NULL DEFAULT (datetime('now')),
	fetched_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_lab_websites_order ON lab_websites (position, id);
CREATE INDEX IF NOT EXISTS idx_lab_websites_status ON lab_websites (status);
