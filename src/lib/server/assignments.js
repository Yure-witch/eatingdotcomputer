import { getDb } from './turso.js';

export async function getAssignments(classId) {
	const db = getDb();
	if (!db) return [];
	const result = await db.execute({
		sql: 'SELECT id, week, title, description, due_date, accepted_types, created_at FROM assignments WHERE class_id = ? ORDER BY week ASC, created_at ASC',
		args: [classId]
	});
	return result.rows;
}

export async function createAssignment({ week, title, description, dueDate, acceptedTypes, attachments, createdBy, classId }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	const id = crypto.randomUUID();
	await db.execute({
		sql: 'INSERT INTO assignments (id, week, title, description, due_date, accepted_types, attachments, created_by, class_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
		args: [id, week, title, description || null, dueDate || null, JSON.stringify(acceptedTypes), JSON.stringify(attachments ?? []), createdBy, classId]
	});
	return id;
}

export async function updateAssignment(id, { week, title, description, dueDate, acceptedTypes }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({
		sql: 'UPDATE assignments SET week=?, title=?, description=?, due_date=?, accepted_types=? WHERE id=?',
		args: [week, title, description || null, dueDate || null, JSON.stringify(acceptedTypes), id]
	});
}

export async function deleteAssignment(id) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({ sql: 'DELETE FROM assignments WHERE id = ?', args: [id] });
}
