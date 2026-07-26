-- Mark inspiration items with no legal open-access copy. Paywalled papers
-- get a lock icon and route through Cooper's OpenAthens proxy for
-- institutional access; open-access items link direct.
ALTER TABLE inspiration_items ADD COLUMN paywalled INTEGER NOT NULL DEFAULT 0;
