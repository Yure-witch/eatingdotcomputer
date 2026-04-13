import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { uploadToR2 } from '$lib/server/r2.js';
import { toWebp } from '$lib/server/media.js';
import { requireClassAccess } from '$lib/server/access.js';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS reaction_images (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	url TEXT NOT NULL,
	r2_key TEXT,
	tags TEXT DEFAULT '',
	created_by_id TEXT,
	created_by_name TEXT,
	created_at TEXT DEFAULT (datetime('now'))
)`;

export async function GET({ url: reqUrl }) {
	const db = getDb();
	if (!db) return json([]);
	await db.execute(CREATE_TABLE);

	// CORS pre-check: ?cors=URL
	const checkUrl = reqUrl.searchParams.get('cors');
	if (checkUrl) {
		try {
			const res = await fetch(checkUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
			const acao = res.headers.get('access-control-allow-origin');
			const ok = acao === '*' || (acao != null && acao.length > 0);
			return json({ ok, acao: acao ?? null, status: res.status });
		} catch (e) {
			return json({ ok: false, acao: null, error: String(e) });
		}
	}

	const result = await db.execute(
		`SELECT id, name, url, tags FROM reaction_images ORDER BY created_at ASC`
	);
	return json(result.rows.map(r => ({
		id: r.id,
		name: r.name,
		url: r.url,
		tags: r.tags ?? ''
	})));
}

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const db = getDb();
	if (db) await db.execute(CREATE_TABLE);

	const formData = await request.formData();
	const name = String(formData.get('name') ?? '').trim();
	const tags = String(formData.get('tags') ?? '').trim();
	const externalUrl = String(formData.get('url') ?? '').trim();

	if (!name) error(400, 'Missing name');

	// — URL mode: store external link (after CORS verification) —
	if (externalUrl) {
		try {
			new URL(externalUrl); // validate
		} catch { error(400, 'Invalid URL'); }

		// Server-side CORS check
		let corsOk = false;
		try {
			const res = await fetch(externalUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
			const acao = res.headers.get('access-control-allow-origin');
			corsOk = acao === '*' || (acao != null && acao.length > 0);
		} catch { error(400, 'Could not reach URL'); }

		if (!corsOk) error(400, 'URL does not allow cross-origin access (no CORS headers)');

		const id = crypto.randomUUID();
		if (db) {
			await db.execute({
				sql: `INSERT INTO reaction_images (id, name, url, r2_key, tags, created_by_id, created_by_name)
				      VALUES (?, ?, ?, NULL, ?, ?, ?)`,
				args: [id, name, externalUrl, tags, session.user.id, session.user.name || session.user.email]
			});
		}
		return json({ id, name, url: externalUrl, tags });
	}

	// — File upload mode —
	const file = formData.get('file');
	if (!file || typeof file === 'string' || file.size === 0) error(400, 'No file or URL provided');
	if (file.size > MAX_BYTES) error(413, 'File too large (max 25 MB)');
	if (!file.type.startsWith('image/')) error(400, 'File must be an image');

	const inputBuffer = Buffer.from(await file.arrayBuffer());
	const converted = await toWebp(inputBuffer);

	const id = crypto.randomUUID();
	const key = `reaction-images/${id}.webp`;

	await uploadToR2(key, converted.buffer, converted.mimetype);

	const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	if (!publicBase) error(503, 'Storage public URL not configured');
	const url = `${publicBase}/${key}`;

	if (db) {
		await db.execute({
			sql: `INSERT INTO reaction_images (id, name, url, r2_key, tags, created_by_id, created_by_name)
			      VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [id, name, url, key, tags, session.user.id, session.user.name || session.user.email]
		});
	}

	return json({ id, name, url, tags });
}
