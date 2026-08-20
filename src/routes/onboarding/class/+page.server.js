import { redirect, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');
	if (session.user.role === 'instructor') redirect(303, '/app');

	const db = getDb();

	// Guard: must have explicitly completed the profile step
	if (db) {
		const userRow = await db.execute({
			sql: 'SELECT onboarding_step FROM users WHERE id = ?',
			args: [session.user.id]
		});
		const step = String(userRow.rows[0]?.onboarding_step ?? 'profile');
		if (step !== 'class') redirect(303, '/onboarding/profile');
	}

	// Only surface classes the instructor has opened for enrollment
	// AND where today's date is inside the optional [start, end]
	// window. Without the filter the picker listed every class in
	// the DB (current + past terms), which got noisy fast. NULL
	// start/end means "no lower / upper bound" so an instructor
	// can leave the window open-ended.
	const result = db ? await db.execute({
		sql: `SELECT id, name, term, description
		      FROM classes
		      WHERE enrollment_open = 1
		        AND (enrollment_start IS NULL OR date(enrollment_start) <= date('now'))
		        AND (enrollment_end   IS NULL OR date(enrollment_end)   >= date('now'))
		      ORDER BY created_at ASC`
	}) : { rows: [] };

	return {
		classes: result.rows.map((r) => ({
			id: String(r.id),
			name: String(r.name),
			term: String(r.term),
			description: String(r.description ?? '')
		}))
	};
}

export const actions = {
	default: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) redirect(303, '/login');

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		// Guard: must have completed profile step
		const userRow = await db.execute({
			sql: 'SELECT onboarding_step FROM users WHERE id = ?',
			args: [session.user.id]
		});
		if (String(userRow.rows[0]?.onboarding_step) !== 'class') redirect(303, '/onboarding/profile');

		const data = await request.formData();
		const classId = String(data.get('class_id') ?? '').trim();
		if (!classId) return fail(400, { error: 'Please select a class' });

		// Double-check the class is actually open right now — the
		// picker filter only hides closed classes from the dropdown,
		// but a malicious / stale POST shouldn't be able to slip a
		// request into a class whose enrollment window is closed.
		const openCheck = await db.execute({
			sql: `SELECT 1 FROM classes
			      WHERE id = ?
			        AND enrollment_open = 1
			        AND (enrollment_start IS NULL OR date(enrollment_start) <= date('now'))
			        AND (enrollment_end   IS NULL OR date(enrollment_end)   >= date('now'))`,
			args: [classId]
		});
		if (!openCheck.rows.length) {
			return fail(400, { error: 'Enrollment for that class is not open right now.' });
		}

		await db.execute({
			sql: 'INSERT OR IGNORE INTO class_memberships (id, class_id, user_id) VALUES (?, ?, ?)',
			args: [crypto.randomUUID(), classId, session.user.id]
		});

		await db.execute({
			sql: "UPDATE users SET onboarding_step = 'pending' WHERE id = ?",
			args: [session.user.id]
		});

		// Clear any approval flag left from a previous enrollment: the pending
		// page treats the mere existence of approvals/<uid> as "you're in", so a
		// stale node would bounce a still-pending student straight into /app.
		getAdminDb().ref(`approvals/${session.user.id}`).remove().catch(() => {});

		// Signal the manage page that a new request is pending
		getAdminDb().ref(`pendingRequests/${classId}`).set(Date.now()).catch(() => {});

		redirect(303, '/onboarding/pending');
	}
};
