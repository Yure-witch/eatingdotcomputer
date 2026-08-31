import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { bumpPollLive } from '$lib/server/poll-live.js';
import { seededShuffle, reconcile, tally, tallyFavorites, checkFavoritesBallot, isGuestId, foldLabel } from '$lib/server/lab-polls.js';
import { MAX_ITEMS, MAX_LABEL } from '$lib/server/lab-polls.js';

// PUBLIC — no session, no account. Someone scanned a QR off a projector and
// the only thing between them and taking part should be a name and a drag.
//
// Because it's unauthenticated it exposes exactly the poll being shared and
// nothing else: no poll list, no ids that aren't already in the URL, no
// respondent names, and no tally unless the instructor turned live results on.

const MAX_NAME = 60;

async function loadShared(db, code) {
	const res = await db.execute({
		sql: `SELECT * FROM lab_polls WHERE share_code = ?`,
		args: [String(code ?? '').toUpperCase()]
	});
	const p = res.rows[0];
	// Same answer for "no such code" and "sharing was turned off", so the
	// endpoint isn't a probe for which codes exist.
	if (!p) error(404, 'That code is not open');
	return p;
}

const loadItems = async (db, id) =>
	(await db.execute({
		sql: `SELECT id, label FROM lab_poll_items WHERE poll_id = ? ORDER BY position ASC, id ASC`,
		args: [id]
	})).rows.map((r) => ({ id: Number(r.id), label: String(r.label) }));

export async function GET({ params, url }) {
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const poll = await loadShared(db, params.code);
	const pollId = Number(poll.id);
	const items = await loadItems(db, pollId);
	const itemIds = items.map((i) => i.id);

	const isFavorites = String(poll.format ?? 'full') === 'favorites';

	const guestId = url.searchParams.get('g');
	let myRanking = null;
	let myLeast = null;
	let myName = null;
	if (isGuestId(guestId)) {
		const mine = (await db.execute({
			sql: `SELECT ranking, ranking_least, guest_name FROM lab_poll_ballots WHERE poll_id = ? AND user_id = ?`,
			args: [pollId, guestId]
		})).rows[0];
		if (mine) {
			// 'full' comes back complete so it stays submittable; 'favorites'
			// stays partial, because that's what the format means.
			const fallback = isFavorites ? [] : itemIds;
			try { myRanking = reconcile(JSON.parse(String(mine.ranking)), itemIds, fallback); } catch { myRanking = null; }
			if (isFavorites) {
				try { myLeast = reconcile(JSON.parse(String(mine.ranking_least ?? '[]')), itemIds, []); } catch { myLeast = null; }
			}
			myName = mine.guest_name ? String(mine.guest_name) : null;
		}
	}

	// Shuffled per guest so the instructor's typing order doesn't become the
	// room's answer, but stable for one phone across reloads.
	const order = isFavorites
		? seededShuffle(itemIds, `${guestId ?? 'anon'}:${pollId}`)
		: (myRanking ?? seededShuffle(itemIds, `${guestId ?? 'anon'}:${pollId}`));
	const byId = new Map(items.map((i) => [i.id, i]));

	const responseCount = Number((await db.execute({
		sql: `SELECT COUNT(*) AS n FROM lab_poll_ballots WHERE poll_id = ?`,
		args: [pollId]
	})).rows[0].n);

	// Same rule as in-app: a tally before you've ranked is just anchoring, so
	// it needs live results ON and your own ballot already in.
	let results = null;
	if (String(poll.reveal) === 'always' && myRanking) {
		const ballots = (await db.execute({
			sql: `SELECT ranking, ranking_least FROM lab_poll_ballots WHERE poll_id = ?`,
			args: [pollId]
		})).rows;
		const parsed = [];
		for (const b of ballots) {
			try {
				// [] fallback: never append a late-added item to an earlier
				// ballot, which would record that voter as ranking it last.
				const fav = reconcile(JSON.parse(String(b.ranking)), itemIds, []);
				if (isFavorites) {
					parsed.push({ fav, least: reconcile(JSON.parse(String(b.ranking_least ?? '[]')), itemIds, []) });
				} else {
					parsed.push(fav);
				}
			} catch { /* skip a corrupt ballot */ }
		}
		results = isFavorites ? tallyFavorites(items, parsed) : tally(items, parsed);
	}

	return json({
		poll: {
			title: String(poll.title),
			prompt: poll.prompt ? String(poll.prompt) : null,
			status: String(poll.status),
			format: isFavorites ? 'favorites' : 'full',
			allowWriteIns: Number(poll.allow_write_ins ?? 0) === 1,
			minFavorites: Number(poll.min_favorites ?? 0),
			minLeast: Number(poll.min_least ?? 0)
		},
		items: order.map((i) => byId.get(i)).filter(Boolean),
		myRanking,
		myLeast,
		myName,
		responseCount,
		results
	});
}

/** A guest adds their own thing to the pool. */
export async function PUT({ params, request }) {
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const poll = await loadShared(db, params.code);
	if (String(poll.status) !== 'open') error(409, 'This poll has closed');
	if (Number(poll.allow_write_ins ?? 0) !== 1) error(403, 'This poll does not take write-ins');
	const pollId = Number(poll.id);

	const body = await request.json().catch(() => ({}));
	if (!isGuestId(body?.guestId)) error(400, 'Missing device id');
	const label = String(body?.label ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
	if (!label) error(400, 'Type something first');
	const who = String(body?.name ?? '').trim().slice(0, 60) || null;

	const existing = await loadItems(db, pollId);
	if (existing.length >= MAX_ITEMS) error(409, `That pool is full (${MAX_ITEMS} is the limit)`);
	// Reuse rather than reject: from the adder's point of view their thing is
	// in the pool either way, and three spellings of one album would split the
	// tally between bars that ought to be one.
	const dupe = existing.find((i) => foldLabel(i.label) === foldLabel(label));
	if (dupe) return json({ id: dupe.id, duplicate: true });

	const inserted = await db.execute({
		sql: `INSERT INTO lab_poll_items (poll_id, label, position, added_by, added_by_name)
		      VALUES (?, ?, ?, ?, ?) RETURNING id`,
		args: [pollId, label, existing.length, body.guestId, who]
	});
	await bumpPollLive(pollId);
	return json({ id: Number(inserted.rows[0].id) }, { status: 201 });
}

export async function POST({ params, request }) {
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const poll = await loadShared(db, params.code);
	if (String(poll.status) !== 'open') error(409, 'This poll has closed');
	const pollId = Number(poll.id);

	const body = await request.json().catch(() => ({}));
	const guestId = body?.guestId;
	if (!isGuestId(guestId)) error(400, 'Missing device id');

	const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
	if (!name) error(400, 'Please put a name in');

	const itemIds = (await loadItems(db, pollId)).map((i) => i.id);
	const sent = Array.isArray(body?.ranking) ? body.ranking.map(Number) : [];

	// Keyed on the phone's guest id in both formats, so coming back to fix
	// your picks updates your ballot instead of stuffing the tally with a
	// second one.
	if (String(poll.format ?? 'full') === 'favorites') {
		const least = Array.isArray(body?.rankingLeast) ? body.rankingLeast.map(Number) : [];
		const bad = checkFavoritesBallot(sent, least, itemIds, Number(poll.min_favorites), Number(poll.min_least));
		if (bad) error(400, bad);
		// first_* on INSERT only — never in DO UPDATE. See migration 073.
		await db.execute({
			sql: `INSERT INTO lab_poll_ballots
			        (poll_id, user_id, ranking, ranking_least, first_ranking, first_ranking_least,
			         first_at, guest_name, submitted_at)
			      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
			      ON CONFLICT (poll_id, user_id)
			      DO UPDATE SET ranking = excluded.ranking, ranking_least = excluded.ranking_least,
			                    guest_name = excluded.guest_name, submitted_at = excluded.submitted_at`,
			args: [pollId, guestId, JSON.stringify(sent), JSON.stringify(least),
			       JSON.stringify(sent), JSON.stringify(least), name]
		});
		await bumpPollLive(pollId);
		return json({ ok: true });
	}

	// A full ranking only means something as a COMPLETE ordering, so anything
	// that isn't an exact permutation is rejected rather than quietly padded.
	const unique = new Set(sent);
	const complete =
		sent.length === itemIds.length && unique.size === sent.length && itemIds.every((i) => unique.has(i));
	if (!complete) error(409, 'This poll changed — reload and rank it again');

	await db.execute({
		sql: `INSERT INTO lab_poll_ballots
		        (poll_id, user_id, ranking, first_ranking, first_at, guest_name, submitted_at)
		      VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'))
		      ON CONFLICT (poll_id, user_id)
		      DO UPDATE SET ranking = excluded.ranking, guest_name = excluded.guest_name,
		                    submitted_at = excluded.submitted_at`,
		args: [pollId, guestId, JSON.stringify(sent), JSON.stringify(sent), name]
	});
	await bumpPollLive(pollId);

	return json({ ok: true });
}
