<script>
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { updated } from '$app/stores';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

{#if $updated}
	<div class="update-banner">
		<span>A new version is available.</span>
		<button onclick={() => window.location.reload()}>Reload</button>
	</div>
{/if}

<style>
	.update-banner {
		position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
		background: #1a1a1a; color: #f7f2ea;
		border: 1px solid #444; border-radius: 10px;
		padding: 0.6rem 1rem; z-index: 999;
		display: flex; align-items: center; gap: 1rem;
		font-size: 0.85rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
		white-space: nowrap;
	}
	.update-banner button {
		background: #f7f2ea; color: #1a1a1a;
		border: none; border-radius: 6px;
		padding: 0.3rem 0.75rem; font-family: inherit;
		font-size: 0.82rem; font-weight: 600; cursor: pointer;
	}
</style>
