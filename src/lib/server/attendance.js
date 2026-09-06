import { getDb } from '$lib/server/turso.js';

// Attendance. See migration 079 for the shape and why there is no sessions
// table.

/** The only statuses that may be stored. Anything else is rejected, not coerced. */
export const STATUSES = ['present', 'late', 'absent', 'excused'];

/** Statuses that count as "they were here" when computing a rate. */
const PRESENT_ISH = new Set(['present', 'late']);

/** YYYY-MM-DD, and only that — this is a date, never a timestamp. */
export const isSessionDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));

/**
 * The roster for one session: every markable student in the class, with the
 * mark they already have (or null), plus their running rate.
 *
 * Shadowbanned members are left out entirely. They are hidden from the class
 * everywhere else, and a register is a list of who is in the room — putting a
 * name on it that no one else can see would be a strange half-state, and
 * marking them absent would count against someone who has been made invisible.
 * Instructors are excluded too: they run the class, they don't attend it.
 */
export async function sessionRoster(classId, sessionDate) {
	const db = getDb();
	if (!db || !classId) return [];

	const rows = (await db.execute({
		sql: `SELECT u.id, u.name, u.email, u.avatar_kind, u.avatar_value,
		             a.status,
		             (SELECT COUNT(*) FROM attendance x
		                WHERE x.user_id = u.id AND x.class_id = ?) AS marked_total,
		             (SELECT COUNT(*) FROM attendance x
		                WHERE x.user_id = u.id AND x.class_id = ?
		                  AND x.status IN ('present','late')) AS marked_here
		      FROM users u
		      JOIN class_memberships cm
		        ON cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		      LEFT JOIN attendance a
		        ON a.user_id = u.id AND a.class_id = ? AND a.session_date = ?
		      WHERE u.role != 'instructor' AND u.shadowbanned = 0
		      ORDER BY u.name ASC`,
		args: [classId, classId, classId, classId, sessionDate]
	})).rows;

	return rows.map((r) => {
		const total = Number(r.marked_total ?? 0);
		const here = Number(r.marked_here ?? 0);
		return {
			id: String(r.id),
			name: String(r.name ?? r.email ?? ''),
			avatarKind: r.avatar_kind ? String(r.avatar_kind) : 'gen',
			avatarValue: r.avatar_value ? String(r.avatar_value) : null,
			status: r.status ? String(r.status) : null,
			sessions: total,
			// null rather than 100% for someone who has never been marked — a
			// student with no history has no rate, and showing a perfect score
			// for it would be a lie the instructor might act on.
			rate: total ? Math.round((here / total) * 100) : null
		};
	});
}

/** Session dates this class has, newest first, with how many are marked. */
export async function sessionDates(classId, limit = 60) {
	const db = getDb();
	if (!db || !classId) return [];
	return (await db.execute({
		sql: `SELECT session_date, COUNT(*) AS marked,
		             SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS here
		      FROM attendance WHERE class_id = ?
		      GROUP BY session_date ORDER BY session_date DESC LIMIT ?`,
		args: [classId, limit]
	})).rows.map((r) => ({
		date: String(r.session_date),
		marked: Number(r.marked ?? 0),
		here: Number(r.here ?? 0)
	}));
}

/**
 * Mark one student. `status` of null clears the mark, which is not the same as
 * marking them absent — see the migration.
 */
export async function mark({ classId, sessionDate, userId, status, markedBy }) {
	const db = getDb();
	if (!db) return;
	if (status === null) {
		await db.execute({
			sql: 'DELETE FROM attendance WHERE class_id = ? AND session_date = ? AND user_id = ?',
			args: [classId, sessionDate, userId]
		});
		return;
	}
	await db.execute({
		sql: `INSERT INTO attendance (class_id, session_date, user_id, status, marked_by)
		      VALUES (?, ?, ?, ?, ?)
		      ON CONFLICT(class_id, session_date, user_id)
		      DO UPDATE SET status = excluded.status, marked_at = datetime('now'), marked_by = excluded.marked_by`,
		args: [classId, sessionDate, userId, status, markedBy ?? null]
	});
}

/**
 * One student's own record, for their profile.
 *
 * Returns null when there is nothing to show — no class, or a shadowbanned
 * account, which is never marked in the first place. The profile renders no
 * attendance section at all in that case rather than an empty one, which would
 * invite "why is mine blank".
 */
export async function attendanceForUser(userId) {
	const db = getDb();
	if (!db || !userId) return null;

	const me = (await db.execute({
		sql: `SELECT u.shadowbanned, cm.class_id
		      FROM users u
		      LEFT JOIN class_memberships cm
		        ON cm.user_id = u.id AND cm.status = 'approved'
		      WHERE u.id = ? LIMIT 1`,
		args: [userId]
	})).rows[0];
	if (!me || Number(me.shadowbanned) === 1) return null;
	const classId = me.class_id ? String(me.class_id) : null;
	if (!classId) return null;

	const rows = (await db.execute({
		sql: `SELECT session_date, status FROM attendance
		      WHERE user_id = ? AND class_id = ?
		      ORDER BY session_date DESC`,
		args: [userId, classId]
	})).rows.map((r) => ({ date: String(r.session_date), status: String(r.status) }));
	if (!rows.length) return null;

	const counts = { present: 0, late: 0, absent: 0, excused: 0 };
	for (const r of rows) if (r.status in counts) counts[r.status] += 1;
	const here = rows.filter((r) => PRESENT_ISH.has(r.status)).length;

	return {
		counts,
		sessions: rows.length,
		rate: Math.round((here / rows.length) * 100),
		// Newest first, capped — the profile shows a recent strip, not a ledger.
		recent: rows.slice(0, 12)
	};
}
