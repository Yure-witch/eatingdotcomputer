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

	const db = getDb();
	// Every user id that still exists. `presence/{uid}` in RTDB is written by
	// the client and never removed when an account is deleted, so the node
	// outlives the account — test students, demo accounts and review logins
	// that were purged from Turso months ago all still have one. Without this
	// gate the endpoint reported them forever as users who are merely offline.
	let knownIds = null;
	let lastActive = [];
	if (db) {
		const rows = await db.execute('SELECT id, last_active, shadowbanned FROM users');
		// A shadowbanned member has no presence as far as anyone else is
		// concerned — no green dot, no "last active", no row in Manage. They
		// stay visible to themself (so the app looks normal to them) and to
		// instructors.
		const seesHidden = String(session.user.role ?? '') === 'instructor';
		const visible = rows.rows.filter(
			(r) => seesHidden || !Number(r.shadowbanned) || String(r.id) === session.user.id
		);
		knownIds = new Set(visible.map((r) => String(r.id)));
		lastActive = visible.filter((r) => r.last_active != null);
	}

	const snap = await getAdminDb().ref('presence').get();
	const now = Date.now();
	const result = {};

	if (snap.exists()) {
		for (const [uid, v] of Object.entries(snap.val())) {
			if (!v || typeof v !== 'object') continue;
			if (knownIds && !knownIds.has(uid)) continue; // orphaned node, no such user
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

	// Turso: fill in lastSeen for users not in Firebase (display only — not
	// online detection). Reads the denormalised users.last_active (~21 rows)
	// instead of GROUP BY-ing over the whole user_activity history (~23k rows),
	// which previously full-scanned on every presence poll.
	{
		for (const r of lastActive) {
			const uid = String(r.id);
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
