import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadToR2 } from '$lib/server/r2.js';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';
import { cleanupStaleUploads } from '$lib/server/cleanup-uploads.js';
import { toWebp } from '$lib/server/media.js';

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

	const id = crypto.randomUUID();
	let buffer = Buffer.from(await file.arrayBuffer());
	let mimetype = file.type || 'application/octet-stream';
	let filename = file.name;

	if (mimetype.startsWith('image/')) {
		// Convert all images to WebP for consistency and size reduction
		try {
			const converted = await toWebp(buffer);
			buffer = converted.buffer;
			mimetype = converted.mimetype;
			// Replace the file extension with .webp
			filename = filename.replace(/\.[^.]+$/, '') + '.' + converted.ext;
		} catch (convErr) {
			console.warn('WebP conversion failed, uploading original', convErr);
		}
	} else if (mimetype.startsWith('video/')) {
		// TODO: transcode video to WebM/H.264 — skipped for now (FFmpeg is too large for Vercel serverless)
	}

	const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	const key = `uploads/${id}-${safeName}`;

	await uploadToR2(key, buffer, mimetype);

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
				filename,
				mimetype,
				buffer.length,
				session.user.id,
				session.user.name || session.user.email,
				contextType, contextId, classId
			]
		});
		// Non-blocking: clean up any stale unconfirmed uploads older than 5 minutes
		cleanupStaleUploads(db).catch(() => {});
	}

	return json({ id, url, filename, size: buffer.length, mimetype });
}
