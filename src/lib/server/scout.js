// Scout client — app-side interface to the kahan research worker.
//
// The worker (scout/scout.js, deployed on kahan) polls /api/scout/jobs
// over outbound HTTPS, runs searches against are.na + Wikipedia, and
// posts link results back. This module is how app code (mainly the Gemma
// digest) enqueues work and reads results. Because the worker is a
// poller, results are eventually-consistent: `searchWithWait` gives it a
// short window to answer, then falls back to the freshest cached result
// for the same query — digests degrade gracefully to "no links" rather
// than blocking.
import { getDb } from '$lib/server/turso.js';

const FRESH_MS = 12 * 60 * 60 * 1000;      // reuse done results younger than 12h
const CACHE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // stale fallback horizon
const ONLINE_MS = 90 * 1000;                // heartbeat window → "online"

function norm(q) {
	return String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
}

export async function scoutStatus() {
	const db = getDb();
	if (!db) return { online: false, lastSeen: null, queued: 0 };
	const hb = (await db.execute(`SELECT v FROM scout_state WHERE k = 'heartbeat'`)).rows[0];
	const lastSeen = hb ? Number(hb.v) : null;
	const queued = Number((await db.execute(
		`SELECT COUNT(*) AS n FROM scout_jobs WHERE status IN ('queued','running')`
	)).rows[0]?.n ?? 0);
	return { online: !!lastSeen && Date.now() - lastSeen < ONLINE_MS, lastSeen, queued };
}

async function latestDone(db, query, maxAgeMs) {
	const row = (await db.execute({
		sql: `SELECT result, updated_at FROM scout_jobs
		      WHERE kind = 'search' AND query = ? AND status = 'done'
		      ORDER BY updated_at DESC LIMIT 1`,
		args: [query]
	})).rows[0];
	if (!row?.result) return null;
	// SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS" (UTC, space-separated)
	const age = Date.now() - new Date(String(row.updated_at).replace(' ', 'T') + 'Z').getTime();
	if (age > maxAgeMs) return null;
	try {
		const links = JSON.parse(String(row.result));
		return Array.isArray(links) && links.length ? links : null;
	} catch { return null; }
}

// Enqueue a search unless an equivalent one is already pending or was
// completed recently. Returns nothing — results are read separately.
export async function enqueueSearch(query, requestedBy = null) {
	const db = getDb();
	const q = norm(query);
	if (!db || !q) return;
	const pending = (await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE kind = 'search' AND query = ? AND status IN ('queued','running') LIMIT 1`,
		args: [q]
	})).rows[0];
	if (pending) return;
	if (await latestDone(db, q, FRESH_MS)) return;
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, requested_by) VALUES ('search', ?, ?)`,
		args: [q, requestedBy]
	});
}

// Get results for a query: enqueue if needed, give the worker up to
// `waitMs` to deliver (only when it's actually online), else fall back to
// the freshest cached result within a week. Returns [{title,url,snippet,
// source,image}] or null.
export async function searchWithWait(query, { waitMs = 15000, requestedBy = null } = {}) {
	const db = getDb();
	const q = norm(query);
	if (!db || !q) return null;

	const fresh = await latestDone(db, q, FRESH_MS);
	if (fresh) return fresh;

	await enqueueSearch(q, requestedBy);

	// Don't burn the wait window when nobody is polling.
	const { online } = await scoutStatus();
	if (online) {
		const deadline = Date.now() + waitMs;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 2000));
			const got = await latestDone(db, q, FRESH_MS);
			if (got) return got;
		}
	}

	return latestDone(db, q, CACHE_MAX_MS);
}
