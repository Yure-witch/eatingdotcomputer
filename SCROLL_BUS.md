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

## Exceptions

Svelte's `onscroll={...}` attribute on an element you own is fine for something
trivial and short-lived. Anything that outlives a single interaction, or that
watches scrolling it doesn't own, goes through the bus.
