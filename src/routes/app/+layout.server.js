import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { createFirebaseToken } from '$lib/server/firebase-admin.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const firebaseToken = await createFirebaseToken(session.user.id).catch(() => null);
	const userId = session.user.id;

	// Instructors always get through
	if (session.user.role === 'instructor') return { firebaseToken, userId };

	const db = getDb();
	if (!db) return { firebaseToken, userId }; // local dev without env — skip gate

	try {
		const membershipResult = await db.execute({
			sql: `SELECT status FROM class_memberships
			      WHERE user_id = ?
			      ORDER BY requested_at DESC LIMIT 1`,
			args: [session.user.id]
		});

		const status = String(membershipResult.rows[0]?.status ?? 'none');

		if (status === 'approved') return { firebaseToken, userId };
		if (status === 'pending' || status === 'denied') redirect(303, '/onboarding/pending');

		// No membership — check where they are in onboarding
		const userResult = await db.execute({
			sql: 'SELECT onboarding_step FROM users WHERE id = ?',
			args: [session.user.id]
		});
		const step = String(userResult.rows[0]?.onboarding_step ?? 'profile');
		// 'class' means they explicitly finished profile; anything else (incl. grandfathered 'complete') goes to profile
		redirect(303, step === 'class' ? '/onboarding/class' : '/onboarding/profile');
	} catch (e) {
		if (e?.status) throw e; // rethrow redirects
		// DB error (e.g. migration not run) — send to onboarding
		redirect(303, '/onboarding/profile');
	}
}
