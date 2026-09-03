import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

// Gemma digest settings.
// POST { optIn: boolean }                       → set YOUR OWN users.gemma_digest
//        (any signed-in user; for instructors this is also the master switch)
// POST { userId, interests }                    → instructor-only: save a
//        student's interests (users.interests) for digest inspiration
// GET — the caller's CURRENT digest opt-in state. Toggles sync from this at
// mount instead of trusting possibly-stale page-load data.
export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const db = getDb();
	if (!db) error(500, 'No database');
	const row = (await db.execute({ sql: 'SELECT gemma_digest, gemma_scan_dms FROM users WHERE id = ?', args: [session.user.id] })).rows[0];
	const optIn = Number(row?.gemma_digest) === 1;
	const scanDms = Number(row?.gemma_scan_dms) === 1;
	// `messageAnalysis` is the single user-facing switch (see POST). The two
	// underlying columns are still reported because Manage drives the
	// instructor master switch through `optIn` alone.
	return json({ optIn, scanDms, messageAnalysis: optIn });
}

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const db = getDb();
	if (!db) error(500, 'No database');
	const body = await request.json().catch(() => ({}));

	// Message analysis — the one switch a student sees. Digest delivery and
	// the scope Gemma reads were two separate boxes, which asked people to
	// reason about an internal split: there is no useful state where you want
	// the digest but won't let it read the messages it summarises. One toggle,
	// both columns.
	if (typeof body.messageAnalysis === 'boolean') {
		const v = body.messageAnalysis ? 1 : 0;
		await db.execute({
			sql: 'UPDATE users SET gemma_digest = ?, gemma_scan_dms = ? WHERE id = ?',
			args: [v, v, session.user.id]
		});
		return json({ ok: true, messageAnalysis: body.messageAnalysis });
	}

	if (typeof body.optIn === 'boolean') {
		await db.execute({
			sql: 'UPDATE users SET gemma_digest = ? WHERE id = ?',
			args: [body.optIn ? 1 : 0, session.user.id]
		});
		return json({ ok: true, optIn: body.optIn });
	}

	// DM-scan scope opt-in: 1 = Gemma may read ALL the caller's DMs when
	// harvesting goals (default reads only instructor DMs + channels).
	if (typeof body.scanDms === 'boolean') {
		await db.execute({
			sql: 'UPDATE users SET gemma_scan_dms = ? WHERE id = ?',
			args: [body.scanDms ? 1 : 0, session.user.id]
		});
		return json({ ok: true, scanDms: body.scanDms });
	}

	if (typeof body.userId === 'string' && 'interests' in body) {
		if (session.user.role !== 'instructor') error(403, 'Instructors only');
		await db.execute({
			sql: 'UPDATE users SET interests = ? WHERE id = ?',
			args: [String(body.interests ?? '').slice(0, 2000) || null, body.userId]
		});
		return json({ ok: true });
	}

	error(400, 'Nothing to do');
}
