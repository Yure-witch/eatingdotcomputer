CREATE TABLE IF NOT EXISTS syllabus_blocks (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS syllabus_settings (
  class_id TEXT PRIMARY KEY,
  font TEXT NOT NULL DEFAULT 'Georgia, serif',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
