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
export function handleError({ error, event }) {
	const err = error instanceof Error ? error : null;
	try {
		const payload = {
			path: event?.url?.pathname ?? location?.pathname ?? '',
			message: String(err?.message ?? error ?? ''),
			code: err?.name ?? null,
			frame: err?.stack ? String(err.stack).split('\n').slice(1, 4).join(' | ') : null,
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
