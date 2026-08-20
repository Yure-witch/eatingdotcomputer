import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { messageId, conversationId, content, type: kind, parentId } = await request.json();
	// A thread reply lives under its parent, in its own table. Everything else
	// about editing is identical, so it's a path swap rather than a second route.
	const isThread = kind === 'thread';
	if (!messageId || !conversationId || !content?.trim()) error(400, 'Missing fields');
	if (content.length > 2000) error(400, 'Message too long');

	const userId = session.user.id;
	const adminDb = getAdminDb();
	const turso = getDb();

	// Build Firebase path
	let msgPath;
	if (isThread) {
		if (!parentId) error(400, 'Missing parentId');
		msgPath = `threads/${conversationId}/${parentId}/messages/${messageId}`;
	} else if (turso) {
		const conv = await turso.execute({ sql: 'SELECT type FROM conversations WHERE id = ?', args: [conversationId] });
		// DM conversations only reach the `conversations` table on the daily
		// archive sync — a FRESH dm has no row yet, and defaulting to
		// 'channel' builds a wrong Firebase path (the live message then
		// silently never updates). DM ids are `uid_uid`, so fall back on
		// the underscore heuristic (same as the thread API).
		const type = String(conv.rows[0]?.type ?? (conversationId.includes('_') ? 'dm' : 'channel'));
		const base = type === 'dm' ? `dms/${conversationId}` : `channels/${conversationId}`;
		msgPath = `${base}/messages/${messageId}`;
	} else {
		msgPath = `${conversationId.includes('_') ? 'dms' : 'channels'}/${conversationId}/messages/${messageId}`;
	}

	// Update in Firebase if message is live there
	const snap = await adminDb.ref(msgPath).get();
	if (snap.exists()) {
		if (snap.val()?.u !== userId) error(403, 'Forbidden');
		await adminDb.ref(msgPath).update({ c: content.trim(), ed: true });
	} else {
		// Message is archived — verify ownership in Turso
		if (turso) {
			const row = await turso.execute({
				sql: `SELECT user_id FROM ${isThread ? 'thread_messages' : 'chat_messages'} WHERE id = ?`,
				args: [messageId]
			});
			if (row.rows.length && String(row.rows[0].user_id) !== userId) error(403, 'Forbidden');
		}
	}

	// Update in Turso if archived
	if (turso) {
		await turso.execute({
			// thread_messages has no is_edited column — the live `ed` flag in RTDB
			// carries that, and an archived reply keeps whatever it was sent as.
			sql: isThread
				? 'UPDATE thread_messages SET content = ? WHERE id = ? AND user_id = ?'
				: 'UPDATE chat_messages SET content = ?, is_edited = 1 WHERE id = ? AND user_id = ?',
			args: [content.trim(), messageId, userId]
		}).catch(() => {});
	}

	return json({ ok: true });
}
