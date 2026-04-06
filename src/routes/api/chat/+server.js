import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { ServerValue } from 'firebase-admin/database';
import { getDb } from '$lib/server/turso.js';
import { getConvId } from '$lib/convId.js';
import { notifyUsers } from '$lib/server/push.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { content, channelId, to, reply_to, attachment, effect, fontSize, noSplit } = await request.json();
	if (!content?.trim() && !attachment?.url) error(400, 'Empty message');
	if (content && content.length > 2000) error(400, 'Message too long');

	const db = getAdminDb();
	const senderName = session.user.name || session.user.email;
	// Strip Unicode PUA effect markers (U+E100–U+E1FF) so notifications show clean plain text
	const plainContent = content ? content.replace(/[\uE100-\uE1FF]/g, '').trim() : '';
	const preview = attachment ? `📎 ${attachment.filename}` : (plainContent.slice(0, 60) || '✨');
	const now = Date.now();
	// Compact format: { u, c, rt?, att?, fx?, fs? } — timestamp derived from push ID
	const msg = { u: session.user.id, c: content?.trim() ?? '' };
	if (effect) msg.fx = effect;
	if (fontSize && Math.abs(fontSize - 1) > 0.01) msg.fs = parseFloat(Number(fontSize).toFixed(3));
	if (noSplit) msg.nsp = 1;
	if (reply_to?.id) {
		msg.rt = { id: reply_to.id, u: reply_to.userId, c: String(reply_to.content ?? '').slice(0, 100) };
	}
	if (attachment?.url) {
		msg.att = { url: attachment.url, name: attachment.filename, type: attachment.mimetype, size: attachment.size };
	}

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

	if (to) {
		// DM
		const convId = getConvId(session.user.id, to);
		await db.ref(`dms/${convId}/messages`).push(msg);
		await Promise.all([
			db.ref(`userChats/${session.user.id}/${convId}`).update({ otherUserId: to, lastMessage: preview, lastAt: now }),
			db.ref(`userChats/${to}/${convId}`).update({ otherUserId: session.user.id, otherUserName: senderName, lastMessage: preview, lastAt: now }),
			db.ref(`unreadCounts/${to}`).update({ [convId]: ServerValue.increment(1) })
		]);
		// Push notification to recipient
		await notifyUsers([to], {
			title: senderName,
			body: preview,
			url: `/app/chat/dm/${convId}`,
			tag: `dm-${convId}`
		});
	} else {
		// Channel
		const channel = channelId ?? 'class';
		await db.ref(`channels/${channel}/messages`).push(msg);
		const meta = { lastAt: now, lastMessage: preview, lastUser: senderName };
		await db.ref(`channels/${channel}`).update(meta);
		// Lightweight metadata node (used by layout for unread dots — no messages payload)
		await db.ref(`channelMeta/${channel}`).update(meta);

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
						if (uid === session.user.id) continue;
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
			const userIds = usersResult.rows.map((r) => String(r.user_id));
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
