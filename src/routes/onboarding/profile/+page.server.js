import { redirect, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	const result = db ? await db.execute({
		sql: 'SELECT name, bio, pronouns, website FROM users WHERE id = ?',
		args: [session.user.id]
	}) : { rows: [] };

	const u = result.rows[0];
	return {
		prefill: {
			name: String(u?.name ?? session.user.name ?? ''),
			bio: String(u?.bio ?? ''),
			pronouns: String(u?.pronouns ?? ''),
			website: String(u?.website ?? '')
		}
	};
}

export const actions = {
	default: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) redirect(303, '/login');

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const pronouns = String(data.get('pronouns') ?? '').trim();
		const bio = String(data.get('bio') ?? '').trim();
		const website = String(data.get('website') ?? '').trim();

		if (!name) return fail(400, { error: 'Name is required', name, pronouns, bio, website });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		// Instructors skip class selection
		const nextStep = session.user.role === 'instructor' ? 'complete' : 'class';

		await db.execute({
			sql: 'UPDATE users SET name = ?, pronouns = ?, bio = ?, website = ?, onboarding_step = ? WHERE id = ?',
			args: [name, pronouns || null, bio || null, website || null, nextStep, session.user.id]
		});

		redirect(303, nextStep === 'complete' ? '/app' : '/onboarding/class');
	}
};
