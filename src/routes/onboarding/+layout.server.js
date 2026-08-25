import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	// Terms gate (Guideline 1.2): acceptance comes before onboarding, so a
	// fresh OAuth sign-in agrees to the Terms of Use before touching anything
	// else. Credential sign-ups arrive with the timestamp already set by the
	// sign-up form's required checkbox and pass straight through.
	const db = getDb();
	if (db) {
		const terms = await db.execute({
			sql: 'SELECT terms_accepted_at FROM users WHERE id = ?',
			args: [session.user.id]
		});
		if (terms.rows[0] && !terms.rows[0].terms_accepted_at) redirect(303, '/terms/accept');
	}

	return { user: { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role } };
}
