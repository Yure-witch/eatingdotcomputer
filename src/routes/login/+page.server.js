import { signIn } from '../../auth.js';
import { redirect } from '@sveltejs/kit';

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

export const actions = { default: signIn };
