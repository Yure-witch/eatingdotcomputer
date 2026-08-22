import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

// Instant avatar save for the picker's non-upload choices ('gen' and
// 'expr'). Photo avatars keep going through the edit-profile form action —
// they carry a file upload and the R2 round-trip that comes with it. The
// client invalidates its data after this, so the new face shows up in the
// header/sidebar/chat immediately instead of waiting for a full reload.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const kind = String(body?.kind ?? '');
	if (!['gen', 'expr'].includes(kind)) error(400, 'kind must be gen or expr');

	let value = null;
	if (kind === 'expr') {
		value = String(body?.value ?? '').trim();
		if (!value || value.length > 200) error(400, 'Missing or oversized expression token');
	}

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	await db.execute({
		sql: 'UPDATE users SET avatar_kind = ?, avatar_value = ? WHERE id = ?',
		args: [kind, value, session.user.id]
	});
	// Live broadcast: every open client watches membersRev (app layout) and
	// refetches its data when it moves, so the new avatar appears everywhere
	// — other devices and other people — without anyone reloading.
	getAdminDb().ref('membersRev').set(Date.now()).catch(() => {});
	return json({ ok: true });
}
