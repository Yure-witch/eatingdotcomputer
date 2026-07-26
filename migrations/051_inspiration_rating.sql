-- Like/dislike feedback on inspiration items: 1 liked, -1 disliked, 0 none.
-- Ratings steer future batches (query seeds, per-kind quotas, word blocks).
ALTER TABLE inspiration_items ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
