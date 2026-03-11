import { PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';

function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/** Subscribe the current browser to push notifications. */
export async function subscribeToPush() {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		return { error: 'Push not supported in this browser' };
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		return { error: 'Notification permission denied' };
	}

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_PUBLIC_KEY)
	});

	const response = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subscription)
	});

	if (!response.ok) {
		return { error: 'Failed to save subscription on server' };
	}

	return { success: true };
}

/** Unsubscribe the current browser from push notifications. */
export async function unsubscribeFromPush() {
	if (!('serviceWorker' in navigator)) return;

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) return;

	await fetch('/api/push/unsubscribe', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: subscription.endpoint })
	});

	await subscription.unsubscribe();
}

/** Returns true if this browser is already subscribed to push. */
export async function isPushSubscribed() {
	if (!('serviceWorker' in navigator)) return false;
	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();
	return !!subscription;
}
