-- Tags for Lab → Inspiration, assigned by Gemma from a fixed vocabulary
-- (see $lib/server/site-tags.js). Comma-separated, in vocabulary order, so
-- filtering is a LIKE away and the chips always render in a stable order.
-- NULL = never tagged; '' = tagged and Gemma found nothing that fit.
ALTER TABLE lab_websites ADD COLUMN tags TEXT;
