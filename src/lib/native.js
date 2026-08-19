/**
 * Native-shell bridge. Safe to import anywhere — every native call is
 * guarded by isNativeApp(), so on the plain web/PWA this module is inert.
 *
 * The app runs in three places:
 *   - desktop/mobile browser  → isNativeApp() === false
 *   - installed PWA           → isNativeApp() === false
 *   - Capacitor native shell  → isNativeApp() === true
 */
import { Capacitor } from '@capacitor/core';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Set this to the App Store listing URL once the app is approved. While it's
 * null, the "Get the app" banner stays hidden (no dead link). The moment you
 * paste the real URL here, the banner lights up for mobile-web visitors.
 */
export const APP_STORE_URL = null;

/** True only inside the Capacitor native shell (iOS/Android app). */
export function isNativeApp() {
	try {
		return Capacitor.isNativePlatform();
	} catch {
		return false;
	}
}

/** Coarse-pointer (touch) device — phones/tablets, not desktop. */
export function isTouchWeb() {
	if (typeof window === 'undefined') return false;
	return !!window.matchMedia?.('(pointer: coarse)')?.matches;
}

/**
 * Programmatic WebGPU-availability probe. Resolves true only if the browser
 * exposes navigator.gpu AND a GPU adapter can actually be acquired (some
 * browsers expose the API but fail requestAdapter on the real hardware).
 * Cached — the adapter request runs at most once per session.
 */
let _webgpuProbe = null;
export function hasWebGPU() {
	if (_webgpuProbe) return _webgpuProbe;
	_webgpuProbe = (async () => {
		try {
			if (typeof navigator === 'undefined' || !navigator.gpu) return false;
			const adapter = await navigator.gpu.requestAdapter();
			return !!adapter;
		} catch {
			return false;
		}
	})();
	return _webgpuProbe;
}

/** iOS user agent (incl. iPadOS-as-Mac), used for App Store wording. */
export function isIOSWeb() {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	if (/iPhone|iPad|iPod/.test(ua)) return true;
	return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * Whether to nudge this visitor to install the native app: a touch web
 * browser (not the native shell, not desktop) with a live store link.
 */
export function shouldPromoteApp() {
	return !!APP_STORE_URL && !isNativeApp() && isTouchWeb();
}

/**
 * Fire a haptic tap. No-op on web, so it's safe to sprinkle on any
 * interaction. Kinds:
 *   'light' | 'medium' | 'heavy'  → impact (taps, sends, button presses)
 *   'selection'                    → light tick (toggles, tab switches)
 *   'success' | 'warning' | 'error'→ notification feedback
 */
export async function haptic(kind = 'light') {
	if (!isNativeApp()) return;
	try {
		const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
		if (kind === 'selection') return void Haptics.selectionStart().then(() => Haptics.selectionEnd());
		if (kind === 'success') return void Haptics.notification({ type: NotificationType.Success });
		if (kind === 'warning') return void Haptics.notification({ type: NotificationType.Warning });
		if (kind === 'error') return void Haptics.notification({ type: NotificationType.Error });
		const style = kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
		await Haptics.impact({ style });
	} catch {}
}

/**
 * Flip the status-bar icon colour (clock / battery / signal) to match the
 * current app theme so they stay legible against the themed notch strip.
 * Call on theme change. No-op on web.
 *   light theme → dark icons (Style.Light)   dark theme → light icons (Style.Dark)
 */
export async function updateStatusBarTheme() {
	if (!isNativeApp()) return;
	try {
		const { StatusBar, Style } = await import('@capacitor/status-bar');
		const dark = typeof document !== 'undefined'
			&& document.documentElement.classList.contains('theme-dark');
		await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
	} catch {}
}

/**
 * One-time native setup — call from the root layout onMount. No-op on web.
 *  - tags <body> with `native-app` so CSS can apply the native-feel pass
 *  - themes the status bar
 *  - wires the OS keyboard (height → CSS var, open class, no input toolbar)
 *  - hides the launch splash once we're up (kills the white flash)
 *  - re-emits app-resume + network changes as window events the app can use
 */
export async function initNativeShell() {
	if (!isNativeApp()) return;
	document.body.classList.add('native-app');

	try {
		const { StatusBar, Style } = await import('@capacitor/status-bar');
		// Status bar OVERLAYS the web view so the header's cream background
		// paints up into the notch (tan strip that matches the header). The
		// header + app shell pad down by max(env(safe-area-inset-top), 44px) —
		// the 44px floor covers the case where this web view reports the inset
		// as 0 (which pushed the logo under the clock when we relied on env
		// alone). See `body.native-app` rules in app.css.
		await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
	} catch {}
	// Match the status-bar icon colour to the current theme so the clock /
	// battery stay legible against the (themed) notch strip.
	await updateStatusBarTheme();

	try {
		const { Keyboard } = await import('@capacitor/keyboard');
		const root = document.documentElement;
		// Hide the grey iOS input-accessory toolbar above the keyboard —
		// we have our own compose chrome, so it's just visual noise.
		Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
		Keyboard.addListener('keyboardWillShow', (info) => {
			const kb = info?.keyboardHeight ?? 0;
			root.style.setProperty('--kb-height', `${kb}px`);
			document.body.classList.add('kb-native-open');
			// resize:'none' means the web view doesn't shrink, so nothing
			// auto-scrolls. The ::after spacer (app.css) adds `kb` px of
			// scroll room at the bottom; shift the view up by the keyboard
			// height so whatever was at the bottom rises above the keyboard
			// instead of hiding behind it. Two rAFs so the spacer's height is
			// laid out before we scroll into it.
			requestAnimationFrame(() => requestAnimationFrame(() => {
				const list = document.querySelector('.message-list');
				if (list) list.scrollTop += kb;
			}));
		});
		Keyboard.addListener('keyboardWillHide', () => {
			document.body.classList.remove('kb-native-open');
			root.style.setProperty('--kb-height', '0px');
		});
	} catch {}

	try {
		const { SplashScreen } = await import('@capacitor/splash-screen');
		// We loaded; drop the splash. Small delay avoids a flash-of-blank
		// between splash hide and the live site's first paint.
		setTimeout(() => SplashScreen.hide().catch(() => {}), 200);
	} catch {}

	try {
		const { App } = await import('@capacitor/app');
		// Foreground resume → let the app reconnect presence / refetch.
		App.addListener('appStateChange', ({ isActive }) => {
			if (isActive) window.dispatchEvent(new CustomEvent('native-resume'));
		});
	} catch {}

	try {
		const { Network } = await import('@capacitor/network');
		Network.addListener('networkStatusChange', (status) => {
			document.body.classList.toggle('net-offline', !status.connected);
			window.dispatchEvent(new CustomEvent('native-network', { detail: status }));
		});
	} catch {}

	// Native push (APNs). Web-push doesn't work inside the WKWebView, so this is
	// the ONLY notification channel for App Store installs.
	registerNativePush();
}

// The last APNs device token we saw, so we can re-associate it with the user
// after a sign-in (the token POST needs a session; on the login screen it 401s,
// but a fresh sign-in reloads the app and this re-runs authed) and on resume.
let _apnsToken = null;
async function _postApnsToken(token) {
	if (!token) return false;
	try {
		const res = await fetch('/api/push/apns', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token, platform: 'ios' })
		});
		return res.ok;
	} catch { return false; }
}

/**
 * Ask for notification permission, register with APNs, and hand the device
 * token to the server. Tapping a delivered notification routes to its url.
 * No-op on web. Safe to call more than once (register() is idempotent).
 */
export async function registerNativePush() {
	if (!isNativeApp()) return;
	try {
		const { PushNotifications } = await import('@capacitor/push-notifications');
		let perm = await PushNotifications.checkPermissions();
		if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
			perm = await PushNotifications.requestPermissions();
		}
		if (perm.receive !== 'granted') return;

		PushNotifications.addListener('registration', (t) => {
			_apnsToken = t?.value || null;
			_postApnsToken(_apnsToken);
		});
		PushNotifications.addListener('registrationError', (e) => console.warn('[push] APNs registration error', e));
		// Tap on a notification → open its target (chat / thread / mention).
		PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
			const url = action?.notification?.data?.url;
			if (url) { try { window.location.assign(url); } catch {} }
		});
		await PushNotifications.register();

		// Re-associate the token with the current user when the app foregrounds
		// (covers a token that first registered before the user signed in).
		window.addEventListener('native-resume', () => { if (_apnsToken) _postApnsToken(_apnsToken); });
	} catch (e) {
		console.warn('[push] native push setup failed', e);
	}
}

/**
 * Native Google sign-in. Google blocks OAuth inside an embedded WKWebView
 * (`disallowed_useragent`), so inside the shell the "Continue with Google"
 * button can't use the normal redirect flow. We sign in with the native Google
 * SDK instead and return the resulting ID token — the login page posts it to
 * the `google-native` provider (see src/auth.js), which verifies it and issues
 * the ordinary Auth.js session cookie.
 *
 * @returns {Promise<string|null>} the Google ID token, or null if unavailable
 *   or the user cancelled.
 */
export async function nativeGoogleIdToken() {
	if (!isNativeApp()) return null;
	const iosClientId = publicEnv.PUBLIC_GOOGLE_IOS_CLIENT_ID;
	if (!iosClientId) {
		console.warn('[auth] PUBLIC_GOOGLE_IOS_CLIENT_ID is unset — native Google sign-in disabled');
		return null;
	}
	const { SocialLogin } = await import('@capgo/capacitor-social-login');
	// initialize() is idempotent, so it's safe to call before every sign-in.
	await SocialLogin.initialize({ google: { iOSClientId: iosClientId } });
	const res = await SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'] } });
	const idToken = res?.result?.idToken ?? null;
	if (!idToken) {
		// A resolved call with no ID token is NOT the same as a cancellation —
		// it usually means the SDK came back in offline mode or the client ID
		// doesn't match the bundle. Log the shape so the difference is visible.
		console.warn('[auth] Google login resolved without an idToken:', JSON.stringify(res ?? null));
	}
	return idToken;
}

/**
 * Native "Sign in with Apple". Offered only inside the shell — App Store
 * Guideline 4.8 requires a privacy-preserving login option alongside Google.
 * Apple returns the user's display name ONLY on the first authorisation, so we
 * pass it back for the server to persist on account creation.
 *
 * @returns {Promise<{idToken: string, name: string}|null>}
 */
export async function nativeAppleIdToken() {
	if (!isNativeApp()) return null;
	const { SocialLogin } = await import('@capgo/capacitor-social-login');
	await SocialLogin.initialize({ apple: {} });
	const res = await SocialLogin.login({ provider: 'apple', options: { scopes: ['name', 'email'] } });
	const idToken = res?.result?.idToken;
	if (!idToken) return null;
	const p = res?.result?.profile ?? {};
	const name = [p.givenName, p.familyName].filter(Boolean).join(' ');
	return { idToken, name };
}
