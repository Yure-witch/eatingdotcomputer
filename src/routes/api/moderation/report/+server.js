import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { notifyUsers } from '$lib/server/push.js';

// User-facing message reporting (Guideline 1.2). POST files a report (any
// authenticated member), GET lists them and PATCH resolves/reopens them
// (instructor only). Reviewed in Manage → Moderation.

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	if (!body?.messageId || !body?.convId) error(400, 'Missing messageId or convId');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	// One open report per (message, reporter) — repeat taps shouldn't pile up rows.
	const existing = await db.execute({
		sql: `SELECT id FROM message_reports WHERE message_id = ? AND reporter_id = ? AND status = 'open'`,
		args: [String(body.messageId), session.user.id]
	});
	if (existing.rows[0]) return json({ ok: true, id: String(existing.rows[0].id), duplicate: true });

	const id = crypto.randomUUID();
	await db.execute({
		sql: `INSERT INTO message_reports
		      (id, message_id, conversation_id, message_content, message_user_id, message_user_name, reporter_id, reporter_name, reason)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			id,
			String(body.messageId),
			String(body.convId),
			String(body.content ?? '').slice(0, 4000),
			String(body.authorId ?? ''),
			String(body.authorName ?? '').slice(0, 200),
			session.user.id,
			String(session.user.name ?? session.user.username ?? '').slice(0, 200),
			String(body.reason ?? '').slice(0, 1000)
		]
	});

	// Let the instructors know a report is waiting; the report itself is already
	// safely stored, so a push failure must never fail the request.
	try {
		const instructors = await db.execute(`SELECT id FROM users WHERE role = 'instructor'`);
		const ids = instructors.rows.map((r) => String(r.id)).filter((uid) => uid !== session.user.id);
		if (ids.length) {
			await notifyUsers(ids, {
				title: 'Message reported',
				body: `${session.user.name ?? 'A member'} reported a message`,
				url: '/app/manage',
				tag: 'report'
			});
		}
	} catch { /* report is stored; notification is best-effort */ }

	return json({ ok: true, id });
}

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const status = url.searchParams.get('status');
	const result = await db.execute({
		sql: `SELECT id, message_id, conversation_id, message_content, message_user_id, message_user_name,
		             reporter_id, reporter_name, reason, status, created_at, resolved_at
		      FROM message_reports
		      ${status ? 'WHERE status = ?' : ''}
		      ORDER BY (status = 'open') DESC, created_at DESC
		      LIMIT 200`,
		args: status ? [status] : []
	});
	return json({ reports: result.rows });
}

export async function PATCH({ request, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const body = await request.json().catch(() => null);
	if (!body?.id || !['open', 'resolved'].includes(body.status)) error(400, 'Missing id or bad status');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	await db.execute({
		sql: `UPDATE message_reports
		      SET status = ?, resolved_at = ${body.status === 'resolved' ? "datetime('now')" : 'NULL'}
		      WHERE id = ?`,
		args: [body.status, String(body.id)]
	});
	return json({ ok: true });
}
