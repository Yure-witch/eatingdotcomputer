CREATE TABLE IF NOT EXISTS custom_emoji (
  id TEXT PRIMARY KEY,
  shortcode TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  tags TEXT DEFAULT '',
  created_by_id TEXT,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reaction_images (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  tags TEXT DEFAULT '',
  created_by_id TEXT,
  created_by_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
