<script>
	import AppHeader from '$lib/components/AppHeader.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Playground — eating.computer</title></svelte:head>

<div class="shell">
	<AppHeader currentClass={data.currentClass} allClasses={data.allClasses} user={data.currentUser ?? null} />

	<main>
		<div class="page-header">
			<h1>Playground</h1>
			<p class="subtitle">A creative sandbox for experimentation</p>
		</div>

		<div class="empty-state">
			<div class="empty-icon">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
			</div>
			<h2>Coming soon</h2>
			<p>This space will be a creative sandbox for experiments and play.</p>
		</div>
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	main {
		flex: 1;
		padding: 2rem 1.5rem;
		padding-top: calc(2rem + 52px);
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.page-header { margin-bottom: 1.75rem; }
	h1 {
		font-family: 'Avara', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 0.25rem;
		color: var(--ink);
	}
	.subtitle {
		font-size: 0.85rem;
		color: #a09688;
		margin: 0;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 4rem 1rem;
		color: #a09688;
		gap: 0.75rem;
	}
	.empty-icon {
		color: #c8c1b4;
		margin-bottom: 0.5rem;
	}
	.empty-state h2 {
		font-family: 'Avara', serif;
		font-size: 1.3rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0;
	}
	.empty-state p {
		font-size: 0.9rem;
		max-width: 340px;
		line-height: 1.5;
		margin: 0;
	}

	@media (max-width: 640px) {
		main {
			padding: 1.25rem 1rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		h1 { font-size: 1.5rem; }
	}
</style>
