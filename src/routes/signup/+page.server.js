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
		const agreeTerms = data.get('agreeTerms') === 'on';

		const values = { name, username, email, agreeTerms };
		if (!agreeTerms) {
			return fail(400, { error: 'You need to agree to the Terms of Use to create an account.', ...values });
		}
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
			// Same defaults as the review accounts (and Apple sign-ups):
			// hide_tg_emoji = 1 keeps the third-party emote packs (Telegram,
			// Emoji Kitchen) off until the instructor enables them per member
			// (Manage → Members → 3rd-party); emoji_font = 'system' renders
			// native platform emoji rather than pulling the Noto face.
			// terms_accepted_at is set here because the form's required
			// agreement checkbox (validated above) IS the acceptance — these
			// accounts skip the /terms/accept gate.
			sql: `INSERT INTO users (id, email, username, name, password_hash, role, onboarding_step, hide_tg_emoji, emoji_font, terms_accepted_at, gemma_digest, gemma_scan_dms)
			      VALUES (?, ?, ?, ?, ?, 'student', 'profile', 1, 'system', datetime('now'), 1, 1)`,
			args: [crypto.randomUUID(), finalEmail, username, name, passwordHash]
		});

		// The page finishes the job: on `created` it submits the same
		// credentials sign-in the login page uses, which owns the session
		// cookie + redirect. Creating the session here would mean re-implementing
		// Auth.js's cookie handshake by hand.
		return { created: true };
	}
};
