import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getConvId } from '$lib/convId.js';

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const { content, channelId, to } = await request.json();
	if (!content?.trim()) error(400, 'Empty message');
	if (content.length > 2000) error(400, 'Message too long');

	const db = getAdminDb();
	// Compact format: { u: userId, c: content } — timestamp derived from push ID
	const msg = { u: session.user.id, c: content.trim() };

	if (to) {
		// DM
		const convId = getConvId(session.user.id, to);
		await db.ref(`dms/${convId}/messages`).push(msg);
		const preview = content.trim().slice(0, 60);
		const now = Date.now();
		const senderName = session.user.name || session.user.email;
		await Promise.all([
			db.ref(`userChats/${session.user.id}/${convId}`).update({ otherUserId: to, lastMessage: preview, lastAt: now }),
			db.ref(`userChats/${to}/${convId}`).update({ otherUserId: session.user.id, otherUserName: senderName, lastMessage: preview, lastAt: now })
		]);
	} else {
		// Channel
		const channel = channelId ?? 'class';
		const now = Date.now();
		const senderName = session.user.name || session.user.email;
		const preview = content.trim().slice(0, 60);
		await db.ref(`channels/${channel}/messages`).push(msg);
		await db.ref(`channels/${channel}`).update({ lastAt: now, lastMessage: preview, lastUser: senderName });
	}

	return json({ ok: true });
}
