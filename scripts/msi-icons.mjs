// Every Material Symbols icon the app actually renders, and the Google Fonts
// URL that serves ONLY those.
//
//   node scripts/msi-icons.mjs           # list + URL + subset size
//   node scripts/msi-icons.mjs --write   # also download the subset woff2 into static/fonts/
//
// Why: the unsubsetted family is a 5.4MB woff2. With `display=block` every
// icon in the app stays invisible until all 5.4MB lands, which on a phone
// reads as "the icons didn't load". The `icon_names=` parameter cuts it to the
// glyphs we use.
//
// Icons are found by scanning for the `.msi` helper (src/app.css) and pulling
// both literal ligatures (`<span class="msi">close</span>`) and every quoted
// string inside a dynamic one (`>{uploading ? 'progress_activity' : 'attach_file'}`),
// plus `icon`/`iconName` object fields. Candidates are then checked against
// Google's own icon metadata, so a stray word never reaches the URL.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'static/fonts/material-symbols-rounded.woff2');
const AXES = 'opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : ['.svelte', '.js', '.html', '.css'].includes(extname(p)) ? [p] : [];
	});
}

/** Text between an `.msi` element's `>` and its `<`, dynamic parts included. */
const MSI_CONTENT = /class="msi[^"]*"[^>]*>([^<]*)/g;
const WORD = /[a-z][a-z0-9_]{2,}/g;
const ICON_FIELD = /\b(?:icon|iconName|msi|metaMsi)\s*:\s*'([a-z0-9_]+)'/g;

const candidates = new Map(); // name -> Set of files
for (const file of walk(SRC)) {
	const text = readFileSync(file, 'utf8');
	const hits = [];
	for (const [, content] of text.matchAll(MSI_CONTENT)) hits.push(...(content.match(WORD) ?? []));
	for (const [, name] of text.matchAll(ICON_FIELD)) hits.push(name);
	for (const name of hits) {
		candidates.set(name, (candidates.get(name) ?? new Set()).add(file.slice(ROOT.length)));
	}
}

// Google's own list of icon names — the only way to tell an icon from a word
// that happened to sit inside an .msi element (class names, `true`, a label).
const metadata = await fetch('https://fonts.google.com/metadata/icons?incomplete=true&key=material_symbols')
	.then((r) => r.text());
const known = new Set(JSON.parse(metadata.replace(/^\)\]\}'\n?/, '')).icons.map((i) => i.name));

const icons = [...candidates.keys()].filter((n) => known.has(n)).sort();
const rejected = [...candidates.keys()].filter((n) => !known.has(n)).sort();

const url = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:${AXES}` +
	`&icon_names=${icons.join(',')}&display=block`;

console.log(`${icons.length} icons in use:\n  ${icons.join(' ')}\n`);
console.log(`not Material Symbols names, ignored (${rejected.length}):\n  ${rejected.join(' ')}\n`);
console.log(`${url}\n`);

const css = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } })
	.then((r) => r.text());
// Subset responses are served from /l/font?kit=… with no .woff2 extension.
const fontUrl = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
if (!fontUrl) throw new Error(`no woff2 in the Google CSS response:\n${css}`);
const bytes = new Uint8Array(await fetch(fontUrl).then((r) => r.arrayBuffer()));
console.log(`subset: ${fontUrl}\n        ${(bytes.length / 1024).toFixed(1)}KB (full family: 5246.6KB)`);

if (process.argv.includes('--write')) {
	writeFileSync(OUT, bytes);
	console.log(`\nwrote ${OUT.slice(ROOT.length)}`);
}
