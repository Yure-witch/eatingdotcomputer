import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runDailyDigests, getOpenActionItems, getOpenGoals, resetGemmaForUser, DEFAULT_CLASS } from '$lib/server/gemma-digest.js';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getConvId } from '$lib/convId.js';
import { pushIdToTimestamp } from '$lib/chat.js';

// GET ?history=1 — session-authed: the caller's digest messages (live RTDB
//   window + Turso archive, merged ascending). Also clears the gemma conv's
//   unread count — opening the Gemma page counts as reading the digests.
// GET (bare) — the daily cron (vercel.json). Same Bearer CRON_SECRET guard
//   as /api/chat/sync. Only sends when an instructor has the master switch
//   on (users.gemma_digest = 1 on an instructor row) — see runDailyDigests.
export async function GET({ request, url, locals }) {
	// ?status=1   — is a digest currently generating for the caller?
	// ?status=all — instructor-only: everyone with a generation in flight
	//               right now (fresh lockAt), names resolved.
	if (url.searchParams.get('status')) {
		const session = await locals.auth();
		if (!session?.user) error(401, 'Not authenticated');
		const LOCK_MS = 8 * 60 * 1000;
		if (url.searchParams.get('status') === 'all') {
			if (session.user.role !== 'instructor') error(403, 'Instructors only');
			const snap = await getAdminDb().ref('gemmaDigestState').get();
			const all = snap.val() ?? {};
			const now = Date.now();
			const busy = Object.entries(all)
				.filter(([, s]) => s?.lockAt && now - Number(s.lockAt) < LOCK_MS)
				.map(([uid, s]) => ({ userId: uid, forSecs: Math.round((now - Number(s.lockAt)) / 1000) }));
			if (busy.length) {
				const db = getDb();
				if (db) {
					const rows = await db.execute({
						sql: `SELECT id, name FROM users WHERE id IN (${busy.map(() => '?').join(',')})`,
						args: busy.map((b) => b.userId)
					});
					const names = {};
					for (const r of rows.rows) names[String(r.id)] = String(r.name ?? '');
					for (const b of busy) b.name = names[b.userId] ?? b.userId;
				}
			}
			return json({ generating: busy });
		}
		const snap = await getAdminDb().ref(`gemmaDigestState/${session.user.id}`).get();
		const s = snap.val() ?? {};
		const inProgress = !!s.lockAt && Date.now() - Number(s.lockAt) < LOCK_MS;
		return json({ inProgress, lastAt: s.at ?? null });
	}
	if (url.searchParams.get('history')) {
		const session = await locals.auth();
		if (!session?.user) error(401, 'Not authenticated');
		const convId = getConvId('gemma', session.user.id);
		const out = [];
		const db = getDb();
		if (db) {
			const rows = await db.execute({
				sql: `SELECT id, content, created_at FROM chat_messages
				      WHERE conversation_id = ? AND user_id = 'gemma'
				      ORDER BY created_at ASC LIMIT 60`,
				args: [convId]
			});
			for (const r of rows.rows) {
				out.push({ id: String(r.id), text: String(r.content), at: new Date(String(r.created_at)).getTime() });
			}
		}
		const adminDb = getAdminDb();
		const snap = await adminDb.ref(`dms/${convId}/messages`).limitToLast(30).get();
		if (snap.exists()) {
			for (const [key, m] of Object.entries(snap.val())) {
				if ((m?.u ?? m?.userId) !== 'gemma') continue;
				if (out.some((d) => d.id === key)) continue; // already archived
				out.push({ id: key, text: String(m?.c ?? m?.content ?? ''), at: pushIdToTimestamp(key) });
			}
		}
		out.sort((a, b) => a.at - b.at);
		// reading the page clears the digest unread count
		await adminDb.ref(`unreadCounts/${session.user.id}/${convId}`).set(0).catch(() => {});
		// live action items — CURRENT incomplete assignment items, so the
		// Gemma page's checklist always reflects reality (not a snapshot)
		const actionItems = session.user.role === 'instructor'
			? []
			: await getOpenActionItems(DEFAULT_CLASS, session.user.id);
		// personal goals ("I want to…" mined from their chat) — everyone
		const goals = await getOpenGoals(session.user.id);
		return json({ digests: out.slice(-40), actionItems, goals });
	}

	const auth = request.headers.get('authorization');
	if (env.CRON_SECRET && auth !== `Bearer ${env.CRON_SECRET}`) error(401, 'Unauthorized');
	const result = await runDailyDigests({});
	return json(result);
}

// POST — instructor "send now" (the test path + manual runs).
//   { userId?: string }  → digest just that user (defaults to the caller),
//                          bypassing the master switch so it's testable
//                          before turning the cron loose.
//   { reset: true }      → first-time-experience test: wipe the CALLER'S
//                          Gemma footprint (conversation, goals, change
//                          state) then send a fresh digest.
//   { all: true }        → run the full opted-in batch immediately.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	if (session.user.role !== 'instructor') error(403, 'Instructors only');
	const body = await request.json().catch(() => ({}));
	if (body.reset === true) {
		await resetGemmaForUser(session.user.id);
		const result = await runDailyDigests({ onlyUserId: session.user.id });
		return json({ ...result, reset: true });
	}
	const result = body.all
		? await runDailyDigests({})
		: await runDailyDigests({ onlyUserId: body.userId || session.user.id });
	return json(result);
}
