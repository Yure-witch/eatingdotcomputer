import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadToR2 } from '$lib/server/r2.js';

// Proxy a font file from R2 with CORS headers so the browser's FontFace API can
// load it cross-origin. Validates the requested URL belongs to our R2 bucket.
export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const fontUrl = url.searchParams.get('url');
	if (!fontUrl) error(400, 'Missing url param');

	const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	if (!publicBase || !fontUrl.startsWith(publicBase + '/fonts/')) error(403, 'Forbidden');

	const upstream = await fetch(fontUrl);
	if (!upstream.ok) error(502, 'Font fetch failed');

	const buf = await upstream.arrayBuffer();
	const ct = upstream.headers.get('content-type') ?? 'font/opentype';
	return new Response(buf, {
		headers: {
			'Content-Type': ct,
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'public, max-age=31536000, immutable',
		}
	});
}

const ALLOWED_EXTS = ['ttf', 'otf', 'woff', 'woff2'];
const MIME_MAP = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const formData = await request.formData();
	const file = formData.get('file');

	if (!file || typeof file === 'string' || file.size === 0) error(400, 'No file provided');
	if (file.size > MAX_BYTES) error(413, 'Font file too large (max 10 MB)');

	const ext = (file.name.split('.').pop() ?? '').toLowerCase();
	if (!ALLOWED_EXTS.includes(ext)) error(400, `Unsupported format. Use: ${ALLOWED_EXTS.join(', ')}`);

	const id = crypto.randomUUID();
	const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
	const key = `fonts/${id}-${safeName}`;
	const mime = MIME_MAP[ext] ?? 'font/opentype';

	const buffer = Buffer.from(await file.arrayBuffer());
	await uploadToR2(key, buffer, mime);

	const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	if (!publicBase) error(503, 'Storage public URL not configured');

	const url = `${publicBase}/${key}`;
	// Derive a readable name from the filename (strip extension, clean separators)
	const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

	return json({ url, name });
}
