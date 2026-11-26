<script>
	// A guest's slide deck (sidebar → Archive → a guest's Slides link).
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';
	import DeckViewer from '$lib/components/DeckViewer.svelte';

	let { data } = $props();

	onMount(() => pageTitle.set(data.deck.person));
</script>

<svelte:head>
	<title>{data.deck.title} · {data.deck.person} · eating.computer</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<DeckViewer deck={data.deck} />
