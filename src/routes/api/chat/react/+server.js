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
	const msgReactionsPath = `${base}/reactions/${messageId}`;
	const reactionPath = `${msgReactionsPath}/${emoji}/${userId}`;

	// If the message is archived in Turso, sync all its reactions to Firebase first.
	// This ensures Firebase is the authoritative source so the toggle reads and writes
	// consistent state — without this, a Turso-only reaction looks "absent" to Firebase
	// and gets added instead of removed, and the client merge loses other users' reactions.
	if (turso) {
		const msgRow = await turso.execute({
			sql: 'SELECT id FROM messages WHERE id = ?',
			args: [messageId]
		});
		if (msgRow.rows.length > 0) {
			const tursoRxRows = await turso.execute({
				sql: 'SELECT emoji, user_id FROM message_reactions WHERE message_id = ?',
				args: [messageId]
			});
			if (tursoRxRows.rows.length > 0) {
				// Write any Turso reactions missing from Firebase using update() (non-destructive)
				const fbMsgSnap = await adminDb.ref(msgReactionsPath).get();
				const fbMsg = fbMsgSnap.exists() ? fbMsgSnap.val() : {};
				const writes = {};
				for (const row of tursoRxRows.rows) {
					if (!fbMsg[row.emoji]?.[row.user_id]) {
						writes[`${row.emoji}/${row.user_id}`] = true;
					}
				}
				if (Object.keys(writes).length > 0) {
					await adminDb.ref(msgReactionsPath).update(writes);
				}
			}
		}
	}

	// Toggle: check Firebase state (now authoritative after any Turso sync above)
	const snap = await adminDb.ref(reactionPath).get();
	const removing = snap.exists();

	if (removing) {
		await adminDb.ref(reactionPath).remove();
	} else {
		await adminDb.ref(reactionPath).set(true);
	}

	// Keep Turso in sync for archived messages
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
