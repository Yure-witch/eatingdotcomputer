import { getDb } from './turso.js';
import { notifyUsers } from './push.js';

/**
 * Send push reminders to students who haven't been active since their class's
 * most recent assignment was posted (minimum 3 days ago).
 * Deduped via the notifications_sent table.
 */
export async function notifyInactiveStudents() {
	const db = getDb();
	if (!db) return;

	const assignments = await db.execute(`
		SELECT a.id, a.class_id, a.title, a.created_at
		FROM assignments a
		WHERE a.created_at <= datetime('now', '-3 days')
		  AND a.created_at >= datetime('now', '-30 days')
	`);

	if (!assignments.rows.length) return;

	for (const assignment of assignments.rows) {
		const assignmentId = String(assignment.id);
		const classId = String(assignment.class_id);
		const title = String(assignment.title);
		const postedAt = String(assignment.created_at);

		const inactive = await db.execute({
			sql: `
				SELECT u.id
				FROM users u
				JOIN class_memberships cm ON cm.user_id = u.id AND cm.class_id = ? AND cm.status = 'approved'
				WHERE u.role = 'student'
				  AND NOT EXISTS (
				        SELECT 1 FROM user_activity ua
				        WHERE ua.user_id = u.id AND ua.logged_at >= ?
				      )
				  AND NOT EXISTS (
				        SELECT 1 FROM notifications_sent ns
				        WHERE ns.user_id = u.id AND ns.assignment_id = ? AND ns.type = 'inactive_reminder'
				      )
			`,
			args: [classId, postedAt, assignmentId]
		});

		if (!inactive.rows.length) continue;

		const userIds = inactive.rows.map((r) => String(r.id));

		await notifyUsers(userIds, {
			title: 'New assignment posted',
			body: `"${title}" is waiting for you`,
			url: '/app',
			tag: `assignment-${assignmentId}`
		});

		for (const uid of userIds) {
			await db.execute({
				sql: `INSERT OR IGNORE INTO notifications_sent (id, user_id, assignment_id, type)
				      VALUES (?, ?, ?, 'inactive_reminder')`,
				args: [crypto.randomUUID(), uid, assignmentId]
			});
		}
	}
}
