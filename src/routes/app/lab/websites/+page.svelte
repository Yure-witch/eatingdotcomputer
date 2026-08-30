<script>
	import { onMount } from 'svelte';

	// Lab → Inspiration. The instructor's hand-picked websites, as a gallery.
	// (Route is /websites so it doesn't collide with /app/inspiration, which is
	// the Scout-generated per-student feed — a different thing entirely.)

	let { data } = $props();
	const canEdit = $derived(data?.currentUser?.role === 'instructor');

	let sites = $state([]);
	let loading = $state(true);
	let loadError = $state('');
	let vocabulary = $state([]);
	let untagged = $state(0);
	let tagging = $state(false);

	// Filter: an OR across selected tags. Browsing a reading list is
	// "show me art OR fun", not "show me things that are both".
	let active = $state(new Set());
	const shown = $derived(
		active.size === 0 ? sites : sites.filter((s) => (s.tags ?? []).some((t) => active.has(t)))
	);
	// Only offer chips for tags something actually has — a filter bar of
	// sixteen when four are in use is a wall, not a control.
	const inUse = $derived.by(() => {
		const counts = new Map();
		for (const s of sites) for (const t of s.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
		return vocabulary.filter((t) => counts.has(t)).map((t) => ({ tag: t, n: counts.get(t) }));
	});
	function toggle(tag) {
		const next = new Set(active);
		next.has(tag) ? next.delete(tag) : next.add(tag);
		active = next;
	}

	// Adding
	let paste = $state('');
	let adding = $state(false);
	let addMsg = $state('');
	let building = $state(0); // how many previews are still to fetch

	// Editing
	let noteFor = $state(null); // id of the card whose note is open
	let noteDraft = $state('');

	async function load() {
		try {
			const res = await fetch('/api/lab/websites');
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Could not load');
			const out = await res.json();
			sites = out.sites ?? [];
			building = out.pending ?? 0;
			untagged = out.untagged ?? 0;
			vocabulary = out.vocabulary ?? [];
			loadError = '';
		} catch (e) {
			loadError = e?.message || 'Could not load';
		} finally {
			loading = false;
		}
	}

	// Previews are built a few at a time by repeated calls, so a paste of
	// thirty links fills in visibly instead of hanging one long request that
	// would blow the serverless timeout.
	async function drainQueue() {
		for (let guard = 0; guard < 60; guard++) {
			const res = await fetch('/api/lab/websites', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'process' })
			});
			if (!res.ok) break;
			const { remaining } = await res.json();
			building = remaining;
			await load();
			if (!remaining) break;
		}
		building = 0;
	}

	// Gemma tags in small batches for the same reason previews are built in
	// small batches: one round trip per link, and a big paste would otherwise
	// be one very long request.
	async function drainTags() {
		if (tagging) return;
		tagging = true;
		try {
			for (let guard = 0; guard < 40; guard++) {
				const res = await fetch('/api/lab/websites', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'tag' })
				});
				if (!res.ok) break;
				const out = await res.json();
				await load();
				// Gemma unreachable — stop rather than spinning. The rows stay
				// untagged and the button is still there to try again later.
				if (out.unreachable || !out.remaining) break;
			}
		} finally {
			tagging = false;
		}
	}

	async function retag(id) {
		await fetch('/api/lab/websites', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, retag: true })
		});
		await load();
		await drainTags();
	}

	async function add() {
		const text = paste.trim();
		if (!text || adding) return;
		adding = true;
		addMsg = '';
		try {
			const res = await fetch('/api/lab/websites', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ urls: text })
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.message || 'That did not go in');
			paste = '';
			addMsg = out.skipped
				? `Added ${out.added} — ${out.skipped} ${out.skipped === 1 ? 'was' : 'were'} already here`
				: `Added ${out.added}`;
			await load();
			await drainQueue();
			await drainTags();
		} catch (e) {
			addMsg = e?.message || 'That did not go in';
		} finally {
			adding = false;
		}
	}

	async function refetch(id) {
		await fetch('/api/lab/websites', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, refetch: true })
		});
		await load();
		await drainQueue();
	}

	async function remove(id) {
		const site = sites.find((s) => s.id === id);
		if (!confirm(`Remove ${site?.title || site?.url}?`)) return;
		await fetch(`/api/lab/websites?id=${id}`, { method: 'DELETE' });
		await load();
	}

	function openNote(site) {
		noteFor = site.id;
		noteDraft = site.note ?? '';
	}
	async function saveNote() {
		const id = noteFor;
		noteFor = null;
		await fetch('/api/lab/websites', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, note: noteDraft })
		});
		await load();
	}

	const host = (u) => {
		try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
	};

	onMount(() => {
		load().then(() => {
			// Anything left pending from an interrupted session (a closed tab
			// mid-paste) gets picked up here rather than sitting as a skeleton
			// for ever.
			if (building && canEdit) drainQueue();
			if (untagged && canEdit) drainTags();
		});
	});
</script>

<svelte:head><title>Inspiration — eating.computer</title></svelte:head>

<div class="shell">
	<main>
		<div class="page-header">
			<div>
				<h1>Inspiration</h1>
				<p class="subtitle">Websites and pages worth your time. Collected for the class.</p>
			</div>
			<a class="back" href="/app/lab">← Lab</a>
		</div>

		{#if canEdit}
			<div class="adder">
				<textarea
					bind:value={paste}
					placeholder="Paste links, one per line — or paste a whole page of them and I'll pick the URLs out"
					rows="3"
				></textarea>
				<div class="adder-row">
					<button class="primary" onclick={add} disabled={!paste.trim() || adding}>
						{adding ? 'Adding…' : 'Add to the gallery'}
					</button>
					{#if building}
						<span class="msg building"><span class="spin"></span> Fetching {building} preview{building === 1 ? '' : 's'}…</span>
					{:else if addMsg}
						<span class="msg">{addMsg}</span>
					{/if}
				</div>
			</div>
		{/if}

		{#if inUse.length}
			<div class="filters">
				<button class="chip" class:on={active.size === 0} onclick={() => (active = new Set())}>
					Everything <span class="n">{sites.length}</span>
				</button>
				{#each inUse as { tag, n } (tag)}
					<button class="chip" class:on={active.has(tag)} onclick={() => toggle(tag)}>
						{tag} <span class="n">{n}</span>
					</button>
				{/each}
				{#if canEdit && untagged}
					<button class="chip ask" onclick={drainTags} disabled={tagging}>
						{tagging ? 'Gemma is tagging…' : `Tag ${untagged} more with Gemma`}
					</button>
				{/if}
			</div>
		{:else if canEdit && untagged && !loading}
			<div class="filters">
				<button class="chip ask" onclick={drainTags} disabled={tagging}>
					{tagging ? 'Gemma is tagging…' : `Tag ${untagged} with Gemma`}
				</button>
			</div>
		{/if}

		{#if loading}
			<p class="state">Loading…</p>
		{:else if loadError}
			<p class="state error">{loadError}</p>
		{:else if !sites.length}
			<p class="state">
				{canEdit ? 'Nothing here yet — paste some links above.' : 'Nothing here yet.'}
			</p>
		{:else if !shown.length}
			<p class="state">
				Nothing tagged {[...active].join(' or ')}.
				<button class="linky" onclick={() => (active = new Set())}>Show everything</button>
			</p>
		{:else}
			<div class="gallery">
				{#each shown as s (s.id)}
					<article class="card" class:pending={s.status === 'pending'}>
						<a class="shot" href={s.url} target="_blank" rel="noopener noreferrer">
							{#if s.image}
								<img src={s.image} alt="" loading="lazy" />
							{:else}
								<!-- No OG image: build the card out of type on the site's
								     own colour rather than showing a broken frame. -->
								<span class="typographic" style:--accent={s.accent || '#3a3a42'}>
									<span class="type-host">{host(s.url)}</span>
								</span>
							{/if}
							{#if s.status === 'pending'}<span class="badge">fetching…</span>{/if}
						</a>

						<div class="meta">
							<div class="line">
								{#if s.icon}<img class="favicon" src={s.icon} alt="" loading="lazy" />{/if}
								<span class="site">{s.siteName || host(s.url)}</span>
							</div>
							<a class="title" href={s.url} target="_blank" rel="noopener noreferrer">
								{s.title || host(s.url)}
							</a>
							{#if s.note}
								<p class="note">{s.note}</p>
							{:else if s.description}
								<p class="desc">{s.description}</p>
							{/if}

							{#if s.tags?.length}
								<div class="tags">
									{#each s.tags as t (t)}
										<button class="tag" class:on={active.has(t)} onclick={() => toggle(t)}>{t}</button>
									{/each}
								</div>
							{/if}

							{#if canEdit}
								{#if noteFor === s.id}
									<div class="note-edit">
										<input
											bind:value={noteDraft}
											maxlength="500"
											placeholder="Why this one?"
											onkeydown={(e) => e.key === 'Enter' && saveNote()}
										/>
										<button onclick={saveNote}>Save</button>
									</div>
								{:else}
									<div class="tools">
										<button onclick={() => openNote(s)}>{s.note ? 'Edit note' : 'Add note'}</button>
										<button onclick={() => refetch(s.id)}>Re-fetch</button>
									<button onclick={() => retag(s.id)}>Re-tag</button>
										<button class="danger" onclick={() => remove(s.id)}>Remove</button>
									</div>
								{/if}
								{#if s.status === 'failed'}
									<p class="warn">Couldn't read this one{s.error ? ` — ${s.error.toLowerCase()}` : ''}</p>
								{:else if s.error && !s.image}
									<p class="warn quiet">{s.error}</p>
								{/if}
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	.shell { min-height: 100dvh; background: var(--paper); }
	main {
		/* app.css makes every bare <main> a centring grid for the landing page,
		   which shrink-wraps children. */
		display: block;
		min-height: 0;
		padding: 1.5rem;
		padding-top: calc(1.5rem + var(--header-h, 52px));
		max-width: 1200px;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
	h1 { font-family: 'Avara', serif; font-size: 2rem; font-weight: 400; margin: 0 0 0.25rem; color: var(--ink); }
	.subtitle { font-size: 0.85rem; color: var(--muted-fg); margin: 0; }
	.back { font-size: 0.8rem; color: var(--muted-fg); text-decoration: none; white-space: nowrap; }
	.back:hover { color: var(--ink); }

	.adder {
		border: 1.5px solid var(--border);
		border-radius: 14px;
		padding: 0.85rem;
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		/* Explicit: <main> is a centring grid in app.css and a grid item
		   shrink-wraps, which collapses this to a ~200px column. */
		width: 100%;
		box-sizing: border-box;
	}
	textarea {
		font: inherit;
		font-size: 0.85rem;
		line-height: 1.5;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		border: 1.5px solid var(--border);
		background: var(--paper);
		color: var(--ink);
		resize: vertical;
		width: 100%;
		box-sizing: border-box;
	}
	textarea:focus { outline: none; border-color: var(--accent); }
	.adder-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
	.msg { font-size: 0.78rem; color: var(--muted-fg); display: inline-flex; align-items: center; gap: 0.4rem; }
	.spin {
		width: 11px; height: 11px; border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 1.25rem;
		width: 100%;
	}
	.chip {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.3rem 0.7rem;
		border-radius: 99px;
		border: 1.5px solid var(--border);
		background: transparent;
		color: var(--muted-fg);
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.chip:hover:not(:disabled) { border-color: var(--accent); color: var(--ink); }
	.chip.on {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--ink);
	}
	.chip .n { opacity: 0.5; font-size: 0.72rem; }
	.chip.ask { margin-left: auto; }
	.chip:disabled { opacity: 0.55; cursor: default; }

	/* Tags on a card are themselves filters — clicking one is the fastest way
	   to say "more like this". */
	.tags { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.45rem; }
	.tag {
		font: inherit;
		font-size: 0.65rem;
		letter-spacing: 0.02em;
		padding: 0.1rem 0.4rem;
		border-radius: 5px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--muted-fg);
		cursor: pointer;
	}
	.tag:hover { border-color: var(--accent); color: var(--ink); }
	.tag.on { border-color: var(--accent); color: var(--ink); background: color-mix(in srgb, var(--accent) 14%, transparent); }

	.linky {
		font: inherit;
		font-size: inherit;
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}

	.state { font-size: 0.85rem; color: var(--muted-fg); padding: 2rem 0; }
	.state.error { color: #d66; }

	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1.25rem;
		width: 100%;
	}
	.card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		border: 1.5px solid var(--border);
		border-radius: 14px;
		overflow: hidden;
		background: var(--md-sys-color-surface-container-low, var(--paper));
		transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
	}
	.card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px -12px color-mix(in srgb, var(--ink) 40%, transparent);
	}
	.card.pending { opacity: 0.65; }

	.shot {
		position: relative;
		display: block;
		aspect-ratio: 16 / 10;
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		overflow: hidden;
	}
	.shot img { width: 100%; height: 100%; object-fit: cover; display: block; }

	/* Sites that publish no OG image get type on their own favicon colour —
	   more honest than a generic placeholder, and it keeps the grid even. */
	.typographic {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: linear-gradient(150deg,
			color-mix(in srgb, var(--accent) 85%, #000 15%),
			color-mix(in srgb, var(--accent) 45%, #000 55%));
	}
	.type-host {
		font-family: 'Avara', serif;
		font-size: 1.15rem;
		line-height: 1.25;
		text-align: center;
		color: #fff;
		text-shadow: 0 1px 12px rgba(0, 0, 0, 0.45);
		word-break: break-word;
	}

	.badge {
		position: absolute;
		left: 0.6rem;
		top: 0.6rem;
		font-size: 0.62rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 0.15rem 0.45rem;
		border-radius: 99px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
	}

	.meta { padding: 0.75rem 0.85rem 0.85rem; display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
	.line { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
	.favicon { width: 14px; height: 14px; border-radius: 3px; flex: none; object-fit: contain; }
	.site {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title {
		font-family: 'Avara', serif;
		font-size: 1rem;
		line-height: 1.3;
		color: var(--ink);
		text-decoration: none;
	}
	.title:hover { text-decoration: underline; }
	.desc, .note {
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--muted-fg);
		margin: 0.15rem 0 0;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	/* The instructor's own words outrank the site's marketing copy. */
	.note { color: var(--ink); font-style: italic; }

	.tools { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.4rem; }
	.tools button, .note-edit button, .primary {
		font: inherit;
		font-size: 0.72rem;
		padding: 0.25rem 0.55rem;
		border-radius: 99px;
		border: 1.5px solid var(--border);
		background: transparent;
		color: var(--muted-fg);
		cursor: pointer;
	}
	.tools button:hover { border-color: var(--accent); color: var(--ink); }
	.tools .danger:hover { border-color: #d66; color: #d66; }
	.primary {
		font-size: 0.8rem;
		padding: 0.45rem 0.9rem;
		color: var(--ink);
		border-color: var(--accent);
	}
	.primary:disabled { opacity: 0.45; cursor: default; }

	.note-edit { display: flex; gap: 0.4rem; margin-top: 0.4rem; }
	.note-edit input {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.3rem 0.5rem;
		border-radius: 8px;
		border: 1.5px solid var(--border);
		background: var(--paper);
		color: var(--ink);
		flex: 1;
		min-width: 0;
	}

	.warn { font-size: 0.7rem; color: #c77; margin: 0.35rem 0 0; }
	.warn.quiet { color: var(--muted-fg); opacity: 0.7; }
</style>
