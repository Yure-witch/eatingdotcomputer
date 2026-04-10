// Firebase push ID character set — 64 chars, index = value
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

/**
 * Decode the millisecond timestamp encoded in the first 8 chars of a Firebase push ID.
 * Firebase encodes the timestamp big-endian (index 0 = most significant digit).
 */
export function pushIdToTimestamp(pushId) {
	let ts = 0;
	for (let i = 0; i < 8; i++) {
		ts = ts * 64 + PUSH_CHARS.indexOf(pushId[i]);
	}
	return ts;
}

/**
 * Build a userId → { name, role } lookup map from layout data.
 * Includes the current user so their own messages resolve correctly.
 */
export function buildUserMap(currentUser, users) {
	const map = {};
	map[currentUser.id] = { name: currentUser.name, role: currentUser.role };
	for (const u of users) map[u.id] = { name: u.name, role: u.role };
	return map;
}

/**
 * Normalise a raw Firebase message snapshot into a consistent shape.
 * Handles both the compact format { u, c } and the legacy format { userId, content, … }.
 */
export function normaliseMessage(id, raw, userMap) {
	const isCompact = 'u' in raw;
	const userId   = isCompact ? raw.u : (raw.userId ?? '');
	const content  = isCompact ? raw.c : (raw.content ?? '');
	const ts       = isCompact ? pushIdToTimestamp(id) : (raw.createdAt ?? pushIdToTimestamp(id));
	const user     = userMap[userId];

	let replyTo = null;
	if (raw.rt) {
		const replyUser = userMap[raw.rt.u];
		replyTo = { id: raw.rt.id, userId: raw.rt.u, userName: replyUser?.name ?? 'Unknown', content: raw.rt.c ?? '' };
	}

	let attachment = null;
	if (raw.att?.url) {
		attachment = { url: raw.att.url, filename: raw.att.name ?? '', mimetype: raw.att.type ?? '', size: raw.att.size ?? 0 };
	}

	return {
		id,
		userId,
		userName: user?.name ?? raw.userName ?? 'Unknown',
		userRole: user?.role ?? raw.userRole ?? 'student',
		content,
		createdAt: ts,
		replyTo,
		attachment,
		edited: !!(raw.ed),
		fx: raw.fx ?? null,
		fontSize: raw.fs ?? 1,
		fontWeight: raw.fw ?? 400,
		fontStretch: raw.wdth ?? 100,
		noSplit: !!(raw.nsp)
	};
}

export function formatTime(ts) {
	const d = new Date(ts), now = new Date();
	const isToday = d.toDateString() === now.toDateString();
	return isToday
		? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
		: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
		  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
