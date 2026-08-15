import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { sendApns, apnsConfigured } from '$lib/server/apns.js';

let initialized = false;
let vapidConfigured = false;

function ensureInitialized() {
	if (initialized) return;
	initialized = true;
	if (!env.VAPID_SUBJECT || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
		console.warn('[push] VAPID env vars not set — push notifications disabled');
		return;
	}
	webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
	vapidConfigured = true;
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

	// ── Web push (Safari / installed PWA) ──────────────────────────────────
	if (vapidConfigured) {
		const result = await db.execute({
			sql: `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`,
			args: userIds
		});
		if (result.rows.length) {
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
	}

	// ── Native push (APNs — the Capacitor iOS app) ─────────────────────────
	// Independent of VAPID: the native shell can't use web push, so this is the
	// only channel that reaches App Store installs.
	if (apnsConfigured()) {
		try {
			const toks = await db.execute({
				sql: `SELECT token FROM apns_tokens WHERE user_id IN (${placeholders})`,
				args: userIds
			});
			if (toks.rows.length) {
				const res = await sendApns(toks.rows.map((r) => String(r.token)), payload);
				for (const r of res) {
					if (r.remove) await db.execute({ sql: 'DELETE FROM apns_tokens WHERE token = ?', args: [r.token] }).catch(() => {});
				}
			}
		} catch (e) {
			console.warn('[push] APNs send failed', e?.message ?? e);
		}
	}
}
