import { redirect, fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { signOut } from '../../auth.js';
import { getWeekPlans, getCompletionsForStudent, getCompletionsForWeek, createWeekPlan, createWeekItems, completeItem, uncompleteItem, deleteWeekPlan } from '$lib/server/week-plans.js';
import { uploadToR2 } from '$lib/server/r2.js';

export async function load({ locals, parent }) {
	const parentData = await parent();
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';
	const userId = session.user.id;
	const isInstructor = session.user.role === 'instructor';

	const plans = await getWeekPlans(classId);

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	// Find current plan: nearest upcoming due_date, or most recent if all past
	const upcoming = plans.filter((p) => !p.dueDate || new Date(p.dueDate) >= today);
	const past = plans.filter((p) => p.dueDate && new Date(p.dueDate) < today);
	const currentPlan = upcoming[0] ?? past[past.length - 1] ?? null;
	const nextPlan = currentPlan ? (upcoming.indexOf(currentPlan) >= 0 ? upcoming[upcoming.indexOf(currentPlan) + 1] : null) : null;

	let completions = {};
	let progress = {};

	if (currentPlan) {
		if (isInstructor) {
			progress = await getCompletionsForWeek(currentPlan.id);
		} else {
			completions = await getCompletionsForStudent(currentPlan.id, userId);
		}
	}

	const maxWeek = plans.reduce((m, p) => Math.max(m, p.week), 0);
	const pastPlans = plans.filter((p) => p.id !== currentPlan?.id && p.id !== nextPlan?.id).reverse();

	return {
		session,
		currentPlan,
		nextPlan,
		pastPlans,
		completions,
		progress,
		nextWeekNumber: maxWeek + 1,
		classId
	};
}

export const actions = {
	signout: async (event) => {
		await signOut(event, { redirect: false });
		redirect(303, '/login');
	},

	createWeekPlan: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const week = parseInt(String(data.get('week') ?? '0'));
		const headline = String(data.get('headline') ?? '').trim();
		const topicPreview = String(data.get('topic_preview') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const classId = String(data.get('class_id') ?? 'idc-fall-2026');

		if (!headline) return fail(400, { error: 'Headline is required', action: 'createWeekPlan' });

		// Parse checklist items
		const allLabels = data.getAll('item_label').map(String);
		const requiresSub = data.getAll('item_requires_submission').map(String);
		const resourceUrls = data.getAll('item_resource_url').map(String);
		const resourceLabels = data.getAll('item_resource_label').map(String);
		const items = [];
		for (let i = 0; i < allLabels.length; i++) {
			const label = allLabels[i].trim();
			if (!label) continue;
			const req = requiresSub[i] === '1';
			let acceptedTypes = ['link'];
			if (req) {
				const types = data.getAll(`item_accepted_types_${i}`).map(String);
				if (types.length) acceptedTypes = types;
			}
			let resourceUrl = resourceUrls[i]?.trim() || null;
			const resourceLabel = resourceLabels[i]?.trim() || null;
			let resourceFilename = null;
			let resourceMimetype = null;

			// Check for uploaded file resource
			const file = data.get(`item_resource_file_${i}`);
			if (file && typeof file !== 'string' && file.size > 0) {
				const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
				const key = `resources/${crypto.randomUUID()}-${safeName}`;
				await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
				const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
				resourceUrl = publicBase ? `${publicBase}/${key}` : key;
				resourceFilename = file.name;
				resourceMimetype = file.type;
			}

			items.push({ label, requiresSubmission: req, acceptedTypes, resourceUrl, resourceLabel, resourceFilename, resourceMimetype });
		}

		const planId = await createWeekPlan({ week, headline, topicPreview: topicPreview || null, dueDate: dueDate || null, classId, createdBy: session.user.id });
		if (items.length) await createWeekItems(planId, items);
	},

	completeItem: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const itemId = String(data.get('item_id') ?? '');
		const requiresSubmission = data.get('requires_submission') === '1';

		if (!itemId) return fail(400, { error: 'Missing item_id' });

		if (!requiresSubmission) {
			// Self-check: just mark complete
			await completeItem({ itemId, studentId: session.user.id });
			return;
		}

		// Submission required
		const type = String(data.get('type') ?? '');
		if (!type) return fail(400, { error: 'Missing submission type', action: 'completeItem', itemId });

		let value;
		if (type === 'link') {
			value = String(data.get('link') ?? '').trim();
			if (!value) return fail(400, { error: 'Link is required', action: 'completeItem', itemId });
			try { new URL(value); } catch { return fail(400, { error: 'Enter a valid URL', action: 'completeItem', itemId }); }
		} else if (type === 'text') {
			value = String(data.get('text') ?? '').trim();
			if (!value) return fail(400, { error: 'Response is required', action: 'completeItem', itemId });
		} else if (type === 'image' || type === 'video') {
			const file = data.get('file');
			if (!file || typeof file === 'string' || file.size === 0)
				return fail(400, { error: 'Please choose a file', action: 'completeItem', itemId });
			const allowed = type === 'image'
				? ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
				: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
			if (!allowed.includes(file.type))
				return fail(400, { error: `Invalid file type for ${type}`, action: 'completeItem', itemId });
			const ext = file.name.split('.').pop();
			const key = `submissions/${itemId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;
			await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
			value = key;
		} else {
			return fail(400, { error: 'Unknown submission type', action: 'completeItem', itemId });
		}

		await completeItem({ itemId, studentId: session.user.id, submissionType: type, submissionValue: value });
	},

	uncompleteItem: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const itemId = String(data.get('item_id') ?? '');
		if (!itemId) return fail(400, { error: 'Missing item_id' });

		await uncompleteItem(itemId, session.user.id);
	},

	deleteWeekPlan: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing id' });

		await deleteWeekPlan(id);
	}
};
