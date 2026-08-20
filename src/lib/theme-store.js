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
 *   - vibrance      — 0–200% master multiplier over every family's
 *                     chroma, neutrals included. It composes with the
 *                     per-family chroma sliders (they set the base, this
 *                     scales it), which is what lets the mobile picker
 *                     ship one saturation control instead of four.
 *
 * Cross-device sync: `theme-sync.js` mirrors the current record + the
 * saved-scheme list to RTDB under `themes/{uid}` so phone and desktop
 * stay on the same palette. This module exposes the three hooks that
 * makes possible — `sanitizeTheme`, `themeUpdatedAt`, `applyRemoteTheme`
 * — and otherwise knows nothing about Firebase.
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

// Vibrance is a PERCENTAGE multiplier applied on top of whatever chroma
// each family already resolved to. 100 = untouched, 0 = fully grey,
// 200 = double saturation.
const clampVibrance = (n) => Math.max(0, Math.min(200, n));

// Master chroma shares the Surface slider's ceiling — see MASTER_CHROMA_MAX.
export const MASTER_CHROMA_MAX = 80;
const clampMasterChroma = (n) => Math.max(0, Math.min(MASTER_CHROMA_MAX, n));

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
	// Raspberry/Peony's palette with the primary left on the seed's own hue.
	// 'expressive' rotates primary by +240°, which renders the red seed as a blue
	// primary — correct for that variant, but not what "the red one" implies.
	// 'vibrant' keeps the hue, so buttons and accents read red like the surfaces.
	// Also carries the raised neutral chroma, so picking it from the theme picker
	// gives the same saturated surfaces as the app default.
	{ id: 'redpeony',    name: 'Red Peony',     seed: '#b61d3e', emoji: '🌹', variant: 'vibrant',
		secondarySeed: '#a03961', tertiarySeed: '#6d49b2', neutralChroma: 12 },
	{ id: 'ultra_blue',  name: 'Ultra Blue',    seed: '#0057cc', emoji: '🟦', variant: 'vibrant',
		secondarySeed: '#4355bb', tertiarySeed: '#8e3e92' },
	{ id: 'rose',        name: 'Rose',          seed: '#804d7a', emoji: '🌹', variant: 'expressive',
		secondarySeed: '#6e5868', tertiarySeed: '#825344' },
	{ id: 'monochrome',  name: 'Monochrome',    seed: '#000000', emoji: '🔳', variant: 'monochrome' },
	{ id: 'basic_blue',  name: 'Basic Blue',    seed: '#0b57d0', emoji: '🔷',
		secondarySeed: '#00639b', tertiarySeed: '#146c2e' }
];

const DEFAULTS = {
	// The global default scheme. New visitors and anyone who hasn't
	// customised a theme hit these values on first paint. Existing
	// users with a record in `localStorage["mdTheme"]` keep whatever
	// they had — readSaved won't overwrite their settings.
	// Red Peony — Raspberry/Peony's palette with an unrotated (red) primary.
	// Chosen over the old orange 'default' so the app doesn't open on a
	// generic palette. Raspberry itself is left exactly as designed.
	presetId: 'redpeony',
	seed: '#b61d3e',
	dark: false,
	variant: 'vibrant',
	contrastLevel: 0,
	// Raspberry (Peony in the source design) ships explicit secondary/tertiary
	// hues that are NOT derived from primary, so these must be 'custom' to match
	// the preset — auto-derived values give a different palette.
	secondaryMode: 'custom',   // 'auto' | 'complement' | 'custom'
	secondarySeed: '#a03961',  // only used when secondaryMode === 'custom'
	tertiaryMode: 'custom',
	tertiarySeed: '#6d49b2',
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
	// Surfaces at +50% saturation. SchemeExpressive derives neutral chroma 8.0
	// (and neutralVariant 12, a 1.5 ratio), which reads as almost-grey; 12 keeps
	// the same hue but lets the palette show in the backgrounds. The
	// neutralVariant scales by the same ratio automatically (→ 18).
	neutralChroma: 12,
	// ── Vibrance ─────────────────────────────────────────────────────────
	// One master saturation knob that multiplies the effective chroma of
	// EVERY family — primary/secondary/tertiary AND the two neutral
	// palettes that paint the surfaces. It composes with the per-family
	// chroma sliders rather than replacing them: the sliders set the base
	// chroma, vibrance scales all of them together.
	//
	// This is the single colour control the mobile picker exposes, so the
	// phone UI doesn't need four separate chroma rows. Deliberately NOT
	// reset by setPreset() — "how saturated do I like things" is a
	// standing preference that should survive switching palettes, the same
	// way `dark` does.
	vibrance: 100,
	// ── Master chroma ────────────────────────────────────────────────────
	// One absolute chroma applied to EVERY family — primary, secondary,
	// tertiary and both neutrals. null = off, and each family keeps
	// whatever the variant derived or a per-family slider set.
	//
	// Range is the Surface slider's 0–80 rather than the 0–120 the accent
	// sliders use, because 80 on the neutrals is already an extremely
	// saturated page; matching Surface is what makes "as intense as
	// Surface, but for everything" true.
	//
	// Distinct from `vibrance`: vibrance is a RELATIVE multiplier that
	// preserves the palette's internal chroma balance, this REPLACES it
	// with one flat value. They compose — master sets the base, vibrance
	// scales it — so the pair reads as "how colourful" plus "how much
	// more/less than that".
	//
	// Like vibrance, it survives a preset change and doesn't clear
	// presetId: it's a standing taste setting, so you can audition
	// palettes without it resetting under you.
	masterChroma: null
};

// Coerce an arbitrary object (localStorage blob, RTDB snapshot, saved
// scheme) into a complete, valid theme record. Every field is validated
// independently and falls back to the default, so a partial or hostile
// payload can never produce a scheme the M3 constructors choke on.
export function sanitizeTheme(v) {
	if (!v || typeof v !== 'object') return { ...DEFAULTS };
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
		neutralChroma: typeof v.neutralChroma === 'number' ? clamp01_120(v.neutralChroma) : null,
		vibrance: typeof v.vibrance === 'number' ? clampVibrance(v.vibrance) : DEFAULTS.vibrance,
		masterChroma: typeof v.masterChroma === 'number' ? clampMasterChroma(v.masterChroma) : null
	};
}

function readSaved() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		return sanitizeTheme(JSON.parse(raw));
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

// The roles that paint page/card backgrounds, split by which neutral
// palette feeds them. Vibrance's surface-deepening pass below walks
// exactly these and nothing else — every on-* role keeps its original
// tone so contrast can only improve.
const NEUTRAL_SURFACE_ROLES = [
	'background', 'surface',
	'surfaceContainerLowest', 'surfaceContainerLow',
	'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest'
];
const NEUTRAL_VARIANT_SURFACE_ROLES = ['surfaceVariant'];

// How far the light-mode surfaces may be walked down in tone to make
// room for chroma, and how fast that happens per unit of extra chroma
// asked for. 0.85 is calibrated so vibrance 200% alone (which takes the
// default neutral 12 → 24) lands at ~10 steps, matching the behaviour
// before master chroma existed; the higher ceiling only comes into play
// for the master slider, which can ask for far more.
// 45, chosen deliberately over the safer 30, so the FULL length of the
// master-chroma slider keeps moving the light-mode surfaces instead of
// saturating out around 50. Known and accepted costs at the very top of
// the range (master chroma ~70+):
//   - on-surface contrast drops to ~4.3, just under the WCAG AA 4.5
//     threshold for body text. Everything up to ~60 stays at/above AA,
//     and the whole range remains fine for large text.
//   - the hue drifts as Hct's chroma setter trades hue away to stay in
//     gamut past the sRGB edge (#dd5f80 pink at 60 → #d9541b orange at
//     70). Nothing is broken by this; the surface just stops tracking
//     the seed's hue exactly once you ask for more chroma than the
//     colour space can hold.
// Dropping this back to 30 restores a hue-stable ramp that never goes
// below 7.0 contrast, at the cost of a dead top third on the slider.
const SURFACE_TONE_SHIFT_MAX = 45;
const SURFACE_TONE_SHIFT_PER_CHROMA = 0.85;

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
		primaryChroma, secondaryChroma, tertiaryChroma, neutralChroma,
		masterChroma, vibrance
	} = opts;

	// Master chroma, when set, replaces the base chroma of every family —
	// including the per-family overrides. It has to win over them, not
	// defer to them: presets ship their own `neutralChroma` (Red Peony
	// sets 12), so a master that yielded to per-family values would leave
	// the surfaces untouched on exactly the themes people use.
	const master = typeof masterChroma === 'number' && isFinite(masterChroma)
		? clampMasterChroma(masterChroma)
		: null;

	// Vibrance → a plain multiplier. 100 (or absent) means "leave every
	// chroma exactly where the variant/overrides put it", so the whole
	// vibrance feature is a no-op for anyone who never touches it.
	const vib = typeof vibrance === 'number' && isFinite(vibrance)
		? clampVibrance(vibrance) / 100
		: 1;

	// Helper: pick a TonalPalette derived from a family. `sourcePalette`
	// is whichever palette we want the hue from; `overrideChroma`
	// (number or null) overrides its chroma. Vibrance then scales
	// whichever of the two won, so the master knob and the per-family
	// sliders compose instead of fighting.
	const paletteWith = (sourcePalette, overrideChroma) => {
		if (master == null && overrideChroma == null && vib === 1) return sourcePalette;
		const base = master ?? (overrideChroma == null ? sourcePalette.chroma : overrideChroma);
		return TonalPalette.fromHueAndChroma(sourcePalette.hue, clamp01_120(base * vib));
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
	//
	// This is also where vibrance earns the "affects all surfaces" claim —
	// the neutrals are what paint background/surface/surfaceContainer, so
	// scaling them here is what makes the whole page warm up or drain to
	// grey as the slider moves.
	let neutralPalette = base.neutralPalette;
	let neutralVariantPalette = base.neutralVariantPalette;
	// `nRest` is the chroma the surfaces carry with neither master nor
	// vibrance applied; the deepening pass at the bottom measures how far
	// past it we've pushed them.
	const nRest = neutralChroma == null ? base.neutralPalette.chroma : neutralChroma;
	let nFinal = nRest;
	if (neutralChroma != null || master != null || vib !== 1) {
		const nBase = master ?? nRest;
		nFinal = clamp01_120(nBase * vib);
		neutralPalette = TonalPalette.fromHueAndChroma(base.neutralPalette.hue, nFinal);
		// Match the variant's auto-derived ratio so neutralVariant stays
		// a touch punchier than neutral.
		const ratio = base.neutralVariantPalette.chroma / Math.max(0.0001, base.neutralPalette.chroma);
		neutralVariantPalette = TonalPalette.fromHueAndChroma(
			base.neutralVariantPalette.hue,
			Math.min(120, nFinal * (isFinite(ratio) && ratio > 0 ? ratio : 1.3))
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

	// Light mode puts surfaces at tone 90–100, where sRGB permits almost
	// no chroma at ANY hue. So raising neutral chroma alone stops doing
	// anything to the backgrounds somewhere around vibrance 100% — the
	// value clips, the accents keep moving, and the slider looks broken
	// on exactly the surfaces it claims to control. Measured: light-mode
	// surface/surfaceContainer/surfaceVariant are byte-identical at 100%
	// and 200% without this pass.
	//
	// Tone is the only axis that buys chroma headroom, so whenever we ask
	// the surfaces to carry MORE chroma than they'd rest at, we also walk
	// them a few steps deeper and re-apply the target chroma once there —
	// the tone drop is what makes the colour stick.
	//
	// Keyed on the chroma excess rather than on vibrance directly, so the
	// master chroma slider gets the same treatment; keying it to vibrance
	// would have left the new slider clipping exactly the way vibrance
	// used to. Excess 0 (the untouched default) means shift 0, so themes
	// nobody has fiddled with render byte-identically.
	//
	// Dark mode is left alone: its surfaces sit at tone 6–20 and already
	// respond to chroma across the whole range.
	const chromaExcess = Math.max(0, nFinal - nRest);
	if (!dark && chromaExcess > 0) {
		const shift = Math.min(
			SURFACE_TONE_SHIFT_MAX,
			chromaExcess * SURFACE_TONE_SHIFT_PER_CHROMA
		);
		const deepen = (argb, chromaTarget) => {
			const h = Hct.fromInt(argb);
			// Order matters: drop the tone first, then ask for the chroma.
			// The chroma setter solves against the CURRENT tone, so doing
			// it the other way round just clips again at the old tone.
			h.tone = Math.max(0, h.tone - shift);
			h.chroma = chromaTarget;
			return h.toInt();
		};
		for (const role of NEUTRAL_SURFACE_ROLES) {
			if (out[role] != null) out[role] = deepen(out[role], neutralPalette.chroma);
		}
		for (const role of NEUTRAL_VARIANT_SURFACE_ROLES) {
			if (out[role] != null) out[role] = deepen(out[role], neutralVariantPalette.chroma);
		}
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
			neutralChroma: theme.neutralChroma,
			masterChroma: theme.masterChroma,
			vibrance: theme.vibrance
		}
	);
	const root = document.documentElement;
	let surfaceHex = null;
	for (const [role, argb] of Object.entries(roles)) {
		if (argb == null) continue;
		const hex = hexFromArgb(argb);
		root.style.setProperty(`--md-sys-color-${kebab(role)}`, hex);
		if (role === 'surface') surfaceHex = hex;
	}
	// Persist the resolved page background (--paper === surface) so app.html can
	// paint it inline BEFORE hydration — kills the white/default-bg flash when the
	// native WebView reloads. Apply it now too so it's there immediately.
	if (surfaceHex) {
		root.style.backgroundColor = surfaceHex;
		try { localStorage.setItem('theme-bg', surfaceHex); } catch {}
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

// ── Cross-device sync support ─────────────────────────────────────────────
// `themeUpdatedAt` is the wall-clock time of the last LOCAL, user-driven
// change. `theme-sync.js` compares it against the timestamp on the RTDB
// record to decide which side wins on reconnect (last write wins), and
// `_applyingRemote` keeps a remotely-applied theme from being re-stamped
// as a local edit — otherwise every device would keep bumping the clock
// and ping-pong the value forever.
const UPDATED_KEY = 'mdThemeUpdatedAt';
let _applyingRemote = false;

function readUpdatedAt() {
	try { return Number(localStorage.getItem(UPDATED_KEY)) || 0; } catch { return 0; }
}
export const themeUpdatedAt = writable(
	(typeof localStorage !== 'undefined') ? readUpdatedAt() : 0
);
// Exported so theme-sync can record the timestamp it published under
// without reaching into localStorage behind this module's back.
export function stampThemeUpdatedAt(ts) {
	themeUpdatedAt.set(ts);
	try { localStorage.setItem(UPDATED_KEY, String(ts)); } catch {}
}
const stampUpdatedAt = stampThemeUpdatedAt;

// True only for the synchronous window in which applyRemoteTheme is
// writing the stores. theme-sync reads this from inside its own store
// subscriptions to tell "the user changed something" apart from "we just
// installed what the other device sent" — without it, receiving an
// update would schedule a push of that same update back out, the other
// device would receive THAT and push it back, and the two would trade
// the same theme forever.
export function isApplyingRemoteTheme() {
	return _applyingRemote;
}

// Adopt a theme + saved-scheme list that arrived from another device.
// Applies without stamping a new local timestamp; instead it inherits the
// remote one so the two devices agree on which revision they're holding.
export function applyRemoteTheme(record, saved, remoteUpdatedAt) {
	_applyingRemote = true;
	try {
		if (record) themeStore.set(sanitizeTheme(record));
		if (Array.isArray(saved)) {
			savedSchemesStore.set(
				saved.filter((x) => x && typeof x.id === 'string' && typeof x.seed === 'string')
			);
		}
	} finally {
		_applyingRemote = false;
	}
	if (typeof remoteUpdatedAt === 'number' && remoteUpdatedAt > 0) stampUpdatedAt(remoteUpdatedAt);
}

let _ready = false;
export function initTheme() {
	if (_ready || typeof window === 'undefined') return;
	_ready = true;
	applyTokens(get(themeStore));
	// `first` skips the synchronous replay Svelte fires on subscribe —
	// booting the app is not a user edit and must not bump the clock.
	let first = true;
	themeStore.subscribe((v) => {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
		if (first) first = false;
		else if (!_applyingRemote) stampUpdatedAt(Date.now());
		applyTokens(v);
		notifyThemeChanged();
	});
	let firstSaved = true;
	savedSchemesStore.subscribe((v) => {
		try { localStorage.setItem(SAVED_KEY, JSON.stringify(v)); } catch {}
		if (firstSaved) firstSaved = false;
		else if (!_applyingRemote) stampUpdatedAt(Date.now());
	});
}

// ── Mutators (everything goes through these) ──────────────────────────────

// Merge a PRESETS entry over an existing theme record. Split out of
// setPreset so `previewRoles` below can render a preset chip using the
// EXACT record tapping it would produce — a preview that drifts from the
// result is worse than no preview.
function presetRecord(p, s) {
	return {
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
		// Presets may raise the surface chroma; without this, picking one would
		// silently drop back to the variant's auto-derived (near-grey) neutrals.
		neutralChroma: p.neutralChroma ?? null
		// NOTE: `vibrance` is intentionally absent — the spread keeps the
		// user's current value. It's a standing taste preference, not part
		// of the preset's identity.
	};
}

export function setPreset(id) {
	const p = PRESETS.find((x) => x.id === id);
	if (!p) return;
	themeStore.update((s) => presetRecord(p, s));
}

// Resolve a handful of roles for an arbitrary theme record — used by the
// mobile picker to paint each preset chip in its own colours instead of a
// single seed dot. Memoised on the inputs that actually move the palette,
// since a grid of 13 presets would otherwise rebuild 13 M3 schemes on
// every vibrance tick.
const _previewCache = new Map();
const PREVIEW_ROLES = ['primary', 'secondary', 'tertiary', 'surface', 'surfaceContainerHigh', 'onSurface'];

export function previewRoles(theme) {
	const t = sanitizeTheme(theme);
	const key = [
		t.seed, t.variant, t.dark, t.contrastLevel, t.secondaryMode, t.secondarySeed,
		t.tertiaryMode, t.tertiarySeed, t.primaryChroma, t.secondaryChroma,
		t.tertiaryChroma, t.neutralChroma, t.masterChroma, t.vibrance
	].join('|');
	const hit = _previewCache.get(key);
	if (hit) return hit;

	const roles = buildSchemeRoles(t.seed, t.dark, t.variant, t.contrastLevel ?? 0, {
		secondarySource: resolveFamilySeed(t, 'secondary'),
		tertiarySource: resolveFamilySeed(t, 'tertiary'),
		primaryChroma: t.primaryChroma,
		secondaryChroma: t.secondaryChroma,
		tertiaryChroma: t.tertiaryChroma,
		neutralChroma: t.neutralChroma,
		masterChroma: t.masterChroma,
		vibrance: t.vibrance
	});
	const out = {};
	for (const r of PREVIEW_ROLES) out[r] = roles[r] != null ? hexFromArgb(roles[r]) : '#888888';
	// Cheap unbounded-growth guard — the key space is effectively the
	// preset list times the vibrance steps, but a user dragging the
	// slider across a custom seed could still accumulate entries.
	if (_previewCache.size > 400) _previewCache.clear();
	_previewCache.set(key, out);
	return out;
}

// Same thing for a PRESETS entry: what would the page look like if you
// tapped this chip, given the theme you're on now (dark mode + vibrance
// carry over, since setPreset preserves them).
export function previewRolesForPreset(p, current) {
	return previewRoles(presetRecord(p, current));
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
	// Touching one family is taking manual control, so the master
	// slider steps aside rather than continuing to override this value.
	themeStore.update((s) => ({ ...s, presetId: null, masterChroma: null, primaryChroma: n }));
}
export function setSecondaryChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	// Touching one family is taking manual control, so the master
	// slider steps aside rather than continuing to override this value.
	themeStore.update((s) => ({ ...s, presetId: null, masterChroma: null, secondaryChroma: n }));
}
export function setTertiaryChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	// Touching one family is taking manual control, so the master
	// slider steps aside rather than continuing to override this value.
	themeStore.update((s) => ({ ...s, presetId: null, masterChroma: null, tertiaryChroma: n }));
}
export function setNeutralChroma(v) {
	const n = v == null ? null : clamp01_120(Number(v));
	// Touching one family is taking manual control, so the master
	// slider steps aside rather than continuing to override this value.
	themeStore.update((s) => ({ ...s, presetId: null, masterChroma: null, neutralChroma: n }));
}

// Master saturation. Unlike the per-family setters this deliberately
// does NOT clear `presetId`: vibrance rides on top of whichever palette
// is selected (exactly like `dark`), so the preset chip stays lit while
// the user drags the slider. Clearing it would make the mobile picker's
// selected swatch blink off the moment anyone touched the slider.
export function setVibrance(v) {
	const n = clampVibrance(Number(v));
	if (!isFinite(n)) return;
	themeStore.update((s) => ({ ...s, vibrance: n }));
}

// Master chroma across every family. Pass `null` to hand each family
// back to the variant (or to its per-family slider). Like setVibrance
// this keeps `presetId`, so the selected palette stays lit while you
// dial saturation.
export function setMasterChroma(v) {
	const n = v == null ? null : clampMasterChroma(Number(v));
	if (n != null && !isFinite(n)) return;
	themeStore.update((s) => ({ ...s, masterChroma: n }));
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
		vibrance: t.vibrance ?? 100,
		masterChroma: t.masterChroma ?? null,
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
		neutralChroma: typeof s.neutralChroma === 'number' ? clamp01_120(s.neutralChroma) : null,
		vibrance: typeof s.vibrance === 'number' ? clampVibrance(s.vibrance) : 100,
		masterChroma: typeof s.masterChroma === 'number' ? clampMasterChroma(s.masterChroma) : null
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
	if (saved.vibrance != null && saved.vibrance !== 100) obj.vibrance = saved.vibrance;
	if (saved.masterChroma != null) obj.masterChroma = saved.masterChroma;
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
