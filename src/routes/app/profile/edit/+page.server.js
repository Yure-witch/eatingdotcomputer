import { redirect, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	const result = db ? await db.execute({
		sql: 'SELECT name, pronouns, bio, website FROM users WHERE id = ?',
		args: [session.user.id]
	}) : { rows: [] };

	const u = result.rows[0] ?? {};
	return {
		prefill: {
			name: String(u.name ?? ''),
			pronouns: String(u.pronouns ?? ''),
			bio: String(u.bio ?? ''),
			website: String(u.website ?? '')
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

		await db.execute({
			sql: 'UPDATE users SET name = ?, pronouns = ?, bio = ?, website = ? WHERE id = ?',
			args: [name, pronouns || null, bio || null, website || null, session.user.id]
		});

		redirect(303, `/app/profile/${session.user.id}`);
	}
};
