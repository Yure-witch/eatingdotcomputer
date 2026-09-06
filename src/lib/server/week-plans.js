import { getDb } from './turso.js';

export async function getWeekPlans(classId) {
	const db = getDb();
	if (!db) return [];
	const plansResult = await db.execute({
		sql: 'SELECT id, week, headline, topic_preview, due_date, show_submissions, important, created_at FROM week_plans WHERE class_id = ? ORDER BY week ASC',
		args: [classId]
	});
	const plans = [];
	for (const row of plansResult.rows) {
		const itemsResult = await db.execute({
			sql: 'SELECT id, label, requires_submission, accepted_types, show_submissions, resource_url, resource_label, resource_filename, resource_mimetype, sort_order FROM week_items WHERE week_plan_id = ? ORDER BY sort_order ASC',
			args: [row.id]
		});
		let items = itemsResult.rows.map((r) => {
			let acceptedTypes;
			try { acceptedTypes = JSON.parse(String(r.accepted_types ?? '["link"]')); } catch { acceptedTypes = ['link']; }
			return {
				id: String(r.id),
				label: String(r.label),
				requiresSubmission: !!r.requires_submission,
				acceptedTypes,
				showSubmissions: r.show_submissions != null ? !!r.show_submissions : null,
				resourceUrl: r.resource_url ? String(r.resource_url) : null,
				resourceLabel: r.resource_label ? String(r.resource_label) : null,
				resourceFilename: r.resource_filename ? String(r.resource_filename) : null,
				resourceMimetype: r.resource_mimetype ? String(r.resource_mimetype) : null,
				sortOrder: Number(r.sort_order)
			};
		});
		plans.push({
			id: String(row.id),
			week: Number(row.week),
			headline: String(row.headline),
			topicPreview: row.topic_preview ? String(row.topic_preview) : null,
			dueDate: row.due_date ? String(row.due_date) : null,
			showSubmissions: !!row.show_submissions,
			important: !!row.important,
			createdAt: String(row.created_at),
			items
		});
	}
	return plans;
}

export async function getCompletionsForStudent(weekPlanId, studentId) {
	const db = getDb();
	if (!db) return {};
	const result = await db.execute({
		sql: `SELECT ic.item_id, ic.completed_at, ic.submission_type, ic.submission_value
		      FROM item_completions ic
		      JOIN week_items wi ON ic.item_id = wi.id
		      WHERE wi.week_plan_id = ? AND ic.student_id = ?`,
		args: [weekPlanId, studentId]
	});
	const map = {};
	for (const r of result.rows) {
		map[String(r.item_id)] = {
			completedAt: String(r.completed_at),
			submissionType: r.submission_type ? String(r.submission_type) : null,
			submissionValue: r.submission_value ? String(r.submission_value) : null
		};
	}
	return map;
}

export async function getCompletionsForWeek(weekPlanId) {
	const db = getDb();
	if (!db) return {};
	const result = await db.execute({
		sql: `SELECT wi.id as item_id, COUNT(ic.id) as completed
		      FROM week_items wi
		      LEFT JOIN item_completions ic ON wi.id = ic.item_id
		      WHERE wi.week_plan_id = ?
		      GROUP BY wi.id`,
		args: [weekPlanId]
	});
	const map = {};
	for (const r of result.rows) {
		map[String(r.item_id)] = Number(r.completed);
	}
	return map;
}

export async function getStudentCountForClass(classId) {
	const db = getDb();
	if (!db) return 0;
	// Approved students enrolled in THIS class. Old implementation
	// counted every student globally, which gave a wildly wrong
	// "N/M done" ratio once the system had more than one class.
	// Shadowbanned students are not in the denominator. The instructor is
	// reading "how much of the class has turned this in", and a hidden member
	// is not part of the class for that question — counting them would make a
	// fully-submitted item read as 12/13 forever.
	const result = await db.execute({
		sql: `SELECT COUNT(*) as cnt
		      FROM class_memberships cm
		      JOIN users u ON u.id = cm.user_id
		      WHERE cm.class_id = ? AND cm.status = 'approved' AND u.role = 'student'
		        AND u.shadowbanned = 0`,
		args: [classId]
	});
	return Number(result.rows[0]?.cnt ?? 0);
}

export async function getAllProgressForClass(classId) {
	const db = getDb();
	if (!db) return {};
	const result = await db.execute({
		// Ticks from hidden members don't count either — the numerator has to
		// match the denominator above or the ratio is nonsense in the other
		// direction (14/13 done).
		sql: `SELECT wi.week_plan_id, wi.id as item_id,
		             COUNT(CASE WHEN u.shadowbanned = 0 THEN ic.id END) as completed
		      FROM week_items wi
		      JOIN week_plans wp ON wi.week_plan_id = wp.id
		      LEFT JOIN item_completions ic ON wi.id = ic.item_id
		      LEFT JOIN users u ON u.id = ic.student_id
		      WHERE wp.class_id = ?
		      GROUP BY wi.week_plan_id, wi.id`,
		args: [classId]
	});
	const map = {};
	for (const r of result.rows) {
		const planId = String(r.week_plan_id);
		if (!map[planId]) map[planId] = {};
		map[planId][String(r.item_id)] = Number(r.completed);
	}
	return map;
}

export async function getSubmissionsByItem(classId) {
	const db = getDb();
	if (!db) return {};
	const result = await db.execute({
		// `hidden` rides along rather than filtering the row out: a hidden
		// student's text or link submission still shows in the expanded list —
		// they did the work and the instructor should read it — it just doesn't
		// add to the N in "N/M done".
		sql: `SELECT ic.item_id, ic.completed_at, ic.submission_type, ic.submission_value,
		             u.name as student_name, u.shadowbanned
		      FROM item_completions ic
		      JOIN week_items wi ON ic.item_id = wi.id
		      JOIN week_plans wp ON wi.week_plan_id = wp.id
		      JOIN users u ON ic.student_id = u.id
		      WHERE wp.class_id = ?
		      ORDER BY ic.completed_at DESC`,
		args: [classId]
	});
	const map = {};
	for (const r of result.rows) {
		const itemId = String(r.item_id);
		if (!map[itemId]) map[itemId] = [];
		map[itemId].push({
			completedAt: String(r.completed_at),
			submissionType: r.submission_type ? String(r.submission_type) : null,
			submissionValue: r.submission_value ? String(r.submission_value) : null,
			studentName: String(r.student_name),
			hidden: Number(r.shadowbanned ?? 0) === 1
		});
	}
	return map;
}

export async function createWeekPlan({ week, headline, topicPreview, dueDate, important, classId, createdBy }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	const id = crypto.randomUUID();
	await db.execute({
		sql: 'INSERT INTO week_plans (id, week, headline, topic_preview, due_date, important, class_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		args: [id, week, headline, topicPreview || null, dueDate || null, important ? 1 : 0, classId, createdBy]
	});
	return id;
}

export async function createWeekItems(weekPlanId, items) {
	const db = getDb();
	if (!db) throw new Error('No database');
	if (!items.length) return;
	const stmts = items.map((item, i) => ({
		sql: 'INSERT INTO week_items (id, week_plan_id, label, requires_submission, accepted_types, resource_url, resource_label, resource_filename, resource_mimetype, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		args: [crypto.randomUUID(), weekPlanId, item.label, item.requiresSubmission ? 1 : 0, JSON.stringify(item.acceptedTypes || ['link']), item.resourceUrl || null, item.resourceLabel || null, item.resourceFilename || null, item.resourceMimetype || null, i]
	}));
	await db.batch(stmts);
}

/**
 * Edit an existing week_plan + its items. Item IDs that already exist
 * on the plan are PRESERVED so any student completions / submissions
 * attached to them survive the edit. The diff is computed against the
 * current DB rows:
 *   - items in `items[]` WITH an `id` matching a current row → UPDATE
 *   - items in `items[]` WITHOUT an `id` → INSERT (fresh UUID)
 *   - items in the DB NOT mentioned in `items[]` → DELETE (and their
 *     item_completions / completions go with them — by design; if the
 *     instructor removes an item that's been completed, that's intent)
 *
 * Returns nothing on success; throws on a UNIQUE constraint hit so
 * the form action can surface "Week N already exists" the same way
 * createWeekPlan does.
 */
export async function updateWeekPlan(planId, { week, headline, topicPreview, dueDate, important }, items) {
	const db = getDb();
	if (!db) throw new Error('No database');

	await db.execute({
		sql: 'UPDATE week_plans SET week = ?, headline = ?, topic_preview = ?, due_date = ?, important = ? WHERE id = ?',
		args: [week, headline, topicPreview || null, dueDate || null, important ? 1 : 0, planId]
	});

	// Read the current item set so we know which IDs to keep, which
	// to delete, and which slots to UPDATE vs. INSERT.
	const currentRes = await db.execute({
		sql: 'SELECT id FROM week_items WHERE week_plan_id = ?',
		args: [planId]
	});
	const currentIds = new Set(currentRes.rows.map((r) => String(r.id)));
	const incomingIds = new Set(items.map((it) => it.id).filter(Boolean));

	const stmts = [];

	// Delete items no longer present in the incoming list.
	for (const id of currentIds) {
		if (!incomingIds.has(id)) {
			stmts.push({
				sql: 'DELETE FROM week_items WHERE id = ?',
				args: [id]
			});
		}
	}

	// Upsert each incoming item, preserving sort order from array
	// position. New items (no id) get a freshly generated UUID so the
	// caller doesn't need to fabricate one.
	items.forEach((item, i) => {
		const acceptedTypes = JSON.stringify(item.acceptedTypes || ['link']);
		if (item.id && currentIds.has(item.id)) {
			stmts.push({
				sql: `UPDATE week_items
				      SET label = ?, requires_submission = ?, accepted_types = ?,
				          resource_url = ?, resource_label = ?,
				          resource_filename = ?, resource_mimetype = ?, sort_order = ?
				      WHERE id = ?`,
				args: [
					item.label,
					item.requiresSubmission ? 1 : 0,
					acceptedTypes,
					item.resourceUrl || null,
					item.resourceLabel || null,
					item.resourceFilename || null,
					item.resourceMimetype || null,
					i,
					item.id
				]
			});
		} else {
			stmts.push({
				sql: `INSERT INTO week_items (id, week_plan_id, label, requires_submission, accepted_types, resource_url, resource_label, resource_filename, resource_mimetype, sort_order)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					crypto.randomUUID(),
					planId,
					item.label,
					item.requiresSubmission ? 1 : 0,
					acceptedTypes,
					item.resourceUrl || null,
					item.resourceLabel || null,
					item.resourceFilename || null,
					item.resourceMimetype || null,
					i
				]
			});
		}
	});

	if (stmts.length) await db.batch(stmts);
}

export async function completeItem({ itemId, studentId, submissionType, submissionValue }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	const id = crypto.randomUUID();
	await db.execute({
		sql: `INSERT INTO item_completions (id, item_id, student_id, submission_type, submission_value)
		      VALUES (?, ?, ?, ?, ?)
		      ON CONFLICT(item_id, student_id) DO UPDATE SET
		        completed_at = datetime('now'),
		        submission_type = excluded.submission_type,
		        submission_value = excluded.submission_value`,
		args: [id, itemId, studentId, submissionType || null, submissionValue || null]
	});
}

export async function uncompleteItem(itemId, studentId) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({
		sql: 'DELETE FROM item_completions WHERE item_id = ? AND student_id = ?',
		args: [itemId, studentId]
	});
}

export async function deleteWeekPlan(id) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({ sql: 'DELETE FROM week_plans WHERE id = ?', args: [id] });
}

export async function toggleWeekSubmissions(planId, show) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({ sql: 'UPDATE week_plans SET show_submissions = ? WHERE id = ?', args: [show ? 1 : 0, planId] });
}

export async function toggleItemSubmissions(itemId, show) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({ sql: 'UPDATE week_items SET show_submissions = ? WHERE id = ?', args: [show == null ? null : (show ? 1 : 0), itemId] });
}

/**
 * Peer submissions — what STUDENTS see of each other's work.
 *
 * `viewerId` is not optional in practice: this is the one submissions query
 * that renders to the whole class, so a shadowbanned member's name and work
 * were on every student's dashboard, which is precisely what the shadowban is
 * for. They still see their OWN row (nothing may look different to them), so
 * the filter is "hidden, unless it's you".
 */
export async function getVisibleSubmissionsForPlan(weekPlanId, viewerId = null) {
	const db = getDb();
	if (!db) return {};
	const result = await db.execute({
		sql: `SELECT ic.item_id, ic.completed_at, ic.submission_type, ic.submission_value,
		             u.name as student_name, u.id as student_id
		      FROM item_completions ic
		      JOIN week_items wi ON ic.item_id = wi.id
		      JOIN week_plans wp ON wi.week_plan_id = wp.id
		      JOIN users u ON ic.student_id = u.id
		      WHERE wi.week_plan_id = ?
		        AND (wi.show_submissions = 1 OR (wi.show_submissions IS NULL AND wp.show_submissions = 1))
		        AND (u.shadowbanned = 0 OR u.id = ?)
		      ORDER BY ic.completed_at DESC`,
		args: [weekPlanId, viewerId]
	});
	const map = {};
	for (const r of result.rows) {
		const itemId = String(r.item_id);
		if (!map[itemId]) map[itemId] = [];
		map[itemId].push({
			completedAt: String(r.completed_at),
			submissionType: r.submission_type ? String(r.submission_type) : null,
			submissionValue: r.submission_value ? String(r.submission_value) : null,
			studentName: String(r.student_name),
			studentId: String(r.student_id)
		});
	}
	return map;
}
