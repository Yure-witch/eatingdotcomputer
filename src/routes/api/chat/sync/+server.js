import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { decodeReactionKey } from '$lib/reaction-key.js';
import { sweepR2Prefix } from '$lib/server/r2.js';
import { env } from '$env/dynamic/private';

// Decode millisecond timestamp from the first 8 chars of a Firebase push ID
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
function pushIdToTimestamp(id) {
	let ts = 0;
	for (let i = 0; i < 8; i++) ts = ts * 64 + PUSH_CHARS.indexOf(id[i]);
	return ts;
}

export async function GET({ request }) {
	const auth = request.headers.get('authorization');
	if (env.CRON_SECRET && auth !== `Bearer ${env.CRON_SECRET}`) error(401, 'Unauthorized');

	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	const adminDb = getAdminDb();
	const turso = getDb();
	if (!turso) error(503, 'Database unavailable');

	// Build userId → { name, role } map from Turso for compact message resolution
	const usersResult = await turso.execute('SELECT id, name, role FROM users');
	const userMap = {};
	for (const r of usersResult.rows) userMap[String(r.id)] = { name: String(r.name), role: String(r.role) };

	// Rows that can't be archived, so one of them can't take the whole run down
	// with it (see `skip` below). Reported in the response.
	const skipped = [];
	const knownUser = (id) => !!id && !!userMap[String(id)];

	/**
	 * Archive one row. A single unarchivable row used to throw out of the whole
	 * endpoint: the nightly cron 500'd, nothing after that point ran, and — the
	 * part that made it permanent — the Firebase cleanup never ran either, so
	 * the same row broke it again the next night, and the next. It did exactly
	 * that every night from 2026-08-23 on, over two `reaction` notifications
	 * whose sender had since been deleted (notifications.from_uid REFERENCES
	 * users(id)). Now a bad row is counted and stepped over.
	 */
	async function archiveRow(what, stmt) {
		try {
			await turso.execute(stmt);
			return 1;
		} catch (err) {
			skipped.push({ what, reason: String(err?.message ?? err).slice(0, 120) });
			return 0;
		}
	}

	let archived = 0;

	async function archiveMessages(rtdbPath, conversationId) {
		const reactionsBasePath = rtdbPath.replace('/messages', '/reactions');

		const snap = await adminDb.ref(rtdbPath).get();
		if (!snap.exists()) return;

		const toArchive = [];
		snap.forEach((child) => {
			const ts = pushIdToTimestamp(child.key);
			if (ts <= cutoff) toArchive.push({ key: child.key, ts, ...child.val() });
		});
		if (!toArchive.length) return;

		// Ensure the conversation exists in Turso for DMs
		await turso.execute({
			sql: "INSERT OR IGNORE INTO conversations (id, type) VALUES (?, 'dm')",
			args: [conversationId]
		});

		const reactionUpdates = {};
		for (const msg of toArchive) {
			// Support both compact { u, c } and legacy { userId, userName, userRole, content } formats
			const isCompact = 'u' in msg;
			const userId = isCompact ? msg.u : (msg.userId ?? '');
			const content = isCompact ? msg.c : (msg.content ?? '');
			const userName = userMap[userId]?.name ?? msg.userName ?? 'Unknown';
			const userRole = userMap[userId]?.role ?? msg.userRole ?? 'student';
			const replyToId   = msg.rt?.id ?? null;
			const attUrl      = msg.att?.url  ?? null;
			const attFilename = msg.att?.name ?? null;
			const attMimetype = msg.att?.type ?? null;
			const attSize     = msg.att?.size ?? null;
			const fx          = msg.fx ?? null;
			const fontSize    = msg.fs != null && Math.abs(msg.fs - 1) > 0.01 ? parseFloat(Number(msg.fs).toFixed(3)) : null;
			const fontWeight  = msg.fw != null && Math.abs(msg.fw - 400) > 1 ? parseInt(msg.fw) : null;
			const fontStretch = msg.wdth != null && Math.abs(msg.wdth - 100) > 0.5 ? parseFloat(msg.wdth) : null;
			const noSplit     = msg.nsp ? 1 : 0;
			const tgFx        = msg.tfx ? 1 : 0;
			// Mentions: archive the compact `mn` array as JSON. Stored
			// in the new chat_messages.mentions column. Page-load
			// queries can JSON.parse it back to render pills on
			// historical messages.
			const mentionsJson = Array.isArray(msg.mn) && msg.mn.length
				? JSON.stringify(msg.mn.map((m) => ({ uid: m.u, offset: m.o, len: m.l })))
				: null;
			await archiveRow(`message ${msg.key}`, {
				sql: `INSERT OR IGNORE INTO chat_messages
				      (id, conversation_id, user_id, user_name, user_role, content, created_at, reply_to_id,
				       attachment_url, attachment_filename, attachment_mimetype, attachment_size,
				       fx, font_size, font_weight, font_stretch, no_split, mentions, tg_fx)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [msg.key, conversationId, userId, userName, userRole, content, new Date(msg.ts).toISOString(), replyToId,
				       attUrl, attFilename, attMimetype, attSize,
				       fx, fontSize, fontWeight, fontStretch, noSplit, mentionsJson, tgFx]
			});

			// Archive reactions for this message → message_reactions table
			const reactSnap = await adminDb.ref(`${reactionsBasePath}/${msg.key}`).get();
			if (reactSnap.exists()) {
				for (const [emojiKey, users] of Object.entries(reactSnap.val())) {
					// Firebase keys are escaped; Turso stores the raw token.
					const emoji = decodeReactionKey(emojiKey);
					for (const reactUserId of Object.keys(users)) {
						// message_reactions.user_id REFERENCES users(id): a reaction
						// left by someone since deleted can't be stored, and it is
						// not worth failing the run over.
						if (!knownUser(reactUserId)) { skipped.push({ what: `reaction ${msg.key}`, reason: 'user deleted' }); continue; }
						await archiveRow(`reaction ${msg.key}`, {
							sql: 'INSERT OR IGNORE INTO message_reactions (message_id, emoji, user_id) VALUES (?, ?, ?)',
							args: [msg.key, emoji, reactUserId]
						});
					}
				}
				reactionUpdates[msg.key] = null; // schedule Firebase cleanup
			}
		}

		// Delete archived messages from Firebase
		const updates = {};
		for (const msg of toArchive) updates[msg.key] = null;
		await adminDb.ref(rtdbPath).update(updates);

		// Delete archived reactions from Firebase
		if (Object.keys(reactionUpdates).length) {
			await adminDb.ref(reactionsBasePath).update(reactionUpdates);
		}

		archived += toArchive.length;

		// Sweep orphaned reactions: Firebase reaction nodes for messages that are already
		// archived in Turso (e.g. written back by the react API for old messages).
		// Sync any new reactions to Turso then remove them from Firebase.
		const rxSnap = await adminDb.ref(reactionsBasePath).get();
		if (rxSnap.exists()) {
			const orphanCleanup = {};
			for (const [msgId, emojiMap] of Object.entries(rxSnap.val())) {
				// Already handled above (was in toArchive)
				if (reactionUpdates[msgId] !== undefined) continue;
				// Check if this message is already archived in Turso
				const inTurso = await turso.execute({
					sql: 'SELECT id FROM chat_messages WHERE id = ?',
					args: [msgId]
				});
				if (inTurso.rows.length === 0) continue; // not in Turso, leave it
				// Sync any reactions not yet in Turso
				for (const [emojiKey, users] of Object.entries(emojiMap)) {
					const emoji = decodeReactionKey(emojiKey);
					for (const reactUserId of Object.keys(users)) {
						if (!knownUser(reactUserId)) { skipped.push({ what: `reaction ${msgId}`, reason: 'user deleted' }); continue; }
						await archiveRow(`reaction ${msgId}`, {
							sql: 'INSERT OR IGNORE INTO message_reactions (message_id, emoji, user_id) VALUES (?, ?, ?)',
							args: [msgId, emoji, reactUserId]
						});
					}
				}
				orphanCleanup[msgId] = null;
			}
			if (Object.keys(orphanCleanup).length) {
				await adminDb.ref(reactionsBasePath).update(orphanCleanup);
			}
		}
	}

	// Archive all channels
	const channelsSnap = await adminDb.ref('channels').get();
	if (channelsSnap.exists()) {
		for (const channelId of Object.keys(channelsSnap.val())) {
			await archiveMessages(`channels/${channelId}/messages`, channelId);
		}
	}

	// Archive all DMs
	const dmsSnap = await adminDb.ref('dms').get();
	if (dmsSnap.exists()) {
		for (const convId of Object.keys(dmsSnap.val())) {
			await archiveMessages(`dms/${convId}/messages`, convId);
		}
	}

	// Archive THREAD replies: threads/{convId}/{parentMsgId}/messages.
	// Same 24h TTL as top-level messages — live replies stay in RTDB for
	// realtime, older ones become durable history in thread_messages.
	// (Thread counts on parent bubbles = Turso count + live count.)
	let archivedThreads = 0;
	const threadsRootSnap = await adminDb.ref('threads').get();
	if (threadsRootSnap.exists()) {
		for (const convId of Object.keys(threadsRootSnap.val())) {
			const convSnap = await adminDb.ref(`threads/${convId}`).get();
			if (!convSnap.exists()) continue;
			for (const parentId of Object.keys(convSnap.val())) {
				const msgsSnap = await adminDb.ref(`threads/${convId}/${parentId}/messages`).get();
				if (!msgsSnap.exists()) continue;
				const toArchive = [];
				msgsSnap.forEach((child) => {
					const ts = pushIdToTimestamp(child.key);
					if (ts <= cutoff) toArchive.push({ key: child.key, ts, ...child.val() });
				});
				if (!toArchive.length) continue;
				for (const msg of toArchive) {
					const isCompact = 'u' in msg;
					const userId = isCompact ? msg.u : (msg.userId ?? '');
					const content = isCompact ? msg.c : (msg.content ?? '');
					const userName = userMap[userId]?.name ?? msg.userName ?? 'Unknown';
					const userRole = userMap[userId]?.role ?? msg.userRole ?? 'student';
					await archiveRow(`thread message ${t.key}`, {
						sql: `INSERT OR IGNORE INTO thread_messages
						      (id, parent_msg_id, conversation_id, user_id, user_name, user_role, content, created_at,
						       attachment_url, attachment_filename, attachment_mimetype, attachment_size)
						      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						args: [msg.key, parentId, convId, userId, userName, userRole, content, new Date(msg.ts).toISOString(),
						       msg.att?.url ?? null, msg.att?.name ?? null, msg.att?.type ?? null, msg.att?.size ?? null]
					});
				}
				const cleanup = {};
				for (const msg of toArchive) cleanup[msg.key] = null;
				await adminDb.ref(`threads/${convId}/${parentId}/messages`).update(cleanup);
				archivedThreads += toArchive.length;
			}
		}
	}

	// Archive notifications. Walk every `notifications/{uid}` node and
	// move entries older than the cutoff into the Turso `notifications`
	// table, then delete them from Firebase. Same TTL semantics as
	// messages — recent stuff stays live in RTDB for the bell, anything
	// older becomes durable history.
	let archivedNotifs = 0;
	const notifsRootSnap = await adminDb.ref('notifications').get();
	if (notifsRootSnap.exists()) {
		for (const uid of Object.keys(notifsRootSnap.val())) {
			const userNotifsSnap = await adminDb.ref(`notifications/${uid}`).get();
			if (!userNotifsSnap.exists()) continue;
			const toArchive = [];
			userNotifsSnap.forEach((child) => {
				const v = child.val();
				const ts = Number(v?.createdAt) || pushIdToTimestamp(child.key);
				if (ts <= cutoff) toArchive.push({ key: child.key, ts, ...v });
			});
			if (!toArchive.length) continue;
			let storedForUser = 0;
			for (const n of toArchive) {
				// Both recipient_id and from_uid REFERENCE users(id), so a
				// notification whose sender or recipient has been deleted — or
				// one with no fromUid at all, which used to be written as the
				// empty string — can never be stored. Step over it, and let the
				// cleanup below still clear it from Firebase so it stops being
				// retried every night forever.
				if (!knownUser(uid) || !knownUser(n.fromUid)) {
					skipped.push({ what: `notification ${n.key}`, reason: !knownUser(uid) ? 'recipient deleted' : 'sender deleted' });
					continue;
				}
				storedForUser += await archiveRow(`notification ${n.key}`, {
					sql: `INSERT OR IGNORE INTO notifications
					      (id, recipient_id, type, from_uid, from_name, conv_type, conv_id, msg_id, snippet, created_at)
					      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					args: [n.key, uid, String(n.type || 'mention'), String(n.fromUid), String(n.fromName || ''),
					       String(n.convType || 'channel'), String(n.convId || ''), String(n.msgId || ''),
					       String(n.snippet || ''), n.ts]
				});
			}
			// Everything old is cleared from Firebase, skipped rows included —
			// that is what stops an unarchivable row being retried forever.
			const cleanup = {};
			for (const n of toArchive) cleanup[n.key] = null;
			await adminDb.ref(`notifications/${uid}`).update(cleanup);
			archivedNotifs += storedForUser;
		}
	}

	// Backstop cleanup of ephemeral GIF Studio renders (also swept on each
	// render + deleted by the client on dismiss/unload — this catches orphans).
	let sweptRenders = 0;
	try { sweptRenders = await sweepR2Prefix('gif-studio/', 30 * 60 * 1000); } catch { /* best-effort */ }

	// `skipped` is the thing to watch: an empty array is a clean run, and a
	// non-empty one names the rows that need looking at rather than failing.
	return json({ archived, archivedThreads, archivedNotifs, sweptRenders, skipped });
}
