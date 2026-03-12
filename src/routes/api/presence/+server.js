import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';

const PRESENCE_TTL = 3 * 60 * 1000; // must match client heartbeat window

export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const snap = await getAdminDb().ref('presence').get();
	if (!snap.exists()) return json({});

	const cutoff = Date.now() - PRESENCE_TTL;
	const result = {};
	for (const [uid, v] of Object.entries(snap.val())) {
		result[uid] = {
			online: v.online && (v.lastSeen ?? 0) > cutoff,
			lastSeen: v.lastSeen ?? null
		};
	}
	return json(result);
}
