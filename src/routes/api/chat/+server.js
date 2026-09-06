import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { ServerValue } from 'firebase-admin/database';
import { getDb } from '$lib/server/turso.js';
import { getConvId } from '$lib/convId.js';
import { notifyUsers } from '$lib/server/push.js';
import { requireClassAccess } from '$lib/server/access.js';
import { mentionedUids } from '$lib/mentions.js';
import { decodeLinkToken } from '$lib/message-render.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { content, channelId, to, reply_to, attachment, effect, fontSize, fontWeight, fontStretch, noSplit, wiggleSize, mentions, tgFx } = await request.json();
	if (!content?.trim() && !attachment?.url) error(400, 'Empty message');
	if (content && content.length > 20000) error(400, 'Message too long (max 20,000 characters)');

	const db = getAdminDb();
	const senderName = session.user.name || session.user.email;
	// Strip Unicode PUA effect markers (U+E100–U+E1FF) so notifications show clean plain text
	const plainContent = content
		? content
			.replace(/\[lk:([A-Za-z0-9_-]+)\]/g, (_, b) => { const d = decodeLinkToken(b); return d ? `🔗 ${d.title || d.url}` : ''; })
			.replace(/[-]/g, '')
			.trim()
		: '';
	const preview = attachment ? `📎 ${attachment.filename}` : (plainContent.slice(0, 60) || '✨');
	const now = Date.now();
	// Compact format: { u, c, rt?, att?, fx?, fs? } — timestamp derived from push ID
	const msg = { u: session.user.id, c: content?.trim() ?? '' };
	if (effect) msg.fx = effect;
	if (fontSize && Math.abs(fontSize - 1) > 0.01) msg.fs = parseFloat(Number(fontSize).toFixed(3));
	if (fontWeight && Math.abs(fontWeight - 400) > 1) msg.fw = parseInt(fontWeight);
	if (fontStretch && Math.abs(fontStretch - 100) > 0.5) msg.wdth = parseInt(fontStretch);
	if (noSplit) msg.nsp = 1;
	if (wiggleSize && Math.abs(wiggleSize - 6) > 0.5) msg.ws = parseInt(wiggleSize);
	// Telegram special-effect opt-in — only meaningful on jumbo (emoji-only)
	// messages with an av>0 [tg:] emote; the client only sends it then.
	if (tgFx) msg.tfx = 1;
	if (reply_to?.id) {
		msg.rt = { id: reply_to.id, u: reply_to.userId, c: String(reply_to.content ?? '').slice(0, 100) };
	}
	if (attachment?.url) {
		msg.att = { url: attachment.url, name: attachment.filename, type: attachment.mimetype, size: attachment.size };
	}
	// Mentions: compact list of `{ u, o, l }` (uid/offset/len) so the
	// bubble renderer can wrap the right slices of `c` as pills + the
	// notification fan-out below knows who to ping.
	const mentionList = Array.isArray(mentions)
		? mentions
			.filter((m) => m && typeof m.uid === 'string' && typeof m.offset === 'number' && typeof m.len === 'number')
			.map((m) => ({ u: m.uid, o: m.offset, l: m.len }))
		: [];
	if (mentionList.length) msg.mn = mentionList;


	// Confirm the uploaded file so it isn't swept by the stale-upload cleanup
	if (attachment?.id) {
		const turso = getDb();
		if (turso) {
			turso.execute({
				sql: 'UPDATE uploaded_files SET confirmed = 1 WHERE id = ? AND uploaded_by_id = ?',
				args: [attachment.id, session.user.id]
			}).catch(() => {});
		}
	}

	// Everyone who has BLOCKED the sender: the message must not surface for
	// them — no unread ticks, no notification rows, no push. (Their client
	// also hides it at render; this keeps the server-side signals consistent.)
	// Best-effort: if the query fails, notifications go out as before.
	let blockersOfSender = new Set();
	// A shadowbanned sender reaches nobody: no unread ticks, no notification
	// rows, no push. `senderHidden` short-circuits every fan-out below rather
	// than filtering recipient by recipient, because the answer is the same
	// for all of them. Their own client still shows the message sending
	// normally — that is the point.
	let senderHidden = false;
	{
		const turso = getDb();
		if (turso) {
			try {
				const r = await turso.execute({
					sql: 'SELECT blocker_id FROM blocked_users WHERE blocked_id = ?',
					args: [session.user.id]
				});
				blockersOfSender = new Set(r.rows.map((row) => String(row.blocker_id)));
			} catch { /* unfiltered fan-out */ }
			try {
				const me = await turso.execute({
					sql: 'SELECT shadowbanned FROM users WHERE id = ?',
					args: [session.user.id]
				});
				senderHidden = Number(me.rows[0]?.shadowbanned ?? 0) === 1;
			} catch { /* treat as not hidden */ }
		}
	}

	// Notification fan-out. Mentions and replies both write a Firebase
	// `notifications/{uid}/{notifId}` entry (archived to Turso later by
	// /api/chat/sync, same pattern as messages + reactions). We dedupe
	// recipients so a reply that also @mentions the original author
	// doesn't double-notify.
	async function fanOutNotifs(convType, convId, msgId) {
		if (senderHidden) return; // shadowbanned: no mention or reply notifications
		const recipients = new Map(); // uid -> type ('mention' wins over 'reply')
		for (const uid of mentionedUids(mentionList.map((m) => ({ uid: m.u })))) {
			if (uid && uid !== session.user.id && !blockersOfSender.has(uid)) recipients.set(uid, 'mention');
		}
		if (reply_to?.userId && reply_to.userId !== session.user.id && !recipients.has(reply_to.userId) && !blockersOfSender.has(reply_to.userId)) {
			recipients.set(reply_to.userId, 'reply');
		}
		if (!recipients.size) return;
		const snippet = preview;
		const updates = {};
		for (const [uid, type] of recipients) {
			const notifId = db.ref(`notifications/${uid}`).push().key;
			updates[`notifications/${uid}/${notifId}`] = {
				type,
				fromUid: session.user.id,
				fromName: senderName,
				convType,
				convId,
				msgId,
				snippet,
				createdAt: now
			};
		}
		await db.ref().update(updates);
	}

	if (to) {
		// DM
		const convId = getConvId(session.user.id, to);
		const msgRef = await db.ref(`dms/${convId}/messages`).push(msg);
		await fanOutNotifs('dm', convId, msgRef.key);
		// A recipient who blocked the sender gets NONE of the surfacing: no
		// chat-list bump, no unread tick, no push. The message itself still
		// lands in the conversation node, so unblocking restores the history.
		const recipientBlocked = senderHidden || blockersOfSender.has(to);
		await Promise.all([
			db.ref(`userChats/${session.user.id}/${convId}`).update({ otherUserId: to, lastMessage: preview, lastAt: now }),
			...(recipientBlocked ? [] : [
				db.ref(`userChats/${to}/${convId}`).update({ otherUserId: session.user.id, otherUserName: senderName, lastMessage: preview, lastAt: now }),
				db.ref(`unreadCounts/${to}`).update({ [convId]: ServerValue.increment(1) })
			])
		]);
		// Push notification to recipient
		if (!recipientBlocked) {
			await notifyUsers([to], {
				title: senderName,
				body: preview,
				url: `/app/chat/dm/${convId}`,
				tag: `dm-${convId}`
			});
		}
	} else {
		// Channel
		const channel = channelId ?? 'class';
		const msgRef = await db.ref(`channels/${channel}/messages`).push(msg);
		await fanOutNotifs('channel', channel, msgRef.key);
		// Channel preview — the "Name: message" line under each channel in the
		// sidebar and on the mobile chat menu. A shadowbanned sender must not
		// write it: this node is shared by everyone, so their name and the text
		// of a message nobody can open were being shown to the whole class in
		// the one place the message filters don't reach.
		//
		// The cost is that their OWN sidebar preview stops advancing on their
		// own messages. That is a far smaller tell than the alternative, and
		// per-viewer previews would mean a node per member per channel.
		if (!senderHidden) {
			const meta = { lastAt: now, lastMessage: preview, lastUser: senderName };
			await db.ref(`channels/${channel}`).update(meta);
			// Lightweight metadata node (used by layout for unread dots — no messages payload)
			await db.ref(`channelMeta/${channel}`).update(meta);
		}

		const turso = getDb();
		if (turso) {
			// Increment unread counts for all class members (best-effort, never blocks push)
			try {
				const convResult = await turso.execute({
					sql: "SELECT class_id FROM conversations WHERE id = ? AND type = 'channel'",
					args: [channel]
				});
				const classId = convResult.rows[0]?.class_id;
				if (classId) {
					const membersResult = await turso.execute({
						sql: `SELECT DISTINCT u.id FROM users u
						      WHERE u.role = 'instructor'
						         OR EXISTS (
						              SELECT 1 FROM class_memberships cm
						              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
						            )`,
						args: [String(classId)]
					});
					const unreadUpdates = {};
					for (const r of membersResult.rows) {
						const uid = String(r.id);
						if (uid === session.user.id || senderHidden || blockersOfSender.has(uid)) continue;
						unreadUpdates[`unreadCounts/${uid}/${channel}`] = ServerValue.increment(1);
					}
					if (Object.keys(unreadUpdates).length > 0) {
						await db.ref().update(unreadUpdates);
					}
				}
			} catch { /* unread counts are best-effort */ }

			// Push notification to all other users with subscriptions
			const usersResult = await turso.execute({
				sql: 'SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id != ?',
				args: [session.user.id]
			});
			const userIds = senderHidden ? [] : usersResult.rows.map((r) => String(r.user_id)).filter((uid) => !blockersOfSender.has(uid));
			await notifyUsers(userIds, {
				title: `New message in #${channel}`,
				body: `${senderName}: ${preview}`,
				url: `/app/chat/channel/${channel}`,
				tag: `channel-${channel}`
			});
		}
	}

	return json({ ok: true });
}
