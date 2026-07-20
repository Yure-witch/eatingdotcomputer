import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { requireClassAccess } from '$lib/server/access.js';

// Firebase keys never contain . # $ [ ] / — reject anything else outright
// so client-supplied ids can't traverse into other RTDB paths.
const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

// Threads (Slack-style): archived replies live in thread_messages (moved
// out of Firebase by /api/chat/sync after 24h). Two query shapes:
//   ?convId=X&parentId=Y   → the archived replies of one thread, oldest first
//   ?convId=X&counts=1     → { parentMsgId: archivedReplyCount } for the conv
// The client merges these with the live Firebase side
// (threads/{convId}/{parentId}/messages) for full history + realtime.
export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const convId = url.searchParams.get('convId');
	if (!convId) error(400, 'Missing convId');

	const db = getDb();
	if (!db) return json({ messages: [], counts: {} });

	if (url.searchParams.get('counts')) {
		const result = await db.execute({
			sql: `SELECT parent_msg_id, COUNT(*) AS n, MAX(created_at) AS last_at
			      FROM thread_messages WHERE conversation_id = ? GROUP BY parent_msg_id`,
			args: [convId]
		});
		const counts = {};
		for (const r of result.rows) {
			counts[String(r.parent_msg_id)] = {
				n: Number(r.n),
				lastAt: new Date(String(r.last_at)).getTime()
			};
		}
		return json({ counts });
	}

	const parentId = url.searchParams.get('parentId');
	if (!parentId) error(400, 'Missing parentId');

	const result = await db.execute({
		sql: `SELECT id, user_id, user_name, user_role, content, created_at,
		             attachment_url, attachment_filename, attachment_mimetype, attachment_size
		      FROM thread_messages
		      WHERE conversation_id = ? AND parent_msg_id = ?
		      ORDER BY created_at ASC`,
		args: [convId, parentId]
	});

	const messages = result.rows.map((r) => ({
		id: String(r.id),
		userId: String(r.user_id),
		userName: String(r.user_name),
		userRole: String(r.user_role),
		content: String(r.content),
		createdAt: new Date(String(r.created_at)).getTime(),
		attachment: r.attachment_url ? {
			url: String(r.attachment_url),
			filename: r.attachment_filename ? String(r.attachment_filename) : null,
			mimetype: r.attachment_mimetype ? String(r.attachment_mimetype) : null,
			size: r.attachment_size != null ? Number(r.attachment_size) : null
		} : null
	}));

	return json({ messages });
}

// Send a thread reply. Like top-level sends (POST /api/chat), writes go
// through the ADMIN SDK — RTDB rules keep message paths read-only for
// clients, so the server is the only writer. Compact { u, c } shape,
// timestamp derived from the push ID, archived by /api/chat/sync.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { convId, parentId, content, attachment } = await request.json();
	if (!convId || !SAFE_KEY.test(convId)) error(400, 'Bad convId');
	if (!parentId || !SAFE_KEY.test(parentId)) error(400, 'Bad parentId');
	if (!content?.trim() && !attachment?.url) error(400, 'Empty message');
	if (content && content.length > 20000) error(400, 'Message too long (max 20,000 characters)');

	const db = getAdminDb();
	const msgRef = db.ref(`threads/${convId}/${parentId}/messages`).push();
	const msg = { u: session.user.id, c: content?.trim() ?? '' };
	if (attachment?.url) {
		msg.att = { url: attachment.url, name: attachment.filename, type: attachment.mimetype, size: attachment.size };
	}
	await msgRef.set(msg);

	// Bell notifications (type 'thread') — parent author + everyone who
	// already replied in the thread, deduped, never the sender. Same
	// notifications/{uid} contract as mentions/replies/reactions; sync
	// archives them to Turso after 24h. Best-effort: never fail the send.
	try {
		const recipients = new Set();
		// parent author: live RTDB first (channel or dm), Turso fallback
		for (const path of [`channels/${convId}/messages/${parentId}`, `dms/${convId}/messages/${parentId}`]) {
			const snap = await db.ref(path).get();
			if (snap.exists()) { recipients.add(String(snap.val()?.u ?? snap.val()?.userId ?? '')); break; }
		}
		const turso = getDb();
		if (turso) {
			if (!recipients.size) {
				const row = await turso.execute({ sql: 'SELECT user_id FROM chat_messages WHERE id = ?', args: [parentId] });
				if (row.rows.length) recipients.add(String(row.rows[0].user_id));
			}
			// prior ARCHIVED repliers participate too
			const prev = await turso.execute({
				sql: 'SELECT DISTINCT user_id FROM thread_messages WHERE parent_msg_id = ?',
				args: [parentId]
			});
			for (const r of prev.rows) recipients.add(String(r.user_id));
		}
		// prior live repliers
		const liveSnap = await db.ref(`threads/${convId}/${parentId}/messages`).get();
		if (liveSnap.exists()) {
			for (const v of Object.values(liveSnap.val())) recipients.add(String(v?.u ?? v?.userId ?? ''));
		}
		recipients.delete('');
		recipients.delete(session.user.id);
		if (recipients.size) {
			const senderName = session.user.name || session.user.email;
			// strip PUA effect markers so the bell shows clean plain text
			const plain = (content ?? '').replace(/[\uE100-\uE1FF]/g, '').trim() || (attachment?.filename ? `\ud83d\udcce ${attachment.filename}` : '');
			// DM conv ids are `uidA_uidB` (getConvId); channel ids are slugs.
			// Cheap string test beats fetching the whole dms/{convId} node.
			const convType = convId.includes('_') ? 'dm' : 'channel';
			const updates = {};
			for (const uid of recipients) {
				const notifId = db.ref(`notifications/${uid}`).push().key;
				updates[`notifications/${uid}/${notifId}`] = {
					type: 'thread',
					fromUid: session.user.id,
					fromName: senderName,
					convType,
					convId,
					msgId: parentId,
					snippet: plain.slice(0, 60) || '✨',
					createdAt: Date.now()
				};
			}
			await db.ref().update(updates);
		}
	} catch { /* best-effort */ }

	return json({ ok: true, id: msgRef.key });
}
