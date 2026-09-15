-- Instructor notes per student, per session: what they're working on, and a
-- free note.
--
-- A separate table, keyed exactly like attendance, rather than two more
-- columns on it. attendance.status is NOT NULL and a missing row means "not
-- marked" — so if notes lived on that row, writing a note about someone you
-- hadn't marked yet would either be impossible or would invent a mark. Notes
-- and marks are independent: you can note an absent student's project, or mark
-- a student without writing anything.
--
-- Instructor-only. Nothing here is shown to students.
CREATE TABLE IF NOT EXISTS attendance_notes (
	class_id     TEXT NOT NULL,
	session_date TEXT NOT NULL,
	user_id      TEXT NOT NULL,
	working_on   TEXT NOT NULL DEFAULT '',
	note         TEXT NOT NULL DEFAULT '',
	updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
	updated_by   TEXT,
	PRIMARY KEY (class_id, session_date, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_notes_user ON attendance_notes (user_id, session_date);
