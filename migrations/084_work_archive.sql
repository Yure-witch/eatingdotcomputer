-- Work Archive: students' AI agents upload an exhaustive record of everything
-- the student made (manifest.json + images/media) so the instructor has a
-- documentation repository for reporting and funding.
--
-- Protocol: static/work-archive/PROTOCOL.md (served at
-- https://www.eating.computer/work-archive/PROTOCOL.md).
--
-- No REFERENCES users(id) on purpose: account deletion enumerates its tables,
-- and an FK here would block it. delete-account cleans these up explicitly.

-- Personal upload tokens. An agent outside the browser has no session cookie,
-- so the student mints a token in /app/archive and hands it to their agent.
-- Only the SHA-256 of the token is stored. One live token per user: minting a
-- new one revokes the old. A token can ONLY create/upload/complete the owner's
-- own archive submissions — never read class data or mint more tokens.
CREATE TABLE IF NOT EXISTS archive_tokens (
	id           TEXT NOT NULL PRIMARY KEY,
	user_id      TEXT NOT NULL,
	token_hash   TEXT NOT NULL UNIQUE,
	last4        TEXT NOT NULL,
	created_at   TEXT NOT NULL DEFAULT (datetime('now')),
	expires_at   TEXT NOT NULL,
	last_used_at TEXT,
	revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_archive_tokens_user ON archive_tokens(user_id);

-- One row per upload attempt. Every submission is a FULL snapshot (never a
-- patch), so the newest complete one per student is their archive and older
-- ones are history. `open` = files still arriving; `complete` = the manifest
-- passed validation and every referenced file is in R2.
CREATE TABLE IF NOT EXISTS archive_submissions (
	id            TEXT NOT NULL PRIMARY KEY,
	user_id       TEXT NOT NULL,
	class_id      TEXT,
	status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','complete')),
	via           TEXT NOT NULL DEFAULT 'token',  -- 'token' (agent) | 'browser'
	agent         TEXT,                           -- self-reported by the uploader
	created_at    TEXT NOT NULL DEFAULT (datetime('now')),
	completed_at  TEXT,
	project_count INTEGER NOT NULL DEFAULT 0,
	idea_count    INTEGER NOT NULL DEFAULT 0,
	asset_count   INTEGER NOT NULL DEFAULT 0,
	total_bytes   INTEGER NOT NULL DEFAULT 0,
	digest        TEXT,  -- JSON: names, consent, project titles — for the roster without an R2 read
	last_report   TEXT   -- JSON: errors/warnings from the most recent /complete attempt
);
CREATE INDEX IF NOT EXISTS idx_archive_submissions_user ON archive_submissions(user_id, status, completed_at);

-- Files in a submission. Rows are written at presign time and reconciled
-- against the actual R2 listing on /complete (uploaded=1, real size).
CREATE TABLE IF NOT EXISTS archive_assets (
	submission_id TEXT NOT NULL,
	path          TEXT NOT NULL,  -- relative to the archive root, e.g. images/my-project/01-hero.png
	r2_key        TEXT NOT NULL,
	content_type  TEXT NOT NULL,
	kind          TEXT NOT NULL,  -- image | video | pdf | text | manifest
	size          INTEGER NOT NULL DEFAULT 0,
	sha256        TEXT,
	uploaded      INTEGER NOT NULL DEFAULT 0,
	created_at    TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (submission_id, path)
);
