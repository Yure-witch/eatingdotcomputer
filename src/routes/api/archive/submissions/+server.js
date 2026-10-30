import { json, error } from '@sveltejs/kit';
import { archiveCaller, requireDb, deleteSubmission } from '$lib/server/work-archive.js';
import { ARCHIVE_LIMITS } from '$lib/work-archive.js';

// Start a submission. Every submission is a full snapshot of the student's
// work; files are then presigned via ./[id]/files and the whole thing is
// checked and sealed by ./[id]/complete.
export async function POST(event) {
	const caller = await archiveCaller(event, { allowToken: true });
	const db = requireDb();
	const body = await event.request.json().catch(() => ({}));
	const agent = typeof body?.agent === 'string' ? body.agent.trim().slice(0, 160) : null;

	// Abandoned attempts (never completed) are cleared after two days so a
	// crashed agent doesn't leave half an archive in storage forever.
	const stale = (await db.execute({
		sql: `SELECT id, user_id FROM archive_submissions
		      WHERE user_id = ? AND status = 'open' AND created_at < datetime('now', '-2 days')`,
		args: [caller.userId]
	})).rows;
	for (const row of stale) await deleteSubmission(db, row).catch(() => {});

	const open = Number((await db.execute({
		sql: `SELECT COUNT(*) AS n FROM archive_submissions WHERE user_id = ? AND status = 'open'`,
		args: [caller.userId]
	})).rows[0]?.n ?? 0);
	if (open >= 3) error(429, 'You already have 3 unfinished submissions. Finish one (POST …/complete) or delete it (DELETE /api/archive/submissions/<id>) first');

	const today = Number((await db.execute({
		sql: `SELECT COUNT(*) AS n FROM archive_submissions WHERE user_id = ? AND created_at > datetime('now', '-1 day')`,
		args: [caller.userId]
	})).rows[0]?.n ?? 0);
	if (today >= 20) error(429, 'Too many submissions in the last 24 hours');

	const id = crypto.randomUUID();
	await db.execute({
		sql: `INSERT INTO archive_submissions (id, user_id, class_id, via, agent) VALUES (?, ?, ?, ?, ?)`,
		args: [id, caller.userId, caller.classId, caller.via, agent]
	});
	return json({
		id,
		status: 'open',
		next: {
			presign: `/api/archive/submissions/${id}/files`,
			complete: `/api/archive/submissions/${id}/complete`
		},
		limits: ARCHIVE_LIMITS
	}, { status: 201 });
}
