import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { deleteFromR2, sweepR2Prefix } from '$lib/server/r2.js';

// In-app account deletion (App Store Guideline 5.1.1(v)) — self-service only:
// the session user deletes THEMSELF; there is no admin path through here.
//
// What happens:
//   DELETED   profile row, class memberships, submissions/completions, stars,
//             notifications (to and from them), push + APNs registrations,
//             activity/session logs, Gemma goals/state, uploads (R2 objects
//             included), avatar photos, reactions, and their RTDB user nodes
//             (chat list, read state, presence, notifications, digest state,
//             recommendations).
//   KEPT      messages they sent, with the stored author name rewritten to
//             "Deleted user" — a class conversation full of holes is useless
//             as a course record, and the live RTDB messages only carry the
//             user id, which stops resolving to anything once the row is
//             gone. The privacy policy states exactly this split; content
//             removal beyond it is an instructor request.
//   REPORTS   moderation reports stay (they are the class's safety record)
//             but any stored names for this user are anonymised.
//
// Every store is best-effort EXCEPT the users row: that delete is last and
// the request only succeeds if it happens, so a partial failure can be
// retried — re-running is idempotent.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	if (body?.confirm !== 'DELETE') error(400, 'Confirmation phrase missing');

	const uid = session.user.id;
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	// The last instructor can't self-delete: the class (and this very
	// moderation pipeline) would be ownerless. Hand off the role first.
	if (session.user.role === 'instructor') {
		const others = await db.execute({
			sql: `SELECT COUNT(*) AS n FROM users WHERE role = 'instructor' AND id != ?`,
			args: [uid]
		});
		if (Number(others.rows[0]?.n ?? 0) === 0) {
			error(409, 'You are the only instructor. Make someone else an instructor before deleting this account.');
		}
	}

	// ── R2 objects (before their DB rows go) ──────────────────────────────
	try {
		const files = await db.execute({
			sql: 'SELECT r2_key FROM uploaded_files WHERE uploaded_by_id = ?',
			args: [uid]
		});
		for (const row of files.rows) {
			if (row.r2_key) await deleteFromR2(String(row.r2_key)).catch(() => {});
		}
	} catch { /* objects orphaned in R2 at worst */ }
	try { await sweepR2Prefix(`avatars/${uid}/`, 0); } catch { /* same */ }

	// ── Turso: personal data rows ─────────────────────────────────────────
	const deletes = [
		['DELETE FROM push_subscriptions WHERE user_id = ?', [uid]],
		['DELETE FROM apns_tokens WHERE user_id = ?', [uid]],
		['DELETE FROM user_activity WHERE user_id = ?', [uid]],
		['DELETE FROM user_sessions WHERE user_id = ?', [uid]],
		['DELETE FROM user_ai_keys WHERE user_id = ?', [uid]],
		['DELETE FROM class_memberships WHERE user_id = ?', [uid]],
		['DELETE FROM submissions WHERE student_id = ?', [uid]],
		['DELETE FROM item_completions WHERE student_id = ?', [uid]],
		['DELETE FROM starred_messages WHERE user_id = ?', [uid]],
		['DELETE FROM notifications WHERE recipient_id = ? OR from_uid = ?', [uid, uid]],
		['DELETE FROM notifications_sent WHERE user_id = ?', [uid]],
		['DELETE FROM gemma_goals WHERE user_id = ?', [uid]],
		['DELETE FROM gemma_sent_links WHERE user_id = ?', [uid]],
		['DELETE FROM inspiration_items WHERE user_id = ?', [uid]],
		['DELETE FROM inspiration_reactions WHERE user_id = ?', [uid]],
		['DELETE FROM message_reactions WHERE user_id = ?', [uid]],
		['DELETE FROM thread_message_reactions WHERE user_id = ?', [uid]],
		['DELETE FROM uploaded_files WHERE uploaded_by_id = ?', [uid]],
		['DELETE FROM conversation_members WHERE user_id = ?', [uid]],
		// Anonymise, keep content (see header note):
		[`UPDATE chat_messages SET user_name = 'Deleted user' WHERE user_id = ?`, [uid]],
		[`UPDATE thread_messages SET user_name = 'Deleted user' WHERE user_id = ?`, [uid]],
		[`UPDATE messages SET user_name = 'Deleted user' WHERE user_id = ?`, [uid]],
		[`UPDATE direct_messages SET user_name = 'Deleted user' WHERE user_id = ?`, [uid]],
		[`UPDATE starred_messages SET author_name = 'Deleted user' WHERE author_id = ?`, [uid]],
		[`UPDATE message_reports SET reporter_name = 'Deleted user' WHERE reporter_id = ?`, [uid]],
		[`UPDATE message_reports SET message_user_name = 'Deleted user' WHERE message_user_id = ?`, [uid]],
		[`UPDATE reaction_images SET created_by_name = 'Deleted user' WHERE created_by_id = ?`, [uid]],
		[`UPDATE custom_emoji SET created_by_name = 'Deleted user' WHERE created_by_id = ?`, [uid]]
	];
	const failed = [];
	for (const [sql, args] of deletes) {
		try {
			await db.execute({ sql, args });
		} catch (e) {
			// Track but keep going — a single optional table (e.g. one that
			// predates this database) must not strand the whole deletion.
			failed.push(sql.split(' ')[2]);
		}
	}

	// ── Firebase RTDB user nodes ──────────────────────────────────────────
	try {
		const rtdb = getAdminDb();
		await Promise.allSettled([
			rtdb.ref(`userChats/${uid}`).remove(),
			rtdb.ref(`lastRead/${uid}`).remove(),
			rtdb.ref(`presence/${uid}`).remove(),
			rtdb.ref(`notifications/${uid}`).remove(),
			rtdb.ref(`gemmaDigestState/${uid}`).remove(),
			rtdb.ref(`recs/users/${uid}`).remove()
		]);
	} catch { /* RTDB nodes are keyed by an id that no longer resolves */ }

	// ── The account itself — last, and required to succeed ────────────────
	await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [uid] });

	return json({ ok: true, incomplete: failed });
}
