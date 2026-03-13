import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadToR2 } from '$lib/server/r2.js';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';
import { cleanupStaleUploads } from '$lib/server/cleanup-uploads.js';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const formData = await request.formData();
	const file = formData.get('file');
	const contextType = String(formData.get('contextType') ?? '');
	const contextId = String(formData.get('contextId') ?? '');
	const classId = formData.get('classId') ? String(formData.get('classId')) : null;

	if (!file || typeof file === 'string' || file.size === 0) error(400, 'No file provided');
	if (!['channel', 'dm'].includes(contextType)) error(400, 'Invalid contextType');
	if (!contextId) error(400, 'Missing contextId');
	if (file.size > MAX_BYTES) error(413, 'File too large (max 25 MB)');

	const ext = file.name.split('.').pop() ?? '';
	const id = crypto.randomUUID();
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
	const key = `uploads/${id}-${safeName}`;

	const buffer = Buffer.from(await file.arrayBuffer());
	await uploadToR2(key, buffer, file.type || 'application/octet-stream');

	const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	if (!publicBase) error(503, 'Storage public URL not configured');
	const url = `${publicBase}/${key}`;

	const db = getDb();
	if (db) {
		await db.execute({
			sql: `INSERT INTO uploaded_files (id, url, r2_key, filename, mimetype, size, uploaded_by_id, uploaded_by_name, uploaded_at, context_type, context_id, class_id, confirmed)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, 0)`,
			args: [
				id, url, key,
				file.name,
				file.type || 'application/octet-stream',
				file.size,
				session.user.id,
				session.user.name || session.user.email,
				contextType, contextId, classId
			]
		});
		// Non-blocking: clean up any stale unconfirmed uploads older than 5 minutes
		cleanupStaleUploads(db).catch(() => {});
	}

	return json({ id, url, filename: file.name, size: file.size, mimetype: file.type });
}
