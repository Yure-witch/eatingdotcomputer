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

// Tab icon per Telegram picker category — single source of truth shared by
// TelegramEmojiPanel (tab rail) and ExpressionTip (hover card meta line).
export const TG_CAT_ICONS = {
	Effects: '✨', Smileys: '😀', People: '🧑', 'Animals and Nature': '🐻',
	'Food and Drink': '🍔', Activity: '⚽', 'Travel and Places': '✈️',
	Objects: '💡', Symbols: '❤️', Flags: '🏁', Other: '➕'
};

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
				tgDataVer.update((n) => n + 1);
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

// Bumped when the manifest / custom-pack data resolves. The URL builders below
// read module-level state that Svelte cannot see, so a $derived built on them
// computes once and never again — a cell mounted BEFORE the manifest landed
// (recents come straight out of localStorage, no data dependency) got url ''
// and kept it forever. Deriving on this store as well makes those urls repair
// themselves the moment the data arrives.
export const tgDataVer = writable(0);

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
import { writable, get } from 'svelte/store';
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
const VALID_ENGINES = new Set(['rlottie', 'skottie', 'skottie-worker', 'skottie-webgpu', 'webgpu-rasterized', 'cpu-rasterized']);

// OLDER iOS Safari (including iPadOS in mobile mode) silently breaks on the
// OffscreenCanvas + WebGL combo the worker engines use — frames stop after a
// few seconds, sometimes the WebGL context is killed entirely. This is now
// only a DEMOTION signal, not a default: iOS starts on the GPU rasterizer
// like every other platform and drops to the CPU atlas only if the WebGPU
// probe comes back false (which is the marker for a WebKit old enough to
// have the bug).
function isIOS() {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	if (/iPhone|iPad|iPod/.test(ua)) return true;
	// iPadOS 13+ identifies as Mac unless we look at touch points.
	return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

// A RASTERIZED (baked-frame, still MOVING) engine is the default on EVERY
// platform — it bakes each animation's frames to a small atlas once and plays
// back by blitting, instead of holding a live per-emote render context. That's
// the memory-friendly path everywhere. `webgpu-rasterized` uses the GPU
// (worker atlas) and is the default everywhere; `cpu-rasterized` is the
// WebGL-free fallback (rlottie → 2D atlas), reserved for the devices where
// worker-WebGL is actually unreliable (older iOS, detected by probe).
const RASTER_ENGINES = new Set(['webgpu-rasterized', 'cpu-rasterized']);
const MANUAL_KEY = 'tgEngineManual';

// Default: `cpu-rasterized` — rlottie, the renderer Telegram itself ships,
// baking into a 2D atlas. Not a fallback any more; the default on every
// platform, because the thing it does NOT do is instantiate 7.7 MB of
// CanvasKit per worker before the first emote can register. rlottie's WASM is
// 310 KB. Same rasterize-then-blit playback either way — this is purely a
// question of which library draws the frames, and one of them costs 25× more
// to start. The Skia engines stay available from the picker's engine button.
//
// The WebGPU probe still runs, but only to set the device tier now; it no
// longer picks the engine.
const _initialEngine = (() => {
	if (typeof localStorage === 'undefined') return 'cpu-rasterized';
	const v = localStorage.getItem(ENGINE_KEY);
	// Honour an explicit, user-chosen engine (any valid one, incl. live modes).
	if (v && VALID_ENGINES.has(v) && localStorage.getItem(MANUAL_KEY) === '1') return v;
	return 'cpu-rasterized';
})();
export const engineMode = writable(_initialEngine);
if (typeof window !== 'undefined') {
	engineMode.subscribe((v) => {
		try { localStorage.setItem(ENGINE_KEY, v); } catch {}
	});
}

// Mark the engine as an explicit user choice (set from the picker's engine
// toggle) so the auto-refiner leaves it alone.
export function setEngineManual(engine) {
	try { localStorage.setItem(MANUAL_KEY, '1'); } catch {}
	engineMode.set(engine);
}

// Device tier for the emote LOD: HIGH-END devices (desktop, or a phone that's
// WebGPU-capable / has plenty of RAM+cores) upgrade a dwelling emote to crisp
// 2× res AND a higher framerate; LOW-END devices stay at the cheap low-res,
// low-fps bake. Resolved once by initEmoteEngine() alongside the WebGPU probe.
export const emoteHiTier = writable(false);

// Result of the WebGPU probe, resolved once by initEmoteEngine(). `null` until
// then. It's the same signal the engine default is chosen from, published so
// anything picking an engine later (see rasterEngineFor) makes the SAME call
// instead of re-guessing from the user agent.
export const emoteWebgpuOk = writable(null);

// Refine the rasterized engine once the WebGPU probe resolves: WebGPU-capable
// devices (incl. iOS 18+) get the GPU rasterizer; otherwise iOS falls back to
// the WebGL-free CPU atlas. Also sets the LOD device tier. No-op on the engine
// when the user picked one manually. Call once from the root layout onMount.
export async function initEmoteEngine() {
	if (typeof window === 'undefined') return;
	const { hasWebGPU } = await import('$lib/native.js');
	const webgpu = await hasWebGPU().catch(() => false);
	const coarse = !!window.matchMedia?.('(pointer: coarse)')?.matches;
	const mem = navigator.deviceMemory || 8;
	const cores = navigator.hardwareConcurrency || 4;
	// High-end = desktop, OR WebGPU-capable, OR a beefy phone (RAM + cores).
	emoteHiTier.set(!coarse || webgpu || (mem >= 6 && cores >= 6));
	emoteWebgpuOk.set(webgpu);

	// Coarse-pointer devices are pinned to the CPU atlas, MANUAL CHOICE OR
	// NOT: it is the engine every piece of the mobile optimization work landed
	// in (sheet pipeline, progressive fill, scroll hold, budget/reclaim), the
	// cycler is hidden there now, and a stale manual pick from when it wasn't
	// would strand a phone on an engine nothing tunes any more. Fine-pointer
	// machines keep their explicit choice — including narrow desktop windows;
	// this is a pointer test, not a width test.
	if (coarse) { engineMode.set('cpu-rasterized'); return; }

	let manual = false;
	try { manual = localStorage.getItem(MANUAL_KEY) === '1'; } catch { /* private mode */ }
	if (manual) return;
	// Nothing to refine: the CPU atlas is the default everywhere and it has no
	// device prerequisites (no WebGL, no OffscreenCanvas, no WebGPU), so there
	// is no probe result that would change the choice. Kept as a no-op set so
	// the store still settles on the same value the sync default picked.
	engineMode.set('cpu-rasterized');
}
export { RASTER_ENGINES };

// Engines that render through the shared worker pool. Anything gating on
// "should the pool be booted / warmed" must test THIS, not a list of engine
// names written before the rasterized engines existed — that drift is what
// silently switched the boot-time prewarm off for every default user.
const WORKER_POOL_ENGINES = new Set(['skottie-worker', 'skottie-webgpu', 'webgpu-rasterized']);
export const usesWorkerPool = (engine) => WORKER_POOL_ENGINES.has(engine);

// The picker's emote cell, in CSS px, and the playback rate its frames are
// baked for. Exported because the background warm has to bake at EXACTLY the
// size the picker asks for — frames are cached under `url@px`, so a warm at a
// different size is a cache that can never be hit. It was baking at 24 while
// the grid rendered at 28, which is why the "first open is instant" warm never
// made a single open instant.
export const PICKER_STICKER_PX = 28;
// 20. The worker advances a cell's frame off the rAF tick, so the
// playback rate has to DIVIDE the display's refresh or the frame index lands
// on an uneven cadence: at 24 fps on a 60 Hz screen each frame holds for 2.5
// ticks, i.e. 3-2-3-2 — textbook pulldown judder, which reads as skipping
// rather than as "lower framerate". 20 divides both 60 and 120 evenly (3 and 6
// ticks), so every frame holds for exactly the same number — which 24 does not,
// and that's what read as skipping. At 28px in a grid this is indistinguishable
// from 30 and bakes a third fewer frames: a 2 s emote is 40 frames, against 60
// at 30 fps and 121 under the old frame budget. Fewer frames is directly less
// time behind the thumb, since a cell doesn't reveal until its loop is whole.
export const PICKER_FPS = 20;

// Coerce an engine choice to a RASTERIZED one. Surfaces that mount a lot of
// cells at once and are visited briefly (the picker's Recent grid) can't
// afford a live per-emote render context each, so they force the baked-atlas
// path: the current engine if it's already rasterized, otherwise this device's
// rasterized default.
//
// `webgpu-rasterized` is the answer for everyone, iOS included — it bakes
// frames with Skia on the GPU, so it's faster AND sharper than the CPU atlas.
// The one exception is an iOS device that fails the WebGPU probe, which marks
// a WebKit old enough that the OffscreenCanvas+WebGL path this engine really
// renders through (see MakeWebGLCanvasSurface in skottie-worker.js — the
// `webgpu` in the name is aspirational) dies mid-animation. A pending probe
// (null) is treated as capable, matching the boot default: the rare wrong
// guess corrects itself the moment the probe lands, instead of everyone
// paying for the rare device up front. Same rule as initEmoteEngine()'s —
// the two must not drift apart.
export function rasterEngineFor(engine) {
	if (RASTER_ENGINES.has(engine)) return engine;
	return 'cpu-rasterized';
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
let _customRetryAt = 0;
// Handed to callers when the manifest isn't available. Deliberately NOT
// assigned to `_custom` — see the catch below.
const EMPTY_CUSTOM = { base: '', packs: [], byId: {}, flatAll: [] };
const _adaptivePacks = new Set();
export function loadCustomPacks() {
	if (_custom) return Promise.resolve(_custom);
	if (!_customPromise) {
		// Back off briefly after a failure so a real outage doesn't turn every
		// render pass into a fetch storm.
		if (Date.now() < _customRetryAt) return Promise.resolve(EMPTY_CUSTOM);
		_customPromise = fetch(CUSTOM_MANIFEST_URL)
			.then((r) => {
				if (!r.ok) throw new Error('manifest ' + r.status);
				return r.json();
			})
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
				tgDataVer.update((n) => n + 1);
				return _custom;
			})
			.catch(() => {
				// Never cache the failure. Assigning an empty manifest to
				// `_custom` here made one transient fetch error PERMANENT: the
				// guard at the top of this function only tests truthiness, so
				// every later call short-circuited to the empty object and
				// tgcUrl() built a broken URL for the rest of the page's life.
				// That is how a [tgc:] avatar stayed blank until a manual hard
				// refresh. Clear the in-flight promise so the next caller
				// retries, and hand this one an empty shape so nothing crashes.
				_customPromise = null;
				_customRetryAt = Date.now() + 10000;
				return EMPTY_CUSTOM;
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
