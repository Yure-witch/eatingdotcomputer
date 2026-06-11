import { redirect, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

export async function load({ locals, params, parent }) {
	await parent();
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	// Pull every profile column the edit form can write. The previous
	// SELECT was missing year/school/focus, which is why profiles that
	// users had carefully filled out came back blank on the view page —
	// the data was in the DB, just never queried here.
	const result = await db.execute({
		sql: 'SELECT id, name, pronouns, bio, website, year, school, focus, role, created_at, avatar_kind, avatar_value FROM users WHERE id = ?',
		args: [params.userId]
	});

	if (!result.rows.length) error(404, 'User not found');

	const u = result.rows[0];

	// Online status + last-seen. Walks BOTH presence stores the same
	// way /app/manage does — necessary because:
	//  1. Firebase RTDB switched to per-device presence
	//     (`presence/{uid}/{deviceId}/{lastSeen, online, …}`). Reading
	//     `val.lastSeen` at the top level returned undefined under
	//     that schema, which is why this page rendered "last seen
	//     never" while /manage rendered the correct timestamp.
	//  2. Turso's `user_sessions` archive is more reliable than
	//     Firebase heartbeats for "when did this person last open
	//     the app" — we take the max of both sources.
	const PRESENCE_TTL = 5 * 60 * 1000;
	let online = false;
	let presenceLastSeen = null;
	try {
		const snap = await getAdminDb().ref(`presence/${params.userId}`).get();
		if (snap.exists()) {
			const val = snap.val();
			const now = Date.now();
			// Per-device shape if any child is an object; flat shape
			// otherwise. Mixed (legacy flat + new device children) is
			// also handled by always preferring object children.
			const deviceObjects = Object.values(val).filter(d => d && typeof d === 'object');
			const devices = deviceObjects.length > 0 ? deviceObjects : [val];
			for (const d of devices) {
				if (d.online && (d.lastSeen ?? 0) > now - PRESENCE_TTL) online = true;
				if (d.lastSeen && (!presenceLastSeen || d.lastSeen > presenceLastSeen)) {
					presenceLastSeen = d.lastSeen;
				}
			}
		}
	} catch { /* ignore */ }

	// Most recent archived session from Turso — covers offline users
	// whose Firebase heartbeat has timed out but who used the app
	// recently enough that we still want to surface a date.
	let sessionLastSeen = null;
	try {
		const row = await db.execute({
			sql: `SELECT MAX(COALESCE(session_end, datetime('now'))) AS last_active
			      FROM user_sessions WHERE user_id = ?`,
			args: [params.userId]
		});
		const v = row.rows[0]?.last_active;
		if (v) sessionLastSeen = new Date(String(v)).getTime();
	} catch { /* ignore */ }

	const lastSeen = Math.max(presenceLastSeen ?? 0, sessionLastSeen ?? 0) || null;

	return {
		profile: {
			id: String(u.id),
			name: String(u.name ?? ''),
			pronouns: String(u.pronouns ?? ''),
			bio: String(u.bio ?? ''),
			website: String(u.website ?? ''),
			year: String(u.year ?? ''),
			school: String(u.school ?? ''),
			focus: String(u.focus ?? ''),
			role: String(u.role ?? 'student'),
			joinedAt: String(u.created_at ?? ''),
			avatarKind: u.avatar_kind ? String(u.avatar_kind) : 'gen',
			avatarValue: u.avatar_value ? String(u.avatar_value) : null,
			online,
			lastSeen
		},
		isOwnProfile: session.user.id === String(u.id),
		currentUserId: session.user.id
	};
}
