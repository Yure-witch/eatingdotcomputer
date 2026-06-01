import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { pushIdToTimestamp } from '$lib/chat.js';

function normaliseFirebaseMsg(id, raw, userMap) {
	const isCompact = 'u' in raw;
	const userId = isCompact ? raw.u : (raw.userId ?? '');
	const content = isCompact ? raw.c : (raw.content ?? '');
	const ts = isCompact ? pushIdToTimestamp(id) : (raw.createdAt ?? pushIdToTimestamp(id));
	const user = userMap[userId];

	let attachment = null;
	if (raw.att?.url) {
		attachment = { url: raw.att.url, filename: raw.att.name ?? '', mimetype: raw.att.type ?? '', size: raw.att.size ?? 0 };
	}

	return {
		id,
		userId,
		userName: user?.name ?? raw.userName ?? 'Unknown',
		userRole: user?.role ?? raw.userRole ?? 'student',
		content: content ?? '',
		createdAt: ts,
		attachment,
		fx: raw.fx ?? null,
		fontSize: raw.fs ?? 1,
		fontWeight: raw.fw ?? 400,
		fontStretch: raw.wdth ?? 100,
		noSplit: !!(raw.nsp),
		edited: !!(raw.ed)
	};
}

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const convId = url.searchParams.get('convId');
	if (!convId) error(400, 'Missing convId');

	const before = url.searchParams.get('before');
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50') || 50, 100);

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute({
		sql: `SELECT * FROM (
		        SELECT id, user_id, user_name, user_role, content, created_at,
		               attachment_url, attachment_filename, attachment_mimetype, attachment_size,
		               fx, font_size, font_weight, font_stretch, no_split, is_edited
		        FROM chat_messages
		        WHERE conversation_id = ?${before ? ' AND created_at < ?' : ''}
		        ORDER BY created_at DESC LIMIT ?
		      ) sub ORDER BY created_at ASC`,
		args: before ? [convId, before, limit] : [convId, limit]
	});

	const tursoMessages = result.rows.map((r) => ({
		id: String(r.id),
		userId: String(r.user_id),
		userName: String(r.user_name),
		userRole: String(r.user_role),
		content: String(r.content ?? ''),
		createdAt: new Date(String(r.created_at)).getTime(),
		attachment: r.attachment_url ? {
			url: String(r.attachment_url),
			filename: String(r.attachment_filename ?? ''),
			mimetype: String(r.attachment_mimetype ?? ''),
			size: Number(r.attachment_size ?? 0)
		} : null,
		fx: r.fx ? String(r.fx) : null,
		fontSize: r.font_size != null ? Number(r.font_size) : 1,
		fontWeight: r.font_weight != null ? Number(r.font_weight) : 400,
		fontStretch: r.font_stretch != null ? Number(r.font_stretch) : 100,
		noSplit: Number(r.no_split) === 1,
		edited: Number(r.is_edited) === 1
	}));

	// On initial load (no `before`), also fetch live messages from Firebase
	let firebaseMessages = [];
	if (!before) {
		try {
			const fbSnap = await getAdminDb().ref(`dms/${convId}/messages`).get();
			if (fbSnap.exists()) {
				const usersResult = await db.execute({ sql: 'SELECT id, name, role FROM users' });
				const userMap = {};
				for (const r of usersResult.rows) userMap[String(r.id)] = { name: String(r.name), role: String(r.role) };

				const raw = fbSnap.val();
				for (const [id, val] of Object.entries(raw)) {
					firebaseMessages.push(normaliseFirebaseMsg(id, val, userMap));
				}
			}
		} catch { /* Firebase unavailable — show archived only */ }
	}

	// Merge: deduplicate by ID, Firebase wins for messages that exist in both
	const tursoIds = new Set(tursoMessages.map(m => m.id));
	const merged = [...tursoMessages];
	for (const fbMsg of firebaseMessages) {
		if (!tursoIds.has(fbMsg.id)) {
			merged.push(fbMsg);
		}
	}
	merged.sort((a, b) => a.createdAt - b.createdAt);

	// For initial load, return only the last `limit` messages (but hasMore reflects if there are more)
	if (!before && merged.length > limit) {
		return json({ messages: merged.slice(-limit), hasMore: true });
	}

	return json({ messages: merged, hasMore: before ? result.rows.length >= limit : false });
}
