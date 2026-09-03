import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { createFirebaseToken, getAdminDb } from '$lib/server/firebase-admin.js';

export async function load({ locals, cookies }) {
	const session = await locals.auth();
	if (!session) redirect(303, '/login');

	const firebaseToken = await createFirebaseToken(session.user.id).catch(() => null);
	const userId = session.user.id;
	const db = getDb();

	// Terms gate (Guideline 1.2): nobody uses the app before agreeing to the
	// Terms of Use. Sign-up sets the timestamp via its required checkbox;
	// OAuth users and accounts that predate the terms accept once at
	// /terms/accept. Applies to every role, instructor included.
	if (db) {
		const terms = await db.execute({
			sql: 'SELECT terms_accepted_at FROM users WHERE id = ?',
			args: [userId]
		});
		if (terms.rows[0] && !terms.rows[0].terms_accepted_at) redirect(303, '/terms/accept');
	}

	let currentClass = null;
	let allClasses = [];

	if (session.user.role === 'instructor') {
		if (db) {
			const result = await db.execute(
				'SELECT id, name, term FROM classes ORDER BY created_at ASC'
			);
			allClasses = result.rows.map((r) => ({
				id: String(r.id),
				name: String(r.name),
				term: String(r.term)
			}));
		}
		const selectedId = cookies.get('selected_class_id');
		currentClass = allClasses.find((c) => c.id === selectedId) ?? allClasses[0] ?? null;
	} else {
		if (!db) redirect(303, '/onboarding/profile');
		try {
			const membershipResult = await db.execute({
				sql: `SELECT cm.status, cm.class_id, c.name, c.term
				      FROM class_memberships cm
				      JOIN classes c ON cm.class_id = c.id
				      WHERE cm.user_id = ?
				      ORDER BY cm.requested_at DESC LIMIT 1`,
				args: [session.user.id]
			});
			const row = membershipResult.rows[0];
			const status = String(row?.status ?? 'none');
			// Profile-onboarding gate, checked INDEPENDENTLY of membership: an
			// instructor-added user can be approved straight into a class without
			// ever completing the profile step, so we must still route them
			// through it. `onboarding_step` only advances past 'profile' once the
			// profile form is submitted (defaults to 'profile' for a fresh user).
			const userResult = await db.execute({
				sql: 'SELECT onboarding_step FROM users WHERE id = ?',
				args: [session.user.id]
			});
			const step = String(userResult.rows[0]?.onboarding_step ?? 'profile');
			const profileDone = step !== 'profile';
			if (status === 'approved') {
				if (!profileDone) redirect(303, '/onboarding/profile');
				currentClass = {
					id: String(row.class_id),
					name: String(row.name),
					term: String(row.term)
				};
			} else if (status === 'pending' || status === 'denied') {
				redirect(303, '/onboarding/pending');
			} else {
				redirect(303, step === 'class' ? '/onboarding/class' : '/onboarding/profile');
			}
		} catch (e) {
			if (e?.status) throw e;
			redirect(303, '/onboarding/profile');
		}
	}

	// Load sidebar data (channels + class members)
	const classId = currentClass?.id ?? null;
	let users = [];
	let channels = [];

	if (classId && db) {
		const [usersResult, channelsResult] = await Promise.all([
			db.execute({
				sql: `SELECT u.id, u.name, u.email, u.role, u.avatar_kind, u.avatar_value FROM users u
				      WHERE u.role = 'instructor'
				         OR EXISTS (
				              SELECT 1 FROM class_memberships cm
				              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
				            )
				      ORDER BY u.name ASC`,
				args: [classId]
			}),
			db.execute({
				sql: "SELECT id, name, created_at FROM conversations WHERE type = 'channel' AND class_id = ? ORDER BY created_at ASC",
				args: [classId]
			})
		]);

		users = usersResult.rows
			.filter((u) => String(u.id) !== session.user.id)
			.map((u) => ({
				id: String(u.id),
				name: String(u.name || u.email),
				role: String(u.role),
				avatarKind: u.avatar_kind ? String(u.avatar_kind) : 'gen',
				avatarValue: u.avatar_value ? String(u.avatar_value) : null
			}));

		channels = channelsResult.rows.map((c) => ({ id: String(c.id), name: String(c.name) }));
	}

	// Pull the current user's name + avatar so the sidebar / user menu /
	// own-message bubbles can render them without falling back to a
	// generic chip. session.user doesn't carry the avatar at all — it's set
	// via the profile flow after auth — and the name it DOES carry is the
	// one baked into the JWT at sign-in, which never changes when the user
	// renames themselves. Everyone else reads them out of `users` (Turso,
	// refetched on membersRev), so a rename showed up for the whole class
	// and not for the person who made it. Read our own row the same way
	// they do.
	let myName = null;
	let myAvatarKind = 'gen';
	let myAvatarValue = null;
	let myMemberOrder = [];
	let myHideTgEmoji = false;
	// null = the user has never been given a server-side default, so the client
	// keeps its own ('noto'). See migration 062.
	let myEmojiFont = null;
	if (db) {
		try {
			const r = await db.execute({
				sql: 'SELECT name, avatar_kind, avatar_value, member_order, hide_tg_emoji, emoji_font FROM users WHERE id = ?',
				args: [session.user.id]
			});
			const row = r.rows[0];
			if (row?.name) myName = String(row.name);
			if (row?.avatar_kind) myAvatarKind = String(row.avatar_kind);
			if (row?.avatar_value) myAvatarValue = String(row.avatar_value);
			if (row?.member_order) {
				try { const o = JSON.parse(row.member_order); if (Array.isArray(o)) myMemberOrder = o; } catch { /* ignore bad json */ }
			}
			myHideTgEmoji = Number(row?.hide_tg_emoji ?? 0) === 1;
			if (row?.emoji_font) myEmojiFont = String(row.emoji_font);
		} catch { /* non-fatal */ }
	}
	const currentUser = {
		id: session.user.id,
		name: myName || session.user.name || session.user.email || '',
		role: session.user.role ?? 'student',
		avatarKind: myAvatarKind,
		avatarValue: myAvatarValue,
		memberOrder: myMemberOrder,
		hideTgEmoji: myHideTgEmoji,
		emojiFont: myEmojiFont
	};

	// Fetch initial unread state from Firebase Admin (bypasses client auth/rules).
	// This ensures unread indicators show correctly on first render, before any
	// Firebase client subscription fires.
	let initialLastRead = {};
	let initialUnreadCounts = {};
	try {
		const adminDb = getAdminDb();
		const [lastReadSnap, unreadSnap, ...channelSnaps] = await Promise.all([
			adminDb.ref(`lastRead/${userId}`).get(),
			adminDb.ref(`unreadCounts/${userId}`).get(),
			...channels.map((ch) => adminDb.ref(`channels/${ch.id}/lastAt`).get())
		]);
		if (lastReadSnap.exists()) initialLastRead = lastReadSnap.val();
		if (unreadSnap.exists()) initialUnreadCounts = unreadSnap.val();
		// Attach lastAt to each channel so the client has it immediately
		for (let i = 0; i < channels.length; i++) {
			if (channelSnaps[i].exists()) channels[i] = { ...channels[i], lastAt: channelSnaps[i].val() };
		}
	} catch { /* non-fatal — client subscriptions will fill in the gaps */ }

	return { firebaseToken, userId, currentClass, allClasses, users, channels, classId, currentUser, initialLastRead, initialUnreadCounts };
}
