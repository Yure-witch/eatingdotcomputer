<script>
	// The service worker serves this page when a navigation fails offline
	// (see src/service-worker.js). Keep it self-sufficient: no data loads,
	// nothing that needs the network — the JS/CSS it uses are precached.
	function retry() {
		try {
			// Go where the user was headed, not to /offline itself.
			const back = document.referrer && new URL(document.referrer).origin === location.origin
				? document.referrer
				: '/app';
			location.replace(back);
		} catch {
			location.replace('/app');
		}
	}
</script>

<svelte:head><title>Offline — eating.computer</title></svelte:head>

<main>
	<div class="card">
		<img class="mark" src="/favicon.svg" alt="" width="64" height="64" />
		<h1>You're offline</h1>
		<p>eating.computer needs a connection for live class chat and assignments. Anything already loaded keeps working — the rest is waiting for you when you're back.</p>
		<button class="btn-retry" onclick={retry}>Try again</button>
	</div>
</main>

<style>
	main {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex; align-items: center; justify-content: center;
		padding: 2rem 1.25rem;
		background: var(--paper);
	}
	.card {
		max-width: 360px; text-align: center;
		display: flex; flex-direction: column; align-items: center; gap: 0.9rem;
	}
	.mark { border-radius: 16px; }
	h1 { font-family: 'Avara', serif; font-size: 1.8rem; font-weight: 400; margin: 0; color: var(--ink); }
	p { margin: 0; font-size: 0.9rem; color: var(--muted-fg); line-height: 1.55; }
	.btn-retry {
		margin-top: 0.35rem;
		padding: 0.6rem 1.5rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 10px;
		font-family: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer;
	}
	.btn-retry:hover { opacity: 0.85; }
</style>
