import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { createFirebaseToken } from '$lib/server/firebase-admin.js';

export async function load({ locals, parent }) {
	await parent(); // wait for app/+layout.server.js to finish (handles auth gate + redirects)
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();

	const [usersResult, channelsResult] = await Promise.all([
		db ? db.execute(`
			SELECT u.id, u.name, u.email, u.role FROM users u
			WHERE u.role = 'instructor'
			   OR EXISTS (
			        SELECT 1 FROM class_memberships cm
			        WHERE cm.user_id = u.id AND cm.status = 'approved'
			      )
			ORDER BY u.name ASC
		`) : { rows: [] },
		db ? db.execute("SELECT id, name, created_at FROM conversations WHERE type = 'channel' ORDER BY created_at ASC") : { rows: [] }
	]);

	const users = usersResult.rows
		.filter((u) => String(u.id) !== session.user.id)
		.map((u) => ({ id: String(u.id), name: String(u.name || u.email), role: String(u.role) }));

	const channels = channelsResult.rows.map((c) => ({
		id: String(c.id),
		name: String(c.name)
	}));

	const firebaseToken = await createFirebaseToken(session.user.id);

	return {
		firebaseToken,
		users,
		channels,
		currentUser: {
			id: session.user.id,
			name: session.user.name || session.user.email,
			role: session.user.role ?? 'student'
		}
	};
}
