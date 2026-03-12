-- Profile fields on users
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN pronouns TEXT;
ALTER TABLE users ADD COLUMN website TEXT;
ALTER TABLE users ADD COLUMN onboarding_step TEXT NOT NULL DEFAULT 'profile';

-- Grandfather existing users so they aren't locked out
UPDATE users SET onboarding_step = 'complete' WHERE onboarding_step = 'profile';

-- Classes
CREATE TABLE IF NOT EXISTS classes (
  id          TEXT NOT NULL PRIMARY KEY,
  name        TEXT NOT NULL,
  term        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO classes (id, name, term, description)
VALUES ('idc-fall-2026', 'Interactive Design Concepts', 'Fall 2026',
        'An introductory course exploring the principles and practice of interactive design.');

-- Class memberships
CREATE TABLE IF NOT EXISTS class_memberships (
  id           TEXT NOT NULL PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT,
  reviewed_by  TEXT REFERENCES users(id),
  UNIQUE(class_id, user_id)
);
