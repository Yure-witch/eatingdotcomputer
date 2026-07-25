import { redirect, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
// Legacy assignments helpers are kept on the form action side so the
// old `?/create`, `?/delete`, `?/submit` form posts on this page still
// resolve. The Roadmap **display** below has been moved over to the
// home page's data source (`getWeekPlans`) so what instructors create
// on /app shows up here instead of staying empty.
import { getAssignments, createAssignment, deleteAssignment } from '$lib/server/assignments.js';
import { getSubmissionsForAssignment, getStudentSubmission, createSubmission } from '$lib/server/submissions.js';
import {
	getWeekPlans,
	getCompletionsForStudent,
	getCompletionsForWeek
} from '$lib/server/week-plans.js';
import { uploadToR2 } from '$lib/server/r2.js';
import { getKeySyllabusOutline } from '$lib/server/syllabus.js';

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]()]+/gi;
function cleanUrl(url) { return url.replace(/[.,;:!?)'"\]]+$/, ''); }

export async function load({ locals, parent }) {
	const parentData = await parent();
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';
	const isInstructor = session.user.role === 'instructor';
	const userId = session.user.id;
	const db = getDb();

	// ── Roadmap ─────────────────────────────────────────────────────
	// Pulls from the same `week_plans` table the home page renders so
	// what instructors publish on /app shows up here automatically.
	// (The page used to query the legacy `assignments` table, which
	// nothing writes to anymore — hence the empty Roadmap.)
	const plans = await getWeekPlans(classId);

	// Pick the "current" plan with the same rule the home page uses:
	// the nearest upcoming due date, otherwise the most recent past
	// plan. The Roadmap UI centers a 5-week window on this plan so the
	// student sees where they are at a glance instead of a long scroll.
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const upcomingPlans = plans.filter((p) => !p.dueDate || new Date(p.dueDate) >= today);
	const pastPlans = plans.filter((p) => p.dueDate && new Date(p.dueDate) < today);
	const currentPlan = upcomingPlans[0] ?? pastPlans[pastPlans.length - 1] ?? null;
	const currentPlanId = currentPlan?.id ?? null;

	// Map plans → the shape the Svelte template walks: { week, items: [...] }.
	// Each item carries the same fields the home checklist needs:
	// label, requiresSubmission, acceptedTypes, completed status.
	// For students we resolve per-user completions; for instructors
	// we surface per-item completion counts so the Roadmap doubles as
	// a coarse progress dashboard.
	const weeks = await Promise.all(plans.map(async (p) => {
		const items = p.items ?? [];
		let completions = {};
		let progress = {};
		if (isInstructor) progress = await getCompletionsForWeek(p.id);
		else completions = await getCompletionsForStudent(p.id, userId);
		return {
			week: p.week,
			planId: p.id,
			headline: p.headline,
			topicPreview: p.topicPreview,
			dueDate: p.dueDate,
			items: items.map((it) => ({
				id: it.id,
				label: it.label,
				requiresSubmission: it.requiresSubmission,
				acceptedTypes: it.acceptedTypes,
				resourceUrl: it.resourceUrl,
				resourceLabel: it.resourceLabel,
				mine: completions[it.id] ?? null,
				completedCount: progress[it.id] ?? 0
			}))
		};
	}));

	// ── Files / Collection (secondary) ── Returned as an UN-AWAITED promise
	// so SvelteKit streams it: the roadmap above renders immediately on
	// navigation instead of blocking on these 4 extra Turso round-trips. The
	// page fills the Files sections in (behind a loading state) when it lands.
	const collection = loadCollection(db, classId, userId);

	// Key-syllabus week outline for the Roadmap's syllabus section
	// (headers + topics; [] when no key syllabus is set).
	const syllabusWeeks = await getKeySyllabusOutline(classId);
	// The syllabus teaser highlights the NEXT week (the one after the
	// current plan's week); falls back to the current week, then week 1.
	const currentWeekNum = currentPlan?.week ?? 0;
	const syllabusNextWeek =
		syllabusWeeks.find((w) => w.week === currentWeekNum + 1)?.week
		?? syllabusWeeks.find((w) => w.week === currentWeekNum)?.week
		?? syllabusWeeks[0]?.week
		?? null;

	return { weeks, currentPlanId, currentWeekNum, role: session.user.role, userId, classId, collection, syllabusWeeks, syllabusNextWeek };
}

// Secondary "Collection" data — chat-shared links, uploaded files, and the
// user's starred messages. Streamed (see above) so it never blocks the page.
async function loadCollection(db, classId, userId) {
	let links = [], uploadedFiles = [], starredMessages = [];
	if (db) {
		const msgResult = await db.execute({
			sql: `SELECT cm.content, cm.user_name, cm.created_at, c.id as conv_id, c.name as conv_name
			      FROM chat_messages cm JOIN conversations c ON cm.conversation_id = c.id
			      WHERE c.type = 'channel' AND c.class_id = ? ORDER BY cm.created_at DESC`,
			args: [classId]
		});
		const seen = new Map();
		for (const row of msgResult.rows) {
			const matches = String(row.content).match(URL_RE);
			if (!matches) continue;
			for (const raw of matches) {
				const url = cleanUrl(raw);
				if (seen.has(url)) continue;
				seen.set(url, {
					url, sharedBy: String(row.user_name),
					sharedAt: new Date(String(row.created_at).endsWith('Z') ? row.created_at : row.created_at + 'Z').getTime(),
					convId: String(row.conv_id), convName: String(row.conv_name ?? row.conv_id), title: null
				});
			}
		}
		links = [...seen.values()];
		if (links.length) {
			const placeholders = links.map(() => '?').join(',');
			const metaResult = await db.execute({ sql: `SELECT url, title FROM link_previews WHERE url IN (${placeholders})`, args: links.map((l) => l.url) });
			const meta = {};
			for (const r of metaResult.rows) meta[String(r.url)] = r.title ? String(r.title) : null;
			for (const link of links) link.title = meta[link.url] ?? null;
		}

		const filesResult = await db.execute({
			sql: `SELECT uf.id, uf.url, uf.filename, uf.mimetype, uf.size, uf.uploaded_by_name, uf.uploaded_at, uf.context_type, uf.context_id, c.name as conv_name
			      FROM uploaded_files uf LEFT JOIN conversations c ON uf.context_id = c.id
			      WHERE (uf.class_id = ? AND uf.context_type = 'channel') OR (uf.context_type = 'dm' AND uf.context_id LIKE ?)
			      ORDER BY uf.uploaded_at DESC LIMIT 200`,
			args: [classId, userId ? `%${userId}%` : '__no_match__']
		});
		uploadedFiles = filesResult.rows.map((r) => ({
			id: String(r.id), url: String(r.url), filename: String(r.filename), mimetype: String(r.mimetype ?? ''),
			size: Number(r.size), uploadedByName: String(r.uploaded_by_name),
			uploadedAt: new Date(String(r.uploaded_at).endsWith('Z') ? r.uploaded_at : r.uploaded_at + 'Z').getTime(),
			contextType: String(r.context_type), convName: r.conv_name ? String(r.conv_name) : String(r.context_id)
		}));

		const starredResult = userId ? await db.execute({
			sql: `SELECT id, message_id, conv_id, conv_name, content, author_name, attachment_url, attachment_filename, attachment_mimetype, starred_at
			      FROM starred_messages WHERE user_id = ? ORDER BY starred_at DESC`,
			args: [userId]
		}) : { rows: [] };
		starredMessages = starredResult.rows.map((r) => ({
			id: String(r.id), messageId: String(r.message_id), convId: String(r.conv_id),
			convName: r.conv_name ? String(r.conv_name) : null, content: r.content ? String(r.content) : null,
			authorName: String(r.author_name ?? ''),
			attachment: r.attachment_url ? { url: String(r.attachment_url), filename: String(r.attachment_filename ?? ''), mimetype: String(r.attachment_mimetype ?? '') } : null,
			starredAt: new Date(String(r.starred_at).endsWith('Z') ? r.starred_at : r.starred_at + 'Z').getTime()
		}));
	}

	return { links, uploadedFiles, starredMessages };
}

// Re-export the same form actions from the assignments page
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
		const assignClassId = String(data.get('class_id') ?? '');
		await createAssignment({ week, title, description, dueDate, acceptedTypes, createdBy: session.user.id, classId: assignClassId || 'idc-fall-2026' });
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
			try { new URL(value); } catch { return fail(400, { error: 'Enter a valid URL', action: 'submit', assignmentId }); }
		} else if (type === 'image' || type === 'video') {
			const file = data.get('file');
			if (!file || typeof file === 'string' || file.size === 0) return fail(400, { error: 'Please choose a file', action: 'submit', assignmentId });
			const allowed = type === 'image' ? ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] : ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
			if (!allowed.includes(file.type)) return fail(400, { error: `Invalid file type for ${type}`, action: 'submit', assignmentId });
			const ext = file.name.split('.').pop();
			const key = `submissions/${assignmentId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;
			const buffer = Buffer.from(await file.arrayBuffer());
			await uploadToR2(key, buffer, file.type);
			value = key;
		} else { return fail(400, { error: 'Unknown submission type', action: 'submit', assignmentId }); }
		await createSubmission({ assignmentId, studentId: session.user.id, type, value });
	}
};
