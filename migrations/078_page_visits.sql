-- Visit counts for the public install pages (/androidpwa, /iosapp,
-- /pwadesktop). Aggregated per path per day rather than a row per hit: the
-- question is "how many people are we sending here and is it working", which a
-- counter answers, and a per-visit log of pages that anyone on the internet can
-- open would collect visitor data we have no reason to hold.
--
-- Deliberately no IP, no user agent, no referrer, and no user id — these pages
-- are reachable signed out, so there is often no user to attribute anyway.
CREATE TABLE IF NOT EXISTS page_visits (
	path   TEXT NOT NULL,
	day    TEXT NOT NULL,           -- YYYY-MM-DD, UTC
	visits INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (path, day)
);
CREATE INDEX IF NOT EXISTS idx_page_visits_day ON page_visits (day);
