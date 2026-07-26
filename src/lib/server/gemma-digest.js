// Gemma daily digest — opt-in class recap + assignment reminders + inspiration.
//
// For each opted-in user, composes a digest from:
//   1. The last ~24h of channel chat (the RTDB live tier IS the 24h window —
//      /api/chat/sync archives anything older nightly, so reading it directly
//      gives exactly "what happened in class today").
//   2. The student's INCOMPLETE items on the current + next week plans.
//   3. Instructor-entered interests (users.interests) → inspiration nudges.
//
// The text is written by the class's LLM when a key is available (instructor's
// saved user_ai_keys row, same OpenAI-compatible endpoint the Gemma chat
// uses; recipient's own key preferred when present), with a plain templated
// fallback so digests still go out keyless. Inspiration links come from the
// Scout worker on kahan (are.na + Wikipedia lookups of users.interests via
// $lib/server/scout.js) when it's online; model knowledge otherwise.
//
// Delivery: a real DM from the `gemma` bot user (seeded in migration 041) via
// the same compact-message plumbing /api/chat uses, plus a push notification.
import { createHash } from 'node:crypto';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { ServerValue } from 'firebase-admin/database';
import { getConvId } from '$lib/convId.js';
import { notifyUsers } from '$lib/server/push.js';
import { getWeekPlans, getCompletionsForStudent } from '$lib/server/week-plans.js';
import { searchWithWait } from '$lib/server/scout.js';

const GEMMA_ID = 'gemma';
export const DEFAULT_CLASS = 'idc-fall-2026';

// Strip PUA effect chars + inline tokens so the LLM sees clean text.
const cleanText = (s) =>
	String(s ?? '')
		.replace(/[\uE100-\uE1FF]/g, '')
		.replace(/\[(tg|tgc|ek|ce)[^\]]*\]/gi, '')
		.replace(/\s+/g, ' ')
		.trim();

// ── 1. Class recap source: last-24h channel messages from RTDB ────────────
async function gatherRecapLines(classId) {
	const db = getDb();
	if (!db) return [];
	const convs = await db.execute({
		sql: "SELECT id, name FROM conversations WHERE type = 'channel' AND class_id = ?",
		args: [classId]
	});
	const usersRes = await db.execute({ sql: 'SELECT id, name FROM users' });
	const names = {};
	for (const r of usersRes.rows) names[String(r.id)] = String(r.name ?? 'Someone');
	const adminDb = getAdminDb();
	const chNames = {};
	for (const c of convs.rows) chNames[String(c.id)] = String(c.name ?? c.id);
	const lines = [];
	const seenIds = new Set();
	// Live tier (RTDB) first — it wins on dedupe.
	for (const c of convs.rows) {
		const chId = String(c.id), chName = chNames[chId];
		const snap = await adminDb.ref(`channels/${chId}/messages`).limitToLast(150).get();
		if (!snap.exists()) continue;
		for (const [key, m] of Object.entries(snap.val())) {
			const uid = String(m?.u ?? m?.userId ?? '');
			const text = cleanText(m?.c ?? m?.content);
			if (!text) continue;
			seenIds.add(key);
			lines.push({ id: key, chId, kind: 'channel', uid, ch: chName, name: names[uid] ?? 'Someone', at: 0, text: text.slice(0, 240) });
		}
	}
	// Archived tier (Turso) — the nightly sync moves live → archive, so near
	// the cron boundary chunks of "yesterday" exist ONLY here. Without this,
	// goals in a message archived overnight became unharvestable.
	if (convs.rows.length) {
		const cutoffIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
		const arch = await db.execute({
			sql: `SELECT id, conversation_id, user_id, content, created_at FROM chat_messages
			      WHERE conversation_id IN (${convs.rows.map(() => '?').join(',')}) AND created_at >= ?
			      ORDER BY created_at ASC LIMIT 300`,
			args: [...convs.rows.map((c) => String(c.id)), cutoffIso]
		}).catch(() => ({ rows: [] }));
		const archLines = [];
		for (const r of arch.rows) {
			const id = String(r.id);
			if (seenIds.has(id)) continue;
			const text = cleanText(r.content);
			if (!text) continue;
			const uid = String(r.user_id);
			const chId = String(r.conversation_id);
			archLines.push({ id, chId, kind: 'channel', uid, ch: chNames[chId] ?? chId, at: 0, text: text.slice(0, 240) });
		}
		lines.unshift(...archLines); // archived = older → goes first
	}
	return lines.slice(-160); // cap the prompt size
}
const fmtRecapLine = (l) => `[#${l.ch}] ${l.name}: ${l.text}`;

// The user's DM conversations (last-24h live window) — requests to them
// ("can you…") mostly live here, so goal harvesting reads both sides.
// The gemma conversation itself is excluded (digests aren't goals).
async function gatherDMLines(userId) {
	const db = getDb();
	const adminDb = getAdminDb();
	if (!db) return [];
	const usersRes = await db.execute({ sql: 'SELECT id, name, role, gemma_scan_dms FROM users' });
	const names = {};
	const instructorIds = new Set();
	let scanAll = false;
	for (const r of usersRes.rows) {
		const id = String(r.id);
		names[id] = String(r.name ?? 'Someone');
		if (String(r.role) === 'instructor') instructorIds.add(id);
		if (id === userId && Number(r.gemma_scan_dms) === 1) scanAll = true;
	}
	// DM-scan scope (privacy): by default only conversations WITH AN
	// INSTRUCTOR are read; users.gemma_scan_dms = 1 is the student's opt-in
	// for Gemma to read ALL their DMs.
	const inScope = (convId) => {
		if (scanAll) return true;
		const otherId = convId.replace(userId, '').replace(/^_|_$/g, '');
		return instructorIds.has(otherId);
	};
	const chats = await adminDb.ref(`userChats/${userId}`).get();
	const convIds = chats.exists() ? Object.keys(chats.val()).filter((c) => !c.includes(GEMMA_ID) && inScope(c)) : [];
	if (!convIds.length) return [];
	const lines = [];
	const seenIds = new Set();
	for (const convId of convIds) {
		const snap = await adminDb.ref(`dms/${convId}/messages`).limitToLast(80).get();
		if (!snap.exists()) continue;
		for (const [key, m] of Object.entries(snap.val())) {
			const uid = String(m?.u ?? m?.userId ?? '');
			const text = cleanText(m?.c ?? m?.content);
			if (!text) continue;
			seenIds.add(key);
			lines.push({ id: key, chId: convId, kind: 'dm', uid, ch: 'DM', name: names[uid] ?? 'Someone', text: text.slice(0, 240) });
		}
	}
	// archived DM tier (see gatherRecapLines for why)
	const cutoffIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
	const arch = await db.execute({
		sql: `SELECT id, conversation_id, user_id, content, created_at FROM chat_messages
		      WHERE conversation_id IN (${convIds.map(() => '?').join(',')}) AND created_at >= ?
		      ORDER BY created_at ASC LIMIT 200`,
		args: [...convIds, cutoffIso]
	}).catch(() => ({ rows: [] }));
	const archLines = [];
	for (const r of arch.rows) {
		const id = String(r.id);
		if (seenIds.has(id)) continue;
		const text = cleanText(r.content);
		if (!text) continue;
		archLines.push({ id, chId: String(r.conversation_id), kind: 'dm', uid: String(r.user_id), ch: 'DM', name: names[String(r.user_id)] ?? 'Someone', text: text.slice(0, 240) });
	}
	lines.unshift(...archLines);
	return lines.slice(-120);
}

// ── Personal goals — mined from the user's OWN chat messages ──────────────
// "I want to make…", "I plan to study…", "I'm going to build…" become rows
// in gemma_goals (deduped per user by label) and surface as a separate
// checkbox list on the Gemma page, distinct from assignment action items.
// Two-stage harvest: a LOOSE candidate filter forwards anything intent-ish
// to the LLM, which curates — IT decides which candidates are genuine goals
// and how many to add (zero is fine). The tighter capture regex below is
// only the keyless / LLM-failure fallback.
// (An earlier keyword pre-filter kept dropping real goals — chat speech
// omits subjects: "working on more kinetic type". ALL of the member's own
// messages now go to the curator; it's the judge of what's a goal.)

const GOAL_RE = /\b(?:I|we)(?:\s+really)?\s*(?:want|wanna|would like|'d like|plan|intend|hope|need|have|gotta|should|am going|'m going|are going|'re going)\s+to\s+([^.!?\n]{3,90})/gi;
// In-progress phrasings become "Finish …" todos ("I'm working on the deck",
// "almost done with the syllabus" → "Finish the deck" / "Finish the syllabus").
const FINISH_RE = /\b(?:I|we)(?:'m|'re|\s+am|\s+are)?\s*(?:(?:still\s+)?working on|building|making|designing|writing|drafting|editing|fixing|prototyping|developing|almost done with|done with most of|wrapping up|finishing(?:\s+up)?)\s+([^.!?\n]{3,90})/gi;
// "helping Sarah with her zine" → "Help Sarah with her zine"
const HELP_RE = /\b(?:I'm|I am|we're|we are)?\s*helping\s+([^.!?\n]{3,90})/gi;
// Keyless / LLM-failure fallback — capture regex, source = the matched line.
// Labels carrying bare deixis are useless out of context ("Send it out
// later" — send WHAT?). The dumb regex path skips them entirely; the LLM
// path is instructed to resolve them, and refineGoals cleans up strays.
const VAGUE_RE = /\b(?:it|that|this|them|you|your|their)\b/i;
// Mangle guard — labels talking about "the recipient/the user/the member"
// are model placeholder-speak, never a real goal.
const JUNK_RE = /\b(?:the recipient|the user|the member)\b/i;
// Near-duplicate guard: run-to-run paraphrase ("Finish the app" vs "Finish
// finalizing the app") defeats the exact-label UNIQUE constraint — token
// Jaccard catches it.
const _tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2));
function labelsSimilar(a, b) {
	const A = _tokens(a), B = _tokens(b);
	if (!A.size || !B.size) return false;
	let inter = 0;
	for (const t of A) if (B.has(t)) inter += 1;
	return inter / (A.size + B.size - inter) >= 0.5;
}
// Requests from OTHERS aimed at the member ("can you fix the deck?").
const CAN_RE = /\b(?:can|could|will|would)\s+you\s+(?:please\s+)?([^.!?\n]{3,90})/gi;
// Softer self-phrasings: "I want a poster wall" (no "to"), "I should clean
// up the repo", "can I get the syllabus done by Friday".
const BARE_RE = /\b(?:I|we)\s+(?:want|should)\s+(?!to\b)([^.!?\n]{3,90})/gi;
const CANI_RE = /\bcan\s+I\s+([^.!?\n]{3,90})/gi;
function extractGoals(lines, userId, keepVague = false) {
	const out = new Map(); // label -> { line, by }
	const add = (label, l, by = null, quote = null) => {
		const clean = label.trim().replace(/\s+/g, ' ').replace(/[,;:?]$/, '');
		if (clean.length < 3) return;
		if (!keepVague && VAGUE_RE.test(clean)) return;
		const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
		if (!out.has(cap)) out.set(cap, { l, by, quote });
	};
	for (const l of lines) {
		if (l.uid === userId) {
			for (const m of String(l.text).matchAll(GOAL_RE)) add(m[1], l, null, m[0]);
			for (const m of String(l.text).matchAll(FINISH_RE)) add(`Finish ${m[1]}`, l, null, m[0]);
			for (const m of String(l.text).matchAll(BARE_RE)) add(m[1], l, null, m[0]);
			for (const m of String(l.text).matchAll(CANI_RE)) add(m[1], l, null, m[0]);
			for (const m of String(l.text).matchAll(HELP_RE)) add(`Help ${m[1]}`, l, null, m[0]);
		} else {
			for (const m of String(l.text).matchAll(CAN_RE)) add(m[1], l, l.name, m[0]);
		}
	}
	return [...out].map(([label, { l, by, quote }]) => ({ label, convId: l.chId, msgId: l.id, kind: l.kind, by, text: l.text, quote })).slice(0, 8);
}
// The curator call — candidates go in NUMBERED so the model can cite which
// message each goal came from ("src"), and the WHOLE conversation window
// rides along as context so deixis resolves to concrete referents ("send it
// to you" said to Sarah about the syllabus → "Send the syllabus to Sarah").
// Returns null on call/parse FAILURE (caller falls back to regex) vs []
// when the model deliberately picks nothing.
// ── Multi-step goal pipeline (count → write → verify) ─────────────────────
// TERSE prompts on purpose: verbose instructions/few-shots send this
// reasoning model into 20k+-char rumination spirals that blow the budget
// (finish=length, content:null). The minimal forms verified: 8/8 goals.
async function llmCountGoals(creds, lines, context, userId, existing = []) {
	const who = (l) => (l.uid === userId ? 'THE MEMBER' : l.name);
	const raw = await llmChat(creds, [
		{ role: 'system', content:
			'Quick task. Read the NUMBERED messages. Enumerate EVERY goal, plan, in-progress activity ' +
			'("working on X" counts), or request aimed at THE MEMBER, as short hints. A single message ' +
			'may hold several. NEVER invent a goal that is not in the messages. Return STRICT JSON: {"count": n, "hints": [{"hint": "...", "src": ' +
			'<message number>}]}' },
		{ role: 'user', content: [
			existing.length ? 'ALREADY TRACKED (skip these and close paraphrases):\n' + existing.map((e) => `- ${e}`).join('\n') + '\n' : '',
			lines.map((l, i) => `[${i}] (${who(l)}) ${l.text}`).join('\n')
		].join('\n') }
	], 7000, 0.35);
	if (!raw) { console.warn('[gemma-digest] step1 count: LLM call failed'); return null; }
	const parsed = parseJsonLoose(raw);
	if (!Array.isArray(parsed?.hints)) { console.warn('[gemma-digest] step1 count: unparseable'); return null; }
	return parsed.hints.filter((h) => h && typeof h.hint === 'string' && h.hint.trim()).slice(0, 15);
}

async function llmWriteGoals(creds, lines, context, hints, userId) {
	const who = (l) => (l.uid === userId ? 'THE MEMBER' : l.name);
	const raw = await llmChat(creds, [
		{ role: 'system', content:
			'Quick task. Turn each listed goal into a checklist entry. Label: short imperative, under 90 ' +
			'chars, every pronoun resolved to the concrete thing or person using the conversation ' +
			'("send it out" → "send the syllabus out"). In-progress work becomes "Finish X". Requests ' +
			'from others: name the requester in the label ("help me…" asked by Sarah → "Help Sarah…") ' +
			'and set "by" to their name; the member\'s own goals get "by": null. "quote" = exact words ' +
			'copied from the source message. NEVER invent goals beyond the listed ones. Return STRICT JSON: {"goals": [{"label": "...", "src": ' +
			'<candidate number>, "by": "Name" or null, "quote": "..."}]}' },
		{ role: 'user', content: [
			'CONVERSATION (context):',
			context.length ? context.map(fmtRecapLine).join('\n') : '(none)',
			'',
			'CANDIDATES:',
			lines.map((l, i) => `[${i}] (${who(l)}) ${l.text}`).join('\n'),
			'',
			'GOALS TO WRITE (one entry each):',
			hints.map((h, i) => `${i + 1}. ${h.hint} (candidate ${h.src})`).join('\n')
		].join('\n') }
	], 7000, 0.35);
	if (!raw) { console.warn('[gemma-digest] step2 write: LLM call failed'); return null; }
	const parsed = parseJsonLoose(raw);
	if (!Array.isArray(parsed?.goals)) { console.warn('[gemma-digest] step2 write: unparseable'); return null; }
	return parsed.goals
		.filter((g) => g && typeof g.label === 'string' && g.label.trim().length >= 3)
		.map((g) => {
			const s = g.label.trim().slice(0, 90);
			const src = Number.isInteger(g.src) && lines[g.src] ? lines[g.src] : null;
			const by = typeof g.by === 'string' && g.by.trim() ? g.by.trim().slice(0, 60)
				: (src && src.uid !== userId ? src.name : null);
			const quote = typeof g.quote === 'string' && g.quote.trim() ? g.quote.trim().slice(0, 240) : null;
			return { label: s.charAt(0).toUpperCase() + s.slice(1), convId: src?.chId ?? null, msgId: src?.id ?? null, kind: src?.kind ?? 'channel', by, text: src?.text ?? null, quote };
		});
}

async function llmVerifyGoals(creds, goals, lines, userId) {
	if (!goals.length) return goals;
	const raw = await llmChat(creds, [
		{ role: 'system', content:
			'Quick check. For each NUMBERED checklist entry: is the label concrete (no bare ' +
			'it/that/this/you/them; requests must NAME the requester, never say "me")? PREFER FIXING a ' +
			'bad label over dropping ("Send it out later" about the syllabus → "Send the syllabus out"); ' +
			'drop ONLY entries that are not goals at all. Return STRICT JSON: {"goals": [{"i": <n>, "ok": true} or {"i": <n>, "label": ' +
			'"fixed label"} or {"i": <n>, "drop": true}]} — one verdict per entry.' },
		{ role: 'user', content: goals.map((g, i) =>
			`[${i}] ${g.label}${g.by ? ` (asked by ${g.by})` : ''} — source: "${g.text ?? '(unknown)'}"`).join('\n') }
	], 7000, 0.35);
	if (!raw) { console.warn('[gemma-digest] step3 verify: LLM call failed — keeping unverified'); return goals; }
	const parsed = parseJsonLoose(raw);
	if (!Array.isArray(parsed?.goals)) { console.warn('[gemma-digest] step3 verify: unparseable — keeping unverified'); return goals; }
	const verdicts = new Map();
	for (const v of parsed.goals) if (Number.isInteger(v?.i)) verdicts.set(v.i, v);
	const out = [];
	goals.forEach((g, i) => {
		const v = verdicts.get(i);
		if (!v || v.ok === true) { out.push(g); return; }
		if (v.drop === true) return;
		if (typeof v.label === 'string' && v.label.trim().length >= 3) {
			const s = v.label.trim().slice(0, 90);
			out.push({ ...g, label: s.charAt(0).toUpperCase() + s.slice(1) });
		} else out.push(g);
	});
	return out;
}

async function harvestGoals(userId, recap, creds) {
	const db = getDb();
	if (!db) return;
	const dmLines = await gatherDMLines(userId).catch(() => []);
	const mine = recap.filter((l) => l.uid === userId);
	const others = [...dmLines.filter((l) => l.uid !== userId), ...recap.filter((l) => l.uid !== userId)];
	const mineAll = [...mine, ...dmLines.filter((l) => l.uid === userId)];
	if (!mineAll.length && !others.length) return;
	const existingRows = await db.execute({ sql: 'SELECT label FROM gemma_goals WHERE user_id = ?', args: [userId] }).catch(() => ({ rows: [] }));
	const existing = existingRows.rows.map((r) => String(r.label));
	const selfRow = (await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] }).catch(() => ({ rows: [] }))).rows[0];
	const selfName = selfRow?.name ? String(selfRow.name).trim() : null;
	let goals = null;
	if (creds) {
		const cands = [...mineAll, ...others].slice(-60);
		const context = [...recap, ...dmLines].slice(-120);
		// count → write → verify (each a narrow, shallow-thinking call)
		const hints = cands.length ? await llmCountGoals(creds, cands, context, userId, existing) : [];
		if (hints === null) goals = null;
		else if (!hints.length) goals = [];
		else {
			const written = await llmWriteGoals(creds, cands, context, hints, userId);
			goals = written === null ? null : await llmVerifyGoals(creds, written, cands, userId);
		}
	}
	if (goals === null || !creds) {
		// keyless, or the pipeline failed → the tight capture regexes alone
		goals = extractGoals([...mineAll, ...others], userId);
	} else {
		// UNION the regex catches with the LLM's — anything the dumb net
		// catches that the pipeline skipped still lands (refine polishes it).
		const have = new Set(goals.map((g) => g.label.toLowerCase()));
		for (const g of extractGoals([...mineAll, ...others], userId)) {
			if (!have.has(g.label.toLowerCase())) goals.push(g);
		}
	}
	const seen = new Set();
	let added = 0;
	for (const g of goals.slice(0, 15)) {
		if (JUNK_RE.test(g.label)) continue;
		// a goal naming the member THEMSELVES ("Remind Ricky Yurewitch to…")
		// is model confusion — their goals never need their own full name
		if (selfName && g.label.toLowerCase().includes(selfName.toLowerCase())) continue;
		if (seen.has(g.label)) continue;
		// paraphrase of something already tracked (or already added this run)
		if (existing.some((e) => labelsSimilar(e, g.label)) || [...seen].some((s) => labelsSimilar(s, g.label))) continue;
		seen.add(g.label);
		const res = await db.execute({
			sql: 'INSERT OR IGNORE INTO gemma_goals (id, user_id, label, source, source_conv_id, source_msg_id, source_kind, requested_by, source_text, source_quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			args: [crypto.randomUUID(), userId, g.label, 'chat', g.convId ?? null, g.msgId ?? null, g.kind ?? 'channel', g.by ?? null, g.text ?? null, g.quote ?? null]
		}).catch(() => null);
		if (res?.rowsAffected) added += 1;
	}
	return added;
}
// Refine pass — repair stored goals whose labels still carry bare deixis
// (harvested before context-framing, or an LLM slip). One batched call:
// each vague goal + its source message + the conversation → a rewritten
// concrete label, or {drop} when the referent can't be determined (an
// unresolvable "send it out later" is noise, not a goal).
async function refineGoals(userId, recap, creds) {
	const db = getDb();
	if (!db || !creds) return;
	const rows = await db.execute({
		sql: 'SELECT id, label, source_msg_id, requested_by FROM gemma_goals WHERE user_id = ? AND done = 0',
		args: [userId]
	});
	// vague = bare deixis anywhere, or a REQUESTED goal still speaking from
	// the requester's mouth ("Help me…" — whose "me"? the requester's).
	const REQ_PRONOUN_RE = /\b(?:me|my|mine|us|our)\b/i;
	const selfRow = (await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [userId] }).catch(() => ({ rows: [] }))).rows[0];
	const selfName = selfRow?.name ? String(selfRow.name).trim().toLowerCase() : null;
	const allLabels = rows.rows.map((r) => ({ id: String(r.id), label: String(r.label) }));
	const vague = rows.rows.filter((r) =>
		VAGUE_RE.test(String(r.label)) || JUNK_RE.test(String(r.label)) ||
		(selfName && String(r.label).toLowerCase().includes(selfName)) ||
		(r.requested_by && REQ_PRONOUN_RE.test(String(r.label))));
	if (!vague.length) return;
	const byId = new Map(recap.map((l) => [l.id, l]));
	const items = vague.map((r, i) => ({
		i, id: String(r.id), label: String(r.label),
		hasSource: !!r.source_msg_id,
		srcText: r.source_msg_id ? (byId.get(String(r.source_msg_id))?.text ?? null) : null
	}));
	// Conversation goes in NUMBERED so the model can also RECOVER the source
	// message for legacy goals harvested before source tracking existed —
	// the "↗ from your message" deep link gets backfilled along with the label.
	const conv = recap.slice(-80);
	const raw = await llmChat(creds, [
		{ role: 'system', content:
			'You repair vague checklist labels for a design-class member. For each NUMBERED goal, rewrite ' +
			'the label so every pronoun or vague reference (it, that, this, you, your, them, their) is ' +
			'replaced by the concrete thing or person meant, using the conversation and the goal\'s source ' +
			'message. Keep labels short, imperative, under 90 characters. Also identify WHICH numbered ' +
			'conversation message the goal originally came from and return it as "src". If the referent ' +
			'genuinely cannot be determined, drop that goal. Return STRICT JSON only: {"fixes": [{"i": ' +
			'<goal number>, "label": "Concrete label", "src": <conversation message number or null>} or ' +
			'{"i": <goal number>, "drop": true}, …]} — one entry per numbered goal.' },
		{ role: 'user', content: [
			'CONVERSATION (recent class chat, numbered):',
			conv.length ? conv.map((l, i) => `[${i}] ${fmtRecapLine(l)}`).join('\n') : '(none)',
			'',
			'GOALS TO FIX:',
			items.map((it) => `[${it.i}] ${it.label}${it.srcText ? ` — source message: "${it.srcText}"` : ''}`).join('\n')
		].join('\n') }
	], 7000, 0.35);
	if (!raw) { console.warn('[gemma-digest] refine: LLM call failed — vague goals left for next run'); return; }
	const parsed = parseJsonLoose(raw);
	const fixes = Array.isArray(parsed?.fixes) ? parsed.fixes : null;
	if (!fixes) { console.warn('[gemma-digest] refine: unparseable LLM output:', String(raw).slice(0, 120)); return; }
	const handled = new Set();
	for (const f of fixes) {
		const it = Number.isInteger(f?.i) ? items[f.i] : null;
		if (!it) continue;
		handled.add(f.i);
		// HARD GUARANTEE: whatever the model does, a bad label never
		// survives a refine pass — fix it concretely or lose the goal.
		// "Bad" = vague deixis, placeholder-speak, the member's OWN name
		// (self-referential confusion), or a duplicate of another goal.
		const stillVague = typeof f.label === 'string' && (
			VAGUE_RE.test(f.label) || JUNK_RE.test(f.label) ||
			(selfName && f.label.toLowerCase().includes(selfName)) ||
			allLabels.some((o) => o.id !== it.id && labelsSimilar(o.label, f.label)));
		if (f.drop === true || stillVague || typeof f.label !== 'string' || f.label.trim().length < 3) {
			console.warn(`[gemma-digest] refine dropped "${it.label}" (fix: ${f.drop === true ? 'drop' : JSON.stringify(f.label ?? null)})`);
			await db.execute({ sql: 'DELETE FROM gemma_goals WHERE id = ? AND user_id = ?', args: [it.id, userId] }).catch(() => {});
		} else {
			const label = f.label.trim().slice(0, 90);
			// Backfill the source deep link when the goal has none and the
			// model located the originating message (must be the USER'S own).
			const src = !it.hasSource && Number.isInteger(f.src) && conv[f.src]?.uid === userId ? conv[f.src] : null;
			// UNIQUE(user_id, label): if the fixed wording already exists as
			// another goal, this one is a duplicate — delete it instead.
			try {
				if (src) {
					await db.execute({
						sql: 'UPDATE gemma_goals SET label = ?, source_conv_id = ?, source_msg_id = ? WHERE id = ? AND user_id = ?',
						args: [label, src.chId, src.id, it.id, userId]
					});
				} else {
					await db.execute({ sql: 'UPDATE gemma_goals SET label = ? WHERE id = ? AND user_id = ?', args: [label, it.id, userId] });
				}
			} catch {
				console.warn(`[gemma-digest] refine dedupe-deleted "${it.label}" (fix collided: ${JSON.stringify(label)})`);
				await db.execute({ sql: 'DELETE FROM gemma_goals WHERE id = ? AND user_id = ?', args: [it.id, userId] }).catch(() => {});
			}
		}
	}
}

// Completed-but-not-yet-celebrated goals — the next digest congratulates
// each exactly once (congratulated flips to 1 after the send).
async function getUncongratulatedGoals(userId) {
	const db = getDb();
	if (!db) return [];
	const rows = await db.execute({
		sql: 'SELECT id, label, requested_by FROM gemma_goals WHERE user_id = ? AND done = 1 AND congratulated = 0 ORDER BY done_at DESC LIMIT 6',
		args: [userId]
	});
	return rows.rows.map((r) => ({ goalId: String(r.id), label: String(r.label), requestedBy: r.requested_by ? String(r.requested_by) : null }));
}

// Wipe a user's entire Gemma-digest footprint — conversation (live +
// archived), unread count, change-detection state, harvested goals — so the
// next send is a true first-time experience. Used by the instructor's
// "Reset & send first-time digest" test button.
export async function resetGemmaForUser(userId) {
	const adminDb = getAdminDb();
	const convId = getConvId(GEMMA_ID, userId);
	await Promise.all([
		adminDb.ref(`dms/${convId}`).remove().catch(() => {}),
		adminDb.ref(`userChats/${userId}/${convId}`).remove().catch(() => {}),
		adminDb.ref(`unreadCounts/${userId}/${convId}`).remove().catch(() => {}),
		adminDb.ref(`gemmaDigestState/${userId}`).remove().catch(() => {})
	]);
	const db = getDb();
	if (db) {
		await db.execute({ sql: 'DELETE FROM chat_messages WHERE conversation_id = ?', args: [convId] }).catch(() => {});
		await db.execute({ sql: 'DELETE FROM gemma_goals WHERE user_id = ?', args: [userId] }).catch(() => {});
	}
}

// Full historical list for the Goals page: open first, then completed,
// newest-intent-first within each group.
export async function getAllGoals(userId) {
	const db = getDb();
	if (!db) return [];
	const rows = await db.execute({
		sql: 'SELECT id, label, done, source_conv_id, source_msg_id, source_kind, requested_by, source_text, source_quote, created_at, done_at FROM gemma_goals WHERE user_id = ? ORDER BY done ASC, created_at DESC LIMIT 100',
		args: [userId]
	});
	return rows.rows.map((r) => ({
		goalId: String(r.id),
		label: String(r.label),
		done: Number(r.done) === 1,
		doneAt: r.done_at ? String(r.done_at) : null,
		createdAt: r.created_at ? String(r.created_at) : null,
		requestedBy: r.requested_by ? String(r.requested_by) : null,
		sourceText: r.source_text ? String(r.source_text) : null,
		sourceQuote: r.source_quote ? String(r.source_quote) : null,
		sourceUrl: r.source_conv_id && r.source_msg_id
			? `/app/chat/${String(r.source_kind) === 'dm' ? 'dm' : 'channel'}/${r.source_conv_id}?msg=${encodeURIComponent(String(r.source_msg_id))}`
			: null
	}));
}

export async function getOpenGoals(userId) {
	const db = getDb();
	if (!db) return [];
	// Newest first — the most recently voiced intent ranks highest; the
	// Gemma page shows the top few with a "see all" expander.
	const rows = await db.execute({
		sql: 'SELECT id, label, source_conv_id, source_msg_id, source_kind, requested_by, source_text, source_quote, created_at FROM gemma_goals WHERE user_id = ? AND done = 0 ORDER BY created_at DESC LIMIT 30',
		args: [userId]
	});
	return rows.rows.map((r) => ({
		goalId: String(r.id),
		label: String(r.label),
		requestedBy: r.requested_by ? String(r.requested_by) : null,
		sourceText: r.source_text ? String(r.source_text) : null,
		sourceQuote: r.source_quote ? String(r.source_quote) : null,
		// deep link to the message the goal was harvested from (both chat
		// pages scroll to ?msg=); null for older rows without a source
		sourceUrl: r.source_conv_id && r.source_msg_id
			? `/app/chat/${String(r.source_kind) === 'dm' ? 'dm' : 'channel'}/${r.source_conv_id}?msg=${encodeURIComponent(String(r.source_msg_id))}`
			: null
	}));
}

// ── 2. Incomplete assignment items for one student ────────────────────────
// Exported: the Gemma page renders these as a LIVE checkbox list (checking
// one writes a real item_completions row — same table as the home checklist).
export async function getOpenActionItems(classId, studentId) {
	const plans = await getWeekPlans(classId);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const upcoming = plans
		.filter((p) => !p.dueDate || new Date(p.dueDate) >= today)
		.slice(0, 2); // current + next
	const out = [];
	for (const p of upcoming) {
		const done = await getCompletionsForStudent(p.id, studentId);
		for (const it of (p.items ?? [])) {
			if (done[it.id]) continue;
			out.push({
				itemId: it.id,
				label: it.label,
				week: p.week,
				dueDate: p.dueDate,
				requiresSubmission: !!it.requiresSubmission
			});
		}
	}
	return out;
}

// Grouped by week — the shape the digest prompt/template wants.
async function gatherIncomplete(classId, studentId) {
	const items = await getOpenActionItems(classId, studentId);
	const byWeek = new Map();
	for (const it of items) {
		if (!byWeek.has(it.week)) byWeek.set(it.week, { week: it.week, dueDate: it.dueDate, missing: [] });
		byWeek.get(it.week).missing.push(it.label);
	}
	return [...byWeek.values()];
}

// ── LLM calls (OpenAI-compatible, same shape as /api/ai/chat) ─────────────
// Up to 3 attempts (user: "prompt it a couple times just to make sure") —
// transient upstream hiccups shouldn't demote a digest to the template.
async function llmChat(creds, messages, maxTokens = 5000, temperature = 0.6) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		const out = await llmChatOnce(creds, messages, maxTokens, temperature);
		if (out) return out;
		if (attempt < 3) {
			console.warn(`[gemma-digest] llm: attempt ${attempt} failed, retrying…`);
			await new Promise((r) => setTimeout(r, 1500 * attempt));
		}
	}
	return null;
}
async function llmChatOnce(creds, messages, maxTokens, temperature) {
	try {
		const base = String(creds.base_url).replace(/\/$/, '');
		const headers = { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' };
		const modelsRes = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(15000) });
		if (!modelsRes.ok) { console.warn('[gemma-digest] llm: GET /models →', modelsRes.status); return null; }
		const model = (await modelsRes.json())?.data?.[0]?.id;
		if (!model) { console.warn('[gemma-digest] llm: no model in /models response'); return null; }
		const res = await fetch(`${base}/chat/completions`, {
			method: 'POST',
			headers,
			signal: AbortSignal.timeout(120000),
			// enable_thinking:false — this deployment's reasoning channel
			// nondeterministically spirals (20k+ chars, burns any budget,
			// content:null). Probed 2026-07-24: chat_template_kwargs kills the
			// reasoning entirely (0 chars, instant clean answers); ignored
			// harmlessly by servers that don't know the field.
			body: JSON.stringify({ model, stream: false, max_tokens: maxTokens, temperature, messages, chat_template_kwargs: { enable_thinking: false } })
		});
		if (!res.ok) {
			console.warn('[gemma-digest] llm: POST /chat/completions →', res.status, (await res.text().catch(() => '')).slice(0, 200));
			return null;
		}
		const data = await res.json();
		const out = data?.choices?.[0]?.message?.content?.trim() || null;
		if (!out) console.warn('[gemma-digest] llm: empty completion', JSON.stringify(data).slice(0, 200));
		return out;
	} catch (e) {
		console.warn('[gemma-digest] llm: fetch failed —', e?.name === 'TimeoutError' ? 'TIMEOUT' : (e?.message ?? e));
		return null;
	}
}
// Small models love to wrap JSON in prose/fences — cut out the outermost
// {...} block before parsing instead of failing on decoration.
function parseJsonLoose(raw) {
	if (!raw) return null;
	const s = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
	const a = s.indexOf('{'), b = s.lastIndexOf('}');
	if (a < 0 || b <= a) return null;
	try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
async function llmWrite(creds, prompt) {
	return llmChat(creds, [
				{ role: 'system', content:
						'You are Gemma, the friendly AI assistant of eating.computer, the class platform for ' +
						'Interactive Design Concepts at Cooper Union. Write a short, warm DIGEST message ' +
						'for one member of the class. Plain text only (no markdown headers). Structure: a one-line ' +
						'greeting; "Today in class:" with a 2-4 sentence recap of the chat; if they have incomplete ' +
						'assignment items, a gentle "Reminders:" section as a BULLETED list, one line per item ' +
						'starting with "- " (MARKDOWN list syntax, hyphen-space — the client renders markdown); if ' +
						'they have tracked personal goals, ALWAYS include a "Your goals:" ' +
						'section as a bulleted markdown list — one "- " line per goal, verbatim labels, keeping any ' +
						'"(asked by X)" annotation — then acknowledge one warmly in a single sentence; if they ' +
						'just completed goals, congratulate them for those by name; if interests are given, ONE short inspiration ' +
						'suggestion tied to those interests (a concept, artist, technique or tiny exercise). ' +
						'If WEB FINDS are listed, ground the inspiration in ONE of them and include its URL verbatim as a ' +
						'markdown link like [title](url) — never invent or alter URLs; with no web finds, no links at all. ' +
						'Keep the whole thing under 180 words. Never invent assignments or messages.' },
					{ role: 'user', content: prompt }
	]);
}

// Keyless / LLM-failure fallback — plain templated digest.
function templateDigest({ name, recapLines, incomplete, interests, doneGoals = [], goals = [], newGoalsCount = 0, webFinds = null }) {
	const parts = [`Hi ${name.split(' ')[0]}! Here's your digest. ✨`];
	if (doneGoals.length) {
		parts.push(`🎉 You checked off: ${doneGoals.map((g) => g.label).join('; ')} — nicely done!`);
	}
	if (newGoalsCount > 0) parts.push(`\u{1F3AF} ${newGoalsCount} new task${newGoalsCount === 1 ? '' : 's'} added \u2014 see your Tasks list.`);
	if (recapLines.length) {
		parts.push(`Today in class: ${recapLines.length} messages across the channels. A few highlights:`);
		for (const l of recapLines.slice(-3)) parts.push(`- ${fmtRecapLine(l)}`);
	} else {
		parts.push('Today in class: all quiet in the channels.');
	}
	if (incomplete.length) {
		parts.push('Reminders — still open:');
		for (const w of incomplete) {
			const due = w.dueDate ? ` (due ${w.dueDate})` : '';
			parts.push(`- Week ${w.week}${due}: ${w.missing.join(', ')}`);
		}
	}
	if (goals.length) {
		parts.push('Your goals:');
		for (const g of goals) parts.push(`- ${g.label}${g.requestedBy ? ` (asked by ${g.requestedBy})` : ''}`);
	}
	if (webFinds?.length) {
		const f = webFinds[0];
		parts.push(`Something for you: [${f.title}](${f.url}) — found on ${f.source}, right up your alley.`);
	} else if (interests) {
		parts.push(`Something for you: keep chasing ${interests.split(/[,;]/)[0].trim()} — bring a spark of it into this week's work.`);
	}
	return parts.join('\n');
}

// ── Delivery: DM from the gemma bot + push ────────────────────────────────
async function deliverDM(userId, text, title = 'Gemma — digest') {
	const adminDb = getAdminDb();
	const convId = getConvId(GEMMA_ID, userId);
	const now = Date.now();
	await adminDb.ref(`dms/${convId}/messages`).push({ u: GEMMA_ID, c: text });
	const preview = text.slice(0, 60);
	await Promise.all([
		adminDb.ref(`userChats/${userId}/${convId}`).update({ otherUserId: GEMMA_ID, otherUserName: 'Gemma', lastMessage: preview, lastAt: now }),
		adminDb.ref(`unreadCounts/${userId}`).update({ [convId]: ServerValue.increment(1) })
	]);
	await notifyUsers([userId], {
		title,
		body: preview,
		// digests live on the Gemma chat page (it merges them from this conv)
		url: '/app/chat/gemma',
		tag: `gemma-digest`
	});
}

// Pick LLM creds: the recipient's own key if saved, else any instructor's.
async function pickCreds(userId) {
	const db = getDb();
	if (!db) return null;
	const own = await db.execute({ sql: 'SELECT base_url, api_key FROM user_ai_keys WHERE user_id = ?', args: [userId] });
	if (own.rows[0]) return own.rows[0];
	const inst = await db.execute({
		sql: `SELECT k.base_url, k.api_key FROM user_ai_keys k JOIN users u ON u.id = k.user_id
		      WHERE u.role = 'instructor' LIMIT 1`
	});
	return inst.rows[0] ?? null;
}

// ── Main entry — one user (shared recap passed in when batching) ──────────
// Per-user in-flight lock: generation takes a minute+ on the slow endpoint,
// so double-clicks / overlapping cron+manual runs must not stack digests.
// Lock lives in RTDB (survives across server instances); stale locks (>8 min)
// are treated as dead and stolen.
const LOCK_MS = 8 * 60 * 1000;
export async function sendGemmaDigest(opts) {
	const { userId } = opts;
	const lockRef = getAdminDb().ref(`gemmaDigestState/${userId}/lockAt`);
	const lockAt = Number((await lockRef.get()).val() ?? 0);
	if (lockAt && Date.now() - lockAt < LOCK_MS) {
		return { userId, delivered: false, reason: 'in-progress' };
	}
	await lockRef.set(Date.now());
	try {
		return await sendGemmaDigestInner(opts);
	} finally {
		await lockRef.remove().catch(() => {});
	}
}
async function sendGemmaDigestInner({ userId, classId = DEFAULT_CLASS, recapLines = null }) {
	const db = getDb();
	if (!db) return { userId, delivered: false, reason: 'no-db' };
	const userRow = (await db.execute({ sql: 'SELECT name, interests, role FROM users WHERE id = ?', args: [userId] })).rows[0];
	if (!userRow) return { userId, delivered: false, reason: 'no-user' };
	const name = String(userRow.name ?? 'there');
	const interests = userRow.interests ? String(userRow.interests) : '';
	const recap = recapLines ?? (await gatherRecapLines(classId));
	const incomplete = String(userRow.role) === 'instructor' ? [] : await gatherIncomplete(classId, userId);
	// Harvest fresh "I want to…" goals from their own messages (LLM-assisted
	// when a key is reachable — resolves pronouns; regex net underneath),
	// then load the open set (harvested now + still-unchecked from before).
	const creds = await pickCreds(userId);
	const newGoalsCount = (await harvestGoals(userId, recap, creds)) ?? 0;
	await refineGoals(userId, recap, creds);
	const goals = await getOpenGoals(userId);
	const doneGoals = await getUncongratulatedGoals(userId);

	// ── Change detection ──────────────────────────────────────────────
	// Fingerprint what the digest would say (recap + open items + goals).
	// If identical to the last send, don't repeat the digest: send a short
	// reminder when things are still un-actioned, or send nothing at all.
	const adminDb = getAdminDb();
	const fingerprint = createHash('sha1')
		.update(JSON.stringify({ r: recap, i: incomplete.map((w) => [w.week, ...w.missing]), g: goals.map((g) => g.label), d: doneGoals.map((g) => g.label) }))
		.digest('hex');
	const stateRef = adminDb.ref(`gemmaDigestState/${userId}`);
	const prev = (await stateRef.get()).val();
	if (prev?.hash === fingerprint) {
		if (!incomplete.length && !goals.length) {
			return { userId, delivered: false, reason: 'unchanged-nothing-open' };
		}
		const first = String(userRow.name ?? 'there').split(' ')[0];
		const lines = [`Hi ${first} — nothing new in class since last time, just a quick reminder.`];
		if (incomplete.length) {
			lines.push('Still open:');
			for (const w of incomplete) {
				const due = w.dueDate ? ` (due ${w.dueDate})` : '';
				for (const label of w.missing) lines.push(`- ${label} — Week ${w.week}${due}`);
			}
		}
		if (goals.length) {
			lines.push(incomplete.length ? 'And your own goals:' : 'Your goals:');
			for (const g of goals) lines.push(`- ${g.label}${g.requestedBy ? ` (asked by ${g.requestedBy})` : ''}`);
		}
		lines.push('You can check these off right here. 💪');
		const reminder = lines.join('\n');
		await deliverDM(userId, reminder, 'Gemma — reminder');
		await stateRef.set({ hash: fingerprint, at: Date.now(), reminded: true });
		return { userId, delivered: true, reminder: true };
	}

	// Real inspiration links from the Scout worker on kahan. Non-blocking in
	// spirit: waits briefly only when the worker is online, else uses the
	// cached result or silently returns null (digest degrades to no links).
	let webFinds = null;
	if (interests) {
		webFinds = await searchWithWait(interests, { waitMs: 15000, requestedBy: userId }).catch(() => null);
	}

	let text = null, usedLlm = false;
	if (creds) {
		const prompt = [
			`Recipient: ${name}${String(userRow.role) === 'instructor' ? ' (the instructor)' : ''}`,
			interests ? `Their interests (entered by the instructor): ${interests}` : 'No interests on file.',
			...(webFinds?.length ? [
				'',
				'WEB FINDS related to their interests (real links — pick ONE for the inspiration line, keep the URL exact):',
				webFinds.slice(0, 6).map((f) => `- ${f.title} — ${f.url}${f.snippet ? ` (${f.snippet})` : ''}`).join('\n')
			] : []),
			'',
			'CLASS CHAT (last 24h):',
			recap.length ? recap.map(fmtRecapLine).join('\n') : '(no messages today)',
			'',
			'INCOMPLETE ASSIGNMENT ITEMS:',
			incomplete.length
				? incomplete.map((w) => `Week ${w.week}${w.dueDate ? ` (due ${w.dueDate})` : ''}: ${w.missing.join('; ')}`).join('\n')
				: '(none — all caught up)',
			'',
			'PERSONAL GOALS they have voiced in chat (tracked as their own checklist):',
			goals.length ? goals.map((g) => `- ${g.label}${g.requestedBy ? ` (asked by ${g.requestedBy})` : ''}`).join('\n') : '(none tracked)',
			'',
			`NEW TASKS ADDED THIS RUN: ${newGoalsCount} — if more than zero, add one line telling them their Tasks list was updated ("N new tasks added — see your Tasks list").`,
			'',
			'GOALS THEY JUST COMPLETED (congratulate them warmly for these, one short line):',
			doneGoals.length ? doneGoals.map((g) => `- ${g.label}`).join('\n') : '(none)'
		].join('\n');
		text = await llmWrite(creds, prompt);
		usedLlm = !!text;
	}
	if (!text) text = templateDigest({ name, recapLines: recap, incomplete, interests, doneGoals, goals, newGoalsCount, webFinds });

	await deliverDM(userId, text);
	await stateRef.set({ hash: fingerprint, at: Date.now(), reminded: false });
	// each completed goal gets celebrated exactly once
	if (doneGoals.length) {
		await db.execute({
			sql: `UPDATE gemma_goals SET congratulated = 1 WHERE user_id = ? AND done = 1 AND congratulated = 0`,
			args: [userId]
		}).catch(() => {});
	}
	return { userId, delivered: true, usedLlm };
}

// ── Batch entry — the daily cron / instructor "run now" ───────────────────
// Master switch: the cron only sends when at least one instructor has opted
// in (users.gemma_digest = 1). `onlyUserId` (the test path) bypasses that.
export async function runDailyDigests({ classId = DEFAULT_CLASS, onlyUserId = null } = {}) {
	const db = getDb();
	if (!db) return { sent: [], reason: 'no-db' };

	let recipients;
	if (onlyUserId) {
		recipients = [onlyUserId];
	} else {
		const master = await db.execute({
			sql: "SELECT 1 FROM users WHERE role = 'instructor' AND gemma_digest = 1 LIMIT 1"
		});
		if (!master.rows.length) return { sent: [], reason: 'master-off' };
		const rows = await db.execute({
			sql: `SELECT u.id FROM users u
			      WHERE u.gemma_digest = 1 AND u.id != ?
			        AND (u.role = 'instructor' OR EXISTS (
			              SELECT 1 FROM class_memberships cm
			              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?))`,
			args: [GEMMA_ID, classId]
		});
		recipients = rows.rows.map((r) => String(r.id));
	}
	if (!recipients.length) return { sent: [], reason: 'no-recipients' };

	// Recap is class-wide — gather once, share across recipients.
	const recapLines = await gatherRecapLines(classId);
	const sent = [];
	for (const uid of recipients) {
		try {
			sent.push(await sendGemmaDigest({ userId: uid, classId, recapLines }));
		} catch (e) {
			sent.push({ userId: uid, delivered: false, reason: String(e?.message ?? e) });
		}
	}
	return { sent };
}
