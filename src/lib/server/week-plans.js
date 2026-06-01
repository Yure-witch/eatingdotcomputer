import { getDb } from './turso.js';

export async function getWeekPlans(classId) {
	const db = getDb();
	if (!db) return [];
	const plansResult = await db.execute({
		sql: 'SELECT id, week, headline, topic_preview, due_date, show_submissions, created_at FROM week_plans WHERE class_id = ? ORDER BY week ASC',
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
	const result = await db.execute({
		sql: "SELECT COUNT(*) as cnt FROM users WHERE role = 'student'",
		args: []
	});
	return Number(result.rows[0]?.cnt ?? 0);
}

export async function getAllProgressForClass(classId) {
	const db = getDb();
	if (!db) return {};
	const result = await db.execute({
		sql: `SELECT wi.week_plan_id, wi.id as item_id, COUNT(ic.id) as completed
		      FROM week_items wi
		      JOIN week_plans wp ON wi.week_plan_id = wp.id
		      LEFT JOIN item_completions ic ON wi.id = ic.item_id
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
		sql: `SELECT ic.item_id, ic.completed_at, ic.submission_type, ic.submission_value,
		             u.name as student_name
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
			studentName: String(r.student_name)
		});
	}
	return map;
}

export async function createWeekPlan({ week, headline, topicPreview, dueDate, classId, createdBy }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	const id = crypto.randomUUID();
	await db.execute({
		sql: 'INSERT INTO week_plans (id, week, headline, topic_preview, due_date, class_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
		args: [id, week, headline, topicPreview || null, dueDate || null, classId, createdBy]
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

export async function getVisibleSubmissionsForPlan(weekPlanId) {
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
		      ORDER BY ic.completed_at DESC`,
		args: [weekPlanId]
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
