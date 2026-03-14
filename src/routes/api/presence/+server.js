import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';

const PRESENCE_TTL = 3 * 60 * 1000;
// user_activity is logged every 5 min; allow a little buffer
const ACTIVITY_ONLINE_WINDOW = 8 * 60 * 1000;

export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	// Firebase presence (written from chat layout)
	const snap = await getAdminDb().ref('presence').get();
	const now = Date.now();
	const result = {};

	if (snap.exists()) {
		for (const [uid, v] of Object.entries(snap.val())) {
			const online = !!(v.online && (v.lastSeen ?? 0) > now - PRESENCE_TTL);
			result[uid] = {
				online,
				lastSeen: v.lastSeen ?? null,
				...(online && v.ua ? { ua: v.ua } : {}),
				...(online && v.screen ? { screen: v.screen } : {})
			};
		}
	}

	// Also check user_activity for recent pings (covers non-chat pages)
	const db = getDb();
	if (db) {
		const rows = await db.execute(
			`SELECT user_id, MAX(logged_at) as last_active
			 FROM user_activity
			 WHERE logged_at >= datetime('now', '-8 minutes')
			 GROUP BY user_id`
		);
		for (const r of rows.rows) {
			const uid = String(r.user_id);
			// Activity ping means online; keep the most recent lastSeen
			const activityTs = new Date(String(r.last_active) + 'Z').getTime();
			const existing = result[uid];
			result[uid] = {
				online: true,
				lastSeen: existing?.lastSeen
					? Math.max(existing.lastSeen, activityTs)
					: activityTs
			};
		}

		// For users not currently online, fill in their last_active as lastSeen
		const allRows = await db.execute(
			`SELECT user_id, MAX(logged_at) as last_active FROM user_activity GROUP BY user_id`
		);
		for (const r of allRows.rows) {
			const uid = String(r.user_id);
			if (!result[uid]) {
				const ts = new Date(String(r.last_active) + 'Z').getTime();
				result[uid] = { online: false, lastSeen: ts };
			} else if (!result[uid].lastSeen) {
				result[uid].lastSeen = new Date(String(r.last_active) + 'Z').getTime();
			}
		}
	}

	return json(result);
}
