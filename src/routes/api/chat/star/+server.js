import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { messageId, conversationId, snapshot } = await request.json();
	if (!messageId || !conversationId) error(400, 'Missing fields');

	const db = getDb();
	if (!db) return json({ ok: true, starred: false });

	const userId = session.user.id;

	const existing = await db.execute({
		sql: 'SELECT id FROM starred_messages WHERE user_id = ? AND message_id = ?',
		args: [userId, messageId]
	});

	if (existing.rows.length > 0) {
		await db.execute({
			sql: 'DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?',
			args: [userId, messageId]
		});
		return json({ ok: true, starred: false });
	}

	await db.execute({
		sql: `INSERT OR IGNORE INTO starred_messages
		          (user_id, message_id, conv_id, conv_name, content, author_name, author_id,
		           attachment_url, attachment_filename, attachment_mimetype)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			userId, messageId, conversationId,
			snapshot?.convName ?? null,
			snapshot?.content ?? null,
			snapshot?.authorName ?? null,
			snapshot?.authorId ?? null,
			snapshot?.attachment?.url ?? null,
			snapshot?.attachment?.filename ?? null,
			snapshot?.attachment?.mimetype ?? null
		]
	});

	return json({ ok: true, starred: true });
}
