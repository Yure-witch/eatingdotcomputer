import { redirect, fail } from '@sveltejs/kit';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment } from '$lib/server/assignments.js';
import { getSubmissionsForAssignment } from '$lib/server/submissions.js';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';

export async function load({ locals, parent }) {
	const parentData = await parent();
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') redirect(303, '/app');

	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';
	const rows = await getAssignments(classId);

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

	// All members + online status — scoped to current class (instructors always included)
	const db = getDb();
	const usersResult = db ? await db.execute({
		sql: `SELECT u.id, u.name, u.email, u.role, u.created_at FROM users u
		      WHERE u.role = 'instructor'
		         OR EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      ORDER BY u.created_at ASC`,
		args: [classId]
	}) : { rows: [] };

	const PRESENCE_TTL = 3 * 60 * 1000;
	const presenceSnap = await getAdminDb().ref('presence').get();
	const presenceData = {};
	if (presenceSnap.exists()) {
		const now = Date.now();
		for (const [uid, val] of Object.entries(presenceSnap.val())) {
			presenceData[uid] = {
				online: val.online && (val.lastSeen ?? 0) > now - PRESENCE_TTL,
				lastSeen: val.lastSeen ?? null
			};
		}
	}

	const members = usersResult.rows.map((r) => ({
		id: String(r.id),
		name: String(r.name ?? ''),
		email: String(r.email ?? ''),
		role: String(r.role ?? 'student'),
		joinedAt: String(r.created_at ?? ''),
		online: presenceData[String(r.id)]?.online ?? false,
		lastSeen: presenceData[String(r.id)]?.lastSeen ?? null,
		ua: presenceData[String(r.id)]?.ua ?? null,
		screen: presenceData[String(r.id)]?.screen ?? null
	}));

	// Activity: hourly for last 7 days (drives 12h / 1d / 7d views)
	const hourlyRows = db ? await db.execute({
		sql: `SELECT u.id AS user_id, u.name,
		             strftime('%Y-%m-%dT%H:00', ua.logged_at) AS bucket,
		             COUNT(*) AS count
		      FROM user_activity ua
		      JOIN users u ON ua.user_id = u.id
		      WHERE u.role != 'instructor'
		        AND ua.logged_at >= datetime('now', '-7 days')
		        AND EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      GROUP BY u.id, bucket
		      ORDER BY bucket ASC`,
		args: [classId]
	}) : { rows: [] };

	// Activity: daily for last 6 months (drives 1m / 6m views)
	const dailyRows = db ? await db.execute({
		sql: `SELECT u.id AS user_id, u.name,
		             date(ua.logged_at) AS bucket,
		             COUNT(*) AS count
		      FROM user_activity ua
		      JOIN users u ON ua.user_id = u.id
		      WHERE u.role != 'instructor'
		        AND ua.logged_at >= datetime('now', '-180 days')
		        AND EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      GROUP BY u.id, bucket
		      ORDER BY bucket ASC`,
		args: [classId]
	}) : { rows: [] };

	function buildSeries(rows) {
		const map = {};
		for (const r of rows) {
			const uid = String(r.user_id);
			if (!map[uid]) map[uid] = { userId: uid, name: String(r.name ?? ''), points: [] };
			map[uid].points.push({ bucket: String(r.bucket), count: Number(r.count) });
		}
		return Object.values(map);
	}

	const activityByUser = {
		hourly: buildSeries(hourlyRows.rows),
		daily: buildSeries(dailyRows.rows)
	};

	// Pending class membership requests — scoped to current class
	const pendingResult = db ? await db.execute({
		sql: `SELECT cm.id, cm.class_id, cm.user_id, cm.requested_at,
		             c.name AS class_name, c.term,
		             u.name AS user_name, u.email, u.pronouns, u.bio, u.website
		      FROM class_memberships cm
		      JOIN classes c ON cm.class_id = c.id
		      JOIN users u ON cm.user_id = u.id
		      WHERE cm.status = 'pending' AND cm.class_id = ?
		      ORDER BY cm.requested_at ASC`,
		args: [classId]
	}) : { rows: [] };

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

	return { weeks, maxWeek, members, activityByUser, pendingRequests, classId };
}

const ALL_TYPES = ['link', 'image', 'video'];

function parseTypes(data) {
	const types = data.getAll('accepted_types').map(String).filter((t) => ALL_TYPES.includes(t));
	return types.length ? types : ['link'];
}

export const actions = {
	resetStudent: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const userId = String(data.get('user_id') ?? '');
		if (!userId) return fail(400, { error: 'Missing user_id' });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		await db.execute({ sql: 'DELETE FROM class_memberships WHERE user_id = ?', args: [userId] });
		await db.execute({ sql: "UPDATE users SET onboarding_step = 'profile' WHERE id = ?", args: [userId] });
	},

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
		const classId = String(data.get('class_id') ?? 'idc-fall-2026');

		if (!week || !title) return fail(400, { error: 'Week and title are required', action: 'create' });

		await createAssignment({ week, title, description, dueDate, acceptedTypes, createdBy: session.user.id, classId });
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
