// Skottie render worker — runs CanvasKit/Skia in its own thread on an
// OffscreenCanvas transferred from the main thread. Mirrors the logic
// from skottie-stage.js but consumes per-frame rect snapshots posted by
// the main-thread proxy (`skottie-stage-worker.js`) instead of reading
// the DOM directly.
//
// Why: the main-thread Skottie path does ~30 ms of Skia work per frame
// during heavy scroll + animation building takes 30–60 ms per emoji.
// Moving both off-thread keeps the main thread free for input/scroll/
// layout, so the picker grid feels effectively jank-free even while
// hundreds of cells are alive. When CanvasKit ships a stable WebGPU
// surface, swapping it in is a one-line change here.
//
// Message protocol (main → worker):
//   { type:'init',           canvas: OffscreenCanvas }
//   { type:'resize',         width, height }
//   { type:'register-cell',  id, url, paused, paintIndex, loop, thumbInfo }
//   { type:'unregister-cell', id }
//   { type:'set-visible',    id, visible }
//   { type:'load-anim',      url }
//   { type:'release-anim',   url }
//   { type:'render',         now, viewRect, canvasRect, cellRects, dpr }
//
// Worker → main:
//   { type:'ready' }
//   { type:'init-failed', error }
//   { type:'first-paints', ids }     // cells that hit firstPainted this frame
//   { type:'surface-recreated' }      // main thread should reset its firstPainted mirrors
//   { type:'anim-loaded',  url }      // pending build finished — main thread can stop trying to cancel

import CanvasKitInit from 'canvaskit-wasm/full';
import { tintLottieAdaptive } from './lottie-adaptive.js';
import { loadFrames as fcLoad, storeFrames as fcStore, hasFrames as fcHas, frameCacheAvailable } from './frame-cache.js';

let _kit = null;
let _canvas = null; // OffscreenCanvas
let _surface = null;
// Desktop flag from init: shorten the first-build placeholder hold (see
// the handoffAt sites) — set by the main thread on fine-pointer devices.
let _fastHandoff = false;

// WebGL surface options. `preserveDrawingBuffer: 1` keeps the backbuffer
// alive between compositor frames — without it, WebGL clears after
// every composite, leaving the canvas momentarily blank between worker
// draws. That gap is invisible while a CSS sprite is layered behind
// (sprite plugs the hole), but the moment we hide the sprite the bare
// WebGL surface flashes through. Enabling preserve costs a bit of GPU
// memory (the framebuffer can't be discarded) but eliminates the
// flicker entirely. Other defaults left untouched.
const _surfaceOpts = { preserveDrawingBuffer: 1 };
const _anims = new Map();   // url -> { animation, refcount, duration, fps, totalFrames }
const _pending = new Map(); // url -> { dataPromise, refcount }
const _cells = new Map();   // id  -> per-cell state (LEGACY overlay path)
let _sheetImage = null;
let _imagePaint = null;

// ── Inline-canvas path (no overlay; canvases flow with the DOM) ──────────
// Each cell transfers its own inline <canvas> to us as an OffscreenCanvas
// (a `bitmaprenderer` context). Per animation frame we render the cell's
// current frame into a small per-size WebGL scratch surface, then hand the
// result to the cell with transferToImageBitmap() → transferFromImageBitmap().
// That handoff is a ZERO-COPY GPU operation — no glReadPixels, no
// drawImage-from-WebGL readback, no CPU round-trip. Readback was the source
// of both the framerate hit and the transition flicker (a partial/raced
// read shows a torn or blank frame). Because each cell owns its own DOM
// canvas, the browser scrolls them natively (no position math, no overlay)
// and there's no cross-cell coherence requirement — so cells can be spread
// across multiple worker shards for parallel building. Before an animation
// is built the SpriteSticker's CSS thumb covers the cell, so we only ever
// deal with built animations here.
const _canvasCells = new Map(); // id -> { ctx, off, url, paused, loop, paintIndex, w, h, visible, startTime, paintCount, firstPainted }
// One reusable WebGL scratch surface per pixel size (cells are square and
// nearly all the same size, so this is usually a single entry). The scratch
// MUST match the cell's pixel size exactly: transferToImageBitmap() grabs
// the WHOLE scratch canvas, so any size mismatch would mis-scale the cell.
const _scratchByPx = new Map(); // px -> { canvas, surface }
function ensureScratchForPx(px) {
	let s = _scratchByPx.get(px);
	if (s) return s;
	if (!_kit) return null;
	const canvas = new OffscreenCanvas(px, px);
	const surface = _kit.MakeWebGLCanvasSurface(canvas, undefined, _surfaceOpts);
	if (!surface) { diag('warn', '[skottie-worker] scratch surface failed for px', px); return null; }
	s = { canvas, surface };
	_scratchByPx.set(px, s);
	return s;
}

// ── Rasterized playback ("webgpu-rasterized" engine) ─────────────────────
// Render each animation's frames to ImageBitmaps ONCE (Skottie on the GPU),
// cache them keyed by url@px, then play back by blitting the cached frame
// into the cell's 2D canvas — drawImage(ImageBitmap) is a cheap GPU op with
// NO per-frame Skottie render and NO per-frame GPU flush. This is what makes
// many animated cells cheap: the expensive work happens once per unique
// emoji, amortised + idle-yielded, instead of every cell every frame. The
// live path (default worker engine) re-renders every frame; this trades a
// one-time rasterise + a bit of memory for near-free steady-state playback.
// SHARED ATLAS. Every animation's frames are packed into a few large 2D
// atlas pages (one set per cell pixel size), indexed per (url, frame) by an
// atlas slot. Playback blits the slot's sub-rect. This keeps the GPU texture
// count tiny — a handful of atlas pages total instead of one texture per
// emoji (let alone one per frame, which exhausted the GPU and lost the
// WebGL context). When the atlas is full, the least-recently-shown emoji's
// slots are reclaimed (LRU); cells touch their entry every frame so anything
// on screen is never the eviction victim.
//   _frameCache:  url@px -> { atlas, slots: [{page,x,y}], N }
const _frameCache = new Map();
const _frameJobs = new Set();         // url@px currently rasterising
const _rasterSheetByPx = new Map();   // px -> { canvas, surface } — WebGL scratch to render frames before packing
// SEPARATE sheet pool for the background pre-warm. The pre-warm bake loop yields
// mid-render and is NOT gated by _rasterBusy, so it must never touch the live
// sheet — otherwise a live bake interleaving on the same surface corrupts both
// (frames from one emote bleed into another's cache). Pre-warm is sequential
// per worker, so one sheet per px here is safe on its own.
const _prewarmSheetByPx = new Map();
const _atlasByPx = new Map();         // px -> { px, cols, pages:[{canvas,ctx}], free:[{page,x,y}], lru:Map<key,entry> }
// Device-adaptive raster config. Low-RAM devices (phones report
// navigator.deviceMemory ≤ 4 GB; absent ⇒ assume a roomy desktop) get a
// much smaller, cheaper atlas: native resolution (no supersample), fewer
// frames, and a tiny 1024² atlas so total GPU memory stays in single-digit
// MB. Desktops get the sharp 2× supersample + bigger cache.
const _deviceMem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
const _isMobileUA = typeof navigator !== 'undefined'
	&& /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
// Any mobile UA (even an 8 GB flagship, which reports deviceMemory: 8) OR a
// genuinely low-RAM machine gets the small atlas. Mobile GPUs are the
// constraint, not just RAM, so the UA check matters.
const _lowMem = _isMobileUA || _deviceMem <= 4;

// SUPERSAMPLE: render each frame at this multiple of the cell's device px,
// then downscale on blit → crisper edges than native 1:1. Most expensive
// knob — cost scales with SUPERSAMPLE² (and so does first-bake render time).
// Desktop/high-mem uses 1.5: past that the anti-aliasing gain is invisible at
// emote sizes, but the render cost keeps climbing. The crisp look comes from
// the 2× DISPLAY density (oversample) on sent emotes, not from supersampling.
// Mobile/low-mem renders 1:1 (native) to keep atlases tiny.
const SUPERSAMPLE = _lowMem ? 1 : 1.5;
// Frame cap. Frames are sampled across the whole loop, so true 60fps needs
// duration*60 frames; 120 gives a full 60fps for loops up to 2s. Mobile
// targets ~40fps to keep its atlas small.
const MAX_RASTER_FRAMES = _lowMem ? 40 : 120;
const RASTER_COLS = 11;               // 11×11 grid holds up to 121 frames
// Atlas page size + count. Mobile: 1024² × 6 pages ≈ 24 MB (≥ the picker's
// ~24 visible cap at any dpr). Desktop/high-mem: 2048² × 16 ≈ 256 MB — enough
// for the visible set at 1.5× supersample + 2× oversample slots (duplicate
// emotes share one url@px entry, so this covers far more than 16 instances).
const ATLAS_DIM = _lowMem ? 1024 : 2048;
const MAX_ATLAS_PAGES = _lowMem ? 6 : 16;

// `slot` = rendered/stored pixel size = px * SUPERSAMPLE (the cell displays
// at px, so this is supersampled and downscaled on blit).
function ensureRasterSheetForPx(px) { return _ensureSheet(px, _rasterSheetByPx); }
// Dedicated pre-warm sheet — never the live one (see _prewarmSheetByPx comment).
function ensurePrewarmSheetForPx(px) { return _ensureSheet(px, _prewarmSheetByPx); }
function _ensureSheet(px, pool) {
	let s = pool.get(px);
	if (s) return s;
	if (!_kit) return null;
	const slot = Math.round(px * SUPERSAMPLE);
	const canvas = new OffscreenCanvas(RASTER_COLS * slot, RASTER_COLS * slot);
	const surface = _kit.MakeWebGLCanvasSurface(canvas, undefined, _surfaceOpts);
	if (!surface) return null;
	s = { canvas, surface, slot };
	pool.set(px, s);
	return s;
}

function getAtlas(px) {
	let a = _atlasByPx.get(px);
	if (a) return a;
	const slot = Math.round(px * SUPERSAMPLE);
	a = { px, slot, cols: Math.floor(ATLAS_DIM / slot), pages: [], free: [], lru: new Map() };
	_atlasByPx.set(px, a);
	addAtlasPage(a);
	return a;
}
// MAX_ATLAS_PAGES caps ONE atlas. There is an atlas per pixel size, and a
// session accumulates several — the picker cells (24), the pack tabs (22),
// avatars (64), each multiplied by devicePixelRatio, plus a second high-density
// size per component that oversamples. At 4MB a page on mobile, six pages
// apiece, half a dozen sizes is ~150MB of canvas that nothing ever gave back:
// atlases, like the GL surfaces below, were allocated on first use and held for
// the life of the worker. On an iOS WebView that is what the OS kills you for.
// So the real ceiling is a budget over ALL sizes, and idle sizes hand pages
// back (see reclaimIdleSizes).
// Pages are ATLAS_DIM² RGBA: 4MB on mobile, 16.7MB on desktop. 10 mobile
// pages is a 40MB ceiling; 16 desktop pages is ~268MB, which is exactly what
// MAX_ATLAS_PAGES already allowed a SINGLE size to reach — the difference is
// that it is now the total across every size rather than a per-size limit, so
// one live size behaves identically to before and only the accumulation is
// capped.
const MAX_TOTAL_PAGES = _lowMem ? 10 : 16;
let _totalPages = 0;

function addAtlasPage(a) {
	if (a.pages.length >= MAX_ATLAS_PAGES) return false;
	if (_totalPages >= MAX_TOTAL_PAGES) {
		// Exclude the atlas we're growing. A size counts as idle until one of
		// its cells has registered, and frames can be baked in that window
		// (prewarm, or a size whose cells just re-mounted), so without this the
		// reclaim could free `a` out from under us — leaving pages pushed into
		// a detached atlas and _totalPages permanently overcounted.
		if (!reclaimIdleSizes(a.px)) return false;
		if (_totalPages >= MAX_TOTAL_PAGES) return false;
	}
	const canvas = new OffscreenCanvas(ATLAS_DIM, ATLAS_DIM);
	const ctx = canvas.getContext('2d');
	const page = a.pages.length;
	a.pages.push({ canvas, ctx });
	_totalPages++;
	for (let r = 0; r < a.cols; r++)
		for (let c = 0; c < a.cols; c++)
			a.free.push({ page, x: c * a.slot, y: r * a.slot });
	return true;
}

// Which pixel sizes currently have a cell on screen. Recomputed on demand
// rather than tracked incrementally so it can't drift out of sync with the
// cell maps, which several paths mutate.
function liveSizes() {
	// `w` IS the pixel-size key — it's what keys the frame cache and the disk
	// probe (`url + '@' + msg.w`). Legacy `_cells` are deliberately not counted:
	// they render through the shared overlay surface and own no per-size atlas.
	const live = new Set();
	for (const c of _canvasCells.values()) if (c.w) live.add(c.w);
	return live;
}

// Drop everything belonging to a pixel size: atlas pages, the frame-cache
// entries pointing into them, and the three GL scratch surfaces. The DISK
// cache is untouched, so a size that comes back rehydrates from it instead of
// re-rendering from the Lottie source — the same trade Telegram makes, where
// RAM holds the visible set and disk holds everything ever rasterised.
function freeSize(px) {
	const a = _atlasByPx.get(px);
	if (a) {
		for (const [key, cache] of _frameCache) {
			if (cache.atlas !== a) continue;
			_frameCache.delete(key);
		}
		_totalPages -= a.pages.length;
		if (_totalPages < 0) _totalPages = 0;
		a.pages.length = 0;
		a.free.length = 0;
		a.lru.clear();
		_atlasByPx.delete(px);
	}
	for (const pool of [_scratchByPx, _rasterSheetByPx, _prewarmSheetByPx]) {
		const e = pool.get(px);
		if (!e) continue;
		try { e.surface?.delete(); } catch {}
		pool.delete(px);
	}
	// Abandon queued/in-flight bakes for this size. A job that completed after
	// the free would hold a reference to the detached atlas and write frames
	// into a canvas nothing draws from — the cell would sit blank forever
	// rather than re-bake.
	for (const [key, job] of _rasterPending) {
		if (job.px === px) _rasterPending.delete(key);
	}
	for (const key of [..._frameJobs]) {
		if (key.endsWith('@' + px)) _frameJobs.delete(key);
	}
}

// Reclaim every size with nothing on screen. Returns whether anything was
// freed, so allocation can retry rather than fail.
function reclaimIdleSizes(keepPx) {
	const live = liveSizes();
	let freed = false;
	for (const px of [..._atlasByPx.keys()]) {
		if (px === keepPx || live.has(px)) continue;
		freeSize(px);
		freed = true;
	}
	return freed;
}
// Reserve n free slots, growing the atlas or evicting the LRU emoji as needed.
function atlasAllocSlots(a, n) {
	while (a.free.length < n) {
		if (addAtlasPage(a)) continue;
		const oldest = a.lru.keys().next();
		if (oldest.done) break; // nothing left to evict
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

// Pending rasterisation requests, drained by pumpRaster() VISIBLE-FIRST.
// FIFO is wrong here: fast-scrolling to the bottom queues every emoji you
// flew past ahead of the ones now on screen, so they'd bake first and the
// visible row would sit on placeholders. Instead we (1) only ever pick a job
// whose cells are currently on screen, and (2) drop jobs whose cells have
// all scrolled off (they re-queue instantly if scrolled back). Net effect:
// whatever is on screen bakes first; off-screen work is abandoned.
const _rasterPending = new Map(); // key -> { url, px }
let _rasterBusy = false;
// Monotonic "scrolled-in" sequence — a cell's visibleAt is stamped each time it
// enters the viewport, so the rasteriser can bake whatever the user scrolled to
// MOST RECENTLY first (freshest-visible-first), not just any visible cell.
let _visSeq = 0;

function scheduleRasterize(url, px, fpsScale = 1) {
	const key = url + '@' + px;
	if (_frameCache.has(key) || _frameJobs.has(key) || _rasterPending.has(key)) return;
	_rasterPending.set(key, { url, px, fpsScale });
	pumpRaster();
}

// url@px keys with an on-screen cell right now → the freshest visibleAt among
// those cells. A cell's visibleAt is bumped every time it scrolls INTO view, so
// the highest number is whatever the user looked at most recently.
function _visibleRasterKeys() {
	const map = new Map();
	for (const cell of _canvasCells.values()) {
		if (cell.visible && cell.rasterized) {
			const k = cell.url + '@' + cell.w;
			const at = cell.visibleAt || 0;
			const prev = map.get(k);
			if (prev === undefined || at > prev) map.set(k, at);
		}
	}
	return map;
}

async function pumpRaster() {
	if (_rasterBusy) return;
	_rasterBusy = true;
	try {
		while (_rasterPending.size) {
			const vis = _visibleRasterKeys();
			// Abandon anything no longer on screen — deprioritise-to-drop: an
			// emote that scrolled away never gets baked, freeing the pipeline
			// for what's actually in view.
			for (const key of [..._rasterPending.keys()]) {
				if (!vis.has(key)) _rasterPending.delete(key);
			}
			if (!_rasterPending.size) break;
			// Of the remaining (all visible) jobs, bake the one the user
			// scrolled to MOST RECENTLY first — 100% recency priority.
			let key = null, bestAt = -1;
			for (const k of _rasterPending.keys()) {
				const at = vis.get(k) ?? 0;
				if (at > bestAt) { bestAt = at; key = k; }
			}
			const job = _rasterPending.get(key);
			_rasterPending.delete(key);
			_frameJobs.add(key);
			try { await doRasterize(job.url, job.px, key, job.fpsScale || 1); }
			catch (e) {
				_frameJobs.delete(key);
				diag('warn', '[skottie-worker] rasterize failed', key, String(e?.message || e));
			}
		}
	} finally {
		_rasterBusy = false;
	}
}

// Fill the atlas for url@px straight from the persistent disk cache — NO Lottie
// fetch, NO parse, NO Skia render. On a hit we also drop in a minimal,
// animation-less `_anims` entry so renderCanvasCells can time the loop and blit
// atlas frames with nothing behind it. This is the whole Telegram trick: after
// the first bake, an emote is pure cached frames on every subsequent open.
// Returns true on a hit (atlas now filled), false on a miss.
async function diskHydrate(url, px) {
	if (!frameCacheAvailable()) return false;
	const key = url + '@' + px;
	if (_frameCache.has(key)) return true;
	const atlas = getAtlas(px);
	if (!atlas) return false;
	const sl = atlas.slot;
	let disk = null;
	try { disk = await fcLoad(key, sl); } catch { disk = null; }
	if (!disk) return false;
	if (_frameCache.has(key)) return true; // another path won the race
	const slots = atlasAllocSlots(atlas, disk.N);
	if (!slots) return false;
	for (let i = 0; i < disk.N; i++) {
		const slot = slots[i];
		// putImageData writes the exact RGBA at the slot origin (no blend) —
		// same pixels the render→drawImage path would leave.
		try { atlas.pages[slot.page].ctx.putImageData(new ImageData(disk.frames[i], sl, sl), slot.x, slot.y); }
		catch { /* detached page — skip */ }
	}
	_frameCache.set(key, { atlas, slots, N: disk.N });
	atlas.lru.set(key, _frameCache.get(key));
	if (!_anims.has(url)) {
		const dur = disk.duration || 1;
		_anims.set(url, {
			animation: null, refcount: 0, duration: dur,
			fps: disk.totalFrames / Math.max(dur, 0.0001),
			totalFrames: disk.totalFrames, diskOnly: true, startTime: null
		});
		self.postMessage({ type: 'anim-loaded', url });
	}
	return true;
}

// De-dupe concurrent probes for the same URL so register-canvas-cell and
// load-anim (which arrive back-to-back) share one disk lookup.
const _diskProbes = new Map(); // url -> Promise<boolean>
function probeDisk(url, px) {
	let p = _diskProbes.get(url);
	if (p) return p;
	p = diskHydrate(url, px).catch(() => false);
	_diskProbes.set(url, p);
	p.finally(() => { if (_diskProbes.get(url) === p) _diskProbes.delete(url); });
	return p;
}

// A diskOnly entry can render its CACHED px but not a fresh one (no parsed
// Lottie). If some cell needs a px we never baked, pull the real Lottie in the
// background; a later tick re-rasterises once it's built.
function requestAnimUpgrade(url, entry) {
	if (!entry || entry._upgrading || _pending.get(url) || _anims.get(url)?.animation) return;
	entry._upgrading = true;
	_pending.set(url, { dataPromise: fetchLottieWorker(url), refcount: Math.max(1, entry.refcount || 1) });
	schedulePump();
}

// Bake an emote's frames straight to the disk cache WITHOUT touching the live
// atlas or the shared _anims map — for the background pre-warm. Builds a
// throwaway animation, renders to the raster sheet, encodes to disk, then frees
// everything. Returns a short status for progress reporting.
async function prewarmBake(url, px, fpsScale = 1) {
	if (!frameCacheAvailable()) return 'unavailable';
	if (await fcHas(url + '@' + px)) return 'cached';
	if (!_kit) return 'skip';
	// Compute the slot size directly — a disk-only bake never allocates atlas
	// slots, so don't spin up an atlas page (16 MB) just to read `.slot`.
	const sl = Math.round(px * SUPERSAMPLE);
	let data = null;
	try { data = await fetchLottieWorker(url); } catch { return 'err'; }
	if (!data) return 'err';
	const short = shortFromUrl(url);
	if (short && _adaptive.has(short) && _adaptiveInk) { try { tintLottieAdaptive(data, _adaptiveInk); } catch {} }
	let animation = null;
	try {
		animation = _kit.MakeManagedAnimation ? _kit.MakeManagedAnimation(JSON.stringify(data)) : _kit.MakeAnimation(JSON.stringify(data));
	} catch { return 'err'; }
	if (!animation) return 'err';
	try {
		const duration = animation.duration() || 1;
		const fps = animation.fps() || 60;
		const totalFrames = Math.max(1, Math.round(duration * fps));
		const _frameCap = Math.min(Math.round(MAX_RASTER_FRAMES * fpsScale), RASTER_COLS * RASTER_COLS);
		const N = Math.min(totalFrames, _frameCap);
		if (N < 2) return 'static'; // nothing worth caching
		// Dedicated pre-warm sheet — never the live one, so a live bake yielding
		// mid-render can't interleave and corrupt this emote's frames.
		const sheet = ensurePrewarmSheetForPx(px);
		if (!sheet) return 'skip';
		const sk = sheet.surface.getCanvas();
		sk.clear(_kit.TRANSPARENT);
		for (let i = 0; i < N; i++) {
			const cx = (i % RASTER_COLS) * sl;
			const cy = ((i / RASTER_COLS) | 0) * sl;
			animation.seek(i / N);
			animation.render(sk, _kit.LTRBRect(cx, cy, cx + sl, cy + sl));
			if ((i & 7) === 7) { sheet.surface.flush(); await _yieldIdle(); }
		}
		sheet.surface.flush();
		const usedRows = Math.ceil(N / RASTER_COLS);
		const rw = RASTER_COLS * sl, rh = usedRows * sl;
		const bmp = await createImageBitmap(sheet.canvas, 0, 0, rw, rh);
		const scr = _encodeScratchFor(rw, rh);
		scr.ctx.clearRect(0, 0, rw, rh);
		scr.ctx.drawImage(bmp, 0, 0);
		const sheetData = scr.ctx.getImageData(0, 0, rw, rh).data;
		try { bmp.close(); } catch {}
		// Await the encode so pre-warm bakes one emote at a time — bounds memory
		// (one sheet held) and keeps it gentle in the background.
		await fcStore(url + '@' + px, { sl, N, cols: RASTER_COLS, sheetW: rw, sheetData, duration, totalFrames });
		return 'warmed';
	} catch { return 'err'; }
	finally { try { animation.delete(); } catch {} }
}

async function doRasterize(url, px, key, fpsScale = 1) {
	// ── Fast path: rehydrate from the persistent disk cache (no Lottie) ──
	if (await diskHydrate(url, px)) { _frameJobs.delete(key); return; }

	// ── Slow path: render the vector frames with Skia ───────────────────
	const entry = _anims.get(url);
	if (!entry || entry.duration <= 0) { _frameJobs.delete(key); return; }
	if (!entry.animation) {
		// diskOnly entry, but THIS px isn't on disk → we need the real Lottie.
		requestAnimUpgrade(url, entry);
		_frameJobs.delete(key);
		return;
	}
	const atlas = getAtlas(px);
	if (!atlas) { _frameJobs.delete(key); return; }
	const sl = atlas.slot; // supersampled pixel size (px * SUPERSAMPLE)
	const sheet = ensureRasterSheetForPx(px);
	if (!sheet) { _frameJobs.delete(key); return; }
	// fpsScale (1.5 on the high-end LOD upgrade) bakes more frames = smoother
	// loop. Capped to the raster sheet's grid (RASTER_COLS² slots) so it can
	// never overflow — on desktop MAX_RASTER_FRAMES is already near the cap, so
	// the bump mainly benefits fast phones (e.g. 40 → 60 frames).
	const _frameCap = Math.min(Math.round(MAX_RASTER_FRAMES * fpsScale), RASTER_COLS * RASTER_COLS);
	const N = Math.min(entry.totalFrames, _frameCap);
	const slots = atlasAllocSlots(atlas, N);
	if (!slots) { _frameJobs.delete(key); return; } // atlas full — thumb stays up

	const sk = sheet.surface.getCanvas();
	sk.clear(_kit.TRANSPARENT);
	const _releasedCleanup = () => {
		for (const s of slots) atlas.free.push(s);
		if (_frameCache.get(key)?.slots === slots) { _frameCache.delete(key); atlas.lru.delete(key); }
		_frameJobs.delete(key);
	};

	// ── Frame 0 FIRST — render + blit + publish so the cell paints instantly ──
	// This is the Telegram trick: first appearance costs ONE frame render, not
	// the whole loop. `ready` tracks how many frames are live in the atlas;
	// playback clamps to it, so the emote shows frame 0 immediately and the loop
	// fills in over the next few milliseconds as the rest bake in the background.
	entry.animation.seek(0);
	entry.animation.render(sk, _kit.LTRBRect(0, 0, sl, sl));
	sheet.surface.flush();
	{
		const bmp0 = await createImageBitmap(sheet.canvas, 0, 0, sl, sl);
		const s0 = slots[0], p0 = atlas.pages[s0.page].ctx;
		p0.clearRect(s0.x, s0.y, sl, sl);
		p0.drawImage(bmp0, 0, 0, sl, sl, s0.x, s0.y, sl, sl);
		try { bmp0.close(); } catch {}
	}
	const cacheEntry = { atlas, slots, N, ready: 1 };
	_frameCache.set(key, cacheEntry);
	atlas.lru.set(key, cacheEntry);
	if (N === 1) { _frameJobs.delete(key); return; } // static — nothing more to bake
	await _yieldIdle(); // hand the thread back so the cell paints frame 0 now
	if (_anims.get(url) !== entry) { _releasedCleanup(); return; }

	// ── Remaining frames — bake in the background, growing `ready` ──
	for (let i = 1; i < N; i++) {
		if (_anims.get(url) !== entry) { _releasedCleanup(); return; }
		const cx = (i % RASTER_COLS) * sl;
		const cy = ((i / RASTER_COLS) | 0) * sl;
		entry.animation.seek(i / N);
		entry.animation.render(sk, _kit.LTRBRect(cx, cy, cx + sl, cy + sl));
		if ((i & 7) === 7) { sheet.surface.flush(); await _yieldIdle(); }
	}
	sheet.surface.flush();
	const usedRows = Math.ceil(N / RASTER_COLS);
	const bmp = await createImageBitmap(sheet.canvas, 0, 0, RASTER_COLS * sl, usedRows * sl);
	// Frame 0 is already in the atlas; blit frames 1..N-1.
	for (let i = 1; i < N; i++) {
		const scx = (i % RASTER_COLS) * sl;
		const scy = ((i / RASTER_COLS) | 0) * sl;
		const slot = slots[i];
		const pctx = atlas.pages[slot.page].ctx;
		pctx.clearRect(slot.x, slot.y, sl, sl);
		pctx.drawImage(bmp, scx, scy, sl, sl, slot.x, slot.y, sl, sl);
	}
	cacheEntry.ready = N; // full loop now live
	// Keep `bmp` alive for the disk-cache readback below (bmp2 = same bitmap);
	// it's closed there once captured (or immediately if we're not caching).
	const bmp2 = bmp;
	_frameJobs.delete(key);

	// Persist to disk for next time. ONE cheap readback of the whole packed
	// sheet (not N per-slot getImageData — that stalled the render loop); the
	// XOR-delta + gzip + slicing then all happen asynchronously in frame-cache,
	// off the critical path. Playback is already running off the atlas, so this
	// blocks nothing visible.
	//
	// At most ONE encode is in flight per worker: during a first-open storm the
	// render loop is the priority, so emotes that bake while an encode is busy
	// simply skip persistence (they get cached on a calmer later bake). This
	// bounds held memory to a single captured sheet and keeps the storm's
	// readbacks sparse.
	if (frameCacheAvailable() && N >= 2 && !_encodeBusy) {
		try {
			const rw = RASTER_COLS * sl, rh = usedRows * sl;
			const scr = _encodeScratchFor(rw, rh);
			scr.ctx.clearRect(0, 0, rw, rh);
			scr.ctx.drawImage(bmp2, 0, 0);
			const sheetData = scr.ctx.getImageData(0, 0, rw, rh).data; // single readback
			_encodeBusy = true;
			fcStore(url + '@' + px, {
				sl, N, cols: RASTER_COLS, sheetW: rw, sheetData,
				duration: entry.duration, totalFrames: entry.totalFrames
			}).finally(() => { _encodeBusy = false; });
		} catch { _encodeBusy = false; /* readback failed — just skip persisting */ }
	}
	try { bmp2.close(); } catch {}
}
let _encodeBusy = false;

// Reusable 2D scratch canvas for the single-readback disk-cache capture. Grown
// to the largest sheet seen; avoids allocating a canvas per bake.
let _encodeScratch = null;
function _encodeScratchFor(w, h) {
	if (!_encodeScratch || _encodeScratch.w < w || _encodeScratch.h < h) {
		const canvas = new OffscreenCanvas(w, h);
		// willReadFrequently keeps this on a CPU backing so the getImageData
		// readback is cheap and doesn't ping-pong the GPU.
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		_encodeScratch = { canvas, ctx, w, h };
	}
	return _encodeScratch;
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

// Render all visible, built canvas-cells. Driven by a 'tick' message the
// proxy posts once per animation frame (it carries `now`; no DOM reads).
function renderCanvasCells(now) {
	if (!_kit || !_canvasCells.size) return;
	const firstPaints = [];
	for (const [id, cell] of _canvasCells) {
		if (!cell.visible || !cell.ctx) continue;
		const entry = _anims.get(cell.url);
		if (!entry || entry.duration <= 0) continue; // not built yet → thumb still covers it
		// A LIVE cell needs a parsed animation; a diskOnly entry has none. That
		// only happens if a live cell shares a URL with a rasterized one — rare,
		// but pull the real Lottie in and let the thumb hold until it's built.
		if (!cell.rasterized && !entry.animation) { requestAnimUpgrade(cell.url, entry); continue; }

		// Compute the target frame FIRST so we can bail before doing any GPU
		// work if it hasn't advanced since last tick. Paused/static cells
		// (very common in custom packs) then render exactly once; animations
		// slower than the 32 fps tick skip the ticks where their frame index
		// is unchanged. Each skipped cell saves a clear + seek + render +
		// flush + two bitmap transfers — the dominant per-frame worker cost.
		let t;
		if (cell.paused) {
			t = cell.paintIndex != null ? Math.min(cell.paintIndex / entry.totalFrames, 1) : 1;
		} else {
			// Share one timeline per URL so re-mounted cells rejoin the
			// cycle in progress instead of snapping back to frame 0.
			if (entry.startTime == null) entry.startTime = now;
			if (!cell.startTime) cell.startTime = entry.startTime;
			const elapsed = (now - cell.startTime) / 1000;
			t = cell.loop
				? (elapsed % entry.duration) / entry.duration
				: Math.min(1, elapsed / entry.duration);
		}
		// ── Rasterized engine: blit a frame from the shared atlas ────────
		if (cell.rasterized) {
			const ckey = cell.url + '@' + cell.w;
			const cache = _frameCache.get(ckey);
			if (!cache) { scheduleRasterize(cell.url, cell.w, cell.fpsScale); continue; } // thumb covers until ready
			// Touch LRU so an on-screen emoji is never the eviction victim.
			cache.atlas.lru.delete(ckey);
			cache.atlas.lru.set(ckey, cache);
			const N = cache.N;
			const _ready = cache.ready ?? N;        // progressive bake: frames [0, ready) live
			const fullyBaked = _ready >= N;
			let fi;
			if (!cell.firstPainted) {
				// The sprite thumb is the emote's LAST frame (render_thumbs bakes
				// op-1), so DON'T reveal until the whole loop is baked, then hand off
				// ON the last frame — pixel-identical to the thumb, so the swap is
				// seamless: no fade, no pop, no empty-frame-0 blank. Until then keep
				// blitting the newest baked frame UNDER the (still-covering) thumb.
				fi = fullyBaked ? N - 1 : _ready - 1;
			} else if (cell.paused) {
				fi = cell.paintIndex != null ? Math.min(cell.paintIndex, N - 1) : N - 1;
			} else {
				// Play forward on this cell's own clock, phased to start at the last
				// frame (where we handed off) and loop N-1 → 0 → 1 …
				const elapsed = (now - cell.startTime) / 1000;
				const tt = cell.loop
					? (elapsed % entry.duration) / entry.duration
					: Math.min(1, elapsed / entry.duration);
				fi = Math.min(N - 1, Math.floor(tt * N));
			}
			if (cell.firstPainted && fi === cell.lastFrame) continue; // frame unchanged
			const slot = cache.slots[fi];
			const ss = cache.atlas.slot; // supersampled source size
			const pageCanvas = cache.atlas.pages[slot.page].canvas;
			let okR = false;
			try {
				cell.ctx.clearRect(0, 0, cell.w, cell.h);
				// Source rect is the supersampled slot; dest is the cell —
				// the browser downsamples ss→cell.w for the crisp result.
				cell.ctx.drawImage(pageCanvas, slot.x, slot.y, ss, ss, 0, 0, cell.w, cell.h);
				okR = true;
			} catch { /* detached */ }
			if (!okR) continue;
			cell.lastFrame = fi;
			cell.paintCount = (cell.paintCount || 0) + 1;
			// Hand off ONLY once the full loop is baked, so the revealed frame is
			// the last frame = the thumb. Then start this cell's own clock phased
			// so playback continues forward from that last frame into the loop.
			if (!cell.firstPainted && fullyBaked) {
				cell.firstPainted = true;
				firstPaints.push(id);
				cell.startTime = now - ((N - 1) / N) * entry.duration * 1000;
			}
			continue;
		}

		const frame = Math.min(entry.totalFrames - 1, Math.floor(t * entry.totalFrames));
		if (cell.firstPainted && frame === cell.lastFrame) continue; // nothing new to draw

		const s = ensureScratchForPx(cell.w);
		if (!s) continue;
		const sk = s.surface.getCanvas();
		sk.clear(_kit.TRANSPARENT);
		const rect = _kit.LTRBRect(0, 0, cell.w, cell.h);
		entry.animation.seek(frame / entry.totalFrames);
		entry.animation.render(sk, rect);
		s.surface.flush();

		// Zero-copy GPU handoff into the cell's own canvas. Only count the
		// paint (which is what hides the CSS thumb) when the transfer
		// actually lands — if it throws, the thumb stays put rather than
		// uncovering a blank canvas.
		let ok = false;
		try {
			const bmp = s.canvas.transferToImageBitmap();
			cell.ctx.transferFromImageBitmap(bmp);
			ok = true;
		} catch { /* cell canvas detached mid-frame */ }
		if (!ok) continue;
		cell.lastFrame = frame;

		cell.paintCount = (cell.paintCount || 0) + 1;
		// Hold the CSS thumb until the animation is SOLIDLY rendering, then
		// hand off — mirrors the committed overlay renderer's behaviour.
		// Handing off after just 1–2 paints exposed the canvas while its
		// first frames were still settling, which read as a flicker the
		// instant a sticker started animating. 12 frames (~0.4 s at the
		// 32 fps tick) is enough for the loop to be visibly going before we
		// drop the placeholder. Adaptive packs (tinted silhouettes) hand
		// off on paint 1 — their CSS backdrop is a pre-baked match, so
		// there's nothing to settle and holding just delays them.
		if (!cell.firstPainted) {
			const short = shortFromUrl(cell.url);
			const isAdaptive = short && _adaptive.has(short);
			// Re-entry (prebuilt) and adaptive packs hand off immediately;
			// only a first-time build holds to hide the settling frames.
			// Desktop (fastHandoff) trims that hold from 12 paints (~375 ms
			// at the 32 fps tick) to 3 — settle completes within a couple of
			// frames there, and the hold was the largest share of "not
			// instant". Mobile keeps the signed-off 12-paint contract.
			const handoffAt = (cell.prebuilt || isAdaptive) ? 1 : (_fastHandoff ? 3 : 12);
			if (cell.paintCount >= handoffAt) {
				cell.firstPainted = true;
				firstPaints.push(id);
			}
		}
	}
	if (firstPaints.length) self.postMessage({ type: 'first-paints', ids: firstPaints });
}

// Adaptive-pack state, pushed once at boot by the main-thread proxy via
// 'set-adaptive'. _adaptive holds the short_names of Telegram packs
// whose Lotties ship as white-sentinel silhouettes; _adaptiveInk is the
// [r,g,b] (0–1) we should paint them in. Empty set/null ink = no-op.
let _adaptive = new Set();
let _adaptiveInk = null;
function shortFromUrl(url) {
	const m = /\/telegram-custom\/([^/]+)\/[^/]+\.json(?:$|\?)/.exec(url);
	return m ? m[1] : null;
}

// Same buffer constant as skottie-stage.js — cells within this CSS-pixel
// distance of the viewport get their tile painted (once); cells outside
// are skipped entirely each frame.
const PAINT_BUFFER_PX = 360;

// Forward diagnostic messages to the main thread so they show up in the
// page's regular Console tab — the worker's own console context lives
// in a hard-to-find DevTools dropdown and most users never see it.
// Each entry is a [level, ...args] message that the proxy re-logs with
// the same severity. Keep these sparse: init events, surface state
// changes, build failures. Anything per-frame would flood the console.
function diag(level, ...args) {
	try { self.postMessage({ type: 'diag', level, args }); } catch {}
}

async function loadKit() {
	if (_kit) return _kit;
	_kit = await CanvasKitInit({
		locateFile: (file) => `/canvaskit/${file}`
	});
	return _kit;
}

// Worker-local Lottie JSON cache. Independent from the main thread's
// fetchLottie cache — worker fetches its own copies, but the browser's
// HTTP cache means each emoji URL is only hit once across both threads.
const _lottieCache = new Map();
function fetchLottieWorker(url) {
	let p = _lottieCache.get(url);
	if (!p) {
		p = fetch(url)
			.then((r) => (r.ok ? r.text() : null))
			.then((t) => (t ? JSON.parse(t) : null))
			.catch(() => null);
		_lottieCache.set(url, p);
	}
	return p;
}

// Sheet image is now POSTED to the worker by the main-thread proxy
// (the proxy fetches the WebP once and pushes the ArrayBuffer here via
// 'load-sheet'). We just decode. The previous in-worker `fetch(url)`
// path had no dedup, so every register-cell with thumbInfo kicked off a
// concurrent fetch — 17+ duplicate fetches per shard, each re-decoding
// 1.9 MB. Centralising in the proxy means exactly one fetch total and
// each worker decodes from a structured-cloned copy of the same bytes.
function decodeSheetBytes(bytes) {
	if (!_kit) {
		diag('warn', '[skottie-worker] load-sheet arrived before kit ready');
		return;
	}
	if (_sheetImage) return; // already decoded — ignore re-sends
	try {
		const img = _kit.MakeImageFromEncoded(new Uint8Array(bytes));
		if (img) {
			_sheetImage = img;
			diag('log', '[skottie-worker] sheet decoded (', bytes.byteLength, 'bytes)');
		} else {
			diag('warn', '[skottie-worker] MakeImageFromEncoded returned null for sheet');
		}
	} catch (e) {
		diag('warn', '[skottie-worker] sheet decode threw:', String(e?.message || e));
	}
}

// ── Animation build pump ────────────────────────────────────────────────
// Same priority queue as skottie-stage.js (in-viewport first, then by
// reading order). We can't query the DOM here, so we track the latest
// viewport + per-url rects that the main thread reported with each
// render message and use those for priority decisions.
let _lastViewRect = null;
const _lastRectByUrl = new Map();

let _processing = false;
let _pumpScheduled = false;

const _scheduleIdle = (typeof requestIdleCallback === 'function')
	? (cb) => requestIdleCallback(cb, { timeout: 200 })
	: (cb) => setTimeout(cb, 0);
const _yieldIdle = (typeof requestIdleCallback === 'function')
	? () => new Promise((r) => requestIdleCallback(r, { timeout: 200 }))
	: () => new Promise((r) => setTimeout(r, 0));

function schedulePump() {
	if (_pumpScheduled || _processing) return;
	_pumpScheduled = true;
	_scheduleIdle(() => { _pumpScheduled = false; processQueue(); });
}

async function processQueue() {
	if (_processing) return;
	_processing = true;
	while (_pending.size) {
		// Priority 3: has an on-screen canvas (inline/rasterized) cell.
		// Priority 2: overlay cell inside viewport (sub-sorted by reading order).
		// Priority 1: overlay cell off-screen but has a known rect.
		// Priority 0: no rect at all.
		// The canvas/worker engines don't post per-frame rects, so without
		// the pri-3 check the rect-based logic is blind to them and a fast
		// scroll builds off-screen emojis ahead of the on-screen row.
		const visCanvasUrls = new Set();
		for (const cell of _canvasCells.values()) {
			if (cell.visible) visCanvasUrls.add(cell.url);
		}
		let bestUrl = null;
		let bestPri = -1;
		let bestScore = Infinity;
		for (const [url] of _pending) {
			let pri = visCanvasUrls.has(url) ? 3 : 0;
			let score = Infinity;
			const r = _lastRectByUrl.get(url);
			if (r && r.width > 0) {
				pri = 1;
				if (_lastViewRect) {
					const v = _lastViewRect;
					const inView = !(
						r.right < v.left || r.bottom < v.top
						|| r.left > v.right || r.top > v.bottom
					);
					if (inView) {
						pri = 2;
						const relTop = Math.max(0, r.top - v.top);
						const relLeft = Math.max(0, r.left - v.left);
						score = relTop * 10000 + relLeft;
					}
				}
			}
			if (pri > bestPri || (pri === bestPri && score < bestScore)) {
				bestPri = pri; bestScore = score; bestUrl = url;
			}
		}
		if (bestUrl == null) break;
		const pending = _pending.get(bestUrl);
		_pending.delete(bestUrl);

		try {
			const data = await pending.dataPromise;
			if (!data) {
				diag('warn', '[skottie-worker] no data for', bestUrl);
			} else if (_kit) {
				// Adaptive-pack tint: swap white-sentinel fills for the
				// host page's current --ink before handing the JSON to
				// Skottie. No-op if the URL isn't from an adaptive pack
				// or if no ink has been pushed yet.
				const short = shortFromUrl(bestUrl);
				if (short && _adaptive.has(short) && _adaptiveInk) {
					tintLottieAdaptive(data, _adaptiveInk);
				}
				const animation = _kit.MakeManagedAnimation
					? _kit.MakeManagedAnimation(JSON.stringify(data))
					: _kit.MakeAnimation(JSON.stringify(data));
				if (animation) {
					const duration = animation.duration() || 1;
					const fps = animation.fps() || 60;
					_anims.set(bestUrl, {
						animation,
						refcount: pending.refcount,
						duration,
						fps,
						totalFrames: Math.max(1, Math.round(duration * fps))
					});
					self.postMessage({ type: 'anim-loaded', url: bestUrl });
					// Log every 25th build so we get a heartbeat without
					// flooding the console with hundreds of lines.
					if ((_anims.size % 25) === 0) {
						diag('log', '[skottie-worker] built', _anims.size, 'animations');
					}
				} else {
					diag('warn', '[skottie-worker] MakeManagedAnimation returned null for', bestUrl);
				}
			}
		} catch (e) {
			diag('warn', '[skottie-worker] anim build failed', bestUrl, String(e?.message || e));
		}

		await _yieldIdle();
	}
	_processing = false;
}

// ── Render ──────────────────────────────────────────────────────────────
function renderFrame(msg) {
	if (!_kit) return null;
	// Self-heal: if the surface went null (a previous resize's
	// MakeWebGLCanvasSurface returned null — sometimes happens on first
	// post-init resize while the offscreen canvas still has its
	// transferred-but-not-yet-laid-out size) try to rebuild it now that
	// we presumably have valid dimensions. Without this the worker can
	// be permanently stuck rendering nothing, which matches the
	// "transparent for 30 seconds" pattern: the surface dies once, no
	// later resize fires, and we never recover.
	if (!_surface && _canvas && _canvas.width >= 2 && _canvas.height >= 2) {
		_surface = _kit.MakeWebGLCanvasSurface(_canvas, undefined, _surfaceOpts);
		if (_surface) {
			diag('log', '[skottie-worker] surface self-heal succeeded at', _canvas.width, 'x', _canvas.height);
			for (const c of _cells.values()) { c.firstPainted = false; c.paintCount = 0; }
		} else {
			diag('warn', '[skottie-worker] surface self-heal failed at', _canvas.width, 'x', _canvas.height);
		}
	}
	if (!_surface) return null;
	const { now, viewRect, canvasRect, cellRects, dpr, scrolled } = msg;
	_lastViewRect = viewRect;

	const sk = _surface.getCanvas();
	let drewAny = false;
	const firstPaints = [];

	// The canvas is pinned to the scroll viewport, so when the content
	// scrolls every cell moves to a new spot on the surface. The per-tile
	// clear below only wipes where each cell LANDS — the pixels it
	// vacated would persist (preserveDrawingBuffer keeps them) and smear
	// into a ghost trail. On any scrolled frame, wipe the whole surface
	// up front and let the loop repaint every in-view cell fresh.
	if (scrolled) {
		sk.clear(_kit.TRANSPARENT);
		drewAny = true; // force a flush so the wipe lands even if no cell draws
	}

	for (const cr of cellRects) {
		const cell = _cells.get(cr.id);
		if (!cell || !cell.visible) continue;

		// Track latest rect for the priority queue.
		_lastRectByUrl.set(cell.url, cr.rect);

		const entry = _anims.get(cell.url);
		if ((!entry || entry.duration === 0) && !cell.thumbInfo) continue;
		const rect = cr.rect;
		if (!rect || rect.width === 0 || rect.height === 0) continue;

		const inViewport = !(
			rect.right < viewRect.left || rect.bottom < viewRect.top
			|| rect.left > viewRect.right || rect.top > viewRect.bottom
		);
		const inPaintZone = !(
			rect.right < viewRect.left - PAINT_BUFFER_PX
			|| rect.bottom < viewRect.top - PAINT_BUFFER_PX
			|| rect.left > viewRect.right + PAINT_BUFFER_PX
			|| rect.top > viewRect.bottom + PAINT_BUFFER_PX
		);
		const justEntered = inViewport && !cell.wasOnScreen;
		cell.wasOnScreen = inViewport;

		if (!inPaintZone) continue;
		if (cell.firstPainted && !inViewport) continue;

		// A diskOnly entry (no parsed animation, cached frames only) can't drive
		// the overlay's live seek/render — pull the real Lottie and hold the
		// thumb until it builds.
		if (entry && entry.duration > 0 && !entry.animation) requestAnimUpgrade(cell.url, entry);
		const hasAnim = !!(entry && entry.duration > 0 && entry.animation);
		const shouldAnimate = hasAnim && inViewport;
		if (justEntered && shouldAnimate && !cell.animationStarted) {
			// Keep the animation cycle continuous across cell
			// instances. Section virtualization unmounts and re-
			// mounts cells with fresh per-cell state when sections
			// scroll out of and back into the band. Without this,
			// each new cell would set `startTime = now`, render at
			// frame 0 next paint, and snap back to the start of
			// the loop — visible as a "the sticker jumped" flash
			// even when the animation entry itself stayed resident
			// in `_anims`. Storing startTime on the animation
			// entry (one slot per URL) means every cell that
			// renders this URL shares one timeline; rejoining the
			// cycle in progress is what the user expected.
			if (entry.startTime == null) entry.startTime = now;
			cell.startTime = entry.startTime;
			cell.animationStarted = true;
		}

		// Decide what we're drawing BEFORE touching the surface. If
		// nothing's drawable this frame (anim not built yet, sheet
		// not decoded, …) skip the whole save/clear/restore — keeping
		// whatever pixels were there last frame is strictly better
		// than wiping to transparent and waiting for the next paint.
		// With `preserveDrawingBuffer: 1` the previous frame survives
		// across compositor commits, so doing nothing == cell stays
		// rendered.
		const canDrawAnim = shouldAnimate;
		const canDrawThumb = !shouldAnimate && cell.thumbInfo && _sheetImage;
		if (!canDrawAnim && !canDrawThumb) continue;

		const left = (rect.left - canvasRect.left) * dpr;
		const top = (rect.top - canvasRect.top) * dpr;
		const right = (rect.right - canvasRect.left) * dpr;
		const bottom = (rect.bottom - canvasRect.top) * dpr;
		const tile = _kit.LTRBRect(left, top, right, bottom);

		sk.save();
		sk.clipRect(tile, _kit.ClipOp.Intersect, false);
		sk.clear(_kit.TRANSPARENT);

		let cellDrew = false;
		if (canDrawAnim) {
			let t;
			if (cell.paused && cell.paintIndex != null) {
				t = Math.min(cell.paintIndex / entry.totalFrames, 1);
			} else {
				const elapsed = (now - cell.startTime) / 1000;
				t = cell.loop
					? (elapsed % entry.duration) / entry.duration
					: Math.min(1, elapsed / entry.duration);
			}
			const frame = Math.min(entry.totalFrames - 1, Math.floor(t * entry.totalFrames));
			entry.animation.seek(frame / entry.totalFrames);
			entry.animation.render(sk, tile);
			cellDrew = true;
		} else if (canDrawThumb) {
			const cellPx = cell.thumbInfo.cellPx;
			const srcRect = _kit.LTRBRect(
				cell.thumbInfo.x,
				cell.thumbInfo.y,
				cell.thumbInfo.x + cellPx,
				cell.thumbInfo.y + cellPx
			);
			if (!_imagePaint) _imagePaint = new _kit.Paint();
			sk.drawImageRect(_sheetImage, srcRect, tile, _imagePaint);
			cellDrew = true;
		}
		sk.restore();

		if (cellDrew) {
			drewAny = true;
			if (!cell.firstPainted) cell.firstPainted = true;
			cell.paintCount = (cell.paintCount || 0) + 1;
			// Adaptive packs (Emoticon, Kawaii, Outline) ship white
			// silhouettes that get tinted to the current ink at draw
			// time; the CSS backdrop is a pre-baked dark-ink copy and
			// the runtime canvas pixels are also dark-ink, but the
			// delay between them is jarring for that visual style.
			// Drop the hold for adaptive cells: fire on paint #1.
			// Everything else gets the full 15-paint hold so the
			// canvas has visibly taken over before the backdrop
			// falls away.
			const short = shortFromUrl(cell.url);
			const isAdaptive = short && _adaptive.has(short);
			const handoffAt = isAdaptive ? 1 : (_fastHandoff ? 3 : 15);
			if (cell.paintCount === handoffAt) firstPaints.push(cr.id);
		}
	}

	if (drewAny) _surface.flush();
	if (firstPaints.length) self.postMessage({ type: 'first-paints', ids: firstPaints });
}

// ── Message handler ─────────────────────────────────────────────────────
self.onmessage = async (e) => {
	const msg = e.data;
	switch (msg.type) {
		case 'init': {
			_canvas = msg.canvas;
			_fastHandoff = !!msg.fastHandoff;
			diag('log', '[skottie-worker] init: canvas size', _canvas.width, 'x', _canvas.height);
			try {
				await loadKit();
				diag('log', '[skottie-worker] CanvasKit loaded — surface deferred until first resize');
				// Surface intentionally NOT created here. We get
				// `init` during prewarm BEFORE the picker has a host
				// element, so the canvas is still at the default
				// 300×150 buffer and there's no point allocating GPU
				// resources at that size — they'd just get nuked
				// when the real resize lands. First 'resize' creates
				// it at the right size.
				self.postMessage({ type: 'ready' });
			} catch (err) {
				diag('error', '[skottie-worker] init exception:', String(err?.message || err));
				self.postMessage({ type: 'init-failed', error: String(err?.message || err) });
			}
			break;
		}
		case 'resize': {
			if (!_canvas || !_kit) return;
			const { width, height } = msg;
			if (width < 2 || height < 2) return;
			if (_canvas.width === width && _canvas.height === height && _surface) return;
			_canvas.width = width;
			_canvas.height = height;
			const hadSurface = !!_surface;
			try { _surface?.delete(); } catch {}
			_surface = _kit.MakeWebGLCanvasSurface(_canvas, undefined, _surfaceOpts);
			if (!_surface) {
				diag('warn', '[skottie-worker] resize: MakeWebGLCanvasSurface returned null (', width, 'x', height, ') — will self-heal on next render');
			} else {
				diag('log', hadSurface ? '[skottie-worker] resize OK ->' : '[skottie-worker] first surface OK ->', width, 'x', height);
			}
			// All pixels just got nuked — main thread needs to reset
			// every cell's firstPainted mirror so the CSS thumbs come
			// back while the canvas warms up again.
			for (const c of _cells.values()) { c.firstPainted = false; c.paintCount = 0; }
			self.postMessage({ type: 'surface-recreated' });
			break;
		}
		case 'register-cell': {
			_cells.set(msg.id, {
				url: msg.url,
				paused: !!msg.paused,
				paintIndex: msg.paintIndex ?? null,
				loop: msg.loop !== false,
				thumbInfo: msg.thumbInfo || null,
				// Trust the proxy's `visible` value. Off-viewport cells
				// arrive with visible=false; the render loop's
				// `if (!cell.visible) continue;` skips them entirely
				// (no rect, no clipRect, no Skottie seek) until a
				// later set-visible flips the flag on.
				visible: !!msg.visible,
				firstPainted: false,
				wasOnScreen: false,
				animationStarted: false,
				startTime: 0
			});
			// No sheet fetch here — proxy ships the decoded sheet
			// bytes via 'load-sheet' exactly once per shard. If the
			// sheet hasn't arrived yet, the render loop's thumb branch
			// skips (cellDrew stays false, firstPainted stays false,
			// so the CSS thumb in the SpriteSticker remains visible
			// until our canvas has something to show).
			break;
		}
		case 'load-sheet': {
			decodeSheetBytes(msg.bytes);
			break;
		}
		case 'set-adaptive': {
			// Main thread tells us which custom packs are "adaptive"
			// (Telegram text_color flag) and what color to tint them.
			// Sent once when the proxy's manifest fetch completes, and
			// again whenever the M3 theme switches so cached builds get
			// rebuilt in the new ink.
			const prevInk = _adaptiveInk;
			_adaptive = new Set(msg.adaptive || []);
			_adaptiveInk = Array.isArray(msg.ink) ? msg.ink : null;
			const inkChanged = !prevInk || !_adaptiveInk
				|| prevInk[0] !== _adaptiveInk[0]
				|| prevInk[1] !== _adaptiveInk[1]
				|| prevInk[2] !== _adaptiveInk[2];
			diag('log', '[skottie-worker] adaptive packs:', _adaptive.size,
				'ink:', _adaptiveInk, 'inkChanged:', inkChanged);
			// Re-tint on ANY ink change (including the very first push — an
			// adaptive anim may have been built untinted in the race before
			// the ink arrived).
			if (inkChanged) {
				// Drop cached animations AND their baked atlas frames for
				// adaptive URLs so both the build pump and the rasteriser
				// redo them in the new ink. Without freeing the frame cache,
				// rasterized cells kept blitting the stale (old-ink) frames —
				// e.g. dark silhouettes that stayed black after switching to
				// a dark theme. Cells stay bound; they briefly show their CSS
				// thumb / last frame until the new bake lands.
				let dropped = 0;
				for (const [url, entry] of _anims) {
					const short = shortFromUrl(url);
					if (!short || !_adaptive.has(short)) continue;
					try { entry.animation.delete(); } catch {}
					_anims.delete(url);
					// Re-queue with the old refcount so cells stay bound.
					_pending.set(url, { dataPromise: fetchLottieWorker(url), refcount: entry.refcount });
					_lottieCache.delete(url);
					freeFrameCache(url); // stale rasterized frames → re-bake in new ink
					dropped++;
				}
				// Force re-draw of affected canvas cells: their frame index may
				// be unchanged, but the pixels behind it are new, so clear the
				// frame-skip guard.
				for (const cell of _canvasCells.values()) {
					const short = shortFromUrl(cell.url);
					if (short && _adaptive.has(short)) cell.lastFrame = -1;
				}
				if (dropped) {
					diag('log', '[skottie-worker] re-queueing', dropped, 'adaptive anims');
					schedulePump();
				}
			}
			break;
		}
		case 'unregister-cell': {
			_cells.delete(msg.id);
			break;
		}
		case 'set-visible': {
			const c = _cells.get(msg.id);
			if (c) c.visible = !!msg.visible;
			break;
		}
		case 'load-anim': {
			const url = msg.url;
			const existing = _anims.get(url);
			if (existing) {
				// Covers both a real parsed anim AND a diskOnly entry — either
				// way playback has what it needs, no fetch required.
				existing.refcount++;
				self.postMessage({ type: 'anim-loaded', url });
				return;
			}
			// A disk probe kicked at cell-registration may still be resolving —
			// wait for it. On a hit it will have created the entry (no fetch);
			// only on a miss do we fall back to fetching + parsing the Lottie.
			const probe = _diskProbes.get(url);
			if (probe) {
				probe.then(() => {
					const e2 = _anims.get(url);
					if (e2) { e2.refcount++; self.postMessage({ type: 'anim-loaded', url }); return; }
					if (!_pending.get(url) && !_anims.get(url)) {
						_pending.set(url, { dataPromise: fetchLottieWorker(url), refcount: 1 });
						schedulePump();
					}
				});
				break;
			}
			const pending = _pending.get(url);
			if (pending) {
				pending.refcount++;
				return;
			}
			_pending.set(url, { dataPromise: fetchLottieWorker(url), refcount: 1 });
			schedulePump();
			break;
		}
		case 'release-anim': {
			const url = msg.url;
			const pending = _pending.get(url);
			if (pending) {
				pending.refcount--;
				if (pending.refcount <= 0) _pending.delete(url);
				return;
			}
			const entry = _anims.get(url);
			if (!entry) return;
			entry.refcount--;
			if (entry.refcount <= 0) {
				try { entry.animation.delete(); } catch {}
				_anims.delete(url);
				_lastRectByUrl.delete(url);
				freeFrameCache(url); // release any rasterized ImageBitmaps for this url
				// Tell main thread we've actually let this URL go so it
				// can mirror by clearing the cached `_loadedUrls` entry.
				// Multiple cells often share a URL; we only want this
				// fired once refcount hits zero, not on every release().
				self.postMessage({ type: 'anim-released', url });
			}
			break;
		}
		case 'render': {
			renderFrame(msg);
			break;
		}
		case 'prewarm-bake': {
			// Background disk warm: bake each URL to the cache one at a time,
			// yielding between so live rendering always wins. Reports totals so
			// the driver can pace the next row.
			const { urls, px, fpsScale, batchId } = msg;
			(async () => {
				let warmed = 0, cached = 0;
				for (const url of urls) {
					const r = await prewarmBake(url, px, fpsScale || 1).catch(() => 'err');
					if (r === 'warmed') warmed++;
					else if (r === 'cached') cached++;
					await _yieldIdle();
				}
				self.postMessage({ type: 'prewarm-batch-done', batchId, warmed, cached, count: urls.length });
			})();
			break;
		}
		// ── Inline-canvas path ──────────────────────────────────────────
		case 'register-canvas-cell': {
			const rasterized = !!msg.rasterized;
			let ctx = null;
			// Rasterized cells receive frames via drawImage(ImageBitmap) → 2d.
			// Live cells receive zero-copy transferFromImageBitmap → bitmaprenderer.
			try {
				ctx = msg.canvas.getContext(rasterized ? '2d' : 'bitmaprenderer');
				// High-quality downscale from the supersampled atlas slot.
				if (rasterized && ctx) ctx.imageSmoothingQuality = 'high';
			} catch { /* transfer failed */ }
			// If the animation is ALREADY built when this cell mounts, it's a
			// re-entry (the user scrolled this section back into view) — the
			// animation is mid-cycle and stable, so there are no settling
			// frames to hide and we can hand the placeholder off on paint 1.
			// Only a first-time build needs the multi-frame hold.
			const _built = _anims.has(msg.url) && (_anims.get(msg.url).duration > 0);
			_canvasCells.set(msg.id, {
				ctx,
				rasterized,
				off: msg.canvas,
				url: msg.url,
				paused: !!msg.paused,
				loop: msg.loop !== false,
				paintIndex: msg.paintIndex ?? null,
				w: msg.w,
				h: msg.h,
				fpsScale: msg.fpsScale || 1,
				visible: !!msg.visible,
				visibleAt: msg.visible ? ++_visSeq : 0,
				prebuilt: _built,
				startTime: 0,
				paintCount: 0,
				firstPainted: false,
				lastFrame: -1
			});
			// Probe the disk cache the instant a rasterized cell mounts — BEFORE
			// the load-anim that SpriteSticker fires right after. On a hit the
			// atlas fills from cached frames and load-anim becomes a no-op, so
			// the Lottie is never fetched or parsed (Telegram's fast path).
			if (rasterized && frameCacheAvailable()
				&& !_anims.get(msg.url)?.animation
				&& !_frameCache.has(msg.url + '@' + msg.w)) {
				probeDisk(msg.url, msg.w);
			}
			break;
		}
		case 'unregister-canvas-cell': {
			_canvasCells.delete(msg.id);
			break;
		}
		// Hand GPU/canvas memory back. `all` also drops sizes that still have
		// cells registered — for backgrounding, where nothing is on screen to
		// re-bake for and the OS is about to start looking for a process to
		// kill. Without `all` it only reclaims sizes with no live cell.
		// The disk frame cache survives either way, so coming back rehydrates
		// from it instead of re-rendering the Lottie.
		case 'reclaim': {
			if (msg.all) {
				for (const px of [..._atlasByPx.keys()]) freeSize(px);
			} else {
				reclaimIdleSizes();
			}
			self.postMessage({ type: 'reclaimed', pages: _totalPages });
			break;
		}
		case 'set-canvas-visible': {
			const c = _canvasCells.get(msg.id);
			// Leave the last-drawn frame in place when hiding — the cell
			// is off-screen so it's invisible anyway, and keeping it means
			// instant content (no blank flash) when it scrolls back in.
			if (c) {
				if (msg.visible && !c.visible) c.visibleAt = ++_visSeq; // scrolled IN → freshest
				c.visible = !!msg.visible;
			}
			break;
		}
		case 'tick': {
			renderCanvasCells(msg.now);
			break;
		}
		case 'clear': {
			// Wipe the surface and reset every cell's firstPainted/etc.
			// so they re-draw cleanly on the next render. Used on tab
			// switches in the picker — without this, pixels from the
			// previous tab linger anywhere the new tab has no cell.
			if (_surface && _kit) {
				const sk = _surface.getCanvas();
				sk.clear(_kit.TRANSPARENT);
				_surface.flush();
			}
			for (const c of _cells.values()) {
				c.firstPainted = false;
				c.paintCount = 0;
				c.wasOnScreen = false;
				c.animationStarted = false;
			}
			// Cancel every queued build. Tab-switch usually means the
			// old tab's pending URLs are no longer wanted — leaving
			// them in the pump steals priority slots from the new
			// tab's in-viewport cells and lags first-paint. New cells
			// re-queue what they need via `load-anim`; the lottie
			// fetch is HTTP-cached so the re-queue is cheap.
			if (_pending.size) {
				diag('log', '[skottie-worker] clear: dropping', _pending.size, 'pending builds');
				_pending.clear();
			}
			// Drop stale rect cache so the priority queue doesn't
			// keep treating old-tab URLs as "in viewport" via their
			// last-known position. Render messages will repopulate it
			// with the new tab's rects on the next frame.
			_lastRectByUrl.clear();
			self.postMessage({ type: 'cleared' });
			break;
		}
	}
};
