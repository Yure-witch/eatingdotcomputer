import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	if (!db) return {}; // no DB in local dev without env — skip gate

	const result = await db.execute({
		sql: 'SELECT onboarding_step FROM users WHERE id = ?',
		args: [session.user.id]
	});

	const step = String(result.rows[0]?.onboarding_step ?? 'profile');
	if (step !== 'complete') redirect(303, `/onboarding/${step}`);

	// Belt-and-suspenders: verify the membership row is actually approved
	await requireClassAccess(session, { type: 'redirect' });

	return {};
}
