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
	// How long one recovery attempt suppresses the next. Long enough that a
	// genuinely broken deploy can't spin, short enough that a SECOND chunk
	// failure later in the same session still gets rescued.
	const COOLDOWN_MS = 30000;
	const recover = (event) => {
		// preventDefault ONLY once we've committed to reloading. On
		// `vite:preloadError` it tells Vite the error is handled, and Vite then
		// resolves the failed import with `undefined` instead of rejecting. It
		// used to run first, above the guard — so every chunk failure inside the
		// cooldown (or, before that, for the rest of the session) was swallowed
		// AND left unrecovered: the route import quietly "succeeded" with
		// nothing, and the navigation died without an error anyone could see.
		// Declining lets the rejection reach SvelteKit, which checks for a new
		// build and does the navigation as a full page load itself.
		try {
			// TIME-BOXED, not once-per-session. This used to be a bare presence
			// check cleared by a `load` listener registered here — and this runs
			// from onMount, so if `load` had already fired the listener never ran,
			// and if the page was broken enough not to finish loading it never
			// fired at all. Either way the key stuck and every LATER chunk error
			// in the tab was silently ignored, which is the "I had to clear the
			// cache by hand" case. The timestamp was already being written; it
			// just wasn't being read.
			const last = Number(sessionStorage.getItem(KEY) ?? 0);
			if (last && Date.now() - last < COOLDOWN_MS) return;
			sessionStorage.setItem(KEY, String(Date.now()));
		} catch { /* private mode — accept the small loop risk over no recovery */ }
		event?.preventDefault?.();
		hardRefresh();
	};
	window.addEventListener('vite:preloadError', recover);
	// Belt and braces: dynamic-import failures that don't surface as that event
	// still arrive as an unhandled rejection.
	window.addEventListener('unhandledrejection', (e) => {
		const reason = e?.reason;
		const msg = String(reason?.message ?? reason ?? '');
		// Chrome/Firefox name the failure. Safari does NOT — a route chunk that
		// 404s there rejects with a bare `TypeError: Load failed`, which is also
		// what every ordinary failed fetch says, so the message alone can't be
		// trusted. What separates them is the URL: match on it wherever it shows
		// up (message, stack, or the filename Safari attaches to the error).
		const where = `${msg} ${reason?.stack ?? ''} ${reason?.sourceURL ?? ''}`;
		const named = /dynamically imported module|Importing a module script failed/i.test(msg);
		const isChunk = /\/_app\/immutable\//.test(where);
		if (named || isChunk) recover(e);
	});
}
