import { json, error } from '@sveltejs/kit';
import { getR2Text } from '$lib/server/r2.js';
import {
	archiveCaller, requireDb, loadSubmission, loadSubmissionDetail, deleteSubmission
} from '$lib/server/work-archive.js';

// One submission: its status, files (public URLs) and manifest. The owner or
// an instructor may read it; the owner (or an instructor) may delete it —
// a student withdrawing their archive is always allowed.
export async function GET(event) {
	const caller = await archiveCaller(event, { allowToken: true });
	const db = requireDb();
	const row = await loadSubmission(db, event.params.id, caller);
	return json(await loadSubmissionDetail(db, row, { getText: getR2Text }));
}

export async function DELETE(event) {
	const caller = await archiveCaller(event, { allowToken: true });
	const db = requireDb();
	const row = await loadSubmission(db, event.params.id, caller);
	// A token may only clean up its own unfinished attempts; withdrawing a
	// sealed archive is a decision for the student in the browser.
	if (caller.via === 'token' && String(row.status) !== 'open') {
		error(403, 'Only unfinished submissions can be deleted with an upload token — delete completed ones from /app/archive');
	}
	await deleteSubmission(db, row);
	return json({ deleted: true });
}
