import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { messageId, conversationId, authorId } = await request.json();
	if (!messageId || !conversationId) error(400, 'Missing fields');

	const userId = session.user.id;
	const isInstructor = session.user.role === 'instructor';

	// Students can only delete their own messages
	if (!isInstructor && authorId !== userId) error(403, 'Forbidden');

	const adminDb = getAdminDb();
	const turso = getDb();

	// Build Firebase path
	let msgPath;
	let reactionPath;
	if (turso) {
		const conv = await turso.execute({ sql: 'SELECT type FROM conversations WHERE id = ?', args: [conversationId] });
		const type = String(conv.rows[0]?.type ?? 'channel');
		const base = type === 'dm' ? `dms/${conversationId}` : `channels/${conversationId}`;
		msgPath = `${base}/messages/${messageId}`;
		reactionPath = `${base}/reactions/${messageId}`;
	} else {
		msgPath = `channels/${conversationId}/messages/${messageId}`;
		reactionPath = `channels/${conversationId}/reactions/${messageId}`;
	}

	// Verify the message author if not instructor (double-check server-side)
	if (!isInstructor) {
		const snap = await adminDb.ref(msgPath).get();
		if (!snap.exists()) error(404, 'Message not found');
		if (snap.val()?.u !== userId) error(403, 'Forbidden');
	}

	// Delete from Firebase
	await adminDb.ref(msgPath).remove();
	await adminDb.ref(reactionPath).remove().catch(() => {});

	// Delete from Turso if archived
	if (turso) {
		await turso.execute({ sql: 'DELETE FROM message_reactions WHERE message_id = ?', args: [messageId] }).catch(() => {});
		await turso.execute({ sql: 'DELETE FROM messages WHERE id = ?', args: [messageId] }).catch(() => {});
	}

	return json({ ok: true });
}
