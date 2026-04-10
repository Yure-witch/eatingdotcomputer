import { redirect } from '@sveltejs/kit';

export async function load({ parent }) {
	const { channels } = await parent();
	const first = channels?.[0];
	redirect(303, first ? `/app/chat/channel/${first.id}` : '/app');
}
