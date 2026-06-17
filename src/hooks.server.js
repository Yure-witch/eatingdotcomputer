export { handle } from './auth.js';

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

	return {
		message: err?.message || (typeof message === 'string' ? message : 'Internal Error'),
		// libsql/Turso etc. attach a `.code` (e.g. BLOCKED, SQLITE_*) — very useful.
		code: err?.code ? String(err.code) : undefined,
		// First few stack frames, enough to locate the source without a wall of text.
		detail: err?.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : undefined
	};
}
