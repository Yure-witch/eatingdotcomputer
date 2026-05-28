<script>
	import { onMount, onDestroy } from 'svelte';
	import lottie from 'lottie-web';
	import { tgAnimatedUrl, tgFlagUrl, tgcUrl, fetchLottie, isStaticPack, STATIC_FRAME_INDEX } from '$lib/telegram-emoji-store.js';
	import { tryPlay as _tryPlay, yieldPlay as _yieldPlay } from '$lib/lottie-throttle.js';

	let {
		cp,
		flag = false,
		short = null,
		id = null,
		size = 32,
		loop = true,
		mode = 'visible', // 'visible' | 'hover' | 'once'
		title = '',
		root = null       // IntersectionObserver root — the scrollable parent
	} = $props();

	const isCustom = $derived(!!(short && id));
	const paused = $derived(isCustom && isStaticPack(short));

	let host = $state(null);
	let anim = null;
	let observer = null;
	let visible = $state(false);
	let hovering = $state(false);
	let loaded = false;
	let isPlaying = false; // are we currently holding a throttle slot?

	function clampedStaticFrame() {
		const total = anim?.totalFrames || 1;
		return Math.min(STATIC_FRAME_INDEX, Math.max(0, total - 1));
	}

	async function ensureLoaded() {
		if (loaded || flag || !host) return;
		loaded = true;
		const url = isCustom ? tgcUrl(short, id) : tgAnimatedUrl(cp);
		const data = await fetchLottie(url);
		if (!data || !host) return;
		anim = lottie.loadAnimation({
			container: host,
			renderer: 'svg',
			loop: mode === 'once' ? false : loop,
			autoplay: false,
			animationData: data,
			rendererSettings: { progressiveLoad: true }
		});
		// Disable subframe interpolation — lottie-web defaults to rendering at
		// fractional frame positions, which on Lotties with track mattes/masks
		// can briefly produce partially-resolved layer state (the one-frame flash).
		// Locking to integer frames matches what Telegram's rlottie does.
		try { anim.setSubframe(false); } catch {}
		if (paused) anim.goToAndStop(clampedStaticFrame(), true);
		else updatePlay();
	}

	function updatePlay() {
		if (!anim || paused) return;
		const want = mode === 'hover' ? hovering : visible;
		if (want && !isPlaying) {
			if (_tryPlay()) { isPlaying = true; anim.play(); }
		} else if (!want && isPlaying) {
			anim.pause();
			isPlaying = false;
			_yieldPlay();
			if (mode === 'hover') anim.goToAndStop(clampedStaticFrame(), true);
		}
	}

	onMount(() => {
		if (flag) return;
		observer = new IntersectionObserver((entries) => {
			visible = entries[0].isIntersecting;
			if (visible) ensureLoaded();
			updatePlay();
		}, { root, rootMargin: '120px' });
		observer.observe(host);
	});

	onDestroy(() => {
		observer?.disconnect();
		if (isPlaying) { _yieldPlay(); isPlaying = false; }
		try { anim?.destroy(); } catch {}
		anim = null;
	});

	$effect(() => { hovering; visible; updatePlay(); });
</script>

{#if flag}
	<img class="tg-sticker tg-flag" src={tgFlagUrl(cp)} alt={title} {title}
		style="width:{size}px;height:{size}px" loading="lazy" />
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={host} class="tg-sticker" {title}
		style="width:{size}px;height:{size}px"
		onmouseenter={() => (hovering = true)}
		onmouseleave={() => (hovering = false)}></div>
{/if}

<style>
	.tg-sticker { display: inline-block; flex-shrink: 0; line-height: 0; }
	.tg-flag { object-fit: contain; }
</style>
