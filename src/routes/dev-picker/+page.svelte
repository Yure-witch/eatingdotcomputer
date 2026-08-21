<script>
	// Harness: mounts the ExpressionPicker on its own so its chrome can be looked
	// at without a session — deliberately outside /app, so there's no auth gate
	// and it's reachable in prod at /dev-picker. Every callback is a no-op, it
	// reads nothing and writes nothing, and it's noindex'd below so it can't turn
	// up in search. Delete the folder when it stops being useful.
	import ExpressionPicker from '$lib/components/ExpressionPicker.svelte';

	const noop = () => {};
</script>

<svelte:head>
	<title>picker preview</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="dev-dock">
	<ExpressionPicker
		onSelectEmoji={noop}
		onInsertKitchen={noop}
		onInsertCustomEmoji={noop}
		onInsertTgEmoji={noop}
		onClose={noop}
		onBackspace={noop}
	/>
</div>

<style>
	.dev-dock {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 50;
	}
	:global(body) { background: var(--paper, #fff); }
</style>
