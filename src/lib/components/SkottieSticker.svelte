<script>
	import { onMount, onDestroy } from 'svelte';
	import {
		tgAnimatedUrl,
		tgFlagUrl,
		tgcUrl,
		fetchLottie,
		isStaticPack,
		STATIC_FRAME_INDEX
	} from '$lib/telegram-emoji-store.js';
	import {
		ensureStage,
		loadAnimation,
		releaseAnimation,
		registerCell,
		setCellVisible,
		unregisterCell
	} from '$lib/skottie-stage.js';

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
	const url = $derived(isCustom ? tgcUrl(short, id) : tgAnimatedUrl(cp));

	// Cell is a transparent div — the shared skottie-stage overlay canvas
	// renders the animation into the cell's getBoundingClientRect tile every
	// frame. No per-cell canvas, no per-cell WebGL context.
	let host = $state(null);
	let observer = null;
	let cellId = null;
	let registeredUrl = null;
	let visible = false;
	let hovering = $state(false);
	let mounted = true;

	async function ensureLoaded() {
		if (cellId != null || flag || !host) return;
		const u = url;
		await ensureStage();
		const data = await fetchLottie(u);
		if (!data || !host || !mounted) return;
		await loadAnimation(u, data);
		if (!mounted) { releaseAnimation(u); return; }
		registeredUrl = u;
		cellId = registerCell({
			url: u,
			getRect: () => host?.getBoundingClientRect() ?? null,
			paused,
			paintIndex: paused ? STATIC_FRAME_INDEX : null,
			loop
		});
		updateVisibility();
	}

	function updateVisibility() {
		if (cellId == null) return;
		const want = mode === 'hover' ? hovering : visible;
		setCellVisible(cellId, want);
	}

	onMount(() => {
		if (flag) return;
		observer = new IntersectionObserver((entries) => {
			visible = entries[0].isIntersecting;
			if (visible) ensureLoaded();
			updateVisibility();
		}, { root, rootMargin: '120px' });
		observer.observe(host);
	});

	onDestroy(() => {
		mounted = false;
		observer?.disconnect();
		if (cellId != null) unregisterCell(cellId);
		if (registeredUrl) releaseAnimation(registeredUrl);
		cellId = null;
		registeredUrl = null;
	});

	// Re-evaluate visibility when hover state changes (visible state already
	// triggers updateVisibility from the IO callback).
	$effect(() => { hovering; updateVisibility(); });
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
