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
import { loadFrames as fcLoad, storeFrames as fcStore, hasFrames as fcHas, frameCacheAvailable } from './frame-cache.js';
import { fetchLottie, isAdaptivePack, customShortFromUrl } from './telegram-emoji-store.js';

// Mobile-scale atlas: native res, tiny pages. 1024² × 4 bytes = 4 MB a page.
const ATLAS_DIM = 1024;
const PAGE_BYTES = ATLAS_DIM * ATLAS_DIM * 4;
// Per pixel size. Sized so the picker's ON-SCREEN grid fits entirely:
//
//     18x18 slots/page x 10 pages = 3240 slots
//     3240 / 30 frames per emote  = 108 emotes
//
// against the ~90 cells a 9-column grid shows. At six pages and an uncapped
// 60-frame bake only 32 of those 90 fitted, so two thirds of the grid sat
// frozen on its thumb — which read as "the animations don't animate", because
// for most cells they genuinely didn't.
const MAX_ATLAS_PAGES = 10;

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
// Atlas slots are the scarce resource, and their cost is AREA. A picker cell is
// 28 CSS px, and baking at full dpr (56px on a retina phone) spends 4x the
// slots of baking at 1x for detail nobody can see at that size.
//
//     90 emotes x 60 frames = 5400 slots for a full grid at 20fps
//     at 56px: 324/page -> 17 pages -> 68MB
//     at 42px: 576/page -> 10 pages -> 40MB
//
// So cap the slot at 1.5x CSS and let the blit scale the last stretch. 1.5 is
// already what this codebase treats as the sensible ceiling — skottie-worker's
// supersampleFor uses it, noting the anti-aliasing gain past that is invisible
// at emote sizes. Only picker/tab-sized cells are capped; anything larger is
// rare enough not to pressure the budget and keeps its full resolution.
const SLOT_PX_MAX = 42;
const slotPxFor = (px) => (px > SLOT_PX_MAX && px <= 64 ? SLOT_PX_MAX : px);

const _lowMem = (() => {
	if (typeof navigator === 'undefined') return false;
	// deviceMemory is Chromium-only — WebKit never reports it, so a bare
	// `deviceMemory <= 4` test calls every iPhone and iPad a roomy desktop.
	if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
	return isTouchDevice();
})();
// Device-wide. One size claiming its full 10 pages must still leave room for
// the others live at the same time — chiefly the tab icons above the grid.
// 48MB bounded and released on close, against the 120MB-and-climbing that was
// jetsamming the app.
const MAX_TOTAL_PAGES = _lowMem ? 12 : 18;   // 48 MB / 72 MB
let _totalPages = 0;

// Slots are the scarce resource, and an emote costs one per frame — so an
// uncapped bake lets a handful of long animations eat the budget the whole
// grid has to share. skottie-worker has had MAX_RASTER_FRAMES for exactly this
// reason; cpu-atlas never got it.
//
// Capping frames rather than fps is the right knob: it spends the budget where
// it is perceptible. A 1s emote keeps the full 20fps the picker asks for, and
// only a long one degrades — and a 3s animation is slow-moving by nature, so
// fewer samples across it costs far less than freezing it outright, which is
// what the shortfall was doing to two thirds of the grid.
// Headroom for a full-length emote at the rate the picker asks for. The
// median Telegram emote is exactly 3.00s, so 20fps needs 60 frames; a cap of
// 30 quietly halved every one of them to 10fps, which is what "animating at
// 3fps" was. Frames are no longer the lever — slot SIZE is (see SLOT_PX_MAX).
const MAX_RASTER_FRAMES = _lowMem ? 64 : 128;

/**
 * Frames-per-second to bake at, so an emote never exceeds MAX_RASTER_FRAMES.
 * Reads the duration straight off the Lottie JSON, before any rasterising.
 */
function fpsCapFor(data, maxFps) {
	const dur = Math.max(0.1, ((data?.op || 60) - (data?.ip || 0)) / (data?.fr || 60));
	const want = maxFps > 0 ? maxFps : (data?.fr || 60);
	const byBudget = MAX_RASTER_FRAMES / dur;
	return Math.max(4, Math.min(want, byBudget));   // never below 4fps
}

const _cells = new Map();          // id -> cell state
let _nextId = 1;
const _frameCache = new Map();     // url@px -> { atlas, slots:[{page,x,y}], N, duration }
const _frameJobs = new Set();      // url@px currently rasterising
const _rasterPending = new Map();  // url@px -> { url, px } (visible-first queue)
const _atlasByPx = new Map();      // px -> atlas
let _running = false;
// Bumped by every reclaim. A bake that started before the current epoch is
// writing into an atlas that no longer exists, so its result is dropped rather
// than cached — see the check at the end of doRasterize.
let _epoch = 0;

// ── Live profiling ────────────────────────────────────────────────────
// A synthetic blit benchmark said every render approach costs <1ms at 60fps
// with zero jank, while the actual picker ran at ~1fps. That gap is the whole
// point of these counters: the cost is NOT in drawing frames, it is in the work
// around it — rasterising, packing, and the synchronous readbacks the disk
// cache does. Measure the real path rather than a model of it.
const _prof = { render: 0, renderN: 0, raster: 0, rasterN: 0, pack: 0, packN: 0, readback: 0, readbackN: 0, lanes: 0 };
export function atlasProfile(reset = false) {
	const out = { ..._prof, lanesNow: _rasterLanes, pending: _rasterPending.size, jobs: _frameJobs.size };
	if (reset) for (const k of Object.keys(_prof)) _prof[k] = 0;
	return out;
}

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
	// Never evict an emote a VISIBLE cell is using.
	//
	// Plain LRU is wrong once demand exceeds the atlas. Every cell on screen is
	// touched every frame, so "least recently used" degenerates into "painted
	// earliest this frame" — a live, on-screen emote. Evicting it makes its cell
	// re-request immediately, which evicts another, and the grid spends all its
	// time re-baking what it just threw away. That is the "updates each emote
	// one by one in a row, ugly and slow" symptom: not a slow frame rate, a
	// cache thrashing against itself.
	//
	// Failing the allocation instead leaves the thumb up for cells that don't
	// fit. A stable grid where some cells are still beats a churning one where
	// every cell flickers, and it stops the wasted rasterising from crowding out
	// the cells that DID fit.
	let protectedKeys = null;
	while (a.free.length < n) {
		if (addAtlasPage(a)) continue;
		if (!protectedKeys) protectedKeys = visibleKeys();
		let victim = null;
		for (const k of a.lru.keys()) {
			if (!protectedKeys.has(k)) { victim = k; break; }
		}
		if (victim === null) break;          // nothing evictable — keep what's shown
		const old = a.lru.get(victim);
		a.lru.delete(victim);
		_frameCache.delete(victim);
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
	// Anything queued for this size refers to the atlas we just dropped.
	const suffix = '@' + px;
	for (const k of [..._rasterPending.keys()]) if (k.endsWith(suffix)) _rasterPending.delete(k);
	// Any cell still pointing at this size must re-rasterise rather than blit
	// from a page that no longer has a backing store.
	for (const c of _cells.values()) if (slotPxFor(c.w) === px) c.lastFrame = -1;
	// Bakes already in flight cannot be cancelled — they are awaiting rlottie —
	// so mark their results stale instead.
	_epoch++;
}

/** Pixel sizes with at least one live cell — never reclaim these. */
function sizesInUse() {
	const live = new Set();
	for (const c of _cells.values()) live.add(slotPxFor(c.w));
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

/**
 * Bake emotes to DISK ahead of time, so opening a tab is a read rather than a
 * render.
 *
 * The distinction that matters: this never allocates an atlas slot. Warming
 * into the atlas is what made the picker a monotonic allocator in the first
 * place — hundreds of emotes' worth of pages held for a grid showing ninety of
 * them. Here each emote is rasterised, packed into a scratch sheet, handed to
 * frame-cache, and released. Steady-state memory is one scratch canvas.
 *
 * First run still pays to rasterise: something has to render 600-odd
 * animations once, and no amount of scheduling makes that free. What it buys
 * is that the cost is spent during idle time while the user reads the chat,
 * instead of at the moment they tap the emoji key — and that every session
 * afterwards skips it entirely.
 *
 * @param {string[]} urls
 * @param {number} px slot size to bake at — MUST match the cell size the
 *   picker registers, or loadFrames rejects on the sl check and it re-renders.
 * @param {{ signal?: { stop: boolean }, onProgress?: (done:number,total:number)=>void }} [opts]
 */
export async function prewarmToDisk(urls, px, opts = {}) {
	if (!frameCacheAvailable() || !Array.isArray(urls) || !px) return { baked: 0, skipped: 0 };
	// maxFps must match what the picker's cells pass, or the bake produces a
	// different frame count than the one asked for at read time.
	const { signal, onProgress, maxFps = 0 } = opts;
	let baked = 0, skipped = 0, i = 0;
	for (const url of urls) {
		if (signal?.stop) break;
		i++;
		const key = url + '@' + px;
		// Already on disk, or already live in memory — nothing to do.
		if (_frameCache.has(key)) { skipped++; continue; }
		try { if (await fcHas(diskKeyFor(key))) { skipped++; continue; } } catch { /* probe failed — just bake */ }
		try {
			const ok = await bakeToDisk(url, px, maxFps);
			if (ok) baked++; else skipped++;
		} catch { skipped++; }
		onProgress?.(i, urls.length);
		// Yield generously: this is background work and the chat owns the frame.
		await new Promise((r) => (typeof requestIdleCallback === 'function'
			? requestIdleCallback(() => r(), { timeout: 500 })
			: setTimeout(r, 16)));
	}
	return { baked, skipped };
}

/** Rasterise one emote and persist it, without touching the atlas. */
async function bakeToDisk(url, px, maxFps = 0) {
	const data = await fetchLottie(url);
	if (!data) return false;
	const srcPx = rasterSizeFor(px);
	let entry;
	try { entry = await acquire(url, data, srcPx, fpsCapFor(data, maxFps)); } catch { return false; }
	try {
		try { if (entry.pending) await entry.pending; } catch {}
		const frames = entry.frames || [];
		const N = Math.max(1, entry.totalFrames || frames.length || 1);
		if (N < 2 || !frames.length) return false;      // static — not worth storing
		const sl = slotPxFor(px);
		const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
		const rows = Math.ceil(N / cols);
		const rw = cols * sl, rh = rows * sl;
		const scr = scratchFor(rw, rh);
		scr.ctx.clearRect(0, 0, rw, rh);
		for (let i = 0; i < N; i++) {
			const bm = frames[i] || frames[0];
			if (!bm) continue;
			scr.ctx.drawImage(bm, 0, 0, bm.width, bm.height, (i % cols) * sl, ((i / cols) | 0) * sl, sl, sl);
		}
		const _b1 = performance.now();
		const sheetData = scr.ctx.getImageData(0, 0, rw, rh).data;
		_prof.readback += performance.now() - _b1; _prof.readbackN++;
		await fcStore(diskKeyFor(url + '@' + px), {
			sl, N, cols, sheetW: rw, sheetData,
			duration: entry.duration, totalFrames: entry.totalFrames
		});
		return true;
	} finally {
		release(url, srcPx);   // always hand the rlottie bitmaps back
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
// How many emotes may be rasterising at once.
//
// This used to be one — a single `await` in a loop — while rlottie runs a pool
// of ~10 workers and lottie-spritesheet already allows 4-8 concurrent jobs. So
// the atlas fed a ten-lane pool through a one-lane funnel, and a full grid
// filled in at whatever a single worker could manage.
//
// Measured on a throttled phone profile, 90 cells given a 3s window: 36, 47,
// 53, 55 built. Never memory — the budget sat at 9 of 12 pages with three to
// spare. It was still rasterising when time ran out, and the cells that had
// not got there yet were the ones sitting frozen on their thumbs.
//
// Capped rather than unbounded because each completion also does main-thread
// work (packing N frames into atlas slots); the pool's own limiter queues
// anything past its width, so more lanes than this buys nothing.
const RASTER_LANES = (() => {
	const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
	return Math.max(2, Math.min(4, Math.ceil(hw / 2)));
})();
let _rasterLanes = 0;

function pumpRaster() {
	while (_rasterLanes < RASTER_LANES && _rasterPending.size) {
		// Re-check visibility on every pick, not once per batch: a fling can
		// retire a whole screenful between one lane starting and the next.
		const vis = visibleKeys();
		for (const key of [..._rasterPending.keys()]) {
			if (!vis.has(key)) _rasterPending.delete(key);   // scrolled off → abandon
		}
		if (!_rasterPending.size) return;

		const [key, job] = _rasterPending.entries().next().value;
		_rasterPending.delete(key);
		_frameJobs.add(key);
		_rasterLanes++;
		// NOT wall time. Timing the whole doRasterize includes the await on the
		// rlottie worker, which is idle waiting — that is how this reported 222%
		// of wall time while the main thread showed zero long tasks. Count jobs
		// here; the main-thread cost is already captured by pack and readback.
		doRasterize(job.url, job.px, key, job.maxFps || 0)
			.then(() => { _prof.rasterN++; })
			.catch((e) => { console.warn('[cpu-atlas] rasterise failed', e); })
			.finally(() => {
				_frameJobs.delete(key);
				_rasterLanes--;
				pumpRaster();          // free lane — pull the next one in
			});
	}
}
// One encode in flight at a time. During a first-open storm the render loop is
// the priority; emotes that bake while an encode is busy simply skip
// persistence and get cached on a calmer later bake. Mirrors skottie-worker.
let _encodeBusy = false;
let _scratch = null;
function scratchFor(w, h) {
	if (!_scratch || _scratch.canvas.width < w || _scratch.canvas.height < h) {
		const canvas = makeCanvas(1);
		canvas.width = w; canvas.height = h;
		_scratch = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
	}
	return _scratch;
}

// Pack this animation's frames into slots and register the cache entry.
// Shared by the disk path and the rlottie path — everything after "we have N
// frames' worth of pixels" is identical between them.
function packIntoAtlas({ px, N, duration, draw }) {
	const _p0 = performance.now();
	const sl = slotPxFor(px);
	const atlas = getAtlas(sl);
	const slots = atlasAllocSlots(atlas, N);
	if (!slots) return null;               // atlas full — the thumb stays up
	for (let i = 0; i < N; i++) {
		const slot = slots[i];
		const ctx = atlas.pages[slot.page].ctx;
		ctx.clearRect(slot.x, slot.y, sl, sl);
		try { draw(ctx, i, slot, sl); } catch { /* one bad frame — leave it cleared */ }
	}
	// `sl` travels with the entry: it is the source rect renderCells blits FROM,
	// and it is no longer the same as the cell's size.
	_prof.pack += performance.now() - _p0; _prof.packN++;
	return { atlas, slots, N, duration, sl };
}

// Disk keys are namespaced per engine.
//
// frame-cache keys on `url@px` and versions the whole store, but does NOT
// separate engines — and the two engines store incompatible geometry under the
// same name: skottie-worker's slot is `px * supersample`, ours is exactly `px`.
// Sharing the key means each engine rejects the other's entry on the sl check,
// re-bakes, and overwrites it, so a user who ever switched engines would get a
// cache that permanently thrashes instead of one that hits.
// v2: the frame cap changed how many frames an entry holds, so v1 records
// would load at the old count and blow the slot budget they exist to protect.
const diskKeyFor = (key) => 'cpu3|' + key;

async function doRasterize(url, px, key, maxFps = 0) {
	if (_frameCache.has(key)) return;
	const startedAt = _epoch;

	// Disk first. This is the whole reason the cold open cost 1-2s a session:
	// skottie-worker was the only reader of frame-cache, so on the default
	// engine every emote was re-rasterised through rlottie from scratch, every
	// time, even though the frames had been baked before. Slot size IS the
	// stored slot size here, so a hit blits straight in with no rlottie at all.
	if (frameCacheAvailable()) {
		let disk = null;
		try { disk = await fcLoad(diskKeyFor(key), slotPxFor(px)); } catch { disk = null; }
		if (disk && disk.N >= 2 && _epoch === startedAt && !_frameCache.has(key)) {
			const dsl = slotPxFor(px);
			const img = typeof ImageData !== 'undefined' ? disk.frames.map((f) => {
				try { return new ImageData(f, dsl, dsl); } catch { return null; }
			}) : [];
			const entry = packIntoAtlas({
				px, N: disk.N, duration: disk.duration || 1,
				draw: (ctx, i, slot) => { const d = img[i]; if (d) ctx.putImageData(d, slot.x, slot.y); }
			});
			if (entry && _epoch === startedAt && _atlasByPx.get(dsl) === entry.atlas) {
				_frameCache.set(key, entry);
				entry.atlas.lru.set(key, entry);
				return;
			}
		}
	}

	const data = await fetchLottie(url);   // adaptive packs are tinted here
	if (!data) return;
	let entry;
	// Ask rlottie for frames at (or just above) this atlas's slot size instead
	// of the old fixed 48px — the atlas then DOWN-scales into the slot, so big
	// cells are crisp rather than upscaled. Same size on the release below, or
	// the refcount lands on a different cache entry and the frames leak.
	const srcPx = rasterSizeFor(px);
	try { entry = await acquire(url, data, srcPx, fpsCapFor(data, maxFps)); } catch { return; }
	// Wait for every frame to settle, then we own a full set to pack.
	try { if (entry.pending) await entry.pending; } catch {}
	// Did the user scroll past this while rlottie was working?
	//
	// rlottie runs in a worker, so the wait is cheap — but everything after it
	// is main-thread: packing N frames into atlas slots, and the disk cache's
	// synchronous getImageData. There was no check at all, so a fling would
	// start four lanes, scroll away, and still pay full price for all four.
	// The queue already drops work that has not STARTED; this drops work whose
	// cell left the screen while it was in flight.
	//
	// The slots are not allocated yet, so bailing here costs nothing but the
	// rasterising already done, and frees the lane for a cell you are looking at.
	{
		let stillWanted = false;
		for (const c of _cells.values()) {
			if (c.visible && c.url === url && slotPxFor(c.w) === slotPxFor(px)) { stillWanted = true; break; }
		}
		if (!stillWanted) { release(url, srcPx); return; }
	}

	const frames = entry.frames || [];
	const N = Math.max(1, entry.totalFrames || frames.length || 1);
	const sl = slotPxFor(px);
	const atlas = getAtlas(sl);
	const slots = atlasAllocSlots(atlas, N);
	if (!slots) { release(url, srcPx); return; } // atlas full — thumb stays up
	for (let i = 0; i < N; i++) {
		const bm = frames[i] || frames[0];
		const slot = slots[i];
		const ctx = atlas.pages[slot.page].ctx;
		ctx.clearRect(slot.x, slot.y, sl, sl);
		if (bm) {
			try { ctx.drawImage(bm, 0, 0, bm.width, bm.height, slot.x, slot.y, sl, sl); } catch {}
		}
	}
	// Persist BEFORE releasing the rlottie bitmaps — they are the pixels we
	// need to capture, and `release` frees them.
	// Persist only when there is nothing waiting to be rasterised, and only in
	// idle time. This readback is a synchronous getImageData on the main thread
	// and measured at 14% of wall time during a scroll — pure cache-population
	// competing with the frames the user is looking at. Nothing needs it now;
	// it only has to happen before the NEXT session.
	const _quiet = _rasterPending.size === 0 && _rasterLanes <= 1;
	if (frameCacheAvailable() && N >= 2 && !_encodeBusy && _quiet) {
		try {
			// Pack the frames into a scratch grid at SLOT size (not source
			// size): that is the geometry the atlas blits at, so a later
			// loadFrames can putImageData straight into a slot with no scaling.
			const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
			const rows = Math.ceil(N / cols);
			const rw = cols * sl, rh = rows * sl;
			const scr = scratchFor(rw, rh);
			scr.ctx.clearRect(0, 0, rw, rh);
			for (let i = 0; i < N; i++) {
				const bm = frames[i] || frames[0];
				if (!bm) continue;
				scr.ctx.drawImage(bm, 0, 0, bm.width, bm.height, (i % cols) * sl, ((i / cols) | 0) * sl, sl, sl);
			}
			const _b0 = performance.now();
			const sheetData = scr.ctx.getImageData(0, 0, rw, rh).data;   // one readback
			_prof.readback += performance.now() - _b0; _prof.readbackN++;
			_encodeBusy = true;
			fcStore(diskKeyFor(key), {
				sl, N, cols, sheetW: rw, sheetData,
				duration: entry.duration, totalFrames: entry.totalFrames
			}).finally(() => { _encodeBusy = false; });
		} catch { _encodeBusy = false; /* readback failed — skip persisting */ }
	}

	release(url, srcPx); // pixels are copied into the atlas — free the rlottie bitmaps
	// A reclaim landed while rlottie was working: `atlas` was detached from
	// _atlasByPx and its pages emptied, so caching this would hand renderCells
	// slots into a page array of length zero.
	if (_epoch !== startedAt || _atlasByPx.get(sl) !== atlas) return;
	const cacheEntry = { atlas, slots, N, duration: entry.duration || 1, sl };
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
		// The rAF chain must outlive any single bad frame. renderCells throwing
		// used to take the whole loop with it — the re-arm below never ran, so
		// one TypeError from one cell silently stopped every animation on the
		// page until reload. Nothing renderCells can do is worth that.
		const _r0 = performance.now();
		try { renderCells(now); } catch (e) { console.warn('[cpu-atlas] render frame failed', e); }
		_prof.render += performance.now() - _r0; _prof.renderN++;
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
		// A cache entry can outlive its atlas' pages by a frame or two, so this
		// lookup is genuinely allowed to come back empty — it must not throw.
		const pageEntry = slot && cache.atlas.pages[slot.page];
		if (!pageEntry) { _frameCache.delete(ckey); cache.atlas.lru.delete(ckey); cell.lastFrame = -1; continue; }
		const page = pageEntry.canvas;
		try {
			// dx/dy are 0 for a cell that owns its canvas, and this is the
			// cell's slot within a shared one otherwise.
			// Source rect is the SLOT (which may be smaller than the cell —
			// see SLOT_PX_MAX); destination is the cell. The browser scales the
			// difference, which is the 1.5x-instead-of-2x trade.
			const sl = cache.sl || cell.w;
			cell.ctx.clearRect(cell.dx, cell.dy, cell.w, cell.h);
			cell.ctx.drawImage(page, slot.x, slot.y, sl, sl, cell.dx, cell.dy, cell.w, cell.h);
		} catch { continue; }
		cell.lastFrame = fi;
		if (!cell.firstPainted) { cell.firstPainted = true; if (cell.onFirstPaint) firstPaints.push(cell); }
	}
	for (const cell of firstPaints) { try { cell.onFirstPaint(); } catch {} }
}

// ── Public API (matches the worker canvas-cell module) ──────────────────
// `canvas` is the live DOM <canvas> element (NOT transferControlToOffscreen).
/**
 * Register a cell.
 *
 * `canvas` may be the cell's own element (one canvas per cell, the original
 * model) OR a canvas shared with other cells — a row's canvas, say — in which
 * case `dx`/`dy` say where in it this cell draws. Everything else is identical:
 * a cell still owns its animation, its clock and its frame index.
 *
 * Sharing exists because canvas COUNT, not blit count, is what costs. Measured
 * on a throttled phone profile, 90 cells at dpr 2 blitting identical pixels
 * from an identical source:
 *
 *     90 canvases   83 fps   p95 17.2ms   worst 34ms
 *     10 row cvs   120 fps   p95  9.2ms   worst 17ms
 *     1 canvas     120 fps   p95  9.3ms   worst 15ms
 *
 * Same number of drawImage calls in all three — the difference is 90 composited
 * layers versus 10. At 120Hz the budget is 8.3ms, so the per-cell model misses
 * the deadline on most frames while either shared model comfortably makes it.
 * Ten row canvases are worth as much as one big one, which matters because a
 * single grid-wide canvas was already tried and abandoned: the continuous
 * scroller is ~8000px tall, and sizing a backbuffer to that caused GPU-tile
 * flicker while pinning it to the viewport made it scroll away. Row canvases
 * flow in the DOM and scroll natively, so none of that applies.
 */
export function registerCanvasCell({ url, canvas, w, h, dx = 0, dy = 0, paused = false, loop = true, paintIndex = null, visible = false, maxFps = 0, onFirstPaint = null }) {
	let ctx = null;
	try { ctx = canvas.getContext('2d'); } catch { /* element gone */ }
	const id = _nextId++;
	_cells.set(id, {
		ctx, url, w, h, dx, dy, paused, loop, paintIndex, visible, maxFps,
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
	const cell = _cells.get(id);
	// On a SHARED canvas the pixels outlive the cell: the element belongs to the
	// row, not to us, so nothing removes them. Wipe our own slot on the way out
	// or the last frame stays painted under whatever mounts there next. (A cell
	// that owns its canvas doesn't care — the element goes with it — but the
	// clear is harmless there.)
	if (cell?.ctx && (cell.dx || cell.dy)) {
		try { cell.ctx.clearRect(cell.dx, cell.dy, cell.w, cell.h); } catch { /* gone */ }
	}
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
