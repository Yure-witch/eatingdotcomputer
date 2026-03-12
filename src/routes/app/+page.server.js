import { redirect } from '@sveltejs/kit';
import { signOut } from '../../auth.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');
	return { session };
}

export const actions = {
	signout: async (event) => {
		await signOut(event, { redirect: false });
		redirect(303, '/login');
	}
};
