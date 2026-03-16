import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';

// Server-side presence write via Firebase Admin SDK.
// Bypasses client Firebase auth entirely — presence writes always succeed
// even when signInWithCustomToken fails or hasn't run yet on the client.
// Called on mount, navigation, and heartbeat from the app layout.

export async function POST({ request, locals }) {
	const session = await locals.auth();
	// session.user.id is token.userId from auth.js JWT callback.
	// It may be missing on very old sessions (pre userId enrichment). Treat as unauth.
	if (!session?.user?.id) error(401, 'Unauthorized');
	if (typeof session.user.id !== 'string' || !session.user.id.trim()) error(401, 'Unauthorized');

	const uid = session.user.id;
	let body;
	try { body = await request.json(); } catch { body = {}; }

	const { deviceId, ua, pwa, mobile, notif, sessionStart } = body;
	if (!deviceId) error(400, 'deviceId required');

	const now = Date.now();
	const payload = {
		online: true,
		lastSeen: now,
		sessionStart: sessionStart ?? now,
		ua: ua ?? null,
		pwa: !!pwa,
		mobile: !!mobile,
		notif: !!notif
	};

	console.info(`[ec:presence/ping] uid=${uid} device=${deviceId} pwa=${pwa} mobile=${mobile}`);
	const db = getAdminDb();
	try {
		// Write per-device presence
		await db.ref(`presence/${uid}/${deviceId}`).update(payload);
		console.info(`[ec:presence/ping] RTDB write ok — presence/${uid}/${deviceId}`);

		// Clean up any orphaned flat-format fields (online, lastSeen, ua, etc.) left at the
		// uid level by old sessions. These cause format-detection to see `online: false`
		// and mark the user offline even when a fresh per-device entry exists.
		const uidSnap = await db.ref(`presence/${uid}`).get();
		if (uidSnap.exists() && typeof uidSnap.val()?.online !== 'undefined') {
			// Has flat fields — remove them (keep only device sub-objects)
			const flatFields = ['online', 'lastSeen', 'ua', 'screen', 'pwa', 'mobile', 'notif', 'name', 'sessionStart'];
			const cleanup = {};
			for (const f of flatFields) cleanup[f] = null; // null = delete in RTDB update
			await db.ref(`presence/${uid}`).update(cleanup);
			console.info(`[ec:presence/ping] cleaned up orphaned flat fields for uid=${uid}`);
		}
	} catch (e) {
		console.error('[ec:presence/ping] RTDB write FAILED:', e?.message);
		error(500, 'RTDB write failed');
	}

	return json({ ok: true, lastSeen: now });
}
