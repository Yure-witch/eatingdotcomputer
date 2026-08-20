// Global "emotes are awake" signal.
//
// On touch / memory-constrained devices, animated emotes loop only while the
// user is interacting. After IDLE_MS with no interaction they FREEZE — the rAF
// render loops stop, so an idle chat does ~zero GPU/canvas work. That sustained
// 60fps churn across ~30 looping emotes is what jetsammed the native WebContent
// process. Any interaction (scroll, tap, key, wheel) wakes them again, and the
// timer restarts.
import { writable, derived } from 'svelte/store';

// Two independent reasons an emote may be frozen, combined below.
//   _idleAwake — the inactivity timer described above.
//   _holds     — explicit, caller-owned freezes (see holdEmotes).
const _idleAwake = writable(true);
const _holds = writable(0);

// What consumers read. A hold wins over the idle timer, which matters because
// the timer wakes on pointerdown/scroll — i.e. on exactly the gestures a
// caller wants to freeze emotes FOR.
export const emotesAwake = derived(
	[_idleAwake, _holds],
	([awake, holds]) => awake && holds === 0
);

/**
 * Freeze animated emotes until the returned function is called. Reference
 * counted, so overlapping holds behave. Use around anything that needs the
 * main thread for a frame or two — paging the expression picker between
 * categories, for instance, where dozens of looping canvases would otherwise
 * compete with the swipe for the same frames.
 * @returns {() => void} release
 */
export function holdEmotes() {
	_holds.update((n) => n + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		_holds.update((n) => Math.max(0, n - 1));
	};
}

const IDLE_MS = 45000; // freeze after 45s of no interaction
let _timer = null;
let _inited = false;

export function initEmoteIdle() {
	if (_inited || typeof window === 'undefined') return;
	_inited = true;

	const sleep = () => _idleAwake.set(false);
	const wake = () => {
		_idleAwake.set(true);
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
