import { redirect, fail } from '@sveltejs/kit';
import { signOut } from '../../auth.js';
import { getAssignments, createAssignment } from '$lib/server/assignments.js';
import { getStudentSubmission, createSubmission } from '$lib/server/submissions.js';
import { uploadToR2 } from '$lib/server/r2.js';

function parseAssignment(row) {
	let acceptedTypes;
	try { acceptedTypes = JSON.parse(row.accepted_types ?? '["link"]'); } catch { acceptedTypes = ['link']; }
	let attachments;
	try { attachments = JSON.parse(row.attachments ?? '[]'); } catch { attachments = []; }
	return {
		id: String(row.id),
		week: row.week,
		title: String(row.title),
		description: row.description ? String(row.description) : null,
		dueDate: row.due_date ? String(row.due_date) : null,
		acceptedTypes,
		attachments
	};
}

export async function load({ locals, parent }) {
	const parentData = await parent();
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';
	const rows = await getAssignments(classId);
	const assignments = rows.map(parseAssignment);

	// Sort: due_date ascending, then by week for undated ones
	assignments.sort((a, b) => {
		if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
		if (a.dueDate) return -1;
		if (b.dueDate) return 1;
		return a.week - b.week;
	});

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const upcoming = assignments.filter((a) => !a.dueDate || new Date(a.dueDate) >= today);
	const past = assignments.filter((a) => a.dueDate && new Date(a.dueDate) < today);

	// current = nearest upcoming; fall back to most recent past
	const current = upcoming[0] ?? past[past.length - 1] ?? null;
	const next = upcoming.length > 1 ? upcoming[1] : null;
	const previous = assignments.filter((a) => a.id !== current?.id && a.id !== next?.id);

	let mySubmission = null;
	if (current && session.user.role !== 'instructor') {
		mySubmission = await getStudentSubmission(current.id, session.user.id);
	}

	const maxWeek = assignments.reduce((m, a) => Math.max(m, a.week), 0);

	return {
		session,
		current,
		next,
		previous: previous.reverse(), // most recent first
		mySubmission,
		nextWeek: maxWeek + 1,
		classId
	};
}

export const actions = {
	signout: async (event) => {
		await signOut(event, { redirect: false });
		redirect(303, '/login');
	},

	create: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const week = parseInt(String(data.get('week') ?? '0'));
		const title = String(data.get('title') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const acceptedTypes = data.getAll('accepted_types').map(String);
		const classId = String(data.get('class_id') ?? 'idc-fall-2026');

		// Attachment links
		const linkUrls = data.getAll('link_url').map(String).filter(Boolean);
		const linkLabels = data.getAll('link_label').map(String);
		const attachments = linkUrls.map((url, i) => ({ type: 'link', url, label: linkLabels[i] || '' }));

		if (!title) return fail(400, { error: 'Title is required', action: 'create' });

		await createAssignment({
			week: week || 1,
			title,
			description: description || null,
			dueDate: dueDate || null,
			acceptedTypes: acceptedTypes.length ? acceptedTypes : [],
			attachments,
			createdBy: session.user.id,
			classId
		});
	},

	submit: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const assignmentId = String(data.get('assignment_id') ?? '');
		const type = String(data.get('type') ?? '');
		if (!assignmentId || !type) return fail(400, { error: 'Missing fields', action: 'submit' });

		let value;
		if (type === 'link') {
			value = String(data.get('link') ?? '').trim();
			if (!value) return fail(400, { error: 'Link is required', action: 'submit' });
			try { new URL(value); } catch { return fail(400, { error: 'Enter a valid URL', action: 'submit' }); }
		} else if (type === 'image' || type === 'video') {
			const file = data.get('file');
			if (!file || typeof file === 'string' || file.size === 0)
				return fail(400, { error: 'Please choose a file', action: 'submit' });
			const allowed = type === 'image'
				? ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
				: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
			if (!allowed.includes(file.type))
				return fail(400, { error: `Invalid file type for ${type}`, action: 'submit' });
			const ext = file.name.split('.').pop();
			const key = `submissions/${assignmentId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;
			await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
			value = key;
		} else {
			return fail(400, { error: 'Unknown submission type', action: 'submit' });
		}

		await createSubmission({ assignmentId, studentId: session.user.id, type, value });
	}
};
