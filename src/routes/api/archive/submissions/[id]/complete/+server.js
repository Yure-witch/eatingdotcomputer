import { json, error } from '@sveltejs/kit';
import { listR2Prefix, getR2Text } from '$lib/server/r2.js';
import {
	archiveCaller, requireDb, loadSubmission, assetKey, validateManifest
} from '$lib/server/work-archive.js';
import { ARCHIVE_LIMITS, MANIFEST_PATH, typeForPath } from '$lib/work-archive.js';

/**
 * Seal a submission. Reads what is ACTUALLY in storage (not what was
 * presigned), parses manifest.json, and validates it against the protocol.
 *
 *   200 { ok: true,  warnings, stats, url }   → archived
 *   422 { ok: false, errors, warnings, stats } → still open; fix and call again
 *
 * Nothing is lost on a 422: re-upload whatever the errors name (same paths
 * overwrite) and call /complete again.
 */
export async function POST(event) {
	const caller = await archiveCaller(event, { allowToken: true });
	const db = requireDb();
	const row = await loadSubmission(db, event.params.id, caller);
	if (String(row.user_id) !== caller.userId) error(403, 'Only the owner can complete a submission');
	if (String(row.status) !== 'open') error(409, 'This submission is already complete');

	const prefix = assetKey(caller.userId, String(row.id), '');
	let listing;
	try {
		listing = await listR2Prefix(prefix);
	} catch {
		error(503, 'Storage unavailable — try again shortly');
	}
	const uploaded = new Map(listing.map((o) => [o.key.slice(prefix.length), o.size]));

	const fail = async (errors, warnings = [], stats = {}) => {
		const report = { at: new Date().toISOString(), errors, warnings };
		await db.execute({ sql: 'UPDATE archive_submissions SET last_report = ? WHERE id = ?', args: [JSON.stringify(report), row.id] });
		return json({ ok: false, errors, warnings, stats }, { status: 422 });
	};

	// Size limits are enforced on what actually arrived — a presigned PUT can't
	// be trusted to have sent the size it declared.
	const sizeErrors = [];
	for (const [path, size] of uploaded) {
		const type = typeForPath(path);
		const cap = type ? ARCHIVE_LIMITS.maxBytes[type.kind] : 0;
		if (!type || size > cap) sizeErrors.push({ code: 'file_too_large', message: `"${path}" is ${Math.round(size / 1048576)} MB — over the limit for its type; re-upload it smaller` });
	}
	if (sizeErrors.length) return fail(sizeErrors);

	if (!uploaded.has(MANIFEST_PATH)) {
		return fail([{ code: 'no_manifest', message: 'manifest.json has not been uploaded — presign it like any other file and PUT it, then call /complete again' }]);
	}
	let manifest;
	try {
		manifest = JSON.parse(await getR2Text(prefix + MANIFEST_PATH) ?? '');
	} catch (e) {
		return fail([{ code: 'bad_json', message: `manifest.json is not valid JSON: ${String(e?.message ?? e).slice(0, 200)}` }]);
	}

	const { errors, warnings, stats, digest } = validateManifest(manifest, uploaded);
	if (errors.length) return fail(errors, warnings, stats);

	const writes = [
		{ sql: 'DELETE FROM archive_assets WHERE submission_id = ? AND path NOT IN (' + [...uploaded.keys()].map(() => '?').join(',') + ')', args: [row.id, ...uploaded.keys()] },
		...[...uploaded].map(([path, size]) => ({
			sql: 'UPDATE archive_assets SET uploaded = 1, size = ? WHERE submission_id = ? AND path = ?',
			args: [size, row.id, path]
		})),
		{
			sql: `UPDATE archive_submissions
			      SET status = 'complete', completed_at = datetime('now'),
			          project_count = ?, idea_count = ?, asset_count = ?, total_bytes = ?,
			          digest = ?, last_report = ?
			      WHERE id = ?`,
			args: [
				stats.projects, stats.ideas, stats.assets, stats.bytes,
				JSON.stringify(digest),
				JSON.stringify({ at: new Date().toISOString(), errors: [], warnings }),
				row.id
			]
		}
	];
	await db.batch(writes, 'write');

	return json({
		ok: true,
		id: String(row.id),
		url: `${event.url.origin}/app/archive/${row.id}`,
		stats,
		warnings
	});
}
