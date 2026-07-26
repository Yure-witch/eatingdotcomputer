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

const BASE_QUOTA = { paper: 5, arena_img: 6, artwork: 9, channel: 4, article: 3, link: 4 };
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
	paywalled: !!Number(r.paywalled),
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

// Library catalog-record / link-resolver stubs OpenAlex sometimes lists as
// "open access" — bibliographic records, not fulltext, and often malformed
// (ports, HTML-encoded ampersands). They 404 or break the OpenAthens
// redirector ("Bad Request"). Reject on the way in, belt-and-suspenders
// against any stale cached job result — the worker no longer emits them.
const JUNK_URL = /bib-bvb\.de|func=service|doc_library=|func_code=|worldcat\.org|base-search\.net/i;

// A paper link must be resolvable. The worker emits exactly two shapes:
// a DOI (journal articles) or a Google Books search (no-DOI books). Anything
// else on a paper is a legacy/mangled catalog stub and is dropped — but we
// no longer hide no-DOI books, they arrive as find-a-copy search links.
function usableUrl(r) {
	const url = String(r?.url ?? '').replace(/&amp;/g, '&');
	if (!/^https?:\/\//i.test(url) || JUNK_URL.test(url)) return null;
	if ((r.kind ?? 'link') === 'paper' && !/(^|\.)doi\.org\//i.test(url) && !/google\.[^/]+\/search/i.test(url)) return null;
	return url;
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
			const url = usableUrl(r);
			if (!url) continue;
			await db.execute({
				sql: `INSERT OR IGNORE INTO inspiration_items (user_id, kind, source, title, url, snippet, meta, image, paywalled)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [userId, r.kind ?? 'link', r.source ?? null, r.title ?? '(untitled)', url, r.snippet ?? '', r.meta ?? '', r.image ?? null, r.paywalled ? 1 : 0]
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

	const u = (await db.execute({ sql: 'SELECT interests, inspo_topics FROM users WHERE id = ?', args: [userId] })).rows[0];
	const interests = u?.interests ? String(u.interests) : '';
	// Search topics: the user-editable override; interests are the default.
	const topics = (u?.inspo_topics ? String(u.inspo_topics) : '') || interests;

	await materialize(db, userId);
	if (topics && (await latestJobAge(db, userId)) > REFRESH_MS) {
		await enqueueBatch(db, userId, topics);
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

	return { items: rows.map(rowToItem), interests, topics, pending };
}

export async function setInspirationTopics(userId, topics) {
	const db = getDb();
	if (!db) return false;
	const t = String(topics ?? '').trim().slice(0, 300);
	await db.execute({
		sql: 'UPDATE users SET inspo_topics = ? WHERE id = ?',
		args: [t || null, userId]
	});
	return true;
}

// "Fetch more": enqueue the next batch right now (no daily-gate). Returns
// whether a batch is now in flight (false only when interests are empty).
export async function requestMoreInspiration(userId) {
	const db = getDb();
	if (!db) return false;
	const u = (await db.execute({ sql: 'SELECT interests, inspo_topics FROM users WHERE id = ?', args: [userId] })).rows[0];
	const topics = (u?.inspo_topics ? String(u.inspo_topics) : '') || (u?.interests ? String(u.interests) : '');
	if (!topics) return false;
	await enqueueBatch(db, userId, topics); // no-op if one is already pending
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

// Portable snapshot of the user's recommendation state: topics, every
// signal (saves/likes/dislikes with their items), and the derived taste
// model exactly as the next batch will apply it.
export async function exportInspiration(userId) {
	const db = getDb();
	if (!db) return null;
	const u = (await db.execute({ sql: 'SELECT name, interests, inspo_topics FROM users WHERE id = ?', args: [userId] })).rows[0];
	const pick = (r) => ({ kind: String(r.kind), source: r.source, title: String(r.title), url: String(r.url), meta: r.meta ?? '', paywalled: !!Number(r.paywalled) });
	const saved = (await db.execute({ sql: 'SELECT * FROM inspiration_items WHERE user_id = ? AND saved = 1 ORDER BY saved_at DESC', args: [userId] })).rows.map(pick);
	const liked = (await db.execute({ sql: 'SELECT * FROM inspiration_items WHERE user_id = ? AND rating = 1 ORDER BY id DESC', args: [userId] })).rows.map(pick);
	const disliked = (await db.execute({ sql: 'SELECT * FROM inspiration_items WHERE user_id = ? AND rating = -1 ORDER BY id DESC', args: [userId] })).rows.map(pick);

	const tallies = {};
	for (const r of (await db.execute({
		sql: `SELECT kind, SUM(CASE rating WHEN 1 THEN 1 WHEN -1 THEN -1 ELSE 0 END) AS t
		      FROM inspiration_items WHERE user_id = ? GROUP BY kind`,
		args: [userId]
	})).rows) tallies[String(r.kind)] = Number(r.t ?? 0);
	const counts = {};
	for (const t of disliked.map((d) => d.title.toLowerCase())) {
		for (const w of new Set(t.match(/[a-z]{4,}/g) ?? [])) {
			if (!STOPWORDS.has(w)) counts[w] = (counts[w] ?? 0) + 1;
		}
	}
	const blockedWords = Object.keys(counts).filter((w) => counts[w] >= 2);
	const kindQuotas = {};
	for (const [kind, base] of Object.entries(BASE_QUOTA)) {
		kindQuotas[kind] = Math.max(1, Math.min(base * 2, base + (tallies[kind] ?? 0)));
	}

	return {
		format: 'eating.computer-inspiration-v1',
		exportedAt: new Date().toISOString(),
		user: u?.name ? String(u.name) : userId,
		interests: u?.interests ? String(u.interests) : '',
		topics: (u?.inspo_topics ? String(u.inspo_topics) : '') || (u?.interests ? String(u.interests) : ''),
		nextQuery: await buildQuery(db, userId, (u?.inspo_topics ? String(u.inspo_topics) : '') || (u?.interests ? String(u.interests) : '')),
		algorithm: { kindTallies: tallies, kindQuotas, blockedWords, expireDays: EXPIRE_DAYS },
		saved, liked, disliked
	};
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

// ─────────────────────────────────────────────────────────────────────────
// CLASS FEED — one shared set of items generated from the syllabus. Same
// base algorithm for everyone; ordering is driven by AGGREGATE student
// reactions (a class favorite floats up). Each student's own like/save is
// stored per-item in inspiration_reactions (the item row is shared, so it
// can't hold one student's state). Popular PERSONAL likes also feed back
// into the class query — what the class is into shapes what it's shown.
// ─────────────────────────────────────────────────────────────────────────

const classOwner = (classId) => `class:${classId}`;
const classTag = (classId) => `inspo:class:${classId}`;

// Search topics for the class: the syllabus (week headlines + topic
// previews) plus what's "trending" — titles many students liked in their
// personal feeds. The syllabus part is stable (same for the class); the
// trending part is the aggregate influence.
// Strip inline emote/effect tokens ([tg:..], [ce:..], …) and PUA glyphs so
// chat-flavored syllabus text becomes clean search terms.
function cleanTopic(s) {
	return String(s ?? '')
		.replace(/\[(?:tg|tgc|ce|ek|tfx|img)[^\]]*\]/gi, '')
		.replace(/[\u{E000}-\u{F8FF}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

async function getClassTopics(db, classId) {
	// The class SUBJECT is always the broad seed — it guarantees the class
	// feed pulls the same diverse recommendation types (papers, museum +
	// are.na images, channels) as a personal feed, even when the syllabus
	// is sparse. Week topics + trending student likes layer on top.
	const cls = (await db.execute({
		sql: 'SELECT name FROM classes WHERE id = ?', args: [classId]
	})).rows[0];
	const subject = cls?.name ? cleanTopic(cls.name) : '';

	const wp = (await db.execute({
		sql: 'SELECT headline, topic_preview FROM week_plans WHERE class_id = ? ORDER BY week',
		args: [classId]
	})).rows;
	const syllabus = [];
	for (const r of wp) {
		// The headline is the TOPIC name (best search term); the preview is
		// usually a chatty note — use it only when there's no headline.
		const term = cleanTopic(r.headline) || cleanTopic(r.topic_preview);
		if (term && term.length > 2) syllabus.push(term);
	}
	const trending = (await db.execute({
		sql: `SELECT title, COUNT(DISTINCT user_id) c FROM inspiration_items
		      WHERE user_id NOT LIKE 'class:%' AND rating = 1
		      GROUP BY lower(title) HAVING c >= 2 ORDER BY c DESC LIMIT 3`,
		args: []
	})).rows.map((r) => String(r.title).split(/\s+/).slice(0, 4).join(' '));
	const topics = [subject, ...syllabus.slice(0, 5), ...trending]
		.filter(Boolean).join(', ').slice(0, 300);
	return { topics, trending };
}

async function enqueueClassBatch(db, classId) {
	const t = classTag(classId);
	const pending = (await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE requested_by = ? AND status IN ('queued','running') LIMIT 1`,
		args: [t]
	})).rows[0];
	if (pending) return false;
	const { topics } = await getClassTopics(db, classId);
	if (!topics) return false;
	const seed = Number((await db.execute({
		sql: `SELECT COUNT(*) AS n FROM scout_jobs WHERE requested_by = ?`, args: [t]
	})).rows[0]?.n ?? 0);
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, requested_by) VALUES ('search', ?, ?)`,
		args: [`${topics} #s${seed}`, t]
	});
	return true;
}

async function materializeClass(db, classId) {
	const owner = classOwner(classId);
	const jobs = (await db.execute({
		sql: `SELECT result FROM scout_jobs WHERE requested_by = ? AND status = 'done' AND updated_at > datetime('now', '-2 days')`,
		args: [classTag(classId)]
	})).rows;
	for (const job of jobs) {
		let results;
		try { results = JSON.parse(String(job.result)); } catch { continue; }
		if (!Array.isArray(results)) continue;
		const taken = {};
		for (const r of results) {
			const url = usableUrl(r);
			if (!url) continue;
			const kind = r.kind ?? 'link';
			const quota = BASE_QUOTA[kind] ?? 4;
			taken[kind] = (taken[kind] ?? 0) + 1;
			if (taken[kind] > quota) continue;
			await db.execute({
				sql: `INSERT OR IGNORE INTO inspiration_items (user_id, kind, source, title, url, snippet, meta, image, paywalled)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [owner, kind, r.source ?? null, r.title ?? '(untitled)', url, r.snippet ?? '', r.meta ?? '', r.image ?? null, r.paywalled ? 1 : 0]
			});
		}
	}
}

// The class feed for a viewer: shared items + this viewer's own reactions
// merged in + each item's aggregate score (how the class rates it).
export async function getClassFeed(userId, classId) {
	const db = getDb();
	if (!db) return { items: [], pending: false, topics: '' };
	const owner = classOwner(classId);

	await materializeClass(db, classId);
	const stale = (await db.execute({
		sql: `SELECT MAX(created_at) latest FROM scout_jobs WHERE requested_by = ?`, args: [classTag(classId)]
	})).rows[0]?.latest;
	const ageMs = stale ? Date.now() - new Date(String(stale).replace(' ', 'T') + 'Z').getTime() : Infinity;
	if (ageMs > REFRESH_MS) await enqueueClassBatch(db, classId);

	const pending = !!(await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE requested_by = ? AND status IN ('queued','running') LIMIT 1`,
		args: [classTag(classId)]
	})).rows[0];

	// Items + aggregate reaction score + the caller's own reaction.
	const rows = (await db.execute({
		sql: `SELECT i.*,
		         COALESCE(SUM(rx.rating), 0) AS agg_score,
		         COALESCE(SUM(CASE WHEN rx.saved = 1 THEN 1 ELSE 0 END), 0) AS agg_saves,
		         MAX(CASE WHEN rx.user_id = ? THEN rx.rating END) AS my_rating,
		         MAX(CASE WHEN rx.user_id = ? THEN rx.saved END)  AS my_saved
		      FROM inspiration_items i
		      LEFT JOIN inspiration_reactions rx ON rx.item_id = i.id
		      WHERE i.user_id = ?
		      GROUP BY i.id
		      HAVING COALESCE(SUM(rx.rating), 0) > -2
		      ORDER BY agg_score DESC, i.created_at DESC
		      LIMIT 150`,
		args: [userId, userId, owner]
	})).rows;

	const items = rows.map((r) => ({
		...rowToItem(r),
		saved: !!Number(r.my_saved),
		rating: Number(r.my_rating ?? 0),
		aggScore: Number(r.agg_score ?? 0),
		aggSaves: Number(r.agg_saves ?? 0),
		expired: false
	}));
	const { topics } = await getClassTopics(db, classId);
	return { items, pending, topics };
}

export async function requestMoreClass(classId) {
	const db = getDb();
	if (!db) return false;
	return enqueueClassBatch(db, classId);
}

// A student reacting to a shared class item → upsert into the reactions
// table (never touches the shared item row).
export async function reactClassItem(userId, itemId, { rating, saved }) {
	const db = getDb();
	if (!db) return false;
	const cur = (await db.execute({
		sql: `SELECT rating, saved FROM inspiration_reactions WHERE user_id = ? AND item_id = ?`,
		args: [userId, itemId]
	})).rows[0] ?? { rating: 0, saved: 0 };
	const nextRating = rating === undefined ? Number(cur.rating ?? 0) : (rating === 1 ? 1 : rating === -1 ? -1 : 0);
	const nextSaved = saved === undefined ? Number(cur.saved ?? 0) : (saved ? 1 : 0);
	await db.execute({
		sql: `INSERT INTO inspiration_reactions (user_id, item_id, rating, saved, updated_at)
		      VALUES (?, ?, ?, ?, datetime('now'))
		      ON CONFLICT(user_id, item_id) DO UPDATE SET rating = excluded.rating, saved = excluded.saved, updated_at = datetime('now')`,
		args: [userId, itemId, nextRating, nextSaved]
	});
	return true;
}

// Instructor view: what every student likes, personally and for the class.
export async function getStudentInsights(classId) {
	const db = getDb();
	if (!db) return { students: [], classFavorites: [], trending: [] };
	const owner = classOwner(classId);

	const students = (await db.execute({
		sql: `SELECT id, name, interests, inspo_topics FROM users WHERE role != 'instructor' ORDER BY name`,
		args: []
	})).rows;

	const out = [];
	for (const s of students) {
		const uid = String(s.id);
		const personalLikes = (await db.execute({
			sql: `SELECT kind, title, url, meta FROM inspiration_items
			      WHERE user_id = ? AND (rating = 1 OR saved = 1) ORDER BY saved DESC, id DESC LIMIT 8`,
			args: [uid]
		})).rows.map((r) => ({ kind: String(r.kind), title: String(r.title), url: String(r.url), meta: r.meta ? String(r.meta) : '' }));
		const classLikes = (await db.execute({
			sql: `SELECT i.title, i.url, i.kind FROM inspiration_reactions rx
			      JOIN inspiration_items i ON i.id = rx.item_id
			      WHERE rx.user_id = ? AND (rx.rating = 1 OR rx.saved = 1)
			      ORDER BY rx.saved DESC, rx.updated_at DESC LIMIT 8`,
			args: [uid]
		})).rows.map((r) => ({ kind: String(r.kind), title: String(r.title), url: String(r.url) }));
		const counts = (await db.execute({
			sql: `SELECT
			        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) likes,
			        SUM(CASE WHEN saved = 1 THEN 1 ELSE 0 END) saves
			      FROM inspiration_items WHERE user_id = ?`,
			args: [uid]
		})).rows[0] ?? {};
		out.push({
			id: uid,
			name: String(s.name ?? 'Unnamed'),
			interests: s.interests ? String(s.interests) : '',
			topics: s.inspo_topics ? String(s.inspo_topics) : '',
			likeCount: Number(counts.likes ?? 0),
			saveCount: Number(counts.saves ?? 0),
			personalLikes,
			classLikes
		});
	}

	// What the class as a whole rates highest among the shared items.
	const classFavorites = (await db.execute({
		sql: `SELECT i.title, i.url, i.kind,
		        SUM(rx.rating) score, SUM(CASE WHEN rx.saved = 1 THEN 1 ELSE 0 END) saves
		      FROM inspiration_items i JOIN inspiration_reactions rx ON rx.item_id = i.id
		      WHERE i.user_id = ?
		      GROUP BY i.id HAVING score > 0 OR saves > 0
		      ORDER BY score DESC, saves DESC LIMIT 12`,
		args: [owner]
	})).rows.map((r) => ({ kind: String(r.kind), title: String(r.title), url: String(r.url), score: Number(r.score ?? 0), saves: Number(r.saves ?? 0) }));

	const { trending } = await getClassTopics(db, classId);
	return { students: out, classFavorites, trending };
}
