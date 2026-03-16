import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';

// Firebase RTDB is the sole source of truth for real-time online status.
// It uses WebSockets under the hood, so presence is instant and per-device.
// Turso user_activity is only consulted for lastSeen of offline users
// (histogram/history purposes — NOT for determining online status).
const PRESENCE_TTL = 5 * 60 * 1000;

export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const snap = await getAdminDb().ref('presence').get();
	const now = Date.now();
	const result = {};

	if (snap.exists()) {
		for (const [uid, v] of Object.entries(snap.val())) {
			if (!v || typeof v !== 'object') continue;
			// Per-device format: any child that is itself an object is a device node.
			// Mixed format (stale flat fields + live device objects) is treated as per-device
			// so orphaned flat `online: false` fields from old sessions don't mask fresh data.
			const deviceObjects = Object.values(v).filter(d => d && typeof d === 'object');
			const deviceList = deviceObjects.length > 0 ? deviceObjects : [v];

			let online = false, lastSeen = null, ua = null, screen = null;
			const devices = [];

			for (const d of deviceList) {
				const fresh = d.online && (d.lastSeen ?? 0) > now - PRESENCE_TTL;
				if (fresh) {
					online = true;
					devices.push({ ua: d.ua ?? null, pwa: !!d.pwa, mobile: !!d.mobile, lastSeen: d.lastSeen ?? 0 });
				}
				if (d.lastSeen && (!lastSeen || d.lastSeen > lastSeen)) {
					lastSeen = d.lastSeen;
					if (d.ua) ua = d.ua;
					if (d.screen) screen = d.screen;
				}
			}

			result[uid] = {
				online,
				lastSeen,
				devices,
				...(online && ua ? { ua } : {}),
				...(online && screen ? { screen } : {})
			};
		}
	}

	// Turso: fill in lastSeen for users not in Firebase (display only — not online detection).
	const db = getDb();
	if (db) {
		const rows = await db.execute(
			`SELECT user_id, MAX(logged_at) as last_active FROM user_activity GROUP BY user_id`
		);
		for (const r of rows.rows) {
			const uid = String(r.user_id);
			const ts = new Date(String(r.last_active) + 'Z').getTime();
			if (!result[uid]) {
				result[uid] = { online: false, lastSeen: ts, devices: [] };
			} else if (!result[uid].lastSeen || ts > result[uid].lastSeen) {
				result[uid].lastSeen = ts;
			}
		}
	}

	return json(result);
}
