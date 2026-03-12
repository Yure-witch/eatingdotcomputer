import { redirect, fail } from '@sveltejs/kit';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment } from '$lib/server/assignments.js';
import { getSubmissionsForAssignment } from '$lib/server/submissions.js';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') redirect(303, '/app');

	const rows = await getAssignments();

	const byWeek = {};
	for (const row of rows) {
		const w = row.week;
		if (!byWeek[w]) byWeek[w] = [];
		let acceptedTypes;
		try { acceptedTypes = JSON.parse(row.accepted_types ?? '["link"]'); } catch { acceptedTypes = ['link']; }
		const submissionRows = await getSubmissionsForAssignment(row.id);
		byWeek[w].push({
			id: row.id,
			title: row.title,
			description: row.description ?? '',
			dueDate: row.due_date ?? '',
			acceptedTypes,
			submissionCount: submissionRows.length
		});
	}

	const weeks = Object.keys(byWeek)
		.map(Number)
		.sort((a, b) => a - b)
		.map((w) => ({ week: w, assignments: byWeek[w] }));

	// Find the highest week number so we can suggest the next one
	const maxWeek = weeks.length ? Math.max(...weeks.map((w) => w.week)) : 0;

	// All members + online status
	const db = getDb();
	const usersResult = db ? await db.execute('SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC') : { rows: [] };

	const presenceSnap = await getAdminDb().ref('presence').get();
	const onlineSet = new Set();
	if (presenceSnap.exists()) {
		for (const [uid, val] of Object.entries(presenceSnap.val())) {
			if (val.online) onlineSet.add(uid);
		}
	}

	const members = usersResult.rows.map((r) => ({
		id: String(r.id),
		name: String(r.name ?? ''),
		email: String(r.email ?? ''),
		role: String(r.role ?? 'student'),
		joinedAt: String(r.created_at ?? ''),
		online: onlineSet.has(String(r.id))
	}));

	// Activity graph — hourly distribution for non-instructors, last 30 days
	const activityRows = db ? await db.execute(`
		SELECT strftime('%H', logged_at) AS hour, COUNT(*) AS count
		FROM user_activity
		JOIN users ON user_activity.user_id = users.id
		WHERE users.role != 'instructor'
		  AND logged_at >= datetime('now', '-30 days')
		GROUP BY hour
		ORDER BY hour
	`) : { rows: [] };

	const activityByHour = Array.from({ length: 24 }, (_, h) => ({
		hour: h,
		count: Number(activityRows.rows.find((r) => Number(r.hour) === h)?.count ?? 0)
	}));

	// Pending class membership requests
	const pendingResult = db ? await db.execute(`
		SELECT cm.id, cm.class_id, cm.user_id, cm.requested_at,
		       c.name AS class_name, c.term,
		       u.name AS user_name, u.email, u.pronouns, u.bio, u.website
		FROM class_memberships cm
		JOIN classes c ON cm.class_id = c.id
		JOIN users u ON cm.user_id = u.id
		WHERE cm.status = 'pending'
		ORDER BY cm.requested_at ASC
	`) : { rows: [] };

	const pendingRequests = pendingResult.rows.map((r) => ({
		id: String(r.id),
		userId: String(r.user_id),
		className: String(r.class_name),
		term: String(r.term),
		requestedAt: String(r.requested_at ?? ''),
		userName: String(r.user_name ?? ''),
		email: String(r.email ?? ''),
		pronouns: String(r.pronouns ?? ''),
		bio: String(r.bio ?? ''),
		website: String(r.website ?? '')
	}));

	return { weeks, maxWeek, members, activityByHour, pendingRequests };
}

const ALL_TYPES = ['link', 'image', 'video'];

function parseTypes(data) {
	const types = data.getAll('accepted_types').map(String).filter((t) => ALL_TYPES.includes(t));
	return types.length ? types : ['link'];
}

export const actions = {
	approve: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const membershipId = String(data.get('id') ?? '');
		if (!membershipId) return fail(400, { error: 'Missing id' });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		const membership = await db.execute({
			sql: 'SELECT user_id FROM class_memberships WHERE id = ?',
			args: [membershipId]
		});
		if (!membership.rows.length) return fail(404, { error: 'Not found' });

		const userId = String(membership.rows[0].user_id);
		await db.execute({
			sql: `UPDATE class_memberships SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`,
			args: [session.user.id, membershipId]
		});
		await db.execute({
			sql: `UPDATE users SET onboarding_step = 'complete' WHERE id = ?`,
			args: [userId]
		});
	},

	deny: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const membershipId = String(data.get('id') ?? '');
		if (!membershipId) return fail(400, { error: 'Missing id' });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		const membership = await db.execute({
			sql: 'SELECT user_id FROM class_memberships WHERE id = ?',
			args: [membershipId]
		});
		if (!membership.rows.length) return fail(404, { error: 'Not found' });

		const userId = String(membership.rows[0].user_id);
		await db.execute({
			sql: `UPDATE class_memberships SET status = 'denied', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`,
			args: [session.user.id, membershipId]
		});
		await db.execute({
			sql: `UPDATE users SET onboarding_step = 'denied' WHERE id = ?`,
			args: [userId]
		});
	},

	create: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const week = parseInt(data.get('week'));
		const title = String(data.get('title') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const acceptedTypes = parseTypes(data);

		if (!week || !title) return fail(400, { error: 'Week and title are required', action: 'create' });

		await createAssignment({ week, title, description, dueDate, acceptedTypes, createdBy: session.user.id });
	},

	update: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const week = parseInt(data.get('week'));
		const title = String(data.get('title') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const acceptedTypes = parseTypes(data);

		if (!id || !week || !title) return fail(400, { error: 'Week and title are required', action: 'update', id });

		await updateAssignment(id, { week, title, description, dueDate, acceptedTypes });
	},

	delete: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing id' });
		await deleteAssignment(id);
	}
};
