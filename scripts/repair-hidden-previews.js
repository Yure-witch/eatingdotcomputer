// Rewrite channel previews that a shadowbanned member left behind.
//
// `channels/{id}` and `channelMeta/{id}` hold ONE shared "Name: message" line
// per channel — the text under each channel in the sidebar and on the mobile
// chat menu. /api/chat no longer writes it for a hidden sender, but any
// preview written BEFORE someone was hidden (or before that guard existed)
// stays on screen for the whole class, naming them and quoting a message
// nobody can open.
//
// This walks each channel's recent messages back to the newest one from a
// visible sender and rewrites the preview from that. Run it after hiding
// someone, or after changing who is hidden.
//
//   node scripts/repair-hidden-previews.js [--dry]
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { createClient } from '@libsql/client';
import { config } from 'dotenv';

config({ path: '.env' });
const DRY = process.argv.includes('--dry');

// How far back to look for a visible message. A channel where the last 300
// messages are all from hidden members is not a real case; if it happens the
// preview is cleared rather than left wrong.
const SCAN = 300;

initializeApp({
	credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
	databaseURL: process.env.FIREBASE_DATABASE_URL
});
const rtdb = getDatabase();
const db = createClient({
	url: process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});

const users = (await db.execute('SELECT id, name, email, shadowbanned FROM users')).rows;
const hiddenIds = new Set(users.filter((u) => Number(u.shadowbanned) === 1).map((u) => String(u.id)));
const nameById = new Map(users.map((u) => [String(u.id), String(u.name || u.email || '')]));
console.log(`hidden: ${[...hiddenIds].map((id) => nameById.get(id)).join(', ') || '(none)'}`);

// Same shaping /api/chat uses, so a repaired preview is indistinguishable from
// one written normally.
function previewOf(m) {
	if (m?.att?.filename) return `📎 ${m.att.filename}`;
	const plain = String(m?.c ?? '')
		.replace(/\[lk:([A-Za-z0-9_-]+)\]/g, '🔗')
		.replace(/[\u{E100}-\u{E1FF}]/gu, '')
		.trim();
	return plain.slice(0, 60) || '✨';
}

// Firebase push IDs sort lexicographically by time, so the last key is the
// newest message without needing to decode any timestamps.
const channels = await rtdb.ref('channels').get();
if (!channels.exists()) {
	console.log('no channels');
	process.exit(0);
}

let fixed = 0;
for (const [id, node] of Object.entries(channels.val())) {
	const lastUser = node?.lastUser ? String(node.lastUser) : '';
	const staleFor = [...hiddenIds].find((uid) => nameById.get(uid) === lastUser);
	if (!staleFor) {
		console.log(`  ${id}: preview is "${lastUser}" — fine`);
		continue;
	}

	// Look in RTDB first — that's where the live tail lives. But /api/chat/sync
	// archives anything older than 24h into Turso and REMOVES it from RTDB, so
	// a quiet channel can have an empty messages node and a meta line that is
	// months old. Fall back to the archive rather than blanking the preview.
	const snap = await rtdb.ref(`channels/${id}/messages`).limitToLast(SCAN).get();
	const entries = snap.exists() ? Object.entries(snap.val()) : [];
	entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	let replacement = null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const [, m] = entries[i];
		const uid = String(m?.u ?? m?.userId ?? '');
		if (!uid || hiddenIds.has(uid)) continue;
		replacement = { lastMessage: previewOf(m), lastUser: nameById.get(uid) ?? '' };
		break;
	}

	if (!replacement) {
		const archived = await db.execute({
			sql: `SELECT user_id, user_name, content, attachment_filename
			      FROM chat_messages
			      WHERE conversation_id = ?
			      ORDER BY created_at DESC
			      LIMIT ?`,
			args: [id, SCAN]
		});
		for (const row of archived.rows) {
			const uid = String(row.user_id ?? '');
			if (!uid || hiddenIds.has(uid)) continue;
			replacement = {
				lastMessage: previewOf({ c: row.content, att: row.attachment_filename ? { filename: String(row.attachment_filename) } : null }),
				lastUser: nameById.get(uid) ?? String(row.user_name ?? '')
			};
			break;
		}
	}
	// Nothing visible in the whole window: clear it. "No messages yet" is wrong
	// but harmless; naming a hidden member is not.
	if (!replacement) replacement = { lastMessage: '', lastUser: '' };

	console.log(
		`  ${id}: "${lastUser}" -> "${replacement.lastUser}" ${JSON.stringify(replacement.lastMessage.slice(0, 40))}`
	);
	if (!DRY) {
		// lastAt is deliberately untouched: it drives unread dots, and moving it
		// backwards would mark read channels unread for everyone.
		await rtdb.ref(`channels/${id}`).update(replacement);
		await rtdb.ref(`channelMeta/${id}`).update(replacement);
	}
	fixed++;
}

console.log(DRY ? `\n${fixed} channel(s) would be rewritten (dry run)` : `\n${fixed} channel(s) rewritten`);
process.exit(0);
