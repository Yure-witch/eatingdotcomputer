// Build the App Store review class: a class only the review accounts (and the
// instructor, who owns everything) belong to, populated with a written-for-the-
// purpose conversation that exercises the expressive features — inline sizing,
// colours, animated text effects, lists, code, replies and emoji reactions —
// plus week plans, assignments and a syllabus so Home / Roadmap / Weeks aren't
// empty.
//
//   node scripts/seed-review-class.js
//
// Why this exists: the real class channel carries live development traffic
// (perf dumps, 192.168.x.x probe links). Those landed straight in the listing
// screenshots. The reviewer gets a clean room instead.
//
// Idempotent. The chat is REBUILT each run: message push IDs encode their own
// creation time, so keeping the conversation looking recent means new IDs, and
// the channel's live node is cleared first rather than accumulating copies.
// Nothing outside `idc-review` is touched, except for removing the two review
// accounts from the real class so they land here.
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { readableToUnicode } from '../src/lib/message-render.js';
import { encodeReactionKey } from '../src/lib/reaction-key.js';

config({ path: '.env' });

const CLASS_ID = 'idc-review';
// The channel page titles itself from the conversation ID, not the `name`
// column (src/routes/app/chat/channel/[channelId]/+page.svelte publishes
// '# ' + data.channelId), so the ID has to be the name we want on screen.
// 'class' itself is taken by the real class's channel.
const CHANNEL_ID = 'studio';
const INSTRUCTOR_ID = 'a384bd72-3285-4eaa-9553-08da759adfb7';

const db = createClient({
	url: process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});

// ── Firebase admin (same service account the app uses) ────────────────────────
const { default: admin } = await import('firebase-admin');
const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
if (!admin.apps.length) {
	admin.initializeApp({
		credential: admin.credential.cert(svc),
		databaseURL: process.env.FIREBASE_DATABASE_URL
	});
}
const rtdb = admin.database();

// ── Firebase push IDs at a chosen time ───────────────────────────────────────
// The first 8 chars are the millisecond timestamp base-64'd big-endian; the
// remaining 12 are random. Deterministic "randomness" (seeded off the message
// index) keeps a re-run with the same clock from scattering duplicates.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
function pushIdAt(ms, seed) {
	let t = ms;
	const chars = new Array(8);
	for (let i = 7; i >= 0; i--) {
		chars[i] = PUSH_CHARS[t % 64];
		t = Math.floor(t / 64);
	}
	let id = chars.join('');
	// xorshift-ish walk so consecutive seeds don't produce adjacent-looking ids
	let x = (seed + 1) * 2654435761 % 4294967296;
	for (let i = 0; i < 12; i++) {
		x = (x ^ (x << 13)) >>> 0;
		x = (x ^ (x >>> 17)) >>> 0;
		x = (x ^ (x << 5)) >>> 0;
		id += PUSH_CHARS[x % 64];
	}
	return id;
}

// ── Demo classmates ──────────────────────────────────────────────────────────
// Invented people. They never sign in — there is no password hash on these
// rows — they exist so the channel reads like a room with other students in it.
const STUDENTS = [
	{ key: 'maya',  name: 'Maya Okonkwo',   year: 'Sophomore' },
	{ key: 'devin', name: 'Devin Park',     year: 'Junior' },
	{ key: 'sofia', name: 'Sofía Ruiz',     year: 'Sophomore' },
	{ key: 'theo',  name: 'Theo Lindqvist', year: 'Senior' }
];

const uuid = () => crypto.randomUUID();

async function upsertStudent(s) {
	const email = `${s.key}@demo.eating.computer`;
	const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
	if (existing.rows[0]) return String(existing.rows[0].id);
	const id = uuid();
	await db.execute({
		sql: `INSERT INTO users (id, email, username, name, role, onboarding_step, year, hide_tg_emoji, emoji_font, gemma_digest, gemma_scan_dms)
		      VALUES (?, ?, ?, ?, 'student', 'complete', ?, 1, 'system', 1, 1)`,
		args: [id, email, s.key, s.name, s.year]
	});
	return id;
}

async function approve(userId) {
	await db.execute({
		sql: `INSERT OR IGNORE INTO class_memberships (id, class_id, user_id, status, reviewed_at, reviewed_by)
		      VALUES (?, ?, ?, 'approved', datetime('now'), ?)`,
		args: [uuid(), CLASS_ID, userId, INSTRUCTOR_ID]
	});
	await db.execute({
		sql: `UPDATE class_memberships SET status = 'approved' WHERE class_id = ? AND user_id = ?`,
		args: [CLASS_ID, userId]
	});
}

// ── 1. Class + channel ───────────────────────────────────────────────────────
// Named exactly like the real class: the reviewer should see a plausible studio
// course, not something captioned "demo". The term is what tells them apart in
// the owner's class switcher.
await db.execute({
	sql: `INSERT OR IGNORE INTO classes (id, name, term, description)
	      VALUES (?, 'Interactive Design Concepts', 'Fall 2026',
	              'App Store review class — self-contained demo content.')`,
	args: [CLASS_ID]
});
await db.execute({
	sql: `INSERT OR IGNORE INTO conversations (id, type, name, created_by, class_id)
	      VALUES (?, 'channel', 'class', ?, ?)`,
	args: [CHANNEL_ID, INSTRUCTOR_ID, CLASS_ID]
});
console.log('class + channel ready');

// ── 2. People ────────────────────────────────────────────────────────────────
const ids = {};
for (const s of STUDENTS) {
	ids[s.key] = await upsertStudent(s);
	await approve(ids[s.key]);
}
ids.ricky = INSTRUCTOR_ID;
await approve(INSTRUCTOR_ID);

const reviewers = await db.execute(
	"SELECT id, username FROM users WHERE email LIKE '%@review.eating.computer'"
);
for (const r of reviewers.rows) {
	await approve(String(r.id));
	// Out of the real class, so the reviewer opens straight into the clean one
	// instead of the channel carrying development traffic.
	await db.execute({
		sql: `DELETE FROM class_memberships WHERE user_id = ? AND class_id <> ?`,
		args: [String(r.id), CLASS_ID]
	});
}
console.log(`members: ${STUDENTS.length} demo students + instructor + ${reviewers.rows.length} review accounts`);

// ── 3. Week plans, assignments, syllabus ─────────────────────────────────────
const WEEKS = [
	{ week: 1, headline: 'Signals & noise',    preview: 'What makes an interface feel alive. Reading + first sketches.', due: '2026-07-31', important: 0 },
	{ week: 2, headline: 'Type in motion',     preview: 'Kinetic typography — timing, easing, and why most of it is rhythm.', due: '2026-08-07', important: 0 },
	{ week: 3, headline: 'Colour as behaviour', preview: 'Palettes that respond. Building a theme that reacts to its own content.', due: '2026-08-14', important: 0 },
	{ week: 4, headline: 'Make it move',       preview: 'Studio week. Bring something that moves and we take it apart together.', due: '2026-08-28', important: 1 }
];
for (const w of WEEKS) {
	await db.execute({
		sql: `INSERT OR IGNORE INTO week_plans (id, week, headline, topic_preview, due_date, important, class_id, created_by)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [`${CLASS_ID}-w${w.week}`, w.week, w.headline, w.preview, w.due, w.important, CLASS_ID, INSTRUCTOR_ID]
	});
	await db.execute({
		sql: `UPDATE week_plans SET headline = ?, topic_preview = ?, due_date = ?, important = ? WHERE id = ?`,
		args: [w.headline, w.preview, w.due, w.important, `${CLASS_ID}-w${w.week}`]
	});
}

const ASSIGNMENTS = [
	{ week: 2, title: 'Type study', description: 'Pick one word. Make it move three different ways. Ten seconds each, no sound.', due: '2026-08-07', types: '["link","video"]' },
	{ week: 3, title: 'Responsive palette', description: 'Build a colour system that changes with its content. Show it in at least two states.', due: '2026-08-14', types: '["link","image"]' },
	{ week: 4, title: 'Something that moves', description: 'Anything, any medium — it just has to move and you have to be able to say why.', due: '2026-08-28', types: '["link","image","video"]' }
];
for (const a of ASSIGNMENTS) {
	await db.execute({
		sql: `INSERT OR IGNORE INTO assignments (id, week, title, description, due_date, accepted_types, class_id, created_by)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [`${CLASS_ID}-a${a.week}`, a.week, a.title, a.description, a.due, a.types, CLASS_ID, INSTRUCTOR_ID]
	});
	await db.execute({
		sql: `UPDATE assignments SET title = ?, description = ?, due_date = ?, accepted_types = ? WHERE id = ?`,
		args: [a.title, a.description, a.due, a.types, `${CLASS_ID}-a${a.week}`]
	});
}

const SYLLABUS = [
	{ type: 'heading', content: 'Interactive Design Concepts', pos: 1 },
	{ type: 'text', content: 'A studio course about the things interfaces do when you are not looking at them. We build small, we build often, and we take each other’s work apart with care.', pos: 2 },
	{ type: 'heading', content: 'How this runs', pos: 3 },
	{ type: 'text', content: 'We meet twice a week. Mondays are new material, Thursdays are studio — you work, I circulate. Everything is due Friday at midnight, and late is fine if you tell me first.', pos: 4 },
	{ type: 'heading', content: 'What you need', pos: 5 },
	{ type: 'text', content: 'A sketchbook you are willing to ruin, a laptop, and a tolerance for showing work before it is finished.', pos: 6 }
];
for (const b of SYLLABUS) {
	await db.execute({
		sql: `INSERT OR IGNORE INTO syllabus_blocks (id, class_id, type, content, position, hidden)
		      VALUES (?, ?, ?, ?, ?, 0)`,
		args: [`${CLASS_ID}-s${b.pos}`, CLASS_ID, b.type, b.content, b.pos]
	});
	await db.execute({
		sql: `UPDATE syllabus_blocks SET type = ?, content = ?, position = ? WHERE id = ?`,
		args: [b.type, b.content, b.pos, `${CLASS_ID}-s${b.pos}`]
	});
}
console.log(`content: ${WEEKS.length} weeks, ${ASSIGNMENTS.length} assignments, ${SYLLABUS.length} syllabus blocks`);

// ── 4. The conversation ──────────────────────────────────────────────────────
// `m` is minutes ago. Markup is written readable ([sz:200], [color-pink],
// [wave]…) and encoded to the PUA wire format on the way out, exactly like a
// message typed in the composer.
const SCRIPT = [
	// Ordered so the expressive messages are the most RECENT ones: chat opens
	// pinned to the bottom, so that is the only part a screenshot ever sees.
	{ m: 214, who: 'ricky', c: '[sz:200][color-pink]Week 4[/color-pink][/sz]\nStudio week. Bring something that moves — any medium, any state of finished.' },
	{ m: 209, who: 'maya',  c: 'finally 😭 I have been sitting on this one for two weeks', rx: { '🔥': ['devin', 'theo'], '😭': ['sofia'] } },
	{ m: 203, who: 'devin', c: 'checklist before Thursday so I stop forgetting things:\n• sketchbook\n• the three refs Ricky posted\n• laptop actually charged this time' },
	{ m: 199, who: 'sofia', c: 'the charger situation last week was genuinely dire', reply: 2, rx: { '😂': ['maya', 'devin', 'theo'] } },
	{ m: 178, who: 'ricky', c: '[bold]Something that moves[/bold] is posted — due Friday. Link, image or video all work.' },
	{ m: 170, who: 'sofia', c: '[color-blue]question[/color-blue] — can we submit a GIF for this one?' },
	{ m: 166, who: 'ricky', c: 'yes! honestly a GIF is ideal — it loops, so I see the timing twice', reply: 5, rx: { '✅': ['sofia', 'maya'] } },
	{ m: 121, who: 'theo',  c: '[wave]kinetic type[/wave] is so satisfying when the timing finally lands' },
	{ m: 84,  who: 'ricky', c: '[color-green]see you at 2 today[/color-green] ✌️', fx: 'gentle', rx: { '👋': ['maya', 'devin', 'sofia', 'theo'] } },
	// ── the tail: everything below here is what the screenshot shows ──
	{ m: 47,  who: 'maya',  c: 'the easing curve that fixed everything for me:\n```js\nconst ease = (t) => 1 - Math.pow(1 - t, 3);\n```\nturns out I was doing linear this entire time', rx: { '🙌': ['theo'] } },
	// Lone emoji → the bubble goes jumbo on its own; `fx` shakes the whole thing.
	{ m: 31,  who: 'theo',  c: '🤯', fx: 'shake' },
	// Class-uploaded custom emote. Not gated by hide_tg_emoji — that flag only
	// covers the Telegram packs and Emoji Kitchen.
	{ m: 24,  who: 'maya',  c: 'this is exactly my face right now [ce:laugh_cat]', rx: { '😂': ['devin', 'sofia'] } },
	{ m: 15,  who: 'sofia', c: 'ok but [sz:175][color-orange]how[/color-orange][/sz] did you do the trail thing' },
	{ m: 6,   who: 'devin', c: '[sz:70]very carefully[/sz] [sz:250][color-purple]and badly[/color-purple][/sz]', rx: { '🔥': ['maya', 'sofia', 'ricky'] } }
];

// Rebuild rather than append — see the header note on push-ID timestamps.
await rtdb.ref(`channels/${CHANNEL_ID}`).remove();

const now = Date.now();
const writes = {};
const rxWrites = {};
const msgIds = [];

SCRIPT.forEach((msg, i) => {
	const ts = now - msg.m * 60 * 1000;
	const id = pushIdAt(ts, i);
	msgIds[i] = id;

	const payload = { u: ids[msg.who], c: readableToUnicode(msg.c) };
	if (msg.fx) payload.fx = msg.fx;
	if (msg.reply != null) {
		const target = SCRIPT[msg.reply];
		payload.rt = {
			id: msgIds[msg.reply],
			u: ids[target.who],
			// Same 100-char cap the send route applies.
			c: readableToUnicode(target.c).slice(0, 100)
		};
	}
	writes[id] = payload;

	if (msg.rx) {
		for (const [emoji, reactors] of Object.entries(msg.rx)) {
			const key = encodeReactionKey(emoji);
			for (const who of reactors) {
				rxWrites[`${id}/${key}/${ids[who]}`] = true;
			}
		}
	}
});

await rtdb.ref(`channels/${CHANNEL_ID}/messages`).set(writes);
await rtdb.ref(`channels/${CHANNEL_ID}/reactions`).update(rxWrites);
await rtdb.ref(`channels/${CHANNEL_ID}/lastAt`).set(now - 8 * 60 * 1000);

console.log(`chat: ${SCRIPT.length} messages, ${Object.keys(rxWrites).length} reactions`);
console.log(`\ndone — class ${CLASS_ID}, channel /app/chat/channel/${CHANNEL_ID}`);
process.exit(0);
