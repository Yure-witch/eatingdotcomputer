CREATE TABLE IF NOT EXISTS uploaded_files (
	id               TEXT NOT NULL PRIMARY KEY,
	url              TEXT NOT NULL,
	r2_key           TEXT NOT NULL,
	filename         TEXT NOT NULL,
	mimetype         TEXT NOT NULL,
	size             INTEGER NOT NULL,
	uploaded_by_id   TEXT NOT NULL,
	uploaded_by_name TEXT NOT NULL,
	uploaded_at      TEXT NOT NULL DEFAULT (datetime('now')),
	context_type     TEXT NOT NULL CHECK(context_type IN ('channel', 'dm')),
	context_id       TEXT NOT NULL,
	class_id         TEXT
);

CREATE INDEX IF NOT EXISTS uploaded_files_class_idx ON uploaded_files(class_id, context_type);
CREATE INDEX IF NOT EXISTS uploaded_files_context_idx ON uploaded_files(context_type, context_id);
