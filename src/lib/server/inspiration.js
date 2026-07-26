// Inspiration feed — per-user daily recommendations built from Scout
// results (seminal papers via OpenAlex, artworks from four museums,
// are.na channels, Wikipedia overviews), keyed off users.interests.
//
// Mechanics:
//   - refresh at most once per REFRESH_MS per user (new batch of items,
//     URL-deduped against EVERYTHING the user has ever been shown, so a
//     batch always brings genuinely new things)
//   - saving keeps an item forever and is an interest signal: titles of
//     recent saves get folded into the next Scout query
//   - unsaved items EXPIRE out of the main feed after EXPIRE_MS but stay
//     in the History view
import { getDb } from '$lib/server/turso.js';
import { searchWithWait } from '$lib/server/scout.js';

export const EXPIRE_DAYS = 7;
const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000;
const REFRESH_MS = 20 * 60 * 60 * 1000; // "every day or so"

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
	savedAt: r.saved_at ? String(r.saved_at) : null,
	createdAt: String(r.created_at),
	expired: Date.now() - new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime() > EXPIRE_MS
});

async function latestBatchAge(db, userId) {
	const row = (await db.execute({
		sql: `SELECT MAX(created_at) AS latest FROM inspiration_items WHERE user_id = ?`,
		args: [userId]
	})).rows[0];
	if (!row?.latest) return Infinity;
	return Date.now() - new Date(String(row.latest).replace(' ', 'T') + 'Z').getTime();
}

// Fold recent saves into the query — saving is the strongest interest
// signal we have, so the next batch leans toward what they actually kept.
async function buildQuery(db, userId, interests) {
	const saves = (await db.execute({
		sql: `SELECT title FROM inspiration_items WHERE user_id = ? AND saved = 1
		      ORDER BY saved_at DESC LIMIT 2`,
		args: [userId]
	})).rows;
	const saveTerms = saves.map((s) => String(s.title).split(/\s+/).slice(0, 4).join(' '));
	return [interests, ...saveTerms].filter(Boolean).join(', ').slice(0, 300);
}

// Refresh the user's feed if it's stale, then return it. `history` mode
// returns everything ever shown; default mode returns saved + unexpired.
export async function getInspirationFeed(userId, { history = false, waitMs = 15000 } = {}) {
	const db = getDb();
	if (!db) return { items: [], interests: '' };

	const u = (await db.execute({ sql: 'SELECT interests FROM users WHERE id = ?', args: [userId] })).rows[0];
	const interests = u?.interests ? String(u.interests) : '';

	let refreshed = false;
	if (interests && (await latestBatchAge(db, userId)) > REFRESH_MS) {
		const query = await buildQuery(db, userId, interests);
		const results = await searchWithWait(query, { waitMs, requestedBy: `inspo:${userId}` }).catch(() => null);
		if (results?.length) {
			for (const r of results) {
				// UNIQUE(user_id, url) makes re-shown items no-ops — only
				// genuinely new finds enter the feed.
				await db.execute({
					sql: `INSERT OR IGNORE INTO inspiration_items (user_id, kind, source, title, url, snippet, meta, image)
					      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					args: [userId, r.kind ?? 'link', r.source ?? null, r.title, r.url, r.snippet ?? '', r.meta ?? '', r.image ?? null]
				});
			}
			refreshed = true;
		}
	}

	const rows = (await db.execute({
		sql: history
			? `SELECT * FROM inspiration_items WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 400`
			: `SELECT * FROM inspiration_items WHERE user_id = ?
			   AND (saved = 1 OR created_at > datetime('now', '-${EXPIRE_DAYS} days'))
			   ORDER BY created_at DESC, id DESC LIMIT 120`,
		args: [userId]
	})).rows;

	return { items: rows.map(rowToItem), interests, refreshed };
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
