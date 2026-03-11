import { getDb } from '$lib/server/turso';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
	const { endpoint } = await request.json();
	if (!endpoint) error(400, 'Missing endpoint');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	await db.execute({
		sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
		args: [endpoint]
	});

	return json({ success: true });
}
