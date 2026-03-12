import { redirect, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

/**
 * Returns the session if the user is allowed to access class data:
 * - Instructors are always allowed.
 * - Students must have an approved class_membership row.
 *
 * @param {import('@auth/sveltekit').Session | null} session
 * @param {{ type: 'redirect' | 'error' }} [opts]
 */
export async function requireClassAccess(session, opts = { type: 'error' }) {
	if (!session) {
		if (opts.type === 'redirect') redirect(303, '/login');
		error(401, 'Not authenticated');
	}

	// Instructors always have access
	if (session.user.role === 'instructor') return session;

	const db = getDb();
	if (!db) {
		// No DB (local dev without env) — allow through
		return session;
	}

	const result = await db.execute({
		sql: `SELECT status FROM class_memberships WHERE user_id = ? AND status = 'approved' LIMIT 1`,
		args: [session.user.id]
	});

	if (!result.rows.length) {
		if (opts.type === 'redirect') redirect(303, '/onboarding/pending');
		error(403, 'Not an approved class member');
	}

	return session;
}
