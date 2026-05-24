import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { uploadToR2, deleteFromR2 } from '$lib/server/r2.js';
import { resizeToWebp, toWebp, hasTransparency, removeBackground } from '$lib/server/media.js';
import { requireClassAccess } from '$lib/server/access.js';

const SHORTCODE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS custom_emoji (
	id TEXT PRIMARY KEY,
	shortcode TEXT UNIQUE NOT NULL,
	url TEXT NOT NULL,
	r2_key TEXT NOT NULL,
	tags TEXT DEFAULT '',
	created_by_id TEXT,
	created_by_name TEXT,
	created_at TEXT DEFAULT (datetime('now'))
)`;

export async function GET() {
	const db = getDb();
	if (!db) return json([]);
	await db.execute(CREATE_TABLE);
	const result = await db.execute(
		`SELECT id, shortcode, url, tags FROM custom_emoji ORDER BY created_at ASC`
	);
	return json(result.rows.map(r => ({
		id: r.id,
		shortcode: r.shortcode,
		url: r.url,
		tags: r.tags ?? ''
	})));
}

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const formData = await request.formData();
	const file = formData.get('file');
	const shortcode = String(formData.get('shortcode') ?? '').trim();
	const tags = String(formData.get('tags') ?? '').trim();

	if (!file || typeof file === 'string' || file.size === 0) error(400, 'No file provided');
	if (!shortcode) error(400, 'Missing shortcode');
	if (!SHORTCODE_RE.test(shortcode)) error(400, 'Invalid shortcode: only alphanumeric, underscores, hyphens, 1-32 chars');
	if (file.size > MAX_BYTES) error(413, 'File too large (max 5 MB)');
	const fname = (file.name ?? '').toLowerCase();
	const isHeic = fname.endsWith('.heic') || fname.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif';
	if (!file.type.startsWith('image/') && !isHeic) error(400, 'File must be an image');

	const db = getDb();
	if (db) await db.execute(CREATE_TABLE);

	const removeBg = formData.get('removeBg') === '1';
	const removeBgColorStr = formData.get('removeBgColor');
	const removeBgColor = removeBgColorStr ? removeBgColorStr.split(',').map(Number) : null;
	let inputBuffer = Buffer.from(await file.arrayBuffer());
	const isGif = file.type === 'image/gif';

	const id = crypto.randomUUID();
	let key, uploadBuffer, uploadMime;

	if (removeBg) {
		let result;
		try { result = await removeBackground(inputBuffer, removeBgColor); }
		catch (e) { error(422, 'Background removal failed: ' + (e?.message ?? e)); }
		key = `custom-emoji/${id}.${result.ext}`;
		uploadBuffer = result.buffer;
		uploadMime = result.mimetype;
	} else if (isGif) {
		key = `custom-emoji/${id}.gif`;
		uploadBuffer = inputBuffer;
		uploadMime = 'image/gif';
	} else {
		const converted = await resizeToWebp(inputBuffer, 512);
		key = `custom-emoji/${id}.webp`;
		uploadBuffer = converted.buffer;
		uploadMime = converted.mimetype;
	}

	// Check transparency (removeBg → always transparent; GIF → treat as opaque for reaction copy)
	const transparent = removeBg ? true : (isGif ? false : await hasTransparency(inputBuffer));

	await uploadToR2(key, uploadBuffer, uploadMime);

	const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	if (!publicBase) error(503, 'Storage public URL not configured');
	const url = `${publicBase}/${key}`;

	if (db) {
		try {
			await db.execute({
				sql: `INSERT INTO custom_emoji (id, shortcode, url, r2_key, tags, created_by_id, created_by_name)
				      VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [id, shortcode, url, key, tags, session.user.id, session.user.name || session.user.email]
			});
		} catch (e) {
			if (e?.message?.includes('UNIQUE') || e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
				error(409, `Shortcode :${shortcode}: is already taken`);
			}
			throw e;
		}

		// Opaque image → also add to reaction images at original resolution
		if (!transparent) {
			const isGif = file.type === 'image/gif';
			let reactionBuf, reactionMime, reactionExt;
			if (isGif) {
				reactionBuf = inputBuffer; reactionMime = 'image/gif'; reactionExt = 'gif';
			} else {
				const reactionConverted = await toWebp(inputBuffer);
				reactionBuf = reactionConverted.buffer; reactionMime = reactionConverted.mimetype; reactionExt = 'webp';
			}
			const reactionId = crypto.randomUUID();
			const reactionKey = `reaction-images/${reactionId}.${reactionExt}`;
			await uploadToR2(reactionKey, reactionBuf, reactionMime);
			const reactionUrl = `${publicBase}/${reactionKey}`;
			await db.execute({
				sql: `INSERT INTO reaction_images (id, name, url, r2_key, tags, created_by_id, created_by_name)
				      VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [reactionId, shortcode, reactionUrl, reactionKey, tags, session.user.id, session.user.name || session.user.email]
			});
		}
	}

	return json({ id, shortcode, url, tags, addedToReactions: !transparent });
}

export async function DELETE({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user || session.user.role !== 'instructor') error(403, 'Instructors only');
	const { id } = await request.json();
	if (!id) error(400, 'Missing id');
	const db = getDb();
	if (!db) error(503, 'Database unavailable');
	await db.execute(CREATE_TABLE);
	const row = (await db.execute({ sql: 'SELECT r2_key FROM custom_emoji WHERE id = ?', args: [id] })).rows[0];
	if (!row) error(404, 'Not found');
	if (row.r2_key) try { await deleteFromR2(String(row.r2_key)); } catch {}
	await db.execute({ sql: 'DELETE FROM custom_emoji WHERE id = ?', args: [id] });
	return json({ ok: true });
}
