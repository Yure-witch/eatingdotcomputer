#!/usr/bin/env node
/**
 * Localized emoji search terms, from the same CLDR annotations that give the
 * English catalog its keywords (build-emoji-data.mjs) — CLDR ships them for
 * ~100 locales, so a student searching "corazón", "coração" or "ハート" can find
 * ❤️ without switching to English.
 *
 *   node scripts/build-emoji-locale-kw.mjs            # the default locale set
 *   node scripts/build-emoji-locale-kw.mjs es fr ja   # just these
 *
 * Sources (CLDR main, same base URL as build-emoji-data.mjs):
 *   common/annotations/<locale>.xml         translated name (tts) + keywords
 *   common/annotationsDerived/<locale>.xml  names derived for sequences (flags,
 *                                           ZWJ families, skin tones)
 *
 * Output: static/emoji-kw/<locale>.json, keyed by the emoji glyph, value is
 * "name|keyword|keyword…" — one string per emoji keeps the file small, and the
 * client splits it (emoji-locale-kw.js). Only emoji in static/emoji-data.json
 * are kept, so the file matches the picker's catalog exactly.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'static/emoji-kw');
const CLDR_BASE = 'https://raw.githubusercontent.com/unicode-org/cldr/main/common';

// The languages worth shipping by default. CLDR has many more — pass locales as
// arguments to add one (the file only loads for a student whose browser asks
// for that language, so the cost is per-student, not per-page).
const DEFAULT_LOCALES = [
	'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'tr',
	'ar', 'he', 'fa', 'hi', 'bn', 'id', 'vi', 'th', 'ja', 'ko', 'zh', 'zh_Hant'
];

const decodeXML = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
	.replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Glyph key: variation selectors don't survive round-trips consistently. */
const glyphKey = (text) => text.replaceAll('️', '');

// Base emoji only. Skin-tone variants are half of CLDR's entries, and the
// search index never looks them up — it indexes the catalog's base items and
// the picker resolves a tone from the base — so keeping them would double
// every file to answer queries nobody can make ("mano saludando: tono claro").
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'static/emoji-data.json'), 'utf8'));
const wanted = new Set();
for (const group of catalog.groups ?? []) {
	for (const item of group.items ?? []) wanted.add(glyphKey(item.e));
}
console.log(`catalog: ${wanted.size} base emoji`);

async function fetchXML(kind, locale) {
	const res = await fetch(`${CLDR_BASE}/${kind}/${locale}.xml`);
	if (res.status === 404) return null; // e.g. pt_BR has no file of its own
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${kind}/${locale}.xml`);
	return res.text();
}

/** cp="😀" carries keywords; the same cp with type="tts" carries the name. */
function parse(xml, into) {
	const re = /<annotation cp="([^"]+)"(\s+type="tts")?\s*>([^<]*)<\/annotation>/g;
	let m;
	while ((m = re.exec(xml)) !== null) {
		const key = glyphKey(decodeXML(m[1]));
		if (!wanted.has(key)) continue;
		const value = decodeXML(m[3]).trim();
		if (!value) continue;
		const entry = into.get(key) ?? { name: '', keywords: new Set() };
		if (m[2]) entry.name ||= value;
		else for (const kw of value.split('|').map((s) => s.trim()).filter(Boolean)) entry.keywords.add(kw);
		into.set(key, entry);
	}
}

const locales = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_LOCALES;
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const summary = [];
for (const locale of locales) {
	const entries = new Map();
	const [base, derived] = await Promise.all([
		fetchXML('annotations', locale),
		fetchXML('annotationsDerived', locale)
	]);
	if (!base && !derived) { console.warn(`skip ${locale}: no CLDR annotations`); continue; }
	if (base) parse(base, entries);
	if (derived) parse(derived, entries);

	const out = {};
	for (const [glyph, { name, keywords }] of entries) {
		// Name first, keywords after; the client splits on "|".
		const parts = [name, ...[...keywords].filter((k) => k !== name)].filter(Boolean);
		if (parts.length) out[glyph] = parts.join('|');
	}
	// Written as <locale>.json with the CLDR underscore turned into the hyphen
	// browsers use in navigator.language (zh_Hant → zh-Hant).
	const file = resolve(OUT_DIR, `${locale.replace('_', '-')}.json`);
	const json = JSON.stringify(out);
	writeFileSync(file, json);
	summary.push({ locale, emoji: Object.keys(out).length, kb: +(json.length / 1024).toFixed(1) });
	console.log(`${locale}: ${Object.keys(out).length} emoji, ${(json.length / 1024).toFixed(1)}KB`);
}

writeFileSync(
	resolve(OUT_DIR, 'index.json'),
	JSON.stringify(summary.map((s) => s.locale.replace('_', '-')))
);
console.log(`\n${summary.length} locales, ${summary.reduce((n, s) => n + s.kb, 0).toFixed(0)}KB total`);
