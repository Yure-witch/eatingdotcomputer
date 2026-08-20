/**
 * Drop every cached asset and reload onto whatever is actually deployed.
 *
 * Shared by the dev refresh switch (`dev/refreshNeeded`) and the chunk-error
 * recovery in the root layout, because both want the same thing: get off this
 * build entirely, not just re-run it.
 *
 * Every step is optional and the reload happens regardless — a browser that
 * refuses one of them still ends up on a fresh load.
 */
export async function hardRefresh() {
	try {
		if ('serviceWorker' in navigator) {
			const regs = await navigator.serviceWorker.getRegistrations();
			await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
		}
	} catch { /* not fatal */ }
	try {
		if (typeof caches !== 'undefined') {
			const keys = await caches.keys();
			await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
		}
	} catch { /* not fatal */ }
	// Cache-bust the document itself: iOS will otherwise re-serve the same HTML.
	try {
		const u = new URL(location.href);
		u.searchParams.set('_r', String(Date.now()));
		location.replace(u.toString());
		return;
	} catch { /* fall through */ }
	location.reload();
}

/**
 * Recover from "Failed to fetch dynamically imported module".
 *
 * A page loaded from one build holds that build's content-hashed chunk names.
 * Deploy again and those files are gone, so the FIRST lazy import that page
 * attempts — a route it hasn't visited yet — 404s, and the route silently
 * never renders. The app looks stuck on old code because it literally is: the
 * shell is live, the new parts can't load, and nothing says so. On a device
 * that keeps the app open across a day of deploys this is guaranteed, and it
 * is indistinguishable from "your change didn't ship".
 *
 * Vite fires `vite:preloadError` for exactly this. One reload onto the current
 * build fixes it; the sessionStorage guard means a genuinely broken deploy
 * can't put us in a reload loop.
 */
export function installChunkErrorRecovery() {
	if (typeof window === 'undefined') return;
	const KEY = 'ec:chunk-reload';
	const recover = (event) => {
		event?.preventDefault?.();
		try {
			if (sessionStorage.getItem(KEY)) return; // already tried this session
			sessionStorage.setItem(KEY, String(Date.now()));
		} catch { /* private mode — accept the small loop risk over no recovery */ }
		hardRefresh();
	};
	window.addEventListener('vite:preloadError', recover);
	// Belt and braces: dynamic-import failures that don't surface as that event
	// still arrive as an unhandled rejection with a recognisable message.
	window.addEventListener('unhandledrejection', (e) => {
		const msg = String(e?.reason?.message ?? e?.reason ?? '');
		if (/dynamically imported module|Importing a module script failed/i.test(msg)) recover(e);
	});
	// A load that succeeds means whatever we recovered from is behind us.
	try {
		if (sessionStorage.getItem(KEY)) {
			window.addEventListener('load', () => {
				setTimeout(() => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }, 5000);
			});
		}
	} catch { /* ignore */ }
}
