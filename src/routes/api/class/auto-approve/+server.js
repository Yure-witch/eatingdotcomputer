import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

// Auto-approval for demo/test-environment classes (classes.auto_approve = 1,
// currently the App Store review class). The pending screen calls this a few
// seconds after the request is filed, so a reviewer can record the full
// sign-up -> "waiting for approval" -> accepted flow with nobody at the
// instructor console. Mirrors the manual approve action in
// app/manage/+page.server.js: status flip, onboarding complete, and the
// approvals/{uid} RTDB signal the pending screen listens for. No email —
// the demo doesn't need one and reviewers use relay addresses anyway.
// Real classes (auto_approve = 0) are refused: approval stays a human call.
export async function POST({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const result = await db.execute({
		sql: `SELECT cm.id, cm.status, c.auto_approve
		      FROM class_memberships cm JOIN classes c ON cm.class_id = c.id
		      WHERE cm.user_id = ?
		      ORDER BY cm.requested_at DESC LIMIT 1`,
		args: [session.user.id]
	});
	const membership = result.rows[0];
	if (!membership) error(404, 'No pending request');
	if (String(membership.status) === 'approved') return json({ ok: true, status: 'approved' });
	if (String(membership.status) !== 'pending') error(409, 'Request already decided');
	if (Number(membership.auto_approve) !== 1) error(403, 'This class requires instructor approval');

	await db.execute({
		// reviewed_by is an FK into users, so no 'auto' sentinel — the demo
		// class self-approves, and the row saying so is honest about it.
		sql: `UPDATE class_memberships SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`,
		args: [session.user.id, membership.id]
	});
	await db.execute({
		sql: `UPDATE users SET onboarding_step = 'complete' WHERE id = ?`,
		args: [session.user.id]
	});
	// Same signal a manual approval sends — the pending screen's RTDB listener
	// picks it up and moves the student into the app.
	getAdminDb().ref(`approvals/${session.user.id}`).set(Date.now()).catch(() => {});

	return json({ ok: true, status: 'approved' });
}
