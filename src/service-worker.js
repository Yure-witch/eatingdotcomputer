import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})
	);
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		caches.match(event.request).then((cached) => {
			const network = fetch(event.request).then((response) => {
				if (response.status === 200) {
					const clone = response.clone();
					caches.open(CACHE).then((cache) => cache.put(event.request, clone));
				}
				return response;
			});
			return cached || network;
		})
	);
});

self.addEventListener('push', (event) => {
	if (!event.data) return;

	let data;
	try {
		data = event.data.json();
	} catch {
		data = { title: 'eating.computer', body: event.data.text() };
	}

	// Always show the OS notification — iOS requires showNotification() on every
	// push event or it will stop delivering pushes to the app entirely.
	event.waitUntil(
		Promise.all([
			self.registration.showNotification(data.title, {
				body: data.body ?? '',
				icon: '/icon-192.png',
				tag: data.tag ?? 'chat',
				data: { url: data.url ?? '/app' }
			}),
			// Also forward to any open clients so in-app toasts appear
			self.clients.matchAll({ type: 'window' }).then((clientList) => {
				for (const client of clientList) {
					client.postMessage({ type: 'push', data });
				}
			})
		])
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url ?? '/';

	event.waitUntil(
		clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			for (const client of clientList) {
				if (client.url === url && 'focus' in client) return client.focus();
			}
			return clients.openWindow(url);
		})
	);
});
