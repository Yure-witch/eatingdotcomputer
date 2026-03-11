import { redirect, fail } from '@sveltejs/kit';
import { getAssignments, createAssignment, deleteAssignment } from '$lib/server/assignments.js';
import { getSubmissionsForAssignment, getStudentSubmission, createSubmission } from '$lib/server/submissions.js';
import { uploadToR2 } from '$lib/server/r2.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const rows = await getAssignments();
	const isInstructor = session.user.role === 'instructor';

	// Group by week, enrich with submissions
	const byWeek = {};
	for (const row of rows) {
		const w = row.week;
		if (!byWeek[w]) byWeek[w] = [];

		let acceptedTypes;
		try {
			acceptedTypes = JSON.parse(row.accepted_types ?? '["link"]');
		} catch {
			acceptedTypes = ['link'];
		}

		const assignment = {
			id: row.id,
			title: row.title,
			description: row.description,
			dueDate: row.due_date,
			acceptedTypes
		};

		if (isInstructor) {
			assignment.submissions = await getSubmissionsForAssignment(row.id);
		} else {
			assignment.mySubmission = await getStudentSubmission(row.id, session.user.id);
		}

		byWeek[w].push(assignment);
	}

	const weeks = Object.keys(byWeek)
		.map(Number)
		.sort((a, b) => a - b)
		.map((w) => ({ week: w, assignments: byWeek[w] }));

	return { weeks, role: session.user.role, userId: session.user.id };
}

export const actions = {
	create: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const week = parseInt(data.get('week'));
		const title = String(data.get('title') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const acceptedTypes = data.getAll('accepted_types').map(String);

		if (!week || !title) return fail(400, { error: 'Week and title are required', action: 'create' });
		if (acceptedTypes.length === 0) return fail(400, { error: 'Select at least one submission type', action: 'create' });

		await createAssignment({ week, title, description, dueDate, acceptedTypes, createdBy: session.user.id });
	},

	delete: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing id' });

		await deleteAssignment(id);
	},

	submit: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const assignmentId = String(data.get('assignment_id') ?? '');
		const type = String(data.get('type') ?? '');

		if (!assignmentId || !type) return fail(400, { error: 'Missing fields', action: 'submit', assignmentId });

		let value;

		if (type === 'link') {
			value = String(data.get('link') ?? '').trim();
			if (!value) return fail(400, { error: 'Link is required', action: 'submit', assignmentId });
			try { new URL(value); } catch {
				return fail(400, { error: 'Enter a valid URL', action: 'submit', assignmentId });
			}
		} else if (type === 'image' || type === 'video') {
			const file = data.get('file');
			if (!file || typeof file === 'string' || file.size === 0) {
				return fail(400, { error: 'Please choose a file', action: 'submit', assignmentId });
			}

			const allowed = type === 'image'
				? ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
				: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

			if (!allowed.includes(file.type)) {
				return fail(400, { error: `Invalid file type for ${type}`, action: 'submit', assignmentId });
			}

			const ext = file.name.split('.').pop();
			const key = `submissions/${assignmentId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;
			const buffer = Buffer.from(await file.arrayBuffer());
			await uploadToR2(key, buffer, file.type);
			value = key;
		} else {
			return fail(400, { error: 'Unknown submission type', action: 'submit', assignmentId });
		}

		await createSubmission({ assignmentId, studentId: session.user.id, type, value });
	}
};
