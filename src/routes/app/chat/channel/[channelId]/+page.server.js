import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ params, parent }) {
	await parent();
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

	const reactionsResult = db ? await db.execute({
		sql: `SELECT mr.message_id, mr.emoji, mr.user_id
		      FROM message_reactions mr
		      JOIN chat_messages cm ON mr.message_id = cm.id
		      WHERE cm.conversation_id = ?`,
		args: [channelId]
	}) : { rows: [] };

	const initialReactions = {};
	for (const r of reactionsResult.rows) {
		const mid = String(r.message_id), e = String(r.emoji), uid = String(r.user_id);
		if (!initialReactions[mid]) initialReactions[mid] = {};
		if (!initialReactions[mid][e]) initialReactions[mid][e] = {};
		initialReactions[mid][e][uid] = true;
	}

	return {
		channelId,
		initialReactions,
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
