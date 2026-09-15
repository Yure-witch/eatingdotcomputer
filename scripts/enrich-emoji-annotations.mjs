#!/usr/bin/env node
// One-off, resumable Merriam-Webster enrichment. No runtime/browser API calls.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'data/emoji-annotations');
const CACHE = resolve(DIR, '.cache');
const normalize = text => text.toLowerCase().replaceAll('’', "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const glyphKey = text => text.replaceAll('\uFE0F', '');
const hash = text => createHash('sha256').update(text).digest('hex');
const GENERIC = new Set(('a an the of in on at to for with without and or as is be ' +
	'face person people man woman men women boy girl body hand hands eye eyes mouth ' +
	'object thing symbol sign shape large small big little open closed').split(' '));
const MODIFIERS = new Set('red orange yellow green blue purple pink black white brown gray grey silver gold light dark large small big little round square'.split(' '));
const FOOD_WORDS = new Set('chow edibles eatables foodstuffs eats fare nourishment nutriment sustenance victuals provisions grub rations nutrients'.split(' '));
const tokens = text => normalize(text).split(' ').filter(word => word.length > 2 && !GENERIC.has(word));
const unique = values => [...new Set(values)];
export const descriptionText = record => `${record.name}. ${record.keywords.join(', ')}`;
export const senseText = sense => `${sense.definition.trim()}: ${sense.synonyms.slice(0, 12).join(', ')}`;

export function readVectors() {
	const path = resolve(CACHE, 'vectors.json');
	if (!existsSync(path)) return new Map();
	const strings = JSON.parse(readFileSync(path));
	const bytes = readFileSync(resolve(CACHE, 'vectors.bin'));
	const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
	return new Map(strings.map((text, i) => [text, floats.subarray(i * 384, (i + 1) * 384)]));
}

function cosine(a, b) {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}

export function decodeXml(text) {
	return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
		if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
		if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
		return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
	});
}
const encodeXml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function parseAnnotations(xml) {
	// Ignore commented annotations, while preserving offsets for lossless edits.
	const visible = xml.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
	const records = new Map();
	for (const match of visible.matchAll(/<annotation\b([^>]*)>([^<]*)<\/annotation>/g)) {
		const cp = match[1].match(/\bcp="([^"]*)"/);
		if (!cp) continue;
		const glyph = decodeXml(cp[1]), key = glyphKey(glyph);
		const record = records.get(key) ?? { glyph, key, name: '', keywords: [] };
		if (/\btype="tts"/.test(match[1])) record.name = decodeXml(match[2]);
		else {
			record.keywords = decodeXml(match[2]).split('|').map(word => word.trim()).filter(Boolean);
			record.contentEnd = match.index + match[0].indexOf('</annotation>');
		}
		records.set(key, record);
	}
	return [...records.values()].filter(record => record.contentEnd !== undefined);
}

export function lookupTerms(record) {
	const name = normalize(record.name);
	const nameTokens = tokens(name);
	const keywords = unique(record.keywords.map(normalize)).filter(word => tokens(word).length);
	// For named expressions, query the descriptor before generic anatomy.
	const descriptor = name.replace(/\b(?:face|eyes?|mouth|hands?|tongue)\b/g, '').replace(/\s+/g, ' ').trim();
	const core = /\bface\b/.test(name) && keywords.includes(descriptor) ? descriptor : '';
	const compound = name.split(' ').length <= 2 && !/\b(?:face|person|man|woman|boy|girl)\b/.test(name);
	return unique([
		core,
		...(compound ? [name] : []),
		...keywords.filter(word => nameTokens.includes(word)),
		...(name.split(' ').length === 1 ? [name] : []),
		...keywords.filter(word => name.includes(word)),
		...keywords
	]).filter(word => word && /\p{L}/u.test(word));
}

function sensesIn(node, result = []) {
	if (!node || typeof node !== 'object') return result;
	if (!Array.isArray(node) && node.syn_list) result.push(node);
	for (const [key, value] of Object.entries(node)) {
		if (!['syn_list', 'ant_list', 'rel_list', 'near_list', 'vis'].includes(key)) sensesIn(value, result);
	}
	return result;
}

export function extractSenses(payload, query) {
	if (!Array.isArray(payload)) throw new Error('Unexpected Webster response format');
	const wanted = normalize(query);
	const result = [];
	for (const entry of payload) {
		// API spelling suggestions and unrelated headwords are not synonyms.
		if (!entry || typeof entry !== 'object') continue;
		const headword = normalize((entry.meta?.id ?? '').replace(/:\d+$/, ''));
		if (headword !== wanted && !entry.meta?.stems?.some(stem => normalize(stem) === wanted)) continue;
		for (const [index, sense] of sensesIn(entry.def).entries()) {
			const synonyms = unique(sense.syn_list.flat().filter(word =>
				!/(?:archaic|obsolete|rare)/i.test(JSON.stringify(word.wsls ?? ''))
			).map(word => word.wd).filter(word => typeof word === 'string' && !word.includes('{')));
			if (!synonyms.length) continue;
			const definition = (sense.dt ?? []).filter(part => part[0] === 'text').map(part => part[1]).join(' ').replace(/\{[^}]*\}/g, '');
			result.push({ entryId: entry.meta.id, pos: entry.fl, sense: sense.sn ?? String(index + 1), definition, synonyms });
		}
	}
	return result;
}

export function chooseSynonyms(record, cache, frequency = new Map(), vectors = null) {
	const existing = new Set([...record.keywords, record.name].map(normalize));
	const context = new Set([...tokens(record.name), ...record.keywords.flatMap(tokens)]);
	const choices = new Map();
	const queries = lookupTerms(record);
	const description = vectors?.get(descriptionText(record));
	for (const [queryIndex, query] of queries.entries()) {
		const cached = cache.get(query);
		if (!cached) continue;
		const senses = extractSenses(cached.payload, query);
		const ranked = senses.map((sense, index) => {
			const shared = unique([...tokens(sense.definition), ...sense.synonyms.flatMap(tokens)])
				.filter(word => word !== query && context.has(word));
			const face = /\bface\b/.test(record.name);
			const posBonus = face ? Number(sense.pos === 'adjective' || sense.pos === 'verb') : Number(sense.pos === 'noun');
			const vector = vectors?.get(senseText(sense));
			const similarity = description && vector ? cosine(description, vector) : null;
			const physical = /Animals|Food|Travel|Objects/.test(record.group ?? '');
			const personSense = /\b(?:person|someone|human being|man|woman)\b/.test(sense.definition);
			const modifier = MODIFIERS.has(query) && normalize(record.name).split(' ').includes(query);
			const rejected = physical && ((modifier ? sense.pos !== 'adjective' : sense.pos !== 'noun') || personSense)
				|| (/Food/.test(record.group ?? '') && query === 'cake')
				|| (query === 'glass' && /milk|wine|cocktail|magnifying/.test(record.name));
			return { sense, index, fit: rejected ? -100 : vectors ? (similarity ?? -1) * 20 + shared.length * 0.1 + posBonus * 0.2 : shared.length * 3 + posBonus, shared, similarity };
		}).sort((a, b) => b.fit - a.fit || a.index - b.index);
		const best = ranked[0];
		if (!best) continue;
		if (best.fit === -100) continue;
		if (vectors && (best.similarity === null || best.similarity < 0.28)) continue;
		// Secondary tags require another contextual match to disambiguate them.
		if (queryIndex > 0 && !best.shared.length && !(vectors && /Animals|Food|Travel|Objects/.test(record.group ?? '') && best.similarity >= 0.42)) continue;
		for (const [order, word] of best.sense.synonyms.entries()) {
			if (query === 'food' && !FOOD_WORDS.has(word)) continue;
			if (word === 'casket' && !/coffin/.test(record.name)) continue;
			const key = normalize(word);
			if (!key || existing.has(key) || key === normalize(query)) continue;
			const prior = choices.get(key);
			const wordVector = vectors?.get(word);
			const wordSimilarity = description && wordVector ? cosine(description, wordVector) : null;
			if (vectors && (wordSimilarity === null || wordSimilarity < 0.22)) continue;
			const source = { query, entryId: best.sense.entryId, pos: best.sense.pos, sense: best.sense.sense,
				url: `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(query)}`,
				...(vectors ? { senseSimilarity: +best.similarity.toFixed(3), wordSimilarity: +wordSimilarity.toFixed(3) } : {}) };
			const strength = vectors ? wordSimilarity * 20 + best.similarity * 10 + 5 / (queryIndex + 1) : 10 / (queryIndex + 1) + Math.min(best.shared.length, 3);
			if (!prior) choices.set(key, { word, strength, support: 1, order, source });
			else {
				prior.support++;
				if (strength > prior.strength) Object.assign(prior, { strength, order, source });
			}
		}
	}
	return [...choices.values()].sort((a, b) =>
		(b.strength + Math.min(b.support - 1, 3) * (vectors ? 0.1 : 3)) - (a.strength + Math.min(a.support - 1, 3) * (vectors ? 0.1 : 3))
		|| (frequency.get(normalize(b.word)) ?? 0) - (frequency.get(normalize(a.word)) ?? 0)
		|| a.order - b.order
	).slice(0, 4).map(({ word, source }) => ({ word, ...source }));
}

export function enrichXml(xml, records, selections) {
	let result = xml;
	for (const record of [...records].sort((a, b) => b.contentEnd - a.contentEnd)) {
		const words = selections.get(record.key)?.map(hit => hit.word) ?? [];
		if (words.length) result = result.slice(0, record.contentEnd) + ' | ' + words.map(encodeXml).join(' | ') + result.slice(record.contentEnd);
	}
	return result;
}

function writeJson(path, value) {
	writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n');
	renameSync(`${path}.tmp`, path);
}

async function main() {
	const { values } = parseArgs({ options: {
		fetch: { type: 'boolean', default: false },
		semantic: { type: 'boolean', default: false },
		'key-file': { type: 'string' },
		'max-requests': { type: 'string', default: '900' }
	} });
	const maxRequests = Number(values['max-requests']);
	if (!Number.isInteger(maxRequests) || maxRequests < 0 || maxRequests > 2000) throw new Error('--max-requests must be 0–2000; each supplied key is capped at 1000/day');
	mkdirSync(CACHE, { recursive: true });
	const xml = readFileSync(resolve(DIR, 'en.xml'), 'utf8');
	const source = JSON.parse(readFileSync(resolve(DIR, 'source.json')));
	if (hash(xml) !== source.sha256) throw new Error('Original en.xml differs from its recorded checksum');
	const app = JSON.parse(readFileSync(resolve(ROOT, 'static/emoji-data.json')));
	const appGlyphs = new Set(app.groups.flatMap(group => group.items.flatMap(item => [item.e, ...(item.t ?? []).map(v => v.e)])).map(glyphKey));
	const records = parseAnnotations(xml).filter(record => appGlyphs.has(record.key) || /[\p{Extended_Pictographic}\p{Emoji_Modifier}]/u.test(record.glyph));
	const groups = new Map(app.groups.flatMap(group => group.items.map(item => [glyphKey(item.e), group.name])));
	for (const record of records) record.group = groups.get(record.key);
	const vectors = values.semantic ? readVectors() : null;
	if (values.semantic && !vectors.size) throw new Error('Run scripts/embed-webster-candidates.mjs first');
	const terms = new Map();
	for (const record of records) for (const [rank, query] of lookupTerms(record).entries()) {
		if (!terms.has(query)) terms.set(query, []);
		terms.get(query).push({ key: record.key, rank });
	}
	const cache = new Map();
	for (const query of terms.keys()) {
		// Keep the first diagnostic request in the same daily accounting/cache.
		const path = resolve(CACHE, query === 'zany' ? 'zany.json' : `${hash(query)}.json`);
		if (existsSync(path)) cache.set(query, JSON.parse(readFileSync(path)));
	}
	const frequency = () => {
		const result = new Map();
		for (const [query, cached] of cache) for (const word of unique(extractSenses(cached.payload, query).flatMap(sense => sense.synonyms).map(normalize))) result.set(word, (result.get(word) ?? 0) + 1);
		return result;
	};
	const reviewedPath = resolve(DIR, 'reviewed-synonyms.json');
	const reviewed = existsSync(reviewedPath) ? JSON.parse(readFileSync(reviewedPath)) : {};
	const exclusionsPath = resolve(DIR, 'reviewed-exclusions.json');
	const exclusions = existsSync(exclusionsPath) ? JSON.parse(readFileSync(exclusionsPath)) : { excludeAll: [], words: {} };
	let selections = new Map();
	const refresh = () => {
		const frequencies = frequency();
		selections = new Map(records.map(record => [record.key, chooseSynonyms(record, cache, frequencies, vectors)]));
		for (const [glyph, review] of Object.entries(reviewed)) {
			const cached = cache.get(review.query);
			if (!cached) continue;
			const record = records.find(record => record.key === glyphKey(glyph));
			if (!record) throw new Error(`Reviewed emoji ${glyph} is absent from the source`);
			const existing = new Set([record.name, ...record.keywords].map(normalize));
			const senses = extractSenses(cached.payload, review.query).filter(sense => sense.pos === review.pos);
			const hits = review.words.map(word => {
				if (existing.has(normalize(word))) throw new Error(`Reviewed synonym ${word} already exists for ${glyph}`);
				const sense = senses.find(sense => sense.synonyms.includes(word));
				if (!sense) throw new Error(`Reviewed synonym ${word} is absent from Webster's ${review.query} entry`);
				return { word, query: review.query, entryId: sense.entryId, pos: sense.pos, sense: sense.sense, reviewed: true,
					url: `https://www.merriam-webster.com/thesaurus/${encodeURIComponent(review.query)}` };
			});
			if (hits.length > 4 || new Set(hits.map(hit => normalize(hit.word))).size !== hits.length) throw new Error('Reviewed synonyms must be unique and at most four');
			selections.set(glyphKey(glyph), hits);
		}
		for (const glyph of exclusions.excludeAll) selections.set(glyphKey(glyph), []);
		for (const [glyph, words] of Object.entries(exclusions.words)) {
			const key = glyphKey(glyph);
			selections.set(key, (selections.get(key) ?? []).filter(hit => !words.includes(hit.word)));
		}
	};
	refresh();
	const usagePath = resolve(CACHE, 'usage.json');
	const today = new Date().toISOString().slice(0, 10);
	let usage = existsSync(usagePath) ? JSON.parse(readFileSync(usagePath)) : { date: today, requests: 0, byKey: {} };
	if (usage.date !== today) usage = { date: today, requests: 0, byKey: {} };
	let requests = 0;
	console.log(JSON.stringify({ emoji: records.length, distinctCandidateQueries: terms.size, cachedQueries: cache.size, requestsToday: usage.requests }));
	if (values.fetch) {
		const keys = unique((values['key-file'] ? readFileSync(values['key-file'], 'utf8') : process.env.MERRIAM_WEBSTER_THESAURUS_KEY ?? '').trim().split(/\s+/).filter(Boolean));
		if (!keys.length) throw new Error('Set MERRIAM_WEBSTER_THESAURUS_KEY or --key-file; the key is never written into outputs');
		usage.byKey ??= { [hash(keys[0])]: usage.requests };
		while (requests < maxRequests) {
			if (existsSync(resolve(CACHE, 'pause'))) break;
			const key = keys.find(key => (usage.byKey[hash(key)] ?? 0) < 1000);
			if (!key) break;
			const pending = [...terms].filter(([query]) => !cache.has(query)).map(([query, targets]) => ({
				query,
				score: targets.reduce((sum, { key, rank }) => sum +
					// Still query an emoji's best descriptors even if generic tags fill four slots.
					(rank < 2 || (selections.get(key)?.length ?? 0) < 4 ? 1 / (rank + 1) ** 2 : 0), 0)
			})).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
			if (!pending.length) break;
			const { query } = pending[0];
			const url = new URL(`https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(query)}`);
			url.searchParams.set('key', key);
			// Count attempts before sending, including errors; never exceed the cap.
			usage.requests++;
			usage.byKey[hash(key)] = (usage.byKey[hash(key)] ?? 0) + 1;
			requests++;
			writeJson(usagePath, usage);
			const response = await fetch(url, { signal: AbortSignal.timeout(30000) }).catch(() => { throw new Error(`Webster request failed for ${query}`); });
			if (!response.ok) throw new Error(`Webster returned HTTP ${response.status} for ${query}`);
			const payload = await response.json().catch(() => { throw new Error('Webster did not return JSON; check the Thesaurus key'); });
			extractSenses(payload, query); // Validate before caching.
			const cached = { query, retrievedAt: new Date().toISOString(), payload };
			writeJson(resolve(CACHE, `${hash(query)}.json`), cached);
			cache.set(query, cached);
			if (requests % 25 === 0) {
				refresh();
				console.log(JSON.stringify({ requests, requestsToday: usage.requests, fourSynonyms: [...selections.values()].filter(hits => hits.length === 4).length, lastQuery: query }));
			}
			await new Promise(resolve => setTimeout(resolve, 150));
		}
	}
	refresh();
	const entries = records.map(record => {
		const synonyms = selections.get(record.key);
		const pendingQueries = lookupTerms(record).filter(query => !cache.has(query));
		return { emoji: record.glyph, name: record.name, synonyms,
			status: synonyms.length === 4 ? 'four' : pendingQueries.length ? 'pending' : 'fewer-available', pendingQueries };
	});
	const counts = { total: entries.length, four: entries.filter(row => row.status === 'four').length,
		partial: entries.filter(row => row.synonyms.length > 0 && row.synonyms.length < 4).length,
		zero: entries.filter(row => !row.synonyms.length).length, pending: entries.filter(row => row.status === 'pending').length };
	const output = enrichXml(xml, records, selections);
	writeFileSync(resolve(DIR, 'en.webster.xml'), output);
	writeJson(resolve(DIR, 'webster-synonyms.json'), { sourceSha256: source.sha256, generatedAt: new Date().toISOString(),
		provider: 'Merriam-Webster Collegiate Thesaurus', ranking: values.semantic ? 'MiniLM semantic similarity to CLDR annotations for sense selection and candidate ranking; only Webster synonyms are added' : 'Preliminary lexical ranking; semantic review required',
		requestsToday: usage.requests, cachedQueries: cache.size, counts, entries });
	console.log(JSON.stringify({ ...counts, requestsToday: usage.requests, output: 'data/emoji-annotations/en.webster.xml' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
