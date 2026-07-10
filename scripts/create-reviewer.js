// Create (or update) the App Store review account.
// Usage: node scripts/create-reviewer.js <username> <password>
// Idempotent: re-running updates the password/flags on the existing account.
import { createClient } from '@libsql/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';

config({ path: '.env' });

const [username, password] = process.argv.slice(2);
if (!username || !password) {
	console.error('usage: node scripts/create-reviewer.js <username> <password>');
	process.exit(1);
}

const db = createClient({
	url: process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});

const email = `${username}@review.eating.computer`;
const passwordHash = await hash(password, 10);

// Reuse the existing row if the account was created before
const existing = await db.execute({
	sql: 'SELECT id FROM users WHERE username = ? OR email = ?',
	args: [username, email]
});
const userId = existing.rows[0] ? String(existing.rows[0].id) : crypto.randomUUID();

if (existing.rows[0]) {
	await db.execute({
		sql: `UPDATE users SET password_hash = ?, hide_tg_emoji = 1, onboarding_step = 'complete' WHERE id = ?`,
		args: [passwordHash, userId]
	});
	console.log(`updated existing user ${userId}`);
} else {
	await db.execute({
		sql: `INSERT INTO users (id, email, username, name, password_hash, role, onboarding_step, hide_tg_emoji)
		      VALUES (?, ?, ?, 'App Reviewer', ?, 'student', 'complete', 1)`,
		args: [userId, email, username, passwordHash]
	});
	console.log(`created user ${userId}`);
}

// Enroll (approved) in the most active class so the reviewer lands in a
// populated app instead of the onboarding screen.
const cls = await db.execute(`
	SELECT c.id, c.name, c.term,
	       (SELECT COUNT(*) FROM class_memberships cm WHERE cm.class_id = c.id AND cm.status = 'approved') AS members
	FROM classes c ORDER BY members DESC, c.created_at ASC LIMIT 1
`);
if (!cls.rows[0]) {
	console.error('no classes exist — reviewer would hit onboarding');
	process.exit(1);
}
const classId = String(cls.rows[0].id);

await db.execute({
	sql: `INSERT INTO class_memberships (id, class_id, user_id, status, reviewed_at)
	      VALUES (?, ?, ?, 'approved', datetime('now'))
	      ON CONFLICT(class_id, user_id) DO UPDATE SET status = 'approved', reviewed_at = datetime('now')`,
	args: [crypto.randomUUID(), classId, userId]
});

console.log(`enrolled in ${cls.rows[0].name} (${cls.rows[0].term}) [${classId}], hide_tg_emoji = 1`);
console.log(`login: ${username} / ${password}`);
