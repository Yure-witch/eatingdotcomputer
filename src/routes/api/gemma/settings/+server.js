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
	const row = (await db.execute({ sql: 'SELECT gemma_digest FROM users WHERE id = ?', args: [session.user.id] })).rows[0];
	return json({ optIn: Number(row?.gemma_digest) === 1 });
}

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const db = getDb();
	if (!db) error(500, 'No database');
	const body = await request.json().catch(() => ({}));

	if (typeof body.optIn === 'boolean') {
		await db.execute({
			sql: 'UPDATE users SET gemma_digest = ? WHERE id = ?',
			args: [body.optIn ? 1 : 0, session.user.id]
		});
		return json({ ok: true, optIn: body.optIn });
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
