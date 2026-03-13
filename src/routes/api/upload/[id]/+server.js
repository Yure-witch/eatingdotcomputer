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

	// Fetch the record — only the uploader can delete
	const result = await db.execute({
		sql: 'SELECT r2_key, uploaded_by_id FROM uploaded_files WHERE id = ?',
		args: [id]
	});
	const row = result.rows[0];
	if (!row) error(404, 'Not found');
	if (String(row.uploaded_by_id) !== session.user.id) error(403, 'Forbidden');

	await Promise.all([
		deleteFromR2(String(row.r2_key)),
		db.execute({ sql: 'DELETE FROM uploaded_files WHERE id = ?', args: [id] })
	]);

	return json({ ok: true });
}
