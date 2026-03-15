import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { getDb } from '$lib/server/turso.js';
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
			const replyToId = msg.rt?.id ?? null;
			const attUrl      = msg.att?.url  ?? null;
			const attFilename = msg.att?.name ?? null;
			const attMimetype = msg.att?.type ?? null;
			const attSize     = msg.att?.size ?? null;
			await turso.execute({
				sql: `INSERT OR IGNORE INTO chat_messages
				      (id, conversation_id, user_id, user_name, user_role, content, created_at, reply_to_id,
				       attachment_url, attachment_filename, attachment_mimetype, attachment_size)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [msg.key, conversationId, userId, userName, userRole, content, new Date(msg.ts).toISOString(), replyToId,
				       attUrl, attFilename, attMimetype, attSize]
			});

			// Archive reactions for this message → message_reactions table
			const reactSnap = await adminDb.ref(`${reactionsBasePath}/${msg.key}`).get();
			if (reactSnap.exists()) {
				for (const [emoji, users] of Object.entries(reactSnap.val())) {
					for (const reactUserId of Object.keys(users)) {
						await turso.execute({
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

	return json({ archived });
}
