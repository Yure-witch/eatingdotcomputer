/**
 * Composer emoji suggestions via Desert Ant Labs' Emo model
 * (https://desertant.com/models/emo/) — an on-device, multilingual phrase →
 * emoji classifier. Text stays on the device. Our versioned EmoWeb.wasm
 * patch removes usage-key generation, storage and reporting code
 * (vendor/emo/NO-USAGE.md).
 *
 * Runs on the main thread: LiteRT.js loads its runtime via importScripts or a
 * <script> tag, neither of which exists in our module workers. Inference is
 * ~2ms, so that's fine — but the load (EmoWeb.wasm + LiteRT wasm + an 11MB
 * .tflite, cached after first visit) is not free, so chats start warming it
 * 500ms after mount. An earlier keystroke can start loading immediately.
 *
 * Every runtime file comes from our R2 bucket (scripts/upload-emo-assets.mjs),
 * not Hugging Face / jsDelivr. EmoWeb.wasm's URL is hard-wired inside the SDK,
 * so vite.config.js rewrites it (emoWasmFromR2); the rest are load options.
 *
 *   prewarmEmo()                      — schedules the load; returns cleanup
 *   await initEmo()                   — idempotent; waits for the load
 *   await suggestEmoji('pay my bills') — waits for readiness, then suggests
 */

import { loadEmojiData } from '$lib/emoji-data.js';
import { createEmojiSearchIndex, relatedEmojiMatches, fuzzyEmojiMatches, normalizeEmojiQuery } from '$lib/emoji-search.js';

const EMO_R2 = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/vendor/emo';

let emo = null;
let loading = null;
let failed = false;

// EmojiPicker persists the last picked skin tone as a modifier codepoint.
const TONES = { '1F3FB': 'light', '1F3FC': 'mediumLight', '1F3FD': 'medium', '1F3FE': 'mediumDark', '1F3FF': 'dark' };

// LiteRT's native core prints a dozen INFO/WARNING lines (accelerator
// registration, "NPU could not be loaded", XNNPACK…) through Emscripten's
// stdout on startup, each with a full stack trace in DevTools. Emscripten
// reads print/printErr off a global `Module` when its factory runs, and
// LiteRT's loader passes `self.Module` straight in (then clears it), so hand
// it one that drops those diagnostics and forwards anything else.
const QUIET = Symbol('emo-quiet');
function quietLiteRt() {
	if (self.Module) return; // someone else's Emscripten load in flight — leave it
	const forward = (line) => { if (!/^(INFO|WARNING): /.test(line)) console.warn('[litert]', line); };
	self.Module = { print: forward, printErr: forward, [QUIET]: true };
}

// The original reporting build persisted these keys. The patched wasm never
// creates them, but an existing browser profile can still contain old values.
// Remove only vendor usage data; do not persist a migration marker.
function clearLegacyEmoUsage() {
	try {
		const storage = window.localStorage;
		for (let i = storage.length - 1; i >= 0; i--) {
			const key = storage.key(i);
			if (key?.startsWith('ai.desertant.usage.')) storage.removeItem(key);
		}
	} catch { /* Storage can be unavailable in private/restricted contexts. */ }
}

/** Pass to onMount; leaving the chat before 500ms cancels the warm-up. */
export function prewarmEmo() {
	const timer = setTimeout(initEmo, 500);
	return () => clearTimeout(timer);
}

export function initEmo() {
	if (typeof window === 'undefined' || loading || failed) return loading;
	clearLegacyEmoUsage();
	loadNameIndex();
	loading = import('@desert-ant-labs/emo')
		// Versioned keys: litert-* must match the exact @litertjs/core version
		// in package.json, model-* the Hugging Face tag this SDK version pins.
		.then(({ Emo }) => {
			quietLiteRt();
			return Emo.load({
				litertWasmDir: `${EMO_R2}/litert-2.5.3/`,
				modelBaseUrl: `${EMO_R2}/model-v0.7.0/`
			});
		})
		.then((model) => { emo = model; })
		.finally(() => { if (self.Module?.[QUIET]) self.Module = undefined; })
		.catch((err) => {
			failed = true;
			console.warn('[emo] failed to load emoji suggestion model', err);
		});
	return loading;
}

/**
 * The phrase worth classifying: the clause being typed, not the whole draft —
 * suggestions should follow what was just written. Strips formatting markup,
 * inline emoji tokens, URLs and @mentions so they don't skew the model.
 */
export function suggestionPhrase(raw) {
	const plain = raw
		.replace(/[\uE100-\uE1FF]/g, '')
		.replace(/\[(?:ce|ek|tgc?):[^\]]*\]/g, ' ')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/@\w+/g, ' ');
	const clause = plain.split(/[.!?\n]+(?=\s|$)/).filter((s) => s.trim()).at(-1) ?? '';
	return clause.trim().split(/\s+/).slice(-12).join(' ');
}

// Show the bar only when the model is fairly sure about its top pick, then
// drop the long tail so a confident "🍕" isn't padded with noise.
// Calibrated on class-chat phrases: real questions often top out at 0.15–0.2
// ("can someone explain recursion" ❓0.17, "…the fly neurons?" 👂0.18), while
// filler stays ≤ 0.12 ("the" 0.10, "that is so funny" 🦙0.12).
const MIN_TOP = 0.15;
const MIN_REST = 0.03;

// Never suggested — the model offers 🍆 for "lol", and this is a class app.
const BLOCKED = new Set(['🍆', '🍑']);

// Words that carry no emoji of their own; skipped by the per-word pass.
const STOP = new Set(('a an the and or but so to of in on at for with about from by as into than then ' +
	'is are was were be been being am do does did done has have had having will would can could should ' +
	'may might must shall i me my mine you your yours he him his she her hers it its we us our they them ' +
	'their this that these those there here what when where who whom why how which any anyone anything ' +
	'some someone something every everyone all just really very too also not no yes yeah ok okay hey hi ' +
	'hello like get got gonna wanna know think see saw heard hear said say tell told lol lmao omg').split(' '));

// One-word emoji names that are too often a different everyday word.
const NAME_DENY = new Set(['pick', 'hole', 'sake', 'mate', 'ram', 'ewe', 'adult', 'kiss', 'watch', 'ring', 'seal', 'guard']);

// Emo's vocabulary omits common faces (including 😡, 😭 and 😟), and some
// emotion words produce unrelated predictions. Explicit emotion words get
// literal matches, just as object names do, without lowering model thresholds.
const EMOTION_EMOJI = new Map([
	['angry anger mad furious enraged rage', ['😡', '😠', '😤']],
	['frustrated frustration annoyed irritated fuming', ['😤', '😠', '😡']],
	['sad sadness unhappy miserable', ['😢', '😔', '😭']],
	['cry crying cried sob sobbing', ['😭', '😢']],
	['upset', ['😞', '😠', '😡']],
	['disappointed disappointment dejected', ['😞', '😔']],
	['worried worry worrying anxious anxiety nervous stressed stress', ['😟', '😰', '😥']],
	['scared afraid frightened fearful terrified', ['😨', '😱']],
	['heartbroken heartbreak', ['💔', '😭']],
	['lonely loneliness', ['😔', '🥺']],
	['bored boredom', ['😑', '🥱']],
	['tired exhausted exhaustion', ['😩', '😴']],
	['happy happiness joyful delighted', ['😊', '😄', '😁']],
	['excited excitement', ['🤩', '🥳']]
].flatMap(([words, emoji]) => words.split(' ').map(word => [word, emoji])));
const EMOTION_FILLER = new Set(["i'm", 'feeling', 'feel', 'felt', 'right', 'now', 'today', 'bit', 'little', 'extremely', 'absolutely', 'totally']);
const FUZZY_FILLER = new Set(['want', 'wants', 'need', 'needs', 'please', 'trying', 'going', 'looking', 'searching', 'make', 'making', 'doing']);
const EMOTION_SCORE = 0.8;

function emotionMatches(text) {
	const normalized = text.toLowerCase().replaceAll('’', "'");
	const matches = new Map();
	for (const match of normalized.matchAll(/[\p{L}\p{N}']+/gu)) {
		const emoji = EMOTION_EMOJI.get(match[0]);
		if (!emoji) continue;
		// Do not force an angry/sad face for "not angry" or "not very sad".
		const negated = /\b(?:not|never|no longer|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|can't)(?:\s+(?:really|very|so|that|at all))*\s+$/.test(normalized.slice(0, match.index));
		matches.set(match[0], { emoji, negated });
	}
	return matches;
}

function nameWords(text) {
	return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

// emoji-data.json combines CSV names/shortcodes/order with Unicode CLDR's
// annotations/en.xml keywords and our supplemental keywords. Index phrases
// as well as name words: "pouting face", "rage", and "pouting" all find 😡;
// annotation keywords such as "goofy" can find 🤪 without a model prediction.
let nameIndex = null;
function loadNameIndex() {
	nameIndex ??= loadEmojiData().then((d) => {
		const phrases = new Map(), words = new Map();
		let maxWords = 1;
		for (const g of d.groups || []) for (const it of g.items || []) {
			const n = it.n || '';
			const aliases = [
				...[n, ...(it.sc ?? [])].map(alias => ({ alias, score: NAME_SCORE })),
				...(it.kw ?? []).map(alias => ({ alias, score: KEYWORD_SCORE })),
				...(it.sy ?? []).map(alias => ({ alias, score: KEYWORD_SCORE }))
			];
			for (const { alias, score } of aliases) {
				const tokens = nameWords(alias);
				if (!tokens.length) continue;
				if (score <= KEYWORD_SCORE && tokens.every(word => word.length < 3 || STOP.has(word) || NAME_DENY.has(word))) continue;
				const key = tokens.join(' ');
				const embedded = tokens.length > 1 || (n === n.toLowerCase() && !NAME_DENY.has(key));
				if (!phrases.has(key)) phrases.set(key, []);
				// Names precede keywords, so a duplicate keeps its stronger score.
				if (!phrases.get(key).some(hit => hit.emoji === it.e)) phrases.get(key).push({ emoji: it.e, embedded, score });
				maxWords = Math.max(maxWords, tokens.length);
			}
			// Single proper names (Chad, Cancer…) only match an explicit whole
			// query; avoid turning ordinary mentions into flags/zodiac symbols.
			if (n !== n.toLowerCase()) continue;
			for (const word of new Set(nameWords(n))) {
				if (word.length < 3 || STOP.has(word) || NAME_DENY.has(word)) continue;
				if (!words.has(word)) words.set(word, []);
				words.get(word).push(it.e);
			}
		}
		return { phrases, words, maxWords, catalog: createEmojiSearchIndex(d) };
	}).catch(() => ({ phrases: new Map(), words: new Map(), maxWords: 1, catalog: null }));
	return nameIndex;
}

function annotationMatches(text, index) {
	const tokens = nameWords(text);
	const covered = new Set(), phraseWords = new Set(), matchedWords = new Set(), emoji = new Map();
	// Longest literal names first, so "black cat" isn't crowded out by "cat".
	for (let size = Math.min(index.maxWords, tokens.length); size > 0; size--) {
		for (let start = tokens.length - size; start >= 0; start--) {
			if (Array.from({ length: size }, (_, i) => start + i).some(i => covered.has(i))) continue;
			const phrase = tokens.slice(start, start + size).join(' ');
			const hits = (index.phrases.get(phrase) ?? []).filter(hit => hit.embedded || size === tokens.length);
			if (!hits.length) continue;
			for (const hit of hits) emoji.set(hit.emoji, Math.max(emoji.get(hit.emoji) ?? 0, hit.score));
			for (let i = start; i < start + size; i++) {
				covered.add(i);
				matchedWords.add(tokens[i]);
				// A one-word shortcode can coexist with other literal name hits:
				// "pouting" is 🙎's shortcode and part of 😡's name.
				if (size > 1) phraseWords.add(tokens[i]);
			}
		}
	}
	return { emoji, phraseWords, matchedWords, whole: index.phrases.has(tokens.join(' ')) };
}

/** Content words of the phrase, most recent first. */
function contentWords(phrase, limit = 3) {
	const seen = new Set();
	return phrase.toLowerCase().split(/[^\p{L}\p{N}'-]+/u)
		.map((w) => w.replace(/^['-]+|['-]+$/g, ''))
		.filter((w) => w.length >= 3 && !STOP.has(w))
		.reverse()
		.filter((w) => !seen.has(w) && seen.add(w))
		.slice(0, limit);
}

// Two groups, so neither crowds out the other:
//  - "word": what the last few content words mean on their own. The
//    whole-clause read dilutes strong single words ("has anyone heard about
//    the fly neurons" puts 🧠 at 0.03, but "neurons" alone is 🧠 0.69), and
//    the model can miss a literal name entirely ("fly" reads as travel, never
//    🪰) — so: each word's own pick when the model is sure, plus an exact
//    emoji-name match.
//  - "idea": the model's read of the whole clause — the conceptual picks
//    (👂🤔❓ for a question about something heard).
// Three word picks lead in prose; direct searches may use the remaining slots
// for additional literal matches, related concepts and lower-ranked name typos.
const WORD_MIN = 0.5;
const NAME_SCORE = 1;
const NAME_WORD_SCORE = 0.7;
const KEYWORD_SCORE = 0.65;
const WORD_SLOTS = 3;

/** @returns {Promise<{ emoji: string, confidence: number, kind: 'word' | 'idea' }[]>} */
export async function suggestEmoji(text, limit) {
	const explicitLimit = limit !== undefined;
	limit = Math.max(0, Math.floor(limit ?? 8));
	if (!limit) return [];
	if (!emo) await initEmo();
	let skinTone = 'default';
	try { skinTone = TONES[localStorage.getItem('emoji-tone')] ?? 'default'; } catch {}
	try {
		const words = new Map();
		const emotions = emotionMatches(text);
		const allTerms = contentWords(text.replaceAll('’', "'"), Infinity);
		const meaningful = allTerms.filter(word => !EMOTION_FILLER.has(word));
		const terms = (emotions.size ? meaningful : allTerms).slice(0, 3);
		const emotionOnly = meaningful.length > 0 && meaningful.every(word => EMOTION_EMOJI.has(word));
		const negatedEmoji = new Set([...emotions.values()].filter(match => match.negated).flatMap(match => match.emoji));
		const addWord = (emoji, score) => {
			if (BLOCKED.has(emoji) || negatedEmoji.has(emoji) || words.get(emoji) >= score) return;
			// An upgraded match takes its stronger source's tie-breaking order.
			words.delete(emoji);
			words.set(emoji, score);
		};
		const names = await loadNameIndex();
		const family = names.catalog?.families.get(normalizeEmojiQuery(text));
		if (family?.length) {
			return family.slice(0, explicitLimit ? limit : family.length)
				.map(hit => ({ emoji: hit.item.e, confidence: NAME_SCORE, kind: 'word' }));
		}
		for (const [word, emotion] of emotions) {
			if (!emotion.negated) continue;
			for (const hit of names.phrases.get(word) ?? []) negatedEmoji.add(hit.emoji);
			for (const emoji of names.words.get(word) ?? []) negatedEmoji.add(emoji);
		}
		const literal = annotationMatches(emotionOnly ? meaningful.join(' ') : text, names);
		const related = names.catalog ? relatedEmojiMatches(names.catalog, text, !literal.whole) : [];
		const conceptWhole = names.catalog?.concepts.has(normalizeEmojiQuery(text));
		const fuzzyWhole = names.catalog && !literal.whole && !emotionOnly ? fuzzyEmojiMatches(names.catalog, text) : [];
		for (const [emoji, score] of literal.emoji) addWord(emoji, score);
		// Sequential: the SDK drives one LiteRT session; don't interleave runs.
		for (const word of terms) {
			const emotion = emotions.get(word);
			if (emotion) {
				if (!emotion.negated) for (const emoji of emotion.emoji) addWord(emoji, EMOTION_SCORE);
				continue;
			}
			if (emotionOnly) continue;
			if (nameWords(word).every(token => literal.phraseWords.has(token))) continue;
			const byName = [word, word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')]
				.map((w) => names.words.get(w)).find(Boolean);
			if (byName) {
				for (const emoji of byName.slice(0, WORD_SLOTS)) addWord(emoji, NAME_WORD_SCORE);
				continue;
			}
			if (nameWords(word).every(token => literal.matchedWords.has(token))) continue;
			if (fuzzyWhole.length || names.catalog?.concepts.has(normalizeEmojiQuery(word))) continue;
			for (const h of emo ? await emo.suggestions(word, { limit: 2, skinTone }) : []) {
				if (h.confidence >= WORD_MIN) addWord(h.emoji, h.confidence);
			}
		}
		const wordPicks = [...words]
			.sort((a, b) => b[1] - a[1])
			.slice(0, Math.min(WORD_SLOTS, limit))
			.map(([emoji, confidence]) => ({ emoji, confidence, kind: 'word' }));

		// Keep additional direct matches and related concepts. The old three-word
		// cap discarded useful results even when the suggestion bar had room.
		const result = [...wordPicks];
		const taken = new Set(result.map(p => p.emoji));
		const append = hit => {
			if (result.length >= limit || taken.has(hit.emoji) || BLOCKED.has(hit.emoji) || negatedEmoji.has(hit.emoji)) return;
			taken.add(hit.emoji);
			result.push(hit);
		};
		if (literal.whole || emotionOnly) for (const [emoji, confidence] of [...words].sort((a, b) => b[1] - a[1])) {
			if (confidence >= KEYWORD_SCORE) append({ emoji, confidence, kind: 'word' });
		}
		for (const hit of related) append({ emoji: hit.item.e, confidence: 0.55 - hit.rank * 0.001, kind: 'idea' });
		// A plain emotion phrase already has exact matches; appending the model's
		// finance/gambling guesses for "angry" would only dilute those matches.
		const clause = !emo || emotionOnly || literal.whole || conceptWhole || fuzzyWhole.length || result.length >= limit ? [] : (await emo.suggestions(text, { limit: limit + BLOCKED.size, skinTone }))
			.filter((h) => !BLOCKED.has(h.emoji) && !negatedEmoji.has(h.emoji));
		const ideaPicks = clause[0]?.confidence >= MIN_TOP
			? clause
				.filter((h) => h.confidence >= MIN_REST && !taken.has(h.emoji))
				.slice(0, limit - result.length)
				.map((h) => ({ ...h, kind: 'idea' }))
			: [];
		for (const hit of ideaPicks) append(hit);
		// At most two name typos, after every other match source. Do not fuzz
		// negated emotion phrases or replace stronger results to make room.
		if (names.catalog && !emotionOnly && !literal.whole && result.length < limit) {
			const queries = new Set([text, ...terms.filter(word => !literal.matchedWords.has(word) && !emotions.has(word) && !EMOTION_FILLER.has(word) && !FUZZY_FILLER.has(word))]);
			const candidates = new Map();
			for (const query of queries) for (const hit of fuzzyEmojiMatches(names.catalog, query)) {
				if (taken.has(hit.item.e) || BLOCKED.has(hit.item.e) || negatedEmoji.has(hit.item.e)) continue;
				if (!candidates.has(hit.item.e) || candidates.get(hit.item.e).similarity < hit.similarity) candidates.set(hit.item.e, hit);
			}
			for (const hit of [...candidates.values()].sort((a, b) => b.similarity - a.similarity || a.extraWords - b.extraWords).slice(0, 2)) {
				append({ emoji: hit.item.e, confidence: hit.similarity * 0.3, kind: 'idea', match: 'fuzzy' });
			}
		}
		return result;
	} catch {
		return [];
	}
}
