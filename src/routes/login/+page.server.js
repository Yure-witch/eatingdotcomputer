import { signIn } from '../../auth.js';
import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
	const session = await locals.auth();
	if (session) redirect(302, '/app');
}

export const actions = { default: signIn };
