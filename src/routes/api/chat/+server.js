import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { getConvId } from '$lib/convId.js';
import { notifyUsers } from '$lib/server/push.js';
import { requireClassAccess } from '$lib/server/access.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);

	const { content, channelId, to, reply_to, attachment } = await request.json();
	if (!content?.trim() && !attachment?.url) error(400, 'Empty message');
	if (content && content.length > 2000) error(400, 'Message too long');

	const db = getAdminDb();
	const senderName = session.user.name || session.user.email;
	const preview = attachment ? `📎 ${attachment.filename}` : content.trim().slice(0, 60);
	const now = Date.now();
	// Compact format: { u, c, rt?, att? } — timestamp derived from push ID
	const msg = { u: session.user.id, c: content?.trim() ?? '' };
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
			db.ref(`userChats/${to}/${convId}`).update({ otherUserId: session.user.id, otherUserName: senderName, lastMessage: preview, lastAt: now })
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
		await db.ref(`channels/${channel}`).update({ lastAt: now, lastMessage: preview, lastUser: senderName });
		// Push notification to all other users with subscriptions
		const turso = getDb();
		if (turso) {
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
