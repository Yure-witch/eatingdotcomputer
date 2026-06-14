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
			const handoffAt = (cell.prebuilt || isAdaptive) ? 1 : 12;
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
		// ── Inline-canvas path ──────────────────────────────────────────
		case 'register-canvas-cell': {
			let ctx = null;
			// bitmaprenderer = zero-copy sink for transferFromImageBitmap.
			try { ctx = msg.canvas.getContext('bitmaprenderer'); } catch { /* transfer failed */ }
			// If the animation is ALREADY built when this cell mounts, it's a
			// re-entry (the user scrolled this section back into view) — the
			// animation is mid-cycle and stable, so there are no settling
			// frames to hide and we can hand the placeholder off on paint 1.
			// Only a first-time build needs the multi-frame hold.
			const _built = _anims.has(msg.url) && (_anims.get(msg.url).duration > 0);
			_canvasCells.set(msg.id, {
				ctx,
				off: msg.canvas,
				url: msg.url,
				paused: !!msg.paused,
				loop: msg.loop !== false,
				paintIndex: msg.paintIndex ?? null,
				w: msg.w,
				h: msg.h,
				visible: !!msg.visible,
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
			if (c) c.visible = !!msg.visible;
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
