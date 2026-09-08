-- Extra addresses that resolve to an existing account.
--
-- Sign-in has no account-link table: every OAuth provider finds a user by
-- matching `users.email`, so someone who signs up with a school address and
-- later taps "Continue with Google" on a personal one gets a SECOND account
-- with none of their history. That is not a rare edge — it is what a student
-- with a .edu address and a gmail Google account does by default.
--
-- An alias here points a second address at the account that already exists.
-- Nothing writes to `users.email`, so the primary address stays whatever the
-- account was created with and both addresses reach the same person.
--
-- Aliases are NEVER created implicitly by a sign-in — only by an instructor
-- merging two accounts. Auto-linking on a matching name or a similar address
-- would be an account-takeover vector.
CREATE TABLE IF NOT EXISTS user_emails (
	email    TEXT PRIMARY KEY,          -- lowercase; unique across all accounts
	user_id  TEXT NOT NULL,
	added_at TEXT NOT NULL DEFAULT (datetime('now')),
	added_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails (user_id);
