import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { convParticipants } from '$lib/convId.js';

export async function load({ params, parent }) {
	const { currentUser } = await parent();
	const { convId } = params;

	const participants = convParticipants(convId);
	if (!participants.includes(currentUser.id)) error(403, 'Forbidden');

	const db = getDb();
	const result = db ? await db.execute({
		sql: `SELECT id, user_id, user_name, user_role, content, created_at
		      FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
		args: [convId]
	}) : { rows: [] };

	const reactionsResult = db ? await db.execute({
		sql: `SELECT mr.message_id, mr.emoji, mr.user_id
		      FROM message_reactions mr
		      JOIN chat_messages cm ON mr.message_id = cm.id
		      WHERE cm.conversation_id = ?`,
		args: [convId]
	}) : { rows: [] };

	const initialReactions = {};
	for (const r of reactionsResult.rows) {
		const mid = String(r.message_id), e = String(r.emoji), uid = String(r.user_id);
		if (!initialReactions[mid]) initialReactions[mid] = {};
		if (!initialReactions[mid][e]) initialReactions[mid][e] = {};
		initialReactions[mid][e][uid] = true;
	}

	return {
		convId,
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
