<script>
	// ✨ Inspiration — daily finds based on your interests, gathered by
	// Scout (seminal papers via OpenAlex, artworks from The Met / AIC /
	// Cleveland / V&A, are.na channels, Wikipedia overviews).
	// Save = keep forever (and a strong interest signal — future batches
	// lean toward what you save). Unsaved finds fade after 7 days; the
	// History view keeps the record.
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';

	let loading = $state(true);
	let items = $state([]);
	let interests = $state('');
	let scoutOnline = $state(false);
	let view = $state('fresh'); // fresh | saved | history
	let historyLoaded = $state(false);

	async function load(history = false) {
		loading = true;
		try {
			const r = await fetch(`/api/inspiration${history ? '?history=1' : ''}`);
			if (r.ok) {
				const j = await r.json();
				items = j.items ?? [];
				interests = j.interests ?? '';
				scoutOnline = !!j.scoutOnline;
				if (history) historyLoaded = true;
			}
		} catch { /* empty state below */ }
		loading = false;
	}

	onMount(() => {
		pageTitle.set('Inspiration');
		load();
	});

	function setView(v) {
		view = v;
		// History needs the full list (expired included) — fetch once.
		if (v === 'history' && !historyLoaded) load(true);
	}

	const visible = $derived.by(() => {
		if (view === 'saved') return items.filter((i) => i.saved);
		if (view === 'history') return items;
		return items.filter((i) => i.saved || !i.expired);
	});

	const KIND_SECTIONS = [
		{ key: 'paper', title: 'Seminal papers', sub: 'the most-cited scholarship on your interests — what everyone in the field has read' },
		{ key: 'artwork', title: 'From the museums', sub: 'The Met · Art Institute of Chicago · Cleveland · V&A' },
		{ key: 'channel', title: 'are.na channels', sub: 'curated rabbit holes' },
		{ key: 'article', title: 'Overviews', sub: 'ground-floor context' },
		{ key: 'link', title: 'Elsewhere', sub: '' }
	];
	const grouped = $derived(
		KIND_SECTIONS.map((s) => ({ ...s, items: visible.filter((i) => i.kind === s.key) })).filter((s) => s.items.length)
	);

	async function toggleSave(item) {
		item.saved = !item.saved;
		try {
			const r = await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, saved: item.saved })
			});
			if (!r.ok) item.saved = !item.saved;
		} catch { item.saved = !item.saved; }
	}
</script>

<svelte:head><title>Inspiration — eating.computer</title></svelte:head>

<div class="inspo-shell">
	<main>
		<div class="page-head">
			<h1>Inspiration</h1>
			<p class="page-sub">
				New picks land every day or so, based on your interests{interests ? '' : ' (none on file yet)'}.
				<strong>Save what speaks to you</strong> — it stays forever and shapes what shows up next.
				Unsaved finds fade after 7 days, but History keeps the record.
			</p>
		</div>

		<div class="view-row">
			<button class="view-chip" class:active={view === 'fresh'} onclick={() => setView('fresh')}>Fresh</button>
			<button class="view-chip" class:active={view === 'saved'} onclick={() => setView('saved')}>Saved</button>
			<button class="view-chip" class:active={view === 'history'} onclick={() => setView('history')}>History</button>
		</div>

		{#if loading}
			<p class="empty"><span class="msi inspo-spin">progress_activity</span> Gemma is out looking for new things…</p>
		{:else if !interests}
			<p class="empty">No interests on file yet — add them in your <a href="/app/profile/edit">profile</a> (or ask your instructor to fill them in on the Manage page) and check back tomorrow.</p>
		{:else if !visible.length}
			{#if view === 'saved'}
				<p class="empty">Nothing saved yet. Hit the bookmark on anything you want to keep.</p>
			{:else if !scoutOnline && !items.length}
				<p class="empty">Scout is offline right now, so no finds have come in yet — check back soon.</p>
			{:else}
				<p class="empty">Nothing here yet — new finds should arrive within a day.</p>
			{/if}
		{:else}
			{#each grouped as sec (sec.key)}
				<section class="inspo-section">
					<h2>{sec.title}</h2>
					{#if sec.sub}<p class="sec-sub">{sec.sub}</p>{/if}

					{#if sec.key === 'artwork'}
						<div class="art-grid">
							{#each sec.items as item (item.id)}
								<div class="art-card" class:expired={item.expired && !item.saved}>
									<a href={item.url} target="_blank" rel="noopener noreferrer" class="art-link">
										{#if item.image}
											<img src={item.image} alt={item.title} loading="lazy" />
										{:else}
											<div class="art-noimg">🖼️</div>
										{/if}
										<span class="art-title">{item.title}</span>
										{#if item.snippet}<span class="art-snip">{item.snippet}</span>{/if}
										<span class="art-meta">{item.meta}</span>
									</a>
									<button class="save-btn" class:on={item.saved} title={item.saved ? 'Saved — click to unsave' : 'Save'} onclick={() => toggleSave(item)}>
										<span class="msi" class:msi-fill={item.saved}>bookmark</span>
									</button>
									{#if item.expired && !item.saved}<span class="expired-tag">faded</span>{/if}
								</div>
							{/each}
						</div>
					{:else}
						<ul class="row-list">
							{#each sec.items as item (item.id)}
								<li class="row" class:expired={item.expired && !item.saved}>
									{#if item.image}
										<img class="row-thumb" src={item.image} alt="" loading="lazy" />
									{/if}
									<div class="row-body">
										<a class="row-title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
										{#if item.snippet}<span class="row-snip">{item.snippet}</span>{/if}
										{#if item.meta}<span class="row-meta">{item.meta}{#if item.expired && !item.saved} · faded{/if}</span>{/if}
									</div>
									<button class="save-btn" class:on={item.saved} title={item.saved ? 'Saved — click to unsave' : 'Save'} onclick={() => toggleSave(item)}>
										<span class="msi" class:msi-fill={item.saved}>bookmark</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		{/if}
	</main>
</div>

<style>
	.inspo-shell { min-height: 100%; background: var(--paper); }
	main { max-width: 680px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
	.page-head h1 { font-family: 'Avara', serif; font-size: 1.5rem; margin: 0 0 0.35rem; }
	.page-sub { font-size: 0.85rem; color: var(--muted-fg); margin: 0 0 1rem; line-height: 1.5; }
	.page-sub strong { color: var(--ink); font-weight: 600; }

	.view-row { display: flex; gap: 0.4rem; margin-bottom: 1.5rem; }
	.view-chip {
		padding: 0.35rem 0.9rem; font-family: inherit; font-size: 0.8rem; font-weight: 600;
		background: none; color: var(--muted-fg); border: 1.5px solid var(--border);
		border-radius: 999px; cursor: pointer; transition: all 0.12s;
	}
	.view-chip:hover { border-color: var(--ink); color: var(--ink); }
	.view-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

	.empty { font-size: 0.88rem; color: var(--muted-fg); line-height: 1.5; }
	.empty a { color: var(--ink); }
	.inspo-spin { display: inline-block; vertical-align: -0.2em; animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.inspo-section { margin-bottom: 2rem; }
	.inspo-section h2 {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent));
		margin: 0 0 0.15rem;
	}
	.sec-sub { font-size: 0.75rem; color: var(--muted-fg); margin: 0 0 0.75rem; }

	/* papers / channels / articles — list rows */
	.row-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.row {
		display: flex; align-items: flex-start; gap: 0.7rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		padding: 0.7rem 0.85rem;
	}
	.row.expired { opacity: 0.55; }
	.row-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
	.row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
	.row-title {
		font-size: 0.88rem; font-weight: 600; color: var(--ink);
		text-decoration: none; line-height: 1.35;
	}
	.row-title:hover { text-decoration: underline; text-underline-offset: 2px; }
	.row-snip { font-size: 0.76rem; color: var(--muted-fg); line-height: 1.4; }
	.row-meta { font-size: 0.72rem; color: var(--md-sys-color-primary, var(--accent)); font-weight: 600; }

	/* artworks — image grid */
	.art-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
	.art-card { position: relative; border: 1.5px solid var(--border); border-radius: 12px; overflow: hidden; }
	.art-card.expired { opacity: 0.55; }
	.art-link { display: flex; flex-direction: column; text-decoration: none; color: var(--ink); }
	.art-link img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: var(--surface-2); }
	.art-noimg { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 2rem; background: var(--surface-2); }
	.art-title { font-size: 0.78rem; font-weight: 600; padding: 0.5rem 0.6rem 0; line-height: 1.3; }
	.art-snip { font-size: 0.7rem; color: var(--muted-fg); padding: 0.1rem 0.6rem 0; line-height: 1.3; }
	.art-meta { font-size: 0.66rem; color: var(--md-sys-color-primary, var(--accent)); font-weight: 600; padding: 0.15rem 0.6rem 0.55rem; }
	.expired-tag {
		position: absolute; top: 0.4rem; left: 0.4rem;
		font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
		background: rgba(0, 0, 0, 0.55); color: #fff;
		padding: 0.1rem 0.4rem; border-radius: 99px;
	}

	.save-btn {
		background: none; border: none; cursor: pointer; padding: 0.25rem;
		color: var(--muted-fg); flex-shrink: 0;
		transition: color 0.12s, transform 0.12s;
	}
	.save-btn:hover { color: var(--ink); transform: scale(1.15); }
	.save-btn.on { color: var(--md-sys-color-primary, var(--accent)); }
	.art-card .save-btn {
		position: absolute; top: 0.3rem; right: 0.3rem;
		background: color-mix(in srgb, var(--paper) 80%, transparent);
		border-radius: 99px; backdrop-filter: blur(6px);
	}
	.msi-fill { font-variation-settings: 'FILL' 1; }
</style>
