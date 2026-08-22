import { redirect, fail } from '@sveltejs/kit';
import { hash } from 'bcryptjs';
import { getDb } from '$lib/server/turso.js';

// Self-serve account creation with a username + password. New accounts are
// students at onboarding_step 'profile', so signing in drops them into the
// same onboarding the OAuth paths use: profile → choose a class → approval.
// Joining a class still gates everything — a fresh account sees no class
// content until an instructor (or the demo class's auto-approval) lets them
// in, which is what keeps open registration safe.
export async function load({ locals }) {
	const session = await locals.auth();
	if (session) redirect(302, '/app');
}

export const actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const username = String(data.get('username') ?? '').trim().toLowerCase();
		const email = String(data.get('email') ?? '').trim().toLowerCase();
		const password = String(data.get('password') ?? '');

		const values = { name, username, email };
		if (!name) return fail(400, { error: 'Please enter your name.', ...values });
		if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
			return fail(400, { error: 'Usernames are 3–24 characters: letters, numbers, - or _.', ...values });
		}
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'That email address doesn’t look right.', ...values });
		}
		if (password.length < 8) {
			return fail(400, { error: 'Passwords need at least 8 characters.', ...values });
		}

		const db = getDb();
		if (!db) return fail(503, { error: 'Service unavailable — try again in a moment.', ...values });

		// The email column is what the credentials provider also matches on,
		// so a synthesized address must be checked for collisions like a real
		// one. The @accounts. namespace keeps it out of any real mail domain.
		const finalEmail = email || `${username}@accounts.eating.computer`;
		const existing = await db.execute({
			sql: 'SELECT id FROM users WHERE username = ? OR email = ?',
			args: [username, finalEmail]
		});
		if (existing.rows[0]) {
			return fail(409, { error: 'That username or email is already taken.', ...values });
		}

		const passwordHash = await hash(password, 10);
		await db.execute({
			sql: `INSERT INTO users (id, email, username, name, password_hash, role, onboarding_step)
			      VALUES (?, ?, ?, ?, ?, 'student', 'profile')`,
			args: [crypto.randomUUID(), finalEmail, username, name, passwordHash]
		});

		// The page finishes the job: on `created` it submits the same
		// credentials sign-in the login page uses, which owns the session
		// cookie + redirect. Creating the session here would mean re-implementing
		// Auth.js's cookie handshake by hand.
		return { created: true };
	}
};
