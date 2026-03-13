import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const body = await request.json();
	const name = body.name;
	const classId = body.class_id ?? 'idc-fall-2026';
	if (!name?.trim()) error(400, 'Channel name required');

	const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
	if (!slug) error(400, 'Invalid channel name');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const existing = await db.execute({ sql: 'SELECT id FROM conversations WHERE id = ?', args: [slug] });
	if (existing.rows.length) error(409, 'Channel already exists');

	await db.execute({
		sql: "INSERT INTO conversations (id, type, name, created_by, class_id) VALUES (?, 'channel', ?, ?, ?)",
		args: [slug, slug, session.user.id, classId]
	});

	return json({ id: slug, name: slug });
}
