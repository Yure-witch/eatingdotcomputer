import { json, error } from '@sveltejs/kit';
import { archiveCaller, validateManifest } from '$lib/server/work-archive.js';
import { normalizeArchivePath, typeForPath, ARCHIVE_LIMITS, MANIFEST_PATH } from '$lib/work-archive.js';

// Dry run: check a manifest BEFORE uploading anything. Body:
//   { "manifest": { ...manifest.json... }, "files": ["images/a/01.png", ...] }
// `files` is the list of paths the agent intends to upload. Returns the same
// errors/warnings /complete would, so an agent can iterate cheaply. The body
// rides through the serverless function, so it is capped (~4MB); a bigger
// manifest skips this step and relies on /complete.
export async function POST(event) {
	await archiveCaller(event, { allowToken: true });
	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Body must be JSON: { manifest, files }');
	const uploaded = new Map([[MANIFEST_PATH, 0]]);
	const fileErrors = [];
	for (const f of Array.isArray(body.files) ? body.files : []) {
		const raw = typeof f === 'string' ? f : f?.path;
		const p = normalizeArchivePath(raw);
		const type = p && typeForPath(p);
		const size = Number(f?.size ?? 0) || 0;
		if (!p) fileErrors.push({ code: 'bad_path', message: `"${raw}": rename it — letters, digits, . _ - and / only, no spaces` });
		else if (!type) fileErrors.push({ code: 'bad_type', message: `"${p}": file type not accepted` });
		else {
			if (size > ARCHIVE_LIMITS.maxBytes[type.kind]) fileErrors.push({ code: 'file_too_large', message: `"${p}" is ${Math.round(size / 1048576)} MB — the ${type.kind} limit is ${Math.round(ARCHIVE_LIMITS.maxBytes[type.kind] / 1048576)} MB; downscale or compress it` });
			uploaded.set(p, size);
		}
	}
	const { errors: manifestErrors, warnings, stats } = validateManifest(body.manifest, uploaded);
	const errors = [...fileErrors, ...manifestErrors];
	return json({ ok: errors.length === 0, errors, warnings, stats }, { status: errors.length ? 422 : 200 });
}
