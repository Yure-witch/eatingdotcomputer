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
	let topics = $state('');
	let editingTopics = $state(false);
	let topicsDraft = $state('');
	let topicsSaving = $state(false);
	let scoutOnline = $state(false);
	let pending = $state(false); // a batch is in flight on the worker
	let view = $state('fresh'); // fresh | saved | history
	let historyLoaded = $state(false);
	let pollTimer = null;

	async function load(history = false) {
		try {
			const r = await fetch(`/api/inspiration${history ? '?history=1' : ''}`);
			if (r.ok) {
				const j = await r.json();
				items = j.items ?? [];
				interests = j.interests ?? '';
				topics = j.topics ?? '';
				scoutOnline = !!j.scoutOnline;
				pending = !!j.pending;
				if (history) historyLoaded = true;
				// Batch in flight → keep polling until it lands. Results
				// merge in automatically since GET materializes them.
				if (pending && !pollTimer) {
					pollTimer = setTimeout(() => { pollTimer = null; load(view === 'history'); }, 6000);
				}
			}
		} catch { /* empty state below */ }
		loading = false;
	}

	async function fetchMore() {
		pending = true;
		try {
			await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ more: true })
			});
		} catch { /* poll picks up state either way */ }
		if (!pollTimer) pollTimer = setTimeout(() => { pollTimer = null; load(view === 'history'); }, 6000);
	}

	onMount(() => {
		pageTitle.set('Inspiration');
		load();
		return () => clearTimeout(pollTimer);
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
		{ key: 'paper', title: 'Seminal papers', sub: 'the most-cited scholarship on your interests — what everyone in the field has read. 🔒 opens through Cooper Library access.' },
		{ key: 'artwork', title: 'From the museums', sub: 'The Met · Art Institute of Chicago · Cleveland · V&A' },
		{ key: 'channel', title: 'are.na channels', sub: 'curated rabbit holes' },
		{ key: 'article', title: 'Overviews', sub: 'ground-floor context' },
		{ key: 'link', title: 'Elsewhere', sub: '' }
	];
	const grouped = $derived(
		KIND_SECTIONS.map((s) => ({ ...s, items: visible.filter((i) => i.kind === s.key) })).filter((s) => s.items.length)
	);

	// Cooper Union's OpenAthens proxy — prepending it to a paywalled URL
	// routes the click through Cooper's institutional subscriptions (the
	// student signs in with their Cooper login and lands on the article,
	// not the paywall). Open-access items link direct.
	const COOPER_PROXY = 'https://go.openathens.net/redirector/cooper.edu?url=';
	const linkFor = (item) =>
		item.paywalled ? COOPER_PROXY + encodeURIComponent(item.url) : item.url;

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

	// Edit the search topics. Saving immediately enqueues a fresh batch so
	// the change is felt right away; '' resets back to profile interests.
	async function saveTopics() {
		topicsSaving = true;
		try {
			const r = await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ topics: topicsDraft })
			});
			if (r.ok) {
				topics = topicsDraft.trim() || interests;
				editingTopics = false;
				pending = true;
				if (!pollTimer) pollTimer = setTimeout(() => { pollTimer = null; load(view === 'history'); }, 6000);
			}
		} catch { /* stays open, user can retry */ }
		topicsSaving = false;
	}

	// Download the whole "algorithm" — topics, every signal, and the
	// derived taste model — as a JSON file.
	function exportAlgorithm() {
		const a = document.createElement('a');
		a.href = '/api/inspiration?export=1';
		a.download = 'inspiration-algorithm.json';
		document.body.appendChild(a);
		a.click();
		a.remove();
	}

	// Like/dislike — teaches the algorithm (likes steer the next batch's
	// query; dislikes shrink that kind's quota + block recurring words).
	// Disliking removes the item from the feed on the spot.
	async function rate(item, rating) {
		const prev = item.rating;
		item.rating = item.rating === rating ? 0 : rating;
		if (item.rating === -1 && view !== 'history') {
			items = items.filter((i) => i.id !== item.id || i.saved);
		}
		try {
			const r = await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, rating: item.rating })
			});
			if (!r.ok) item.rating = prev;
		} catch { item.rating = prev; }
	}
</script>

<svelte:head><title>Inspiration — eating.computer</title></svelte:head>

{#snippet itemActions(item)}
	<span class="act-cluster">
		<button class="act-btn" class:on-up={item.rating === 1} title="More like this" onclick={() => rate(item, 1)}>
			<span class="msi" class:msi-fill={item.rating === 1}>thumb_up</span>
		</button>
		<button class="act-btn" class:on-down={item.rating === -1} title="Less like this" onclick={() => rate(item, -1)}>
			<span class="msi" class:msi-fill={item.rating === -1}>thumb_down</span>
		</button>
		<button class="act-btn" class:on-save={item.saved} title={item.saved ? 'Saved — click to unsave' : 'Save forever'} onclick={() => toggleSave(item)}>
			<span class="msi" class:msi-fill={item.saved}>bookmark</span>
		</button>
	</span>
{/snippet}

<div class="inspo-shell">
	<main>
		<div class="page-head">
			<h1>Inspiration</h1>
			<p class="page-sub">
				New picks land every day or so, based on your interests{interests ? '' : ' (none on file yet)'}.
				<strong>Save what speaks to you</strong> — it stays forever and shapes what shows up next.
				👍 and 👎 teach it your taste too. Unsaved finds fade after 7 days, but History keeps the record.
			</p>
		</div>

		{#if interests || topics}
			<div class="topics-row">
				{#if editingTopics}
					<input
						class="topics-input"
						bind:value={topicsDraft}
						placeholder="e.g. risograph printing, algorithmic composition, brutalism"
						maxlength="300"
						onkeydown={(e) => { if (e.key === 'Enter') saveTopics(); if (e.key === 'Escape') editingTopics = false; }}
					/>
					<button class="view-chip" disabled={topicsSaving} onclick={saveTopics}>{topicsSaving ? 'Saving…' : 'Save & search'}</button>
					<button class="view-chip" onclick={() => (editingTopics = false)}>Cancel</button>
					{#if topics !== interests}
						<button class="view-chip" onclick={() => { topicsDraft = ''; saveTopics(); }}>Reset to interests</button>
					{/if}
				{:else}
					<span class="topics-label">Searching for:</span>
					<span class="topics-value">{topics}</span>
					<button class="topics-edit" title="Change the topics the feed searches for" onclick={() => { topicsDraft = topics; editingTopics = true; }}>
						<span class="msi">edit</span> Edit topics
					</button>
				{/if}
			</div>
		{/if}

		<div class="view-row">
			<button class="view-chip" class:active={view === 'fresh'} onclick={() => setView('fresh')}>Fresh</button>
			<button class="view-chip" class:active={view === 'saved'} onclick={() => setView('saved')}>Saved</button>
			<button class="view-chip" class:active={view === 'history'} onclick={() => setView('history')}>History</button>
			<button class="view-chip export-chip" title="Download your topics, saves, likes/dislikes, and the derived taste model as JSON" onclick={exportAlgorithm}>
				<span class="msi">download</span> Export my algorithm
			</button>
		</div>

		{#if loading}
			<p class="empty"><span class="msi inspo-spin">progress_activity</span> Gemma is out looking for new things…</p>
		{:else if !topics}
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
									<span class="art-actions">{@render itemActions(item)}</span>
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
										<a class="row-title" href={linkFor(item)} target="_blank" rel="noopener noreferrer">
											{#if item.paywalled}<span class="msi lock-icon" title="Paywalled — opens through Cooper Library access">lock</span>{/if}{item.title}
										</a>
										{#if item.snippet}<span class="row-snip">{item.snippet}</span>{/if}
										{#if item.meta}<span class="row-meta" class:meta-paywall={item.paywalled}>{item.meta}{#if item.paywalled} · via Cooper Library{/if}{#if item.expired && !item.saved} · faded{/if}</span>{/if}
									</div>
									{@render itemActions(item)}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		{/if}

		{#if topics && !loading && view !== 'saved'}
			<div class="more-row">
				{#if pending}
					<span class="more-pending"><span class="msi inspo-spin">progress_activity</span> Scout is out fetching a new batch — new finds drop in as they land…</span>
				{:else}
					<button class="more-btn" onclick={fetchMore}>
						<span class="msi">travel_explore</span> Fetch more
					</button>
					{#if !scoutOnline}<span class="more-note">Scout looks offline — it'll pick this up when it's back.</span>{/if}
				{/if}
			</div>
		{/if}
	</main>
</div>

<style>
	.inspo-shell { min-height: 100%; background: var(--paper); }
	main { max-width: 680px; margin: 0 auto; padding: calc(1rem + var(--header-h, 52px)) 1.25rem 4rem; }
	.page-head h1 { font-family: 'Avara', serif; font-size: 1.5rem; margin: 0 0 0.35rem; }
	.page-sub { font-size: 0.85rem; color: var(--muted-fg); margin: 0 0 1rem; line-height: 1.5; }
	.page-sub strong { color: var(--ink); font-weight: 600; }

	.topics-row {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
		margin-bottom: 0.75rem; font-size: 0.82rem;
	}
	.topics-label { color: var(--muted-fg); font-weight: 600; flex-shrink: 0; }
	.topics-value { color: var(--ink); }
	.topics-edit {
		display: inline-flex; align-items: center; gap: 0.25rem;
		background: none; border: none; padding: 0.15rem 0.3rem;
		font-family: inherit; font-size: 0.78rem; font-weight: 600;
		color: var(--md-sys-color-primary, var(--accent)); cursor: pointer;
	}
	.topics-edit:hover { text-decoration: underline; }
	.topics-edit .msi { font-size: 15px; }
	.topics-input {
		flex: 1; min-width: 220px;
		padding: 0.45rem 0.7rem; border: 1.5px solid var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; color: var(--ink); background: var(--paper);
		outline: none;
	}
	.topics-input:focus { border-color: var(--ink); }

	.view-row { display: flex; gap: 0.4rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
	.export-chip { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: auto; }
	.export-chip .msi { font-size: 15px; }
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
	.row-meta.meta-paywall { color: var(--muted-fg); }
	.lock-icon {
		font-size: 14px; vertical-align: -2px; margin-right: 0.15rem;
		color: var(--muted-fg);
	}

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

	.act-cluster { display: inline-flex; gap: 0.1rem; flex-shrink: 0; align-items: center; }
	.act-btn {
		background: none; border: none; cursor: pointer; padding: 0.22rem;
		color: var(--muted-fg);
		transition: color 0.12s, transform 0.12s;
		line-height: 0;
	}
	.act-btn .msi { font-size: 19px; }
	.act-btn:hover { color: var(--ink); transform: scale(1.15); }
	.act-btn.on-up { color: #2e7d32; }
	.act-btn.on-down { color: #c62828; }
	.act-btn.on-save { color: var(--md-sys-color-primary, var(--accent)); }
	.art-actions .act-cluster {
		position: absolute; top: 0.3rem; right: 0.3rem;
		background: color-mix(in srgb, var(--paper) 82%, transparent);
		border-radius: 99px; backdrop-filter: blur(6px);
		padding: 0 0.15rem;
	}
	.msi-fill { font-variation-settings: 'FILL' 1; }

	.more-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap; }
	.more-btn {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.55rem 1.2rem; font-family: inherit; font-size: 0.85rem; font-weight: 600;
		background: var(--ink); color: var(--paper); border: none; border-radius: 999px;
		cursor: pointer; transition: opacity 0.15s;
	}
	.more-btn:hover { opacity: 0.85; }
	.more-btn .msi { font-size: 18px; }
	.more-pending { font-size: 0.82rem; color: var(--muted-fg); display: inline-flex; align-items: center; gap: 0.4rem; }
	.more-note { font-size: 0.75rem; color: var(--muted-fg); }
</style>
