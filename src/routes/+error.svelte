<script>
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const err = $derived($page.error ?? {});
	let copied = $state(false);

	function copyDetail() {
		const text = `[${status}] ${err.code ? err.code + ' — ' : ''}${err.message}\n${err.detail ?? ''}`;
		navigator.clipboard?.writeText(text).then(() => {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}).catch(() => {});
	}
</script>

<svelte:head><title>{status} — eating.computer</title></svelte:head>

<main class="err-page">
	<div class="err-card">
		<div class="err-status">{status}</div>
		<h1 class="err-title">
			{#if status === 404}Page not found{:else if status >= 500}Something broke{:else}Error{/if}
		</h1>

		{#if err.code}<div class="err-code">{err.code}</div>{/if}
		<p class="err-message">{err.message || 'Unknown error'}</p>

		{#if err.detail}
			<pre class="err-detail">{err.detail}</pre>
		{/if}

		<div class="err-actions">
			<button class="err-btn" onclick={() => location.reload()}>Reload</button>
			<a class="err-btn" href="/app">Go to app</a>
			{#if err.detail || err.message}
				<button class="err-btn err-btn-ghost" onclick={copyDetail}>{copied ? 'Copied!' : 'Copy error'}</button>
			{/if}
		</div>
	</div>
</main>

<style>
	.err-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: var(--paper, #f7f2ea);
		color: var(--ink, #1a1a1a);
		box-sizing: border-box;
	}
	.err-card {
		width: 100%;
		max-width: 560px;
		background: var(--md-sys-color-surface, #fff);
		border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
		border-radius: 16px;
		padding: 1.75rem;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
	}
	.err-status {
		font-family: 'Avara', serif;
		font-size: 3rem;
		font-weight: 700;
		line-height: 1;
		color: var(--accent, #c0392b);
	}
	.err-title {
		font-family: 'Avara', serif;
		font-weight: 400;
		font-size: 1.4rem;
		margin: 0.4rem 0 1rem;
	}
	.err-code {
		display: inline-block;
		font-family: ui-monospace, monospace;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		background: #c0392b;
		color: #fff;
		padding: 0.15rem 0.5rem;
		border-radius: 6px;
		margin-bottom: 0.5rem;
	}
	.err-message {
		font-size: 0.95rem;
		line-height: 1.5;
		margin: 0 0 1rem;
		word-break: break-word;
	}
	.err-detail {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
		line-height: 1.45;
		background: #1e1e2e;
		color: #cdd6f4;
		border-radius: 10px;
		padding: 0.75rem 0.9rem;
		margin: 0 0 1.25rem;
		overflow-x: auto;
		white-space: pre;
		max-height: 40vh;
	}
	.err-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.err-btn {
		appearance: none;
		border: 1px solid var(--border, rgba(0, 0, 0, 0.15));
		background: var(--ink, #1a1a1a);
		color: var(--paper, #fff);
		border-radius: 9px;
		padding: 0.5rem 1rem;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.err-btn-ghost { background: transparent; color: var(--ink, #1a1a1a); }
	.err-btn:hover { opacity: 0.88; }
</style>
