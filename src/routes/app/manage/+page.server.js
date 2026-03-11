import { redirect, fail } from '@sveltejs/kit';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment } from '$lib/server/assignments.js';
import { getSubmissionsForAssignment } from '$lib/server/submissions.js';

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

	return { weeks, maxWeek };
}

const ALL_TYPES = ['link', 'image', 'video'];

function parseTypes(data) {
	const types = data.getAll('accepted_types').map(String).filter((t) => ALL_TYPES.includes(t));
	return types.length ? types : ['link'];
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
