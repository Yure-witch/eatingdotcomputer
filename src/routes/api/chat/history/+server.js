import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const channelId = url.searchParams.get('channelId');
	const before = url.searchParams.get('before'); // created_at ISO timestamp
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '40') || 40, 100);

	if (!channelId) error(400, 'Missing channelId');
	if (!before) error(400, 'Missing before timestamp');

	const db = getDb();
	if (!db) return json({ messages: [], hasMore: false });

	const result = await db.execute({
		sql: `SELECT * FROM (
		        SELECT id, conversation_id, user_id, user_name, user_role, content, created_at,
		               attachment_url, attachment_filename, attachment_mimetype, attachment_size,
		               fx, font_size, font_weight, font_stretch, no_split, is_edited
		        FROM chat_messages
		        WHERE conversation_id = ? AND created_at < ?
		        ORDER BY created_at DESC LIMIT ?
		      ) sub ORDER BY created_at ASC`,
		args: [channelId, before, limit]
	});

	const messages = result.rows.map((r) => ({
		id: String(r.id),
		userId: String(r.user_id),
		userName: String(r.user_name),
		userRole: String(r.user_role),
		content: String(r.content),
		createdAt: new Date(String(r.created_at)).getTime(),
		edited: Number(r.is_edited) === 1,
		fx: r.fx ? String(r.fx) : null,
		fontSize: r.font_size != null ? Number(r.font_size) : 1,
		fontWeight: r.font_weight != null ? Number(r.font_weight) : 400,
		fontStretch: r.font_stretch != null ? Number(r.font_stretch) : 100,
		noSplit: Number(r.no_split) === 1,
		attachment: r.attachment_url ? {
			url: String(r.attachment_url),
			filename: String(r.attachment_filename ?? ''),
			mimetype: String(r.attachment_mimetype ?? ''),
			size: Number(r.attachment_size ?? 0)
		} : null
	}));

	return json({ messages, hasMore: result.rows.length >= limit });
}
