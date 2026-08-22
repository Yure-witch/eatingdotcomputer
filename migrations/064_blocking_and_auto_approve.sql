-- User blocking (App Store Guideline 1.2: UGC apps must let users block
-- abusive users, separate from reporting). One row per (blocker, blocked);
-- the blocker stops seeing the blocked user's messages and stops receiving
-- their notifications. Instructors and the gemma bot cannot be blocked
-- (enforced in the API — they moderate / run the class).
CREATE TABLE IF NOT EXISTS blocked_users (
	blocker_id  TEXT NOT NULL,
	blocked_id  TEXT NOT NULL,
	created_at  TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users (blocked_id);

-- Demo/test-environment classes: a pending join request auto-approves a few
-- seconds after it is filed (the pending screen drives it), so the App Store
-- reviewer can record the full registration -> approval -> accepted flow
-- without a human instructor on call. Real classes keep manual approval.
ALTER TABLE classes ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;
UPDATE classes SET auto_approve = 1 WHERE id = 'idc-review';
-- The review class must be pickable at sign-up for the demo to be recordable.
UPDATE classes SET enrollment_open = 1, enrollment_start = NULL, enrollment_end = NULL WHERE id = 'idc-review';
