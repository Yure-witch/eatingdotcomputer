<script>
	import { onMount, onDestroy } from 'svelte';
	import { tgAnimatedUrl, tgFlagUrl, tgcUrl, fetchLottie, isStaticPack, STATIC_FRAME_INDEX } from '$lib/telegram-emoji-store.js';
	import { mount as rlottieMount, getFrame, peekCachedFrame, destroy as rlottieDestroy } from '$lib/rlottie-pool.js';

	let {
		cp,
		flag = false,
		short = null,
		id = null,
		size = 32,
		loop = true,
		mode = 'visible',
		title = '',
		root = null
	} = $props();

	const isCustom = $derived(!!(short && id));
	const paused = $derived(isCustom && isStaticPack(short));

	let canvas = $state(null);
	let observer = null;
	let visible = $state(false);
	let hovering = $state(false);

	let animId = null;
	let totalFrames = 0;
	let frameRate = 60;
	let rafHandle = null;
	let startTime = 0;
	let lastPainted = -1;
	let running = false;

	const px = $derived(Math.round(size * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1) * 2));

	async function ensureLoaded() {
		if (animId || flag || !canvas) return;
		const url = isCustom ? tgcUrl(short, id) : tgAnimatedUrl(cp);
		const data = await fetchLottie(url);
		if (!data || !canvas) return;
		totalFrames = Math.max(1, (data.op || 60) - (data.ip || 0));
		frameRate = data.fr || 60;
		try {
			animId = await rlottieMount(JSON.stringify(data), px, px);
		} catch (e) {
			console.warn('[rlottie] mount failed', e);
			return;
		}
		// Show frame 0 immediately as a still so the canvas isn't blank.
		const firstFrameNum = paused ? Math.min(STATIC_FRAME_INDEX, totalFrames - 1) : 0;
		const first = await getFrame(animId, firstFrameNum);
		if (first && canvas) drawBitmap(first);
		if (paused) return;
		// Start playing right away. The rAF loop requests each frame as it goes;
		// the pool throttles in-flight requests so frame-0 for newly-mounted cells
		// is never starved. Uncached frames hold the previous painted frame instead
		// of blanking — slight stutter on first loop, smooth on subsequent loops
		// (every frame ends up cached after one playthrough).
		startLoop();
	}

	function drawBitmap(bitmap) {
		if (!canvas || !bitmap) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		// TGS emoji have transparent backgrounds — without clearing first, the
		// previous frame composites through alpha pixels and we get stacking.
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	}

	function paintFrame(f) {
		f = Math.max(0, Math.min(totalFrames - 1, Math.floor(f)));
		if (f === lastPainted) return;
		// After prewarm, every frame should be cached — but in case eviction has
		// dropped one, fall back to the previous painted frame rather than blanking.
		const cached = peekCachedFrame(animId, f);
		if (cached) { drawBitmap(cached); lastPainted = f; }
		else getFrame(animId, f); // re-queue if evicted
	}

	function tick(now) {
		if (!running || !animId) return;
		if (!startTime) startTime = now;
		const elapsed = (now - startTime) / 1000;
		let f = Math.floor(elapsed * frameRate);
		if (loop) f = f % totalFrames;
		else if (f >= totalFrames) f = totalFrames - 1;
		paintFrame(f);
		rafHandle = requestAnimationFrame(tick);
	}

	function startLoop() {
		if (running || paused) return;
		running = true;
		startTime = 0;
		rafHandle = requestAnimationFrame(tick);
	}
	function stopLoop() {
		running = false;
		if (rafHandle) cancelAnimationFrame(rafHandle);
		rafHandle = null;
	}

	function updatePlay() {
		if (!animId || paused) return;
		const want = mode === 'hover' ? hovering : visible;
		if (want && !running) startLoop();
		else if (!want && running) stopLoop();
	}

	onMount(() => {
		if (flag) return;
		observer = new IntersectionObserver((entries) => {
			visible = entries[0].isIntersecting;
			if (visible) ensureLoaded();
			updatePlay();
		}, { root, rootMargin: '120px' });
		observer.observe(canvas);
	});

	onDestroy(() => {
		observer?.disconnect();
		stopLoop();
		if (animId) rlottieDestroy(animId);
		animId = null;
	});

	$effect(() => { hovering; visible; updatePlay(); });
</script>

{#if flag}
	<img class="tg-sticker tg-flag" src={tgFlagUrl(cp)} alt={title} {title}
		style="width:{size}px;height:{size}px" loading="lazy" />
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<canvas bind:this={canvas} class="tg-sticker" {title}
		width={px} height={px}
		style="width:{size}px;height:{size}px"
		onmouseenter={() => (hovering = true)}
		onmouseleave={() => (hovering = false)}></canvas>
{/if}

<style>
	.tg-sticker { display: inline-block; flex-shrink: 0; line-height: 0; }
	.tg-flag { object-fit: contain; }
</style>
