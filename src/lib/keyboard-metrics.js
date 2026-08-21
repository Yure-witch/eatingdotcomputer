// One source of truth for "how tall is the on-screen keyboard right now".
//
// The two platforms report it completely differently:
//
//   Native (Capacitor)  the web view is configured resize:'none', so it never
//                       shrinks. visualViewport therefore reports NOTHING, and
//                       the only signal is the Keyboard plugin's height, which
//                       native.js feeds in here via noteKeyboardHeight().
//
//   Mobile web / PWA    iOS Safari does not shrink the LAYOUT viewport for the
//                       keyboard either — which is exactly why `100dvh` layouts
//                       misalign there, with the compose ending up behind the
//                       keyboard. What does change is the VISUAL viewport, so
//                       that's what we measure.
//
// Both paths publish the same two custom properties on <html>:
//
//   --kb-h       live keyboard height, 0 when closed.
//   --kb-h-last  the last NON-zero height, remembered across the keyboard
//                closing and (via localStorage) across reloads.
//
// --kb-h-last is what lets the expression picker open at exactly the height the
// keyboard occupied, so swapping between them doesn't move the compose bar. It
// has to be remembered rather than read live, because by the time the picker is
// laid out the keyboard is already on its way down.

import { writable } from 'svelte/store';

const LAST_KEY = 'kb-h-last';
// Anything outside this range is a bad reading (a rotation mid-measure, a
// hardware keyboard's accessory bar, some other viewport shuffle) and would
// leave the picker a silly size, so it is ignored for --kb-h-last.
const MIN_PLAUSIBLE = 180;
const MAX_PLAUSIBLE = 520;

export const keyboardHeight = writable(0);

let _last = 0;
let _inited = false;

function root() {
	return typeof document === 'undefined' ? null : document.documentElement;
}

/** Publish a keyboard height from whichever platform observed it. */
export function noteKeyboardHeight(px) {
	const h = Math.max(0, Math.round(px || 0));
	const r = root();
	if (!r) return;
	r.style.setProperty('--kb-h', `${h}px`);
	keyboardHeight.set(h);
	if (h >= MIN_PLAUSIBLE && h <= MAX_PLAUSIBLE && h !== _last) {
		_last = h;
		r.style.setProperty('--kb-h-last', `${h}px`);
		try { localStorage.setItem(LAST_KEY, String(h)); } catch {}
	}
}

export function initKeyboardMetrics() {
	if (_inited || typeof window === 'undefined') return;
	_inited = true;
	const r = root();

	// Seed --kb-h-last from the previous session so the very first picker open
	// is already the right height, before any keyboard has been seen.
	try {
		const saved = Number(localStorage.getItem(LAST_KEY));
		if (saved >= MIN_PLAUSIBLE && saved <= MAX_PLAUSIBLE) {
			_last = saved;
			r?.style.setProperty('--kb-h-last', `${saved}px`);
		}
	} catch { /* private mode — fall back to the CSS default */ }
	r?.style.setProperty('--kb-h', '0px');
	r?.style.setProperty('--browser-chrome-h', '0px');

	const vv = window.visualViewport;
	if (!vv) return; // native feeds us through noteKeyboardHeight instead

	let raf = 0;
	const measure = () => {
		raf = 0;
		// The slice of the layout viewport the visual viewport no longer covers.
		// offsetTop matters when the page is scrolled within a pinched viewport.
		const hidden = window.innerHeight - vv.height - vv.offsetTop;
		// Browser chrome sliding in/out produces small deltas that aren't a
		// keyboard; treat only a substantial bite as one.
		const isKeyboard = hidden > 120;
		noteKeyboardHeight(isKeyboard ? hidden : 0);
		// …but that sub-120px slice is not nothing: it is the browser's own
		// chrome (Safari's bottom address bar, Chrome's toolbar). `position:
		// fixed; bottom: 0` resolves against the LAYOUT viewport, so anything
		// pinned to the bottom — the nav pill, the compose bar — sits behind
		// that chrome and becomes unreachable. Publish it so those elements can
		// lift by exactly the amount that is covered.
		//
		// Zero in the native shell (no browser chrome, so `hidden` is 0), which
		// is why the shell already looks right and must not move. Also zero
		// while the keyboard is open, because the keyboard path owns the offset
		// then and adding both would double-count.
		r?.style.setProperty('--browser-chrome-h', isKeyboard ? '0px' : `${Math.max(0, Math.round(hidden))}px`);
	};
	const onChange = () => {
		if (raf) return;
		raf = requestAnimationFrame(measure);
	};

	vv.addEventListener('resize', onChange);
	vv.addEventListener('scroll', onChange);
	measure();
}
