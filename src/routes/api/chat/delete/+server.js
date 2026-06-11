import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { deleteFromR2 } from '$lib/server/r2.js';
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

	// Read the live Firebase snapshot ONCE. Used both for the author
	// check (students-only) and to find any attachment that needs to
	// be reaped from R2 / uploaded_files. We do this BEFORE the
	// remove() call so the URL is still reachable.
	const liveSnap = await adminDb.ref(msgPath).get().catch(() => null);
	const liveVal = liveSnap?.exists() ? liveSnap.val() : null;

	// Verify the message author if not instructor (double-check server-side)
	if (!isInstructor) {
		if (!liveVal) error(404, 'Message not found');
		if (liveVal.u !== userId) error(403, 'Forbidden');
	}

	// Collect attachment URLs from BOTH stores so we don't miss the
	// case where the message has already been archived from Firebase
	// to Turso (the sync cron runs hourly). Firebase stores the live
	// attachment under `msg.att.url`; Turso's archived row carries it
	// in the `attachment_url` column added by migration 020.
	const attachmentUrls = new Set();
	if (liveVal?.att?.url) attachmentUrls.add(String(liveVal.att.url));

	if (turso) {
		try {
			const archived = await turso.execute({
				sql: 'SELECT attachment_url FROM messages WHERE id = ?',
				args: [messageId]
			});
			const archivedUrl = archived.rows[0]?.attachment_url;
			if (archivedUrl) attachmentUrls.add(String(archivedUrl));
		} catch { /* ignore */ }
	}

	// For every distinct attachment URL, resolve the R2 key via the
	// uploaded_files table (its `url` column is unique-per-upload) and
	// delete both the R2 object AND the uploaded_files row so the
	// Files tab / Orbit gallery stop showing an orphan. Failures here
	// don't block the chat delete — the message is the user's primary
	// intent; an orphaned blob is the worst case.
	if (turso && attachmentUrls.size > 0) {
		for (const url of attachmentUrls) {
			try {
				const row = await turso.execute({
					sql: 'SELECT id, r2_key FROM uploaded_files WHERE url = ? LIMIT 1',
					args: [url]
				});
				const file = row.rows[0];
				if (!file) continue;
				await Promise.allSettled([
					deleteFromR2(String(file.r2_key)),
					turso.execute({
						sql: 'DELETE FROM uploaded_files WHERE id = ?',
						args: [String(file.id)]
					})
				]);
			} catch (e) {
				console.warn('[chat/delete] attachment cleanup failed', url, e?.message ?? e);
			}
		}
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
