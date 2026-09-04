import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { notifyUsers } from '$lib/server/push.js';

// User blocking (Guideline 1.2). Self-service: the session user manages
// their OWN block list. Blocking hides the blocked user's messages from the
// blocker (client-side filter in the chat pages) and stops their
// notifications (filtered at fan-out in /api/chat). Instructors and the
// gemma bot cannot be blocked — they moderate / run the class.
//
// Guideline 1.2 also requires that "blocking should notify the developer of
// the inappropriate content", so a NEW block files a row into the same
// moderation queue reports use (with a snapshot of the message the block was
// made from, when there is one) and pushes to the instructors.

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

	// Shadowbanned accounts ride along in a SEPARATE list. The chat clients
	// merge `hidden` into the same filter they apply to `blocked`, but the
	// "Blocked users" UI only ever renders `blocked` — listing a shadowbanned
	// user there would announce the shadowban to everyone in the class.
	//
	// Two people are never given the list: the shadowbanned user themself
	// (the whole point is that nothing looks different to them) and
	// instructors (they moderate, so they keep seeing what they are moderating).
	let hidden = [];
	if (String(session.user.role ?? '') !== 'instructor') {
		const banned = await db.execute({
			sql: 'SELECT id FROM users WHERE shadowbanned = 1 AND id != ?',
			args: [session.user.id]
		});
		hidden = banned.rows.map((r) => String(r.id));
	}

	return json({
		blocked: result.rows.map((r) => ({
			userId: String(r.blocked_id),
			name: r.name ? String(r.name) : 'Deleted user',
			createdAt: String(r.created_at)
		})),
		hidden
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

	const target = await db.execute({ sql: 'SELECT role, name FROM users WHERE id = ?', args: [targetId] });
	if (!target.rows[0]) error(404, 'User not found');
	if (String(target.rows[0].role) === 'instructor') error(400, 'Instructors cannot be blocked — use Report instead');

	const inserted = await db.execute({
		sql: 'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)',
		args: [session.user.id, targetId]
	});

	// Surface the block to the moderator (only for a NEW block — re-blocks
	// shouldn't refile). Chat pages pass the message the block was made from
	// so the queue shows what prompted it; the block itself is already saved,
	// so nothing past this point may fail the request.
	if (Number(inserted.rowsAffected ?? 0) > 0) {
		const blockerName = String(session.user.name ?? session.user.username ?? '');
		const targetName = String(target.rows[0].name ?? '');
		try {
			await db.execute({
				sql: `INSERT INTO message_reports
				      (id, message_id, conversation_id, message_content, message_user_id, message_user_name, reporter_id, reporter_name, reason)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					crypto.randomUUID(),
					String(body?.messageId ?? `block:${targetId}`),
					String(body?.convId ?? 'block'),
					String(body?.content ?? '').slice(0, 4000),
					targetId,
					targetName.slice(0, 200),
					session.user.id,
					blockerName.slice(0, 200),
					`Blocked this user`
				]
			});
		} catch { /* queue row is best-effort */ }
		try {
			const instructors = await db.execute(`SELECT id FROM users WHERE role = 'instructor'`);
			const ids = instructors.rows.map((r) => String(r.id)).filter((uid) => uid !== session.user.id);
			if (ids.length) {
				await notifyUsers(ids, {
					title: 'User blocked',
					body: `${blockerName || 'A member'} blocked ${targetName || 'a member'}`,
					url: '/app/manage',
					tag: 'report'
				});
			}
		} catch { /* push is best-effort */ }
	}
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
