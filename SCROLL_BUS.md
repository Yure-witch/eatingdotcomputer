# Scroll & gesture listeners — use the bus

**Rule: don't attach `scroll`, `wheel`, `touchstart` or `touchmove` listeners
directly. Subscribe to `$lib/scroll-bus.js` instead.**

This applies to every component and to any agent working in this repo.

## Why

Components each grew their own listeners: virtualised grids for their
`scrollTop`, popovers to reposition, the emote renderer to know a scroll was in
progress, the expression picker for scroll direction. Individually reasonable;
collectively a pile of independent listeners on the same events, each with its
own rAF throttle, all woken by the same scroll.

The bus installs exactly:

- **one** capture-phase `scroll` listener on `document`
- **one** each of `wheel`, `touchstart`, `touchmove` on `window`, all passive

Capture phase is what makes a single scroll listener possible at all: `scroll`
does not bubble, so a listener on an ancestor only ever sees it during capture.

Subscriber callbacks are batched into a single `requestAnimationFrame` per
frame, so N subscribers cost one frame of work rather than N.

## Usage

```js
import { onElementScroll, onScrollGesture } from '$lib/scroll-bus.js';

// Per-element — fires after any scroll of THAT element. Use for
// virtualisation, sticky headers, anything needing its own scrollTop.
onMount(() => onElementScroll(gridEl, () => { scrollTop = gridEl.scrollTop; }));

// Direction — fires 'up' | 'down' from real user input, anywhere.
onMount(() => onScrollGesture((dir) => { dimmed = dir === 'down'; }));
```

Both return an unsubscribe function. Returning it from `onMount` is enough.

## Read direction from INPUT, never from scrollTop

The bus derives direction from wheel and touch deltas, and you should too if
you ever need it outside the bus.

Reading `scrollTop` deltas looks obvious and is wrong here. Virtualised grids
nudge the scroll position as rows mount, so the **last event of a gesture is
often a small correction the other way** — a downward flick was measured
settling `400 → 393`, an upward one `93 → 99`. Reacting to that inverts the
direction on every single flick, and a threshold large enough to mask it is
guesswork. Wheel and touch deltas cannot be forged by a programmatic scroll.

## What this does NOT fix

It is not a performance fix for animated-emote jank.

Measured with ~15 gesture listeners installed, at 6× CPU throttle: **zero long
tasks** during idle, vertical scroll, and horizontal swipe. Listener count was
not the bottleneck. The steady-state cost is dozens of simultaneously
compositing canvases (63 animating cells with a 10-worker rlottie pool in the
expression picker), which is GPU/compositor work and never shows up as
main-thread blocking.

The bus exists to keep the listener surface from growing and to give components
one well-defined way to observe scrolling — not to make scrolling faster.

## Scroll-snap traps that do not look like snap bugs

Collected from the pager, the expression picker, and a port of this pattern to
rickydotnow (whose findings flow back here).

**An `overflow: hidden` ancestor BETWEEN a snap area and its scroll container
silently steals the snap area.** A snap area belongs to its *nearest* scroll
container ancestor — and `overflow: hidden` makes an element one. Wrap a
`scroll-snap-align` child in a clipped frame (rounded corners are the classic
reason) and it stops being a snap point of the outer track entirely. The
failure mode hides its cause: with `mandatory` and a broken target list,
Chrome can park the track several pages in AT LOAD and pin it there —
`scrollLeft = 0` reverts within the frame. It reads as "starts on the wrong
page and won't scroll back", not as a snap bug. One-shot diagnostic: set
`scrollSnapType = 'none'`, write `scrollLeft = 0`, restore; if it springs
back, snap owns the position. Fix: `overflow: visible` on the wrapper (clip
something inside the snap area instead). Our `.expr-pane` is safe only
because it is the snap area itself, not a wrapper around one — don't add an
inner clipped frame carrying the snap-align.

**Snap fights programmatic per-frame scrolls.** Writing `scrollLeft` every
frame while `scroll-snap-type` is active loses to the snap engine. Pause it
(`el.style.scrollSnapType = 'none'`), drive, then restore — and restore on a
condition, not a duration: watch for arrival by rAF (with a ceiling), because
a fixed timer re-snaps heavy pages to where they just left. `scrollend` is
the tidy signal where available, but it never fires if the scroll ends where
it started — keep a fallback restore.

**`scroll-snap-stop: always` is the strict one-page-per-swipe rule.** If a
fling must never carry past the neighbour, this is the native answer — do not
rebuild paging on transforms to get it.

**Don't compute positions as `index * clientWidth`** unless every page is
provably uniform. Measure the target's actual `offsetLeft`.

## Exceptions

Svelte's `onscroll={...}` attribute on an element you own is fine for something
trivial and short-lived. Anything that outlives a single interaction, or that
watches scrolling it doesn't own, goes through the bus.
