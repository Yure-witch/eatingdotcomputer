import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { convParticipants } from '$lib/convId.js';

export async function load({ params, parent }) {
	const { currentUser } = await parent();
	const { convId } = params;

	// Verify this user is a participant
	const participants = convParticipants(convId);
	if (!participants.includes(currentUser.id)) error(403, 'Forbidden');

	const db = getDb();
	const result = db ? await db.execute({
		sql: 'SELECT id, user_id, user_name, content, created_at FROM direct_messages WHERE conversation_id = ? ORDER BY created_at ASC',
		args: [convId]
	}) : { rows: [] };

	return {
		convId,
		history: result.rows.map((r) => ({
			id: String(r.id),
			userId: String(r.user_id),
			userName: String(r.user_name),
			content: String(r.content),
			createdAt: new Date(String(r.created_at)).getTime()
		}))
	};
}
