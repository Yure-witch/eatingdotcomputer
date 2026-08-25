import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

// The terms-acceptance gate (Guideline 1.2). The /app and /onboarding
// layouts redirect any signed-in user with a NULL terms_accepted_at here,
// so acceptance happens right after login and before anything else —
// including OAuth users and accounts that predate the terms, which never
// see the sign-up form's checkbox.
export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	if (db) {
		const r = await db.execute({
			sql: 'SELECT terms_accepted_at FROM users WHERE id = ?',
			args: [session.user.id]
		});
		if (r.rows[0]?.terms_accepted_at) redirect(303, '/app');
	}
	return { name: session.user.name ?? '' };
}

export const actions = {
	default: async ({ locals }) => {
		const session = await locals.auth();
		if (!session) redirect(303, '/login');
		const db = getDb();
		if (db) {
			await db.execute({
				sql: `UPDATE users SET terms_accepted_at = datetime('now') WHERE id = ? AND terms_accepted_at IS NULL`,
				args: [session.user.id]
			});
		}
		redirect(303, '/app');
	}
};
