<script>
	import { onMount, onDestroy } from 'svelte';
	import {
		tgAnimatedUrl,
		tgDataVer,
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
		RASTER_ENGINES,
		rasterEngineFor,
		emoteHiTier,
		isAdaptivePack
	} from '$lib/telegram-emoji-store.js';
	import { acquire, release, rasterSizeFor } from '$lib/lottie-spritesheet.js';
	import { hiddenEmoteKeys, emoteKey } from '$lib/hidden-emotes.js';
	import { emotesAwake } from '$lib/emote-idle.js';
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
		forceEngine = null,
		// Raster density multiplier: the backing store rasterises at
		// size × dpr × oversample while the element still displays at
		// `size`. Chat bubbles pass 2 so sent emotes rasterise at a
		// higher resolution than picker cells and stay crisp through
		// zooms / focus previews / inline size effects.
		oversample = 1,
		// When true, render even if an instructor has hidden this emote (the
		// picker's moderation view + the Manage list pass this so the instructor
		// can see what they're hiding). Everywhere else a hidden emote renders as
		// a neutral placeholder and never loads its animation.
		ignoreHidden = false,
		// Render the preview frame and nothing else — no Lottie fetch, no atlas
		// slot, no ticking. The picker passes this when it's in "sends static"
		// mode: if that's what a tap will insert, the grid should show it.
		// Cheapest possible cell — see `paused` below for why it needs no new
		// machinery.
		staticOnly = false,
		// Target PLAYBACK fps for the rasterized bake. 0 = derive it from the
		// cell's display size (see `_maxFps`), which is what almost everything
		// should do; pass a number only to override that ladder.
		maxFps = 0
	} = $props();

	const isCustom = $derived(!!(short && id));
	// Instructor-hidden? Then don't render or load anything (unless ignoreHidden).
	const _hidden = $derived(
		!ignoreHidden && $hiddenEmoteKeys.has(emoteKey({ cp, short, id, custom: isCustom }))
	);
	// `paused` already gates every animation path: the load, the queue, the
	// rlottie draw loop and the worker's tick. A paused cell still registers
	// (cheap) but never fetches or renders, so `onFirstPaint` never fires and
	// `painted` stays false — which leaves the CSS thumb, i.e. the preview
	// frame, showing. Static mode therefore needs no new rendering path; it
	// just joins the existing one.
	const paused = $derived(staticOnly || (isCustom && isStaticPack(short)));
	// Adaptive (Telegram text_color) packs ship monochrome silhouettes meant
	// to render in the current text colour. The sprite/thumb placeholder is
	// baked in a single colour, so for these we recolour it to the live
	// --ink via a CSS mask instead of painting the baked pixels.
	const adaptive = $derived(!!(short && isAdaptivePack(short)));
	// $tgDataVer is the manifest-arrival signal. The URL builders read module
	// state Svelte cannot track, so without it a cell mounted before the
	// manifest resolved — recents mount straight from localStorage — computed
	// url '' once and NEVER repaired it. That is why recents sat on their
	// static thumbs while the TG panel (whose grid cannot even render until
	// the manifest exists) animated fine.
	const url = $derived.by(() => {
		void $tgDataVer;
		return isCustom ? tgcUrl(short, id) : tgAnimatedUrl(cp);
	});

	// When the url flips '' -> real, run the same load the mount would have.
	// Guarded: a cell that already registered is left alone.
	$effect(() => {
		if (!url || skottieCellId != null) return;
		if (isSkottieEngine(engine) || eager) ensureLoaded();
	});
	const thumbUrl = $derived(isCustom ? tgcThumbUrl(short, id) : tgThumbUrl(cp));
	const itemKey = $derived(isCustom ? spriteKeyForCustom(short, id) : spriteKeyForCp(cp));
	// Respect the store engine — which now defaults to a RASTERIZED (baked-atlas,
	// moving) engine on every platform. Those don't hold a live per-emote render
	// context, so they don't accumulate GPU surfaces and jetsam a phone's tiny
	// WebView budget the way the old live engines did. Only if a LIVE engine has
	// been explicitly selected AND we're on a touch device do we coerce to a safe
	// rasterized fallback. WHICH rasterized one is rasterEngineFor's call, off
	// the WebGPU probe — a capable phone gets the GPU atlas, not the CPU one;
	// this used to hardcode `cpu-rasterized` and so downgraded every touch
	// device, including ones that run the GPU path fine. An explicit
	// forceEngine wins.
	const _coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
	const engine = $derived.by(() => {
		if (forceEngine) return forceEngine;
		const e = $engineMode;
		if (RASTER_ENGINES.has(e)) return e;
		return _coarse ? rasterEngineFor(e) : e;
	});

	const sprite = $derived($spriteSheet);
	const spritePos = $derived(sprite?.items?.[itemKey] || null);
	const spriteScale = $derived(sprite ? size / sprite.cellPx : 0);

	let stack = $state(null);
	let canvas = $state(null);
	let observer = null;
	let visible = $state(false);
	let hovering = $state(false);
	let mounted = true;
	// Free a cell's rendering resources after it's been off-screen this long;
	// they're re-acquired automatically when it scrolls back. Bounds memory to
	// ~the visible set instead of every emote ever shown — on iOS's tight
	// WebView budget that runaway is what got the app jetsammed.
	//
	// This used to be touch-only AND rlottie-only, which meant the engines
	// everyone actually runs never released anything: an off-screen cell kept
	// its parsed animation and its whole atlas frame set, forever, on the
	// theory that re-entry had to be instant. The persistent frame cache is
	// what makes that theory obsolete — a released emote comes back via
	// diskHydrate, no Lottie fetch and no re-parse — so releasing is cheap
	// enough to do on EVERY engine, on every device, half a second after the
	// cell leaves the (120px-margined) viewport. Scrolling back within that
	// half second cancels it, so a fling never thrashes.
	const _RELEASE_OFFSCREEN = true;
	const OFFSCREEN_RELEASE_MS = 500;
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
	let registeredPx = 0;      // size `registeredUrl` was acquired at — release needs both
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

	// Progressive resolution (LOD). The PRIMARY canvas always bakes FAST at
	// native res (cheap, instant). Then — only on a high-end device, only after
	// the primary has actually rendered, and only if the cell stays closely on
	// screen ~3s — a separate HIGH-RES canvas is overlaid, baked at the crisp
	// `oversample` target (2×) + 1.5× fps, and CROSS-FADED in over the primary
	// (no flash / gap). Cells that scroll past never pay for the high-res bake.
	const _dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 2;
	const _targetOS = $derived(Math.max(1, oversample || 1));
	// High-mem tier bakes every emote at the FULL oversample density from frame
	// one ("2x for all") — no progressive low→high dwell. Low-mem starts at 1×
	// density and only reaches full via the 3s crossfade overlay (if it ever
	// qualifies, which on low-mem it does not — emoteHiTier is false there).
	const px = $derived(Math.round(size * _dpr * ($emoteHiTier ? _targetOS : Math.min(1, _targetOS))));
	// Frame rate by display size, matching the resolution ladder in the worker:
	// the bigger and more detailed the emote is on screen, the more of both it
	// gets. A 20px tab icon at 60fps is 60 baked frames nobody can perceive; a
	// chat-sent emote at 30 reads as choppy because it's big enough to see the
	// steps. Every rung divides 60 and 120 evenly — an uneven rate lands the
	// frame index on a 3-2-3-2 cadence, which looks like skipping (see
	// PICKER_FPS). Callers can still override by passing `maxFps`.
	const _maxFps = $derived(
		maxFps > 0 ? maxFps
		: size <= 24 ? 15      // tab icons
		: size <= 44 ? 20      // picker cells, recents, chat-sent emotes
		: size <= 64 ? 30      // enlarged / focused
		: 60                   // hero sizes, where the steps would show
	);
	const _hiPx = $derived(Math.round(size * _dpr * _targetOS));              // overlay (crisp)
	let _lodTimer = null;
	let hiActive = $state(false);   // the high-res overlay canvas is mounted
	let hiCanvas = $state(null);
	let hiCellId = null;
	let hiOpacity = $state(0);      // 0 → 1 cross-fade once the overlay paints
	let _hiFadeT = null;

	// ──────────────────────────────────────────────────────────────────
	//  Rlottie path
	// ──────────────────────────────────────────────────────────────────
	const SETTLE_MS = 150;

	async function ensureLoaded_rlottie() {
		if (entry || flag || !canvas || paused) return;
		const u = url;
		if (!u) return; // manifest not landed — the url-arrival effect re-calls us
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

		// Rasterise at this cell's real pixel size (snapped up to the shared
		// ladder), not the old fixed 48. `registeredPx` has to travel with the
		// url to every release: the cache is keyed url@px now, and releasing
		// against the wrong size decrements a different entry and leaks this
		// one's frames.
		const srcPx = rasterSizeFor(px);
		let result;
		try { result = await acquire(u, data, srcPx); }
		catch (e) { console.warn('[sprite] rasterise failed', e); return; }
		if (!mounted || activeEngine !== 'rlottie') { release(u, srcPx); return; }
		entry = result;
		registeredUrl = u;
		registeredPx = srcPx;
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
		// On touch, also gate on the global idle signal: after ~45s of no
		// interaction emotes freeze (loops stop) so an idle chat does ~zero GPU
		// work; any activity wakes them. Desktop ignores it (always loops).
		const awake = !_coarse || $emotesAwake;
		const want = (mode === 'hover' ? hovering : (eager || visible)) && awake;
		if (want && !running) startLoop_rlottie();
		else if (!want && running) stopLoop_rlottie();
	}
	// React to the awake signal flipping (idle ↔ active) so loops start/stop.
	$effect(() => { void $emotesAwake; updatePlay_rlottie(); });
	function teardown_rlottie() {
		painted = false; // same contract as the skottie path — thumb, never blank
		stopLoop_rlottie();
		if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
		if (registeredUrl) release(registeredUrl, registeredPx);
		entry = null;
		registeredUrl = null;
		registeredPx = 0;
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
		if (!u) return; // manifest not landed — the url-arrival effect re-calls us
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
				// High-mem tier bakes the primary at full quality AND 1.5× fps up
				// front (no overlay stage); low-mem stays at base fps.
				fpsScale: $emoteHiTier ? 1.5 : 1,
				maxFps: _maxFps,
				// Fires after the confirmed paints of this cell — the canvas now
				// holds the animation, so the CSS thumb backdrop can drop out.
				onFirstPaint: () => { if (mounted) painted = true; }
			});
			if (paused) return;
			if (eager || visible) await queueSkottieAnimation();
			return;
		}

		// LEGACY shared-overlay path (main-thread 'skottie' engine).
		// `!paused`: hiding the thumb hands the cell over to the overlay canvas,
		// which never draws a paused cell — the cell would go blank.
		if (!paused && mod.isAnimationLoaded?.(u)) painted = true;
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

	// Free this cell's animation resources now that it's been off-screen a
	// while — unless the grid is still being scrolled, in which case re-arm and
	// wait. A cell 130px above the viewport mid-drag is off-screen by the IO's
	// reckoning but is about to be needed again, and tearing it down there buys
	// a full re-bake on re-entry: the emotes visibly stopping and restarting as
	// you scroll.
	function releaseOffscreen() {
		_offscreenT = null;
		if (visible || !mounted) return;
		if (SkWorker.isScrolling?.()) {
			_offscreenT = setTimeout(releaseOffscreen, OFFSCREEN_RELEASE_MS);
			return;
		}
		if (activeEngine === 'rlottie') teardown_rlottie();
		// Skottie/raster: drop the refcount. At zero the worker deletes the
		// parsed animation AND frees its atlas slots (freeFrameCache), which is
		// the memory that used to accumulate for the whole session. The canvas
		// keeps its last drawn frame — off-screen, so nothing flashes, and
		// re-entry re-queues from the disk cache.
		else if (isSkottieEngine(activeEngine)) releaseSkottieAnimation();
	}

	function releaseSkottieAnimation() {
		if (!skottieUrl) return;
		// Bring the thumb back. `painted` hides it and hands the cell over to
		// the canvas — but the frames that canvas was drawing are about to be
		// freed, so leaving it hidden is what leaves an EMPTY cell behind. The
		// thumb is pixel-aligned with the canvas, so re-covering is invisible;
		// the cell just goes still until it re-bakes. A cell should never be
		// blank, only ever stopped.
		painted = false;
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
		if (_hidden) return; // instructor-hidden — never load its animation
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
			// VIEWPORT intersection, not intersection with the inner scroller.
			// With the scroller as root, a cell in a pane the user paged AWAY
			// from still "intersects" — cell and root moved together, so the
			// observer never even fired on the page-change — and every cell in
			// every visited pane kept animating and baking behind the active
			// one. Against the viewport, paged-away cells genuinely leave and
			// report it, and their lanes/blits go to what is actually on
			// screen. (This is also why the old rootBounds pane-detection below
			// could never work: no event, no callback.)
			visible = entries[0].isIntersecting;
			// Paged away vs scrolled past — the two want opposite treatment:
			// scrolled-past frames should be released, but paging away and back
			// is a round trip the user experiences as returning to where they
			// were, so the artwork is held. With the viewport as root the
			// signal is the DIRECTION of exit: panes travel horizontally,
			// scrolling exits vertically. boundingClientRect is viewport-space
			// under a null root.
			const tb = entries[0].boundingClientRect;
			const paneOffscreen = !visible && !!tb && typeof window !== 'undefined'
				&& (tb.right <= 0 || tb.left >= (window.innerWidth || 0));
			// Cancel any pending off-screen frame release the moment we're back.
			if (visible && _offscreenT) { clearTimeout(_offscreenT); _offscreenT = null; }
			// Went off-screen → schedule freeing this cell's animation resources
			// (re-acquired by the `visible && !wasVisible` branch below when it
			// scrolls back). `eager` cells — the picker's tab icons — are exempt:
			// they're permanently on screen as far as the user is concerned and
			// only read as off-screen because they live outside the grid's root.
			if (paneOffscreen) {
				// Paged away: hold everything. Nothing is accumulating while the
				// picker isn't on screen, and closing it reclaims the atlases
				// wholesale anyway (see ExpressionPicker's onDestroy), so this
				// can't grow unbounded — it just makes swiping back instant
				// instead of a re-bake of everything you were looking at.
				clearTimeout(_offscreenT);
				_offscreenT = null;
			} else if (!visible && wasVisible && _RELEASE_OFFSCREEN && !eager) {
				clearTimeout(_offscreenT);
				_offscreenT = setTimeout(releaseOffscreen, OFFSCREEN_RELEASE_MS);
			}
			// Left the viewport → cancel any pending high-res upgrade.
			if (!visible && wasVisible) { clearTimeout(_lodTimer); _lodTimer = null; }
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
					if (hiCellId != null) SkWorker.setCanvasCellVisible(hiCellId, true);
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
				// De-render the high-res overlay when it scrolls off too.
				if (hiCellId != null) SkWorker.setCanvasCellVisible(hiCellId, false);
				if (skottieAnimQueued && skottieUrl && !mod.isAnimationLoaded(skottieUrl)) {
					releaseSkottieAnimation();
				}
			}
			updatePlay();
		// root:null on purpose — see the callback. `root` is still accepted as
		// a prop so call sites don't churn, but observing against the inner
		// scroller is what made paged-away panes invisible to this observer.
		// The margin pre-warms ~a row before entry, and horizontally it means
		// the NEXT pane's cells start baking mid-swipe.
		}, { rootMargin: '120px' });
		if (stack) observer.observe(stack);
	});

	onDestroy(() => {
		mounted = false;
		clearTimeout(_offscreenT);
		clearTimeout(_lodTimer);
		clearTimeout(_hiFadeT);
		if (hiCellId != null) { SkWorker.unregisterCanvasCell?.(hiCellId); hiCellId = null; }
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
		// Drop the high-res overlay — it's specific to the old (worker) engine.
		clearTimeout(_lodTimer); _lodTimer = null;
		if (hiCellId != null) { SkWorker.unregisterCanvasCell?.(hiCellId); hiCellId = null; }
		hiActive = false; hiOpacity = 0;
		teardownCurrent(prev);
		painted = false;
		// Skottie variants load eagerly; rlottie waits for IO visibility.
		if (isSkottieEngine(next) || visible) ensureLoaded();
	});

	// High-res upgrade trigger: only once the PRIMARY has actually rendered
	// (painted), on a high-end device, for the worker atlas engine, and only if
	// there IS a crisper target. After the cell has dwelled ~3s still visible +
	// painted, mount the high-res overlay. Cancelled if it scrolls away first.
	// `px < _hiPx` is the "is there a crisper target?" gate. On high-mem the
	// primary already bakes at full density (px === _hiPx) so this is false and
	// the overlay never mounts — everything is max quality from the start.
	const _canUpgrade = $derived(
		visible && painted && !hiActive && _targetOS > 1 && $emoteHiTier
		&& px < _hiPx && engine === 'webgpu-rasterized' && skottieCanvasPath
	);
	$effect(() => {
		if (_canUpgrade) {
			if (!_lodTimer) _lodTimer = setTimeout(() => {
				_lodTimer = null;
				if (mounted && visible && painted) hiActive = true;
			}, 3000);
		} else if (_lodTimer && !visible) {
			clearTimeout(_lodTimer); _lodTimer = null;
		}
	});

	// Once the overlay <canvas> exists, register it as a second worker cell at
	// the crisp px + 1.5× fps. It bakes independently (shared built animation),
	// then cross-fades in over the still-visible primary — no flash, no gap.
	$effect(() => { if (hiActive && hiCanvas && hiCellId == null) mountHiRes(); });

	async function mountHiRes() {
		if (hiCellId != null || engine !== 'webgpu-rasterized') return;
		let target;
		try { target = hiCanvas.transferControlToOffscreen(); }
		catch { hiActive = false; return; }
		hiCellId = SkWorker.registerCanvasCell({
			url,
			canvas: target,
			w: _hiPx,
			h: _hiPx,
			paused,
			loop,
			visible: true,
			rasterized: true,
			fpsScale: 1.5,
			onFirstPaint: () => {
				if (!mounted) return;
				hiOpacity = 1; // CSS fades the crisp overlay in over the primary
				clearTimeout(_hiFadeT);
				_hiFadeT = setTimeout(() => {
					// Overlay is fully faded in — free the low-res primary.
					if (skottieCellId != null && skottieCanvasPath) {
						SkWorker.unregisterCanvasCell?.(skottieCellId);
						skottieCellId = null; skottieCanvasPath = false;
					}
				}, 260);
			}
		});
	}

	$effect(() => { hovering; visible; updatePlay(); });
</script>

{#if _hidden}
	<!-- Instructor-hidden: a neutral placeholder, no canvas, no animation load. -->
	<span class="tg-hidden-ph" title="Hidden by instructor"
		style="width:{size}px;height:{size}px"></span>
{:else if flag}
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
		<!-- High-res cross-fade overlay: mounts once the primary has rendered and
		     the cell dwells; baked crisp + higher-fps, then faded in over the
		     primary so the sharpen is seamless (no thumb flash / gap). -->
		{#if hiActive}
			<canvas bind:this={hiCanvas} class="tg-canvas tg-canvas-hi" width={_hiPx} height={_hiPx} style:opacity={hiOpacity}></canvas>
		{/if}
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
	.tg-hidden-ph {
		display: inline-block;
		flex-shrink: 0;
		border-radius: 5px;
		background: color-mix(in srgb, currentColor 12%, transparent);
		vertical-align: middle;
	}
	.tg-thumb,
	.tg-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	/* High-res overlay sits above the primary and fades in once it has painted. */
	.tg-canvas-hi { z-index: 1; transition: opacity 0.26s ease; }
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
	.tg-thumb { z-index: 2; }
	/* No cross-fade needed: the worker holds the placeholder until the whole
	   loop is baked and hands off ON the last frame — which is exactly the frame
	   the sprite thumb shows — so the thumb→canvas swap is pixel-identical. A
	   hard hide is seamless. */
	.tg-thumb.hidden { display: none; }
</style>
