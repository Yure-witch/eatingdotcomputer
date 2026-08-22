import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
// /offline is a prerendered, data-free page — the navigation fallback when
// the network is gone. Prerendered routes are NOT in `build`/`files`, so it
// is added to the precache list by hand.
const OFFLINE_PAGE = '/offline';
const ASSETS = [...build, ...files, OFFLINE_PAGE];
// Fast membership test for the fetch handler's allowlist.
const ASSET_SET = new Set(ASSETS);

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

	// Dev: never intercept on localhost — let the browser hit the network directly so
	// Vite/HMR updates always show up on a normal refresh (no stale-bundle caching).
	if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

	// HTML navigations: network-first so the app shell is always fresh after a
	// deploy. Offline, fall back to the precached /offline page — pages
	// themselves are deliberately never cached (they carry session data), so
	// matching the request URL alone would find nothing.
	if (event.request.mode === 'navigate') {
		event.respondWith(
			fetch(event.request).catch(async () =>
				(await caches.match(event.request)) ?? (await caches.match(OFFLINE_PAGE))
			)
		);
		return;
	}

	// ONLY the build's static assets are cache-first: content-hashed files
	// under /_app/immutable/ plus the precached static files (fonts, icons).
	// Everything else — __data.json, /api/*, anything dynamic — goes straight
	// to the network, UNTOUCHED. The old handler cached every same-origin GET,
	// which included SvelteKit's per-user data payloads: after switching
	// accounts, the first loads could be served from the PREVIOUS user's
	// cache — wrong name, wrong role, wrong class, someone else's data. A
	// service worker must never hold anything session-scoped.
	const isStatic = url.pathname.startsWith('/_app/immutable/') || ASSET_SET.has(url.pathname);
	if (!isStatic) return;

	// Static assets: cache-first, update in background.
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

	// Relay to all open app tabs so they can show an in-app toast + ding.
	// This is a fire-and-forget broadcast; tabs that aren't open simply miss it.
	try {
		const bc = new BroadcastChannel('ec-push');
		bc.postMessage(data);
		bc.close();
	} catch { /* BroadcastChannel not available in all environments */ }

	// Always show the OS notification — iOS requires showNotification() on every
	// push event or it will stop delivering pushes to the app entirely.
	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body ?? '',
			icon: '/icon-192.png',
			tag: data.tag ?? 'chat',
			data: { url: data.url ?? '/app' }
		})
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
