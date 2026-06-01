<script>
	import { onMount } from 'svelte';

	let { onSelect } = $props();

	let query = $state('');
	let results = $state([]);
	let loading = $state(false);
	let errorMsg = $state('');
	let nextOffset = $state(0);
	let hasMore = $state(true);
	let searchTimer = null;
	let gridEl = $state(null);

	async function fetchGifs(q, offset = 0) {
		loading = true;
		errorMsg = '';
		try {
			const action = q.trim() ? 'search' : 'trending';
			const params = new URLSearchParams({ action, limit: '20', offset: String(offset) });
			if (q.trim()) params.set('q', q.trim());
			const r = await fetch(`/api/giphy?${params}`);
			if (!r.ok) {
				const t = await r.text();
				try { errorMsg = JSON.parse(t).message; } catch { errorMsg = t; }
				if (!offset) results = [];
				return;
			}
			const data = await r.json();
			if (offset) {
				results = [...results, ...data.results];
			} else {
				results = data.results;
			}
			nextOffset = data.offset ?? 0;
			hasMore = data.hasMore ?? false;
		} catch (e) { errorMsg = e.message; if (!offset) results = []; }
		finally { loading = false; }
	}

	function onInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => { nextOffset = 0; hasMore = true; fetchGifs(query); }, 350);
	}

	function onScroll() {
		if (!gridEl || loading || !hasMore) return;
		const { scrollTop, scrollHeight, clientHeight } = gridEl;
		if (scrollHeight - scrollTop - clientHeight < 200) {
			fetchGifs(query, nextOffset);
		}
	}

	onMount(() => { fetchGifs(''); });
</script>

<div class="gif-picker">
	<div class="gif-search-bar">
		<input
			class="gif-search-input"
			type="text"
			placeholder="Search GIFs..."
			bind:value={query}
			oninput={onInput}
		/>
	</div>
	<div class="gif-grid-wrap" bind:this={gridEl} onscroll={onScroll}>
		{#if errorMsg}
			<div class="gif-empty gif-error">{errorMsg}</div>
		{:else if results.length === 0 && !loading}
			<div class="gif-empty">{query ? 'No GIFs found' : 'Loading...'}</div>
		{/if}
		<div class="gif-grid">
			{#each results as gif (gif.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="gif-item" onclick={() => onSelect({ gif: gif.gif, preview: gif.preview, title: gif.title })}>
					<img src={gif.preview} alt={gif.title} loading="lazy" />
				</div>
			{/each}
		</div>
		{#if loading}
			<div class="gif-loading"><span class="gif-spinner"></span></div>
		{/if}
	</div>
	<div class="gif-powered">Powered by GIPHY</div>
</div>

<style>
	.gif-picker {
		width: 340px; height: 420px;
		background: var(--paper, var(--paper)); color: var(--ink, var(--ink));
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		display: flex; flex-direction: column; overflow: hidden;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-size: 0.85rem;
	}
	.gif-search-bar {
		padding: 0.5rem 0.65rem; border-bottom: 1.5px solid var(--border); flex-shrink: 0;
	}
	.gif-search-input {
		width: 100%; box-sizing: border-box; padding: 0.35rem 0.6rem;
		border: 1.5px solid var(--border); border-radius: 8px; background: var(--paper);
		font-family: inherit; font-size: 0.82rem; color: var(--ink); outline: none;
		transition: border-color 0.13s;
	}
	.gif-search-input:focus { border-color: var(--ink); }
	.gif-search-input::placeholder { color: var(--muted-fg); }

	.gif-grid-wrap {
		flex: 1; overflow-y: auto; padding: 0.4rem; min-height: 0;
		scrollbar-width: thin;
	}
	.gif-grid {
		display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem;
	}
	.gif-item {
		border-radius: 8px; overflow: hidden; cursor: pointer;
		background: var(--surface-2); transition: transform 0.1s;
	}
	.gif-item:hover { transform: scale(1.03); }
	.gif-item img {
		display: block; width: 100%; height: auto; object-fit: cover;
	}

	.gif-empty {
		text-align: center; color: var(--muted-fg); font-size: 0.82rem; padding: 2rem 0;
	}
	.gif-error { color: var(--danger); font-size: 0.75rem; }
	.gif-loading {
		display: flex; justify-content: center; padding: 0.75rem 0;
	}
	.gif-spinner {
		width: 16px; height: 16px; border: 2px solid var(--border);
		border-top-color: var(--ink); border-radius: 50%;
		animation: gifspin 0.7s linear infinite;
	}
	@keyframes gifspin { to { transform: rotate(360deg); } }

	.gif-powered {
		padding: 0.25rem 0.65rem; text-align: right;
		font-size: 0.6rem; color: var(--muted-fg); border-top: 1px solid var(--border);
	}
</style>
