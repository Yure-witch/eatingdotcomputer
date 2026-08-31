import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';

// Live state for Lab → Rank It, over RTDB.
//
// TWO nodes, because the two audiences can't share one:
//
//   pollLive/{pollId}    .read: auth != null   — the signed-in app
//   pollRoom/{shareCode} .read: true           — phones that scanned the QR
//
// Guests have no Firebase auth at all, so they can't read an authed path; and
// the public node can't be keyed by poll id, because ids are sequential and a
// world-readable `pollLive/1,2,3…` would let anyone walk every poll's response
// count. The share code is unguessable and is already the thing that grants
// access to the poll over REST, so keying the public node by it grants nothing
// new.
//
// Both carry a REVISION, not the tally: `rev` moves on every change — a
// ballot, a write-in, a removal, opening or closing — and watchers refetch.
// The scores stay server-computed so there's ONE implementation of the
// scoring, and so the "no tally until you've ranked" rule is still applied
// per-viewer by the endpoint instead of being published to the room.
async function publish(pollId) {
	const db = getDb();
	if (!db) return;
	const row = (await db.execute({
		sql: `SELECT p.share_code, p.status,
		             (SELECT COUNT(*) FROM lab_poll_ballots b WHERE b.poll_id = p.id) AS n,
		             (SELECT COUNT(*) FROM lab_poll_items  i WHERE i.poll_id = p.id) AS items
		      FROM lab_polls p WHERE p.id = ?`,
		args: [pollId]
	})).rows[0];
	if (!row) return;

	const rtdb = getAdminDb();
	const state = {
		rev: Date.now(),
		n: Number(row.n),
		items: Number(row.items),
		status: String(row.status)
	};
	const writes = [rtdb.ref(`pollLive/${pollId}`).set(state)];
	// Only shared polls get a public room, and unsharing tears it down.
	if (row.share_code) writes.push(rtdb.ref(`pollRoom/${String(row.share_code)}`).set(state));
	await Promise.all(writes);
}

/** Announce that something about this poll changed. Never throws. */
export async function bumpPollLive(pollId) {
	try {
		await publish(pollId);
	} catch {
		// A ballot that counted is not allowed to fail because the announcement
		// didn't. Every page keeps a slow refetch as a floor.
	}
}

/** Drop a poll's live nodes — on delete, or when sharing is turned off. */
export async function clearPollLive(pollId, shareCode = null) {
	try {
		const rtdb = getAdminDb();
		await Promise.all([
			rtdb.ref(`pollLive/${pollId}`).remove(),
			shareCode ? rtdb.ref(`pollRoom/${shareCode}`).remove() : Promise.resolve()
		]);
	} catch { /* a stale node is harmless; nothing reads it without the poll */ }
}
