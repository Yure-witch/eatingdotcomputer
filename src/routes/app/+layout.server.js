import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { createFirebaseToken } from '$lib/server/firebase-admin.js';

export async function load({ locals, cookies }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const firebaseToken = await createFirebaseToken(session.user.id).catch(() => null);
	const userId = session.user.id;
	const db = getDb();

	let currentClass = null;
	let allClasses = [];

	if (session.user.role === 'instructor') {
		if (db) {
			const result = await db.execute(
				'SELECT id, name, term FROM classes ORDER BY created_at ASC'
			);
			allClasses = result.rows.map((r) => ({
				id: String(r.id),
				name: String(r.name),
				term: String(r.term)
			}));
		}
		const selectedId = cookies.get('selected_class_id');
		currentClass = allClasses.find((c) => c.id === selectedId) ?? allClasses[0] ?? null;
	} else {
		if (!db) redirect(303, '/onboarding/profile');
		try {
			const membershipResult = await db.execute({
				sql: `SELECT cm.status, cm.class_id, c.name, c.term
				      FROM class_memberships cm
				      JOIN classes c ON cm.class_id = c.id
				      WHERE cm.user_id = ?
				      ORDER BY cm.requested_at DESC LIMIT 1`,
				args: [session.user.id]
			});
			const row = membershipResult.rows[0];
			const status = String(row?.status ?? 'none');
			if (status === 'approved') {
				currentClass = {
					id: String(row.class_id),
					name: String(row.name),
					term: String(row.term)
				};
			} else if (status === 'pending' || status === 'denied') {
				redirect(303, '/onboarding/pending');
			} else {
				const userResult = await db.execute({
					sql: 'SELECT onboarding_step FROM users WHERE id = ?',
					args: [session.user.id]
				});
				const step = String(userResult.rows[0]?.onboarding_step ?? 'profile');
				redirect(303, step === 'class' ? '/onboarding/class' : '/onboarding/profile');
			}
		} catch (e) {
			if (e?.status) throw e;
			redirect(303, '/onboarding/profile');
		}
	}

	// Load sidebar data (channels + class members)
	const classId = currentClass?.id ?? null;
	let users = [];
	let channels = [];

	if (classId && db) {
		const [usersResult, channelsResult] = await Promise.all([
			db.execute({
				sql: `SELECT u.id, u.name, u.email, u.role FROM users u
				      WHERE u.role = 'instructor'
				         OR EXISTS (
				              SELECT 1 FROM class_memberships cm
				              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
				            )
				      ORDER BY u.name ASC`,
				args: [classId]
			}),
			db.execute({
				sql: "SELECT id, name, created_at FROM conversations WHERE type = 'channel' AND class_id = ? ORDER BY created_at ASC",
				args: [classId]
			})
		]);

		users = usersResult.rows
			.filter((u) => String(u.id) !== session.user.id)
			.map((u) => ({ id: String(u.id), name: String(u.name || u.email), role: String(u.role) }));

		channels = channelsResult.rows.map((c) => ({ id: String(c.id), name: String(c.name) }));
	}

	const currentUser = {
		id: session.user.id,
		name: session.user.name || session.user.email || '',
		role: session.user.role ?? 'student'
	};

	return { firebaseToken, userId, currentClass, allClasses, users, channels, classId, currentUser };
}
