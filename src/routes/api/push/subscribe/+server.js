import { getDb } from '$lib/server/turso';
import { json, error } from '@sveltejs/kit';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const subscription = await request.json();
	const { endpoint, keys } = subscription;

	if (!endpoint || !keys?.p256dh || !keys?.auth) {
		error(400, 'Invalid subscription object');
	}

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const id = crypto.randomUUID();
	await db.execute({
		sql: `INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
		      VALUES (?, ?, ?, ?, ?)`,
		args: [id, session.user.id, endpoint, keys.p256dh, keys.auth]
	});

	return json({ success: true });
}
