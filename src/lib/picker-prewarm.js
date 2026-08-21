// Get every expression-picker tab ready while the user is reading the chat,
// so the first tap opens into something already built.
//
// There is a couple of seconds between landing in a conversation and reaching
// for the emoji key, and that window is enough to pay for everything the picker
// would otherwise buy on the critical path.
//
// WHAT WAS ALREADY WARM (don't duplicate it here)
//   • emoji-data.json + Noto Color Emoji  — /app/+layout.svelte, on idle
//   • Telegram + custom pack manifests    — /app/+layout.svelte
//   • Skottie worker pool, sprite sheet,
//     and the top N animations of every
//     tab ("above the fold")              — src/routes/+layout.svelte
//   • the whole animated library baked
//     into the persistent frame cache     — emote-prewarm.js, desktop only
//
// WHAT THIS ADDS
//   1. The picker's component chunks. They are dynamically imported, so
//      without this the first tap waits on a network fetch + parse before
//      anything can even start rendering.
//   2. The Emoji Kitchen dataset — ~1.2 MB of JSON plus a CLDR index built
//      over every emoji. `EmojiKitchen.preload()` has existed for this the
//      whole time and nothing ever called it, so the Kitchen tab paid for it
//      on first open, every session.
//   3. The rlottie pool + rasterisation concurrency tuning, which the recents
//      grid and every sticker cell go through.
//
// Deliberately idle-scheduled and fire-once: the chat's own first paint
// matters more than any of this.

let _done = false;

const idle = (fn, timeout = 3000) =>
	typeof requestIdleCallback === 'function'
		? requestIdleCallback(fn, { timeout })
		: setTimeout(fn, 900);

/**
 * Warm every picker surface. Safe to call from each chat page's onMount —
 * idempotent, and a no-op off the browser.
 */
export function prewarmPicker() {
	if (_done || typeof window === 'undefined') return;
	_done = true;

	idle(async () => {
		try {
			// The component chunks first: everything below is useless if tapping
			// the button still has to fetch the code that renders it.
			const [kitchen] = await Promise.all([
				import('./components/EmojiKitchen.svelte'),
				import('./components/EmojiPicker.svelte'),
				import('./components/TelegramEmojiPanel.svelte'),
				import('./components/CustomEmojiPanel.svelte'),
				import('./components/SpriteSticker.svelte')
			]);

			// The one picker dataset nothing warmed. Kicks off the fetch and the
			// CLDR index build; both are memoised at module scope, so the tab
			// itself later finds them already resolved.
			kitchen.preload?.();
		} catch { /* a chunk failed to load — the picker still works, just cold */ }

		// Boot the rlottie pool and tune the rasterisation concurrency cap now
		// rather than when ~50 cells go visible at once. Recents and every
		// sticker cell rasterise through this.
		try {
			const sprites = await import('./lottie-spritesheet.js');
			sprites.prewarm?.();
		} catch { /* pool unavailable — cells fall back to on-demand */ }
	});
}
