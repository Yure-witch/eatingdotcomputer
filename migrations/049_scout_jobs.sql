-- Scout: web-research worker that runs on the kahan box and polls the app
-- for jobs (outbound HTTPS only — kahan's inbound ports are firewalled).
-- The app enqueues searches (e.g. student interests), the worker scrapes
-- are.na / Wikipedia and posts results back; Gemma digests read them.
CREATE TABLE IF NOT EXISTS scout_jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	kind TEXT NOT NULL DEFAULT 'search',
	query TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | error
	result TEXT,                            -- JSON: [{title,url,snippet,source,image}]
	error TEXT,
	requested_by TEXT,
	created_at TEXT DEFAULT (datetime('now')),
	updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scout_jobs_status ON scout_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scout_jobs_lookup ON scout_jobs(kind, query, status, updated_at);

-- Tiny key/value store for worker heartbeat + counters.
CREATE TABLE IF NOT EXISTS scout_state (
	k TEXT PRIMARY KEY,
	v TEXT
);
