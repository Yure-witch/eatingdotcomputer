import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';
import { parseItems, MAX_ITEMS, FORMATS, MIN_FLOOR, MIN_CEIL } from '$lib/server/lab-polls.js';

// Lab → Rank It: the poll list.
//
// Everyone in the class can read the list; only instructors create polls.

async function requireInstructor(locals) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	if (session.user.role !== 'instructor') error(403, 'Instructors only');
	return session;
}

export async function GET({ locals }) {
	const session = await requireClassAccess(await locals.auth());
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	// One query with the counts folded in — a poll list that fires two extra
	// queries per row gets slow at exactly the moment a term's worth of polls
	// has piled up.
	const res = await db.execute({
		sql: `SELECT p.*,
		             (SELECT COUNT(*) FROM lab_poll_items  i WHERE i.poll_id = p.id) AS item_count,
		             (SELECT COUNT(*) FROM lab_poll_ballots b WHERE b.poll_id = p.id) AS response_count,
		             (SELECT COUNT(*) FROM lab_poll_ballots b WHERE b.poll_id = p.id AND b.user_id = ?) AS mine
		      FROM lab_polls p
		      ORDER BY (p.status = 'open') DESC, p.created_at DESC, p.id DESC`,
		args: [session.user.id]
	});

	return json({
		polls: res.rows.map((r) => ({
			id: Number(r.id),
			title: String(r.title),
			prompt: r.prompt ? String(r.prompt) : null,
			status: String(r.status),
			reveal: String(r.reveal),
			format: String(r.format ?? 'full'),
			itemCount: Number(r.item_count),
			responseCount: Number(r.response_count),
			hasResponded: Number(r.mine) > 0,
			createdAt: r.created_at ? String(r.created_at) : null
		})),
		canEdit: session.user.role === 'instructor'
	});
}

export async function POST({ request, locals }) {
	const session = await requireInstructor(locals);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const body = await request.json().catch(() => ({}));
	const title = String(body?.title ?? '').trim().slice(0, 200);
	const prompt = String(body?.prompt ?? '').trim().slice(0, 1000);
	const items = parseItems(body?.items);

	if (!title) error(400, 'Give the poll a title');
	if (items.length < 2) error(400, `A ranking needs at least two things (up to ${MAX_ITEMS})`);

	const reveal = body?.reveal === 'always' ? 'always' : 'closed';
	const classId = body?.classId ? String(body.classId) : null;
	const format = FORMATS.includes(body?.format) ? body.format : 'full';
	// On by DEFAULT for 'favorites' — a pool people can add to is the normal
	// case, and an instructor who doesn't want it unticks the box. Only offered
	// for that format: see migration 071 for why a 'full' poll can't absorb a
	// new item without invalidating every ballot already cast.
	const allowWriteIns = format === 'favorites' && body?.allowWriteIns !== false ? 1 : 0;

	const clampMin = (v) => Math.min(MIN_CEIL, Math.max(MIN_FLOOR, Number(v) || MIN_FLOOR));
	const minFavorites = format === 'favorites' ? clampMin(body?.minFavorites ?? 3) : 0;
	const minLeast = format === 'favorites' ? clampMin(body?.minLeast ?? 3) : 0;

	// A pool that can't satisfy its own minimums is a poll nobody can submit,
	// and the place to catch that is here rather than in front of the class.
	if (format === 'favorites' && items.length < minFavorites + minLeast) {
		error(400, `That pool needs at least ${minFavorites + minLeast} things to pick ${minFavorites} favorites and ${minLeast} least favorites from`);
	}

	const inserted = await db.execute({
		sql: `INSERT INTO lab_polls (title, prompt, status, reveal, created_by, class_id, format, min_favorites, min_least, allow_write_ins)
		      VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		args: [title, prompt || null, reveal, session.user.id, classId, format, minFavorites, minLeast, allowWriteIns]
	});
	const pollId = Number(inserted.rows[0].id);

	await db.batch(
		items.map((label, i) => ({
			sql: `INSERT INTO lab_poll_items (poll_id, label, position) VALUES (?, ?, ?)`,
			args: [pollId, label, i]
		}))
	);

	return json({ id: pollId }, { status: 201 });
}
