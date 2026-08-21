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

		// 4. Bake the animated library to DISK for the default engine.
		//
		// This is what makes opening a tab a read instead of a render. It is
		// deliberately disk-only: warming into the atlas is what made the
		// picker a monotonic allocator, so nothing here holds an atlas page.
		// Everything already on disk is skipped, so this is a no-op from the
		// second session onward and costs one IndexedDB key probe per emote.
		try { await warmEmotesToDisk(); }
		catch { /* warm is best-effort — cells still rasterise on demand */ }
	});
}

/**
 * Bake every animated emote to disk at the picker's cell size, in the
 * background, one at a time.
 *
 * Runs ONLY on the CPU engine. The WebGL worker has its own warm
 * (emote-prewarm.js) and stores incompatible slot geometry, so pointing this at
 * that engine would fill the cache with entries it then rejects.
 */
async function warmEmotesToDisk() {
	const [{ engineMode, PICKER_STICKER_PX, PICKER_FPS, loadTelegramEmoji, tgAnimatedUrl },
	       { get }] = await Promise.all([
		import('./telegram-emoji-store.js'),
		import('svelte/store')
	]);
	if (get(engineMode) !== 'cpu-rasterized') return;
	// Kill switch, for isolating this from picker jank:
	//   localStorage.setItem('noEmoteWarm','1')
	// This bake rasterises the whole library and does a synchronous getImageData
	// per emote, so it is the first thing to rule out when the picker stutters.
	try { if (localStorage.getItem('noEmoteWarm') === '1') return; } catch {}

	const cpu = await import('./cpu-atlas.js');
	if (!cpu.prewarmToDisk) return;

	const man = await loadTelegramEmoji();
	const urls = [];
	for (const items of Object.values(man?.byCat || {}))
		for (const it of items) if (!it.flag) urls.push(tgAnimatedUrl(it.cp));
	if (!urls.length) return;

	// Cell size EXACTLY as the picker registers it — SpriteSticker bakes at
	// size x dpr with the picker's oversample of 1. A mismatch here means every
	// entry is filed under a key no cell ever asks for, which is the failure
	// mode the WebGL warm shipped with for months.
	const px = Math.round(PICKER_STICKER_PX * (window.devicePixelRatio || 1));

	// Stop as soon as the tab goes away — no reason to keep rasterising for a
	// surface nobody is looking at, and backgrounding is when iOS is hunting
	// for memory to reclaim.
	const signal = { stop: false };
	const onHide = () => { if (document.visibilityState !== 'visible') signal.stop = true; };
	document.addEventListener('visibilitychange', onHide);
	window.addEventListener('native-background', onHide);
	try {
		// maxFps must match what the cells pass (SpriteSticker derives 20 for
		// picker-sized cells), or the bake stores a different frame count than
		// the one asked for at read time and every entry misses.
		await cpu.prewarmToDisk(urls, px, { maxFps: PICKER_FPS, signal });
	} finally {
		document.removeEventListener('visibilitychange', onHide);
		window.removeEventListener('native-background', onHide);
	}
}
