import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	const result = db ? await db.execute({
		sql: `SELECT cm.status, c.name, c.term
		      FROM class_memberships cm
		      JOIN classes c ON cm.class_id = c.id
		      WHERE cm.user_id = ?
		      ORDER BY cm.requested_at DESC LIMIT 1`,
		args: [session.user.id]
	}) : { rows: [] };

	const membership = result.rows[0];
	if (!membership || !String(membership.name ?? '').trim()) {
		// Stale or invalid membership (class missing/unnamed) — clean up and restart
		if (db) {
			await db.execute({ sql: "DELETE FROM class_memberships WHERE user_id = ? AND status != 'approved'", args: [session.user.id] });
			await db.execute({ sql: "UPDATE users SET onboarding_step = 'profile' WHERE id = ?", args: [session.user.id] });
		}
		redirect(303, '/onboarding/profile');
	}
	if (membership.status === 'approved') {
		await db?.execute({ sql: "UPDATE users SET onboarding_step = 'complete' WHERE id = ?", args: [session.user.id] });
		redirect(303, '/app');
	}

	return {
		className: String(membership.name ?? ''),
		term: String(membership.term ?? ''),
		status: String(membership.status ?? 'pending')
	};
}

export const actions = {
	check: async ({ locals }) => {
		const session = await locals.auth();
		if (!session) redirect(303, '/login');

		const db = getDb();
		if (!db) return { status: 'pending' };

		const result = await db.execute({
			sql: `SELECT cm.status FROM class_memberships cm WHERE cm.user_id = ? ORDER BY cm.requested_at DESC LIMIT 1`,
			args: [session.user.id]
		});

		const status = String(result.rows[0]?.status ?? 'pending');
		if (status === 'approved') {
			await db.execute({ sql: "UPDATE users SET onboarding_step = 'complete' WHERE id = ?", args: [session.user.id] });
			redirect(303, '/app');
		}

		return { status };
	}
};
