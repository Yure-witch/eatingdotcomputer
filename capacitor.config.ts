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
		// Shows through behind the (non-overlaying) status bar — set to the
		// app's declared default --paper (md-sys-color-surface fallback) so
		// the strip blends with the header on the default light theme.
		backgroundColor: '#f7f2ea'
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
			backgroundColor: '#faf7ef',
			showSpinner: false
		}
	}
};

export default config;
