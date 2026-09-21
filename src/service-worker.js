import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
// /offline is a prerendered, data-free page — the navigation fallback when
// the network is gone. Prerendered routes are NOT in `build`/`files`, so it
// is added to the precache list by hand.
const OFFLINE_PAGE = '/offline';

// PRECACHE IS DELIBERATELY TINY.
//
// This used to be `[...build, ...files, OFFLINE_PAGE]` — every generated
// chunk plus every file in static/. That is ~1,300 requests, and `version`
// changes on EVERY deploy, so every client re-downloaded all ~1,300 of them
// each time anything shipped. At a hundred-odd deploys a month against a
// class of students that is hundreds of thousands of edge requests spent on
// files nobody asked for: the 7.7MB canvaskit build, 162 emoji-half SVGs,
// 114 WeChat webps, and ~700 .ufo glyph SOURCE files for a font that ships
// as three woff2s. It blew through the hosting request budget on its own.
//
// So: precache only what the shell genuinely needs before it can paint or
// go offline. Everything else — chunks, fonts, emoji art, the big JSON
// tables — is cached on FIRST USE by the fetch handler below, which is the
// same cache-first behaviour, just paid for lazily by the people who
// actually open the feature. The tradeoff is that a route you have never
// visited is not available offline; `build`/`files` stay imported so that
// choice is one edit away if that ever becomes the priority.
const PRECACHE = [
	OFFLINE_PAGE,
	'/manifest.json',
	'/favicon.svg',
	'/icon-192.png',
	'/apple-touch-icon.png',
	// Preloaded in app.html — the icon font every screen paints with.
	'/fonts/material-symbols-rounded.woff2'
];

// Runtime-cacheable static types. Extension-based rather than a manifest, so
// lazily-loaded assets (emoji SVGs, sticker webps, the wasm runtimes) land in
// the cache the first time something reaches for them.
const STATIC_EXT = /\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico|wasm|bin)$/;

/** Is this a static asset we're allowed to hold indefinitely? */
function isCacheableStatic(pathname) {
	// Never cache anything session-scoped or deploy-scoped.
	if (pathname.startsWith('/api/')) return false;
	if (pathname.endsWith('/__data.json')) return false;
	if (pathname === '/_app/version.json') return false; // the update watchdog's probe
	// Content-hashed build output: safe forever, by construction.
	if (pathname.startsWith('/_app/immutable/')) return true;
	return STATIC_EXT.test(pathname);
}

self.addEventListener('install', (event) => {
	// Individually, not addAll: addAll is all-or-nothing, so one 404 in the
	// list would fail the whole install and leave the client uncached.
	event.waitUntil(
		caches.open(CACHE).then((cache) =>
			Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
		)
	);
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

	// ONLY static assets are cache-first. Everything else — __data.json,
	// /api/*, anything dynamic — goes straight to the network, UNTOUCHED. An
	// older handler cached every same-origin GET, which included SvelteKit's
	// per-user data payloads: after switching accounts, the first loads could
	// be served from the PREVIOUS user's cache — wrong name, wrong role, wrong
	// class, someone else's data. A service worker must never hold anything
	// session-scoped.
	if (!isCacheableStatic(url.pathname)) return;

	// Content-hashed assets are immutable BY NAME: a changed file gets a
	// changed URL. Revalidating one can only ever return the bytes we already
	// hold, so a cache hit ends here — no network request at all. (The
	// previous version fired a background fetch on every hit, which meant a
	// full second copy of every chunk, font and icon over the wire on every
	// single page load. That is the entire point of hashing filenames.)
	const immutable = url.pathname.startsWith('/_app/immutable/');

	event.respondWith(
		caches.match(event.request).then((cached) => {
			if (cached && immutable) return cached;
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
