CREATE TABLE IF NOT EXISTS notifications_sent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'inactive_reminder',
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, assignment_id, type)
);
