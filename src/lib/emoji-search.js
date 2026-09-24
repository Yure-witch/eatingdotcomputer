// Shared, synchronous search for the picker and composer. No storage or network.
// Ligatures and stroked letters have no NFKD decomposition, so "coeur" would
// miss ❤️ "cœur rouge" and "strasse" would miss "straße". Folded on both sides
// (query and catalog terms run through here), which also keeps English intact.
const LIGATURES = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };
export const normalizeEmojiQuery = text => String(text).normalize('NFKD').replace(/\p{M}/gu, '')
	.toLowerCase().replace(/[œæßøłđðþı]/g, (c) => LIGATURES[c])
	.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const glyphKey = text => text.replaceAll('\uFE0F', '');
const indexes = new WeakMap();

export function createEmojiSearchIndex(data) {
	if (indexes.has(data)) return indexes.get(data);
	const entries = (data.groups ?? []).flatMap(group => group.items).map(item => ({
		item, name: normalizeEmojiQuery(item.n), tokens: normalizeEmojiQuery(item.n).split(' '),
		shortcodes: (item.sc ?? []).map(normalizeEmojiQuery)
	}));
	const byGlyph = new Map(entries.map(entry => [glyphKey(entry.item.e), entry]));
	const concepts = new Map();
	let maxConceptWords = 1;
	for (const concept of data.concepts ?? []) for (const term of concept.terms) {
		const key = normalizeEmojiQuery(term);
		const hits = concepts.get(key) ?? new Map();
		concept.emoji.forEach((glyph, rank) => {
			const entry = byGlyph.get(glyphKey(glyph));
			if (entry && (!hits.has(entry.item.e) || hits.get(entry.item.e).rank > rank)) hits.set(entry.item.e, { ...entry, rank });
		});
		concepts.set(key, hits);
		maxConceptWords = Math.max(maxConceptWords, key.split(' ').length);
	}
	const families = new Map();
	for (const family of data.families ?? []) {
		const members = family.emoji.map(glyph => byGlyph.get(glyphKey(glyph))).filter(Boolean)
			.map((entry, rank) => ({ ...entry, rank, tier: 0, kind: 'family' }));
		for (const term of family.terms) families.set(normalizeEmojiQuery(term), members);
	}
	const index = { entries, concepts, maxConceptWords, families };
	indexes.set(data, index);
	return index;
}

/**
 * Hang CLDR's localized names and keywords (emoji-locale-kw.js) off the index
 * so a Spanish browser matches "corazón" and a Japanese one "ハート". English
 * keywords keep working either way — this adds terms, it never replaces them.
 * Cheap to call repeatedly; only re-walks the entries when the locale changes.
 */
export function attachLocaleKeywords(index, locale) {
	const tag = locale?.locale ?? null;
	if (index.localeTag === tag) return index;
	index.localeTag = tag;
	for (const entry of index.entries) {
		const parts = tag ? locale.terms.get(glyphKey(entry.item.e)) : null;
		// [name, …keywords] — normalized the same way queries are, so accents
		// and case don't decide whether a student finds their emoji.
		entry.locale = parts?.length ? parts.map(normalizeEmojiQuery).filter(Boolean) : null;
	}
	return index;
}

/** Mirrors literalTier's ladder, one step softer: English names are canonical. */
function localeTier(entry, query) {
	const terms = entry.locale;
	if (!terms || !query) return 0;
	const exact = terms.indexOf(query);
	if (exact === 0) return 2;                                   // the localized name
	// The name leading with the query beats a keyword hit: "corazón" should
	// find ❤️ "corazón rojo" before 😍, which only lists it as a keyword.
	if (terms[0]?.startsWith(query)) return 3;
	if (exact > 0) return 4;                                     // a localized keyword
	if (terms.some((t) => t.startsWith(query))) return 5;
	if (terms.some((t) => t.includes(query))) return 7;
	return 0;
}

// Adjacent transpositions count as one typo ("haert" → "heart").
export function nameEditDistance(a, b, max = 2) {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i), beforePrevious;
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
		}
		beforePrevious = previous;
		previous = row;
	}
	return previous[b.length];
}

function fuzzySimilarity(tokens, entry) {
	if (!tokens.length || tokens.length > entry.tokens.length || tokens.length > 12) return 0;
	const used = new Set();
	let edits = 0, letters = 0;
	for (const token of tokens) {
		const budget = token.length < 4 ? 0 : token.length < 7 ? 1 : 2;
		let best = budget + 1, bestIndex = -1;
		for (let i = 0; i < entry.tokens.length; i++) {
			if (used.has(i)) continue;
			const distance = nameEditDistance(token, entry.tokens[i], budget);
			if (distance < best) { best = distance; bestIndex = i; }
		}
		if (bestIndex < 0 || best > budget) return 0;
		used.add(bestIndex);
		edits += best;
		letters += Math.max(token.length, entry.tokens[bestIndex].length);
	}
	// Never fuzz a short word by itself, or accept a phrase with many errors.
	if (tokens.length === 1 && tokens[0].length < 4 || edits > Math.max(2, Math.floor(letters / 7))) return 0;
	return 1 - edits / letters;
}

export function fuzzyEmojiMatches(index, query, limit = 2) {
	const tokens = normalizeEmojiQuery(query).split(' ').filter(Boolean);
	return index.entries.map(entry => ({ item: entry.item, similarity: fuzzySimilarity(tokens, entry), extraWords: entry.tokens.length - tokens.length, kind: 'fuzzy', tier: 9 }))
		.filter(hit => hit.similarity >= 0.75)
		.sort((a, b) => b.similarity - a.similarity || a.extraWords - b.extraWords || (a.item.oi ?? 0) - (b.item.oi ?? 0)).slice(0, limit);
}

function isNegated(tokens, start) {
	return /\b(?:not|never|no|without)(?:\s+(?:really|very|any|more))*$/.test(tokens.slice(Math.max(0, start - 4), start).join(' '));
}

export function relatedEmojiMatches(index, query, embedded = false) {
	const normalized = normalizeEmojiQuery(query), tokens = normalized.split(' ');
	const hits = new Map();
	const add = matches => { for (const hit of matches?.values() ?? []) {
		if (!hits.has(hit.item.e) || hits.get(hit.item.e).rank > hit.rank) hits.set(hit.item.e, hit);
	} };
	if (!embedded) add(index.concepts.get(normalized));
	else for (let size = Math.min(index.maxConceptWords, tokens.length); size > 0; size--) {
		for (let start = 0; start + size <= tokens.length; start++) {
			if (!isNegated(tokens, start)) add(index.concepts.get(tokens.slice(start, start + size).join(' ')));
		}
	}
	return [...hits.values()].sort((a, b) => a.rank - b.rank || (a.item.oi ?? 0) - (b.item.oi ?? 0))
		.map(hit => ({ ...hit, tier: 8, kind: 'related' }));
}

function literalTier(entry, raw, query) {
	const { item, name, shortcodes } = entry;
	if (shortcodes.includes(query) || item.scr?.includes(raw)) return 1;
	if (name === query || item.e === raw) return 2;
	if (query && shortcodes.some(s => s.startsWith(query))) return 3;
	if (query && name.startsWith(query)) return 4;
	if (item.st?.some(t => t.startsWith(raw))) return 5;
	if (item.al?.some(a => a.toLowerCase().includes(raw))) return 6;
	if (item.st?.some(t => t.includes(raw))) return 7;
	return 0;
}

/** Best of the English and localized ladders — a hit in either one counts. */
function matchTier(entry, raw, query) {
	const english = literalTier(entry, raw, query);
	const localized = localeTier(entry, query);
	return english && localized ? Math.min(english, localized) : english || localized;
}

export function searchEmojiCatalog(index, text, { limit = 96, semanticScores, includeFuzzy = true, includeRelated = true } = {}) {
	const raw = String(text).toLowerCase().trim(), query = normalizeEmojiQuery(raw);
	if (!raw) return [];
	const hits = new Map();
	for (const entry of index.entries) {
		const tier = matchTier(entry, raw, query);
		if (tier) hits.set(entry.item.e, { item: entry.item, tier, kind: 'literal', similarity: 1 });
	}
	for (const hit of index.families.get(query) ?? []) hits.set(hit.item.e, hit);
	if (includeRelated) for (const hit of relatedEmojiMatches(index, query)) if (!hits.has(hit.item.e)) hits.set(hit.item.e, hit);
	if (includeFuzzy) {
		const fuzzy = fuzzyEmojiMatches(index, query, index.entries.length).filter(hit => !hits.has(hit.item.e)).slice(0, 2);
		for (const hit of fuzzy) hits.set(hit.item.e, hit);
	}
	return [...hits.values()].sort((a, b) => a.tier - b.tier
		|| (a.kind === 'fuzzy' ? b.similarity - a.similarity || a.extraWords - b.extraWords : a.kind === 'related' || a.kind === 'family' ? a.rank - b.rank : 0)
		|| ((semanticScores?.get(b.item.cp) ?? 0) - (semanticScores?.get(a.item.cp) ?? 0))
		|| (a.item.oi ?? 0) - (b.item.oi ?? 0)).slice(0, limit);
}
