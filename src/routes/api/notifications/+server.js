import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

// Archived bell notifications — entries older than 24h that /api/chat/sync
// moved out of RTDB into the notifications table. The bell merges these
// with the live notifications/{uid} subscription (dedupe by id).
export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '60') || 60, 200);
	const db = getDb();
	if (!db) return json({ notifications: [] });

	const result = await db.execute({
		sql: `SELECT id, type, from_uid, from_name, conv_type, conv_id, msg_id, snippet, created_at
		      FROM notifications WHERE recipient_id = ?
		      ORDER BY created_at DESC LIMIT ?`,
		args: [session.user.id, limit]
	});

	const notifications = result.rows.map((r) => ({
		id: String(r.id),
		type: String(r.type),
		fromUid: String(r.from_uid),
		fromName: String(r.from_name),
		convType: String(r.conv_type),
		convId: String(r.conv_id),
		msgId: String(r.msg_id),
		snippet: String(r.snippet),
		createdAt: Number(r.created_at)
	}));

	return json({ notifications });
}
