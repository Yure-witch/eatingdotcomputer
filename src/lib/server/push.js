import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';

let initialized = false;

function ensureInitialized() {
	if (initialized) return;
	webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
	initialized = true;
}

/**
 * Send a push notification to a single subscription.
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
 * @param {{ title: string, body?: string, url?: string, tag?: string }} payload
 */
export async function sendPushNotification(subscription, payload) {
	ensureInitialized();
	return webpush.sendNotification(subscription, JSON.stringify(payload));
}

/**
 * Send a push notification to all subscriptions for the given user IDs.
 * Silently cleans up expired/invalid subscriptions.
 * @param {string[]} userIds
 * @param {{ title: string, body?: string, url?: string, tag?: string }} payload
 */
export async function notifyUsers(userIds, payload) {
	if (!userIds.length) return;
	ensureInitialized();
	const db = getDb();
	if (!db) return;

	const placeholders = userIds.map(() => '?').join(', ');
	const result = await db.execute({
		sql: `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`,
		args: userIds
	});
	if (!result.rows.length) return;

	const results = await Promise.allSettled(
		result.rows.map((row) =>
			sendPushNotification(
				{ endpoint: String(row.endpoint), keys: { p256dh: String(row.p256dh), auth: String(row.auth) } },
				payload
			)
		)
	);

	// Clean up expired/invalid subscriptions
	const expired = results
		.map((r, i) => (r.status === 'rejected' ? String(result.rows[i].endpoint) : null))
		.filter(Boolean);
	for (const endpoint of expired) {
		await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [endpoint] });
	}
}
