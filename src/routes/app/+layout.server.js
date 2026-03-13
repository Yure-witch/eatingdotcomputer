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
		return { firebaseToken, userId, currentClass, allClasses };
	}

	if (!db) return { firebaseToken, userId, currentClass: null, allClasses: [] };

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
			return { firebaseToken, userId, currentClass, allClasses: [] };
		}

		if (status === 'pending' || status === 'denied') redirect(303, '/onboarding/pending');

		const userResult = await db.execute({
			sql: 'SELECT onboarding_step FROM users WHERE id = ?',
			args: [session.user.id]
		});
		const step = String(userResult.rows[0]?.onboarding_step ?? 'profile');
		redirect(303, step === 'class' ? '/onboarding/class' : '/onboarding/profile');
	} catch (e) {
		if (e?.status) throw e;
		redirect(303, '/onboarding/profile');
	}
}
