import { sendPushNotification } from '$lib/server/push';
import { getDb } from '$lib/server/turso';
import { json, error } from '@sveltejs/kit';

// TODO: restrict this endpoint to admin/instructor role once auth is added
export async function POST({ request }) {
	const { title, body, url, tag } = await request.json();
	if (!title) error(400, 'Missing title');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute('SELECT endpoint, p256dh, auth FROM push_subscriptions');

	const results = await Promise.allSettled(
		result.rows.map((row) =>
			sendPushNotification(
				{ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
				{ title, body, url, tag }
			)
		)
	);

	// Clean up expired/invalid subscriptions
	const expired = results
		.map((r, i) => (r.status === 'rejected' ? result.rows[i].endpoint : null))
		.filter(Boolean);

	for (const endpoint of expired) {
		await db.execute({
			sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
			args: [endpoint]
		});
	}

	return json({
		sent: results.filter((r) => r.status === 'fulfilled').length,
		failed: expired.length
	});
}
