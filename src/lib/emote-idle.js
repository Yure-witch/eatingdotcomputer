// Global "emotes are awake" signal.
//
// On touch / memory-constrained devices, animated emotes loop only while the
// user is interacting. After IDLE_MS with no interaction they FREEZE — the rAF
// render loops stop, so an idle chat does ~zero GPU/canvas work. That sustained
// 60fps churn across ~30 looping emotes is what jetsammed the native WebContent
// process. Any interaction (scroll, tap, key, wheel) wakes them again, and the
// timer restarts.
import { writable } from 'svelte/store';

export const emotesAwake = writable(true);

const IDLE_MS = 45000; // freeze after 45s of no interaction
let _timer = null;
let _inited = false;

export function initEmoteIdle() {
	if (_inited || typeof window === 'undefined') return;
	_inited = true;

	const sleep = () => emotesAwake.set(false);
	const wake = () => {
		emotesAwake.set(true);
		clearTimeout(_timer);
		_timer = setTimeout(sleep, IDLE_MS);
	};

	// Capture phase so an inner element's scroll (the message list scrolls itself,
	// and `scroll` doesn't bubble) still counts as activity.
	const opts = { passive: true, capture: true };
	for (const ev of ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll']) {
		window.addEventListener(ev, wake, opts);
	}
	document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

	wake(); // start awake + arm the idle timer
}
