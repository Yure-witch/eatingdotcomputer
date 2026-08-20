<script>
	import { onMount } from 'svelte';
	import ThemePicker from '$lib/components/ThemePicker.svelte';
	import MobileThemePicker from '$lib/components/MobileThemePicker.svelte';

	// Phones get the stripped-down picker (mode / palette / vibrance +
	// a live sample); desktop keeps the full Material 3 control surface.
	// This is a form-factor split, not a touch split — a small window on
	// a laptop wants the simple version too — so it keys off width, the
	// same 640px breakpoint the rest of the app shell uses.
	let mobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia('(max-width: 640px)');
		const u = () => (mobile = mq.matches);
		u();
		mq.addEventListener?.('change', u);
		return () => mq.removeEventListener?.('change', u);
	});
</script>

<svelte:head><title>Customize theme — eating.computer</title></svelte:head>

<!--
	Theme editor inherits the global AppHeader + sidebar (desktop) +
	bottom-nav (mobile) from /app/+layout.svelte, just like every other
	app route, so the theme switcher / class switcher / notification
	bell are accessible from here too.
-->
<main class="theme-page">
	<div class="picker-wrap">
		{#if mobile}
			<h1 class="m-title">Color scheme</h1>
			<MobileThemePicker />
		{:else}
			<ThemePicker />
		{/if}
	</div>
</main>

<style>
	.theme-page {
		min-height: 100dvh;
		background: var(--paper);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		/* Top padding clears the fixed AppHeader (52px tall) — same
		   formula the other /app/* pages use. */
		padding: calc(2rem + 52px) 1.5rem 4rem;
		box-sizing: border-box;
	}
	.picker-wrap {
		width: 100%;
		max-width: 900px;
	}
	.m-title {
		font-family: 'Avara', serif;
		font-weight: 400;
		font-size: 1.35rem;
		margin: 0 0 0.75rem;
		color: var(--ink);
	}

	@media (max-width: 640px) {
		.theme-page {
			/* Clear the fixed AppHeader — its REAL measured height
			   (--header-h, set by AppHeader's ResizeObserver, inclusive
			   of the notch inset on native). The previous flat 1.25rem
			   dropped this clearance, so the top bar covered the picker. */
			padding: calc(var(--header-h, 52px) + 1rem) 0.9rem
			         calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
	}
</style>
