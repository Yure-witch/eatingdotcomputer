import { redirect, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');
	if (session.user.role === 'instructor') redirect(303, '/app');

	const db = getDb();

	// Guard: must have explicitly completed the profile step
	if (db) {
		const userRow = await db.execute({
			sql: 'SELECT onboarding_step FROM users WHERE id = ?',
			args: [session.user.id]
		});
		const step = String(userRow.rows[0]?.onboarding_step ?? 'profile');
		if (step !== 'class') redirect(303, '/onboarding/profile');
	}

	const result = db ? await db.execute('SELECT id, name, term, description FROM classes ORDER BY created_at ASC') : { rows: [] };

	return {
		classes: result.rows.map((r) => ({
			id: String(r.id),
			name: String(r.name),
			term: String(r.term),
			description: String(r.description ?? '')
		}))
	};
}

export const actions = {
	default: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) redirect(303, '/login');

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		// Guard: must have completed profile step
		const userRow = await db.execute({
			sql: 'SELECT onboarding_step FROM users WHERE id = ?',
			args: [session.user.id]
		});
		if (String(userRow.rows[0]?.onboarding_step) !== 'class') redirect(303, '/onboarding/profile');

		const data = await request.formData();
		const classId = String(data.get('class_id') ?? '').trim();
		if (!classId) return fail(400, { error: 'Please select a class' });

		await db.execute({
			sql: 'INSERT OR IGNORE INTO class_memberships (id, class_id, user_id) VALUES (?, ?, ?)',
			args: [crypto.randomUUID(), classId, session.user.id]
		});

		await db.execute({
			sql: "UPDATE users SET onboarding_step = 'pending' WHERE id = ?",
			args: [session.user.id]
		});

		redirect(303, '/onboarding/pending');
	}
};
