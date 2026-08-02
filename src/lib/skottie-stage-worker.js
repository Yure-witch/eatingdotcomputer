// Main-thread proxy for the Skottie worker pool. Exposes the same API
// surface as skottie-stage.js (setHost, ensureStage, registerCell,
// loadAnimation, releaseAnimation, isAnimationLoaded, setCellVisible,
// unregisterCell, clearCanvas) so SpriteSticker can swap engines
// without caring which one it's on.

import { loadCustomPacks, getAdaptivePackList, getAdaptiveInk } from './telegram-emoji-store.js';
//
// SHARDED architecture (vs the original 1-worker design):
//   - We spin up NUM_WORKERS render workers, each running CanvasKit on
//     its OWN OffscreenCanvas. The canvases are stacked transparently
//     inside the picker's scroll content — content tiles never overlap
//     between shards (each cell is owned by exactly one worker), so
//     compositing is effectively free.
//   - Each cell is assigned a shard at registration via a stable djb2
//     hash of its animation URL. Cells with the same URL always land
//     on the same shard, so the animation cache stays deduplicated
//     within a shard and we don't pay MakeManagedAnimation N times for
//     a popular emoji.
//   - Per frame we bucket cell rects by shard and post N render
//     messages (one per worker). Each worker draws its share in
//     parallel. Frame-time CPU work splits roughly 1/N across the
//     workers; GPU contention caps the win below a perfect N× speedup
//     but for N=2 the gain is substantial.
//
// Cost: N × ~10 MB of CanvasKit WASM resident in memory; N worker
// threads alive while the picker is mounted. Sweet spot empirically
// looks like N=2 — at N=4 the per-worker context-switch + message-
// passing overhead starts eating the parallelism gain.

// With the inline-canvas path each cell owns its OWN DOM canvas (fed
// zero-copy via transferToImageBitmap), so there is NO shared surface and
// NO cross-shard coherence requirement — the old "collapse to 1 shard" fix
// was only needed for the shared overlay, which is gone. Spreading cells
// across shards parallelises the expensive MakeManagedAnimation builds
// (30–60 ms each), which is exactly what makes the initial
// placeholder→animation transition feel snappy instead of laggy. Cells
// hash to a shard by URL so a popular emoji builds once.
//
// DESKTOP (fine pointer, plenty of cores) gets a BIG pool — Telegram
// Desktop renders these instantly, and the closest the web gets is raw
// build parallelism: a 24-cell first viewport clears in ~1 wave with 10
// workers instead of 3 waves with 4. Mobile keeps the conservative cap;
// its constraint is GPU/memory budget, not build latency.
const _FINE_POINTER = typeof window !== 'undefined'
	&& window.matchMedia?.('(pointer: fine)').matches;
const _CORES = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
const NUM_WORKERS = _FINE_POINTER
	? Math.min(12, Math.max(4, _CORES - 2))
	: Math.min(4, Math.max(2, _CORES));

// ── Scroll throttle (identical to skottie-stage.js) ──────────────────────
let _isScrolling = false;
let _scrollResetTimer = null;
let _scrollFrameCount = 0;
let _lastScrollPos = 0;
let _lastScrollTime = 0;
let _scrollVelocityPxMs = 0;
let _lastRenderTime = 0;
// Scroll position at the last render frame. When it differs from the
// current scrollTop the content has moved under the viewport-pinned
// canvas, so the worker must FULL-clear the surface this frame (not
// just per-tile) or vacated cells leave a ghost trail.
let _lastRenderScrollTop = 0;
const SCROLL_SLOW_RENDER_EVERY = 3;
const FAST_PX_PER_MS = 1.5;
const SCROLL_SETTLE_MS = 110;
const TARGET_FPS_INTERVAL_MS = 31;

let _attachedScrollEl = null;
function markScrolling() {
	_isScrolling = true;
	if (_attachedScrollEl) {
		const now = performance.now();
		const pos = _attachedScrollEl.scrollTop;
		const dt = now - _lastScrollTime;
		if (dt > 0 && _lastScrollTime > 0) {
			_scrollVelocityPxMs = Math.abs(pos - _lastScrollPos) / dt;
		}
		_lastScrollPos = pos;
		_lastScrollTime = now;
	}
	if (_scrollResetTimer) clearTimeout(_scrollResetTimer);
	_scrollResetTimer = setTimeout(() => {
		_isScrolling = false;
		_scrollFrameCount = 0;
		_scrollVelocityPxMs = 0;
		_lastScrollTime = 0;
	}, SCROLL_SETTLE_MS);
}
function attachScrollListenerTo(el) {
	if (_attachedScrollEl === el) return;
	if (_attachedScrollEl) _attachedScrollEl.removeEventListener('scroll', markScrolling);
	_attachedScrollEl = el;
	_lastScrollTime = 0;
	if (el) el.addEventListener('scroll', markScrolling, { passive: true });
}

// ── Per-shard state ──────────────────────────────────────────────────────
// shards[i] = {
//   worker,        // Worker | null
//   canvas,        // HTMLCanvasElement (transferred to worker)
//   ready,         // bool — true once worker postMessage('ready') arrived
//   pendingMsgs,   // [[msg, transferList]] — queued while !ready
//   lastSentW,     // last resize msg width sent (skip if unchanged)
//   lastSentH
// }
const shards = [];

// Cell ID → { url, getRect, paused, paintIndex, loop, thumbInfo,
//             visible, firstPainted, shardIdx }. shardIdx is fixed at register time.
const _cells = new Map();
const _loadedUrls = new Set();
const _shardOfUrl = new Map(); // url -> shard idx (cache)

// Inline-canvas path: id -> { onFirstPaint, url }. The pixels live in the
// worker (it owns each cell's transferred OffscreenCanvas); the proxy
// just keeps the first-paint callback so it can fade the CSS thumb out.
const _canvasCells = new Map();
let _nextCanvasCellId = 1;
let _lastCanvasTick = 0; // throttle the worker tick to TARGET_FPS_INTERVAL_MS

let _ready = null;
let _running = false;
let _nextCellId = 1;
let _scrollContent = null;
let _scrollViewport = null;
let _resizeObserver = null;

// ── Sheet bytes hoisting ────────────────────────────────────────────────
// We fetch the sprite sheet WebP exactly once on the main thread and
// push a structured-cloned copy of the bytes into each worker. Without
// this, every register-cell triggered a fresh in-worker fetch (no
// dedup), so a single panel open caused 17+ concurrent fetches per
// shard, each re-decoding ~2 MB. With centralised hoisting: one fetch
// total, N decodes (one per shard), bytes arrive in workers as soon as
// they're back from the network.
let _sheetBytes = null;
let _sheetBytesPromise = null;
const _sheetSentTo = new Set(); // shard indices that already have it

function ensureSheetBytes(url) {
	if (_sheetBytes) return Promise.resolve(_sheetBytes);
	if (_sheetBytesPromise) return _sheetBytesPromise;
	_sheetBytesPromise = fetch(url)
		.then((r) => r.arrayBuffer())
		.then((bytes) => { _sheetBytes = bytes; return bytes; })
		.catch((e) => {
			console.warn('[skottie-stage-worker] sheet fetch failed', e);
			_sheetBytesPromise = null;
			return null;
		});
	return _sheetBytesPromise;
}

function pushSheetToShards(url) {
	ensureSheetBytes(url).then((bytes) => {
		if (!bytes) return;
		for (let i = 0; i < NUM_WORKERS; i++) {
			if (_sheetSentTo.has(i)) continue;
			_sheetSentTo.add(i);
			// Structured clone — each shard gets its own ArrayBuffer
			// copy. No transferable list (would invalidate the source
			// after first send). 2 MB × N shards is fine.
			postToShard(i, { type: 'load-sheet', bytes });
		}
	});
}

// Stable shard assignment: djb2 hash of the URL mod NUM_WORKERS. Same
// URL → same shard → same worker holds the cached animation, no
// duplicate builds across the pool.
function shardOf(url) {
	let s = _shardOfUrl.get(url);
	if (s !== undefined) return s;
	let h = 5381;
	for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
	s = Math.abs(h) % NUM_WORKERS;
	_shardOfUrl.set(url, s);
	return s;
}

function postToShard(shardIdx, msg, transfers) {
	const sh = shards[shardIdx];
	if (!sh) return;
	if (sh.ready) sh.worker.postMessage(msg, transfers || []);
	else sh.pendingMsgs.push([msg, transfers || []]);
}

function postToAllShards(msg) {
	for (let i = 0; i < shards.length; i++) postToShard(i, msg);
}

// ── Canvas host management ──────────────────────────────────────────────
function ensureShardCanvases() {
	if (shards.length === NUM_WORKERS) return;
	for (let i = 0; i < NUM_WORKERS; i++) {
		const staleId = `skottie-worker-stage-${i}`;
		const stale = document.getElementById(staleId);
		if (stale) stale.remove();
		const canvas = document.createElement('canvas');
		canvas.id = staleId;
		canvas.setAttribute('aria-hidden', 'true');
		shards.push({
			worker: null,
			canvas,
			ready: false,
			pendingMsgs: [],
			lastSentW: 0,
			lastSentH: 0
		});
	}
	repositionCanvases();
	window.addEventListener('resize', resizeCanvases);
}

function repositionCanvases() {
	if (!shards.length) return;
	// This module now renders exclusively through the inline-canvas path
	// (registerCanvasCell — each cell owns its own DOM canvas). The legacy
	// shared OVERLAY canvas is never drawn into here, so we deliberately
	// keep it OFF the DOM. Previously it was appended over the grid at
	// z-index 9999 and given a ResizeObserver; when the picker opened, the
	// observer fired, the worker recreated that overlay's WebGL surface,
	// and for one frame the (transparent-but-recreating) overlay covered
	// every cell — the "everything blinks out once at the start" artifact.
	// An off-DOM canvas can't cover anything. The worker still holds the
	// transferred OffscreenCanvas (handed over at init) but only uses its
	// separate scratch atlas; this overlay just sits inert.
	for (const sh of shards) {
		if (sh.canvas.parentNode) sh.canvas.parentNode.removeChild(sh.canvas);
		sh.canvas.style.cssText = 'display:none;';
	}
	if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
}

function resizeCanvases() {
	if (!shards.length) return;
	// Skip until we actually have a host (picker grid). During prewarm
	// the workers have booted but there's no scroll content yet —
	// resizing now would allocate big GPU surfaces at window size that
	// get destroyed the instant setHost arrives. Wait it out.
	if (!_scrollContent) return;
	const dpr = window.devicePixelRatio || 1;
	const w = _scrollContent.clientWidth;
	const h = _scrollContent.clientHeight;
	const targetW = Math.round(w * dpr);
	const targetH = Math.round(h * dpr);
	if (targetW < 2 || targetH < 2) return;
	for (const sh of shards) {
		if (sh.lastSentW === targetW && sh.lastSentH === targetH) continue;
		sh.lastSentW = targetW;
		sh.lastSentH = targetH;
		// Stash the CSS dimensions for THIS resize and post it to the
		// worker. The canvas's `style.width/height` stay at their old
		// values for now — the `surface-recreated` ack will apply the
		// new CSS dims once the worker's backbuffer is also at the new
		// size. Skipping that handshake is what made tab switches
		// briefly show stretched stale pixels (the browser scaling the
		// old backbuffer into the new CSS box). Now they're in lock.
		sh.pendingCssW = w;
		sh.pendingCssH = h;
		postToShard(shards.indexOf(sh), { type: 'resize', width: targetW, height: targetH });
	}
}

// ── Public API ──────────────────────────────────────────────────────────

// Boot the worker pool eagerly on page load so the user doesn't pay
// the ~150 ms CanvasKit-load latency the first time they open the
// picker. Safe to call from anywhere, idempotent — multiple callers
// share the same ensureStage() promise. Pass a `sheetUrl` to also
// kick off the sheet fetch + push to workers in parallel, so by the
// time the picker mounts the workers already have the sheet decoded.
export async function prewarm({ sheetUrl } = {}) {
	// Start the sheet fetch in PARALLEL with the worker boot. The
	// shard push has to wait for shards to exist (otherwise the loop
	// iterates 0 times and the sheet never reaches any worker), so we
	// only call pushSheetToShards AFTER ensureStage resolves — by
	// which point the fetch is usually already cached and the post
	// happens immediately.
	if (sheetUrl) ensureSheetBytes(sheetUrl);
	// Kick off the custom-pack manifest in parallel so we can also
	// push the adaptive-pack list + ink as soon as the workers are up.
	loadCustomPacks().then(() => pushAdaptiveToShards());
	await ensureStage();
	if (sheetUrl) pushSheetToShards(sheetUrl);
}

// Push the list of Telegram adaptive packs + the current --ink color
// to every shard. Workers tint matching Lotties in their build pump.
// Idempotent: safe to call before workers are ready (postToShard queues
// it) or repeatedly (workers just overwrite). Re-call this after a
// theme change to recolor newly-built animations.
let _adaptivePushed = false;
export function pushAdaptiveToShards() {
	const adaptive = getAdaptivePackList();
	const ink = getAdaptiveInk();
	if (!ink) return;
	_adaptivePushed = true;
	postToAllShards({ type: 'set-adaptive', adaptive, ink });
}

// Queue every animation URL for background building. Calls happen on
// workers via the existing idle-scheduled pump, so the main thread
// stays clear. Once the picker opens and cells start registering, the
// pump's priority queue automatically pivots to in-viewport cells
// first — see processQueue() in skottie-worker.js.
export async function prewarmAnimations(urls) {
	await ensureStage();
	for (const url of urls) {
		postToShard(shardOf(url), { type: 'load-anim', url });
	}
}

export function setHost(scrollContent, scrollViewport) {
	if (_scrollContent && _scrollContent !== scrollContent) {
		_scrollContent.style.willChange = '';
	}
	_scrollContent = scrollContent || null;
	_scrollViewport = scrollViewport || scrollContent || null;
	attachScrollListenerTo(_scrollViewport);
	for (const c of _cells.values()) c.firstPainted = false;
	if (shards.length) repositionCanvases();
}

export function ensureStage() {
	if (_ready) return _ready;
	_ready = (async () => {
		ensureShardCanvases();

		// Spin up workers in parallel — they boot independently. We
		// transferControlToOffscreen each canvas to its own worker.
		await Promise.all(shards.map(async (sh, i) => {
			const offscreen = sh.canvas.transferControlToOffscreen();
			sh.worker = new Worker(
				new URL('./skottie-worker.js', import.meta.url),
				{ type: 'module' }
			);
			sh.worker.addEventListener('message', (e) => onShardMessage(i, e));
				// fastHandoff: desktop settles animations in a couple of paints —
				// shorten the placeholder hold so first render feels instant
				// (mobile keeps the full hold-then-cross-fade contract).
				sh.worker.postMessage({ type: 'init', canvas: offscreen, fastHandoff: _FINE_POINTER }, [offscreen]);
			await new Promise((resolve, reject) => {
				const handler = (e) => {
					if (e.data.type === 'ready') {
						sh.worker.removeEventListener('message', handler);
						resolve();
					} else if (e.data.type === 'init-failed') {
						sh.worker.removeEventListener('message', handler);
						reject(new Error(`shard ${i}: ${e.data.error}`));
					}
				};
				sh.worker.addEventListener('message', handler);
			});
			sh.ready = true;
			for (const [m, t] of sh.pendingMsgs) sh.worker.postMessage(m, t);
			sh.pendingMsgs.length = 0;
		}));

		// All workers ready — force an initial resize so each gets the
		// real canvas dimensions in case nothing has changed since init.
		for (const sh of shards) { sh.lastSentW = 0; sh.lastSentH = 0; }
		resizeCanvases();
		startLoop();
		// Push the adaptive-pack list + ink color as soon as the
		// manifest resolves. We may already have it from a prewarm
		// call; either way this catches the case where the picker
		// mounts cold (no prewarm) and needs adaptive info before any
		// custom-pack URL hits the build pump.
		if (!_adaptivePushed) loadCustomPacks().then(() => pushAdaptiveToShards());
	})();
	return _ready;
}

function onShardMessage(shardIdx, e) {
	const msg = e.data;
	if (msg.type === 'first-paints') {
		// Worker confirms each of these cells has had its confirmed
		// canvas paints — safe to fade out the CSS backdrop. IDs may
		// belong to either the legacy overlay cells (_cells) or the
		// inline-canvas cells (_canvasCells); the two id spaces are
		// disjoint so a lookup miss in one just falls through.
		for (const id of msg.ids) {
			const c = _cells.get(id);
			if (c && !c.firstPainted) {
				c.firstPainted = true;
				c.onFirstPaint?.();
			}
			const cc = _canvasCells.get(id);
			if (cc) cc.onFirstPaint?.();
		}
	} else if (msg.type === 'surface-recreated') {
		// Backbuffer was just wiped + re-created (resize). Reset
		// firstPainted on this shard's cells so they redraw on the
		// next render. Fire onSurfaceLost so the CSS backdrop comes
		// back to cover the cell while the worker repopulates.
		for (const c of _cells.values()) {
			if (c.shardIdx !== shardIdx) continue;
			c.firstPainted = false;
			c.onSurfaceLost?.();
		}
		// Apply any deferred CSS dimensions the proxy was holding for
		// this shard. Doing it here, after the worker has finished
		// resizing its backbuffer, means the CSS box and the GPU
		// buffer are never out of sync — no stretched/squashed
		// stale pixels reach the screen.
		const sh = shards[shardIdx];
		if (sh && sh.pendingCssW != null && sh.canvas) {
			sh.canvas.style.width = sh.pendingCssW + 'px';
			sh.canvas.style.height = sh.pendingCssH + 'px';
			sh.pendingCssW = null;
			sh.pendingCssH = null;
		}
	} else if (msg.type === 'cleared') {
		// Worker confirmed it processed the clear (surface wiped).
		// Bring this shard's canvas back. CSS backdrop has been
		// covering the cells during the gap; the canvas is now blank
		// and ready to redraw the new tab as the next render frames
		// land. Decrement-then-restore so back-to-back clears
		// (rapid tab clicks) keep the canvas hidden until the very
		// last one is done.
		const sh = shards[shardIdx];
		if (sh) {
			sh.pendingClear = Math.max(0, (sh.pendingClear || 0) - 1);
			if (sh.pendingClear === 0 && sh.canvas) {
				sh.canvas.style.opacity = '';
			}
		}
	} else if (msg.type === 'anim-loaded') {
		_loadedUrls.add(msg.url);
	} else if (msg.type === 'anim-released') {
		// Fires only once refcount hits zero in the worker — i.e. the
		// animation is actually gone. Until that happens we want
		// isAnimationLoaded(url) to keep returning true.
		_loadedUrls.delete(msg.url);
	} else if (msg.type === 'diag') {
		// Forward the worker's diagnostic messages to the main console
		// with a shard prefix. The worker's own console context is
		// stashed behind a DevTools dropdown most folks never find;
		// this routes the same info to the top-level Console tab.
		const fn = console[msg.level] || console.log;
		fn.call(console, `[shard ${shardIdx}]`, ...msg.args);
	}
}

// `data` accepted for API parity with skottie-stage.js — worker fetches
// its own copy to avoid a 100 KB+ structured clone per emoji.
export async function loadAnimation(url, _data, _getRect) {
	await ensureStage();
	postToShard(shardOf(url), { type: 'load-anim', url });
}

export function releaseAnimation(url) {
	// Don't touch `_loadedUrls` here — the worker decrements its own
	// refcount and only fires 'anim-released' back to us once it's
	// actually thrown the animation out. That's the right moment to
	// clear our cache. Premature deletion here would race: cell B may
	// still be sharing this URL and need `isAnimationLoaded(url)` to
	// keep returning true.
	postToShard(shardOf(url), { type: 'release-anim', url });
}

export function isAnimationLoaded(url) {
	return _loadedUrls.has(url);
}

export function registerCell({
	url, getRect, paused = false, paintIndex = null,
	loop = true, onFirstPaint = null, onSurfaceLost = null, thumbInfo = null,
	// Default to INVISIBLE. Callers that know the cell is in the
	// viewport at register time (eager tab icons, or a SpriteSticker
	// whose IO observer has already fired) should pass `visible: true`
	// explicitly. The previous default-true behaviour meant every
	// mounted cell — including ones in warmed-but-offscreen sections —
	// got rect-checked every frame by the render loop, which thrashed
	// layout and starved the actually-visible cells of paint budget.
	visible = false
}) {
	const shardIdx = shardOf(url);
	// Bring this shard's canvas to the top of the scroll content's
	// child stack — see skottie-stage.js for the rationale. Idempotent
	// move-to-last on appendChild.
	const sh = shards[shardIdx];
	if (sh && sh.canvas && _scrollContent && sh.canvas.parentNode === _scrollContent) {
		_scrollContent.appendChild(sh.canvas);
	}
	const id = _nextCellId++;
	_cells.set(id, {
		url, getRect, paused, paintIndex, loop, onFirstPaint, onSurfaceLost, thumbInfo,
		visible: !!visible,
		firstPainted: false,
		shardIdx
	});
	postToShard(shardIdx, {
		type: 'register-cell',
		id, url, paused, paintIndex, loop, thumbInfo,
		visible: !!visible
	});
	// First cell with a sheet URL kicks off the one-time main-thread
	// fetch and the per-shard sheet push. Subsequent calls are no-ops
	// (sheet already fetched or already sent to each shard).
	if (thumbInfo?.sheetUrl) pushSheetToShards(thumbInfo.sheetUrl);
	return id;
}

export function setCellVisible(id, v) {
	const c = _cells.get(id);
	if (!c) return;
	c.visible = !!v;
	postToShard(c.shardIdx, { type: 'set-visible', id, visible: !!v });
}

export function unregisterCell(id) {
	const c = _cells.get(id);
	if (!c) return;
	_cells.delete(id);
	postToShard(c.shardIdx, { type: 'unregister-cell', id });
}

// ── Inline-canvas path API ───────────────────────────────────────────────
// The presence of these exports is what SpriteSticker feature-detects to
// choose the no-lag per-cell path over the legacy overlay. `canvas` is an
// OffscreenCanvas the caller produced via transferControlToOffscreen() on
// its inline <canvas>; we transfer it to the single render worker, which
// owns it for the rest of the cell's life and blits animation frames into
// it. IDs are offset into a disjoint range so they never collide with the
// overlay path's _cells ids when first-paint acks come back.
export function registerCanvasCell({
	url, canvas, w, h, paused = false, paintIndex = null,
	loop = true, visible = false, rasterized = false, fpsScale = 1, onFirstPaint = null
}) {
	const id = 1_000_000_000 + (_nextCanvasCellId++);
	// Route to the shard that owns this URL — same shard builds AND renders
	// it, so the cached animation (and rasterized frame cache) is shared with
	// any other cell of the same emoji and builds spread across the pool.
	const shardIdx = shardOf(url);
	_canvasCells.set(id, { onFirstPaint, url, shardIdx });
	postToShard(shardIdx, {
		type: 'register-canvas-cell',
		id, url, w, h, paused, paintIndex, loop, visible, rasterized, fpsScale, canvas
	}, [canvas]);
	return id;
}

export function setCanvasCellVisible(id, v) {
	const c = _canvasCells.get(id);
	if (!c) return;
	postToShard(c.shardIdx, { type: 'set-canvas-visible', id, visible: !!v });
}

export function unregisterCanvasCell(id) {
	const c = _canvasCells.get(id);
	if (!c) return;
	_canvasCells.delete(id);
	postToShard(c.shardIdx, { type: 'unregister-canvas-cell', id });
}

// Wipe all shard canvases and reset every cell so they re-draw on the
// next frame. Used on picker tab switches. Sprites are always visible,
// so we don't need to coordinate any DOM-level hiding here — the worker
// processes the clear, the surface goes blank, and as new cells start
// painting their pixels appear over the (still-visible) sprite thumbs.
export function clearCanvas() {
	// Hide each shard's canvas the instant we post `clear`. The
	// worker might be busy (animation build, message backlog) and not
	// process the clear right away; without hiding, the compositor
	// keeps showing the previous tab's pixels (often stretched if the
	// grid resized too) until the worker catches up. The CSS backdrop
	// sits underneath and stays visible the whole time, so users see
	// the new tab's sprite thumbs cleanly with no stale overlay.
	for (const sh of shards) {
		sh.pendingClear = (sh.pendingClear || 0) + 1;
		if (sh.canvas) sh.canvas.style.opacity = '0';
	}
	postToAllShards({ type: 'clear' });
	// Reset firstPainted AND tell each cell its canvas was wiped so
	// the SpriteSticker brings the CSS backdrop back to cover the
	// cell. The next paint cycle will signal onFirstPaint again to
	// hide it.
	for (const c of _cells.values()) {
		c.firstPainted = false;
		c.onSurfaceLost?.();
	}
	// Force the next sendRenderFrame to actually post — the rAF
	// throttle was tracking "we just rendered, skip this tick", but we
	// need a fresh render through the new state ASAP.
	_lastRenderTime = 0;
}

// ── rAF loop on main thread ─────────────────────────────────────────────
function startLoop() {
	if (_running) return;
	_running = true;
	const tick = (now) => {
		if (!_running) return;
		// Legacy overlay path. Skip ENTIRELY unless overlay cells exist —
		// for the inline-canvas (worker) engine it's dead code, yet it did
		// forced layout reads (resizeCanvases -> clientWidth/Height,
		// getBoundingClientRect) every frame ON THE MAIN THREAD. Running it
		// for nothing was a per-frame main-thread reflow -> UI jank, the
		// exact lag the worker/offscreen design exists to avoid.
		if (_cells.size) sendRenderFrame(now);
		// Inline-canvas path: hand the worker a timestamp. All rendering +
		// blitting happens off-thread; no DOM reads here. Cap the tick at
		// ~32 fps (matching the legacy WorkerGPU cadence) — sticker
		// animations are 30–60 fps source, so a higher rate just doubles
		// the worker's render+readback load and, if a frame overruns
		// 16 ms, backs the loop up and DROPS effective fps. Throttling
		// keeps each frame inside budget so it stays smooth.
		// Tick every frame (~60 fps). The worker's per-cell frame-skip means
		// each animation only redraws when its frame index advances, so a
		// 30 fps source redraws ~30x/s and a 60 fps source ~60x/s, each as
		// smooth as its source allows, with no global cap flattening the fast
		// ones. Rasterized playback is a cheap atlas blit at this rate.
		if (_canvasCells.size) {
			// Each shard renders only the canvas-cells it owns (no-op if it
			// owns none), so a broadcast tick is correct and cheap.
			postToAllShards({ type: 'tick', now });
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function sendRenderFrame(now) {
	if (!shards.length) return;
	// While scrolling we must render EVERY frame. The canvas is pinned
	// to the viewport (it no longer scrolls with the content), so any
	// frame we skip leaves every sprite frozen at its previous on-screen
	// position while the page scrolls on underneath — the cells visibly
	// lag behind and then snap. The old every-3rd-frame / skip-fast-scroll
	// throttle was only safe back when the canvas scrolled with content
	// and the compositor moved it for free. When idle (not scrolling) we
	// still cap at ~30fps to save battery on continuous animation.
	if (!_isScrolling) {
		if (now - _lastRenderTime < TARGET_FPS_INTERVAL_MS) return;
	}
	_lastRenderTime = now;
	resizeCanvases();

	// Did the content scroll under the (viewport-pinned) canvas since the
	// last render? If so the worker must wipe the whole surface this
	// frame so cells don't smear a trail at their vacated positions.
	const scrollTopNow = _scrollViewport ? _scrollViewport.scrollTop : 0;
	const scrolled = scrollTopNow !== _lastRenderScrollTop;
	_lastRenderScrollTop = scrollTopNow;

	const dpr = window.devicePixelRatio || 1;
	// Each shard's canvas has the same rect (they're stacked + sized
	// identically), so we measure once from shard 0.
	const canvasRect = shards[0].canvas.getBoundingClientRect();
	const viewRect = _scrollViewport
		? _scrollViewport.getBoundingClientRect()
		: { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

	// Bucket cells by shard. Cheap — Map iteration + array push.
	const buckets = Array.from({ length: NUM_WORKERS }, () => []);
	for (const [id, cell] of _cells) {
		if (!cell.visible) continue;
		const r = cell.getRect?.();
		if (!r || r.width === 0 || r.height === 0) continue;
		buckets[cell.shardIdx].push({
			id,
			rect: {
				left: r.left, top: r.top, right: r.right, bottom: r.bottom,
				width: r.width, height: r.height
			}
		});
	}

	const viewRectMsg = {
		left: viewRect.left, top: viewRect.top,
		right: viewRect.right, bottom: viewRect.bottom
	};
	const canvasRectMsg = {
		left: canvasRect.left, top: canvasRect.top,
		right: canvasRect.right, bottom: canvasRect.bottom
	};

	for (let i = 0; i < NUM_WORKERS; i++) {
		// Normally skip shards with nothing to draw. But when scrolled,
		// a shard that just emptied (its last cells scrolled off) still
		// holds their stale pixels — post an empty render so it gets the
		// full-surface clear too.
		if (buckets[i].length === 0 && !scrolled) continue;
		shards[i].worker?.postMessage({
			type: 'render',
			now,
			scrolled,
			viewRect: viewRectMsg,
			canvasRect: canvasRectMsg,
			cellRects: buckets[i],
			dpr
		});
	}
}
