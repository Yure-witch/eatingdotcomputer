-- Attendance, one row per (class, session, student).
--
-- There is no separate "sessions" table on purpose: the distinct session_date
-- values in here ARE the list of sessions the class has held. Marking someone
-- creates the session; nothing has to be scheduled in advance, which matches
-- how the instructor actually works (open Manage on the day, mark the room).
--
-- A MISSING row is meaningfully different from 'absent': it means nobody was
-- marked, not that the student wasn't there. Rates are computed over rows that
-- exist, so an unfinished session never counts against anyone.
CREATE TABLE IF NOT EXISTS attendance (
	class_id     TEXT NOT NULL,
	session_date TEXT NOT NULL,            -- YYYY-MM-DD, the class's own day
	user_id      TEXT NOT NULL,
	status       TEXT NOT NULL,            -- present | late | absent | excused
	marked_at    TEXT NOT NULL DEFAULT (datetime('now')),
	marked_by    TEXT,
	PRIMARY KEY (class_id, session_date, user_id)
);
-- The profile page asks "everything for this student"; Manage asks "everyone
-- for this date". One index each.
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance (user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance (class_id, session_date);
