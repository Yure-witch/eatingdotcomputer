import webpush from 'web-push';
import { env } from '$env/dynamic/private';

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
