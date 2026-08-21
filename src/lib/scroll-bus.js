// One place that listens to scrolling and gestures for the whole app.
//
// WHY THIS EXISTS
// Every component that wanted to know about scrolling used to attach its own
// listeners — a virtualised grid needs its own scrollTop, a popover needs to
// reposition, the emote renderer needs to know a scroll is in progress, the
// expression picker needs the direction. Individually reasonable; collectively
// a pile of independent listeners on the same events, each with its own rAF
// throttle, all woken by the same scroll.
//
// This module installs exactly:
//   • ONE capture-phase `scroll` listener on the document. Capture is what
//     makes a single listener possible at all: `scroll` does not bubble, so a
//     listener on an ancestor only ever sees it during the capture phase.
//   • ONE each of `wheel`, `touchstart`, `touchmove` on the window, passive.
//
// Everything else subscribes here. Callbacks are batched into a single rAF per
// frame, so N subscribers cost one frame of work rather than N.
//
// WHAT THIS IS NOT
// It is not a performance fix for animated-emote jank. That cost is dozens of
// simultaneously compositing canvases, not listener count — measured at zero
// long tasks under 6x CPU throttle with ~15 gesture listeners installed. This
// exists to keep the listener surface from growing, and to give components one
// well-defined way to observe scrolling.
//
// USAGE
//   import { onElementScroll, onScrollGesture } from '$lib/scroll-bus.js';
//
//   // per-element: fires with (element) after any scroll of THAT element
//   const off = onElementScroll(gridEl, () => { scrollTop = gridEl.scrollTop; });
//
//   // direction: fires with 'up' | 'down' from real user input
//   const off2 = onScrollGesture((dir) => { dimmed = dir === 'down'; });
//
// Both return an unsubscribe function. Call it on destroy.

let _inited = false;

/** @type {Map<EventTarget, Set<(el: EventTarget) => void>>} */
const _elSubs = new Map();
/** @type {Set<(dir: 'up' | 'down') => void>} */
const _gestureSubs = new Set();

// Elements that scrolled this frame, drained in one rAF.
const _dirty = new Set();
let _raf = 0;

function flush() {
	_raf = 0;
	const els = [..._dirty];
	_dirty.clear();
	for (const el of els) {
		const subs = _elSubs.get(el);
		if (!subs) continue;
		for (const cb of subs) {
			try { cb(el); } catch { /* one bad subscriber must not stall the rest */ }
		}
	}
}

function onAnyScroll(e) {
	const el = e.target;
	if (!el || !_elSubs.has(el)) return;
	_dirty.add(el);
	if (!_raf) _raf = requestAnimationFrame(flush);
}

function emitGesture(dir, dy) {
	for (const cb of _gestureSubs) {
		try { cb(dir, dy); } catch { /* ignore */ }
	}
}

let _touchY = 0;
function onTouchStart(e) { _touchY = e.touches?.[0]?.clientY ?? 0; }
function onTouchMove(e) {
	if (!_gestureSubs.size) return;
	const y = e.touches?.[0]?.clientY ?? 0;
	const dy = _touchY - y;            // finger up = reading downward
	if (Math.abs(dy) < 2) return;
	_touchY = y;
	// Magnitude travels with the direction. A subscriber that flips state on a
	// single 2px event has no way to tell a deliberate reversal from the jitter
	// inside one drag — real drags are never monotonic — so it needs to be able
	// to accumulate before committing.
	emitGesture(dy > 0 ? 'down' : 'up', Math.abs(dy));
}
function onWheel(e) {
	if (!_gestureSubs.size || !e.deltaY) return;
	emitGesture(e.deltaY > 0 ? 'down' : 'up', Math.abs(e.deltaY));
}

function init() {
	if (_inited || typeof window === 'undefined') return;
	_inited = true;
	// Capture phase: `scroll` doesn't bubble, so this is the only way one
	// listener can see scrolling from every element on the page.
	document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
	// Direction comes from the INPUT, never from scrollTop deltas. Virtualised
	// grids nudge scrollTop as rows mount, so the last event of a gesture is
	// often a small correction the other way — reading that inverts the
	// direction on every flick. Wheel and touch deltas can't be forged by a
	// programmatic scroll.
	window.addEventListener('wheel', onWheel, { passive: true });
	window.addEventListener('touchstart', onTouchStart, { passive: true });
	window.addEventListener('touchmove', onTouchMove, { passive: true });
}

/**
 * Observe scrolling of ONE element through the shared listener.
 * @param {EventTarget | null | undefined} el
 * @param {(el: EventTarget) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onElementScroll(el, cb) {
	if (!el || typeof cb !== 'function') return () => {};
	init();
	let set = _elSubs.get(el);
	if (!set) _elSubs.set(el, (set = new Set()));
	set.add(cb);
	return () => {
		const s = _elSubs.get(el);
		if (!s) return;
		s.delete(cb);
		if (!s.size) _elSubs.delete(el);
	};
}

/**
 * Observe scroll DIRECTION from real user input, anywhere in the app.
 *
 * The callback also receives the pixel magnitude of that individual event, so
 * a subscriber can require N pixels in one direction before acting rather than
 * reacting to every 2px sample.
 * @param {(dir: 'up' | 'down', dy: number) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onScrollGesture(cb) {
	if (typeof cb !== 'function') return () => {};
	init();
	_gestureSubs.add(cb);
	return () => _gestureSubs.delete(cb);
}

/** Diagnostics: what the bus is currently carrying. */
export function scrollBusStats() {
	return { elements: _elSubs.size, gestureSubscribers: _gestureSubs.size };
}
