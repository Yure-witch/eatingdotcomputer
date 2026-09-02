-- Richer link previews: enough to draw a card, not just a title.
--
-- The table already cached og:title for the composer's link chip. A Spotify
-- track needs the artwork and the "artist · album · year" line too, and every
-- other link gets the same treatment for free.
ALTER TABLE link_previews ADD COLUMN description TEXT;
ALTER TABLE link_previews ADD COLUMN image       TEXT;
ALTER TABLE link_previews ADD COLUMN site_name   TEXT;
