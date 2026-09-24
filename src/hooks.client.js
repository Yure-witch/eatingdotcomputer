import { version } from '$app/environment';

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

	// Let SvelteKit render its normal error page.
	return { message: 'Something went wrong.' };
}
