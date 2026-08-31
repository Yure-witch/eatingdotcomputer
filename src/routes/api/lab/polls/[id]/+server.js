import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';
import { bumpPollLive, clearPollLive } from '$lib/server/poll-live.js';
import { seededShuffle, reconcile, tally, tallyFavorites, checkFavoritesBallot, makeShareCode, foldLabel, MAX_ITEMS, MAX_LABEL } from '$lib/server/lab-polls.js';

// Lab → Rank It: one poll — the ballot, the tally, and the instructor's controls.

async function loadPoll(db, id) {
	const res = await db.execute({ sql: `SELECT * FROM lab_polls WHERE id = ?`, args: [id] });
	const p = res.rows[0];
	if (!p) error(404, 'No such poll');
	return p;
}

const loadItems = async (db, id) =>
	(await db.execute({
		sql: `SELECT id, label, added_by, added_by_name FROM lab_poll_items WHERE poll_id = ? ORDER BY position ASC, id ASC`,
		args: [id]
	})).rows.map((r) => ({
		id: Number(r.id),
		label: String(r.label),
		addedBy: r.added_by ? String(r.added_by) : null,
		addedByName: r.added_by_name ? String(r.added_by_name) : null
	}));

async function requireInstructor(locals) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	if (session.user.role !== 'instructor') error(403, 'Instructors only');
	return session;
}

const meta = (p) => ({
	id: Number(p.id),
	title: String(p.title),
	prompt: p.prompt ? String(p.prompt) : null,
	status: String(p.status),
	reveal: String(p.reveal),
	format: String(p.format ?? 'full'),
	minFavorites: Number(p.min_favorites ?? 0),
	minLeast: Number(p.min_least ?? 0),
	allowWriteIns: Number(p.allow_write_ins ?? 0) === 1,
	shareCode: p.share_code ? String(p.share_code) : null,
	createdAt: p.created_at ? String(p.created_at) : null,
	closedAt: p.closed_at ? String(p.closed_at) : null
});

export async function GET({ params, locals }) {
	const session = await requireClassAccess(await locals.auth());
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const id = Number(params.id);
	const poll = await loadPoll(db, id);
	const items = await loadItems(db, id);
	const itemIds = items.map((i) => i.id);
	const isInstructor = session.user.role === 'instructor';

	const isFavorites = String(poll.format ?? 'full') === 'favorites';

	const ballots = (await db.execute({
		sql: `SELECT user_id, ranking, ranking_least FROM lab_poll_ballots WHERE poll_id = ?`,
		args: [id]
	})).rows;

	const mineRow = ballots.find((b) => String(b.user_id) === session.user.id);
	let myRanking = null;      // 'full': the whole ordering. 'favorites': the favorites half.
	let myLeast = null;
	if (mineRow) {
		// Two different fallbacks on purpose. A 'full' ballot must come back
		// COMPLETE or the student is looking at a list they can't submit, so
		// an item added since they voted is appended. A 'favorites' ballot is
		// partial by design — appending would put things in their favorites
		// that they never picked.
		const fallback = isFavorites ? [] : itemIds;
		try { myRanking = reconcile(JSON.parse(String(mineRow.ranking)), itemIds, fallback); } catch { myRanking = null; }
		if (isFavorites) {
			try { myLeast = reconcile(JSON.parse(String(mineRow.ranking_least ?? '[]')), itemIds, []); } catch { myLeast = null; }
		}
	}

	const byId = new Map(items.map((i) => [i.id, i]));
	// Shuffled per student so the instructor's typing order doesn't become the
	// class's answer, and stable per student so a reload doesn't scramble work
	// in progress. In 'full' format a submitted ballot comes back in its own
	// order; in 'favorites' the pool keeps its shuffle and the picks ride
	// alongside it.
	const order = isFavorites
		? seededShuffle(itemIds, `${session.user.id}:${id}`)
		: (myRanking ?? seededShuffle(itemIds, `${session.user.id}:${id}`));
	const ballotItems = order.map((i) => byId.get(i)).filter(Boolean);

	// Who may see the tally. A student watching a live tally BEFORE they rank
	// is being anchored onto the running order, so 'always' means live only
	// once their own ballot is in. Once the poll is closed it's everyone's.
	const canSeeResults =
		isInstructor || poll.status === 'closed' || (poll.reveal === 'always' && !!mineRow);

	let results = null;
	if (canSeeResults) {
		const parsed = [];
		for (const b of ballots) {
			try {
				// [] fallback here, unlike the student's own ballot above: an
				// item added after some people voted must NOT be appended to
				// their ballots, or every earlier voter is recorded as ranking
				// it last. `votes`/`mentions` reports what it actually stands on.
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

	// So the instructor knows whether to keep waiting or close it.
	// Who ranked what — WHO it was is part of the point here, not just the
	// aggregate, so the instructor gets each person's actual picks back as
	// labels rather than a name and a count.
	let respondents = null;
	if (isInstructor && ballots.length) {
		// LEFT JOIN, not JOIN: a QR guest has no users row, and an inner join
		// would silently drop every one of them.
		const rows = (await db.execute({
			sql: `SELECT u.name AS account_name, b.guest_name, b.user_id, b.ranking, b.ranking_least, b.submitted_at
			      FROM lab_poll_ballots b LEFT JOIN users u ON u.id = b.user_id
			      WHERE b.poll_id = ? ORDER BY b.submitted_at ASC`,
			args: [id]
		})).rows;
		const label = (ids) => ids.map((i) => byId.get(i)?.label).filter(Boolean);
		respondents = rows.map((r) => {
			let fav = [], least = [];
			try { fav = label(reconcile(JSON.parse(String(r.ranking)), itemIds, [])); } catch { /* corrupt ballot */ }
			if (isFavorites) {
				try { least = label(reconcile(JSON.parse(String(r.ranking_least ?? '[]')), itemIds, [])); } catch { /* corrupt ballot */ }
			}
			return {
				name: String(r.account_name ?? r.guest_name ?? 'Someone'),
				guest: String(r.user_id).startsWith('guest:'),
				submittedAt: r.submitted_at ? String(r.submitted_at) : null,
				// In 'full' format this is the whole ordering; in 'favorites'
				// it's their favorites, with `least` alongside.
				ranked: fav,
				least: isFavorites ? least : null
			};
		});
	}

	return json({
		poll: meta(poll),
		items: ballotItems,
		myRanking,
		myLeast,
		responseCount: ballots.length,
		results,
		respondents,
		canEdit: isInstructor
	});
}

/** Submit (or resubmit) a ballot. */
export async function POST({ params, request, locals }) {
	const session = await requireClassAccess(await locals.auth());
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const id = Number(params.id);
	const poll = await loadPoll(db, id);
	if (poll.status !== 'open') error(409, 'This poll is closed');

	const items = await loadItems(db, id);
	const itemIds = items.map((i) => i.id);
	const body = await request.json().catch(() => ({}));
	const sent = Array.isArray(body?.ranking) ? body.ranking.map(Number) : [];

	if (String(poll.format ?? 'full') === 'favorites') {
		const least = Array.isArray(body?.rankingLeast) ? body.rankingLeast.map(Number) : [];
		const bad = checkFavoritesBallot(sent, least, itemIds, Number(poll.min_favorites), Number(poll.min_least));
		if (bad) error(400, bad);
		await db.execute({
			sql: `INSERT INTO lab_poll_ballots (poll_id, user_id, ranking, ranking_least, submitted_at)
			      VALUES (?, ?, ?, ?, datetime('now'))
			      ON CONFLICT (poll_id, user_id)
			      DO UPDATE SET ranking = excluded.ranking, ranking_least = excluded.ranking_least,
			                    submitted_at = excluded.submitted_at`,
			args: [id, session.user.id, JSON.stringify(sent), JSON.stringify(least)]
		});
		await bumpPollLive(id);
		return json({ ok: true });
	}

	// A full ranking only means something as a COMPLETE ordering, so a ballot
	// that isn't an exact permutation of the poll's items is rejected rather
	// than quietly padded — padding would invent preferences the student never
	// expressed. The client resyncs on 409 when the poll changed underneath it.
	const unique = new Set(sent);
	const complete =
		sent.length === itemIds.length && unique.size === sent.length && itemIds.every((i) => unique.has(i));
	if (!complete) error(409, 'This poll changed — reload and rank it again');

	await db.execute({
		sql: `INSERT INTO lab_poll_ballots (poll_id, user_id, ranking, submitted_at)
		      VALUES (?, ?, ?, datetime('now'))
		      ON CONFLICT (poll_id, user_id)
		      DO UPDATE SET ranking = excluded.ranking, submitted_at = excluded.submitted_at`,
		args: [id, session.user.id, JSON.stringify(sent)]
	});
	await bumpPollLive(id);

	return json({ ok: true });
}

/**
 * Add a write-in to the pool. Open to any class member, not just the
 * instructor — that's the whole point of the format.
 */
export async function PUT({ params, request, locals }) {
	const session = await requireClassAccess(await locals.auth());
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const id = Number(params.id);
	const poll = await loadPoll(db, id);
	if (String(poll.status) !== 'open') error(409, 'This poll is closed');
	if (Number(poll.allow_write_ins ?? 0) !== 1) error(403, 'This poll does not take write-ins');

	const body = await request.json().catch(() => ({}));
	const label = String(body?.label ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
	if (!label) error(400, 'Type something first');

	const existing = await loadItems(db, id);
	if (existing.length >= MAX_ITEMS) error(409, `That pool is full (${MAX_ITEMS} is the limit)`);
	// Case- and space-insensitive, so a room doesn't end up with three bars
	// for one thing. Silently reuse the existing item rather than erroring:
	// from the adder's point of view their thing IS in the pool now.
	const dupe = existing.find((i) => foldLabel(i.label) === foldLabel(label));
	if (dupe) return json({ id: dupe.id, duplicate: true });

	const inserted = await db.execute({
		sql: `INSERT INTO lab_poll_items (poll_id, label, position, added_by, added_by_name)
		      VALUES (?, ?, ?, ?, ?) RETURNING id`,
		args: [id, label, existing.length, session.user.id, session.user.name ?? null]
	});
	// Nudge every open page so the new thing shows up in the room's pools.
	await bumpPollLive(id);
	return json({ id: Number(inserted.rows[0].id) }, { status: 201 });
}

/** Instructor: edit, open/close, or clear the responses. */
export async function PATCH({ params, request, locals }) {
	await requireInstructor(locals);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const id = Number(params.id);
	await loadPoll(db, id);
	const body = await request.json().catch(() => ({}));

	if (body?.action === 'close') {
		await db.execute({
			sql: `UPDATE lab_polls SET status = 'closed', closed_at = datetime('now') WHERE id = ?`,
			args: [id]
		});
	} else if (body?.action === 'open') {
		await db.execute({
			sql: `UPDATE lab_polls SET status = 'open', closed_at = NULL WHERE id = ?`,
			args: [id]
		});
	} else if (body?.action === 'reset') {
		await db.execute({ sql: `DELETE FROM lab_poll_ballots WHERE poll_id = ?`, args: [id] });
		await bumpPollLive(id); // back to zero, and every open page should see that
	} else if (body?.action === 'share') {
		// Retry on the unique index rather than trusting one draw — a collision
		// is rare, but handing two polls the same code would cross two rooms'
		// ballots, which is not a failure worth being casual about.
		let code = null;
		for (let attempt = 0; attempt < 8 && !code; attempt++) {
			const candidate = makeShareCode();
			try {
				await db.execute({
					sql: `UPDATE lab_polls SET share_code = ? WHERE id = ?`,
					args: [candidate, id]
				});
				code = candidate;
			} catch { /* taken — draw again */ }
		}
		if (!code) error(503, 'Could not make a code, try again');
	} else if (body?.action === 'removeItem') {
		// For clearing junk write-ins. The item goes; ballots that referenced it
		// are reconciled against the current pool at read time, so they stay
		// valid minus that pick.
		const itemId = Number(body?.itemId);
		if (itemId) {
			await db.execute({
				sql: `DELETE FROM lab_poll_items WHERE id = ? AND poll_id = ?`,
				args: [itemId, id]
			});
			await bumpPollLive(id);
		}
	} else if (body?.action === 'writeIns') {
		await db.execute({
			sql: `UPDATE lab_polls SET allow_write_ins = ? WHERE id = ?`,
			args: [body?.on ? 1 : 0, id]
		});
	} else if (body?.action === 'unshare') {
		// The code stops working; ballots already cast through it stay. The
		// public room goes with it — otherwise a phone still holding the code
		// keeps a live node to watch.
		const old = (await db.execute({ sql: `SELECT share_code FROM lab_polls WHERE id = ?`, args: [id] })).rows[0];
		await db.execute({ sql: `UPDATE lab_polls SET share_code = NULL WHERE id = ?`, args: [id] });
		await clearPollLive(id, old?.share_code ? String(old.share_code) : null);
	}

	if (typeof body?.title === 'string' && body.title.trim()) {
		await db.execute({
			sql: `UPDATE lab_polls SET title = ? WHERE id = ?`,
			args: [body.title.trim().slice(0, 200), id]
		});
	}
	if (typeof body?.prompt === 'string') {
		await db.execute({
			sql: `UPDATE lab_polls SET prompt = ? WHERE id = ?`,
			args: [body.prompt.trim().slice(0, 1000) || null, id]
		});
	}
	if (body?.reveal === 'always' || body?.reveal === 'closed') {
		await db.execute({ sql: `UPDATE lab_polls SET reveal = ? WHERE id = ?`, args: [body.reveal, id] });
	}
	// One announcement covering whatever this request changed — status, reveal,
	// text, items — so every open page refetches rather than only the changes
	// that happen to move the ballot count.
	await bumpPollLive(id);

	// Item edits keep the ids of rows that survive, so ballots already cast
	// stay meaningful — a typo fix must not reset the class's answers.
	if (Array.isArray(body?.items)) {
		const existing = new Set((await loadItems(db, id)).map((i) => i.id));
		const incoming = body.items
			.map((it) => ({
				id: Number(it?.id) || null,
				label: String(it?.label ?? '').trim().slice(0, MAX_LABEL)
			}))
			.filter((it) => it.label)
			.slice(0, MAX_ITEMS);
		if (incoming.length < 2) error(400, 'A ranking needs at least two things');

		const keep = new Set(incoming.map((it) => it.id).filter((x) => x && existing.has(x)));
		const stmts = [];
		for (const gone of existing) {
			if (!keep.has(gone)) stmts.push({ sql: `DELETE FROM lab_poll_items WHERE id = ?`, args: [gone] });
		}
		incoming.forEach((it, i) => {
			if (it.id && existing.has(it.id)) {
				stmts.push({
					sql: `UPDATE lab_poll_items SET label = ?, position = ? WHERE id = ?`,
					args: [it.label, i, it.id]
				});
			} else {
				stmts.push({
					sql: `INSERT INTO lab_poll_items (poll_id, label, position) VALUES (?, ?, ?)`,
					args: [id, it.label, i]
				});
			}
		});
		await db.batch(stmts);
	}

	return json({ ok: true });
}

export async function DELETE({ params, locals }) {
	await requireInstructor(locals);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const id = Number(params.id);
	const gone = (await db.execute({ sql: `SELECT share_code FROM lab_polls WHERE id = ?`, args: [id] })).rows[0];
	// Explicit child deletes: ON DELETE CASCADE only fires with the
	// foreign_keys pragma on, which we can't count on over libsql.
	await db.batch([
		{ sql: `DELETE FROM lab_poll_ballots WHERE poll_id = ?`, args: [id] },
		{ sql: `DELETE FROM lab_poll_items   WHERE poll_id = ?`, args: [id] },
		{ sql: `DELETE FROM lab_polls        WHERE id = ?`,      args: [id] }
	]);
	await clearPollLive(id, gone?.share_code ? String(gone.share_code) : null);
	return json({ ok: true });
}
