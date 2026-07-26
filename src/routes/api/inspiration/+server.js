import { json, error } from '@sveltejs/kit';
import {
	getInspirationFeed,
	requestMoreInspiration,
	setInspirationSaved,
	setInspirationRating,
	setInspirationTopics,
	exportInspiration
} from '$lib/server/inspiration.js';
import { scoutStatus } from '$lib/server/scout.js';

// GET          — the caller's feed; materializes finished batches,
//                auto-enqueues when stale, reports `pending` for polling
// GET ?history — everything ever shown, including expired + disliked
// GET ?export  — downloadable JSON snapshot of topics + signals + the
//                derived taste model ("my algorithm")
// POST { more: true }             — enqueue the next batch now
// POST { topics: "…" }            — set the search topics ('' resets to interests)
// POST { itemId, saved }          — save / unsave
// POST { itemId, rating: 1|-1|0 } — like / dislike / clear
export async function GET({ locals, url }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	if (url.searchParams.get('export')) {
		const data = await exportInspiration(session.user.id);
		if (!data) error(503, 'Database unavailable');
		return new Response(JSON.stringify(data, null, 2), {
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': 'attachment; filename="inspiration-algorithm.json"'
			}
		});
	}

	const history = !!url.searchParams.get('history');
	const feed = await getInspirationFeed(session.user.id, { history });
	const scout = await scoutStatus().catch(() => ({ online: false }));
	return json({ ...feed, scoutOnline: scout.online });
}

export async function POST({ locals, request }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const body = await request.json().catch(() => ({}));

	if (body?.more) {
		const queued = await requestMoreInspiration(session.user.id);
		return json({ ok: true, pending: queued });
	}

	if ('topics' in body) {
		await setInspirationTopics(session.user.id, body.topics);
		// New topics → new batch right away so the change is felt.
		const queued = await requestMoreInspiration(session.user.id);
		return json({ ok: true, pending: queued });
	}

	const itemId = Number(body?.itemId);
	if (!itemId) error(400, 'Missing itemId');

	if ('rating' in body) {
		const ok = await setInspirationRating(session.user.id, itemId, Number(body.rating));
		if (!ok) error(404, 'Item not found');
	} else {
		const ok = await setInspirationSaved(session.user.id, itemId, !!body?.saved);
		if (!ok) error(404, 'Item not found');
	}
	return json({ ok: true });
}
