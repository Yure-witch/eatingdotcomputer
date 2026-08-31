import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';

// Live response counts for Lab → Rank It.
//
// RTDB carries a BEACON, not the tally: `pollLive/{pollId}` is just the
// response count and a timestamp. The instructor's page watches it, shows the
// number as it climbs, and refetches the real results from the API when it
// moves.
//
// The scores stay server-side deliberately. Putting them in RTDB would mean a
// second implementation of the tally to keep in step with the first, and it
// would publish results to every signed-in client regardless of whether the
// instructor has revealed them — the one thing the reveal rule exists to stop.
export async function bumpPollLive(pollId) {
	try {
		const db = getDb();
		if (!db) return;
		const n = Number((await db.execute({
			sql: `SELECT COUNT(*) AS n FROM lab_poll_ballots WHERE poll_id = ?`,
			args: [pollId]
		})).rows[0].n);
		await getAdminDb().ref(`pollLive/${pollId}`).set({ n, at: Date.now() });
	} catch {
		// A ballot that counted is not allowed to fail because the beacon
		// didn't. The page's poll-every-few-seconds fallback covers this.
	}
}

/** Drop a deleted poll's beacon, so RTDB doesn't accumulate nodes for polls that no longer exist. */
export async function clearPollLive(pollId) {
	try {
		await getAdminDb().ref(`pollLive/${pollId}`).remove();
	} catch { /* the poll is already gone from Turso; a stale beacon is harmless */ }
}
