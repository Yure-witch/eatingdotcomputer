// Shared CanvasKit/Skottie stage.
//
// Architecture: one big WebGL Skia canvas mounted INSIDE the host's
// scroll content. We render BOTH the thumb sprites AND the animations
// to this same canvas — so there's only ever one compositor layer
// holding all the visible cell content. The canvas being on its own
// compositor layer doesn't matter for alignment any more because there's
// no other layer to drift against; everything visible inside the picker
// grid is on this canvas, scrolling together as a single unit.
//
// Cells register with both their animation URL AND their position in
// the thumb sprite sheet. The render loop draws the thumb sub-rect for
// cells whose animation isn't loaded yet, and the live animation frame
// for cells whose animation is loaded. The transition is seamless
// because both draw to the same tile at the same coordinates.
//
// `setHost(scrollContent, scrollViewport)`:
//   - scrollContent is where the canvas lives (e.g. the picker's
//     `.tg-grid` element). The canvas is sized to its `scrollWidth ×
//     scrollHeight` so it covers every cell, on-screen or not.
//   - scrollViewport is the parent with `overflow:auto` (`.tg-grid-wrap`).
//     The render loop uses it to cull cells that aren't currently
//     visible so we don't waste GPU cycles on off-screen animations.
//
// Animations are cached by URL and refcounted; if 50 cells show the same
// emoji we only allocate one SkottieAnimation in WASM and seek+render it
// per cell per frame.

import { loadCanvasKit } from './canvaskit-loader.js';

// Velocity-aware scroll throttle. Tracks scroll velocity (px/ms) from
// consecutive scroll events, and gates the render loop accordingly:
//   - fast scroll (> FAST_PX_PER_MS) → animations PAUSE entirely
//   - slow scroll                    → render every Nth frame (~20 fps)
//   - settled                        → full 60 fps, snaps back the
//     moment the scroll stops.
let _isScrolling = false;
let _scrollResetTimer = null;
let _scrollFrameCount = 0;
let _loggedAnyAnim = false;
let _lastScrollPos = 0;
let _lastScrollTime = 0;
let _scrollVelocityPxMs = 0;
let _lastRenderTime = 0;
const SCROLL_SLOW_RENDER_EVERY = 3; // ~20 fps while slowly scrolling
const FAST_PX_PER_MS = 1.5;         // threshold for "fast = pause"
const SCROLL_SETTLE_MS = 110;
const TARGET_FPS_INTERVAL_MS = 31;  // ~30 fps, with -2 ms tolerance vs 33.3
// Cells within this CSS-pixel buffer above/below the viewport still get
// their tile painted (one time, then skipped) so when the user scrolls
// back to them they're already showing their last-known frame instead
// of being transparent. Cells OUTSIDE this zone are skipped entirely —
// they don't get any per-frame work, so this also caps how much we do
// per render. ~10 rows of 36 px cells.
const PAINT_BUFFER_PX = 360;
let _attachedScrollEl = null;
function markScrolling() {
	_isScrolling = true;
	if (_attachedScrollEl) {
		const now = performance.now();
		const pos = _attachedScrollEl.scrollTop;
		const dt = now - _lastScrollTime;
		// Only compute velocity if we have a prior sample (dt valid).
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

let _canvas = null;
let _kit = null;
let _surface = null;
let _ready = null;
let _running = false;
let _nextCellId = 1;
let _hadVisible = false;
let _scrollContent = null;
let _scrollViewport = null;
let _resizeObserver = null;
const _cells = new Map();
const _anims = new Map();

// Cached Skia Image of the thumb sprite sheet, used to draw cell
// placeholders directly onto the stage canvas so cells without a loaded
// animation still show something — and stay in perfect lockstep with
// animated cells during scroll since they're on the same canvas layer.
let _sheetImage = null;
let _sheetUrl = null;
let _sheetLoading = false;
let _imagePaint = null;

async function ensureSheetImage(url) {
	if (!url || !_kit) return null;
	if (_sheetImage && _sheetUrl === url) return _sheetImage;
	if (_sheetLoading) return null;
	_sheetUrl = url;
	_sheetLoading = true;
	try {
		const response = await fetch(url);
		const bytes = await response.arrayBuffer();
		const img = _kit.MakeImageFromEncoded(new Uint8Array(bytes));
		if (!img) {
			console.warn('[skottie-stage] MakeImageFromEncoded returned null — sheet image format may not be supported by this CanvasKit build (WebP needs the full build)');
		}
		_sheetImage = img;
		return img;
	} catch (e) {
		console.warn('[skottie-stage] sheet image load failed', e);
		return null;
	} finally {
		_sheetLoading = false;
	}
}

// Pass `null` for both to detach (used when the picker unmounts).
export function setHost(scrollContent, scrollViewport) {
	if (_scrollContent && _scrollContent !== scrollContent) {
		_scrollContent.style.willChange = '';
	}
	_scrollContent = scrollContent || null;
	_scrollViewport = scrollViewport || scrollContent || null;
	attachScrollListenerTo(_scrollViewport);
	// Reset per-cell first-paint state so cells re-trigger their
	// onFirstPaint after the host swap — and clear the canvas so any
	// pixels rendered against the previous host don't bleed through.
	for (const c of _cells.values()) c.firstPainted = false;
	if (_surface && _kit) {
		const sk = _surface.getCanvas();
		sk.clear(_kit.TRANSPARENT);
		_surface.flush();
	}
	if (_canvas) repositionCanvas();
}

function ensureCanvasEl() {
	if (_canvas) return;
	const stale = document.getElementById('skottie-stage');
	if (stale) stale.remove();
	_canvas = document.createElement('canvas');
	_canvas.id = 'skottie-stage';
	_canvas.setAttribute('aria-hidden', 'true');
	repositionCanvas();
	window.addEventListener('resize', resizeCanvas);
}

function repositionCanvas() {
	if (!_canvas) return;
	if (_scrollContent) {
		const cs = getComputedStyle(_scrollContent);
		if (cs.position === 'static') _scrollContent.style.position = 'relative';
		if (_canvas.parentNode !== _scrollContent) _scrollContent.appendChild(_canvas);
		// `display:block` so the canvas takes its computed positioned
		// size instead of inline-baseline weirdness; everything else
		// keeps it as a plain absolute-positioned child of the scroll
		// content (no compositor-layer hints — those were breaking
		// position calculation: cells thought the canvas was at one
		// viewport position but the compositor was drawing the pixels
		// at another).
		_canvas.style.cssText =
			'position:absolute;top:0;left:0;display:block;pointer-events:none;';
		if (_resizeObserver) _resizeObserver.disconnect();
		_resizeObserver = new ResizeObserver(resizeCanvas);
		_resizeObserver.observe(_scrollContent);
	} else {
		// No host (e.g., picker closed) — park the canvas off-DOM and
		// clear it so its pixels don't visibly persist somewhere. Also
		// clear all registered cells; they'll re-register when their
		// component re-mounts with a fresh host.
		if (_canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
		_canvas.style.cssText = 'display:none;';
		if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
		if (_surface && _kit) {
			const sk = _surface.getCanvas();
			sk.clear(_kit.TRANSPARENT);
			_surface.flush();
		}
	}
	resizeCanvas();
}

function resizeCanvas() {
	if (!_canvas) return;
	const dpr = window.devicePixelRatio || 1;
	let w, h;
	if (_scrollContent) {
		// Use clientWidth/clientHeight, NOT scrollWidth/scrollHeight:
		// the canvas (an absolutely-positioned child) shows up in its
		// parent's scrollWidth/scrollHeight if it extends past the
		// content. Reading scroll* and writing it back creates a
		// runaway feedback loop where the canvas inflates the parent's
		// scroll dimensions, which the next resize reads, etc. — the
		// canvas ends up multiple times wider/taller than the grid and
		// the page scrolls way past its actual content.
		// clientWidth/clientHeight reflect only the element's own
		// laid-out content (the cells), which is exactly the area the
		// canvas needs to cover.
		w = _scrollContent.clientWidth;
		h = _scrollContent.clientHeight;
		_canvas.style.width = w + 'px';
		_canvas.style.height = h + 'px';
	} else {
		w = window.innerWidth; h = window.innerHeight;
	}
	const targetW = Math.round(w * dpr);
	const targetH = Math.round(h * dpr);
	// Don't try to resize to zero — happens during tab transitions
	// when the old grid has unmounted and the new one hasn't laid
	// out yet. Just keep the previous surface; the next resize
	// (after the new content lays out) will pick up real dimensions.
	if (targetW < 2 || targetH < 2) return;
	if (_canvas.width === targetW && _canvas.height === targetH) return;
	_canvas.width = targetW;
	_canvas.height = targetH;
	if (_kit) {
		try { _surface?.delete(); } catch {}
		_surface = _kit.MakeWebGLCanvasSurface(_canvas);
		// All pixels are gone after the surface recreation — flag every
		// registered cell as un-painted so it gets a fresh thumb/anim
		// draw on the next frame.
		for (const c of _cells.values()) c.firstPainted = false;
	}
}

export function ensureStage() {
	if (_ready) return _ready;
	_ready = (async () => {
		ensureCanvasEl();
		_kit = await loadCanvasKit();
		_surface = _kit.MakeWebGLCanvasSurface(_canvas);
		if (!_surface) throw new Error('skottie-stage: WebGL surface unavailable');
		startLoop();
	})();
	return _ready;
}

// Queue of (url → { data, getRect, refcount }) for animations that have
// been requested but not yet built. The pump processes one at a time:
//   - it picks the entry whose cell is currently inside the scroll
//     viewport (visible cells get loaded first)
//   - if the cell scrolled away and refcount dropped to 0, the entry was
//     already removed and the load is effectively cancelled
//   - between loads we yield via setTimeout(0) so a burst of cells
//     can't lock up the main thread with back-to-back WASM calls.
const _pendingLoads = new Map();
let _processing = false;
let _pumpScheduled = false;

function schedulePump() {
	if (_pumpScheduled || _processing) return;
	_pumpScheduled = true;
	// Use requestIdleCallback so animation building happens only in
	// real idle gaps between rAF render frames. Each
	// MakeManagedAnimation call is a synchronous WASM call that can
	// take 30–60 ms; without this, builds blow out the frame budget
	// and the page drops to ~18 fps. With idle scheduling, the
	// browser holds them until it has spare main-thread time. The
	// timeout ensures progress even when the browser never goes idle
	// (e.g. continuous scroll).
	const schedule = (typeof requestIdleCallback === 'function')
		? (cb) => requestIdleCallback(cb, { timeout: 200 })
		: (cb) => setTimeout(cb, 0);
	schedule(() => { _pumpScheduled = false; processQueue(); });
}

async function processQueue() {
	if (_processing) return;
	_processing = true;
	while (_pendingLoads.size) {
		// Find the next pending entry to process.
		//   Priority 2: cell is inside the scroll viewport.
		//   Priority 1: cell has a valid rect but is off-screen.
		//   Priority 0: no rect (unmounted or never measured).
		// Within priority 2, sort by reading order — top-left cell of
		// the viewport goes first, then sweep across the row, then the
		// next row, etc. The score is `relTop * 10000 + relLeft`, so
		// cells higher up always beat cells lower down regardless of
		// horizontal position, and within a row leftmost wins.
		const viewRect = _scrollViewport ? _scrollViewport.getBoundingClientRect() : null;
		let bestUrl = null;
		let bestPri = -1;
		let bestScore = Infinity;
		for (const [url, info] of _pendingLoads) {
			let pri = 0;
			let score = Infinity;
			const r = info.getRect && info.getRect();
			if (r && r.width > 0) {
				pri = 1;
				if (viewRect) {
					const inView = !(
						r.right < viewRect.left || r.bottom < viewRect.top
						|| r.left > viewRect.right || r.top > viewRect.bottom
					);
					if (inView) {
						pri = 2;
						// Clamp negative offsets (cell partly off the
						// top/left edge) to 0 so partially-visible cells
						// at the edges still win over fully-in-view ones
						// lower down.
						const relTop = Math.max(0, r.top - viewRect.top);
						const relLeft = Math.max(0, r.left - viewRect.left);
						score = relTop * 10000 + relLeft;
					}
				}
			}
			if (pri > bestPri || (pri === bestPri && score < bestScore)) {
				bestPri = pri;
				bestScore = score;
				bestUrl = url;
			}
		}
		if (bestUrl == null) break;
		const pending = _pendingLoads.get(bestUrl);
		_pendingLoads.delete(bestUrl);

		try {
			const animation = _kit?.MakeManagedAnimation
				? _kit.MakeManagedAnimation(JSON.stringify(pending.data))
				: _kit?.MakeAnimation(JSON.stringify(pending.data));
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
			}
		} catch (e) {
			console.warn('[skottie-stage] anim load failed', bestUrl, e);
		}

		// Yield via requestIdleCallback so we only build the next
		// animation when the browser has idle time again.
		const yieldIdle = (typeof requestIdleCallback === 'function')
			? () => new Promise((r) => requestIdleCallback(r, { timeout: 200 }))
			: () => new Promise((r) => setTimeout(r, 0));
		await yieldIdle();
	}
	_processing = false;
}

export async function loadAnimation(url, data, getRect) {
	await ensureStage();
	let entry = _anims.get(url);
	if (entry) { entry.refcount++; return; }
	let pending = _pendingLoads.get(url);
	if (pending) {
		pending.refcount++;
		return;
	}
	_pendingLoads.set(url, { data, getRect: getRect || null, refcount: 1 });
	schedulePump();
}

export function releaseAnimation(url) {
	// Pending side first — if the load hasn't started yet, drop the
	// refcount and (when it hits 0) cancel by removing the entry.
	const pending = _pendingLoads.get(url);
	if (pending) {
		pending.refcount--;
		if (pending.refcount <= 0) _pendingLoads.delete(url);
		return;
	}
	const entry = _anims.get(url);
	if (!entry) return;
	entry.refcount--;
	if (entry.refcount <= 0) {
		try { entry.animation.delete(); } catch {}
		_anims.delete(url);
	}
}

// Wipe every pixel on the surface AND reset every registered cell's
// firstPainted flag so they re-draw their thumb/anim from scratch on
// the next render. Used when the picker switches tabs — without this,
// pixels from the old tab linger anywhere the new tab has fewer cells
// (or none) at that grid position.
export function clearCanvas() {
	if (_surface && _kit) {
		const sk = _surface.getCanvas();
		sk.clear(_kit.TRANSPARENT);
		_surface.flush();
	}
	for (const c of _cells.values()) {
		c.firstPainted = false;
		c.wasOnScreen = false;
		c.animationStarted = false;
	}
	// Bypass the 30-fps throttle for the very next rAF tick so the
	// cleared surface gets repainted ASAP rather than waiting up to 33
	// ms for the throttle window to roll over.
	_lastRenderTime = 0;
}

// True iff the animation has been fully built and is sitting in `_anims`.
// SpriteSticker uses this to decide whether to cancel a pending load
// when the cell scrolls off-screen (cancel) vs leave a loaded one alone
// (keep it; it'll just stop animating until the cell comes back).
export function isAnimationLoaded(url) {
	return _anims.has(url);
}

export function registerCell({ url, getRect, paused = false, paintIndex = null, loop = true, onFirstPaint = null, thumbInfo = null }) {
	// Bring our canvas to the top of the scroll content's child stack
	// so it draws over any sibling stage canvas (e.g. when the user
	// toggles between GPU and WorkerGPU, the engine that just gained a
	// cell needs to be visually on top). appendChild on an existing
	// child re-orders it to last — cheap, idempotent.
	if (_canvas && _scrollContent && _canvas.parentNode === _scrollContent) {
		_scrollContent.appendChild(_canvas);
	}
	const id = _nextCellId++;
	_cells.set(id, {
		url, getRect, paused, paintIndex, loop, onFirstPaint, thumbInfo,
		firstPainted: false,
		wasOnScreen: false,
		// `animationStarted` flips true the first time we reset
		// startTime to play this cell's animation from frame 0. We only
		// do that ONCE per cell — on subsequent scroll-out / scroll-back
		// cycles we don't reset, so the next paint shows whatever frame
		// the animation clock is currently at (almost always non-blank).
		// Without this, intro-style emoji (frame 0 = empty) would flash
		// transparent on every re-entry into the viewport.
		animationStarted: false,
		startTime: performance.now(),
		visible: true
	});
	// Kick off sheet image loading on first cell that has thumb info.
	// Subsequent cells reuse the cached Skia Image.
	if (thumbInfo?.sheetUrl) ensureSheetImage(thumbInfo.sheetUrl);
	return id;
}

export function setCellVisible(id, v) {
	const c = _cells.get(id);
	if (c) c.visible = !!v;
}

export function unregisterCell(id) {
	_cells.delete(id);
}

function startLoop() {
	if (_running) return;
	_running = true;
	const tick = (now) => {
		if (!_running) return;
		renderFrame(now);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function renderFrame(now) {
	if (!_surface || !_kit) return;
	// Throttle:
	//   fast scroll → pause (no render)
	//   slow scroll → ~20 fps (every Nth rAF tick)
	//   settled     → cap at ~30 fps via time delta. 30 fps is plenty
	//     for emoji animations and halves the per-frame Skia work
	//     compared to running at the display's 60/120 Hz rAF rate.
	if (_isScrolling) {
		if (_scrollVelocityPxMs > FAST_PX_PER_MS) return;
		_scrollFrameCount++;
		if (_scrollFrameCount % SCROLL_SLOW_RENDER_EVERY !== 0) return;
	} else {
		if (now - _lastRenderTime < TARGET_FPS_INTERVAL_MS) return;
	}
	_lastRenderTime = now;
	resizeCanvas();
	const dpr = window.devicePixelRatio || 1;
	// In host mode the canvas IS inside the scroll content — its
	// `getBoundingClientRect()` changes with scroll, and so do the
	// cells. Their difference is constant (= each cell's offset within
	// the scroll content), which is exactly what we want: the painted
	// tile stays put relative to the cell while everything scrolls
	// together via the compositor.
	const canvasRect = _canvas.getBoundingClientRect();
	// Only cells inside the scroll viewport are worth drawing. The
	// canvas memory holds the last frame for cells that have scrolled
	// off; that frame reappears intact when they scroll back in.
	const viewRect = _scrollViewport
		? _scrollViewport.getBoundingClientRect()
		: { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
	const sk = _surface.getCanvas();
	let drewAny = false;
	for (const cell of _cells.values()) {
		if (!cell.visible) continue;
		const entry = _anims.get(cell.url);
		if ((!entry || entry.duration === 0) && !cell.thumbInfo) continue;
		const rect = cell.getRect();
		if (!rect || rect.width === 0 || rect.height === 0) continue;

		const inViewport = !(
			rect.right < viewRect.left || rect.bottom < viewRect.top
			|| rect.left > viewRect.right || rect.top > viewRect.bottom
		);
		// Buffer zone of PAINT_BUFFER_PX above/below/left/right of the
		// viewport. Cells inside this zone get their tile painted
		// (one time, then skipped) so a quick scroll-back to them
		// shows their last-known frame instead of transparent.
		const inPaintZone = !(
			rect.right < viewRect.left - PAINT_BUFFER_PX
			|| rect.bottom < viewRect.top - PAINT_BUFFER_PX
			|| rect.left > viewRect.right + PAINT_BUFFER_PX
			|| rect.top > viewRect.bottom + PAINT_BUFFER_PX
		);
		const justEntered = inViewport && !cell.wasOnScreen;
		cell.wasOnScreen = inViewport;

		// Outside the paint zone entirely: no per-frame work at all.
		// Cell keeps whatever pixels were last painted on the canvas
		// (or none if it never was). Saves us from iterating every
		// possible cell in a huge category every frame.
		if (!inPaintZone) continue;

		// Inside paint zone but already painted and not in the
		// viewport: keep the last-known frame, skip drawing.
		if (cell.firstPainted && !inViewport) continue;

		const hasAnim = !!(entry && entry.duration > 0);
		// Only viewport cells animate. Buffer-zone cells get a single
		// thumb paint and then sit on it.
		const shouldAnimate = hasAnim && inViewport;
		// First time this cell ever gets to actually animate, reset its
		// startTime so the animation plays from frame 0 (feels lively).
		// Subsequent scroll-out → scroll-back doesn't reset, so the
		// next render shows whatever frame the animation clock is at —
		// almost always non-blank, no flash of transparency on re-entry.
		if (justEntered && shouldAnimate && !cell.animationStarted) {
			cell.startTime = now;
			cell.animationStarted = true;
		}

		const left = (rect.left - canvasRect.left) * dpr;
		const top = (rect.top - canvasRect.top) * dpr;
		const right = (rect.right - canvasRect.left) * dpr;
		const bottom = (rect.bottom - canvasRect.top) * dpr;
		const tile = _kit.LTRBRect(left, top, right, bottom);

		sk.save();
		sk.clipRect(tile, _kit.ClipOp.Intersect, false);
		sk.clear(_kit.TRANSPARENT);

		// Per-cell flag: was THIS cell actually drawn this frame? The
		// loop-wide `drewAny` would incorrectly cascade `onFirstPaint`
		// to every cell as soon as the first one drew, hiding all of
		// their CSS thumbs even when their tiles are still blank.
		let cellDrew = false;
		if (shouldAnimate) {
			// Animation is loaded AND cell is in viewport: render the live frame.
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
			const tQuantized = frame / entry.totalFrames;
			entry.animation.seek(tQuantized);
			entry.animation.render(sk, tile);
			cellDrew = true;
			if (!_loggedAnyAnim) {
				_loggedAnyAnim = true;
				const cParent = _canvas.parentNode;
				const cStyle = getComputedStyle(_canvas);
				const scStyle = _scrollContent ? getComputedStyle(_scrollContent) : null;
				console.group('[skottie-stage] first anim render');
				console.log('canvas parentNode:', cParent?.tagName, cParent?.className);
				console.log('canvas attached === scrollContent?:', cParent === _scrollContent);
				console.log('scrollContent:', _scrollContent?.tagName, _scrollContent?.className);
				console.log('canvas computed: position=', cStyle.position, 'top=', cStyle.top, 'left=', cStyle.left, 'display=', cStyle.display);
				console.log('scrollContent computed position=', scStyle?.position);
				console.log('canvasRect:', _canvas.getBoundingClientRect());
				console.log('scrollContentRect:', _scrollContent?.getBoundingClientRect());
				console.log('cellRect:', rect);
				console.log('tile coords (device px):', left, top, right, bottom);
				console.log('canvas pixel buffer:', _canvas.width, _canvas.height);
				console.log('canvas style.cssText:', _canvas.style.cssText);
				console.groupEnd();
			}
		} else if (cell.thumbInfo && _sheetImage) {
			// Animation not loaded yet: draw the thumb sub-rect from the
			// preloaded sprite sheet image directly onto the canvas.
			// Same canvas → same compositor layer → perfect scroll sync.
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
		// else: nothing painted this frame (no animation, no sheet image
		// yet). Cell retains last frame painted (initial: blank).
		sk.restore();

		if (cellDrew) {
			drewAny = true;
			if (!cell.firstPainted) {
				cell.firstPainted = true;
				cell.onFirstPaint?.();
			}
		}
	}
	if (drewAny || _hadVisible) _surface.flush();
	_hadVisible = drewAny;
}
