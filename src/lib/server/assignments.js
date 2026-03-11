import { getDb } from './turso.js';

export async function getAssignments() {
	const db = getDb();
	if (!db) return [];
	const result = await db.execute(
		'SELECT id, week, title, description, due_date, accepted_types, created_at FROM assignments ORDER BY week ASC, created_at ASC'
	);
	return result.rows;
}

export async function createAssignment({ week, title, description, dueDate, acceptedTypes, createdBy }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	const id = crypto.randomUUID();
	await db.execute({
		sql: 'INSERT INTO assignments (id, week, title, description, due_date, accepted_types, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
		args: [id, week, title, description || null, dueDate || null, JSON.stringify(acceptedTypes), createdBy]
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
