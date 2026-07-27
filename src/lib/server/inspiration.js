// Inspiration / Recommendations — orchestration.
//
// STORAGE split:
//   • Turso  — the Scout job QUEUE (scout_jobs) + syllabus (week_plans) +
//              users (interests/topics). This is where batches are enqueued
//              and where the worker picks up work.
//   • RTDB   — the recommendations themselves and every reaction (see
//              recs-rtdb.js). Written when the worker POSTs a finished job
//              (api/scout/jobs → writeJobRecs), read here. RTDB is the single
//              source of truth for what's shown, so items keep a stable order
//              and the whole class's likes are visible/aggregatable.
//
// This module: builds queries from interests/syllabus, enqueues batches
// (Turso), and reads/reacts through RTDB.
import { getDb } from '$lib/server/turso.js';
import {
	readUserFeed, readClassBlended, readClassWeekly,
	setUserReaction, setClassReaction,
	readClassReactionsRaw, readUserLikes, readClassItemsByKey
} from '$lib/server/recs-rtdb.js';

export const EXPIRE_DAYS = 7;
const REFRESH_MS = 20 * 60 * 60 * 1000; // auto-batch "every day or so"

const tag = (userId) => `inspo:${userId}`;
const classTag = (classId) => `inspo:class:${classId}`;
const weekTag = (classId, w) => `inspo:class:${classId}:w${w}`;

// ── Turso queue helpers ────────────────────────────────────────────────────
async function isPending(db, t) {
	return !!(await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE requested_by = ? AND status IN ('queued','running') LIMIT 1`,
		args: [t]
	})).rows[0];
}
async function jobAge(db, t) {
	const latest = (await db.execute({
		sql: `SELECT MAX(created_at) latest FROM scout_jobs WHERE requested_by = ?`, args: [t]
	})).rows[0]?.latest;
	return latest ? Date.now() - new Date(String(latest).replace(' ', 'T') + 'Z').getTime() : Infinity;
}
async function seedFor(db, t) {
	return Number((await db.execute({
		sql: `SELECT COUNT(*) AS n FROM scout_jobs WHERE requested_by = ?`, args: [t]
	})).rows[0]?.n ?? 0);
}
async function enqueue(db, t, query) {
	if (!query || await isPending(db, t)) return false;
	const seed = await seedFor(db, t);
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, requested_by) VALUES ('search', ?, ?)`,
		args: [`${query} #s${seed}`, t]
	});
	return true;
}

// ── Personal feed ("Mine") ─────────────────────────────────────────────────

// Fold liked/saved titles into the next query so the feed leans toward what
// the student actually responded to (their likes now live in RTDB).
async function buildQuery(userId, interests) {
	const likes = (await readUserLikes(userId)).slice(0, 3);
	const terms = likes.map((l) => String(l.title).split(/\s+/).slice(0, 4).join(' '));
	return [interests, ...terms].filter(Boolean).join(', ').slice(0, 280);
}

async function enqueuePersonal(db, userId, interests) {
	if (!interests || await isPending(db, tag(userId))) return false;
	const seed = await seedFor(db, tag(userId));
	const query = `${await buildQuery(userId, interests)} #s${seed}`;
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, requested_by) VALUES ('search', ?, ?)`,
		args: [query, tag(userId)]
	});
	return true;
}

export async function getInspirationFeed(userId, { history = false } = {}) {
	const db = getDb();
	if (!db) return { items: [], interests: '', topics: '', pending: false };
	const u = (await db.execute({ sql: 'SELECT interests, inspo_topics FROM users WHERE id = ?', args: [userId] })).rows[0];
	const interests = u?.interests ? String(u.interests) : '';
	const topics = (u?.inspo_topics ? String(u.inspo_topics) : '') || interests;

	if (topics && (await jobAge(db, tag(userId))) > REFRESH_MS) await enqueuePersonal(db, userId, topics);

	const all = await readUserFeed(userId);
	const items = history ? all : all.filter((i) => i.rating > -1 && (i.saved || !i.expired));
	return { items, interests, topics, pending: await isPending(db, tag(userId)) };
}

export async function setInspirationTopics(userId, topics) {
	const db = getDb();
	if (!db) return false;
	await db.execute({ sql: 'UPDATE users SET inspo_topics = ? WHERE id = ?', args: [String(topics ?? '').trim().slice(0, 300) || null, userId] });
	return true;
}

export async function requestMoreInspiration(userId) {
	const db = getDb();
	if (!db) return false;
	const u = (await db.execute({ sql: 'SELECT interests, inspo_topics FROM users WHERE id = ?', args: [userId] })).rows[0];
	const topics = (u?.inspo_topics ? String(u.inspo_topics) : '') || (u?.interests ? String(u.interests) : '');
	if (!topics) return false;
	await enqueuePersonal(db, userId, topics);
	return true;
}

export async function setInspirationSaved(userId, itemId, saved) {
	return setUserReaction(userId, String(itemId), { saved });
}
export async function setInspirationRating(userId, itemId, rating) {
	return setUserReaction(userId, String(itemId), { rating: Number(rating) });
}

export async function exportInspiration(userId) {
	const db = getDb();
	if (!db) return null;
	const u = (await db.execute({ sql: 'SELECT name, interests, inspo_topics FROM users WHERE id = ?', args: [userId] })).rows[0];
	const all = await readUserFeed(userId);
	const pick = (i) => ({ kind: i.kind, source: i.source, title: i.title, url: i.url, meta: i.meta, paywalled: i.paywalled });
	const topics = (u?.inspo_topics ? String(u.inspo_topics) : '') || (u?.interests ? String(u.interests) : '');
	return {
		format: 'eating.computer-inspiration-v1',
		exportedAt: new Date().toISOString(),
		user: u?.name ? String(u.name) : userId,
		interests: u?.interests ? String(u.interests) : '',
		topics,
		nextQuery: await buildQuery(userId, topics),
		saved: all.filter((i) => i.saved).map(pick),
		liked: all.filter((i) => i.rating === 1).map(pick),
		disliked: all.filter((i) => i.rating === -1).map(pick)
	};
}

// ── Class syllabus → search terms ──────────────────────────────────────────
function cleanTopic(s) {
	return String(s ?? '')
		.replace(/\[(?:tg|tgc|ce|ek|tfx|img)[^\]]*\]/gi, '')
		.replace(/[\u{E000}-\u{F8FF}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}
function cleanDemo(s) {
	return cleanTopic(s)
		.replace(/^(finish|complete|do|make|start|build|read|watch|submit|create|design|write|draw|study)(\s+(the|your|a|an|our))?\s+/i, '')
		.replace(/[!?.]+$/, '')
		.trim();
}

// The whole syllabus as an ordered, deduped term list — broad subject first,
// then every week topic, then every demo/assignment label.
async function getClassTermList(db, classId) {
	const cls = (await db.execute({ sql: 'SELECT name FROM classes WHERE id = ?', args: [classId] })).rows[0];
	const terms = [];
	const seen = new Set();
	const push = (t) => {
		const c = (t ?? '').trim();
		if (c.length > 2 && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); terms.push(c); }
	};
	if (cls?.name) push(cleanTopic(String(cls.name)).replace(/\b(concepts?|introduction|studio|fundamentals|basics|course|i{1,3}|101)\b/gi, '').replace(/\s+/g, ' ').trim());
	const wp = (await db.execute({ sql: 'SELECT id, headline, topic_preview FROM week_plans WHERE class_id = ? ORDER BY week', args: [classId] })).rows;
	for (const w of wp) {
		push(cleanTopic(w.headline) || cleanTopic(w.topic_preview));
		const items = (await db.execute({ sql: 'SELECT label FROM week_items WHERE week_plan_id = ? ORDER BY sort_order', args: [w.id] })).rows;
		for (const it of items) push(cleanDemo(it.label));
	}
	return terms;
}

async function getClassTopics(db, classId) {
	return (await getClassTermList(db, classId)).join(', ').slice(0, 300);
}

// "All topics" batches rotate a 3-term window through the full syllabus list.
async function enqueueClassBlended(db, classId) {
	const t = classTag(classId);
	if (await isPending(db, t)) return false;
	const terms = await getClassTermList(db, classId);
	if (!terms.length) return false;
	const seed = await seedFor(db, t);
	const win = [];
	for (let i = 0; i < Math.min(3, terms.length); i++) win.push(terms[(seed * 3 + i) % terms.length]);
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, requested_by) VALUES ('search', ?, ?)`,
		args: [`${win.join(', ')} #s${seed}`, t]
	});
	return true;
}

// Each week with a usable topic; the subject is folded in for context.
async function getWeekList(db, classId) {
	const cls = (await db.execute({ sql: 'SELECT name FROM classes WHERE id = ?', args: [classId] })).rows[0];
	const subject = cls?.name ? cleanTopic(cls.name) : '';
	const wp = (await db.execute({ sql: 'SELECT week, headline, topic_preview FROM week_plans WHERE class_id = ? ORDER BY week', args: [classId] })).rows;
	return wp.map((r) => {
		const topic = cleanTopic(r.headline) || cleanTopic(r.topic_preview);
		return { week: Number(r.week), headline: cleanTopic(r.headline) || `Week ${r.week}`, topic, query: [topic, subject].filter(Boolean).join(', ') };
	}).filter((w) => w.topic && w.topic.length > 2);
}

// ── Class feeds (read from RTDB) ────────────────────────────────────────────
export async function getClassFeed(userId, classId) {
	const db = getDb();
	if (!db) return { items: [], pending: false, topics: '' };
	const t = classTag(classId);
	if ((await jobAge(db, t)) > REFRESH_MS) await enqueueClassBlended(db, classId);
	return { items: await readClassBlended(userId, classId), pending: await isPending(db, t), topics: await getClassTopics(db, classId) };
}

export async function requestMoreClass(classId) {
	const db = getDb();
	if (!db) return false;
	return enqueueClassBlended(db, classId);
}

export async function getClassWeeklyFeeds(userId, classId) {
	const db = getDb();
	if (!db) return { weeks: [] };
	const weeks = await getWeekList(db, classId);
	for (const wk of weeks) {
		if ((await jobAge(db, weekTag(classId, wk.week))) > REFRESH_MS) await enqueue(db, weekTag(classId, wk.week), wk.query);
	}
	const feeds = await readClassWeekly(userId, classId, weeks);
	// Attach pending flags.
	for (const f of feeds) f.pending = await isPending(db, weekTag(classId, f.week));
	return { weeks: feeds };
}

export async function requestMoreWeekly(classId) {
	const db = getDb();
	if (!db) return false;
	const weeks = await getWeekList(db, classId);
	let any = false;
	for (const wk of weeks) if (await enqueue(db, weekTag(classId, wk.week), wk.query)) any = true;
	return any;
}

export async function reactClassItem(userId, classId, itemId, { rating, saved }) {
	return setClassReaction(userId, classId, String(itemId), { rating, saved });
}

// ── Instructor insights (RTDB reactions + Turso names) ─────────────────────
export async function getStudentInsights(classId) {
	const db = getDb();
	if (!db) return { students: [], classFavorites: [], trending: [] };

	const students = (await db.execute({
		sql: `SELECT id, name, interests, inspo_topics FROM users WHERE role != 'instructor' ORDER BY name`,
		args: []
	})).rows;

	const reactions = await readClassReactionsRaw(classId); // { key: { uid: {rating,saved} } }
	const itemsByKey = await readClassItemsByKey(classId);
	const classLikesByUser = {};
	const favAgg = {};
	for (const [k, byUser] of Object.entries(reactions)) {
		let score = 0, saves = 0;
		for (const [uid, rx] of Object.entries(byUser || {})) {
			const rating = Number(rx?.rating ?? 0), saved = !!Number(rx?.saved);
			score += rating; if (saved) saves += 1;
			if (rating === 1 || saved) (classLikesByUser[uid] ??= []).push(k);
		}
		if (score > 0 || saves > 0) favAgg[k] = { score, saves };
	}

	const out = [];
	for (const s of students) {
		const uid = String(s.id);
		const personal = await readUserLikes(uid);
		out.push({
			id: uid,
			name: String(s.name ?? 'Unnamed'),
			interests: s.interests ? String(s.interests) : '',
			topics: s.inspo_topics ? String(s.inspo_topics) : '',
			likeCount: personal.filter((l) => l.rating === 1).length,
			saveCount: personal.filter((l) => l.saved).length,
			personalLikes: personal.slice(0, 8).map((l) => ({ kind: l.kind, title: l.title, url: l.url, meta: l.meta })),
			classLikes: (classLikesByUser[uid] ?? []).map((k) => itemsByKey[k]).filter(Boolean).slice(0, 8).map((i) => ({ kind: i.kind, title: i.title, url: i.url }))
		});
	}

	const classFavorites = Object.entries(favAgg)
		.map(([k, v]) => ({ ...v, item: itemsByKey[k] }))
		.filter((f) => f.item)
		.sort((a, b) => (b.score - a.score) || (b.saves - a.saves))
		.slice(0, 12)
		.map((f) => ({ kind: f.item.kind, title: f.item.title, url: f.item.url, score: f.score, saves: f.saves }));

	return { students: out, classFavorites, trending: [] };
}
