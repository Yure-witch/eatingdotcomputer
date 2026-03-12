import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function POST({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const db = getDb();
	if (!db) return json({ ok: true }); // fail silently — don't break the app

	await db.execute({
		sql: `INSERT INTO user_activity (user_id, logged_at) VALUES (?, datetime('now'))`,
		args: [session.user.id]
	});

	return json({ ok: true });
}
