import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function GET({ locals, params }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute({
		sql: 'SELECT id, name, pronouns, bio, website, year, school, focus, role FROM users WHERE id = ?',
		args: [params.userId]
	});

	if (!result.rows.length) error(404, 'Not found');
	const u = result.rows[0];

	return json({
		id: String(u.id),
		name: String(u.name ?? ''),
		pronouns: String(u.pronouns ?? ''),
		bio: String(u.bio ?? ''),
		website: String(u.website ?? ''),
		year: String(u.year ?? ''),
		school: String(u.school ?? ''),
		focus: String(u.focus ?? ''),
		role: String(u.role ?? 'student')
	});
}
