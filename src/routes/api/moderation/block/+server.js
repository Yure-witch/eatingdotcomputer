import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

// User blocking (Guideline 1.2). Self-service: the session user manages
// their OWN block list. Blocking hides the blocked user's messages from the
// blocker (client-side filter in the chat pages) and stops their
// notifications (filtered at fan-out in /api/chat). Instructors and the
// gemma bot cannot be blocked — they moderate / run the class.

export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute({
		sql: `SELECT b.blocked_id, b.created_at, u.name
		      FROM blocked_users b LEFT JOIN users u ON u.id = b.blocked_id
		      WHERE b.blocker_id = ?
		      ORDER BY b.created_at DESC`,
		args: [session.user.id]
	});
	return json({
		blocked: result.rows.map((r) => ({
			userId: String(r.blocked_id),
			name: r.name ? String(r.name) : 'Deleted user',
			createdAt: String(r.created_at)
		}))
	});
}

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const body = await request.json().catch(() => null);
	const targetId = String(body?.userId ?? '');
	if (!targetId) error(400, 'Missing userId');
	if (targetId === session.user.id) error(400, 'You cannot block yourself');
	if (targetId === 'gemma') error(400, 'Gemma cannot be blocked');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const target = await db.execute({ sql: 'SELECT role FROM users WHERE id = ?', args: [targetId] });
	if (!target.rows[0]) error(404, 'User not found');
	if (String(target.rows[0].role) === 'instructor') error(400, 'Instructors cannot be blocked — use Report instead');

	await db.execute({
		sql: 'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)',
		args: [session.user.id, targetId]
	});
	return json({ ok: true });
}

export async function DELETE({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const body = await request.json().catch(() => null);
	const targetId = String(body?.userId ?? '');
	if (!targetId) error(400, 'Missing userId');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	await db.execute({
		sql: 'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
		args: [session.user.id, targetId]
	});
	return json({ ok: true });
}
