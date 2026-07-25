import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { completeItem, uncompleteItem } from '$lib/server/week-plans.js';

// Check/uncheck an action item from the Gemma digest checklist.
// POST { itemId, done } — writes the SAME item_completions row the home
// checklist uses. Submission-required items are refused here (they need the
// real submission flow on /app), so a checkbox can never bypass a submission.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const { itemId, done } = await request.json().catch(() => ({}));
	if (typeof itemId !== 'string' || !itemId) error(400, 'Missing itemId');

	const db = getDb();
	if (!db) error(500, 'No database');
	const item = (await db.execute({
		sql: 'SELECT requires_submission FROM week_items WHERE id = ?',
		args: [itemId]
	})).rows[0];
	if (!item) error(404, 'No such item');
	if (Number(item.requires_submission) === 1) error(400, 'This item needs a submission — complete it on the home page');

	if (done) await completeItem({ itemId, studentId: session.user.id });
	else await uncompleteItem(itemId, session.user.id);
	return json({ ok: true });
}
