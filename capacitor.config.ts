import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell config. We do NOT bundle the SvelteKit build — the app is
 * heavily server-rendered (Auth.js, Turso, Firebase admin, 50+ endpoints),
 * so the shell loads the live Vercel deployment via `server.url`. Every
 * server route keeps working exactly as on the web; what the shell adds is
 * the native plugin bridge (Keyboard, StatusBar, Haptics, push later).
 *
 * `webDir` still has to exist — it's the offline fallback bundle (a tiny
 * loading page), only shown if the live URL is unreachable.
 */
const config: CapacitorConfig = {
	appId: 'computer.eating.app',
	appName: 'eating.computer',
	webDir: 'capacitor-shell',
	server: {
		// PRODUCTION — the shell loads the live site. For dev testing, point this
		// at your local preview server (http://192.168.x.x:4173, cleartext: true)
		// and REVERT before archiving.
		url: 'https://www.eating.computer',
		allowNavigation: ['www.eating.computer', 'eating.computer']
	},
	ios: {
		contentInset: 'never',
		// App-Bound Domains (with WKAppBoundDomains in Info.plist): WKWebView
		// only grants SERVICE WORKER support to app-bound domains, and the
		// service worker is what makes a cold start fast — the whole JS/CSS/font
		// bundle is served from disk (precached by src/service-worker.js), so
		// only the HTML document and data hit the network. Also gives the shell
		// a real offline mode: the SW falls back to cached pages. Login is
		// unaffected — Google/Apple sign-in run through native plugins, not
		// webview redirects, so navigation never leaves eating.computer.
		limitsNavigationsToAppBoundDomains: true,
		// Lets the server tell a shell request apart from a plain browser one, so
		// an unauthenticated launch can go straight to /login instead of the
		// marketing landing page (see src/routes/+page.server.js).
		appendUserAgent: 'eatingcomputer-native',
		// Only used on the very first launch after install. From then on
		// AppDelegate repaints the shell from the user's own saved surface
		// colour (see applyShellBackground), so this is a one-time seed, not
		// the app's actual background. Matches the current default theme's
		// surface; the old value was a cream from a theme default that no
		// longer exists, which is why every reload flashed cream.
		backgroundColor: '#fff8f7'
	},
	plugins: {
		Keyboard: {
			// 'none' → the keyboard OVERLAYS the web view; the OS does NOT
			// resize it. That avoids the full-page relayout that made the
			// compose take ~0.5s to "catch up" when the keyboard opened.
			// We lift only the compose bar above the keyboard with a GPU
			// transform (see app.css `body.native-app.kb-native-open`), using
			// the keyboard height captured in native.js — pure compositing,
			// no reflow.
			resize: 'none',
			resizeOnFullScreen: true
		},
		SplashScreen: {
			// Auto-hide after a few seconds NO MATTER WHAT. Manual hide() in
			// initNativeShell() dismisses it sooner once that code is live,
			// but auto-hide must stay TRUE so the splash can never get stuck
			// if the page is slow or the deployed site lacks the hide call.
			launchAutoHide: true,
			launchShowDuration: 3000,
			// Matches the icon/splash lockup rather than the app's cream paper —
			// the launch image itself is black with the green mark.
			backgroundColor: '#000000',
			// No native spinner: iOS centres UIActivityIndicator, so it lands ON
			// the mark rather than around it. The animated ring is rendered by the
			// web app instead (see src/app.html), which can actually surround the
			// logo — the splash is just the static mark handing over to it.
			showSpinner: false
		}
	}
};

export default config;
