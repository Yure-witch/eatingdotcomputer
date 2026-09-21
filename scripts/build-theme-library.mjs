#!/usr/bin/env node
/**
 * Build static/theme-library.json from the Figma variable exports in
 * online-figma-emoji-grid/tokens.
 *
 *   node scripts/build-theme-library.mjs [tokensDir]
 *
 * Two kinds of theme come out of it:
 *   - 'roles' — the full Material 3 role sets (A17 Themes, TAS Colors). Painted
 *     exactly as designed, light and dark from the file's LT/DT modes. Each also
 *     yields "Energy 1" and "Energy 2" themes from its Energy/* (watch) tokens.
 *   - 'seed'  — the colorway libraries, which are 2–6 flat colors per theme, not
 *     role sets. Color A seeds the M3 generator; B and C steer secondary and
 *     tertiary, so they still get a light and a dark scheme.
 *
 * Every theme is independently selectable. `groups` only collects relatives —
 * "Sunset (Dune Tonal)" sits beside "Dune · CMF" — for display.
 *
 * Status colors, Red/Green/Yellow and APDS Elevations are skipped: they are
 * partial role sets and shadow specs, not themes.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = process.argv[2] || join(here, '../../online-figma-emoji-grid/tokens');
const OUT = join(here, '../static/theme-library.json');

const ROLE_FILES = ['✅ 2026 A17 Themes.json', '✅ TAS Colors 0416.json'];
const COLORWAY_FILES = [
	"'27 Colorways [WIP].json",
	"'26 Colorways.json",
	"'26 Full Color BG Colorways (Chrono).json",
	"'26 Weave (Tubes) Hero Colorways.json",
	"'25 Colorways.json",
	"'25 BC25 Colorways.json",
	"'24 Colorways.json",
	"'23 Global Colorways.json",
	"'23 Pop (2-color) Colorways.json"
];

const hex = (c) =>
	'#' + ['r', 'g', 'b'].map((k) => Math.round(c[k] * 255).toString(16).padStart(2, '0')).join('');

const load = (file) => {
	const d = JSON.parse(readFileSync(join(TOKENS, file), 'utf8'));
	const byId = new Map(d.variables.map((v) => [v.id, v]));
	// Resolve a value, following same-file aliases. Anything unresolvable → null.
	const value = (v, mode, depth = 0) => {
		const x = v?.valuesByMode?.[mode];
		if (x && x.type === 'VARIABLE_ALIAS') {
			if (depth > 8) return null;
			const target = byId.get(x.id);
			if (!target) return null;
			const tmode = mode in target.valuesByMode ? mode : Object.keys(target.valuesByMode)[0];
			return value(target, tmode, depth + 1);
		}
		return x ?? null;
	};
	const color = (v, mode) => {
		const x = value(v, mode);
		return x && typeof x === 'object' && 'r' in x ? hex(x) : null;
	};
	return { d, value, color };
};

const libLabel = (file) => file.replace(/\.json$/, '').replace(/^[^\w']+\s*/u, '').trim();
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

// ── Role themes ──────────────────────────────────────────────────────────────
// Figma name (after the "Group/") → M3 role name used by theme-store.
const ROLE_MAP = {
	Primary: 'primary', onPrimary: 'onPrimary', primaryContainer: 'primaryContainer', onPrimaryContainer: 'onPrimaryContainer',
	Secondary: 'secondary', onSecondary: 'onSecondary', secondaryContainer: 'secondaryContainer', onSecondaryContainer: 'onSecondaryContainer',
	Tertiary: 'tertiary', onTertiary: 'onTertiary', tertiaryContainer: 'tertiaryContainer', onTertiaryContainer: 'onTertiaryContainer',
	Surface: 'surface', sContainerLowest: 'surfaceContainerLowest', sContainerLow: 'surfaceContainerLow',
	surfaceContainer: 'surfaceContainer', sContainerHigh: 'surfaceContainerHigh', sContainerHighest: 'surfaceContainerHighest',
	onSurface: 'onSurface', onSurfaceVariant: 'onSurfaceVariant',
	Outline: 'outline', outlineVariant: 'outlineVariant',
	inverseSurface: 'inverseSurface', inverseOnSurface: 'inverseOnSurface', inversePrimary: 'inversePrimary',
	Error: 'error', onError: 'onError', errorContainer: 'errorContainer', onErrorContainer: 'onErrorContainer'
};
const tokenKey = (name) => name.split('/').pop().split(',')[0].trim();

const lum = (h) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
// The on-color from `candidates` that reads best on `bg`.
const bestOn = (bg, candidates) =>
	candidates.filter(Boolean).reduce((best, c) => (contrast(bg, c) > contrast(bg, best) ? c : best));

// CIELAB chroma — enough to rank a handful of colors by how colorful they are.
const chroma = (h) => {
	const lin = [1, 3, 5].map((i) => {
		const c = parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	const [X, Y, Z] = [
		(0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047,
		0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2],
		(0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883
	].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
	return Math.hypot(500 * (X - Y), 200 * (Y - Z));
};

const completeRoles = (r) => ({
	...r,
	background: r.background ?? r.surface,
	onBackground: r.onBackground ?? r.onSurface,
	surfaceVariant: r.surfaceVariant ?? r.surfaceContainerHighest,
	shadow: '#000000',
	scrim: '#000000'
});

// Energy level n (1 or 2) laid over a standard role set. The file only gives
// the accent/surface fills, so on-colors are picked from the theme's own on-
// roles by contrast rather than invented.
const energize = (base, e, n) => {
	const r = { ...base };
	const set = (role, key) => { if (e[`${key}${n}`]) r[role] = e[`${key}${n}`]; };
	set('primary', 'ePrimary'); set('primaryContainer', 'ePrimaryContainer');
	set('secondary', 'eSecondary'); set('secondaryContainer', 'eSecondaryContainer');
	set('tertiary', 'eTertiary'); set('tertiaryContainer', 'eTertiaryContainer');
	set('error', 'eError'); set('errorContainer', 'eErrorContainer');
	if (e[`eSurface${n}`]) {
		r.surface = r.background = r.surfaceContainerLowest = r.surfaceContainerLow = e[`eSurface${n}`];
	}
	if (e[`eSurfaceContainer${n}`]) {
		r.surfaceContainer = r.surfaceContainerHigh = r.surfaceContainerHighest = r.surfaceVariant = e[`eSurfaceContainer${n}`];
	}
	const ons = [base.onSurface, base.inverseOnSurface, base.onPrimary, base.onPrimaryContainer];
	for (const fam of ['primary', 'secondary', 'tertiary', 'error']) {
		const F = fam[0].toUpperCase() + fam.slice(1);
		r[`on${F}`] = bestOn(r[fam], [base[`on${F}`], base[`on${F}Container`], ...ons]);
		r[`on${F}Container`] = bestOn(r[`${fam}Container`], [base[`on${F}Container`], base[`on${F}`], ...ons]);
	}
	r.onSurface = r.onBackground = e.eOnSurface && contrast(r.surface, e.eOnSurface) >= 4.5
		? e.eOnSurface
		: bestOn(r.surface, ons);
	r.onSurfaceVariant = bestOn(r.surfaceContainer, [base.onSurfaceVariant, ...ons]);
	return r;
};

const themes = {};
const order = [];
const add = (t) => {
	let id = slug(t.name) || 'theme';
	while (themes[id]) id += '-x';
	themes[id] = t;
	order.push(id);
	return id;
};

for (const file of ROLE_FILES) {
	const { d, color } = load(file);
	const lib = libLabel(file);
	// Pair LT/DT modes by the name with the mode suffix stripped.
	const pairs = new Map();
	for (const [mode, rawName] of Object.entries(d.modes)) {
		const name = rawName.replace(/^[^\p{L}\p{N}]+/u, '').trim();
		const m = name.match(/^(.*?)(?:\s*·\s*|\s+)(LT|DT)$/);
		if (!m) continue;
		const base = m[1].trim();
		if (!pairs.has(base)) pairs.set(base, {});
		pairs.get(base)[m[2] === 'DT' ? 'dark' : 'light'] = mode;
	}
	for (const [base, modes] of pairs) {
		if (!modes.light || !modes.dark) continue;
		const out = { light: {}, dark: {} };
		const energy = { light: {}, dark: {} };
		for (const side of ['light', 'dark']) {
			for (const v of d.variables) {
				const key = tokenKey(v.name);
				const c = color(v, modes[side]);
				if (!c) continue;
				if (v.name.startsWith('Energy/')) energy[side][key] = c;
				else if (ROLE_MAP[key] && !v.name.startsWith('Energy/')) out[side][ROLE_MAP[key]] = c;
			}
			out[side] = completeRoles(out[side]);
		}
		// "Motorola Vibrant" has no separator; everything else is "Name · Style".
		let name = base.includes('·') ? base : base.replace(/^(\S+)\s+(Vibrant|Tonal Spot|Neutral)$/, '$1 · $2');
		// A17 and TAS both ship a Motorola · Vibrant; the later library says so.
		if (Object.values(themes).some((t) => t.name === name)) name += ` (${lib.split(' ')[0]})`;
		add({ name, lib, kind: 'roles', light: out.light, dark: out.dark });
		for (const n of [1, 2]) {
			if (!energy.light[`ePrimary${n}`]) continue;
			add({
				name: `${name} · Energy ${n}`,
				lib: `${lib} · Energy`,
				kind: 'roles',
				light: energize(out.light, energy.light, n),
				dark: energize(out.dark, energy.dark, n)
			});
		}
	}
}

// ── Seed themes ──────────────────────────────────────────────────────────────
for (const file of COLORWAY_FILES) {
	const { d, color } = load(file);
	const lib = libLabel(file);
	// Base colors only ("Color A".."Color F"), not their @30% / 50% tints.
	const base = d.variables.filter((v) => /^Color [A-F]$/.test(tokenKey(v.name)));
	for (const [mode, rawName] of Object.entries(d.modes)) {
		// Color A is often the pale background of the set, which would seed a
		// near-white scheme. Seed from the most chromatic color instead, and
		// let the next two steer secondary and tertiary.
		const colors = [...new Set(base.map((v) => color(v, mode)).filter(Boolean))]
			.sort((x, y) => chroma(y) - chroma(x));
		if (!colors.length) continue;
		const [a, b, c] = colors;
		const year = lib.match(/^'(\d\d)/)?.[1];
		let name = `${titleCase(rawName.trim())}${year ? ` '${year}` : ''}`;
		// '23 Global and '23 Pop share names too — the second one says which.
		if (Object.values(themes).some((t) => t.name === name)) {
			name += ` ${lib.replace(/^'\d\d\s*/, '').split(' ')[0]}`;
		}
		add({
			name,
			lib,
			kind: 'seed',
			seed: a,
			// A grey set (Graphite, Charcoal…) has no real hue for Vibrant to
			// push, so it would invent one; Neutral keeps it grey.
			variant: chroma(a) < 12 ? 'neutral' : 'vibrant',
			...(b ? { secondarySeed: b } : {}),
			...(c ? { tertiarySeed: c } : b ? { tertiarySeed: b } : {})
		});
	}
}

// ── Groups ───────────────────────────────────────────────────────────────────
// A theme's relative is named in its parenthetical when it has one
// ("Thermal (Dune V.)", "Frost (Sterling)"); otherwise by its first word.
const groupKey = (name) => {
	const paren = name.match(/\(([^)]+)\)/);
	// "(SC)" is an annotation, not a relative.
	const src = paren && !/^[A-Z]{1,3}$/.test(paren[1]) ? paren[1] : name;
	return src.split(/[\s·/]+/)[0].toLowerCase();
};
const groups = new Map();
for (const id of order) {
	const t = themes[id];
	const key = groupKey(t.name);
	if (!groups.has(key)) groups.set(key, { id: key, label: null, themes: [], hasRoles: false });
	const g = groups.get(key);
	g.themes.push(id);
	if (t.kind === 'roles') {
		g.hasRoles = true;
		g.label ??= t.name.split('·')[0].trim();
	}
}
for (const g of groups.values()) {
	if (!g.label) {
		// The shortest member name, minus year and parenthetical: "Bubble gum", "Key lime".
		const bare = g.themes.map((id) => themes[id].name.replace(/\s*\(.*?\)|\s*'\d\d$/g, '').trim());
		const own = bare.filter((n) => n.toLowerCase().startsWith(g.id));
		// Words every member shares: "Solar Dawn … Solar Night" → "Solar".
		const words = own.map((n) => n.split(' '));
		const common = [];
		for (let i = 0; words.length && words.every((w) => w[i] && w[i] === words[0][i]); i++) common.push(words[0][i]);
		g.label = common.join(' ') || g.id.charAt(0).toUpperCase() + g.id.slice(1);
	}
}
// Role-set groups first in library order (the designed themes), then the rest A–Z.
const sorted = [...groups.values()].sort((a, b) =>
	a.hasRoles !== b.hasRoles ? (a.hasRoles ? -1 : 1)
	: a.hasRoles ? 0
	: a.label.localeCompare(b.label));

const out = {
	generatedFrom: 'online-figma-emoji-grid/tokens',
	groups: sorted.map(({ id, label, themes }) => ({ id, label, themes })),
	themes
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`${order.length} themes in ${sorted.length} groups → ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
