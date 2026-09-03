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
		sql: `INSERT INTO users (id, email, username, name, password_hash, role, onboarding_step, hide_tg_emoji, gemma_digest, gemma_scan_dms)
		      VALUES (?, ?, ?, 'App Reviewer', ?, 'student', 'complete', 1, 1, 1)`,
		args: [userId, email, username, passwordHash]
	});
	console.log(`created user ${userId}`);
}

// Enroll (approved) in the App Store review class — the self-contained one
// built by scripts/seed-review-class.js.
//
// This used to pick "the class with the most approved members", which is the
// REAL teaching class. That channel carries development traffic (perf dumps,
// LAN probe links), which is exactly what the review class exists to keep out
// of the reviewer's hands — so re-running this to reset the demo password
// would silently drag the reviewer back into it.
const REVIEW_CLASS_ID = 'idc-review';
const cls = await db.execute({
	sql: 'SELECT id, name, term FROM classes WHERE id = ?',
	args: [REVIEW_CLASS_ID]
});
if (!cls.rows[0]) {
	console.error(`class ${REVIEW_CLASS_ID} does not exist — run: node scripts/seed-review-class.js`);
	process.exit(1);
}
const classId = String(cls.rows[0].id);

await db.execute({
	sql: `INSERT INTO class_memberships (id, class_id, user_id, status, reviewed_at)
	      VALUES (?, ?, ?, 'approved', datetime('now'))
	      ON CONFLICT(class_id, user_id) DO UPDATE SET status = 'approved', reviewed_at = datetime('now')`,
	args: [crypto.randomUUID(), classId, userId]
});

// Any OTHER membership would put a class switcher in front of the reviewer and
// could land them in the wrong class on first launch.
await db.execute({
	sql: 'DELETE FROM class_memberships WHERE user_id = ? AND class_id <> ?',
	args: [userId, classId]
});

console.log(`enrolled in ${cls.rows[0].name} (${cls.rows[0].term}) [${classId}], hide_tg_emoji = 1`);
console.log(`login: ${username} / ${password}`);
