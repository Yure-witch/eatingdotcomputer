import { getR2Text } from '$lib/server/r2.js';
import { archiveCaller, requireDb, loadSubmission, loadSubmissionDetail } from '$lib/server/work-archive.js';

// One archive, rendered. The owner sees exactly what the instructor sees.
export async function load(event) {
	const caller = await archiveCaller(event);
	const db = requireDb();
	const row = await loadSubmission(db, event.params.id, caller);
	const detail = await loadSubmissionDetail(db, row, { getText: getR2Text });
	const owner = (await db.execute({ sql: 'SELECT name, email FROM users WHERE id = ?', args: [row.user_id] })).rows[0];
	return {
		...detail,
		owner: { name: String(owner?.name ?? owner?.email ?? ''), isMe: String(row.user_id) === caller.userId },
		viewerRole: caller.role
	};
}
