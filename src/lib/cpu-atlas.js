// CPU rasterised atlas — the no-WebGL sibling of the worker's Skottie atlas,
// for iOS (and any device where the Skia/WebGL-in-worker engine is unsafe).
//
// Pipeline, all WebGL-free:
//   1. Frames are rasterised by the rlottie WASM pool (off the main thread,
//      via lottie-spritesheet's `acquire`) — the same renderer Telegram uses.
//   2. Each animation's frames are packed ONCE into a shared 2D atlas canvas
//      (a grid of slots), then the source ImageBitmaps are released. One
//      atlas texture per page instead of one per frame.
//   3. Playback is a single rAF that blits the current frame's atlas slot
//      into each visible cell's inline 2D canvas.
//
// Mirrors the worker atlas's model (slot allocator + LRU, visible-first
// rasterise priority, per-cell frame-skip) so behaviour matches across
// engines. Exposes the same API surface SpriteSticker drives for the worker
// canvas path (registerCanvasCell / setCanvasCellVisible / unregisterCanvasCell
// + ensureStage/loadAnimation/isAnimationLoaded no-ops) so it's a drop-in
// `skModule`. The only difference: the cell canvas is the live DOM element
// (a 2D context), NOT a transferControlToOffscreen handle.

import { acquire, release, rasterSizeFor, prewarm as prewarmRlottie } from './lottie-spritesheet.js';
import { fetchLottie, isAdaptivePack, customShortFromUrl } from './telegram-emoji-store.js';

// Mobile-scale atlas: native res, tiny pages. 1024² × 4 bytes = 4 MB a page.
const ATLAS_DIM = 1024;
const PAGE_BYTES = ATLAS_DIM * ATLAS_DIM * 4;
const MAX_ATLAS_PAGES = 6;          // per pixel size

// A cap on pages across EVERY pixel size, not just within one.
//
// This is the budget skottie-worker.js grew after the iOS jetsams, and it was
// never ported here — which stopped mattering right up until `cpu-rasterized`
// became the default engine, at which point the renderer everyone actually
// runs was the one with no ceiling. `_atlasByPx` is keyed by pixel size and a
// single session legitimately asks for several: picker cells at 28×dpr, pack
// tabs at 20×dpr, chat emotes at 2× oversample, avatars. At 24 MB per size
// that is ~100 MB of canvas, on the main thread's own heap, that nothing ever
// handed back — exactly the accumulation the worker comment describes.
const _lowMem = (() => {
	if (typeof navigator === 'undefined') return false;
	// deviceMemory is Chromium-only — WebKit never reports it, so a bare
	// `deviceMemory <= 4` test calls every iPhone and iPad a roomy desktop.
	if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
	return isTouchDevice();
})();
const MAX_TOTAL_PAGES = _lowMem ? 10 : 16;   // 40 MB / 64 MB
let _totalPages = 0;

const _cells = new Map();          // id -> cell state
let _nextId = 1;
const _frameCache = new Map();     // url@px -> { atlas, slots:[{page,x,y}], N, duration }
const _frameJobs = new Set();      // url@px currently rasterising
const _rasterPending = new Map();  // url@px -> { url, px } (visible-first queue)
let _rasterBusy = false;
const _atlasByPx = new Map();      // px -> atlas
let _running = false;

// Real-device detection that does not lean on the UA string.
//
// A `/iPhone|iPad|Android/` regex misses the two cases that matter most here:
// iPadOS Safari ships a macOS UA by default, and a Capacitor WKWebView can be
// configured to as well — so the devices least able to absorb a 100 MB atlas
// were the ones being handed the desktop budget. Touch points + a coarse
// pointer is what the UA was standing in for; ask for that instead.
function isTouchDevice() {
	if (typeof navigator === 'undefined') return false;
	if ((navigator.maxTouchPoints || 0) > 1) return true;
	try { return matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

// ── Atlas pages + slot allocator (2D canvases) ──────────────────────────
function makeCanvas(dim) {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(dim, dim);
	const c = document.createElement('canvas');
	c.width = dim; c.height = dim;
	return c;
}
function getAtlas(px) {
	let a = _atlasByPx.get(px);
	if (a) return a;
	a = { px, cols: Math.max(1, Math.floor(ATLAS_DIM / px)), pages: [], free: [], lru: new Map() };
	_atlasByPx.set(px, a);
	addAtlasPage(a);
	return a;
}
function addAtlasPage(a) {
	if (a.pages.length >= MAX_ATLAS_PAGES) return false;
	// Over the device-wide budget: try to buy the page back from a pixel size
	// nothing is showing before refusing. Refusing is safe (the cell keeps its
	// thumb) but it means a visible emote never animates, so only do it once
	// there is genuinely nothing idle left to drop.
	if (_totalPages >= MAX_TOTAL_PAGES) {
		reclaimIdleSizes(a.px);
		if (_totalPages >= MAX_TOTAL_PAGES) return false;
	}
	const canvas = makeCanvas(ATLAS_DIM);
	const ctx = canvas.getContext('2d');
	const page = a.pages.length;
	a.pages.push({ canvas, ctx });
	_totalPages++;
	for (let r = 0; r < a.cols; r++)
		for (let c = 0; c < a.cols; c++)
			a.free.push({ page, x: c * a.px, y: r * a.px });
	return true;
}
function atlasAllocSlots(a, n) {
	while (a.free.length < n) {
		if (addAtlasPage(a)) continue;
		const oldest = a.lru.keys().next();
		if (oldest.done) break;
		const oldKey = oldest.value;
		const old = a.lru.get(oldKey);
		a.lru.delete(oldKey);
		_frameCache.delete(oldKey);
		for (const s of old.slots) a.free.push(s);
	}
	if (a.free.length < n) return null;
	const slots = [];
	for (let i = 0; i < n; i++) slots.push(a.free.pop());
	return slots;
}
function freeFrameCache(url) {
	const suffix = url + '@';
	for (const [key, cache] of _frameCache) {
		if (!key.startsWith(suffix)) continue;
		for (const s of cache.slots) cache.atlas.free.push(s);
		cache.atlas.lru.delete(key);
		_frameCache.delete(key);
	}
}

// Drop an entire pixel size: its cache entries, its slots, and — the part
// `releaseAnimation` could never do — the page canvases themselves.
//
// Recycling slots keeps the atlas reusable but hands back zero bytes; the
// canvas still owns its full 1024² backing store. Setting the dimensions to 0
// is what actually releases it: it is the one documented way to make a canvas
// drop its buffer, and matters far more inside a WKWebView, where that buffer
// is counted against the same footprint the OS kills the app over.
function freeSize(px) {
	const a = _atlasByPx.get(px);
	if (!a) return;
	for (const key of a.lru.keys()) _frameCache.delete(key);
	for (const pg of a.pages) {
		try { pg.canvas.width = 0; pg.canvas.height = 0; } catch {}
	}
	_totalPages -= a.pages.length;
	if (_totalPages < 0) _totalPages = 0;
	a.pages.length = 0;
	a.free.length = 0;
	a.lru.clear();
	_atlasByPx.delete(px);
	// Any cell still pointing at this size must re-rasterise rather than blit
	// from a page that no longer has a backing store.
	for (const c of _cells.values()) if (c.w === px) c.lastFrame = -1;
}

/** Pixel sizes with at least one live cell — never reclaim these. */
function sizesInUse() {
	const live = new Set();
	for (const c of _cells.values()) live.add(c.w);
	return live;
}

/** Give back every size no cell is using. `keepPx` is spared regardless. */
function reclaimIdleSizes(keepPx) {
	const live = sizesInUse();
	for (const px of [..._atlasByPx.keys()]) {
		if (px === keepPx || live.has(px)) continue;
		freeSize(px);
	}
}

/**
 * Hand memory back. Mirrors `skottie-stage-worker.reclaimMemory` so callers can
 * treat the two engines the same.
 *
 * Default drops only sizes with no live cell — safe at any moment. `all: true`
 * drops everything including sizes still registered, for backgrounding, where
 * nothing is on screen to re-bake for.
 */
export function reclaimMemory({ all = false } = {}) {
	if (all) {
		for (const px of [..._atlasByPx.keys()]) freeSize(px);
		_frameCache.clear();
		_rasterPending.clear();
	} else {
		reclaimIdleSizes(null);
	}
}

/** Page/byte counts, for confirming the budget actually holds. */
export function atlasStats() {
	return {
		sizes: _atlasByPx.size,
		pages: _totalPages,
		maxPages: MAX_TOTAL_PAGES,
		bytes: _totalPages * PAGE_BYTES,
		cells: _cells.size,
		cached: _frameCache.size,
		lowMem: _lowMem
	};
}

// ── Visible-first rasterise pump ────────────────────────────────────────
function scheduleRasterize(url, px, maxFps = 0) {
	const key = url + '@' + px;
	if (_frameCache.has(key) || _frameJobs.has(key) || _rasterPending.has(key)) return;
	_rasterPending.set(key, { url, px, maxFps });
	pumpRaster();
}
function visibleKeys() {
	const set = new Set();
	for (const c of _cells.values()) if (c.visible) set.add(c.url + '@' + c.w);
	return set;
}
async function pumpRaster() {
	if (_rasterBusy) return;
	_rasterBusy = true;
	try {
		while (_rasterPending.size) {
			const vis = visibleKeys();
			for (const key of [..._rasterPending.keys()]) {
				if (!vis.has(key)) _rasterPending.delete(key); // scrolled off → abandon
			}
			if (!_rasterPending.size) break;
			const [key, job] = _rasterPending.entries().next().value;
			_rasterPending.delete(key);
			_frameJobs.add(key);
			try { await doRasterize(job.url, job.px, key, job.maxFps || 0); }
			catch (e) { console.warn('[cpu-atlas] rasterise failed', e); }
			_frameJobs.delete(key);
		}
	} finally {
		_rasterBusy = false;
	}
}
async function doRasterize(url, px, key, maxFps = 0) {
	if (_frameCache.has(key)) return;
	const data = await fetchLottie(url);   // adaptive packs are tinted here
	if (!data) return;
	let entry;
	// Ask rlottie for frames at (or just above) this atlas's slot size instead
	// of the old fixed 48px — the atlas then DOWN-scales into the slot, so big
	// cells are crisp rather than upscaled. Same size on the release below, or
	// the refcount lands on a different cache entry and the frames leak.
	const srcPx = rasterSizeFor(px);
	try { entry = await acquire(url, data, srcPx, maxFps); } catch { return; }
	// Wait for every frame to settle, then we own a full set to pack.
	try { if (entry.pending) await entry.pending; } catch {}
	const frames = entry.frames || [];
	const N = Math.max(1, entry.totalFrames || frames.length || 1);
	const atlas = getAtlas(px);
	const slots = atlasAllocSlots(atlas, N);
	if (!slots) { release(url, srcPx); return; } // atlas full — thumb stays up
	for (let i = 0; i < N; i++) {
		const bm = frames[i] || frames[0];
		const slot = slots[i];
		const ctx = atlas.pages[slot.page].ctx;
		ctx.clearRect(slot.x, slot.y, px, px);
		if (bm) {
			try { ctx.drawImage(bm, 0, 0, bm.width, bm.height, slot.x, slot.y, px, px); } catch {}
		}
	}
	release(url, srcPx); // pixels are copied into the atlas — free the rlottie bitmaps
	const cacheEntry = { atlas, slots, N, duration: entry.duration || 1 };
	_frameCache.set(key, cacheEntry);
	atlas.lru.set(key, cacheEntry);
}

// ── Single-rAF playback ─────────────────────────────────────────────────
function startLoop() {
	if (_running || typeof requestAnimationFrame === 'undefined') return;
	_running = true;
	const tick = (now) => {
		if (!_running) return;
		// Nothing registered: park the loop instead of ticking forever. It used
		// to run for the life of the page — every frame, on the main thread,
		// long after the picker closed and every cell had gone.
		if (!_cells.size) { _running = false; return; }
		renderCells(now);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}
function renderCells(now) {
	const firstPaints = [];
	for (const [, cell] of _cells) {
		if (!cell.visible || !cell.ctx) continue;
		const ckey = cell.url + '@' + cell.w;
		const cache = _frameCache.get(ckey);
		if (!cache) { scheduleRasterize(cell.url, cell.w, cell.maxFps); continue; }
		// Touch LRU so on-screen emojis are never evicted.
		cache.atlas.lru.delete(ckey);
		cache.atlas.lru.set(ckey, cache);

		let fi;
		if (cell.paused) {
			fi = cell.paintIndex != null ? Math.min(cache.N - 1, cell.paintIndex) : cache.N - 1;
		} else {
			if (!cell.startTime) cell.startTime = now;
			const elapsed = (now - cell.startTime) / 1000;
			const t = cell.loop
				? (elapsed % cache.duration) / cache.duration
				: Math.min(0.999999, elapsed / cache.duration);
			fi = Math.min(cache.N - 1, Math.floor(t * cache.N));
		}
		if (cell.firstPainted && fi === cell.lastFrame) continue;
		const slot = cache.slots[fi];
		const page = cache.atlas.pages[slot.page].canvas;
		try {
			cell.ctx.clearRect(0, 0, cell.w, cell.h);
			cell.ctx.drawImage(page, slot.x, slot.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
		} catch { continue; }
		cell.lastFrame = fi;
		if (!cell.firstPainted) { cell.firstPainted = true; if (cell.onFirstPaint) firstPaints.push(cell); }
	}
	for (const cell of firstPaints) { try { cell.onFirstPaint(); } catch {} }
}

// ── Public API (matches the worker canvas-cell module) ──────────────────
// `canvas` is the live DOM <canvas> element (NOT transferControlToOffscreen).
export function registerCanvasCell({ url, canvas, w, h, paused = false, loop = true, paintIndex = null, visible = false, maxFps = 0, onFirstPaint = null }) {
	let ctx = null;
	try { ctx = canvas.getContext('2d'); } catch { /* element gone */ }
	const id = _nextId++;
	_cells.set(id, {
		ctx, url, w, h, paused, loop, paintIndex, visible, maxFps,
		onFirstPaint, startTime: 0, lastFrame: -1, firstPainted: false
	});
	prewarmRlottie();
	startLoop();
	return id;
}
export function setCanvasCellVisible(id, v) {
	const c = _cells.get(id);
	if (c) c.visible = !!v;
}
export function unregisterCanvasCell(id) {
	_cells.delete(id);
	// Last cell out drops the sizes nothing is showing any more. SpriteSticker
	// deliberately skips releaseAnimation for built animations (it causes the
	// flash-on-scroll it guards against), so without this the picker was a
	// one-way allocator: open, allocate, close, free nothing, repeat.
	if (!_cells.size) reclaimIdleSizes(null);
}

// Frees baked atlas frames for adaptive packs so they re-rasterise in the new
// ink after a theme switch (the live --ink is baked in at rasterise time).
export function dropAdaptiveFrames() {
	const urls = new Set();
	for (const key of _frameCache.keys()) {
		const url = key.slice(0, key.lastIndexOf('@'));
		const short = customShortFromUrl(url);
		if (short && isAdaptivePack(short)) urls.add(url);
	}
	for (const url of urls) freeFrameCache(url);
	for (const cell of _cells.values()) {
		const short = customShortFromUrl(cell.url);
		if (short && isAdaptivePack(short)) cell.lastFrame = -1;
	}
}

// ── API parity no-ops (the worker module needs these; here they're free) ─
export function ensureStage() { return Promise.resolve(); }
export function loadAnimation() { /* rasterised on demand by renderCells */ }
// Free this url's baked frames. The rlottie ImageBitmaps are already gone
// (doRasterize releases them the moment they're packed) — what's held here is
// atlas slots, and those were never given back on this engine: the export was
// a no-op, so SpriteSticker's off-screen release called into nothing and every
// emote you had ever scrolled past kept its slots for the whole session.
//
// Sizes still wanted by a VISIBLE cell are kept. The cell doing the releasing
// is off-screen by definition, so its own key is not protected — but a
// different cell showing the same emote (the same sticker in the grid and in
// a chat bubble, at different sizes) doesn't lose its frames.
export function releaseAnimation(url) {
	if (!url) return;
	const keep = new Set();
	for (const c of _cells.values()) if (c.visible) keep.add(c.url + '@' + c.w);
	const prefix = url + '@';
	for (const [key, cache] of _frameCache) {
		if (!key.startsWith(prefix) || keep.has(key)) continue;
		for (const s of cache.slots) cache.atlas.free.push(s);
		cache.atlas.lru.delete(key);
		_frameCache.delete(key);
	}
}
export function isAnimationLoaded(url) {
	const suffix = url + '@';
	for (const key of _frameCache.keys()) if (key.startsWith(suffix)) return true;
	return false;
}
export function setHost() { /* no overlay canvas in this engine */ }
export function clearCanvas() { /* nothing to wipe — cells own their canvases */ }
