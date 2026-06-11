import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';

// Called via navigator.sendBeacon() when the tab/window closes cleanly.
// sendBeacon sends cookies so session auth works. Body is JSON with deviceId.
// This makes offline detection instant for clean closes — onDisconnect() still
// handles crashes and network drops as a guaranteed fallback.

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user?.id) error(401, 'Unauthorized');

	const uid = session.user.id;
	let body;
	try { body = await request.json(); } catch { body = {}; }

	const { deviceId } = body;
	if (!deviceId) error(400, 'deviceId required');

	try {
		// online: false drops this device from the aggregated fresh
		// list immediately; lastInputAt: 0 is the belt-and-suspenders
		// signal that flips the status derivation to at-least 'idle'
		// even if the online flag's snapshot fan-out lags. Matches the
		// onDisconnect write set up by the client.
		await getAdminDb().ref(`presence/${uid}/${deviceId}`).update({ online: false, lastInputAt: 0 });
		console.info(`[ec:presence/offline] uid=${uid} device=${deviceId} marked offline`);
	} catch (e) {
		console.error('[ec:presence/offline] RTDB write failed:', e?.message);
		// Don't error — beacon responses are ignored by the browser anyway
	}

	return json({ ok: true });
}
