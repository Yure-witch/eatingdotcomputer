// Recommendations storage in Firebase RTDB (single source of truth).
//
//   recs/users/{uid}/items/{k}      — a student's personal recs (their own
//                                     saved/rating live on the item node)
//   recs/class/{cid}/blended/{k}    — class "All topics" shared recs
//   recs/class/{cid}/weeks/{n}/{k}  — class per-week shared recs
//   recs/class/{cid}/reactions/{k}/{uid}: { rating, saved, at }
//                                     — every student's reaction to a shared
//                                       item, so the whole class's likes are
//                                       visible and aggregatable
//
// `k` is a stable hash of the item URL, so re-writing a batch never
// duplicates or reshuffles what's already there — items keep their original
// createdAt and their on-screen order is stable.
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { ServerValue } from 'firebase-admin/database';
import { createHash } from 'node:crypto';
import { filterResults } from '$lib/server/recs-filter.js';

const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

export const recKey = (url) => createHash('sha1').update(String(url ?? '')).digest('hex').slice(0, 20);

const toArray = (obj) => (obj ? Object.entries(obj).map(([k, v]) => ({ _k: k, ...(v || {}) })) : []);

function baseItem(row) {
	return {
		id: String(row._k),
		kind: String(row.kind ?? 'link'),
		source: row.source ?? null,
		title: String(row.title ?? '(untitled)'),
		url: String(row.url ?? ''),
		snippet: String(row.snippet ?? ''),
		meta: String(row.meta ?? ''),
		image: row.image ?? null,
		paywalled: !!Number(row.paywalled),
		createdAt: Number(row.createdAt ?? 0)
	};
}

// Additive write: never rewrite an item that already exists, so createdAt
// (and therefore order) stays put. Returns how many new items landed.
async function writeItems(basePath, items) {
	if (!items.length) return 0;
	const db = getAdminDb();
	const existing = (await db.ref(basePath).get()).val() || {};
	const updates = {};
	let seq = Date.now();
	for (const it of items) {
		const k = recKey(it.url);
		if (existing[k] || updates[`${basePath}/${k}`]) continue;
		updates[`${basePath}/${k}`] = { ...it, createdAt: seq++ };
	}
	const n = Object.keys(updates).length;
	if (n) await db.ref().update(updates);
	return n;
}

// tag → RTDB path (mirrors the scout_jobs requested_by tags).
export function pathForTag(tag) {
	let m;
	if ((m = String(tag).match(/^inspo:class:(.+):w(\d+)$/))) return `recs/class/${m[1]}/weeks/${m[2]}`;
	if ((m = String(tag).match(/^inspo:class:(.+)$/))) return `recs/class/${m[1]}/blended`;
	if ((m = String(tag).match(/^inspo:(.+)$/))) return `recs/users/${m[1]}/items`;
	return null;
}

// Called when the worker POSTs a finished job — filter + write to RTDB.
export async function writeJobRecs(tag, query, results) {
	const path = pathForTag(tag);
	if (!path) return 0;
	return writeItems(path, filterResults(results, query));
}

// ── Reads ─────────────────────────────────────────────────────────────────

export async function readUserFeed(userId) {
	const rows = toArray((await getAdminDb().ref(`recs/users/${userId}/items`).get()).val());
	const now = Date.now();
	return rows.map((r) => ({
		...baseItem(r),
		saved: !!Number(r.saved),
		rating: Number(r.rating ?? 0),
		savedAt: r.savedAt ?? null,
		expired: now - Number(r.createdAt ?? 0) > EXPIRE_MS
	})).sort((a, b) => b.createdAt - a.createdAt);
}

function withClassReactions(row, reactionsForKey, userId) {
	let aggScore = 0, aggSaves = 0, myRating = 0, mySaved = false;
	for (const [uid, rx] of Object.entries(reactionsForKey || {})) {
		const rating = Number(rx?.rating ?? 0);
		const saved = !!Number(rx?.saved);
		aggScore += rating;
		if (saved) aggSaves += 1;
		if (uid === userId) { myRating = rating; mySaved = saved; }
	}
	return { ...baseItem(row), saved: mySaved, rating: myRating, aggScore, aggSaves, expired: false };
}

export async function readClassBlended(userId, classId) {
	const db = getAdminDb();
	const [blended, weeks, reactions] = await Promise.all([
		db.ref(`recs/class/${classId}/blended`).get(),
		db.ref(`recs/class/${classId}/weeks`).get(),
		db.ref(`recs/class/${classId}/reactions`).get()
	]);
	const weekKeys = new Set();
	for (const wk of Object.values(weeks.val() || {})) for (const k of Object.keys(wk || {})) weekKeys.add(k);
	const rx = reactions.val() || {};
	return toArray(blended.val())
		.filter((r) => !weekKeys.has(r._k)) // don't repeat the per-week view
		.map((r) => withClassReactions(r, rx[r._k], userId))
		.filter((i) => i.aggScore > -2)
		.sort((a, b) => (b.aggScore - a.aggScore) || (b.createdAt - a.createdAt));
}

// weekList: [{ week, headline, topic }] from the syllabus (Turso).
export async function readClassWeekly(userId, classId, weekList) {
	const db = getAdminDb();
	const [weeks, reactions] = await Promise.all([
		db.ref(`recs/class/${classId}/weeks`).get(),
		db.ref(`recs/class/${classId}/reactions`).get()
	]);
	const weeksVal = weeks.val() || {};
	const rx = reactions.val() || {};
	return weekList.map((wk) => ({
		week: wk.week,
		headline: wk.headline,
		topic: wk.topic,
		items: toArray(weeksVal[wk.week])
			.map((r) => withClassReactions(r, rx[r._k], userId))
			.filter((i) => i.aggScore > -2)
			.sort((a, b) => (b.aggScore - a.aggScore) || (b.createdAt - a.createdAt))
	}));
}

// ── Reactions ──────────────────────────────────────────────────────────────

export async function setUserReaction(userId, key, { rating, saved }) {
	const patch = {};
	if (rating !== undefined) patch.rating = rating === 1 ? 1 : rating === -1 ? -1 : 0;
	if (saved !== undefined) { patch.saved = saved ? 1 : 0; patch.savedAt = saved ? ServerValue.TIMESTAMP : null; }
	if (!Object.keys(patch).length) return false;
	const ref = getAdminDb().ref(`recs/users/${userId}/items/${key}`);
	if (!(await ref.get()).exists()) return false;
	await ref.update(patch);
	return true;
}

export async function setClassReaction(userId, classId, key, { rating, saved }) {
	const patch = { at: ServerValue.TIMESTAMP };
	if (rating !== undefined) patch.rating = rating === 1 ? 1 : rating === -1 ? -1 : 0;
	if (saved !== undefined) patch.saved = saved ? 1 : 0;
	await getAdminDb().ref(`recs/class/${classId}/reactions/${key}/${userId}`).update(patch);
	return true;
}

// ── Instructor insights: every student's likes, personal + class ───────────
export async function readClassReactionsRaw(classId) {
	return (await getAdminDb().ref(`recs/class/${classId}/reactions`).get()).val() || {};
}

export async function readUserLikes(userId) {
	const rows = toArray((await getAdminDb().ref(`recs/users/${userId}/items`).get()).val());
	return rows
		.filter((r) => Number(r.rating) === 1 || Number(r.saved) === 1)
		.map((r) => ({ kind: String(r.kind), title: String(r.title), url: String(r.url), meta: String(r.meta ?? ''), saved: !!Number(r.saved), rating: Number(r.rating ?? 0) }))
		.sort((a, b) => (b.saved ? 1 : 0) - (a.saved ? 1 : 0));
}

// Look up shared class items by key (across blended + weeks) for labeling.
export async function readClassItemsByKey(classId) {
	const db = getAdminDb();
	const [blended, weeks] = await Promise.all([
		db.ref(`recs/class/${classId}/blended`).get(),
		db.ref(`recs/class/${classId}/weeks`).get()
	]);
	const map = {};
	for (const r of toArray(blended.val())) map[r._k] = baseItem(r);
	for (const wk of Object.values(weeks.val() || {})) for (const [k, v] of Object.entries(wk || {})) map[k] = baseItem({ _k: k, ...v });
	return map;
}
