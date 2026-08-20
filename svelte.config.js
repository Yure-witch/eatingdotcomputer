import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// Don't auto-register the service worker. We register it manually
		// (src/routes/+layout.svelte) so we can SKIP it inside the Capacitor
		// native shell — a cache-first SW black-screens the WKWebView. On the
		// web/PWA it registers exactly as before.
		serviceWorker: {
			register: false
		},
		// Poll for a newer deploy. Without this, $updated NEVER becomes true on
		// its own — it only flips when something calls updated.check(), which
		// only happened on native resume. So the reload banner never appeared on
		// the web no matter how many times we shipped.
		version: {
			pollInterval: 60_000
		}
	}
};

export default config;
