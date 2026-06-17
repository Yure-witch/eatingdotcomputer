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
		}
	}
};

export default config;
