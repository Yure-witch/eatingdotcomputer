import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import sharp from 'sharp';
import { getDb } from '$lib/server/turso.js';
import { uploadToR2 } from '$lib/server/r2.js';
import { previewKey } from '$lib/server/site-preview.js';

// Where the Scout worker delivers a rendered screenshot.
//
// Links with no og:image get a `shot` job queued for kahan (see the enqueue in
// ../+server.js). kahan renders the page in a headless Chrome it can't reach
// us from — it's outbound-only — so it POSTs the PNG here, as raw bytes with
// the job id in the query string, and this end does the resizing, the R2
// write and the bookkeeping.
//
// Same shared-token auth as /api/scout/jobs: the worker lives outside the
// app's auth world entirely.

const MAX_PNG = 12 * 1024 * 1024;

export async function POST({ request, url }) {
	const token = env.SCOUT_TOKEN;
	if (!token) error(503, 'Scout not configured');
	const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
	if (got !== token) error(401, 'Bad token');

	const jobId = Number(url.searchParams.get('job'));
	if (!jobId) error(400, 'Missing job id');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const job = (await db.execute({
		sql: `SELECT query FROM scout_jobs WHERE id = ? AND kind = 'shot'`,
		args: [jobId]
	})).rows[0];
	if (!job) error(404, 'No such shot job');
	const target = String(job.query);

	const png = Buffer.from(await request.arrayBuffer());
	if (!png.length) error(400, 'Empty body');
	if (png.length > MAX_PNG) error(413, 'Screenshot too large');

	// Same shape as the OG path so the two are interchangeable in the gallery:
	// capped at 1200px, WebP, keyed by a hash of the URL.
	let webp;
	try {
		webp = await sharp(png)
			.resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: 82 })
			.toBuffer();
	} catch {
		await db.execute({
			sql: `UPDATE scout_jobs SET status = 'error', error = 'unreadable image', updated_at = datetime('now') WHERE id = ?`,
			args: [jobId]
		});
		error(400, 'Not a readable image');
	}

	const key = `site-previews/${previewKey(target)}.webp`;
	await uploadToR2(key, webp, 'image/webp');

	// `error` held "No preview image published" — the screenshot is the answer
	// to that, so clear it.
	await db.execute({
		sql: `UPDATE lab_websites
		      SET image_key = ?, error = NULL, status = 'ready', fetched_at = datetime('now')
		      WHERE url = ?`,
		args: [key, target]
	});
	await db.execute({
		sql: `UPDATE scout_jobs SET status = 'done', result = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`,
		args: [JSON.stringify({ key, bytes: webp.length }), jobId]
	});

	return json({ ok: true, key, bytes: webp.length });
}
