/**
 * Material 3 theme store.
 *
 * Drives the page's color tokens off a single seed color + light/dark
 * preference. The seed runs through Google's HCT-based palette generator
 * (`@material/material-color-utilities`) to produce the full M3 tonal
 * palette + role scheme (primary, secondary, tertiary, surface, error,
 * each with on-* counterparts, plus the containers). Every role color
 * is written as a CSS variable on `:root` under `--md-sys-color-*`.
 *
 * The app's legacy tokens (`--ink`, `--paper`, `--accent`) read from
 * these M3 vars with a hex fallback baked into `src/app.css`, so a page
 * that boots before this store has applied a theme still paints with
 * the original colors.
 *
 * Theme changes also notify the Telegram adaptive emoji pipeline so the
 * Skottie workers can re-tint future builds in the new ink color.
 */

import { writable, get } from 'svelte/store';
import {
	themeFromSourceColor,
	argbFromHex,
	hexFromArgb,
	Hct,
	SchemeVibrant,
	SchemeExpressive,
	SchemeFidelity,
	MaterialDynamicColors
} from '@material/material-color-utilities';

const STORAGE_KEY = 'mdTheme';

// Curated seed colors. Tonal palettes are derived live — these are
// just nice starting points. Add more freely.
//
// `variant` picks the M3 dynamic-scheme constructor. Default
// 'tonalSpot' desaturates aggressively for accessibility; for presets
// that should feel punchy / saturated (sunbursts, bubblegum) we use
// 'vibrant' or 'expressive', which preserve much more chroma from
// the seed.
export const PRESETS = [
	{ id: 'paper',     name: 'Paper',     seed: '#ffb347', emoji: '📄' },
	{ id: 'blueprint', name: 'Blueprint', seed: '#3a72a8', emoji: '📐' },
	{ id: 'matcha',    name: 'Matcha',    seed: '#7fb069', emoji: '🍵' },
	{ id: 'bubblegum', name: 'Bubblegum', seed: '#ff77a9', emoji: '🩷', variant: 'expressive' },
	{ id: 'eggplant',  name: 'Eggplant',  seed: '#7c4a8d', emoji: '🍆' },
	{ id: 'lagoon',    name: 'Lagoon',    seed: '#2bbac3', emoji: '🌊' },
	{ id: 'sunburst',  name: 'Sunburst',  seed: '#fdb813', emoji: '🌅', variant: 'vibrant' },
	{ id: 'midnight',  name: 'Midnight',  seed: '#1c2233', emoji: '🌃' }
];

const DEFAULTS = { presetId: 'paper', seed: '#ffb347', dark: false, variant: null };

function readSaved() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULTS;
		const v = JSON.parse(raw);
		return {
			presetId: typeof v.presetId === 'string' ? v.presetId : null,
			seed: typeof v.seed === 'string' ? v.seed : DEFAULTS.seed,
			dark: !!v.dark,
			variant: typeof v.variant === 'string' ? v.variant : null
		};
	} catch {
		return DEFAULTS;
	}
}

// camelCase → kebab-case for CSS variable names.
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

// Subset of the M3 Scheme worth exposing. The Scheme object is a class
// with the rest, but emitting every property would write 30+ vars per
// theme change; this list covers the roles the app actually uses.
const SCHEME_ROLES = [
	'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
	'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
	'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
	'error', 'onError', 'errorContainer', 'onErrorContainer',
	'background', 'onBackground',
	'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
	'outline', 'outlineVariant', 'shadow', 'scrim', 'inverseSurface',
	'inverseOnSurface', 'inversePrimary'
];

// MaterialDynamicColors role accessors keyed by the same camelCase
// names we store CSS vars under. We use these when a preset opts into
// a non-default scheme variant (vibrant/expressive/fidelity) — those
// constructors return a DynamicScheme rather than the Scheme objects
// `themeFromSourceColor` produces, so we have to read roles through
// the MaterialDynamicColors role objects instead of property lookup.
const DYNAMIC_ROLE_FNS = SCHEME_ROLES.reduce((acc, role) => {
	const fn = MaterialDynamicColors[role];
	if (fn && typeof fn.getArgb === 'function') acc[role] = (scheme) => fn.getArgb(scheme);
	return acc;
}, {});

const VARIANT_CTORS = {
	vibrant: SchemeVibrant,
	expressive: SchemeExpressive,
	fidelity: SchemeFidelity
};

function applyTokens(seed, dark, variant) {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const Ctor = variant && VARIANT_CTORS[variant];
	if (Ctor) {
		const scheme = new Ctor(Hct.fromInt(argbFromHex(seed)), dark, 0);
		for (const role of SCHEME_ROLES) {
			const read = DYNAMIC_ROLE_FNS[role];
			if (!read) continue;
			root.style.setProperty(`--md-sys-color-${kebab(role)}`, hexFromArgb(read(scheme)));
		}
	} else {
		const palette = themeFromSourceColor(argbFromHex(seed));
		const scheme = dark ? palette.schemes.dark : palette.schemes.light;
		for (const role of SCHEME_ROLES) {
			const argb = scheme[role];
			if (argb == null) continue;
			root.style.setProperty(`--md-sys-color-${kebab(role)}`, hexFromArgb(argb));
		}
	}
	// Surface for plain `color-scheme` so form controls / scrollbars
	// follow the theme without per-element styling.
	root.style.colorScheme = dark ? 'dark' : 'light';
}

const initial = (typeof localStorage !== 'undefined') ? readSaved() : DEFAULTS;
export const themeStore = writable(initial);

let _ready = false;
export function initTheme() {
	if (_ready || typeof window === 'undefined') return;
	_ready = true;
	const s = get(themeStore);
	applyTokens(s.seed, s.dark, s.variant);
	themeStore.subscribe((v) => {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
		applyTokens(v.seed, v.dark, v.variant);
		notifyThemeChanged();
	});
}

export function setPreset(id) {
	const p = PRESETS.find((x) => x.id === id);
	if (!p) return;
	themeStore.update((s) => ({ ...s, presetId: p.id, seed: p.seed, variant: p.variant || null }));
}

export function setSeed(hex) {
	const h = (hex || '').trim();
	if (!/^#[0-9a-f]{6}$/i.test(h)) return;
	// Custom seeds reset to the default scheme variant — vibrant/expressive
	// are explicit opt-ins per preset.
	themeStore.update((s) => ({ ...s, presetId: null, seed: h, variant: null }));
}

export function setDark(dark) {
	themeStore.update((s) => ({ ...s, dark: !!dark }));
}

// Theme-change listeners. Used by the adaptive emoji pipeline to push a
// fresh ink color into the Skottie worker pool and invalidate the
// rlottie raster cache (so adaptive packs re-bake in the new tone).
const _listeners = new Set();
export function onThemeChanged(fn) {
	_listeners.add(fn);
	return () => _listeners.delete(fn);
}
function notifyThemeChanged() {
	for (const fn of _listeners) {
		try { fn(); } catch (e) { console.warn('[theme] listener threw', e); }
	}
}
