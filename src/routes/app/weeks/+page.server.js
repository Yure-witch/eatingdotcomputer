import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getWeekPlans, getCompletionsForStudent, getVisibleSubmissionsForPlan } from '$lib/server/week-plans.js';

/**
 * Past + future week plans. The home page (`/app`) shows the
 * CURRENT week; this page surfaces the rest — every plan the student
 * (or instructor) has already finished plus everything queued ahead.
 *
 * Linked from the home page's "Up next" and "View previous weeks"
 * affordances, which used to drop into /app/atlas. Atlas covers
 * roadmap/files/etc. — that wasn't the right destination for the
 * specific "where can I see other weeks?" intent.
 */
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

	const upcoming = plans.filter((p) => !p.dueDate || new Date(p.dueDate) >= today);
	const past = plans.filter((p) => p.dueDate && new Date(p.dueDate) < today);
	const currentPlan = upcoming[0] ?? past[past.length - 1] ?? null;

	// Future weeks = everything upcoming AFTER the current one. Past
	// weeks = literally past, newest first so the most recently
	// finished work sits at the top of its column.
	const futurePlans = currentPlan
		? upcoming.filter((p) => p.id !== currentPlan.id)
		: upcoming.slice();
	const pastPlans = currentPlan
		? past.filter((p) => p.id !== currentPlan.id).reverse()
		: past.slice().reverse();

	// Resolve R2 keys to public URLs for any inline submissions we
	// surface (peer submissions on past weeks). Same pattern the home
	// page uses.
	const r2Base = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
	const resolveSubmissionUrl = (s) => ({
		...s,
		submissionUrl: s.submissionType === 'link' ? s.submissionValue
			: (s.submissionType === 'image' || s.submissionType === 'video') && s.submissionValue
				? (s.submissionValue.startsWith('http') ? s.submissionValue : `${r2Base}/${s.submissionValue}`)
				: null
	});

	// Student-only: per-plan completion sets so the UI can show which
	// past items they finished. Instructors see the gross "this week
	// is past" without the per-student noise.
	const completionsByPlan = {};
	if (!isInstructor) {
		await Promise.all(pastPlans.map(async (p) => {
			completionsByPlan[p.id] = await getCompletionsForStudent(p.id, userId);
		}));
	}

	// Compact summary of every plan in order — feeds the progress rail
	// on the redesigned hero so each week renders as a dot, with hover
	// tooltips and the `important` flag driving dot size/prominence.
	const allWeeks = [...plans]
		.sort((a, b) => a.week - b.week)
		.map((p) => ({
			id: p.id,
			week: p.week,
			headline: p.headline,
			dueDate: p.dueDate,
			important: !!p.important,
			isCurrent: currentPlan ? p.id === currentPlan.id : false,
			isPast: p.dueDate ? new Date(p.dueDate) < today : false
		}));

	return {
		session,
		currentPlan,
		pastPlans,
		futurePlans,
		allWeeks,
		completionsByPlan,
		classId
	};
}
