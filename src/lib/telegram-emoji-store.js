// Telegram animated emoji — manifest + Lottie-JSON cache, shared across importers.
// Assets live in R2 under telegram-emoji/ (see examples/upload_telegram_emoji.mjs).
// Token in message markup: [tg:<cp>]  where cp = hyphen-joined lowercase hex codepoints.

import { tintLottieAdaptive, parseInkColor } from './lottie-adaptive.js';

// Exported base so app.html / layouts can preload sheet assets without
// waiting for the emoji manifest fetch to complete.
export const TG_R2_BASE = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/telegram-emoji';
export const TG_SPRITE_URL = `${TG_R2_BASE}/sprite.webp`;
export const TG_SPRITE_MANIFEST_URL = `${TG_R2_BASE}/sprite-manifest.json`;
const MANIFEST_URL = `${TG_R2_BASE}/manifest.json`;

export const TG_RE = /\[tg:([0-9a-f-]+)\]/gi;
export const cpToToken = (cp) => `[tg:${cp}]`;
export const charToCp = (ch) => Array.from(ch).map((c) => c.codePointAt(0).toString(16)).join('-');

let _manifest = null; // { base, emoji:[{e,cp,cat,av,flag}], byCp:{}, byCat:{} }
let _manifestPromise = null;

export function loadTelegramEmoji() {
	if (_manifest) return Promise.resolve(_manifest);
	if (!_manifestPromise) {
		_manifestPromise = fetch(MANIFEST_URL)
			.then((r) => r.json())
			.then((d) => {
				const byCp = {};
				const byCat = {};
				for (const it of d.emoji) {
					byCp[it.cp] = it;
					(byCat[it.cat] ??= []).push(it);
				}
				_manifest = { base: d.base, emoji: d.emoji, byCp, byCat };
				return _manifest;
			})
			.catch(() => {
				_manifest = { base: '', emoji: [], byCp: {}, byCat: {} };
				return _manifest;
			});
	}
	return _manifestPromise;
}

export function getCachedTgEmoji() {
	return _manifest;
}

export function tgEntry(cp) {
	return _manifest?.byCp?.[cp] ?? null;
}

// URL builders (base is read from the loaded manifest)
export function tgAnimatedUrl(cp) {
	return _manifest ? `${_manifest.base}/animated/${cp}.json` : '';
}
export function tgFlagUrl(cp) {
	return _manifest ? `${_manifest.base}/flags/${cp}.webp` : '';
}
// Pre-baked WebP thumbnail of the resting frame — see examples/render_thumbs.mjs
// for the rendering pipeline. Cells paint this immediately on appear,
// browser caches it after first fetch, and the spritesheet animation
// takes over once rasterised.
export function tgThumbUrl(cp) {
	return _manifest ? `${_manifest.base}/thumbs/${cp}.webp` : '';
}

// ── Sprite sheet of every emoji's resting frame ─────────────────────────
// One ~1.5 MB WebP covering ALL emoji thumbnails (see examples/pack_sprite_sheet.mjs).
// Loaded once at picker open → every cell renders with background-image
// + background-position. Zero per-cell network requests after the sheet
// arrives. Sheet key format: "tg:<cp>" for default, "tgc:<short>:<id>" for custom.
import { writable } from 'svelte/store';
export const spriteSheet = writable(null);
let _sprite = null;
let _spritePromise = null;
export function loadSpriteSheet() {
	if (_sprite) return Promise.resolve(_sprite);
	if (!_spritePromise) {
		// Independent of the emoji manifest — uses the hard-coded R2 base
		// so the root layout / app.html can warm this cache before the
		// emoji manifest even starts loading.
		_spritePromise = fetch(TG_SPRITE_MANIFEST_URL)
			.then((r) => (r.ok ? r.json() : null))
			.then((m) => {
				if (!m) return null;
				m.sheetUrl = TG_SPRITE_URL;
				// Wait for the actual sheet bytes to be fetched + decoded
				// before notifying subscribers — otherwise cells would set
				// background-image before the asset exists and flash.
				// crossOrigin MUST match the `<link rel="preload">` in
				// app.html (which uses crossorigin="anonymous") so the
				// browser reuses the preloaded response instead of fetching
				// a second copy.
				return new Promise((resolve) => {
					const img = new Image();
					img.crossOrigin = 'anonymous';
					img.decoding = 'async';
					img.onload = () => {
						_sprite = m;
						spriteSheet.set(m);
						resolve(m);
					};
					img.onerror = () => resolve(null);
					img.src = m.sheetUrl;
				});
			})
			.catch(() => null);
	}
	return _spritePromise;
}
export function spriteKeyForCp(cp) { return `tg:${cp}`; }
export function spriteKeyForCustom(short, id) { return `tgc:${short}:${id}`; }

// ── Render engine toggle ────────────────────────────────────────────────
// `rlottie` (CPU): rasterise via rlottie WASM workers, ImageBitmap cache
//   per emoji, drawImage to canvas. Pixel-perfect — handles every Lottie
//   feature TGS uses correctly. Safest fallback (no GL).
// `skottie` (GPU): rasterise via Skia/CanvasKit-wasm in a shared WebGL
//   surface on the MAIN thread. Way faster + cheaper than CPU, but
//   mishandles certain TGS modifiers (Pucker & Bloat on stars/clovers,
//   some track mattes). The Skia work still blocks the main thread.
// `skottie-worker` (WorkerGPU): same Skia/CanvasKit renderer as
//   `skottie`, but running in a Web Worker on an OffscreenCanvas. Main
//   thread does zero per-frame GPU/WASM work — it just posts cell rects
//   to the worker each frame. Same visual fidelity as `skottie`. Best
//   for sustained-scroll perf on desktop + Android. Default.
// `skottie-webgpu` (experimental): same as `skottie-worker` but the
//   underlying CanvasKit uses a WebGPU surface (canvaskit-webgpu
//   fork) instead of WebGL. Targets browsers with WebGPU enabled —
//   notably iOS 18+ where WebGL OffscreenCanvas is buggy.
const ENGINE_KEY = 'tgEngine';
const VALID_ENGINES = new Set(['rlottie', 'skottie', 'skottie-worker', 'skottie-webgpu', 'webgpu-rasterized']);

// iOS Safari (including iPadOS in mobile mode) silently breaks on the
// OffscreenCanvas + WebGL combo the WorkerGPU engine uses — frames
// stop after a few seconds, sometimes the WebGL context is killed
// entirely. Until WebGPU lands stably on iOS, default to rlottie there.
function isIOS() {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	if (/iPhone|iPad|iPod/.test(ua)) return true;
	// iPadOS 13+ identifies as Mac unless we look at touch points.
	return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

const _initialEngine = (() => {
	if (typeof localStorage === 'undefined') return 'rlottie';
	const isCoarsePointer = typeof window !== 'undefined'
		&& window.matchMedia?.('(pointer: coarse)').matches;
	const v = localStorage.getItem(ENGINE_KEY);
	if (isCoarsePointer) {
		// iOS Safari / iOS PWAs reliably crash on ANY Skia/WebGL engine in
		// the picker once a couple dozen animations are alive — WebGL in a
		// worker is the unstable bit. CPU rlottie is the only safe choice
		// there. (A future CPU-rasterise-into-atlas path could give iOS the
		// cheap atlas playback without WebGL.)
		if (isIOS()) return 'rlottie';
		// Other touch devices (Android, etc.): prefer the RASTERIZED engine.
		// Unlike the old live engine it keeps no live WebGL animations alive
		// — it bakes frames through one transient WebGL surface, then plays
		// back from small 2D atlases (the worker auto-shrinks the atlas on
		// low-RAM devices). Respect an explicit rlottie choice, but migrate
		// any saved LIVE-Skottie variant (which can still overwhelm a mobile
		// GPU) onto the lighter rasterized path.
		if (v === 'rlottie') return 'rlottie';
		return 'webgpu-rasterized';
	}
	if (v && VALID_ENGINES.has(v)) return v;
	// Desktop / mouse → webgpu-rasterized: the worker pre-rasterises each
	// animation's frames to a cached atlas ONCE, then plays back by blitting
	// (no per-frame Skottie render/flush). Scales to many animated cells far
	// better than live per-frame rendering.
	return 'webgpu-rasterized';
})();
export const engineMode = writable(_initialEngine);
if (typeof window !== 'undefined') {
	engineMode.subscribe((v) => {
		try { localStorage.setItem(ENGINE_KEY, v); } catch {}
	});
}

export function tgAnimationUrl(cp, i) {
	return _manifest ? `${_manifest.base}/animations/${cp}_${i}.json` : '';
}

// Lottie animationData cache. We cache the raw JSON *text* and re-parse on
// every read, because consumers mutate the parsed object: lottie-web in
// particular stitches parent references and attaches renderer state to
// `animationData` in place. If chat hands the same parsed object to
// lottie-web first, that object becomes polluted (extra fields, potential
// circular refs) and a subsequent `JSON.stringify(data)` in the picker's
// spritesheet feeds garbage to rlottie — the same emoji then silently
// fails to render in the picker until a refresh clears the cache.
// Caching as text means every caller gets a fresh, isolated parsed object.
const _lottieCache = new Map(); // url -> Promise<string|null>
export function fetchLottie(url) {
	let p = _lottieCache.get(url);
	if (!p) {
		p = fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null);
		_lottieCache.set(url, p);
	}
	return p.then((text) => {
		if (!text) return null;
		const data = JSON.parse(text);
		// Telegram adaptive packs ship every fill as pure white as a
		// sentinel — the client is expected to repaint them in the
		// surrounding text color. Renderers downstream don't know about
		// this convention, so we patch the JSON here before they see it.
		// `tintLottieAdaptive` is a no-op for non-white fills, so the
		// non-adaptive path is unaffected if a short_name slip-up ever
		// happens.
		const short = customShortFromUrl(url);
		if (short && isAdaptivePack(short)) tintLottieAdaptive(data, getAdaptiveInk());
		return data;
	});
}

// ── Custom Telegram emoji packs (search-discovered, no Premium needed) ──────
const CUSTOM_MANIFEST_URL = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/telegram-custom/manifest.json';

export const TGC_RE = /\[tgc:([A-Za-z0-9_]+):(\d+)\]/g;
export const tgcToToken = (short, id) => `[tgc:${short}:${id}]`;

let _custom = null;
let _customPromise = null;
const _adaptivePacks = new Set();
export function loadCustomPacks() {
	if (_custom) return Promise.resolve(_custom);
	if (!_customPromise) {
		_customPromise = fetch(CUSTOM_MANIFEST_URL)
			.then((r) => r.json())
			.then((d) => {
				const byId = {};
				const flatAll = [];
				for (const p of d.packs) {
					if (p.text_color) _adaptivePacks.add(p.short_name);
					for (const it of p.emoji) {
						const obj = { id: it.id, alt: it.alt, short: p.short_name, packTitle: p.title };
						byId[it.id] = obj;
						flatAll.push(obj);
					}
				}
				_custom = { base: d.base, packs: d.packs, byId, flatAll };
				return _custom;
			})
			.catch(() => {
				_custom = { base: '', packs: [], byId: {}, flatAll: [] };
				return _custom;
			});
	}
	return _customPromise;
}
export function getCachedCustomPacks() { return _custom; }
export function tgcUrl(short, id) { return _custom ? `${_custom.base}/${short}/${id}.json` : ''; }
export function tgcThumbUrl(short, id) { return _custom ? `${_custom.base}/${short}/thumbs/${id}.webp` : ''; }
export function tgcEntry(id) { return _custom?.byId?.[id] ?? null; }

// Packs we want to render as a static frame instead of animating (artwork is
// effectively still, or the animation glitches even with dotLottie).
// MadEmoji is the pack whose title is "CrazyEmoji" — they share the same
// flat sticker art with no motion frame-to-frame. HeartEmoji is also
// effectively static (a single heart pose per sticker), so treat it the
// same way for the picker (no animation = belongs under Emotes, not
// Animated).
export const STATIC_PACKS = new Set(['MadEmoji', 'MadEmoji2', 'HeartEmoji']);
export const isStaticPack = (short) => STATIC_PACKS.has(short);

// ── Adaptive packs (Telegram's `text_color: true` stickerset flag) ──
// Packs whose Lotties ship as pure-white silhouettes meant to inherit
// the surrounding text color. We tint them to the current --ink before
// handing the JSON to any renderer.
export const isAdaptivePack = (short) => _adaptivePacks.has(short);
export function getAdaptivePackList() { return Array.from(_adaptivePacks); }

// Pull the current `--ink` CSS variable as a Lottie-ready [r,g,b]. Cached
// to avoid a getComputedStyle hit per cell — invalidated by
// `refreshAdaptiveInk()` when the M3 theme changes.
let _adaptiveInk = null;
export function getAdaptiveInk() {
	if (_adaptiveInk) return _adaptiveInk;
	if (typeof document === 'undefined') return [0.05, 0.05, 0.05];
	const css = getComputedStyle(document.documentElement).getPropertyValue('--ink')?.trim();
	_adaptiveInk = parseInkColor(css) || [0.05, 0.05, 0.05];
	return _adaptiveInk;
}

// Re-read `--ink` from the live CSS + drop any cached Lottie text for
// adaptive packs so subsequent fetchLottie calls re-tint into the new
// color. Returns true if the ink actually changed.
export function refreshAdaptiveInk() {
	if (typeof document === 'undefined') return false;
	const css = getComputedStyle(document.documentElement).getPropertyValue('--ink')?.trim();
	const next = parseInkColor(css) || [0.05, 0.05, 0.05];
	const prev = _adaptiveInk;
	const changed = !prev || prev[0] !== next[0] || prev[1] !== next[1] || prev[2] !== next[2];
	_adaptiveInk = next;
	if (changed) {
		// Drop cached JSON text for adaptive-pack URLs so next fetch
		// re-parses + re-tints with the fresh ink. Non-adaptive URLs
		// stay cached — they don't carry color state.
		for (const url of Array.from(_lottieCache.keys())) {
			const short = customShortFromUrl(url);
			if (short && isAdaptivePack(short)) _lottieCache.delete(url);
		}
	}
	return changed;
}

// Pull the pack short_name out of a custom-emoji R2 URL so the fetcher
// can decide whether to tint without having to thread the short through
// every caller. Format: `${base}/${short}/${id}.json`.
export function customShortFromUrl(url) {
	if (!url) return null;
	const m = /\/telegram-custom\/([^/]+)\/[^/]+\.json(?:$|\?)/.exec(url);
	return m ? m[1] : null;
}

// Lottie frame index to freeze on for static renders (and the compose preview).
// Frame 0 is often blank by convention; frame 1 has actual artwork. Clamped at
// call sites so it never exceeds the animation's total frame count.
export const STATIC_FRAME_INDEX = 1;
