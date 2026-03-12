import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getR2Stream } from '$lib/server/r2.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function GET({ params, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute({
		sql: 'SELECT type, value, student_id FROM submissions WHERE id = ?',
		args: [params.id]
	});
	const sub = result.rows[0];
	if (!sub) error(404, 'Not found');

	// Students can only fetch their own files; instructors see all
	if (session.user.role !== 'instructor' && sub.student_id !== session.user.id) {
		error(403, 'Forbidden');
	}

	const r2 = await getR2Stream(String(sub.value));
	if (!r2) error(503, 'Storage unavailable');

	return new Response(r2.body, {
		headers: { 'Content-Type': r2.contentType ?? 'application/octet-stream' }
	});
}
