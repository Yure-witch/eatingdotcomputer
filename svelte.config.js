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
		// No interval polling. $updated only flips when something calls
		// updated.check(), and the app now does that on every resume —
		// `native-resume` and visibilitychange both route into onAppResume — so
		// a blind 60s timer was re-asking a question nobody had, forever, in
		// every open tab. Checks are event-driven instead: on arrival, on
		// coming back to the tab, and on activity after a quiet spell (the
		// shell watchdog in app.html covers that last one, and is also the
		// backstop for when this bundle is too stale to check for itself).
		version: {
			pollInterval: 0
		}
	}
};

export default config;
