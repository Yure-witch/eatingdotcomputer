import { json, error } from '@sveltejs/kit';
import {
	getInspirationFeed,
	getClassFeed,
	getClassWeeklyFeeds,
	requestMoreInspiration,
	requestMoreClass,
	requestMoreWeekly,
	setInspirationSaved,
	setInspirationRating,
	reactClassItem,
	setInspirationTopics,
	exportInspiration,
	getStudentInsights
} from '$lib/server/inspiration.js';
import { scoutStatus } from '$lib/server/scout.js';
import { DEFAULT_CLASS } from '$lib/server/gemma-digest.js';

// GET ?scope=class      — the shared class feed (syllabus-driven)
// GET (?scope=mine)     — the caller's personal feed (default)
// GET ?history          — personal: everything ever shown
// GET ?export           — personal: JSON snapshot of the algorithm
// GET ?insights=1       — instructor: what every student likes
// POST { more, scope }              — enqueue a class/personal batch
// POST { topics }                   — set personal search topics
// POST { scope:'class', itemId, rating|saved } — react to a class item
// POST { itemId, rating|saved }     — react to a personal item
export async function GET({ locals, url }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	if (url.searchParams.get('insights')) {
		if (session.user.role !== 'instructor') error(403, 'Instructors only');
		return json(await getStudentInsights(DEFAULT_CLASS));
	}

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

	const scout = await scoutStatus().catch(() => ({ online: false }));

	if (url.searchParams.get('scope') === 'class') {
		if (url.searchParams.get('mode') === 'weekly') {
			const feed = await getClassWeeklyFeeds(session.user.id, DEFAULT_CLASS);
			return json({ ...feed, scope: 'class', mode: 'weekly', scoutOnline: scout.online });
		}
		const feed = await getClassFeed(session.user.id, DEFAULT_CLASS);
		return json({ ...feed, scope: 'class', scoutOnline: scout.online });
	}

	const history = !!url.searchParams.get('history');
	const feed = await getInspirationFeed(session.user.id, { history });
	return json({ ...feed, scope: 'mine', scoutOnline: scout.online });
}

export async function POST({ locals, request }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const body = await request.json().catch(() => ({}));
	const scope = body?.scope === 'class' ? 'class' : 'mine';

	if (body?.more) {
		let queued;
		if (scope === 'class') {
			queued = body?.mode === 'weekly'
				? await requestMoreWeekly(DEFAULT_CLASS)
				: await requestMoreClass(DEFAULT_CLASS);
		} else {
			queued = await requestMoreInspiration(session.user.id);
		}
		return json({ ok: true, pending: queued });
	}

	if ('topics' in body) {
		await setInspirationTopics(session.user.id, body.topics);
		const queued = await requestMoreInspiration(session.user.id);
		return json({ ok: true, pending: queued });
	}

	const itemId = Number(body?.itemId);
	if (!itemId) error(400, 'Missing itemId');

	if (scope === 'class') {
		// Reactions to shared class items live in inspiration_reactions.
		const patch = {};
		if ('rating' in body) patch.rating = Number(body.rating);
		if ('saved' in body) patch.saved = !!body.saved;
		const ok = await reactClassItem(session.user.id, itemId, patch);
		if (!ok) error(404, 'Item not found');
		return json({ ok: true });
	}

	if ('rating' in body) {
		const ok = await setInspirationRating(session.user.id, itemId, Number(body.rating));
		if (!ok) error(404, 'Item not found');
	} else {
		const ok = await setInspirationSaved(session.user.id, itemId, !!body?.saved);
		if (!ok) error(404, 'Item not found');
	}
	return json({ ok: true });
}
