import { json, error } from '@sveltejs/kit';
import { presignPutToR2 } from '$lib/server/r2.js';
import { archiveCaller, requireDb, loadSubmission, assetKey } from '$lib/server/work-archive.js';
import { ARCHIVE_LIMITS, normalizeArchivePath, typeForPath } from '$lib/work-archive.js';

/**
 * Presign uploads for a batch of files. Body:
 *   { "files": [ { "path": "images/my-project/01-hero.png", "size": 123456, "sha256": "…" }, … ] }
 * Up to ARCHIVE_LIMITS.presignBatch per call. Each accepted file comes back
 * with a URL to PUT the raw bytes to, and the exact headers to send. Bytes go
 * straight to storage — never through this function — so file size is bounded
 * by the per-kind limits, not the platform's request-body cap.
 *
 * Re-presigning a path that was already sent replaces that file (same key),
 * which is how an agent fixes manifest.json after /complete reports errors.
 */
export async function POST(event) {
	const caller = await archiveCaller(event, { allowToken: true });
	const db = requireDb();
	const row = await loadSubmission(db, event.params.id, caller);
	if (String(row.user_id) !== caller.userId) error(403, 'Only the owner can upload to a submission');
	if (String(row.status) !== 'open') error(409, 'This submission is already complete — start a new one to upload again');

	const body = await event.request.json().catch(() => null);
	const files = Array.isArray(body?.files) ? body.files : null;
	if (!files?.length) error(400, 'Body must be { "files": [ { "path", "size" } ] }');
	if (files.length > ARCHIVE_LIMITS.presignBatch) error(413, `At most ${ARCHIVE_LIMITS.presignBatch} files per presign call`);

	const existing = new Map((await db.execute({
		sql: 'SELECT path, size FROM archive_assets WHERE submission_id = ?',
		args: [row.id]
	})).rows.map((r) => [String(r.path), Number(r.size)]));
	let count = existing.size;
	let total = [...existing.values()].reduce((a, b) => a + b, 0);

	const uploads = [];
	const rejected = [];
	const writes = [];
	const seen = new Set();
	for (const f of files) {
		const raw = typeof f?.path === 'string' ? f.path : '';
		const path = normalizeArchivePath(raw);
		if (!path) { rejected.push({ path: raw, reason: 'Bad path — use relative paths of letters, digits, . _ - and / only (no spaces), e.g. images/my-project/01-hero.png' }); continue; }
		if (seen.has(path)) { rejected.push({ path, reason: 'Listed twice in this batch' }); continue; }
		seen.add(path);
		const type = typeForPath(path);
		if (!type) { rejected.push({ path, reason: 'File type not accepted (images, mp4/webm/mov, pdf, md, txt, and manifest.json)' }); continue; }
		const size = Number(f?.size);
		if (!Number.isFinite(size) || size <= 0) { rejected.push({ path, reason: 'size (bytes) is required' }); continue; }
		const cap = ARCHIVE_LIMITS.maxBytes[type.kind];
		if (size > cap) { rejected.push({ path, reason: `Too large — the ${type.kind} limit is ${Math.round(cap / 1048576)} MB; downscale or compress it` }); continue; }
		const prev = existing.get(path);
		const nextCount = count + (prev === undefined ? 1 : 0);
		const nextTotal = total - (prev ?? 0) + size;
		if (nextCount > ARCHIVE_LIMITS.maxFiles) { rejected.push({ path, reason: `Submission is over the ${ARCHIVE_LIMITS.maxFiles}-file limit` }); continue; }
		if (nextTotal > ARCHIVE_LIMITS.maxTotalBytes) { rejected.push({ path, reason: 'Submission is over the 3 GB total limit' }); continue; }
		count = nextCount;
		total = nextTotal;

		const key = assetKey(caller.userId, String(row.id), path);
		let url;
		try {
			url = await presignPutToR2(key, type.contentType, ARCHIVE_LIMITS.presignTtlSeconds);
		} catch {
			error(503, 'Storage unavailable — try again shortly');
		}
		const sha = typeof f?.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(f.sha256) ? f.sha256.toLowerCase() : null;
		writes.push({
			sql: `INSERT INTO archive_assets (submission_id, path, r2_key, content_type, kind, size, sha256, uploaded)
			      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
			      ON CONFLICT(submission_id, path) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, uploaded = 0`,
			args: [row.id, path, key, type.contentType, type.kind, size, sha]
		});
		uploads.push({
			path,
			method: 'PUT',
			url,
			headers: { 'Content-Type': type.contentType },
			expiresIn: ARCHIVE_LIMITS.presignTtlSeconds
		});
	}
	if (writes.length) await db.batch(writes, 'write');
	return json({ uploads, rejected });
}
