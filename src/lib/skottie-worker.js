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

let _kit = null;
let _canvas = null; // OffscreenCanvas
let _surface = null;

// Set by the proxy's `init` message. When `true` we try to create a
// WebGPU surface first; on any failure we transparently fall back to
// the WebGL path so the same worker code handles both engines.
let _preferWebGPU = false;
let _gpuDevCtx = null;     // CanvasKit WebGPUDeviceContext
let _gpuCanvasCtx = null;  // CanvasKit WebGPUCanvasContext

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
const _cells = new Map();   // id  -> per-cell state
let _sheetImage = null;
let _imagePaint = null;

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

// Stage 1 (async, one-shot): grab the WebGPU device + canvas context.
// Done lazily so the WebGL path pays no cost. If anything fails or
// WebGPU isn't supported, we permanently flip _preferWebGPU = false
// and subsequent surface creates use the WebGL path.
async function ensureGpuContext() {
	if (!_preferWebGPU) return false;
	if (_gpuDevCtx && _gpuCanvasCtx) return true;
	if (!self.navigator?.gpu) {
		diag('warn', '[skottie-worker] navigator.gpu missing — falling back to WebGL');
		_preferWebGPU = false;
		return false;
	}
	try {
		if (!_gpuDevCtx) {
			const adapter = await self.navigator.gpu.requestAdapter();
			if (!adapter) throw new Error('no GPU adapter');
			const device = await adapter.requestDevice();
			_gpuDevCtx = _kit.MakeGPUDeviceContext(device);
			if (!_gpuDevCtx) throw new Error('MakeGPUDeviceContext returned null');
		}
		if (!_gpuCanvasCtx) {
			_gpuCanvasCtx = _kit.MakeGPUCanvasContext(_gpuDevCtx, _canvas);
			if (!_gpuCanvasCtx) throw new Error('MakeGPUCanvasContext returned null');
		}
		diag('log', '[skottie-worker] WebGPU context ready');
		return true;
	} catch (e) {
		diag('warn', '[skottie-worker] WebGPU init failed —', String(e?.message || e), '— falling back to WebGL');
		_gpuCanvasCtx = null;
		_gpuDevCtx = null;
		_preferWebGPU = false;
		return false;
	}
}

// Stage 2 (sync): create a surface using whichever backend is set up.
// `MakeGPUCanvasSurface` is sync after the device/context are cached,
// so we can call this from the render self-heal as well.
function createSurfaceSync() {
	if (!_kit || !_canvas) return null;
	if (_preferWebGPU && _gpuCanvasCtx) {
		const surface = _kit.MakeGPUCanvasSurface(_gpuCanvasCtx, null);
		if (surface) return surface;
		diag('warn', '[skottie-worker] MakeGPUCanvasSurface returned null — falling back to WebGL');
	}
	return _kit.MakeWebGLCanvasSurface(_canvas, undefined, _surfaceOpts);
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
		// Priority 2: cell inside viewport (sub-sorted by reading order).
		// Priority 1: cell off-screen but has a known rect.
		// Priority 0: no rect at all.
		let bestUrl = null;
		let bestPri = -1;
		let bestScore = Infinity;
		for (const [url] of _pending) {
			let pri = 0;
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
		_surface = createSurfaceSync();
		if (_surface) {
			diag('log', '[skottie-worker] surface self-heal succeeded at', _canvas.width, 'x', _canvas.height);
			for (const c of _cells.values()) { c.firstPainted = false; c.paintCount = 0; }
		} else {
			diag('warn', '[skottie-worker] surface self-heal failed at', _canvas.width, 'x', _canvas.height);
		}
	}
	if (!_surface) return null;
	const { now, viewRect, canvasRect, cellRects, dpr } = msg;
	_lastViewRect = viewRect;

	const sk = _surface.getCanvas();
	let drewAny = false;
	const firstPaints = [];

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
			cell.startTime = now;
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
			const handoffAt = isAdaptive ? 1 : 15;
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
			_preferWebGPU = !!msg.preferWebGPU;
			diag('log', '[skottie-worker] init: canvas size', _canvas.width, 'x', _canvas.height, 'preferWebGPU:', _preferWebGPU);
			try {
				await loadKit();
				// Bring up the WebGPU device + canvas context now (if
				// requested) so the first `resize` can synchronously
				// allocate a surface without the user perceiving the
				// init latency. Falls back to WebGL on failure.
				if (_preferWebGPU) await ensureGpuContext();
				diag('log', '[skottie-worker] CanvasKit loaded — surface deferred until first resize');
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
			_surface = createSurfaceSync();
			if (!_surface) {
				diag('warn', '[skottie-worker] resize: surface creation returned null (', width, 'x', height, ') — will self-heal on next render');
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
				visible: true,
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
			if (inkChanged && prevInk) {
				// Drop cached animations for adaptive URLs so the build
				// pump rebuilds them in the new ink. Cells stay alive —
				// they'll briefly fall back to the sprite thumb until the
				// new animation finishes building (idle-scheduled).
				let dropped = 0;
				for (const [url, entry] of _anims) {
					const short = shortFromUrl(url);
					if (!short || !_adaptive.has(short)) continue;
					try { entry.animation.delete(); } catch {}
					_anims.delete(url);
					// Re-queue with the old refcount so cells stay bound.
					_pending.set(url, { dataPromise: fetchLottieWorker(url), refcount: entry.refcount });
					_lottieCache.delete(url);
					dropped++;
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
