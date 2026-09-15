import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';

function getAdminApp() {
	if (getApps().length) return getApps()[0];
	const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
	return initializeApp({
		credential: cert(serviceAccount),
		databaseURL: env.FIREBASE_DATABASE_URL
	});
}

export function getAdminDb() {
	return getDatabase(getAdminApp());
}

/**
 * Mint the custom token a client signs in to RTDB with.
 *
 * Carries a `role` claim, which the database rules read as auth.token.role.
 * Without it the rules can only tell "signed in" from "not signed in", so
 * anything instructor-only (attendanceNotes) would have to be enforced by the
 * app hiding it — and any student could read it straight out of RTDB.
 *
 * The role is read from `users` here rather than trusted from the caller's
 * session, so a changed role takes effect on the next mint (every app load)
 * instead of whenever the Auth.js token happens to refresh.
 */
export async function createFirebaseToken(userId) {
	let role = 'student';
	try {
		const r = await getDb()?.execute({ sql: 'SELECT role FROM users WHERE id = ?', args: [String(userId)] });
		if (r?.rows[0]?.role) role = String(r.rows[0].role);
	} catch { /* fall back to the least-privileged claim, never the most */ }
	return getAuth(getAdminApp()).createCustomToken(String(userId), { role });
}
