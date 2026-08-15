import { getDb } from '$lib/server/turso';
import { json, error } from '@sveltejs/kit';

// Register (or refresh) the caller's native APNs device token. Called by the
// Capacitor shell after it registers for push (see native.js). A device token
// is unique per install, so INSERT OR REPLACE re-homes it to the current user
// (e.g. after a re-login on the same device).
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const { token, platform } = await request.json().catch(() => ({}));
	if (!token || typeof token !== 'string' || token.length > 200) error(400, 'Invalid token');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	await db.execute({
		sql: `INSERT INTO apns_tokens (token, user_id, platform, updated_at)
		      VALUES (?, ?, ?, datetime('now'))
		      ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, updated_at = datetime('now')`,
		args: [token, session.user.id, platform === 'ios' ? 'ios' : 'ios']
	});

	return json({ success: true });
}

// Unregister a token (on logout / notifications disabled).
export async function DELETE({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const { token } = await request.json().catch(() => ({}));
	if (!token) error(400, 'Missing token');
	const db = getDb();
	if (!db) error(503, 'Database unavailable');
	await db.execute({ sql: 'DELETE FROM apns_tokens WHERE token = ? AND user_id = ?', args: [token, session.user.id] });
	return json({ success: true });
}
