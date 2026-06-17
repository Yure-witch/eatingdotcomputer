import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const db = getDb();
	if (!db) return json({ ok: true }); // fail silently — don't break the app

	let deviceType = null, isPwa = null;
	try {
		const body = await request.json();
		deviceType = body.deviceType ?? null;
		isPwa = body.isPwa != null ? (body.isPwa ? 1 : 0) : null;
	} catch { /* body optional */ }

	// Append to history AND stamp the user's denormalised last_active, so the
	// presence GET can read "last seen" off the 18-row users table instead of
	// GROUP BY-ing over all of user_activity.
	await db.batch([
		{
			sql: `INSERT INTO user_activity (user_id, logged_at, device_type, is_pwa) VALUES (?, datetime('now'), ?, ?)`,
			args: [session.user.id, deviceType, isPwa]
		},
		{
			sql: `UPDATE users SET last_active = datetime('now') WHERE id = ?`,
			args: [session.user.id]
		}
	]);

	return json({ ok: true });
}
