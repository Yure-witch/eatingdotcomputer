export { handle } from './auth.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

/**
 * Mirror server errors into RTDB at `dev/errors`, newest last, alongside the
 * dev refresh switch.
 *
 * The 500 page already shows the message and stack to whoever hit it — but
 * that only helps if the person looking at it can read it back to whoever is
 * fixing it. Recording them makes a production 500 something that can be
 * inspected directly instead of relayed, which matters most for the errors
 * that only happen on a signed-in route or a real device.
 *
 * Strictly best-effort and deliberately swallow-everything: a diagnostic that
 * can throw turns one failure into two, and it runs on the path where things
 * are already going wrong.
 */
function recordError(status, event, err) {
	// 5xx only. handleError fires for every 404 too — a missing favicon is not
	// an error anyone needs recorded, and at one row per request the real
	// failures get buried within seconds.
	if ((status ?? 500) < 500) return;
	try {
		getAdminDb().ref('dev/errors').push({
			at: Date.now(),
			status: status ?? 500,
			method: event?.request?.method ?? 'GET',
			path: event?.url?.pathname ?? '',
			message: String(err?.message ?? err ?? '').slice(0, 400),
			code: err?.code ? String(err.code) : null,
			// The first frames locate it; the rest is noise at this size.
			frame: err?.stack ? String(err.stack).split('\n').slice(1, 4).join(' | ').slice(0, 400) : null
		}).catch(() => {});
	} catch { /* never let the recorder add a second failure */ }
}

/**
 * Surface real server-error details to the frontend (instead of SvelteKit's
 * generic "Internal Error"), so a 500 tells you WHAT broke at a glance. The
 * returned object becomes `$page.error`, which +error.svelte renders.
 *
 * NOTE: this exposes server error messages/stack to the client. That's handy
 * for a private class app + debugging; gate it (e.g. instructor-only, or
 * dev-only) before a wide public launch if that's a concern.
 *
 * @type {import('@sveltejs/kit').HandleServerError}
 */
export function handleError({ error, event, status, message }) {
	const err = error instanceof Error ? error : null;
	// Full detail in the server logs (terminal / hosting dashboard).
	console.error(`\n[${status ?? 500}] ${event.request?.method ?? 'GET'} ${event.url?.pathname ?? ''}\n`, error);
	recordError(status, event, err ?? error);

	return {
		message: err?.message || (typeof message === 'string' ? message : 'Internal Error'),
		// libsql/Turso etc. attach a `.code` (e.g. BLOCKED, SQLITE_*) — very useful.
		code: err?.code ? String(err.code) : undefined,
		// First few stack frames, enough to locate the source without a wall of text.
		detail: err?.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : undefined
	};
}
