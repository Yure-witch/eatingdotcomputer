import { redirect, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

export async function load({ locals, params, parent }) {
	await parent();
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute({
		sql: 'SELECT id, name, pronouns, bio, website, role, created_at FROM users WHERE id = ?',
		args: [params.userId]
	});

	if (!result.rows.length) error(404, 'User not found');

	const u = result.rows[0];

	// Get online status
	const PRESENCE_TTL = 3 * 60 * 1000;
	let online = false;
	let lastSeen = null;
	try {
		const snap = await getAdminDb().ref(`presence/${params.userId}`).get();
		if (snap.exists()) {
			const val = snap.val();
			lastSeen = val.lastSeen ?? null;
			online = val.online && lastSeen && Date.now() - lastSeen < PRESENCE_TTL;
		}
	} catch { /* ignore */ }

	return {
		profile: {
			id: String(u.id),
			name: String(u.name ?? ''),
			pronouns: String(u.pronouns ?? ''),
			bio: String(u.bio ?? ''),
			website: String(u.website ?? ''),
			role: String(u.role ?? 'student'),
			joinedAt: String(u.created_at ?? ''),
			online,
			lastSeen
		},
		isOwnProfile: session.user.id === String(u.id),
		currentUserId: session.user.id
	};
}
