import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { uploadToR2, deleteFromR2, sweepR2Prefix } from '$lib/server/r2.js';

// Publish a GIF Studio render to R2 so it has a real public URL. The Studio
// then shows it in-page as a draggable <img> pointing here — dragging it into
// Google Slides (or any doc) embeds the animated GIF, since the drop target
// fetches the image by URL (a blob/data URL from another tab wouldn't load).
//
// Renders are EPHEMERAL: swept after 30 min on every upload, deleted
// proactively by the client on replace/dismiss/unload, and backstopped by the
// daily cron. They are never meant to be kept.
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB
const PREFIX = 'gif-studio/';
// 30 min — long enough to render + drag out. (Not exported: SvelteKit
// +server.js only permits HTTP-verb exports + underscore-prefixed names.)
const RENDER_TTL_MS = 30 * 60 * 1000;

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const form = await request.formData();

	// Deletion path (used on replace / dismiss / unload via sendBeacon).
	const deleteKey = form.get('deleteKey');
	if (typeof deleteKey === 'string' && deleteKey) {
		if (deleteKey.startsWith(PREFIX)) await deleteFromR2(deleteKey).catch(() => {});
		return json({ ok: true });
	}

	const file = form.get('file');
	if (!file || typeof file === 'string' || file.size === 0) error(400, 'No file provided');
	if (file.size > MAX_BYTES) error(413, 'Render too large (max 30 MB)');

	const mimetype = file.type === 'image/webp' ? 'image/webp' : 'image/gif';
	const ext = mimetype === 'image/webp' ? 'webp' : 'gif';
	const rawName = String(form.get('name') ?? 'render').replace(/\.[^.]+$/, '');
	const safeName = (rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'render');
	const key = `${PREFIX}${crypto.randomUUID()}-${safeName}.${ext}`;

	const buffer = Buffer.from(await file.arrayBuffer());
	await uploadToR2(key, buffer, mimetype);

	// Non-blocking: sweep anyone's renders older than the TTL on each upload.
	sweepR2Prefix(PREFIX, RENDER_TTL_MS).catch(() => {});

	const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	if (!publicBase) error(503, 'Storage public URL not configured');

	return json({ url: `${publicBase}/${key}`, key, filename: `${safeName}.${ext}` });
}
