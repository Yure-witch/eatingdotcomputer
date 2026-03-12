import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
import { getConvId } from '$lib/convId.js';
import { notifyUsers } from '$lib/server/push.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const { content, channelId, to } = await request.json();
	if (!content?.trim()) error(400, 'Empty message');
	if (content.length > 2000) error(400, 'Message too long');

	const db = getAdminDb();
	const senderName = session.user.name || session.user.email;
	const preview = content.trim().slice(0, 60);
	const now = Date.now();
	// Compact format: { u: userId, c: content } — timestamp derived from push ID
	const msg = { u: session.user.id, c: content.trim() };

	if (to) {
		// DM
		const convId = getConvId(session.user.id, to);
		await db.ref(`dms/${convId}/messages`).push(msg);
		await Promise.all([
			db.ref(`userChats/${session.user.id}/${convId}`).update({ otherUserId: to, lastMessage: preview, lastAt: now }),
			db.ref(`userChats/${to}/${convId}`).update({ otherUserId: session.user.id, otherUserName: senderName, lastMessage: preview, lastAt: now })
		]);
		// Push notification to recipient
		notifyUsers([to], {
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
			notifyUsers(userIds, {
				title: `#${channel}`,
				body: `${senderName}: ${preview}`,
				url: `/app/chat/channel/${channel}`,
				tag: `channel-${channel}`
			});
		}
	}

	return json({ ok: true });
}
