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
		// keyboard; treat only a substantial bite as one. A pinch-zoom also
		// shrinks vv.height dramatically — never treat that as layout input.
		const pinched = Math.abs((vv.scale || 1) - 1) > 0.01;
		const isKeyboard = !pinched && hidden > 120;
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
		const chrome = isKeyboard || pinched ? 0 : Math.max(0, Math.round(hidden));
		r?.style.setProperty('--browser-chrome-h', `${chrome}px`);
		// --vvh: where the VISIBLE bottom edge sits, in layout-viewport
		// coordinates. Containers sized with `height: 100dvh` (or fixed to
		// bottom:0) run to the layout viewport's bottom and end up under the
		// browser chrome; sizing them from --vvh instead makes them end exactly
		// at the visible bottom. While the keyboard is open (or the page is
		// pinch-zoomed) we publish the full layout height so keyboard handling
		// keeps today's 100dvh-equivalent geometry — the kb path owns that
		// state. In the native shell visualViewport never shrinks, so --vvh
		// equals 100dvh and nothing moves there either.
		const vvh = isKeyboard || pinched
			? window.innerHeight
			: Math.round(vv.height + vv.offsetTop);
		r?.style.setProperty('--vvh', `${vvh}px`);
		_dbg?.(hidden, chrome, vvh, isKeyboard, pinched);
	};
	const onChange = () => {
		if (raf) return;
		raf = requestAnimationFrame(measure);
	};

	vv.addEventListener('resize', onChange);
	vv.addEventListener('scroll', onChange);
	initViewportDebug(); // before the first measure, so the readout fills in
	measure();
}

// ── Temporary on-device diagnostics ─────────────────────────────────────────
// Open any page with `?vvdbg` (or set localStorage.vvdbg = '1') to get a live
// readout of the viewport numbers this module works from. The mobile-chrome
// bug can only be reproduced on real hardware, and these values have never
// been confirmed there — this is how we confirm them. Remove once the mobile
// compose-bar work is settled.
let _dbg = null;
function initViewportDebug() {
	let on = false;
	try {
		on = new URLSearchParams(location.search).has('vvdbg') || localStorage.getItem('vvdbg') === '1';
	} catch {}
	if (!on) return;
	const el = document.createElement('div');
	el.style.cssText =
		'position:fixed;top:70px;left:4px;z-index:99999;pointer-events:none;' +
		'font:10px/1.5 monospace;color:#0f0;background:rgba(0,0,0,0.72);' +
		'padding:4px 6px;border-radius:6px;white-space:pre;';
	document.body.appendChild(el);
	// One probe per unit — offsetHeight tells us what the browser actually
	// resolves 100dvh/svh/lvh to, so we can compare against visualViewport.
	const probes = {};
	for (const u of ['dvh', 'svh', 'lvh']) {
		const p = document.createElement('div');
		p.style.cssText = `position:fixed;left:-9999px;top:0;width:1px;height:100${u};`;
		document.body.appendChild(p);
		probes[u] = p;
	}
	_dbg = (hidden, chrome, vvh, isKeyboard, pinched) => {
		const vv = window.visualViewport;
		el.textContent =
			`innerH  ${window.innerHeight}\n` +
			`vv.h    ${Math.round(vv.height)}  ot ${Math.round(vv.offsetTop)}  sc ${(vv.scale || 1).toFixed(2)}\n` +
			`dvh ${probes.dvh.offsetHeight}  svh ${probes.svh.offsetHeight}  lvh ${probes.lvh.offsetHeight}\n` +
			`hidden  ${Math.round(hidden)}  chrome ${chrome}\n` +
			`--vvh   ${vvh}${isKeyboard ? '  KB' : ''}${pinched ? '  PINCH' : ''}\n` +
			`scrollY ${Math.round(window.scrollY)}  docH ${document.documentElement.scrollHeight}`;
	};
}
