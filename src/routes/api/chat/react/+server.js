import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { messageId, emoji, conversationId, type } = await request.json();
	if (!messageId || !emoji || !conversationId) error(400, 'Missing fields');

	const userId = session.user.id;
	const adminDb = getAdminDb();
	const turso = getDb();

	// Build the correct Firebase path based on conversation type passed by the client
	const base = type === 'dm' ? `dms/${conversationId}` : `channels/${conversationId}`;
	const reactionPath = `${base}/reactions/${messageId}/${emoji}/${userId}`;

	// Toggle: check current Firebase state
	const snap = await adminDb.ref(reactionPath).get();
	const removing = snap.exists();

	if (removing) {
		await adminDb.ref(reactionPath).remove();
	} else {
		await adminDb.ref(reactionPath).set(true);
	}

	// Only sync to Turso if the message is already archived there (FK constraint)
	if (turso) {
		const msgRow = await turso.execute({
			sql: 'SELECT id FROM messages WHERE id = ?',
			args: [messageId]
		});
		if (msgRow.rows.length > 0) {
			if (removing) {
				await turso.execute({
					sql: 'DELETE FROM message_reactions WHERE message_id = ? AND emoji = ? AND user_id = ?',
					args: [messageId, emoji, userId]
				});
			} else {
				await turso.execute({
					sql: 'INSERT OR IGNORE INTO message_reactions (message_id, emoji, user_id) VALUES (?, ?, ?)',
					args: [messageId, emoji, userId]
				});
			}
		}
	}

	return json({ ok: true, removed: removing });
}
