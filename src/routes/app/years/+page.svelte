<script>
	// The public teaching archive, inside the app (sidebar → Archive). Same
	// content as the logged-out homepage; see $lib/archive.js.
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';
	import YearsArchive from '$lib/components/YearsArchive.svelte';

	let { data } = $props();

	onMount(() => pageTitle.set('Archive'));
</script>

<svelte:head><title>Archive · eating.computer</title></svelte:head>

<div class="years-shell">
	<main>
		<YearsArchive memberWork={data.memberWork} />
	</main>
</div>

<style>
	.years-shell {
		/* Clear the fixed AppHeader for the sticky year spines and anchors. */
		--archive-top: calc(var(--header-h, 52px) + 1rem);
		min-height: 100%;
		background: var(--paper);
	}
	main { padding-top: var(--header-h, 52px); }
</style>
