import { redirect, fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { uploadToR2 } from '$lib/server/r2.js';

export async function load({ locals }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const db = getDb();
	const result = db ? await db.execute({
		sql: 'SELECT name, bio, pronouns, website, year, school, focus, interests, avatar_kind, avatar_value FROM users WHERE id = ?',
		args: [session.user.id]
	}) : { rows: [] };

	const u = result.rows[0];
	return {
		prefill: {
			name: String(u?.name ?? session.user.name ?? ''),
			bio: String(u?.bio ?? ''),
			pronouns: String(u?.pronouns ?? ''),
			website: String(u?.website ?? ''),
			year: String(u?.year ?? ''),
			school: String(u?.school ?? ''),
			focus: String(u?.focus ?? ''),
			interests: String(u?.interests ?? ''),
			avatarKind: u?.avatar_kind ? String(u.avatar_kind) : 'gen',
			avatarValue: u?.avatar_value ? String(u.avatar_value) : null
		}
	};
}

const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const actions = {
	default: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session) redirect(303, '/login');

		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const pronouns = String(data.get('pronouns') ?? '').trim();
		const bio = String(data.get('bio') ?? '').trim();
		const website = String(data.get('website') ?? '').trim();
		const year = String(data.get('year') ?? '').trim();
		const school = String(data.get('school') ?? '').trim();
		const focus = String(data.get('focus') ?? '').trim();
		// "Tell me about your interests" — feeds Gemma's digest inspiration
		// (same users.interests column the instructor can edit in Manage).
		const interests = String(data.get('interests') ?? '').trim().slice(0, 2000);

		if (!name) return fail(400, { error: 'Name is required', name, pronouns, bio, website, year, school, focus, interests });
		// Students pick their Cooper school; instructors skip that. Year is NOT
		// collected here — the instructor sets each student's year in Manage.
		if (session.user.role !== 'instructor' && !school) {
			return fail(400, { error: 'Pick your school', name, pronouns, bio, website, year, school, focus, interests });
		}

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		// Same avatar handling as /app/profile/edit — see that file's
		// comment block. We persist on the very first profile save so
		// the user picks their avatar once, during onboarding, and it
		// rides through every subsequent surface (chat, mentions,
		// notification bell, profile cards).
		const rawKind = String(data.get('avatar_kind') ?? 'gen').trim();
		const avatarKind = (rawKind === 'photo' || rawKind === 'expr') ? rawKind : 'gen';
		let avatarValue = null;
		if (avatarKind === 'expr') {
			avatarValue = String(data.get('avatar_value') ?? '').trim() || null;
		} else if (avatarKind === 'photo') {
			const file = data.get('avatar_photo');
			if (file && typeof file !== 'string' && file.size > 0) {
				if (!ALLOWED_AVATAR_MIME.includes(file.type)) {
					return fail(400, { error: 'Avatar must be a JPEG, PNG, WebP, or GIF.', action: 'avatar' });
				}
				const ext = (file.name?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'png';
				const key = `avatars/${session.user.id}/${crypto.randomUUID()}.${ext}`;
				await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
				const publicBase = (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
				avatarValue = publicBase ? `${publicBase}/${key}` : key;
			} else {
				const cur = await db.execute({
					sql: 'SELECT avatar_value FROM users WHERE id = ?',
					args: [session.user.id]
				});
				avatarValue = cur.rows[0]?.avatar_value ? String(cur.rows[0].avatar_value) : null;
				if (!avatarValue) {
					return fail(400, { error: 'Choose a photo to upload, or pick a different avatar style.', action: 'avatar' });
				}
			}
		}

		const nextStep = session.user.role === 'instructor' ? 'complete' : 'class';

		// Note: `year` is intentionally NOT written here — it's instructor-managed
		// in Manage, so re-running onboarding never clobbers an instructor's entry.
		await db.execute({
			sql: 'UPDATE users SET name = ?, pronouns = ?, bio = ?, website = ?, school = ?, focus = ?, interests = ?, avatar_kind = ?, avatar_value = ?, onboarding_step = ? WHERE id = ?',
			args: [
				name, pronouns || null, bio || null, website || null,
				school || null, focus || null, interests || null,
				avatarKind, avatarValue,
				nextStep, session.user.id
			]
		});

		redirect(303, nextStep === 'complete' ? '/app' : '/onboarding/class');
	}
};
