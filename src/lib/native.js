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
}
