// A guest's slide deck, members-only (see $lib/server/archive-members.js).
// Waiting on the /app layout runs its sign-in and class-approval redirects
// first, the same as the Archive page, so signed URLs only go to members.
import { error } from '@sveltejs/kit';
import { memberDeck } from '$lib/server/archive-members.js';

export async function load({ parent, params, setHeaders }) {
	await parent();
	const deck = await memberDeck(params.slug);
	if (!deck) error(404, 'Not found');
	setHeaders({ 'cache-control': 'private, no-store' });
	return { deck };
}
