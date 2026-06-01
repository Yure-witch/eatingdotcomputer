/**
 * Mention parsing + matching helpers, shared between chat compose
 * (autocomplete + send) and bubble rendering (pill highlighting).
 *
 * Storage shape:
 *   - Message content stays as plain text: "hey @Richard come look at this"
 *   - Each message carries a separate `mentions` array:
 *       [{ uid: 'abc-123', offset: 4, len: 8 }, ...]
 *     where `offset`/`len` index into the content string and exactly
 *     overlap the rendered display name.
 *
 * The plain-text content survives Firebase → Turso archival as-is; the
 * mentions array rides alongside (JSON-encoded for Turso, structured
 * object in RTDB).
 */

// Matches a mention trigger at the very end of a string: `@` followed by
// any amount of typed name fragment. Used by the compose input to
// detect when the autocomplete popover should be visible and what the
// user has typed so far.
//   "hi @ric"     → match, query = "ric"
//   "hi @"        → match, query = ""        (empty popover shows all members)
//   "hi @O'Bri"   → match, query = "O'Bri"   (apostrophe ok)
//   "@José"       → match, query = "José"    (unicode letters ok)
//   "email a@b"   → no match (preceded by non-whitespace)
//
// The trigger ends at any whitespace AFTER non-empty input — that lets
// "@Richard Y" stay open (user mid-type of a 2-word name) but lets the
// popover dismiss naturally once a complete handle is committed by the
// next keystroke (handled by the picker's own close on selection).
const MENTION_TRIGGER = /(?:^|\s)@([\p{L}\p{N}_'\-\s]*)$/u;

export function detectMentionTrigger(textBeforeCaret) {
	const m = MENTION_TRIGGER.exec(textBeforeCaret);
	if (!m) return null;
	// The whitespace alternation in the regex is non-capturing, so m.index
	// either points AT the `@` (start-of-string case) or one char before
	// it (whitespace case). Find the `@` inside m[0] and add its offset.
	const atIdx = m.index + m[0].indexOf('@');
	return { atIdx, query: m[1] || '' };
}

// Score and rank candidates against the user's typed query. Case-
// insensitive prefix match wins; substring match falls back. Empty
// query returns the full list in original (server-sorted) order.
export function filterMembers(members, query) {
	const q = (query || '').trim().toLowerCase();
	if (!q) return members.slice(0, 8);
	const scored = [];
	for (const m of members) {
		const name = (m.name || '').toLowerCase();
		if (!name) continue;
		let score;
		if (name.startsWith(q)) score = 0;
		else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 1;
		else if (name.includes(q)) score = 2;
		else continue;
		scored.push({ m, score });
	}
	scored.sort((a, b) => a.score - b.score || (a.m.name || '').localeCompare(b.m.name || ''));
	return scored.slice(0, 8).map((s) => s.m);
}

/**
 * Build the new content + mentions list after the user picks a member
 * from the autocomplete. `atIdx` is the index of the `@` that triggered
 * the autocomplete; everything from there to the caret is the partial
 * query and gets replaced with the resolved name. Existing mentions
 * after the insertion point have their offsets shifted.
 *
 * Returns: { content, mentions, caret } where caret is the new caret
 * position right after the inserted mention + a trailing space.
 */
export function applyMentionPick(content, mentions, atIdx, caretIdx, member) {
	const before = content.slice(0, atIdx);
	const after = content.slice(caretIdx);
	const insertedDisplay = '@' + member.name;
	const insertedWithSpace = insertedDisplay + ' ';
	const newContent = before + insertedWithSpace + after;
	const nameOffset = atIdx + 1; // skip the `@`
	const nameLen = (member.name || '').length;
	const replacedLen = caretIdx - atIdx;        // chars we replaced (incl. the `@` + query)
	const insertedLen = insertedWithSpace.length;
	const delta = insertedLen - replacedLen;
	// Drop any old mentions that overlapped the replaced range; shift
	// the rest by delta if they were after caretIdx.
	const updated = (mentions || [])
		.filter((m) => m.offset + m.len <= atIdx || m.offset >= caretIdx)
		.map((m) => (m.offset >= caretIdx ? { ...m, offset: m.offset + delta } : m));
	updated.push({ uid: member.id, offset: nameOffset, len: nameLen });
	updated.sort((a, b) => a.offset - b.offset);
	return {
		content: newContent,
		mentions: updated,
		caret: atIdx + insertedLen
	};
}

/**
 * Split a content string into an ordered list of render segments so the
 * bubble can interleave text and mention pills:
 *   [{ type: 'text', text }, { type: 'mention', uid, name }, ...]
 *
 * Robust to mentions whose offsets fell out of sync with the content
 * (defensive): silently drops mentions whose range doesn't actually
 * line up with text, and falls back to plain text.
 */
export function segmentMentions(content, mentions) {
	const text = content || '';
	const ms = Array.isArray(mentions) ? [...mentions].sort((a, b) => a.offset - b.offset) : [];
	if (!ms.length) return [{ type: 'text', text }];
	const out = [];
	let cursor = 0;
	for (const m of ms) {
		if (typeof m?.offset !== 'number' || typeof m?.len !== 'number') continue;
		if (m.offset < cursor || m.offset + m.len > text.length) continue;
		if (m.offset > cursor) out.push({ type: 'text', text: text.slice(cursor, m.offset) });
		out.push({ type: 'mention', uid: m.uid, name: text.slice(m.offset, m.offset + m.len) });
		cursor = m.offset + m.len;
	}
	if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
	return out;
}

/**
 * Convenience: collect the uids of users mentioned in a message,
 * deduped. Used by the send path to write notifications.
 */
export function mentionedUids(mentions) {
	if (!Array.isArray(mentions)) return [];
	const set = new Set();
	for (const m of mentions) {
		if (m?.uid) set.add(m.uid);
	}
	return Array.from(set);
}

/**
 * Slack-style at-send resolver: scan plain-text content for `@Name`
 * fragments and match each against the class member roster. Builds
 * the mentions array used by render + notification routing.
 *
 * Matching rules:
 *   - `@` must be at start-of-string or preceded by whitespace (so we
 *     don't catch email addresses like `richard@gmail.com`).
 *   - Greedy match: prefer the longest member name that fits. So
 *     `@Richard Yurewitch` resolves to the 2-word name if both
 *     "Richard" and "Richard Yurewitch" exist in the class.
 *   - Case-insensitive comparison, but offsets/lengths refer to the
 *     exact slice of the original content.
 *   - First-match-wins on ambiguity (two users named "Alex" → one of
 *     them gets the mention; both get notified is not the v1 design).
 *
 * Members: array of `{ id, name }`. Order doesn't affect correctness.
 */
export function resolveMentionsFromText(content, members) {
	if (!content || !Array.isArray(members) || !members.length) return [];
	const text = content;
	// Pre-sort members by name length DESC so longest names match first
	// at a given position (greedy left-to-right scan).
	const sorted = members
		.filter((m) => m && m.id && m.name)
		.slice()
		.sort((a, b) => b.name.length - a.name.length);
	const mentions = [];
	const lower = text.toLowerCase();
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '@') continue;
		if (i > 0 && !/\s/.test(text[i - 1])) continue;
		const start = i + 1; // first char of the name fragment
		let matched = null;
		for (const m of sorted) {
			const name = m.name;
			const nameLower = name.toLowerCase();
			if (lower.startsWith(nameLower, start)) {
				// Ensure the match ends at a word boundary (don't
				// match "@Al" against member "Alex").
				const endChar = text[start + name.length];
				if (endChar === undefined || /[\s.,;:!?)\]]/.test(endChar)) {
					matched = { uid: m.id, offset: start, len: name.length };
					break;
				}
			}
		}
		if (matched) {
			mentions.push(matched);
			i = matched.offset + matched.len - 1; // skip past the match
		}
	}
	return mentions;
}
