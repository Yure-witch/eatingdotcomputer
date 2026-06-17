import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

/**
 * Persist the signed-in user's drag-and-drop ordering of the members list so it
 * is identical on every device (desktop + mobile). Body: { order: string[] }.
 * Stored as a JSON array of user ids in users.member_order.
 */
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user?.id) error(401, 'Not signed in');

	const { order } = await request.json();
	if (!Array.isArray(order)) error(400, 'order must be an array');
	// Keep only string ids, cap the length defensively.
	const clean = order.filter((id) => typeof id === 'string').slice(0, 1000);

	const db = getDb();
	if (db) {
		await db.execute({
			sql: 'UPDATE users SET member_order = ? WHERE id = ?',
			args: [JSON.stringify(clean), session.user.id]
		});
	}
	return json({ ok: true });
}
