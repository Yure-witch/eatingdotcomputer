<script>
	import { onMount, onDestroy } from 'svelte';
	import {
		tgAnimatedUrl,
		tgFlagUrl,
		tgcUrl,
		tgThumbUrl,
		tgcThumbUrl,
		fetchLottie,
		isStaticPack,
		spriteSheet,
		spriteKeyForCp,
		spriteKeyForCustom,
		engineMode,
		isAdaptivePack
	} from '$lib/telegram-emoji-store.js';
	import { acquire, release } from '$lib/lottie-spritesheet.js';
	import * as SkMain from '$lib/skottie-stage.js';
	import * as SkWorker from '$lib/skottie-stage-worker.js';
	import * as CpuAtlas from '$lib/cpu-atlas.js';
	// Resolve the right stage module based on engine. All three expose the
	// same canvas-cell API surface, so dispatch is module selection — every
	// call site below uses `mod.<fn>` and the right implementation runs.
	function skModule(eng) {
		// `cpu-rasterized` → no-WebGL CPU atlas (iOS-safe). `webgpu-rasterized`
		// / `skottie-worker` / `skottie-webgpu` → Skia/WebGL worker atlas.
		// Everything else → main-thread Skottie.
		if (eng === 'cpu-rasterized') return CpuAtlas;
		return (eng === 'skottie-worker' || eng === 'skottie-webgpu' || eng === 'webgpu-rasterized') ? SkWorker : SkMain;
	}

	let {
		cp,
		flag = false,
		short = null,
		id = null,
		size = 32,
		loop = true,
		mode = 'visible',
		title = '',
		root = null,
		// Skip the IO-gated load + settle delay. Use for always-visible
		// cells like the picker's tab icons that should animate
		// immediately on mount without throttling.
		eager = false,
		// Override the user's engine preference. Used for cells that
		// can't render through the shared Skottie stage (e.g. the
		// picker's tab icons, which live outside the grid's scroll
		// content and so aren't covered by the stage canvas).
		forceEngine = null
	} = $props();

	const isCustom = $derived(!!(short && id));
	const paused = $derived(isCustom && isStaticPack(short));
	// Adaptive (Telegram text_color) packs ship monochrome silhouettes meant
	// to render in the current text colour. The sprite/thumb placeholder is
	// baked in a single colour, so for these we recolour it to the live
	// --ink via a CSS mask instead of painting the baked pixels.
	const adaptive = $derived(!!(short && isAdaptivePack(short)));
	const url = $derived(isCustom ? tgcUrl(short, id) : tgAnimatedUrl(cp));
	const thumbUrl = $derived(isCustom ? tgcThumbUrl(short, id) : tgThumbUrl(cp));
	const itemKey = $derived(isCustom ? spriteKeyForCustom(short, id) : spriteKeyForCp(cp));
	const engine = $derived(forceEngine || $engineMode);

	const sprite = $derived($spriteSheet);
	const spritePos = $derived(sprite?.items?.[itemKey] || null);
	const spriteScale = $derived(sprite ? size / sprite.cellPx : 0);

	let stack = $state(null);
	let canvas = $state(null);
	let observer = null;
	let visible = $state(false);
	let hovering = $state(false);
	let mounted = true;
	// Free an rlottie cell's rasterised frames (GPU-backed ImageBitmaps) after it's
	// been off-screen this long; they're re-acquired automatically when it scrolls
	// back. Bounds GPU memory to ~the visible set instead of every emote ever shown
	// — on iOS's tight WebView budget that runaway is what got the app jetsammed.
	// Touch/native only; desktop has the headroom and skips the re-decode churn.
	const _RELEASE_OFFSCREEN = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
	const OFFSCREEN_RELEASE_MS = 8000;
	let _offscreenT = null;
	// Flips true after the worker has drawn 3 confirmed frames into
	// the canvas tile — at that point we know the canvas has visibly
	// taken over and the CSS backdrop can fall away without ever
	// exposing a transparent moment.
	let painted = $state(false);
	let activeEngine = null;       // engine the current load belongs to — guards against stale work after toggle

	// ── rlottie engine state ────────────────────────────────────────────
	let entry = null;
	let registeredUrl = null;
	let rafHandle = null;
	let startTime = 0;
	let running = false;
	let lastBitmap = null;
	let settleTimer = null;

	// ── skottie engine state (shared between 'skottie' and 'skottie-worker') ──
	let skottieCellId = null;
	let skottieUrl = null;
	let skottieAnimQueued = false; // we've called loadAnimation for this cell's URL
	// True when this cell registered through the NEW inline-canvas path
	// (mod.registerCanvasCell) — its own <canvas> was transferred to the
	// worker, which blits frames straight into it. The canvas flows with
	// the DOM, so there's no overlay and no scroll-position math. False =
	// legacy shared-overlay path (main-thread 'skottie' engine only).
	let skottieCanvasPath = false;
	// Remember which Skottie module owns the current cell so teardown
	// hits the right one even after an engine swap mid-flight.
	let skottieMod = null;
	const isSkottieEngine = (eng) => eng === 'skottie' || eng === 'skottie-worker' || eng === 'skottie-webgpu' || eng === 'webgpu-rasterized' || eng === 'cpu-rasterized';

	const px = $derived(Math.round(size * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 2)));

	// ──────────────────────────────────────────────────────────────────
	//  Rlottie path
	// ──────────────────────────────────────────────────────────────────
	const SETTLE_MS = 150;

	async function ensureLoaded_rlottie() {
		if (entry || flag || !canvas || paused) return;
		const u = url;
		const data = await fetchLottie(u);
		if (!data || !mounted || !canvas || activeEngine !== 'rlottie') return;

		// Eager cells skip the settle delay AND don't gate on `visible`
		// (they're always-visible by design — tab icons, etc.).
		if (!eager) {
			await new Promise((r) => { settleTimer = setTimeout(r, SETTLE_MS); });
			settleTimer = null;
			if (!mounted || !canvas || !visible || activeEngine !== 'rlottie') return;
		} else if (!mounted || !canvas || activeEngine !== 'rlottie') {
			return;
		}

		let result;
		try { result = await acquire(u, data); }
		catch (e) { console.warn('[sprite] rasterise failed', e); return; }
		if (!mounted || activeEngine !== 'rlottie') { release(u); return; }
		entry = result;
		registeredUrl = u;
		paintFrame_rlottie(entry.totalFrames - 1);
		updatePlay_rlottie();
	}

	function paintFrame_rlottie(idx) {
		if (!canvas || !entry?.frames) return;
		const last = entry.totalFrames > 0 ? entry.totalFrames - 1 : 0;
		const bm = entry.frames[idx] || entry.frames[last] || entry.frames[0] || lastBitmap;
		if (!bm) return;
		if (bm === lastBitmap) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bm, 0, 0, canvas.width, canvas.height);
		lastBitmap = bm;
		if (!painted) painted = true;
	}

	function tick_rlottie(now) {
		if (!running || !entry) return;
		if (!startTime) startTime = now;
		const elapsed = (now - startTime) / 1000;
		let f = Math.floor(elapsed * entry.fps);
		if (loop) {
			f = ((f % entry.totalFrames) + entry.totalFrames) % entry.totalFrames;
			paintFrame_rlottie(f);
			rafHandle = requestAnimationFrame(tick_rlottie);
		} else if (f >= entry.totalFrames - 1) {
			paintFrame_rlottie(entry.totalFrames - 1);
			running = false;
			rafHandle = null;
		} else {
			paintFrame_rlottie(f);
			rafHandle = requestAnimationFrame(tick_rlottie);
		}
	}

	function startLoop_rlottie() {
		if (running || paused) return;
		running = true;
		startTime = 0;
		rafHandle = requestAnimationFrame(tick_rlottie);
	}
	function stopLoop_rlottie() {
		running = false;
		if (rafHandle) cancelAnimationFrame(rafHandle);
		rafHandle = null;
	}
	function updatePlay_rlottie() {
		if (!entry || paused) return;
		const want = mode === 'hover' ? hovering : (eager || visible);
		if (want && !running) startLoop_rlottie();
		else if (!want && running) stopLoop_rlottie();
	}
	function teardown_rlottie() {
		stopLoop_rlottie();
		if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
		if (registeredUrl) release(registeredUrl);
		entry = null;
		registeredUrl = null;
		lastBitmap = null;
		// Wipe the canvas so the thumb can show through again.
		if (canvas) {
			const ctx = canvas.getContext('2d');
			if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
		}
	}

	// ──────────────────────────────────────────────────────────────────
	//  Skottie path — register with the shared GPU stage
	// ──────────────────────────────────────────────────────────────────
	async function ensureLoaded_skottie() {
		if (skottieCellId != null || flag) return;
		const u = url;
		const eng = activeEngine;
		const mod = skModule(eng);
		skottieMod = mod;
		await mod.ensureStage();
		if (!mounted || activeEngine !== eng) return;

		// If the worker already has this animation built (because a
		// previous cell instance — likely from a section the user
		// scrolled past in this picker session — left the entry
		// resident in `_anims`), skip the CSS-thumb warmup entirely.
		// The default behaviour holds the thumb backdrop over the
		// canvas until paint #15 (~470ms at 32 fps) to guarantee the
		// compositor has visibly taken over before exposing it. That
		// guard is necessary the first time a sticker mounts — the
		// JSON might still be building. But once the animation is
		// built, paint #1 already shows the real animation frame, and
		// holding the thumb over it for 470ms is what reads as a
		// "flash on certain items" every time the user scrolls back
		// into a section.
		// NEW inline-canvas path (worker engine): transfer this cell's
		// own <canvas> to the worker, which blits animation frames into
		// it. The canvas flows in the DOM, so the browser scrolls it
		// natively — no overlay, no per-frame rect math, no scroll lag.
		if (typeof mod.registerCanvasCell === 'function' && canvas) {
			// Keep the CSS placeholder (the sprite/SVG thumb) showing the
			// whole time until a real paint lands in this canvas (onFirstPaint).
			// Do NOT hide it preemptively just because the animation is built —
			// the canvas is still blank until the first blit, and hiding early
			// is the "flash / disappears then re-appears" artifact.
			painted = false;
			// CPU atlas (iOS): the cell's canvas is the live DOM element drawn
			// via a 2D context on the main thread — do NOT transfer it. Worker
			// atlas: transferControlToOffscreen so the worker owns it.
			const isCpu = (eng === 'cpu-rasterized');
			let target = canvas;
			if (!isCpu) {
				try {
					target = canvas.transferControlToOffscreen();
				} catch (e) {
					// Canvas already had a context (e.g. rlottie ran on it
					// before an engine swap). The {#key engine} wrapper
					// recreates the element on swap so this normally can't
					// happen; if it does, bail rather than throw.
					console.warn('[sprite] transferControlToOffscreen failed', e);
					return;
				}
			}
			skottieCanvasPath = true;
			skottieCellId = mod.registerCanvasCell({
				url: u,
				canvas: target,
				w: px,
				h: px,
				paused,
				loop,
				visible: !!(eager || visible),
				// 'webgpu-rasterized' / 'cpu-rasterized': pre-rasterise frames to
				// a cached atlas and play them back by blitting (no per-frame
				// render). Other worker engines render live each frame.
				rasterized: eng === 'webgpu-rasterized',
				// Fires after the confirmed paints of this cell — the canvas now
				// holds the animation, so the CSS thumb backdrop can drop out.
				onFirstPaint: () => { if (mounted) painted = true; }
			});
			if (paused) return;
			if (eager || visible) await queueSkottieAnimation();
			return;
		}

		// LEGACY shared-overlay path (main-thread 'skottie' engine).
		if (mod.isAnimationLoaded?.(u)) painted = true;
		// Register the cell (thumb only — animation is queued lazily
		// when the IO observer fires `visible = true`, so off-screen
		// cells don't request a load until they actually need it).
		const thumbInfo = (sprite && spritePos) ? {
			sheetUrl: sprite.sheetUrl,
			x: spritePos.x,
			y: spritePos.y,
			cellPx: sprite.cellPx
		} : null;
		skottieCellId = mod.registerCell({
			url: u,
			getRect: () => stack?.getBoundingClientRect() ?? null,
			paused,
			loop,
			thumbInfo,
			// Initial visibility passed straight from the live IO
			// state. Eager cells (tab icons) are always-visible by
			// design; for everyone else this is `true` only if the
			// IntersectionObserver already fired during the
			// `ensureStage` await above and reported the cell
			// in-viewport. Off-viewport cells in warmed sections
			// register as invisible and the worker skips them in
			// every render loop until a later IO transition flips
			// the flag — so the perf cost of section-level warming
			// is bounded to the few rows actually on screen.
			visible: !!(eager || visible),
			// Fires after the worker's 3rd confirmed paint of this
			// cell — canvas has visibly taken over, so the CSS
			// backdrop can drop out.
			onFirstPaint: () => { if (mounted) painted = true; },
			// Worker's surface was wiped (tab switch, resize). Bring
			// the backdrop back to cover the cell while the canvas
			// rebuilds; next 3-paint cycle will hide it again.
			onSurfaceLost: () => { if (mounted) painted = false; }
		});

		// Static packs (MadEmoji etc) have no animation.
		if (paused) return;

		// Eager cells (tab icons) queue their animation immediately —
		// they're always-visible. Cells whose IO already reported
		// in-viewport (because the await above yielded) also queue
		// straight away. Everything else waits for an IO transition.
		if (eager || visible) await queueSkottieAnimation();
	}

	// Queue the animation load with the stage. The stage may not
	// actually build the animation right away — it has a priority
	// queue that prefers cells inside the viewport — so if this cell
	// happens to be off-screen when this runs, its load gets back-of-
	// queue treatment. If the cell scrolls off before the load runs,
	// `releaseSkottieAnimation` removes it from the queue (cancel).
	async function queueSkottieAnimation() {
		if (skottieAnimQueued || !mounted || flag || paused) return;
		if (!isSkottieEngine(activeEngine)) return;
		const u = url;
		const mod = skottieMod || skModule(activeEngine);
		// In the main-thread Skottie path we still pre-fetch the JSON
		// here so the stage doesn't have to. In the worker path we pass
		// `null` — the worker fetches its own copy (avoids a 100 KB+
		// structured clone across the thread boundary per emoji).
		let data = null;
		if (mod === SkMain) {
			data = await fetchLottie(u);
			if (!data || !mounted || !isSkottieEngine(activeEngine) || skottieAnimQueued) return;
		}
		mod.loadAnimation(u, data, () => stack?.getBoundingClientRect() ?? null);
		skottieAnimQueued = true;
		skottieUrl = u;
	}

	function releaseSkottieAnimation() {
		if (!skottieUrl) return;
		// Removes from pending queue if not yet loaded; decrements
		// refcount (and possibly deletes) if already loaded.
		(skottieMod || SkMain).releaseAnimation(skottieUrl);
		skottieAnimQueued = false;
		skottieUrl = null;
	}

	function updatePlay_skottie() {
		// No-op. Skottie cells stay marked-visible in the stage the
		// whole time they're mounted; off-screen cells are skipped by
		// the render loop's rect culling check. Flipping cell.visible
		// here based on the IO observer races with initial mount —
		// `visible` starts as $state(false) and the first IO callback
		// hasn't fired yet, so this would briefly mark the cell
		// invisible right after `ensureLoaded_skottie` set it visible,
		// causing the cell to render once then go blank.
	}
	function teardown_skottie() {
		const mod = skottieMod || SkMain;
		if (skottieCellId != null) {
			if (skottieCanvasPath) mod.unregisterCanvasCell?.(skottieCellId);
			else mod.unregisterCell(skottieCellId);
		}
		// Only release the URL if its animation hasn't actually built
		// yet (still in `_pending` on the worker). That cancels work
		// the worker hasn't finished — fine, the user moved on. But
		// for a BUILT animation in `_anims`, calling release() drops
		// the refcount and the worker `entry.animation.delete()`s it,
		// taking 30–60ms to rebuild from the JSON the next time the
		// section scrolls back into view. During that rebuild window
		// the cell falls back to its thumb sprite — that's the
		// "specific items flash on scroll" the user keeps hitting.
		// Section virtualization in the TG picker mounts/unmounts
		// thousands of cells as the user scrolls; without this guard
		// each round-trip nukes the whole pack's Skottie cache.
		if (skottieUrl && !mod.isAnimationLoaded?.(skottieUrl)) {
			mod.releaseAnimation(skottieUrl);
		}
		skottieCellId = null;
		skottieUrl = null;
		skottieAnimQueued = false;
		skottieMod = null;
		skottieCanvasPath = false;
	}

	// ──────────────────────────────────────────────────────────────────
	//  Dispatch
	// ──────────────────────────────────────────────────────────────────
	function ensureLoaded() {
		if (engine === 'rlottie') return ensureLoaded_rlottie();
		return ensureLoaded_skottie();
	}
	function updatePlay() {
		if (engine === 'rlottie') updatePlay_rlottie();
		else updatePlay_skottie();
	}
	function teardownCurrent(which) {
		if (which === 'rlottie') teardown_rlottie();
		else teardown_skottie();
	}

	onMount(() => {
		if (flag) return;
		activeEngine = engine;
		// Eager cells (tab icons) and all Skottie cells kick off
		// loading immediately (Skottie just registers the thumb at
		// this point — the actual animation load is queued lazily on
		// IO visibility below). Otherwise it waits for IO visibility.
		if (isSkottieEngine(engine) || eager) ensureLoaded();
		observer = new IntersectionObserver((entries) => {
			const wasVisible = visible;
			visible = entries[0].isIntersecting;
			// Cancel any pending off-screen frame release the moment we're back.
			if (visible && _offscreenT) { clearTimeout(_offscreenT); _offscreenT = null; }
			// Went off-screen → schedule freeing the rasterised frames (re-acquired by
			// the `visible && !wasVisible` branch above when it scrolls back).
			if (!visible && wasVisible && _RELEASE_OFFSCREEN && activeEngine === 'rlottie' && !eager) {
				clearTimeout(_offscreenT);
				_offscreenT = setTimeout(() => {
					_offscreenT = null;
					if (!visible && mounted && activeEngine === 'rlottie') teardown_rlottie();
				}, OFFSCREEN_RELEASE_MS);
			}
			if (visible && !wasVisible) {
				if (activeEngine === 'rlottie' && !eager) ensureLoaded();
				if (isSkottieEngine(activeEngine)) {
					// Cell just entered the viewport. Tell the worker
					// to start rect-checking + drawing it, then queue
					// the animation. If the cell's `ensureStage` await
					// hasn't returned yet, skottieCellId is still null
					// and the setCellVisible call is a no-op — the
					// register path captures the live `visible` state
					// when it does run.
					const mod = skottieMod || skModule(activeEngine);
					if (skottieCellId != null) {
						if (skottieCanvasPath) mod.setCanvasCellVisible(skottieCellId, true);
						else mod.setCellVisible(skottieCellId, true);
					}
					queueSkottieAnimation();
				}
			} else if (!visible && wasVisible && isSkottieEngine(activeEngine)) {
				// Cell just left the viewport. Mark invisible to the
				// worker so the render loop stops getRect-ing it and
				// drawing its tile — the actual perf win of the
				// viewport-driven visibility scheme. Also cancel
				// pending builds so the queue's bandwidth goes to
				// cells the user is actually looking at; already-built
				// animations stay loaded for instant re-entry.
				const mod = skottieMod || skModule(activeEngine);
				if (skottieCellId != null) {
					if (skottieCanvasPath) mod.setCanvasCellVisible(skottieCellId, false);
					else mod.setCellVisible(skottieCellId, false);
				}
				if (skottieAnimQueued && skottieUrl && !mod.isAnimationLoaded(skottieUrl)) {
					releaseSkottieAnimation();
				}
			}
			updatePlay();
		}, { root, rootMargin: '120px' });
		if (stack) observer.observe(stack);
	});

	onDestroy(() => {
		mounted = false;
		clearTimeout(_offscreenT);
		observer?.disconnect();
		teardownCurrent(activeEngine);
	});

	// Engine swap: tear down the old engine's resources, reset the
	// thumb-visible state, and kick off the new engine if the cell is
	// currently visible. The `activeEngine` guard in the async load
	// functions makes any in-flight work from the old engine a no-op.
	$effect(() => {
		const next = engine;
		if (activeEngine === null || activeEngine === next) return;
		const prev = activeEngine;
		activeEngine = next;
		teardownCurrent(prev);
		painted = false;
		// Skottie variants load eagerly; rlottie waits for IO visibility.
		if (isSkottieEngine(next) || visible) ensureLoaded();
	});

	$effect(() => { hovering; visible; updatePlay(); });
</script>

{#if flag}
	<img class="tg-sticker tg-flag" src={tgFlagUrl(cp)} alt={title} {title}
		style="width:{size}px;height:{size}px" loading="lazy" />
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span bind:this={stack} class="tg-stack" {title}
		style="width:{size}px;height:{size}px"
		onmouseenter={() => (hovering = true)}
		onmouseleave={() => (hovering = false)}>
		{#if adaptive && spritePos}
			<!-- Adaptive placeholder: use the silhouette as a MASK painted
			     with the live --ink so it matches the theme (and the
			     recoloured animation) instead of the sprite's baked colour. -->
			<span class="tg-thumb tg-thumb-tint" class:hidden={painted}
				style="-webkit-mask-image:url({sprite.sheetUrl}); mask-image:url({sprite.sheetUrl});
				       -webkit-mask-position:{-spritePos.x * spriteScale}px {-spritePos.y * spriteScale}px;
				       mask-position:{-spritePos.x * spriteScale}px {-spritePos.y * spriteScale}px;
				       -webkit-mask-size:{sprite.sheetW * spriteScale}px {sprite.sheetH * spriteScale}px;
				       mask-size:{sprite.sheetW * spriteScale}px {sprite.sheetH * spriteScale}px;"></span>
		{:else if adaptive && thumbUrl}
			<span class="tg-thumb tg-thumb-tint tg-thumb-tint-img" class:hidden={painted}
				style="-webkit-mask-image:url({thumbUrl}); mask-image:url({thumbUrl});"></span>
		{:else if spritePos}
			<!-- CSS backdrop covers the cell from mount until the
			     worker has drawn 3 confirmed frames into the canvas
			     tile (`painted` flips true). It's perfectly aligned
			     with the canvas tile (same sheet, same coords), so
			     until the moment it hides the canvas pixels above
			     match the backdrop pixel-for-pixel. After it hides,
			     the canvas is the sole source of truth — no ghosting
			     through transparent edges, no overlap. -->
			<span class="tg-thumb" class:hidden={painted}
				style="background-image:url({sprite.sheetUrl});
				       background-position:{-spritePos.x * spriteScale}px {-spritePos.y * spriteScale}px;
				       background-size:{sprite.sheetW * spriteScale}px {sprite.sheetH * spriteScale}px;
				       background-repeat:no-repeat;"></span>
		{:else if thumbUrl}
			<img class="tg-thumb" class:hidden={painted} src={thumbUrl}
				alt="" decoding="async" loading="eager" />
		{/if}
		<!-- Per-cell render target. In the worker ('skottie-worker')
		     engine this canvas is transferControlToOffscreen()'d to the
		     render worker, which blits animation frames straight into it —
		     it flows with the DOM so scrolling is native (no lag). In
		     rlottie mode it's drawn locally via a 2D context. The
		     {#key engine} wrapper recreates the element on an engine swap
		     so a canvas that was transferred (and can't get a 2D context,
		     or be transferred twice) is replaced by a fresh one for the
		     new engine. -->
		{#key engine}
			<canvas bind:this={canvas} class="tg-canvas" width={px} height={px}></canvas>
		{/key}
	</span>
{/if}

<style>
	.tg-sticker { display: inline-block; flex-shrink: 0; line-height: 0; }
	.tg-flag { object-fit: contain; }
	.tg-stack {
		display: inline-block;
		position: relative;
		flex-shrink: 0;
		line-height: 0;
	}
	.tg-thumb,
	.tg-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	/* Adaptive placeholder: the silhouette (sprite cell or thumb image) is
	   used as an alpha mask and filled with the live --ink, so the
	   placeholder is the theme's text colour, not the sprite's baked tone.
	   --ink is a CSS var, so this recolours instantly on a theme switch. */
	.tg-thumb-tint {
		background-color: var(--ink);
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
	}
	.tg-thumb-tint-img {
		-webkit-mask-position: center;
		mask-position: center;
		-webkit-mask-size: contain;
		mask-size: contain;
	}
	/* Placeholder sits ON TOP of the per-cell canvas and covers it until
	   the animation is solidly rendering (`painted`). This is what keeps
	   the start-of-animation flicker hidden: the canvas's first, still-
	   settling frames render UNDERNEATH the static thumb, and only once
	   the worker confirms the handoff does the thumb fade away to reveal a
	   smoothly-looping animation. (In the legacy overlay engine the shared
	   stage canvas draws at z-index 9999, above both of these, so this
	   ordering doesn't affect it.) */
	.tg-canvas { z-index: 1; background: transparent; }
	.tg-thumb { z-index: 2; transition: opacity 0.14s ease; }
	/* Fade out instead of display:none so the reveal is a smooth cross-
	   fade rather than a hard pop. pointer-events:none lets clicks reach
	   the cell once it's transparent. */
	.tg-thumb.hidden { opacity: 0; pointer-events: none; }
</style>
