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
import { loadFrames as fcLoad, storeFrames as fcStore, frameCacheAvailable } from './frame-cache.js';

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
function ensureRasterSheetForPx(px) {
	let s = _rasterSheetByPx.get(px);
	if (s) return s;
	if (!_kit) return null;
	const slot = Math.round(px * SUPERSAMPLE);
	const canvas = new OffscreenCanvas(RASTER_COLS * slot, RASTER_COLS * slot);
	const surface = _kit.MakeWebGLCanvasSurface(canvas, undefined, _surfaceOpts);
	if (!surface) return null;
	s = { canvas, surface, slot };
	_rasterSheetByPx.set(px, s);
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
function addAtlasPage(a) {
	if (a.pages.length >= MAX_ATLAS_PAGES) return false;
	const canvas = new OffscreenCanvas(ATLAS_DIM, ATLAS_DIM);
	const ctx = canvas.getContext('2d');
	const page = a.pages.length;
	a.pages.push({ canvas, ctx });
	for (let r = 0; r < a.cols; r++)
		for (let c = 0; c < a.cols; c++)
			a.free.push({ page, x: c * a.slot, y: r * a.slot });
	return true;
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

async function doRasterize(url, px, key, fpsScale = 1) {
	const entry = _anims.get(url);
	if (!entry || entry.duration <= 0) { _frameJobs.delete(key); return; }
	const atlas = getAtlas(px);
	if (!atlas) { _frameJobs.delete(key); return; }
	const sl = atlas.slot; // supersampled pixel size (px * SUPERSAMPLE)

	// ── Fast path: rehydrate from the persistent disk cache ──────────────
	// If this emote@px was baked in a previous session (or earlier this one),
	// its frames are on disk XOR-delta+gzip'd. Decode them and fill the atlas
	// directly — skipping the entire Skia render loop, which is the dominant
	// per-emote cost. Telegram Desktop's whole snappiness trick.
	if (frameCacheAvailable()) {
		let disk = null;
		try { disk = await fcLoad(url + '@' + px, sl); } catch { disk = null; }
		// The await above yields — re-validate nothing was torn down meanwhile.
		if (disk && _anims.get(url) === entry && !_frameCache.has(key)) {
			const slots = atlasAllocSlots(atlas, disk.N);
			if (slots) {
				for (let i = 0; i < disk.N; i++) {
					const slot = slots[i];
					const pctx = atlas.pages[slot.page].ctx;
					// putImageData writes the exact RGBA at the slot origin (no
					// blend) — same pixels the render→drawImage path would leave.
					try { pctx.putImageData(new ImageData(disk.frames[i], sl, sl), slot.x, slot.y); }
					catch { /* detached page — skip */ }
				}
				const cacheEntry = { atlas, slots, N: disk.N };
				_frameCache.set(key, cacheEntry);
				atlas.lru.set(key, cacheEntry);
				_frameJobs.delete(key);
				return;
			}
		}
	}

	// ── Slow path: render the vector frames with Skia ────────────────────
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

	// Render all frames into the WebGL sheet grid (at supersampled size),
	// then read back once.
	const sk = sheet.surface.getCanvas();
	sk.clear(_kit.TRANSPARENT);
	for (let i = 0; i < N; i++) {
		if (_anims.get(url) !== entry) { // released mid-job
			for (const s of slots) atlas.free.push(s);
			_frameJobs.delete(key);
			return;
		}
		const cx = (i % RASTER_COLS) * sl;
		const cy = ((i / RASTER_COLS) | 0) * sl;
		entry.animation.seek(i / N);
		entry.animation.render(sk, _kit.LTRBRect(cx, cy, cx + sl, cy + sl));
		if ((i & 7) === 7) { sheet.surface.flush(); await _yieldIdle(); }
	}
	sheet.surface.flush();
	const usedRows = Math.ceil(N / RASTER_COLS);
	const bmp = await createImageBitmap(sheet.canvas, 0, 0, RASTER_COLS * sl, usedRows * sl);
	// Blit each rendered frame from the sheet into its atlas slot (1:1 at
	// supersampled size; the downscale happens later, on the cell blit).
	for (let i = 0; i < N; i++) {
		const scx = (i % RASTER_COLS) * sl;
		const scy = ((i / RASTER_COLS) | 0) * sl;
		const slot = slots[i];
		const pctx = atlas.pages[slot.page].ctx;
		pctx.clearRect(slot.x, slot.y, sl, sl);
		pctx.drawImage(bmp, scx, scy, sl, sl, slot.x, slot.y, sl, sl);
	}
	// Keep `bmp` alive for the disk-cache readback below (bmp2 = same bitmap);
	// it's closed there once captured (or immediately if we're not caching).
	const bmp2 = bmp;

	const cacheEntry = { atlas, slots, N };
	_frameCache.set(key, cacheEntry);
	atlas.lru.set(key, cacheEntry);
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
			const fi = Math.min(cache.N - 1, Math.floor(t * cache.N));
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
			// Frames are pre-rendered (no settling), so hand off immediately.
			if (!cell.firstPainted) { cell.firstPainted = true; firstPaints.push(id); }
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

		const hasAnim = !!(entry && entry.duration > 0);
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
				existing.refcount++;
				self.postMessage({ type: 'anim-loaded', url });
				return;
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
			break;
		}
		case 'unregister-canvas-cell': {
			_canvasCells.delete(msg.id);
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
