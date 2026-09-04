import { getDb } from '$lib/server/turso.js';

// Visit counting for the public install pages. See migration 078 for why this
// is a per-day counter rather than a log of individual hits.

/** Paths we count. An unlisted path is ignored rather than silently recorded. */
export const TRACKED_PATHS = ['/androidpwa', '/iosapp', '/pwadesktop'];

export const PATH_LABELS = {
	'/androidpwa': 'Android',
	'/iosapp': 'iPhone',
	'/pwadesktop': 'Desktop'
};

/**
 * Count one visit. Never throws and never blocks the page: a counter is not
 * worth failing a request over, and these pages are the first thing someone
 * sees after being sent a link.
 *
 * Callers should NOT await this — the page has nothing to learn from it.
 */
export function recordVisit(path) {
	if (!TRACKED_PATHS.includes(path)) return;
	const db = getDb();
	if (!db) return;
	// UTC day, matching the `day` column's documented format. SQLite's own
	// date() would be fine too, but doing it here keeps the value identical
	// whether or not the driver rewrites the statement.
	const day = new Date().toISOString().slice(0, 10);
	db.execute({
		sql: `INSERT INTO page_visits (path, day, visits) VALUES (?, ?, 1)
		      ON CONFLICT(path, day) DO UPDATE SET visits = visits + 1`,
		args: [path, day]
	}).catch(() => { /* a lost count is not worth a log line */ });
}

/**
 * Totals and a recent window for the Manage page.
 * @returns {Promise<Array<{path: string, label: string, total: number, last7: number, today: number}>>}
 */
export async function visitSummary() {
	const db = getDb();
	if (!db) return [];
	const today = new Date().toISOString().slice(0, 10);
	const weekAgo = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);

	const rows = (await db.execute({
		sql: `SELECT path,
		             SUM(visits) AS total,
		             SUM(CASE WHEN day >= ? THEN visits ELSE 0 END) AS last7,
		             SUM(CASE WHEN day = ? THEN visits ELSE 0 END) AS today
		      FROM page_visits
		      GROUP BY path`,
		args: [weekAgo, today]
	})).rows;

	const byPath = new Map(rows.map((r) => [String(r.path), r]));
	// Driven by TRACKED_PATHS, not by what's in the table, so a page nobody has
	// opened yet still shows up as a zero instead of vanishing from the list.
	return TRACKED_PATHS.map((path) => {
		const r = byPath.get(path);
		return {
			path,
			label: PATH_LABELS[path] ?? path,
			total: Number(r?.total ?? 0),
			last7: Number(r?.last7 ?? 0),
			today: Number(r?.today ?? 0)
		};
	});
}
