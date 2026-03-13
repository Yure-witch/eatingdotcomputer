import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { createFirebaseToken } from '$lib/server/firebase-admin.js';

export async function load({ locals, parent }) {
	const parentData = await parent(); // wait for app/+layout.server.js to finish (handles auth gate + redirects)
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';

	const [usersResult, channelsResult] = await Promise.all([
		db ? db.execute({
			sql: `SELECT u.id, u.name, u.email, u.role FROM users u
			      WHERE u.role = 'instructor'
			         OR EXISTS (
			              SELECT 1 FROM class_memberships cm
			              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
			            )
			      ORDER BY u.name ASC`,
			args: [classId]
		}) : { rows: [] },
		db ? db.execute({
			sql: "SELECT id, name, created_at FROM conversations WHERE type = 'channel' AND class_id = ? ORDER BY created_at ASC",
			args: [classId]
		}) : { rows: [] }
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
		classId,
		currentUser: {
			id: session.user.id,
			name: session.user.name || session.user.email,
			role: session.user.role ?? 'student'
		}
	};
}
