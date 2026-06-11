import { json, error } from '@sveltejs/kit';
import { deleteFromR2 } from '$lib/server/r2.js';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function DELETE({ params, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { id } = params;
	const db = getDb();
	if (!db) error(503, 'Database not available');

	// Fetch the record — the uploader can always delete; instructors
	// can delete anyone's upload so they can moderate the Orbit
	// uploads gallery. (Students who didn't upload still get a 403.)
	const result = await db.execute({
		sql: 'SELECT r2_key, uploaded_by_id FROM uploaded_files WHERE id = ?',
		args: [id]
	});
	const row = result.rows[0];
	if (!row) error(404, 'Not found');
	const isInstructor = session.user.role === 'instructor';
	const isUploader = String(row.uploaded_by_id) === session.user.id;
	if (!isInstructor && !isUploader) error(403, 'Forbidden');

	await Promise.all([
		deleteFromR2(String(row.r2_key)),
		db.execute({ sql: 'DELETE FROM uploaded_files WHERE id = ?', args: [id] })
	]);

	return json({ ok: true });
}
