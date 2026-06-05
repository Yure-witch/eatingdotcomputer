/**
 * Material 3 theme store.
 *
 * Drives the page's color tokens off a seed color + a small set of
 * customisation knobs. Every change reduces to a single Material 3
 * dynamic scheme (one of the nine variants) whose roles get written
 * to `:root` as `--md-sys-color-*` CSS variables.
 *
 * Customisation knobs (over the original "seed only" version):
 *   - variant       — TonalSpot, Vibrant, Expressive, Fidelity, Content,
 *                     Neutral, Monochrome, Rainbow, FruitSalad. Each
 *                     derives the palette family from the seed in a
 *                     different way (see the M3 spec).
 *   - contrastLevel — -1 to 1; passes straight through to the M3
 *                     constructors so the resulting palette respects
 *                     the requested contrast.
 *   - secondaryMode  — 'auto' | 'complement' | 'custom'. The variant
 *                      constructors all derive the secondary family
 *                      from the seed automatically; 'complement' uses
 *                      `TemperatureCache(seedHct).complement` (the
 *                      algorithm `examples/monet-gallery` exposes —
 *                      a true cool-warm-balanced complement, not just
 *                      hue + 180°) as the source for the secondary
 *                      family. 'custom' uses an explicit hex.
 *   - tertiaryMode   — same three options applied to the tertiary
 *                      family. Note: picking 'complement' for BOTH
 *                      secondary and tertiary makes them the same
 *                      color, since a seed has exactly one
 *                      temperature-balanced complement — use 'custom'
 *                      on one of them if you want them distinct.
 *
 * Saved schemes: the user can name + save the current configuration
 * into localStorage. Each saved scheme captures every knob above plus
 * `dark`. They surface in the UI as quick-apply chips alongside the
 * built-in PRESETS, and there's a JSON-copy affordance so the user can
 * paste a snippet here and ask me to promote it to a built-in preset
 * later.
 *
 * The app's legacy tokens (`--ink`, `--paper`, `--accent`) read from
 * the M3 vars with hex fallbacks baked into `src/app.css`, so a page
 * that boots before this store has applied a theme still paints with
 * the original colors. Theme changes also notify the Telegram adaptive
 * emoji pipeline so the Skottie workers can re-tint future builds.
 */

import { writable, get } from 'svelte/store';
import {
	argbFromHex,
	hexFromArgb,
	Hct,
	TonalPalette,
	DynamicScheme,
	TemperatureCache,
	MaterialDynamicColors,
	SchemeTonalSpot,
	SchemeVibrant,
	SchemeExpressive,
	SchemeFidelity,
	SchemeContent,
	SchemeNeutral,
	SchemeMonochrome,
	SchemeRainbow,
	SchemeFruitSalad
} from '@material/material-color-utilities';

const STORAGE_KEY = 'mdTheme';
const SAVED_KEY = 'mdSavedSchemes';

// Clamp a chroma input to a sensible M3 range. Material's HCT chroma
// is unbounded but in practice palettes top out around 130; 120 is a
// comfortable ceiling for the slider.
const clamp01_120 = (n) => Math.max(0, Math.min(120, n));

// ── Variant catalogue ────────────────────────────────────────────────────
// `id` is what we store in the theme record; `label` is the menu copy;
// `ctor` is the M3 dynamic-scheme constructor for that variant. All of
// them take the same (sourceHct, isDark, contrastLevel) signature.
export const VARIANTS = [
	{ id: 'tonalSpot',  label: 'Tonal spot',  ctor: SchemeTonalSpot },
	{ id: 'vibrant',    label: 'Vibrant',     ctor: SchemeVibrant },
	{ id: 'expressive', label: 'Expressive',  ctor: SchemeExpressive },
	{ id: 'fidelity',   label: 'Fidelity',    ctor: SchemeFidelity },
	{ id: 'content',    label: 'Content',     ctor: SchemeContent },
	{ id: 'neutral',    label: 'Neutral',     ctor: SchemeNeutral },
	{ id: 'monochrome', label: 'Monochrome',  ctor: SchemeMonochrome },
	{ id: 'rainbow',    label: 'Rainbow',     ctor: SchemeRainbow },
	{ id: 'fruitSalad', label: 'Fruit salad', ctor: SchemeFruitSalad }
];
const VARIANT_CTORS = Object.fromEntries(VARIANTS.map((v) => [v.id, v.ctor]));

// Curated seed colors — nice starting points for users who don't want
// to fiddle with a colour picker. `variant` is optional; absent ⇒
// `tonalSpot`.
export const PRESETS = [
	// Default — promoted from a saved scheme. Listed first so it's
	// the most prominent option in the picker.
	{ id: 'default',     name: 'Default',                  seed: '#ffa305', emoji: '🎨', variant: 'vibrant' },
	// TEST themes — seeds taken from each theme's LIGHT-mode primary
	// value in examples/TESTthemes.json. Variants chosen to match
	// each theme's character (vibrant for the punchy colours,
	// neutral for the muted ones, monochrome where appropriate).
	//
	// Some themes intentionally use a secondary/tertiary hue that is
	// NOT derived from primary — Lemongrass with its olive primary
	// pairs with a slate-blue secondary, for instance. Those themes
	// carry explicit `secondarySeed` / `tertiarySeed` so setPreset
	// kicks them into custom mode and the resulting palette matches
	// the source design.
	{ id: 'porcelain',   name: 'Porcelain',     seed: '#665f51', emoji: '🏺' },
	{ id: 'midnight',    name: 'Midnight',      seed: '#59625d', emoji: '🌑', variant: 'neutral' },
	{ id: 'sterling',    name: 'Sterling',      seed: '#5b606d', emoji: '🌙', variant: 'neutral' },
	{ id: 'smokey_green',name: 'Smokey green',  seed: '#506531', emoji: '🪴' },
	{ id: 'iris',        name: 'Iris',          seed: '#4958a9', emoji: '🌸', variant: 'vibrant',
		secondarySeed: '#596339', tertiarySeed: '#596400' },
	{ id: 'lemoncello',  name: 'Lemoncello',    seed: '#383f00', emoji: '🍋', variant: 'vibrant',
		secondarySeed: '#545d7e', tertiarySeed: '#4d599d' },
	{ id: 'raspberry',   name: 'Raspberry',     seed: '#b61d3e', emoji: '🌺', variant: 'expressive',
		secondarySeed: '#a03961', tertiarySeed: '#6d49b2' },
	{ id: 'ultra_blue',  name: 'Ultra Blue',    seed: '#0057cc', emoji: '🟦', variant: 'vibrant',
		secondarySeed: '#4355bb', tertiarySeed: '#8e3e92' },
	{ id: 'rose',        name: 'Rose',          seed: '#804d7a', emoji: '🌹', variant: 'expressive',
		secondarySeed: '#6e5868', tertiarySeed: '#825344' },
	{ id: 'monochrome',  name: 'Monochrome',    seed: '#000000', emoji: '🔳', variant: 'monochrome' },
	{ id: 'basic_blue',  name: 'Basic Blue',    seed: '#0b57d0', emoji: '🔷',
		secondarySeed: '#00639b', tertiarySeed: '#146c2e' }
];

const DEFAULTS = {
	// `default` is the global default scheme (promoted from a
	// user-saved scheme). New visitors and anyone who hasn't
	// customised a theme hits these values on first paint. Existing
	// users with a record in `localStorage["mdTheme"]` keep whatever
	// they had — readSaved won't overwrite their settings.
	presetId: 'default',
	seed: '#ffa305',
	dark: false,
	variant: 'vibrant',
	contrastLevel: 0,
	secondaryMode: 'auto',     // 'auto' | 'complement' | 'custom'
	secondarySeed: '#7fb069',  // only used when secondaryMode === 'custom'
	tertiaryMode: 'auto',
	tertiarySeed: '#3a72a8',
	// Per-family chroma overrides. null = let the variant's
	// auto-derived chroma stand; a number (0–120-ish in M3 units)
	// replaces the palette's chroma while preserving the auto-derived
	// hue. The slider in the picker writes these.
	primaryChroma: null,
	secondaryChroma: null,
	tertiaryChroma: null,
	// Neutral chroma overrides BOTH the neutralPalette (drives surface,
	// onSurface, surfaceContainer*) AND the neutralVariantPalette
	// (drives surfaceVariant, onSurfaceVariant, outline). One slider
	// for both since they're meant to read as the same family — the
	// variant just gives neutralVariant a touch more chroma by spec.
	neutralChroma: null
};

function readSaved() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const v = JSON.parse(raw);
		return {
			presetId: typeof v.presetId === 'string' ? v.presetId : null,
			seed: typeof v.seed === 'string' ? v.seed : DEFAULTS.seed,
			dark: !!v.dark,
			variant: VARIANT_CTORS[v.variant] ? v.variant : DEFAULTS.variant,
			contrastLevel: typeof v.contrastLevel === 'number'
				? Math.max(-1, Math.min(1, v.contrastLevel))
				: DEFAULTS.contrastLevel,
			secondaryMode: ['auto', 'complement', 'custom'].includes(v.secondaryMode)
				? v.secondaryMode : DEFAULTS.secondaryMode,
			secondarySeed: typeof v.secondarySeed === 'string'
				? v.secondarySeed : DEFAULTS.secondarySeed,
			tertiaryMode: ['auto', 'complement', 'custom'].includes(v.tertiaryMode)
				? v.tertiaryMode : DEFAULTS.tertiaryMode,
			tertiarySeed: typeof v.tertiarySeed === 'string'
				? v.tertiarySeed : DEFAULTS.tertiarySeed,
			primaryChroma: typeof v.primaryChroma === 'number' ? clamp01_120(v.primaryChroma) : null,
			secondaryChroma: typeof v.secondaryChroma === 'number' ? clamp01_120(v.secondaryChroma) : null,
			tertiaryChroma: typeof v.tertiaryChroma === 'number' ? clamp01_120(v.tertiaryChroma) : null,
			neutralChroma: typeof v.neutralChroma === 'number' ? clamp01_120(v.neutralChroma) : null
		};
	} catch {
		return { ...DEFAULTS };
	}
}

function readSavedSchemes() {
	try {
		const raw = localStorage.getItem(SAVED_KEY);
		if (!raw) return [];
		const v = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		return v.filter((s) => s && typeof s.id === 'string' && typeof s.seed === 'string');
	} catch { return []; }
}

// camelCase → kebab-case for CSS variable names.
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

// Subset of the M3 Scheme worth exposing. The DynamicScheme has more
// roles than this, but emitting every one would write 40+ vars per
// theme change; this list covers the roles the app actually uses.
const SCHEME_ROLES = [
	'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
	'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
	'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
	'error', 'onError', 'errorContainer', 'onErrorContainer',
	'background', 'onBackground',
	'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
	// surface-container family — M3's "elevated/secondary surface"
	// tokens. The sidebar/bottom-nav use surfaceContainer so they
	// adapt to seed + neutral chroma changes.
	'surfaceContainer', 'surfaceContainerLow', 'surfaceContainerHigh',
	'surfaceContainerLowest', 'surfaceContainerHighest',
	'outline', 'outlineVariant', 'shadow', 'scrim', 'inverseSurface',
	'inverseOnSurface', 'inversePrimary'
];

const DYNAMIC_ROLE_FNS = SCHEME_ROLES.reduce((acc, role) => {
	const fn = MaterialDynamicColors[role];
	if (fn && typeof fn.getArgb === 'function') acc[role] = (scheme) => fn.getArgb(scheme);
	return acc;
}, {});

// Build a final M3 scheme honouring:
//   - variant choice (TonalSpot, Vibrant, etc.)
//   - secondary / tertiary seed overrides (complement or custom)
//   - per-family chroma overrides (primary / secondary / tertiary)
//
// Construction strategy:
//   1. Build the variant's baseline scheme from the seed — gives us
//      the auto-derived hues + chromas for every family the variant
//      ships with.
//   2. For each family, decide its final TonalPalette:
//        - hue comes from the override-seed scheme if the user picked
//          a custom/complement; otherwise from the variant's auto
//          palette for that family.
//        - chroma comes from the user's slider if set; otherwise from
//          whichever palette we sourced the hue from.
//   3. Construct a new DynamicScheme passing those three palette
//      overrides explicitly so the role values (secondary, on-
//      secondary, secondary-container, etc.) are all consistent.
function buildSchemeRoles(seed, dark, variantId, contrastLevel, opts = {}) {
	const Ctor = VARIANT_CTORS[variantId] || SchemeTonalSpot;
	const seedHct = Hct.fromInt(argbFromHex(seed));
	const base = new Ctor(seedHct, dark, contrastLevel);
	const {
		secondarySource, tertiarySource,
		primaryChroma, secondaryChroma, tertiaryChroma, neutralChroma
	} = opts;

	// Helper: pick a TonalPalette derived from a family. `sourcePalette`
	// is whichever palette we want the hue from; `overrideChroma`
	// (number or null) overrides its chroma.
	const paletteWith = (sourcePalette, overrideChroma) => {
		if (overrideChroma == null) return sourcePalette;
		return TonalPalette.fromHueAndChroma(sourcePalette.hue, overrideChroma);
	};

	// Primary family — only chroma can be overridden (the seed itself
	// drives the hue). Secondary/tertiary can have their HUE swapped
	// via an override seed and their chroma overridden independently.
	const primaryPalette = paletteWith(base.primaryPalette, primaryChroma);

	// When the user picks a custom (or complement) seed for
	// secondary/tertiary, build the palette DIRECTLY from that
	// seed's HCT — not via the variant's primary-palette ctor.
	// Vibrant/Expressive would force the chroma up to ~200 and lift
	// the resulting `secondary` tone away from the chosen colour;
	// using the source's own chroma means tone-40 of the palette ≈
	// the source colour, so the rendered role matches what the user
	// (or a reference design like TEST themes) actually specified.
	const paletteFromHex = (hex) => {
		const h = Hct.fromInt(argbFromHex(hex));
		return TonalPalette.fromHueAndChroma(h.hue, h.chroma);
	};

	let secondaryPalette = base.secondaryPalette;
	if (secondarySource) secondaryPalette = paletteFromHex(secondarySource);
	secondaryPalette = paletteWith(secondaryPalette, secondaryChroma);

	let tertiaryPalette = base.tertiaryPalette;
	if (tertiarySource) tertiaryPalette = paletteFromHex(tertiarySource);
	tertiaryPalette = paletteWith(tertiaryPalette, tertiaryChroma);

	// Neutral chroma override — applies to both neutralPalette and
	// neutralVariantPalette, preserving the hue + the small chroma
	// differential the variant provides between them (we scale them
	// proportionally so neutralVariant stays slightly more chromatic
	// than neutral, matching M3's spec ratio).
	let neutralPalette = base.neutralPalette;
	let neutralVariantPalette = base.neutralVariantPalette;
	if (neutralChroma != null) {
		neutralPalette = TonalPalette.fromHueAndChroma(base.neutralPalette.hue, neutralChroma);
		// Match the variant's auto-derived ratio so neutralVariant stays
		// a touch punchier than neutral.
		const ratio = base.neutralVariantPalette.chroma / Math.max(0.0001, base.neutralPalette.chroma);
		neutralVariantPalette = TonalPalette.fromHueAndChroma(
			base.neutralVariantPalette.hue,
			Math.min(120, neutralChroma * (isFinite(ratio) && ratio > 0 ? ratio : 1.3))
		);
	}

	const finalScheme = new DynamicScheme({
		sourceColorHct: seedHct,
		variant: base.variant,
		contrastLevel,
		isDark: dark,
		primaryPalette,
		secondaryPalette,
		tertiaryPalette,
		neutralPalette,
		neutralVariantPalette
	});

	const out = {};
	for (const role of SCHEME_ROLES) {
		const read = DYNAMIC_ROLE_FNS[role];
		if (read) out[role] = read(finalScheme);
	}
	return out;
}

// Compute the temperature-based complement of a hex seed. This is the
// algorithm referenced by examples/monet-gallery — not a naive 180°
// hue rotation. From the source: "1. Create colors for all hues, with
// chroma and tone of input. 2. Use color science to measure their
// temperature. 3. Divide colors by hue; coldest to hottest & hottest
// to coldest. 4. Determine the group containing input. 5. Find its
// temperature percentile in the group. 6. The complement is that
// percentile in the other group."
export function complementOf(hex) {
	try {
		const cache = new TemperatureCache(Hct.fromInt(argbFromHex(hex)));
		return hexFromArgb(cache.complement.toInt());
	} catch { return hex; }
}

// Resolve an effective override seed for a single family ('secondary'
// or 'tertiary') from a theme record. Returns null when the variant's
// default for that family should stand.
function resolveFamilySeed(theme, family) {
	const mode = theme[`${family}Mode`];
	if (mode === 'complement') return complementOf(theme.seed);
	if (mode === 'custom') return theme[`${family}Seed`];
	return null;
}

function applyTokens(theme) {
	if (typeof document === 'undefined') return;
	const roles = buildSchemeRoles(
		theme.seed, theme.dark, theme.variant, theme.contrastLevel ?? 0,
		{
			secondarySource: resolveFamilySeed(theme, 'secondary'),
			tertiarySource: resolveFamilySeed(theme, 'tertiary'),
			primaryChroma: theme.primaryChroma,
			secondaryChroma: theme.secondaryChroma,
			tertiaryChroma: theme.tertiaryChroma,
			neutralChroma: theme.neutralChroma
		}
	);
	const root = document.documentElement;
	for (const [role, argb] of Object.entries(roles)) {
		if (argb == null) continue;
		root.style.setProperty(`--md-sys-color-${kebab(role)}`, hexFromArgb(argb));
	}
	// Surface for plain `color-scheme` so form controls / scrollbars
	// follow the theme without per-element styling.
	root.style.colorScheme = theme.dark ? 'dark' : 'light';
	// Class hook so CSS can override the M3 on-surface tone with our
	// own maxed-out contrast values per mode. `color-scheme` isn't
	// queryable as a pseudo-class, so we have to mirror the state.
	root.classList.toggle('theme-dark', !!theme.dark);
}

// ── Stores ────────────────────────────────────────────────────────────────
const initial = (typeof localStorage !== 'undefined') ? readSaved() : { ...DEFAULTS };
export const themeStore = writable(initial);

const initialSaved = (typeof localStorage !== 'undefined') ? readSavedSchemes() : [];
export const savedSchemesStore = writable(initialSaved);

let _ready = false;
export function initTheme() {
	if (_ready || typeof window === 'undefined') return;
	_ready = true;
	applyTokens(get(themeStore));
	themeStore.subscribe((v) => {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
		applyTokens(v);
		notifyThemeChanged();
	});
	savedSchemesStore.subscribe((v) => {
		try { localStorage.setItem(SAVED_KEY, JSON.stringify(v)); } catch {}
	});
}

// ── Mutators (everything goes through these) ──────────────────────────────
export function setPreset(id) {
	const p = PRESETS.find((x) => x.id === id);
	if (!p) return;
	themeStore.update((s) => ({
		...s,
		presetId: p.id,
		seed: p.seed,
		// Fall back to the M3-spec'd default variant (tonalSpot), NOT
		// to DEFAULTS.variant — DEFAULTS.variant is whatever the global
		// default preset uses (currently 'vibrant'), which would
		// silently override a preset that intentionally left `variant`
		// blank because it wanted plain TonalSpot.
		variant: p.variant || 'tonalSpot',
		// Picking a built-in preset resets the customisation knobs so
		// the preview reflects the preset as defined. Presets that
		// ship explicit secondary/tertiary seeds carry those forward —
		// some themes (Lemongrass, Iris, Peony, etc.) intentionally
		// use a hue that's NOT derived from primary, so auto-mode
		// wouldn't match the design.
		contrastLevel: 0,
		secondaryMode: p.secondaryMode || (p.secondarySeed ? 'custom' : 'auto'),
		secondarySeed: p.secondarySeed || s.secondarySeed,
		tertiaryMode:  p.tertiaryMode  || (p.tertiarySeed  ? 'custom' : 'auto'),
		tertiarySeed:  p.tertiarySeed  || s.tertiarySeed,
		primaryChroma: null,
		secondaryChroma: null,
		tertiaryChroma: null,
		neutralChroma: null
	}));
}

export function setSeed(hex) {
	const h = (hex || '').trim();
	if (!/^#[0-9a-f]{6}$/i.test(h)) return;
	themeStore.update((s) => ({ ...s, presetId: null, seed: h }));
}

export function setSecondarySeed(hex) {
	const h = (hex || '').trim();
	if (!/^#[0-9a-f]{6}$/i.test(h)) return;
	themeStore.update((s) => ({ ...s, presetId: null, secondarySeed: h, secondaryMode: 'custom' }));
}

export function setSecondaryMode(mode) {
	if (!['auto', 'complement', 'custom'].includes(mode)) return;
	themeStore.update((s) => ({ ...s, presetId: null, secondaryMode: mode }));
}

export function setTertiarySeed(hex) {
	const h = (hex || '').trim();
	if (!/^#[0-9a-f]{6}$/i.test(h)) return;
	themeStore.update((s) => ({ ...s, presetId: null, tertiarySeed: h, tertiaryMode: 'custom' }));
}

export function setTertiaryMode(mode) {
	if (!['auto', 'complement', 'custom'].includes(mode)) return;
	themeStore.update((s) => ({ ...s, presetId: null, tertiaryMode: mode }));
}

// Per-family chroma overrides. Pass `null` to revert to the variant's
// auto-derived chroma for that family.
export function setPrimaryChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	themeStore.update((s) => ({ ...s, presetId: null, primaryChroma: n }));
}
export function setSecondaryChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	themeStore.update((s) => ({ ...s, presetId: null, secondaryChroma: n }));
}
export function setTertiaryChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	themeStore.update((s) => ({ ...s, presetId: null, tertiaryChroma: n }));
}
export function setNeutralChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	themeStore.update((s) => ({ ...s, presetId: null, neutralChroma: n }));
}

// Read the current AUTO chroma of a family for the active theme — the
// value the variant would derive if no override were set. Used by the
// UI to label the slider's "default" position.
export function autoChromaFor(theme, family) {
	try {
		const Ctor = VARIANT_CTORS[theme.variant] || SchemeTonalSpot;
		const base = new Ctor(Hct.fromInt(argbFromHex(theme.seed)), theme.dark, theme.contrastLevel ?? 0);
		if (family === 'primary') return base.primaryPalette.chroma;
		if (family === 'neutral') return base.neutralPalette.chroma;
		const src = resolveFamilySeed(theme, family);
		if (src) {
			// Matches the direct-from-HCT path in buildSchemeRoles —
			// `auto` for a custom secondary is the source colour's
			// own chroma, not the variant's boosted version.
			return Hct.fromInt(argbFromHex(src)).chroma;
		}
		return family === 'secondary' ? base.secondaryPalette.chroma : base.tertiaryPalette.chroma;
	} catch { return 0; }
}

export function setVariant(id) {
	if (!VARIANT_CTORS[id]) return;
	themeStore.update((s) => ({ ...s, presetId: null, variant: id }));
}

export function setContrast(level) {
	const n = Math.max(-1, Math.min(1, Number(level) || 0));
	themeStore.update((s) => ({ ...s, presetId: null, contrastLevel: n }));
}

export function setDark(dark) {
	themeStore.update((s) => ({ ...s, dark: !!dark }));
}

// ── Saved schemes ─────────────────────────────────────────────────────────
// Capture every knob that affects rendering so applying a saved scheme
// later produces exactly the same palette.
export function saveCurrentScheme(name) {
	const trimmed = (name || '').trim();
	if (!trimmed) return null;
	const t = get(themeStore);
	const id = 'saved_' + Math.random().toString(36).slice(2, 9);
	const entry = {
		id,
		name: trimmed,
		seed: t.seed,
		dark: t.dark,
		variant: t.variant,
		contrastLevel: t.contrastLevel ?? 0,
		secondaryMode: t.secondaryMode ?? 'auto',
		secondarySeed: t.secondarySeed ?? DEFAULTS.secondarySeed,
		tertiaryMode: t.tertiaryMode ?? 'auto',
		tertiarySeed: t.tertiarySeed ?? DEFAULTS.tertiarySeed,
		primaryChroma: t.primaryChroma ?? null,
		secondaryChroma: t.secondaryChroma ?? null,
		tertiaryChroma: t.tertiaryChroma ?? null,
		neutralChroma: t.neutralChroma ?? null,
		createdAt: Date.now()
	};
	savedSchemesStore.update((arr) => [...arr, entry]);
	return entry;
}

export function applySavedScheme(id) {
	const arr = get(savedSchemesStore);
	const s = arr.find((x) => x.id === id);
	if (!s) return;
	themeStore.update((t) => ({
		...t,
		presetId: null,
		seed: s.seed,
		dark: !!s.dark,
		variant: VARIANT_CTORS[s.variant] ? s.variant : DEFAULTS.variant,
		contrastLevel: typeof s.contrastLevel === 'number' ? s.contrastLevel : 0,
		secondaryMode: ['auto', 'complement', 'custom'].includes(s.secondaryMode)
			? s.secondaryMode : 'auto',
		secondarySeed: typeof s.secondarySeed === 'string' ? s.secondarySeed : DEFAULTS.secondarySeed,
		tertiaryMode: ['auto', 'complement', 'custom'].includes(s.tertiaryMode)
			? s.tertiaryMode : 'auto',
		tertiarySeed: typeof s.tertiarySeed === 'string' ? s.tertiarySeed : DEFAULTS.tertiarySeed,
		primaryChroma: typeof s.primaryChroma === 'number' ? clamp01_120(s.primaryChroma) : null,
		secondaryChroma: typeof s.secondaryChroma === 'number' ? clamp01_120(s.secondaryChroma) : null,
		tertiaryChroma: typeof s.tertiaryChroma === 'number' ? clamp01_120(s.tertiaryChroma) : null,
		neutralChroma: typeof s.neutralChroma === 'number' ? clamp01_120(s.neutralChroma) : null
	}));
}

export function deleteSavedScheme(id) {
	savedSchemesStore.update((arr) => arr.filter((x) => x.id !== id));
}

export function renameSavedScheme(id, name) {
	const trimmed = (name || '').trim();
	if (!trimmed) return;
	savedSchemesStore.update((arr) =>
		arr.map((x) => (x.id === id ? { ...x, name: trimmed } : x)));
}

// Snippet ready to drop into PRESETS[] above. Use this when handing me
// a saved scheme to promote into a built-in: copy the printed JSON,
// paste into chat, say "add this as a preset called X".
export function presetSnippetFor(saved) {
	const obj = {
		id: (saved.name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
		name: saved.name,
		seed: saved.seed,
		emoji: '🎨'
	};
	if (saved.variant && saved.variant !== 'tonalSpot') obj.variant = saved.variant;
	if (saved.contrastLevel) obj.contrastLevel = saved.contrastLevel;
	if (saved.secondaryMode && saved.secondaryMode !== 'auto') {
		obj.secondaryMode = saved.secondaryMode;
		if (saved.secondaryMode === 'custom') obj.secondarySeed = saved.secondarySeed;
	}
	if (saved.tertiaryMode && saved.tertiaryMode !== 'auto') {
		obj.tertiaryMode = saved.tertiaryMode;
		if (saved.tertiaryMode === 'custom') obj.tertiarySeed = saved.tertiarySeed;
	}
	if (saved.primaryChroma   != null) obj.primaryChroma   = saved.primaryChroma;
	if (saved.secondaryChroma != null) obj.secondaryChroma = saved.secondaryChroma;
	if (saved.tertiaryChroma  != null) obj.tertiaryChroma  = saved.tertiaryChroma;
	if (saved.neutralChroma   != null) obj.neutralChroma   = saved.neutralChroma;
	if (saved.dark) obj.dark = true;
	return JSON.stringify(obj, null, 2);
}

// ── Theme-change listeners (Telegram adaptive emoji pipeline) ─────────────
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
