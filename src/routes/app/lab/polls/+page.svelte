<script>
	import { onMount } from 'svelte';

	// Lab → Rank It. The instructor writes a list; the class drags it into
	// order; the tally is the room's collective ranking.

	let { data } = $props();
	const canEdit = $derived(data?.currentUser?.role === 'instructor');

	let polls = $state([]);
	let loading = $state(true);
	let loadError = $state('');

	// Composing a new poll
	let composing = $state(false);
	let title = $state('');
	let prompt = $state('');
	let itemText = $state('');
	let reveal = $state('closed');
	let format = $state('favorites');
	let minFavorites = $state(3);
	let minLeast = $state(3);
	let allowWriteIns = $state(false);
	let saving = $state(false);
	let saveError = $state('');

	const itemCount = $derived(itemText.split(/\r?\n/).filter((l) => l.trim()).length);
	// A pool that can't satisfy its own minimums is a poll nobody can submit,
	// so say so here rather than letting them find out in front of the class.
	const needed = $derived(format === 'favorites' ? Number(minFavorites) + Number(minLeast) : 2);
	const tooSmall = $derived(itemCount > 0 && itemCount < needed);

	async function load() {
		try {
			const res = await fetch('/api/lab/polls');
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Could not load');
			const out = await res.json();
			polls = out.polls ?? [];
			loadError = '';
		} catch (e) {
			loadError = e?.message || 'Could not load';
		} finally {
			loading = false;
		}
	}

	async function create() {
		if (saving) return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch('/api/lab/polls', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title, prompt, items: itemText, reveal, format,
					minFavorites, minLeast, allowWriteIns,
					classId: data?.classId ?? null
				})
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.message || 'That did not save');
			title = ''; prompt = ''; itemText = ''; reveal = 'closed';
			format = 'favorites'; minFavorites = 3; minLeast = 3; allowWriteIns = false;
			composing = false;
			await load();
		} catch (e) {
			saveError = e?.message || 'That did not save';
		} finally {
			saving = false;
		}
	}

	onMount(load);
</script>

<svelte:head><title>Rank It — eating.computer</title></svelte:head>

<div class="shell">
	<main>
		<div class="page-header">
			<a class="back" href="/app/lab"><span class="msi">arrow_back</span> Lab</a>
			<h1>Rank It</h1>
			<p class="subtitle">
				Put a list in front of the class and have everyone drag it into their own order.
				The results are the ranking the room agrees on.
			</p>
		</div>

		{#if canEdit}
			{#if composing}
				<div class="composer">
					<label class="field">
						<span>Question</span>
						<input bind:value={title} placeholder="Which of these should we cover first?" maxlength="200" />
					</label>
					<label class="field">
						<span>Instructions <em>optional</em></span>
						<input bind:value={prompt} placeholder="Rank from most to least useful." maxlength="1000" />
					</label>
					<label class="field">
						<span>The pool <em>one per line</em></span>
						<textarea bind:value={itemText} rows="6" placeholder={"Typography\nColour theory\nGrid systems\nMotion"}></textarea>
					</label>

					<div class="field">
						<span>Format</span>
						<div class="formats">
							<label class="fmt" class:on={format === 'favorites'}>
								<input type="radio" bind:group={format} value="favorites" />
								<span class="fmt-title">Favorites + least favorites</span>
								<span class="fmt-blurb">Pick and rank both ends of the pool. Anything they have no feeling about is left out.</span>
							</label>
							<label class="fmt" class:on={format === 'full'}>
								<input type="radio" bind:group={format} value="full" />
								<span class="fmt-title">Rank the whole list</span>
								<span class="fmt-blurb">Everything in the pool, dragged into one order, top to bottom.</span>
							</label>
						</div>
					</div>

					{#if format === 'favorites'}
						<div class="mins">
							<label class="min">
								<span>Minimum favorites</span>
								<input type="number" min="1" max="20" bind:value={minFavorites} />
							</label>
							<label class="min">
								<span>Minimum least favorites</span>
								<input type="number" min="1" max="20" bind:value={minLeast} />
							</label>
						</div>
						<p class="fine">They can rank more than the minimum — it's a floor, not a quota.</p>
						<label class="check">
							<input type="checkbox" bind:checked={allowWriteIns} />
							<span>Let them add their own things to the pool</span>
						</label>
					{/if}
					<label class="check">
						<input type="checkbox" checked={reveal === 'always'}
							onchange={(e) => (reveal = e.currentTarget.checked ? 'always' : 'closed')} />
						<span>Show the running results to students once they've ranked it</span>
					</label>
					<div class="composer-actions">
						<span class="count" class:short={tooSmall}>
							{itemCount} {itemCount === 1 ? 'thing' : 'things'}{#if tooSmall} — needs {needed}{/if}
						</span>
						<button class="ghost" onclick={() => (composing = false)}>Cancel</button>
						<button class="primary" onclick={create} disabled={saving || !title.trim() || itemCount < needed}>
							{saving ? 'Creating…' : 'Create poll'}
						</button>
					</div>
					{#if saveError}<p class="error">{saveError}</p>{/if}
				</div>
			{:else}
				<button class="new" onclick={() => (composing = true)}>
					<span class="msi">add</span> New ranking poll
				</button>
			{/if}
		{/if}

		{#if loading}
			<p class="muted">Loading…</p>
		{:else if loadError}
			<p class="error">{loadError}</p>
		{:else if !polls.length}
			<p class="muted">
				{canEdit ? 'No polls yet — make one above.' : 'Nothing to rank right now.'}
			</p>
		{:else}
			<div class="poll-list">
				{#each polls as p (p.id)}
					<a class="poll-card" class:closed={p.status === 'closed'} href="/app/lab/polls/{p.id}">
						<div class="poll-head">
							<span class="poll-title">{p.title}</span>
							<span class="badge" class:open={p.status === 'open'}>
								{p.status === 'open' ? 'Open' : 'Closed'}
							</span>
						</div>
						{#if p.prompt}<span class="poll-prompt">{p.prompt}</span>{/if}
						<span class="poll-meta">
							{p.format === 'favorites' ? 'favorites + least' : 'full ranking'}
							· {p.itemCount} in the pool
							· {p.responseCount} {p.responseCount === 1 ? 'response' : 'responses'}
							{#if p.hasResponded}· <span class="done">you've ranked this</span>{/if}
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	.shell { min-height: 100dvh; display: flex; flex-direction: column; background: var(--paper); }
	main {
		flex: 1;
		padding: 2rem 1.5rem;
		padding-top: calc(2rem + var(--header-h, 52px));
		max-width: 720px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.page-header { margin-bottom: 1.5rem; }
	.back {
		display: inline-flex; align-items: center; gap: 0.3rem;
		font-size: 0.8rem; color: var(--muted-fg); text-decoration: none; margin-bottom: 0.6rem;
	}
	.back:hover { color: var(--accent); }
	.back .msi { font-size: 1rem; }
	h1 { font-family: 'Avara', serif; font-size: 2rem; font-weight: 400; margin: 0 0 0.35rem; color: var(--ink); }
	.subtitle { font-size: 0.85rem; color: var(--muted-fg); margin: 0; line-height: 1.5; max-width: 46ch; }

	.new {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.6rem 1rem; margin-bottom: 1.25rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: var(--md-sys-color-surface-container-low, var(--paper));
		color: var(--ink); font-size: 0.85rem; font-family: inherit; cursor: pointer;
		transition: border-color 0.15s;
	}
	.new:hover { border-color: var(--accent); }
	.new .msi { font-size: 1.1rem; color: var(--accent); }

	.composer {
		display: flex; flex-direction: column; gap: 0.9rem;
		border: 1.5px solid var(--border); border-radius: 16px;
		padding: 1.25rem; margin-bottom: 1.5rem;
		background: var(--md-sys-color-surface-container-low, var(--paper));
	}
	.field { display: flex; flex-direction: column; gap: 0.3rem; }
	.field > span { font-size: 0.78rem; color: var(--muted-fg); }
	.field em { font-style: normal; opacity: 0.65; }
	.field input, .field textarea {
		font-family: inherit; font-size: 0.9rem; color: var(--ink);
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		padding: 0.55rem 0.7rem; box-sizing: border-box; width: 100%; resize: vertical;
	}
	.field input:focus, .field textarea:focus { outline: none; border-color: var(--accent); }
	.formats { display: flex; flex-direction: column; gap: 0.4rem; }
	.fmt {
		display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.55rem;
		align-items: start; padding: 0.6rem 0.75rem;
		border: 1.5px solid var(--border); border-radius: 12px; cursor: pointer;
	}
	.fmt.on { border-color: var(--accent); }
	.fmt input { grid-row: span 2; margin-top: 0.2rem; accent-color: var(--accent); }
	.fmt-title { font-size: 0.85rem; color: var(--ink); }
	.fmt-blurb { font-size: 0.75rem; color: var(--muted-fg); line-height: 1.4; }
	.mins { display: flex; gap: 0.75rem; flex-wrap: wrap; }
	.min { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 130px; }
	.min > span { font-size: 0.75rem; color: var(--muted-fg); }
	.min input {
		font-family: inherit; font-size: 0.9rem; color: var(--ink);
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		padding: 0.45rem 0.6rem; width: 100%; box-sizing: border-box;
	}
	.fine { font-size: 0.73rem; color: var(--muted-fg); margin: -0.3rem 0 0; opacity: 0.85; }

	.check { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.82rem; color: var(--muted-fg); }
	.check input { margin-top: 0.15rem; accent-color: var(--accent); }
	.composer-actions { display: flex; align-items: center; gap: 0.6rem; }
	.count { font-size: 0.78rem; color: var(--muted-fg); margin-right: auto; }
	.count.short { opacity: 0.6; }
	button.primary, button.ghost {
		font-family: inherit; font-size: 0.85rem; padding: 0.5rem 0.95rem;
		border-radius: 10px; cursor: pointer; border: 1.5px solid var(--border);
	}
	button.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
	button.primary:disabled { opacity: 0.5; cursor: default; }
	button.ghost { background: transparent; color: var(--muted-fg); }

	.poll-list { display: flex; flex-direction: column; gap: 0.75rem; }
	.poll-card {
		display: flex; flex-direction: column; gap: 0.35rem;
		padding: 1rem 1.15rem; border: 1.5px solid var(--border); border-radius: 14px;
		background: var(--md-sys-color-surface-container-low, var(--paper));
		text-decoration: none; color: var(--ink);
		transition: border-color 0.15s, transform 0.15s;
	}
	.poll-card:hover { border-color: var(--accent); transform: translateY(-1px); }
	.poll-card.closed { opacity: 0.72; }
	.poll-head { display: flex; align-items: center; gap: 0.6rem; }
	.poll-title { font-family: 'Avara', serif; font-size: 1.05rem; flex: 1; }
	.badge {
		font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
		padding: 0.15rem 0.45rem; border-radius: 999px;
		border: 1px solid var(--border); color: var(--muted-fg); white-space: nowrap;
	}
	.badge.open { border-color: var(--accent); color: var(--accent); }
	.poll-prompt { font-size: 0.82rem; color: var(--muted-fg); line-height: 1.45; }
	.poll-meta { font-size: 0.75rem; color: var(--muted-fg); opacity: 0.85; }
	.done { color: var(--accent); }
	.muted { font-size: 0.85rem; color: var(--muted-fg); }
	.error { font-size: 0.82rem; color: var(--md-sys-color-error, #b3261e); margin: 0; }
</style>
