import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAllGoals, getOpenActionItems, DEFAULT_CLASS } from '$lib/server/gemma-digest.js';

// GET — the caller's full goal history (open + completed) plus their live
// assignment action items. Feeds the /app/goals page.
export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const goals = await getAllGoals(session.user.id);
	const actionItems = session.user.role === 'instructor'
		? []
		: await getOpenActionItems(DEFAULT_CLASS, session.user.id);
	return json({ goals, actionItems });
}

// Personal-goal actions from the Gemma page's goals checklist.
// POST { goalId, done }         — check/uncheck (flips gemma_goals.done)
// POST { goalId, remove: true } — delete the goal outright (bad harvest,
//                                 no longer relevant, etc.)
// Ownership enforced by the user_id predicate in both statements.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const { goalId, done, remove, pin } = await request.json().catch(() => ({}));
	if (typeof goalId !== 'string' || !goalId) error(400, 'Missing goalId');
	const db = getDb();
	if (!db) error(500, 'No database');
	let res;
	if (remove === true) {
		res = await db.execute({
			sql: 'DELETE FROM gemma_goals WHERE id = ? AND user_id = ?',
			args: [goalId, session.user.id]
		});
	} else if (typeof pin === 'boolean') {
		// Pin as top priority (user override of Gemma's auto-rank). Pinning sets
		// priority above every current task so it sorts first; unpinning releases
		// it back to Gemma's ranking.
		if (pin) {
			const max = (await db.execute({
				sql: 'SELECT COALESCE(MAX(priority), 0) AS m FROM gemma_goals WHERE user_id = ? AND done = 0',
				args: [session.user.id]
			})).rows[0]?.m ?? 0;
			res = await db.execute({
				sql: 'UPDATE gemma_goals SET priority_locked = 1, priority = ? WHERE id = ? AND user_id = ?',
				args: [Number(max) + 1, goalId, session.user.id]
			});
		} else {
			res = await db.execute({
				sql: 'UPDATE gemma_goals SET priority_locked = 0 WHERE id = ? AND user_id = ?',
				args: [goalId, session.user.id]
			});
		}
	} else {
		res = await db.execute({
			sql: `UPDATE gemma_goals SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
			      WHERE id = ? AND user_id = ?`,
			args: [done ? 1 : 0, done ? 1 : 0, goalId, session.user.id]
		});
	}
	if (!res.rowsAffected) error(404, 'No such goal');
	return json({ ok: true });
}
