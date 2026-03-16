import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { env } from '$env/dynamic/private';

// Cron endpoint — called daily at 1am.
// Reads RTDB presence, writes completed session ranges to Turso user_sessions,
// then deletes RTDB nodes whose lastSeen is older than 24h to keep RTDB lean.
// RTDB is truth for "online now"; Turso is archive for histograms.

const ARCHIVE_AFTER = 24 * 60 * 60 * 1000; // 24h

export async function GET({ request }) {
	const auth = request.headers.get('authorization');
	if (env.CRON_SECRET && auth !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const adminDb = getAdminDb();
	const db = getDb();
	const now = Date.now();
	const cutoff = now - ARCHIVE_AFTER;

	const snap = await adminDb.ref('presence').get();
	if (!snap.exists()) return json({ archived: 0, deleted: 0 });

	let archived = 0, deleted = 0;
	const deletePromises = [];

	for (const [uid, userVal] of Object.entries(snap.val())) {
		if (!userVal || typeof userVal !== 'object') continue;

		// Per-device if any child is an object; mixed format treated as per-device to ignore stale flat fields.
		const deviceEntries = Object.entries(userVal).filter(([, d]) => d && typeof d === 'object');
		// Fall back to flat format only if no device objects exist
		const entries = deviceEntries.length > 0 ? deviceEntries : [['_flat', userVal]];

		for (const [deviceId, d] of entries) {
			if (!d || typeof d !== 'object') continue;
			const lastSeen = d.lastSeen ?? 0;
			if (!lastSeen) continue;

			const sessionStart = d.sessionStart ?? lastSeen; // fallback: point-in-time session
			const sessionEnd = lastSeen;

			if (lastSeen < cutoff) {
				// Session ended more than 24h ago — archive to Turso and clean RTDB
				if (db) {
					const startIso = new Date(sessionStart).toISOString().replace('T', ' ').slice(0, 19);
					const endIso   = new Date(sessionEnd).toISOString().replace('T', ' ').slice(0, 19);
					const deviceType = d.mobile ? 'mobile' : 'desktop';
					const isPwa = d.pwa ? 1 : 0;
					await db.execute({
						sql: `INSERT INTO user_sessions (user_id, session_start, session_end, device_type, is_pwa)
						      VALUES (?, ?, ?, ?, ?)`,
						args: [uid, startIso, endIso, deviceType, isPwa]
					}).catch(() => {});
					archived++;
				}
				// For flat-format fallback (_flat key), delete the whole uid node;
				// for per-device, delete only that device's node.
				const path = deviceId === '_flat' ? `presence/${uid}` : `presence/${uid}/${deviceId}`;
				deletePromises.push(adminDb.ref(path).remove());
				deleted++;
			}
			// Active sessions (lastSeen >= cutoff) stay in RTDB — they're still "live"
		}
	}

	await Promise.all(deletePromises);
	return json({ archived, deleted });
}
