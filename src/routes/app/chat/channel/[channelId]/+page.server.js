import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ params }) {
	const { channelId } = params;
	const db = getDb();

	if (db) {
		const conv = await db.execute({
			sql: "SELECT id FROM conversations WHERE id = ? AND type = 'channel'",
			args: [channelId]
		});
		if (!conv.rows.length) error(404, 'Channel not found');
	}

	const result = db ? await db.execute({
		sql: `SELECT id, conversation_id, user_id, user_name, user_role, content, created_at
		      FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
		args: [channelId]
	}) : { rows: [] };

	return {
		channelId,
		history: result.rows.map((r) => ({
			id: String(r.id),
			userId: String(r.user_id),
			userName: String(r.user_name),
			userRole: String(r.user_role),
			content: String(r.content),
			createdAt: new Date(String(r.created_at)).getTime()
		}))
	};
}
