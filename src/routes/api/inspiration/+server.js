import { json, error } from '@sveltejs/kit';
import { getInspirationFeed, setInspirationSaved } from '$lib/server/inspiration.js';
import { scoutStatus } from '$lib/server/scout.js';

// GET          — the caller's inspiration feed (refreshes if stale)
// GET ?history — everything ever shown, including expired
// POST { itemId, saved } — save / unsave an item
export async function GET({ locals, url }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const history = !!url.searchParams.get('history');
	const feed = await getInspirationFeed(session.user.id, { history });
	const scout = await scoutStatus().catch(() => ({ online: false }));
	return json({ ...feed, scoutOnline: scout.online });
}

export async function POST({ locals, request }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const body = await request.json().catch(() => ({}));
	const itemId = Number(body?.itemId);
	if (!itemId) error(400, 'Missing itemId');
	const ok = await setInspirationSaved(session.user.id, itemId, !!body?.saved);
	if (!ok) error(404, 'Item not found');
	return json({ ok: true });
}
