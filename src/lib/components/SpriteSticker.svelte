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
		engineMode
	} from '$lib/telegram-emoji-store.js';
	import { acquire, release } from '$lib/lottie-spritesheet.js';
	import * as SkMain from '$lib/skottie-stage.js';
	import * as SkWorker from '$lib/skottie-stage-worker.js';
	// Resolve the right Skottie stage module based on engine. Both
	// modules export the identical API, so dispatch is just module
	// selection — every call site below uses `stage.<fn>` and the right
	// implementation runs underneath.
	function skModule(eng) {
		return eng === 'skottie-worker' ? SkWorker : SkMain;
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
	// Remember which Skottie module owns the current cell so teardown
	// hits the right one even after an engine swap mid-flight.
	let skottieMod = null;
	const isSkottieEngine = (eng) => eng === 'skottie' || eng === 'skottie-worker';

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
			// Fires after the worker's 3rd confirmed paint of this
			// cell — canvas has visibly taken over, so the CSS
			// backdrop can drop out.
			onFirstPaint: () => { if (mounted) painted = true; },
			// Worker's surface was wiped (tab switch, resize). Bring
			// the backdrop back to cover the cell while the canvas
			// rebuilds; next 3-paint cycle will hide it again.
			onSurfaceLost: () => { if (mounted) painted = false; }
		});
		mod.setCellVisible(skottieCellId, true);

		// Static packs (MadEmoji etc) have no animation.
		if (paused) return;

		// Eager cells (tab icons) queue their animation immediately —
		// they're always-visible. Everything else waits for IO.
		if (eager) await queueSkottieAnimation();
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
		if (skottieCellId != null) mod.unregisterCell(skottieCellId);
		if (skottieUrl) mod.releaseAnimation(skottieUrl);
		skottieCellId = null;
		skottieUrl = null;
		skottieAnimQueued = false;
		skottieMod = null;
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
			if (visible && !wasVisible) {
				if (activeEngine === 'rlottie' && !eager) ensureLoaded();
				if (isSkottieEngine(activeEngine)) queueSkottieAnimation();
			} else if (!visible && wasVisible && isSkottieEngine(activeEngine)) {
				// Cell just left the viewport. If its animation is
				// still pending (not built yet), cancel — user scrolled
				// past before we got to it; let the visible cells take
				// the queue's bandwidth instead.
				const mod = skottieMod || skModule(activeEngine);
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
		{#if spritePos}
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
		<!-- The canvas is the rlottie engine's render target. Skottie draws
		     into its own shared full-viewport WebGL canvas at z-index 9999
		     and uses the cell's bounding-rect for placement, so this
		     canvas is just inert in that mode. -->
		<canvas bind:this={canvas} class="tg-canvas" width={px} height={px}></canvas>
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
	/* CSS backdrop sits underneath the canvas. */
	.tg-thumb { z-index: 0; }
	/* Canvas sits on top, transparent by default — its pixels (drawn
	   by rlottie per-cell, or covered by the worker's stage canvas in
	   Skottie mode) appear over the backdrop. */
	.tg-canvas { z-index: 1; background: transparent; }
	.tg-thumb.hidden { display: none; }
</style>
