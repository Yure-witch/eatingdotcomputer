import { redirect } from '@sveltejs/kit';

export async function load({ parent }) {
	await parent();
	redirect(303, '/app/chat/channel/class');
}
