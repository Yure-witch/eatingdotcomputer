import { archiveCaller, requireDb, shapeSubmission } from '$lib/server/work-archive.js';

// Work Archive. Everyone sees their own token + submissions (the page's
// "do it yourself" half); instructors also get the class roster with each
// student's latest archive.
export async function load(event) {
	const caller = await archiveCaller(event);
	const db = requireDb();

	const tokenRow = (await db.execute({
		sql: `SELECT last4, created_at, expires_at, last_used_at FROM archive_tokens
		      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
		      ORDER BY created_at DESC LIMIT 1`,
		args: [caller.userId]
	})).rows[0];

	const mine = (await db.execute({
		sql: 'SELECT * FROM archive_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
		args: [caller.userId]
	})).rows.map(shapeSubmission);

	let roster = null;
	if (caller.role === 'instructor') {
		const classArgs = caller.classId ? [caller.classId] : [];
		const students = (await db.execute({
			sql: `SELECT u.id, u.name, u.email, u.is_ta, u.shadowbanned FROM users u
			      WHERE u.role != 'instructor' AND EXISTS (
			        SELECT 1 FROM class_memberships cm
			        WHERE cm.user_id = u.id AND cm.status = 'approved'
			        ${caller.classId ? 'AND cm.class_id = ?' : ''}
			      )
			      ORDER BY u.name COLLATE NOCASE`,
			args: classArgs
		})).rows;
		const subs = (await db.execute(`
			SELECT * FROM archive_submissions
			WHERE status = 'complete' OR created_at > datetime('now', '-2 days')
			ORDER BY created_at DESC`)).rows;
		const latest = new Map();
		const open = new Map();
		const historyCount = new Map();
		for (const r of subs) {
			const uid = String(r.user_id);
			if (r.status === 'complete') {
				if (!latest.has(uid)) latest.set(uid, shapeSubmission(r));
				historyCount.set(uid, (historyCount.get(uid) ?? 0) + 1);
			} else if (!open.has(uid)) open.set(uid, shapeSubmission(r));
		}
		roster = students.map((s) => ({
			id: String(s.id),
			name: String(s.name ?? s.email ?? ''),
			email: String(s.email ?? ''),
			isTa: Number(s.is_ta ?? 0) === 1,
			hidden: Number(s.shadowbanned ?? 0) === 1,
			latest: latest.get(String(s.id)) ?? null,
			open: open.get(String(s.id)) ?? null,
			versions: historyCount.get(String(s.id)) ?? 0
		}));
	}

	return {
		me: { name: caller.name, role: caller.role },
		token: tokenRow ? {
			last4: String(tokenRow.last4),
			createdAt: String(tokenRow.created_at),
			expiresAt: String(tokenRow.expires_at),
			lastUsedAt: tokenRow.last_used_at ? String(tokenRow.last_used_at) : null
		} : null,
		mine,
		roster
	};
}
