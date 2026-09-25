import { signIn } from '../../auth.js';
import { redirect, isRedirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals, cookies }) {
	const session = await locals.auth();
	if (session) redirect(302, '/app');
	// The native shell can't be detected server-side, so the page used to
	// SSR the web buttons and swap in the native set (Google + Apple) on
	// mount — a visible layout jump. The shell leaves a long-lived cookie on
	// its first login visit; every visit after that SSRs the native layout
	// directly and nothing shifts.
	return { isNative: cookies.get('ec-native') === '1' };
}

/** Auth.js rejected the credentials — is there a more useful reason than "no"? */
async function reasonFor(identifier) {
	if (!identifier) return 'CredentialsSignin';
	const db = getDb();
	if (!db) return 'CredentialsSignin';
	try {
		const { rows } = await db.execute({
			sql: `SELECT auth_provider, password_hash FROM users
			      WHERE lower(email) = ? OR username = ? LIMIT 1`,
			args: [identifier.toLowerCase(), identifier]
		});
		const user = rows[0];
		// 26 of 39 accounts have no password at all: they were created through
		// Google (or Apple) sign-in, which never sets one. Typing a password
		// into this form could only ever fail for them, and "Incorrect email or
		// password" sends them looking for a password that does not exist.
		if (user && !user.password_hash) {
			return String(user.auth_provider ?? '') === 'apple' ? 'UseApple' : 'UseGoogle';
		}
	} catch { /* fall through to the generic answer */ }
	return 'CredentialsSignin';
}

export const actions = {
	default: async (event) => {
		// Read a copy of the body BEFORE Auth.js consumes it, so the failure
		// path still knows who was being signed in.
		const submitted = await event.request.clone().formData().catch(() => null);
		const identifier = String(submitted?.get('email') ?? '').trim();

		try {
			return await signIn(event);
		} catch (err) {
			// A successful sign-in (and every OAuth handoff) leaves through a
			// redirect — those must pass straight through.
			if (isRedirect(err)) throw err;

			// Auth.js v5 THROWS when authorize() returns null instead of
			// redirecting back to the sign-in page. Uncaught, that renders a
			// 500 error page: a student who mistyped a password, or who has no
			// password because they signed up with Google, was told the site
			// was broken. The login page already knows how to render ?error=.
			const marker = `${err?.type ?? ''} ${err?.name ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`;
			if (!/credentialssignin|credentials/i.test(marker)) throw err;

			redirect(303, `/login?error=${await reasonFor(identifier)}`);
		}
	}
};
