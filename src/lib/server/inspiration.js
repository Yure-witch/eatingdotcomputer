// Inspiration feed — per-user recommendations built from Scout results
// (seminal papers via OpenAlex, artworks from four museums, are.na
// channels, Wikipedia overviews), keyed off users.interests.
//
// Batch model (async — no long serverless holds):
//   - a "batch" is one Scout job with query `<signals> #s<seed>`; the seed
//     counts the user's prior jobs and pushes every source deeper into
//     its results, so Fetch More brings genuinely new finds
//   - GET materializes any completed-but-unmaterialized jobs (idempotent
//     via the per-user URL unique index), auto-enqueues when stale, and
//     reports `pending` so the client can poll
//
// Feedback loop (rating: 1 liked / -1 disliked, plus saved):
//   - liked + saved titles are folded into the next batch's query
//   - per-kind quotas shift with the like/dislike tally (dislike papers →
//     fewer papers next time, never zero so taste can recover)
//   - words recurring across disliked titles are blocked from new items
//   - disliked items leave the feed immediately (History still shows them)
//
// Unsaved items EXPIRE out of the main feed after EXPIRE_DAYS but stay in
// the History view.
import { getDb } from '$lib/server/turso.js';

export const EXPIRE_DAYS = 7;
const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000;
const REFRESH_MS = 20 * 60 * 60 * 1000; // auto-batch "every day or so"

const BASE_QUOTA = { paper: 5, artwork: 9, channel: 4, article: 3, link: 4 };
const STOPWORDS = new Set(['this', 'that', 'with', 'from', 'what', 'when', 'where', 'which', 'their', 'about', 'into', 'have', 'been', 'were', 'untitled', 'series']);

const rowToItem = (r) => ({
	id: Number(r.id),
	kind: String(r.kind),
	source: r.source ? String(r.source) : null,
	title: String(r.title),
	url: String(r.url),
	snippet: r.snippet ? String(r.snippet) : '',
	meta: r.meta ? String(r.meta) : '',
	image: r.image ? String(r.image) : null,
	saved: !!Number(r.saved),
	rating: Number(r.rating ?? 0),
	savedAt: r.saved_at ? String(r.saved_at) : null,
	createdAt: String(r.created_at),
	expired: Date.now() - new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime() > EXPIRE_MS
});

const tag = (userId) => `inspo:${userId}`;

// Fold positive signals into the query — liked/saved titles steer the
// next batch toward what the user actually responded to.
async function buildQuery(db, userId, interests) {
	const liked = (await db.execute({
		sql: `SELECT title FROM inspiration_items WHERE user_id = ? AND (saved = 1 OR rating = 1)
		      ORDER BY COALESCE(saved_at, created_at) DESC LIMIT 3`,
		args: [userId]
	})).rows;
	const terms = liked.map((s) => String(s.title).split(/\s+/).slice(0, 4).join(' '));
	return [interests, ...terms].filter(Boolean).join(', ').slice(0, 280);
}

async function enqueueBatch(db, userId, interests) {
	const pending = (await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE requested_by = ? AND status IN ('queued','running') LIMIT 1`,
		args: [tag(userId)]
	})).rows[0];
	if (pending) return false;
	const seed = Number((await db.execute({
		sql: `SELECT COUNT(*) AS n FROM scout_jobs WHERE requested_by = ?`,
		args: [tag(userId)]
	})).rows[0]?.n ?? 0);
	const query = `${await buildQuery(db, userId, interests)} #s${seed}`;
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, requested_by) VALUES ('search', ?, ?)`,
		args: [query, tag(userId)]
	});
	return true;
}

// Taste model applied at materialize time: per-kind quotas move with the
// like/dislike tally; words that recur across disliked titles are blocked.
async function tasteFilter(db, userId, results) {
	const tallies = {};
	for (const r of (await db.execute({
		sql: `SELECT kind, SUM(CASE rating WHEN 1 THEN 1 WHEN -1 THEN -1 ELSE 0 END) AS t
		      FROM inspiration_items WHERE user_id = ? GROUP BY kind`,
		args: [userId]
	})).rows) tallies[String(r.kind)] = Number(r.t ?? 0);

	const dislikedTitles = (await db.execute({
		sql: `SELECT title FROM inspiration_items WHERE user_id = ? AND rating = -1 ORDER BY id DESC LIMIT 40`,
		args: [userId]
	})).rows.map((r) => String(r.title).toLowerCase());
	const counts = {};
	for (const t of dislikedTitles) {
		for (const w of new Set(t.match(/[a-z]{4,}/g) ?? [])) {
			if (!STOPWORDS.has(w)) counts[w] = (counts[w] ?? 0) + 1;
		}
	}
	const blocked = new Set(Object.keys(counts).filter((w) => counts[w] >= 2));

	const taken = {};
	return results.filter((r) => {
		const kind = r.kind ?? 'link';
		const base = BASE_QUOTA[kind] ?? 4;
		const quota = Math.max(1, Math.min(base * 2, base + (tallies[kind] ?? 0)));
		const title = String(r.title ?? '').toLowerCase();
		for (const w of blocked) if (title.includes(w)) return false;
		taken[kind] = (taken[kind] ?? 0) + 1;
		return taken[kind] <= quota;
	});
}

// Insert results from every completed-but-recent job. Idempotent: the
// per-user URL unique index makes re-materializing a no-op.
async function materialize(db, userId) {
	const jobs = (await db.execute({
		sql: `SELECT id, result FROM scout_jobs
		      WHERE requested_by = ? AND status = 'done' AND updated_at > datetime('now', '-2 days')`,
		args: [tag(userId)]
	})).rows;
	for (const job of jobs) {
		let results;
		try { results = JSON.parse(String(job.result)); } catch { continue; }
		if (!Array.isArray(results)) continue;
		for (const r of await tasteFilter(db, userId, results)) {
			if (!r?.url) continue;
			await db.execute({
				sql: `INSERT OR IGNORE INTO inspiration_items (user_id, kind, source, title, url, snippet, meta, image)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [userId, r.kind ?? 'link', r.source ?? null, r.title ?? '(untitled)', r.url, r.snippet ?? '', r.meta ?? '', r.image ?? null]
			});
		}
	}
}

async function latestJobAge(db, userId) {
	const row = (await db.execute({
		sql: `SELECT MAX(created_at) AS latest FROM scout_jobs WHERE requested_by = ?`,
		args: [tag(userId)]
	})).rows[0];
	if (!row?.latest) return Infinity;
	return Date.now() - new Date(String(row.latest).replace(' ', 'T') + 'Z').getTime();
}

export async function getInspirationFeed(userId, { history = false } = {}) {
	const db = getDb();
	if (!db) return { items: [], interests: '', pending: false };

	const u = (await db.execute({ sql: 'SELECT interests FROM users WHERE id = ?', args: [userId] })).rows[0];
	const interests = u?.interests ? String(u.interests) : '';

	await materialize(db, userId);
	if (interests && (await latestJobAge(db, userId)) > REFRESH_MS) {
		await enqueueBatch(db, userId, interests);
	}

	const pending = !!(await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE requested_by = ? AND status IN ('queued','running') LIMIT 1`,
		args: [tag(userId)]
	})).rows[0];

	const rows = (await db.execute({
		sql: history
			? `SELECT * FROM inspiration_items WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 400`
			: `SELECT * FROM inspiration_items WHERE user_id = ? AND rating > -1
			   AND (saved = 1 OR created_at > datetime('now', '-${EXPIRE_DAYS} days'))
			   ORDER BY created_at DESC, id DESC LIMIT 150`,
		args: [userId]
	})).rows;

	return { items: rows.map(rowToItem), interests, pending };
}

// "Fetch more": enqueue the next batch right now (no daily-gate). Returns
// whether a batch is now in flight (false only when interests are empty).
export async function requestMoreInspiration(userId) {
	const db = getDb();
	if (!db) return false;
	const u = (await db.execute({ sql: 'SELECT interests FROM users WHERE id = ?', args: [userId] })).rows[0];
	const interests = u?.interests ? String(u.interests) : '';
	if (!interests) return false;
	await enqueueBatch(db, userId, interests); // no-op if one is already pending
	return true;
}

export async function setInspirationSaved(userId, itemId, saved) {
	const db = getDb();
	if (!db) return false;
	const res = await db.execute({
		sql: `UPDATE inspiration_items SET saved = ?, saved_at = ${saved ? "datetime('now')" : 'NULL'}
		      WHERE id = ? AND user_id = ?`,
		args: [saved ? 1 : 0, itemId, userId]
	});
	return res.rowsAffected > 0;
}

export async function setInspirationRating(userId, itemId, rating) {
	const db = getDb();
	if (!db) return false;
	const r = rating === 1 ? 1 : rating === -1 ? -1 : 0;
	const res = await db.execute({
		sql: `UPDATE inspiration_items SET rating = ? WHERE id = ? AND user_id = ?`,
		args: [r, itemId, userId]
	});
	return res.rowsAffected > 0;
}
