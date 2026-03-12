import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	// Instructors always get through
	if (session.user.role === 'instructor') return {};

	const db = getDb();
	if (!db) return {}; // local dev without env — skip gate

	try {
		const membershipResult = await db.execute({
			sql: `SELECT status FROM class_memberships
			      WHERE user_id = ?
			      ORDER BY requested_at DESC LIMIT 1`,
			args: [session.user.id]
		});

		const status = String(membershipResult.rows[0]?.status ?? 'none');

		if (status === 'approved') return {};
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
