import { getDb } from './turso.js';

export async function getSubmissionsForAssignment(assignmentId) {
	const db = getDb();
	if (!db) return [];
	const result = await db.execute({
		sql: `SELECT s.id, s.student_id, s.type, s.value, s.created_at, u.name, u.email
		      FROM submissions s
		      JOIN users u ON u.id = s.student_id
		      WHERE s.assignment_id = ?
		      ORDER BY s.created_at DESC`,
		args: [assignmentId]
	});
	return result.rows;
}

export async function getStudentSubmission(assignmentId, studentId) {
	const db = getDb();
	if (!db) return null;
	const result = await db.execute({
		sql: 'SELECT id, type, value, created_at FROM submissions WHERE assignment_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 1',
		args: [assignmentId, studentId]
	});
	return result.rows[0] ?? null;
}

export async function createSubmission({ assignmentId, studentId, type, value }) {
	const db = getDb();
	if (!db) throw new Error('No database');
	const id = crypto.randomUUID();
	await db.execute({
		sql: 'INSERT INTO submissions (id, assignment_id, student_id, type, value) VALUES (?, ?, ?, ?, ?)',
		args: [id, assignmentId, studentId, type, value]
	});
	return id;
}

export async function deleteSubmission(id, studentId) {
	const db = getDb();
	if (!db) throw new Error('No database');
	await db.execute({
		sql: 'DELETE FROM submissions WHERE id = ? AND student_id = ?',
		args: [id, studentId]
	});
}
