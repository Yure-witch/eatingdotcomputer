import { json, error } from '@sveltejs/kit';
import { getR2Text } from '$lib/server/r2.js';
import { archiveCaller, requireDb, loadSubmissionDetail } from '$lib/server/work-archive.js';
import { ARCHIVE_SCHEMA } from '$lib/work-archive.js';

// Instructor: every student's latest COMPLETE archive in one JSON file —
// manifests inline, files as public URLs. For reporting/grant writing; the
// full offline copy (bytes included) is scripts/export-work-archive.js.
//   ?history=1  → every complete submission, not just the latest per student
export async function GET(event) {
	const caller = await archiveCaller(event);
	if (caller.role !== 'instructor') error(403, 'Instructors only');
	const db = requireDb();
	const history = event.url.searchParams.get('history') === '1';

	const rows = (await db.execute(`
		SELECT s.*, u.name AS user_name, u.email AS user_email
		FROM archive_submissions s JOIN users u ON u.id = s.user_id
		WHERE s.status = 'complete'
		ORDER BY u.name COLLATE NOCASE, s.completed_at DESC`)).rows;
	const picked = history ? rows : rows.filter((r, i) => i === 0 || String(rows[i - 1].user_id) !== String(r.user_id));

	const archives = [];
	for (const r of picked) {
		const detail = await loadSubmissionDetail(db, r, { getText: getR2Text });
		archives.push({
			student: { id: String(r.user_id), name: String(r.user_name ?? ''), email: String(r.user_email ?? '') },
			...detail
		});
	}
	const stamp = new Date().toISOString().slice(0, 10);
	return json(
		{ protocol: ARCHIVE_SCHEMA, exportedAt: new Date().toISOString(), count: archives.length, archives },
		{ headers: { 'Content-Disposition': `attachment; filename="work-archive-${stamp}.json"` } }
	);
}
