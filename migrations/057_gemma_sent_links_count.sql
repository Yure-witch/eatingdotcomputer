-- How many times a link has been DM'd this user. A brand-new link is always
-- preferred, but the single best-fit find (Scout's top result) may repeat once
-- — so a standout can carry two days running, capped at 2 (never 5).
ALTER TABLE gemma_sent_links ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 1;
