import { version } from '$app/environment';
import { navigating } from '$app/state';

/**
 * Client-side error reporting. hooks.server.js records server 5xx into
 * dev/errors, which misses the class of failure that is hardest to diagnose:
 * anything that fails in the browser and never reaches the server. A chunk that
 * 404s after a deploy is exactly that — the route silently never renders, and
 * from the outside it is indistinguishable from "the change didn't ship".
 *
 * Posts to /api/dev/error because the dev/* subtree is admin-writable only.
 */
/**
 * Which requests actually failed, straight from the Resource Timing API.
 *
 * Safari reports every network failure as `TypeError: Load failed` with an
 * EMPTY stack, so the report it produces says nothing at all about what went
 * wrong — a 404'd chunk, a dead data fetch and a blocked third-party call are
 * indistinguishable. The browser does record each attempt though, and a
 * response that never arrived has `responseStatus` 0 (or no status at all on
 * older WebKit), so the recent failures name themselves.
 */
/**
 * Retry a navigation the network killed under it.
 *
 * On the iOS shell the web view's network drops out wholesale — one report
 * lists its own chunks, its own API routes, apis.google.com and R2 avatars all
 * failing inside four seconds, while those same files serve 200 from a
 * desktop. When that lands mid-navigation the route's code and data never
 * arrive: the header (already rendered) shows the new conversation while the
 * body still shows the old screen, and nothing retries. That is the "tap a
 * chat and nothing happens" bug, and why opening the app switcher and coming
 * back appears to fix it — the app reloads on resume.
 *
 * So: reload the route we were heading for, once the view is actually visible
 * and the device says it has a network. A full reload rather than a client-side
 * retry, because the module graph the failed navigation left behind is the
 * thing that is broken.
 *
 * Bounded hard: at most RETRY_LIMIT attempts per URL per tab session, cleared
 * on any successful load, so a genuinely dead network can never become a
 * reload loop.
 */
const RETRY_KEY = 'ec:nav-retry';
const RETRY_TOTAL_KEY = 'ec:nav-retry-total';
const RETRY_LIMIT = 2;
// A hard ceiling for the whole tab session that is NEVER cleared. The per-URL
// budget resets whenever a page loads, which is right — a load means the
// network came back — but on its own it would let a route that breaks
// immediately after loading reload forever: load, clear, fail, retry, load…
const RETRY_TOTAL_LIMIT = 4;
const NETWORK_ERROR = /load failed|failed to fetch|importing a module script failed|error loading dynamically imported module|networkerror/i;

function retryCount(url) {
	try {
		return Number(JSON.parse(sessionStorage.getItem(RETRY_KEY) ?? '{}')[url] ?? 0);
	} catch { return RETRY_LIMIT; } // no storage → don't retry at all
}

function noteRetry(url) {
	try {
		const all = JSON.parse(sessionStorage.getItem(RETRY_KEY) ?? '{}');
		all[url] = (Number(all[url]) || 0) + 1;
		sessionStorage.setItem(RETRY_KEY, JSON.stringify(all));
		sessionStorage.setItem(RETRY_TOTAL_KEY, String(totalRetries() + 1));
	} catch { /* private mode: the count above already refused */ }
}

function totalRetries() {
	try { return Number(sessionStorage.getItem(RETRY_TOTAL_KEY) ?? 0); } catch { return RETRY_TOTAL_LIMIT; }
}

function scheduleNavRetry(url) {
	if (!url || retryCount(url) >= RETRY_LIMIT || totalRetries() >= RETRY_TOTAL_LIMIT) return;
	const go = () => {
		if (document.visibilityState !== 'visible' || !navigator.onLine) return;
		document.removeEventListener('visibilitychange', go);
		window.removeEventListener('online', go);
		noteRetry(url);
		location.href = url;
	};
	// Visible and online already? Give the transport a breath to come back,
	// otherwise wait for whichever signal arrives — returning from the app
	// switcher fires visibilitychange, a recovered radio fires online.
	document.addEventListener('visibilitychange', go);
	window.addEventListener('online', go);
	setTimeout(go, 900);
}

function recentFailedRequests() {
	try {
		const entries = performance.getEntriesByType('resource') ?? [];
		return entries
			.slice(-40)
			.filter((e) => e.responseStatus === 0 || e.responseStatus === undefined)
			// Same-origin paths are enough; a full URL would blow the cap.
			.slice(-6)
			.map((e) => {
				const url = String(e.name).replace(location.origin, '');
				return `${url.slice(0, 70)}${e.responseStatus === undefined ? '' : `:${e.responseStatus}`}`;
			})
			.join(' , ');
	} catch {
		return null;
	}
}

// A page that loaded is proof the network came back: forget the retry budget
// so the next failure gets its own attempts.
if (typeof window !== 'undefined') {
	const clearPerUrlBudget = () => {
		try { sessionStorage.removeItem(RETRY_KEY); } catch { /* private mode */ }
	};
	// `load` may already have fired by the time this module evaluates, in which
	// case the listener alone would never run and the budget would never reset.
	if (document.readyState === 'complete') clearPerUrlBudget();
	else addEventListener('load', clearPerUrlBudget);
}

export function handleError({ error, event }) {
	const err = error instanceof Error ? error : null;
	try {
		const failed = recentFailedRequests();
		const payload = {
			path: event?.url?.pathname ?? location?.pathname ?? '',
			message: String(err?.message ?? error ?? ''),
			code: err?.name ?? null,
			// A stack when there is one; otherwise the requests that failed,
			// plus the route and whether the device thought it was online.
			frame: err?.stack
				? String(err.stack).split('\n').slice(1, 4).join(' | ')
				: [
					`route=${event?.route?.id ?? '?'}`,
					`online=${navigator.onLine}`,
					`native=${/eatingcomputer-native/.test(navigator.userAgent)}`,
					`sw=${!!navigator.serviceWorker?.controller}`,
					failed ? `failed: ${failed}` : 'failed: none recorded'
				].join(' | '),
			build: version
		};
		// keepalive so a report still goes out if this error is taking the page down.
		fetch('/api/dev/error', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			keepalive: true
		}).catch(() => {});
	} catch { /* never let reporting cause a second failure */ }

	// A navigation the network killed is worth one automatic retry — see
	// scheduleNavRetry. Only for that shape of failure: an app bug must still
	// fail visibly rather than reload in circles.
	//
	// And only for a NAVIGATION. handleError also fires for failed preloads —
	// the mobile pager warms Home/Orbit/Lab/Manage in the background, and a
	// network blip fails all of them at once — and "retrying" one of those is
	// a full page load of a route the user never asked for. You'd be reading a
	// conversation and get thrown onto Manage 900ms later. A real navigation is
	// the one `navigating` is currently pointed at.
	const isNavigation = navigating.to?.url?.pathname === event?.url?.pathname;
	if (isNavigation && NETWORK_ERROR.test(String(err?.message ?? error ?? ''))) {
		scheduleNavRetry(event?.url?.pathname ? event.url.pathname + (event.url.search ?? '') : null);
	}

	// Let SvelteKit render its normal error page.
	return { message: 'Something went wrong.' };
}
