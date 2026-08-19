-- Drops the temporary native sign-in diagnostics table from migration 059.
-- It captured raw SDK responses, which turned out to include live OAuth access
-- and refresh tokens — that must not sit in the database.
DROP TABLE IF EXISTS debug_events;
