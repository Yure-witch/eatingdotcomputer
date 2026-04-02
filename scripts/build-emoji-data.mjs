#!/usr/bin/env node
/**
 * Generates static/emoji-data.json from emojiOrdering.csv + CLDR keyword annotations.
 *
 * Data sources:
 *   - emojiOrdering.csv  (Google emoji ordering, Unicode 17) — backend only, never exposed
 *   - CLDR annotations/en.xml        (official English keywords — same data as emoji-list.html)
 *   - CLDR annotationsDerived/en.xml (auto-derived English keywords)
 *
 * Output per emoji item:
 *   {
 *     e:   string,   // emoji glyph (may be multi-codepoint: ZWJ, skin tones, flags)
 *     n:   string,   // CLDR short name
 *     cp:  string,   // codepoint string e.g. "1F600" or "1F468 200D 1F469"
 *     sc:  string[], // shortcodes without colons  e.g. ["heart-face","3-hearts"]
 *     scr: string[], // shortcodes with colons      e.g. [":heart-face:",":3-hearts:"]
 *     al:  string[], // aliases / emoticons         e.g. [":D", "<3"]
 *     kw:  string[], // CLDR keyword annotations
 *     st:  string[], // pre-normalized search terms (lowercase, hyphen-expanded)
 *     oi:  number,   // order index (row order in CSV = canonical emoji order)
 *     t?:  [{e,cp}]  // skin-tone variants
 *   }
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Supplemental keywords for emoji absent from fullAnnotations.html
// ─────────────────────────────────────────────────────────────────────────────
const SUPPLEMENTAL_KW = {
	'1F610': ['neutral', 'face', 'expressionless', 'blank', 'deadpan', 'meh', 'indifferent', 'unamused', 'awkward', 'straight face'],
	'1FAE2': ['face', 'hand', 'mouth', 'gasp', 'shocked', 'embarrassed', 'amazed', 'awe', 'disbelief', 'oops', 'shh', 'quiet'],
	'1F47A': ['goblin', 'monster', 'creature', 'japanese', 'tengu', 'demon', 'angry', 'face', 'fairy tale', 'red', 'mask'],
	'1F91D': ['handshake', 'hand', 'agreement', 'deal', 'meeting', 'partnership', 'greet', 'shake', 'business', 'collaboration'],
	'1F483': ['dance', 'dancer', 'dancing', 'woman', 'party', 'celebrate', 'move', 'elegant', 'salsa', 'disco'],
	'1F433': ['whale', 'spouting', 'animal', 'ocean', 'sea', 'water', 'spray', 'blowing', 'marine', 'mammal', 'beach'],
	'1F9CB': ['bubble tea', 'boba', 'milk tea', 'drink', 'tapioca', 'straw', 'cup', 'taiwanese', 'beverage', 'food'],
	'1FA96': ['military helmet', 'helmet', 'army', 'soldier', 'combat', 'war', 'military', 'protection', 'gear', 'hard hat'],
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV parser  (handles quoted fields containing commas)
// ─────────────────────────────────────────────────────────────────────────────
function parseCSVRow(line) {
	const fields = [];
	let field = '';
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
			else inQuote = !inQuote;
		} else if (ch === ',' && !inQuote) {
			fields.push(field); field = '';
		} else {
			field += ch;
		}
	}
	fields.push(field);
	return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse the ordering column: "1F600 ; fully-qualified # 😀 grinning face"
// ─────────────────────────────────────────────────────────────────────────────
function parseOrdering(s) {
	if (!s || !s.includes(' # ')) return null;
	const hi = s.indexOf(' # ');
	const before = s.slice(0, hi);
	const after  = s.slice(hi + 3); // after the ' # '

	// Separator is normally " ; " but some rows use "; " (no leading space)
	let si = before.indexOf(' ; ');
	let sepLen = 3;
	if (si === -1) { si = before.indexOf(';'); sepLen = 1; }
	if (si === -1) return null;
	const codepoint = before.slice(0, si).trim();
	const qualifier = before.slice(si + sepLen).trim();

	// after = "{emoji_char(s)} [E{ver} ]{name}"
	// The emoji glyph ends at the first ASCII space; "E15.1 " version tag is optional.
	const spaceAt = after.indexOf(' ');
	if (spaceAt === -1) return null;
	const emoji = after.slice(0, spaceAt);
	const rest  = after.slice(spaceAt + 1).replace(/^E\d+\.\d+ /, '').trim();

	return { codepoint, qualifier, emoji, name: rest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalize a term for search: lowercase, strip punctuation, expand hyphens
// Returns deduplicated array of terms
// ─────────────────────────────────────────────────────────────────────────────
function expandTerm(raw) {
	const s = raw.toLowerCase().trim();
	if (!s) return [];
	const terms = new Set();
	terms.add(s);
	// hyphen → split parts + joined
	if (s.includes('-')) {
		const parts = s.split('-').filter(Boolean);
		for (const p of parts) if (p.length > 1) terms.add(p);
		const joined = parts.join('');
		if (joined !== s && joined.length > 1) terms.add(joined);
	}
	return [...terms];
}

function buildSearchTerms(item) {
	const all = new Set();

	// name words
	for (const word of item.n.split(/[\s\-_]+/)) {
		for (const t of expandTerm(word)) all.add(t);
	}

	// shortcodes (already stripped of colons)
	for (const sc of item.sc) {
		for (const t of expandTerm(sc)) all.add(t);
	}

	// aliases / emoticons (literal, for searching things like "<3" or "xD")
	for (const al of item.al) {
		const trimmed = al.toLowerCase().trim();
		if (trimmed) all.add(trimmed);
	}

	// CLDR keywords
	for (const kw of item.kw) {
		for (const t of expandTerm(kw)) all.add(t);
	}

	return [...all].filter(t => t.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read & parse CSV
// ─────────────────────────────────────────────────────────────────────────────
console.log('Parsing emojiOrdering.csv…');
const csv   = readFileSync(resolve(ROOT, 'emojiOrdering.csv'), 'utf8');
const lines = csv.split('\n');

const GROUP_ICONS = {
	'Smileys and emotions':  '😀',
	'People':                '👋',
	'Animals and nature':    '🐱',
	'Food and drink':        '🍕',
	'Travel and places':     '✈️',
	'Activities and events': '⚽',
	'Objects':               '💡',
	'Symbols':               '❤️',
	'Flags':                 '🏁',
};

const groups  = [];
let curGroup  = null;
let curSub    = null;
const toneMap = {};   // parentCp → [{ e, cp }]
const seen    = new Set();
let orderIdx  = 0;

for (const rawLine of lines) {
	const line = rawLine.trim();
	if (!line) continue;

	// ── Comment / metadata lines ────────────────────────────────────────────
	if (line.startsWith(',,#')) {
		const comment = line.slice(3).trim();
		const gm = comment.match(/^group:\s*(.+)/);
		const sm = comment.match(/^subgroup:\s*(.+)/);
		if (gm) {
			const gname = gm[1].replace(/[\s,]+$/, '').trim();
			curGroup = { name: gname, icon: GROUP_ICONS[gname] ?? '', denylist: false, items: [] };
			groups.push(curGroup);
			curSub = null;
		} else if (sm && curGroup) {
			const parts  = sm[1].replace(/[\s,]+$/, '').split(',');
			const sgname = parts[0].trim();
			curSub = { name: sgname, denylist: parts.some(p => p.trim() === 'denylist') };
		}
		continue;
	}
	if (line.startsWith('#')) continue;

	const fields = parseCSVRow(line);
	if (fields.length < 3) continue;

	// fields: [shortcode(s), ?, ordering, groupVariant, alias/emoticon, ?]
	const [shortcodeRaw, , orderingRaw, groupVariant, aliasRaw] = fields;
	const parsed = parseOrdering(orderingRaw);
	if (!parsed) continue;

	const { codepoint, qualifier, emoji, name } = parsed;

	if (qualifier !== 'fully-qualified') continue;
	if (curSub?.denylist) continue;

	// ── Skin-tone variants ────────────────────────────────────────────────
	// Parent codepoint may be multi-word (e.g. "1F9D1 200D 1F4BB" for 🧑‍💻)
	// so capture everything after "group:" rather than stopping at first space.
	const toneMatch = groupVariant?.match(/group:\s*(.+)/);
	if (toneMatch) {
		// Normalize key: strip FE0F so it matches the fully-qualified item.cp after normalization
		const parentCp = toneMatch[1].trim().replace(/\bFE0F\b/g, '').replace(/\s+/g, ' ').trim();
		const selfCp   = codepoint.replace(/\bFE0F\b/g, '').replace(/\s+/g, ' ').trim();
		// Self-referential group (e.g. 🧑‍🦯): treat as a base grid item, not a variant
		if (parentCp === selfCp) { /* fall through to base-item logic */ }
		else {
			if (!toneMap[parentCp]) toneMap[parentCp] = [];
			toneMap[parentCp].push({ e: emoji, cp: codepoint });
			continue;
		}
	}

	if (!curGroup) continue;
	if (seen.has(codepoint)) continue;
	seen.add(codepoint);

	// Shortcodes — preserve both raw (with colons) and normalized (without)
	const shortcodesRaw = shortcodeRaw
		? shortcodeRaw.split(',').map(s => s.trim()).filter(s => s.startsWith(':'))
		: [];
	const shortcodes = shortcodesRaw.map(s => s.replace(/^:+|:+$/g, '').trim());

	// Aliases / emoticons (field 4)
	const aliases = aliasRaw
		? aliasRaw.split(',').map(s => s.trim()).filter(Boolean)
		: [];

	curGroup.items.push({
		e:   emoji,
		n:   name,
		cp:  codepoint,
		sc:  shortcodes,
		scr: shortcodesRaw,
		al:  aliases,
		kw:  [],
		st:  [],
		oi:  orderIdx++,
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Attach skin-tone variants
// ─────────────────────────────────────────────────────────────────────────────
for (const g of groups) {
	for (const item of g.items) {
		// Normalize cp for lookup: strip FE0F so keys match regardless of qualification level
		const normCp = item.cp.replace(/\bFE0F\b/g, '').replace(/\s+/g, ' ').trim();
		if (toneMap[normCp]) item.t = toneMap[normCp];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Split gender variants: gendered emoji (man/woman X) appear in the grid as
// separate items but have no t array — their skin-tone combos all live on the
// base (person X) item. Extract and assign them so long-press works correctly
// on each gendered emoji, then trim the base to neutral variants only.
// ─────────────────────────────────────────────────────────────────────────────
const FEMALE_CP = new Set(['2640', '1F469']); // ♀ sign, 👩
const MALE_CP   = new Set(['2642', '1F468']); // ♂ sign, 👨

function varGender(cp) {
	const parts = cp.split(' ');
	if (parts.some(p => FEMALE_CP.has(p))) return 'female';
	if (parts.some(p => MALE_CP.has(p))) return 'male';
	return 'neutral';
}

// Build cp → item lookup across all groups
const cpToItem = {};
for (const g of groups) {
	for (const item of g.items) cpToItem[item.cp] = item;
}

// Track which base items need their t arrays trimmed to neutral-only
const toTrimToNeutral = new Set();

for (const g of groups) {
	for (const item of g.items) {
		const gender = varGender(item.cp);
		if (gender === 'neutral') continue; // not a gendered emoji
		if (item.t?.length) continue;       // already has variants

		// Strip ZWJ + gender marker to recover the base codepoint
		const baseCp = item.cp
			.replace(/\s+200D\s+(2640|2642)(\s+FE0F)?/gi, '')
			.replace(/\s+/g, ' ').trim();
		if (baseCp === item.cp) continue;

		const baseItem = cpToItem[baseCp];
		if (!baseItem?.t?.length) continue;

		// Extract variants matching this gender, excluding the gendered base itself
		const matching = baseItem.t.filter(v => varGender(v.cp) === gender && v.e !== item.e);
		if (matching.length > 0) {
			item.t = matching;
			toTrimToNeutral.add(baseCp);
		}
	}
}

// Trim base emoji t arrays to neutral-only (gendered variants now live on their own items)
for (const g of groups) {
	for (const item of g.items) {
		if (!toTrimToNeutral.has(item.cp)) continue;
		item.t = item.t.filter(v => varGender(v.cp) === 'neutral');
	}
}

console.log(`Gender split: ${toTrimToNeutral.size} base emoji trimmed to neutral variants`);

// ─────────────────────────────────────────────────────────────────────────────
// Fetch CLDR keyword annotations (same data powering unicode.org/emoji/charts/emoji-list.html)
// ─────────────────────────────────────────────────────────────────────────────
const CLDR_BASE = 'https://raw.githubusercontent.com/unicode-org/cldr/main/common';
const CLDR_URLS = [
	`${CLDR_BASE}/annotations/en.xml`,
	`${CLDR_BASE}/annotationsDerived/en.xml`,
];

console.log('Fetching CLDR annotations…');

function decodeXML(s) {
	return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const kwMap = {};

async function fetchAndParseCLDR(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
	const xml = await res.text();
	const re = /<annotation cp="([^"]+)"(?![^>]*type="tts")>([^<]+)<\/annotation>/g;
	let m;
	while ((m = re.exec(xml)) !== null) {
		const cp  = decodeXML(m[1]);
		const kws = decodeXML(m[2]).split('|').map(s => s.trim()).filter(Boolean);
		if (!kwMap[cp]) kwMap[cp] = new Set();
		for (const k of kws) kwMap[cp].add(k);
	}
}

await Promise.all(CLDR_URLS.map(fetchAndParseCLDR));
console.log(`CLDR: loaded keywords for ${Object.keys(kwMap).length} emoji`);

// ─────────────────────────────────────────────────────────────────────────────
// Scrape unicode.org/emoji/charts/emoji-list.html for "other keywords"
// The server streams HTML progressively, so we read the body as a stream
// and keep accumulating until the response ends or no new rows arrive.
// ─────────────────────────────────────────────────────────────────────────────
console.log('Scraping unicode.org/emoji/charts/emoji-list.html (streaming, please wait)…');

function decodeHtmlEntities(s) {
	// Decode &#xHHHH; and &#DDDD; numeric entities (covers emoji codepoints)
	return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
	         .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
	         .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
	         .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Normalize a codepoint string for matching: uppercase, remove FE0F variation selectors
function normalizeCp(cp) {
	return cp.toUpperCase().replace(/\bFE0F\b/g, '').replace(/\s+/g, ' ').trim();
}

// Extract emoji rows from partial or complete HTML buffer.
// Handles both single-quoted and double-quoted HTML attributes.
// Returns a map: normalizedCpString → Set<keyword>
function parseEmojiListHtml(html) {
	const map = {};
	// Each row (single or double quoted class attrs):
	//   <td class="code"><a ...>(U+HHHH )+(U+HHHH)</a></td>
	//   <td class="andr">...<img alt='GLYPH'...>...</td>
	//   <td class="name">short name</td>
	//   <td class="name">kw | kw | ...</td>
	const rowRe = /<td class=["']code["']><a[^>]*>((?:U\+[0-9A-F]+\s*)+)<\/a><\/td>\s*<td class=["']andr["']>[\s\S]*?<\/td>\s*<td class=["']name["']>([^<]+)<\/td>\s*<td class=["']name["']>([^<]*)<\/td>/g;
	let m;
	while ((m = rowRe.exec(html)) !== null) {
		const cp  = normalizeCp(m[1].replace(/U\+/g, ''));
		const kws = m[3].split('|').map(s => decodeHtmlEntities(s).trim()).filter(Boolean);
		if (cp && kws.length) {
			if (!map[cp]) map[cp] = new Set();
			for (const k of kws) map[cp].add(k);
		}
	}
	return map;
}

async function scrapeEmojiList() {
	// Use local fullAnnotations.html if available (avoids slow network fetch)
	const localPath = resolve(ROOT, 'fullAnnotations.html');
	if (existsSync(localPath)) {
		console.log('  Using local fullAnnotations.html…');
		const html = readFileSync(localPath, 'utf8');
		const map = parseEmojiListHtml(html);
		console.log(`  Parsed ${Object.keys(map).length} emoji from fullAnnotations.html`);
		return map;
	}

	const TOTAL_EXPECTED = 1698; // our CSV count
	const TIMEOUT_MS     = 600_000; // 10 minutes max
	const STALL_MS       = 30_000;  // stop if no new rows in 30s
	const CHUNK_LOG_EVERY = 50;     // log every N new emoji found

	const controller = new AbortController();
	const hardTimeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	let res;
	try {
		res = await fetch('https://unicode.org/emoji/charts/emoji-list.html', {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; emoji-build-script)' },
			signal: controller.signal,
		});
	} catch (e) {
		clearTimeout(hardTimeout);
		console.warn('  Could not connect to emoji-list.html:', e.message);
		return {};
	}

	if (!res.ok) {
		clearTimeout(hardTimeout);
		console.warn(`  emoji-list.html returned HTTP ${res.status}`);
		return {};
	}

	const reader   = res.body.getReader();
	const decoder  = new TextDecoder();
	let   buf      = '';
	let   listMap  = {};
	let   seen     = 0;
	let   lastNew  = Date.now();
	let   stall;

	// Stall watchdog — if no new rows in STALL_MS, abort
	stall = setInterval(() => {
		if (Date.now() - lastNew > STALL_MS) {
			console.log(`  No new emoji in ${STALL_MS/1000}s — stopping stream.`);
			controller.abort();
		}
	}, 5000);

	try {
		while (true) {
			let done, value;
			try {
				({ done, value } = await reader.read());
			} catch {
				break; // aborted
			}
			if (done) break;

			buf += decoder.decode(value, { stream: true });

			// Parse whatever we have so far; only count newly found rows
			const partial = parseEmojiListHtml(buf);
			const newCount = Object.keys(partial).length;
			if (newCount > seen) {
				lastNew = Date.now();
				if (Math.floor(newCount / CHUNK_LOG_EVERY) > Math.floor(seen / CHUNK_LOG_EVERY)) {
					process.stdout.write(`  …scraped ${newCount} / ${TOTAL_EXPECTED} emoji\r`);
				}
				seen = newCount;
				listMap = partial;
			}

			if (seen >= TOTAL_EXPECTED) {
				console.log(`\n  All ${TOTAL_EXPECTED} emoji found — stopping stream.`);
				break;
			}
		}
	} finally {
		clearInterval(stall);
		clearTimeout(hardTimeout);
		try { reader.cancel(); } catch {}
	}

	buf += decoder.decode(); // flush
	const final = parseEmojiListHtml(buf);
	const finalCount = Object.keys(final).length;
	if (finalCount > seen) listMap = final;

	console.log(`  Scraped ${Object.keys(listMap).length} emoji from emoji-list.html`);
	return listMap;
}

const listMap = await scrapeEmojiList();

// ─────────────────────────────────────────────────────────────────────────────
// Merge CLDR keywords + build normalized searchTerms
// ─────────────────────────────────────────────────────────────────────────────
for (const g of groups) {
	for (const item of g.items) {
		const merged = new Set();

		// 1. CLDR annotations (primary source — keyed by emoji glyph)
		if (kwMap[item.e]) for (const k of kwMap[item.e]) merged.add(k);

		// 2. emoji-list.html scrape (keyed by normalized codepoint — FE0F stripped)
		const ncp = normalizeCp(item.cp);
		if (listMap[ncp]) for (const k of listMap[ncp]) merged.add(k);

		// 3. Supplemental keywords for emoji absent from the HTML page
		if (SUPPLEMENTAL_KW[item.cp]) for (const k of SUPPLEMENTAL_KW[item.cp]) merged.add(k);

		if (merged.size > 0) {
			item.kw = [...merged];
		} else {
			// Fallback: name words as keywords
			item.kw = item.n.split(/[\s-]+/).filter(w => w.length > 1);
		}

		// Pre-compute normalized search terms
		item.st = buildSearchTerms(item);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────
let warnings = 0;
for (const g of groups) {
	for (const item of g.items) {
		if (!item.e)  { console.warn('WARN: missing glyph', item.cp); warnings++; }
		if (!item.n)  { console.warn('WARN: missing name', item.cp); warnings++; }
		if (!item.cp) { console.warn('WARN: missing codepoint', item.e); warnings++; }
		if (!item.st?.length) { console.warn('WARN: no search terms', item.cp); warnings++; }
	}
}
if (warnings === 0) console.log('Validation: all items OK');
else console.warn(`Validation: ${warnings} warnings`);

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────
const cleanGroups = groups
	.filter(g => !g.denylist && g.items.length > 0)
	.map(({ name, icon, items }) => ({ name, icon, items }));

// ─────────────────────────────────────────────────────────────────────────────
// Parse top-39 most-used emoji from emojiRank.csv, then append heart sections:
//   1. Ranked (39): no hearts at all, no skin tones
//   2. Expression hearts (in rank order from CSV): ♥️ 💔 💗 💕 etc.
//   3. Rainbow hearts: ❤️ 🧡 💛 💚 🩵 💙 💜 🩷 🤎 🤍 🩶 🖤
// ─────────────────────────────────────────────────────────────────────────────
const POPULAR_RANKED = 48;
const SKIN_TONE_CHARS = ['🏻', '🏼', '🏽', '🏾', '🏿'];
const hasSkinTone = e => SKIN_TONE_CHARS.some(t => e.includes(t));

// Rainbow: always shown last, in color order, starting with ❤️
const HEART_RAINBOW = ['❤️','🧡','💛','💚','🩵','💙','💜','🩷','🤎','🤍','🩶','🖤'];
const RAINBOW_SET = new Set(HEART_RAINBOW);

// Expression hearts: non-rainbow heart variants, collected in rank order from CSV
// 🫀 is not in the CSV ranking, so it's appended manually at the end
const EXPRESSION_HEARTS = new Set([
	'♥️','💔','💗','💕','💖','💞','💓','❣️','💘','💝','❤️‍🩹',
]);

// Everything heart-related — excluded from the ranked section
const ALL_HEARTS = new Set([...RAINBOW_SET, ...EXPRESSION_HEARTS, '❤️‍🔥']);

const rankLines = readFileSync(resolve(ROOT, 'emojiRank.csv'), 'utf8')
	.split('\n').slice(1)
	.filter(Boolean);
const ranked = [];
const exHearts = [];
for (const line of rankLines) {
	const emoji = parseCSVRow(line)[1]?.trim() ?? '';
	if (!emoji || hasSkinTone(emoji)) continue;
	if (ALL_HEARTS.has(emoji)) {
		if (EXPRESSION_HEARTS.has(emoji) && !exHearts.includes(emoji)) exHearts.push(emoji);
		continue;
	}
	if (ranked.length < POPULAR_RANKED) ranked.push(emoji);
}
const popular = [...ranked, ...HEART_RAINBOW, '❤️‍🔥', ...exHearts];
console.log(`Popular: ${ranked.length} ranked + ${exHearts.length} expr hearts + ${HEART_RAINBOW.length} rainbow = ${popular.length} total`);

const output = { version: '17.0', groups: cleanGroups, popular };

const outPath = resolve(ROOT, 'static', 'emoji-data.json');
writeFileSync(outPath, JSON.stringify(output));

let total = 0;
for (const g of cleanGroups) total += g.items.length;
console.log(`✓ Written ${outPath}`);
console.log(`  ${cleanGroups.length} groups, ${total} emoji total`);

// Sample with new fields
const sample = cleanGroups[0].items[2];
console.log('\nSample item:', JSON.stringify(sample, null, 2));
