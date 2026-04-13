import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { uploadToR2 } from '$lib/server/r2.js';
import { resizeToWebp, toWebp, hasTransparency } from '$lib/server/media.js';
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
	if (!file.type.startsWith('image/')) error(400, 'File must be an image');

	const db = getDb();
	if (db) await db.execute(CREATE_TABLE);

	const inputBuffer = Buffer.from(await file.arrayBuffer());

	// Check transparency before resizing (transparent → emoji only; opaque → emoji + reaction image)
	const transparent = await hasTransparency(inputBuffer);

	const converted = await resizeToWebp(inputBuffer, 512);

	const id = crypto.randomUUID();
	const key = `custom-emoji/${id}.webp`;

	await uploadToR2(key, converted.buffer, converted.mimetype);

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
			const reactionConverted = await toWebp(inputBuffer);
			const reactionId = crypto.randomUUID();
			const reactionKey = `reaction-images/${reactionId}.webp`;
			await uploadToR2(reactionKey, reactionConverted.buffer, reactionConverted.mimetype);
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
