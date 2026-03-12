<script>
	let { children, data } = $props();
</script>

<div class="shell">
	<header>
		<span class="wordmark">eating.computer</span>
	</header>
	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(body) { margin: 0; }

	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper, #f7f2ea);
		font-family: inherit;
	}

	header {
		padding: 1.25rem 2rem;
		border-bottom: 1.5px solid #ddd7cc;
	}

	.wordmark {
		font-family: 'Cambridge', serif;
		font-size: 1.2rem;
		color: var(--ink, #1a1a1a);
	}

	main {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
	}
</style>
