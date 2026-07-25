<script>
	// 🎯 Goals — the historical todo list Gemma curates from chat.
	// Open goals + assignment action items up top, completed history below.
	// Checkboxes persist (item_completions / gemma_goals), sources stay
	// cited (Show source → highlighted quote, click → the message), and
	// removal keeps the two-step ✕ → "Remove?" confirm.
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';

	let loading = $state(true);
	let goals = $state([]);
	let actionItems = $state([]);

	onMount(async () => {
		pageTitle.set('Goals');
		try {
			const r = await fetch('/api/gemma/goal');
			if (r.ok) {
				const j = await r.json();
				goals = (j.goals ?? []);
				actionItems = (j.actionItems ?? []).map((it) => ({ ...it, done: false }));
			}
		} catch { /* empty state below */ }
		loading = false;
	});

	const openGoals = $derived(goals.filter((g) => !g.done));
	const doneGoals = $derived(goals.filter((g) => g.done));

	async function toggleGoal(g) {
		const next = !g.done;
		goals = goals.map((x) => (x.goalId === g.goalId ? { ...x, done: next } : x));
		try {
			const r = await fetch('/api/gemma/goal', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ goalId: g.goalId, done: next })
			});
			if (!r.ok) throw new Error();
		} catch {
			goals = goals.map((x) => (x.goalId === g.goalId ? { ...x, done: !next } : x));
		}
	}

	// Two-step removal: ✕ arms "Remove?" for 3s; second click deletes.
	let removeArmed = $state(null);
	let _disarmTimer = null;
	async function removeGoal(g) {
		if (removeArmed !== g.goalId) {
			removeArmed = g.goalId;
			clearTimeout(_disarmTimer);
			_disarmTimer = setTimeout(() => (removeArmed = null), 3000);
			return;
		}
		removeArmed = null;
		clearTimeout(_disarmTimer);
		const prev = goals;
		goals = goals.filter((x) => x.goalId !== g.goalId);
		try {
			const r = await fetch('/api/gemma/goal', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ goalId: g.goalId, remove: true })
			});
			if (!r.ok) throw new Error();
		} catch { goals = prev; }
	}

	async function toggleAction(it) {
		const next = !it.done;
		actionItems = actionItems.map((x) => (x.itemId === it.itemId ? { ...x, done: next } : x));
		try {
			const r = await fetch('/api/gemma/action', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: it.itemId, done: next })
			});
			if (!r.ok) throw new Error();
		} catch {
			actionItems = actionItems.map((x) => (x.itemId === it.itemId ? { ...x, done: !next } : x));
		}
	}

	// Source previews collapsed behind "Show source"; highlight the span
	// the model grounded the goal in.
	let shownSources = $state({});
	const toggleSource = (id) => (shownSources = { ...shownSources, [id]: !shownSources[id] });
	function highlightParts(text, quote) {
		if (!quote) return { before: text, hit: '', after: '' };
		const i = text.toLowerCase().indexOf(quote.toLowerCase());
		if (i < 0) return { before: text, hit: '', after: '' };
		return { before: text.slice(0, i), hit: text.slice(i, i + quote.length), after: text.slice(i + quote.length) };
	}

	const doneDate = (iso) => {
		try { return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
	};
</script>

<svelte:head><title>Goals — eating.computer</title></svelte:head>

{#snippet goalRow(g)}
	<li class="goal" class:done={g.done}>
		<div class="goal-row">
			<label class="goal-check">
				<input type="checkbox" checked={g.done} onchange={() => toggleGoal(g)} />
				<span>{g.label}{#if g.requestedBy}<span class="goal-by">asked by {g.requestedBy}</span>{/if}{#if g.done && g.doneAt}<span class="goal-done-date">✓ {doneDate(g.doneAt)}</span>{/if}</span>
			</label>
			<button class="goal-remove" class:armed={removeArmed === g.goalId} title={removeArmed === g.goalId ? 'Click again to remove' : 'Remove this goal'} onclick={() => removeGoal(g)}>
				{removeArmed === g.goalId ? 'Remove?' : '✕'}
			</button>
		</div>
		{#if g.sourceText || g.sourceUrl}
			<button class="goal-srcbtn" onclick={() => toggleSource(g.goalId)}>
				<span class="msi">chat</span> {shownSources[g.goalId] ? 'Hide source' : 'Show source'}
			</button>
		{/if}
		{#if shownSources[g.goalId]}
			{#if g.sourceText}
				{@const hp = highlightParts(g.sourceText, g.sourceQuote)}
				<a class="goal-preview" href={g.sourceUrl ?? '#'} title="Jump to this message">
					<span class="goal-preview-who">{g.requestedBy ?? 'You'}:</span>
					“{hp.before}{#if hp.hit}<mark>{hp.hit}</mark>{/if}{hp.after}”
				</a>
			{:else if g.sourceUrl}
				<a class="goal-src" href={g.sourceUrl}>↗ from {g.requestedBy ? `${g.requestedBy}'s` : 'your'} message</a>
			{/if}
		{/if}
	</li>
{/snippet}

<div class="goals-shell">
	<main>
		<div class="page-head">
			<h1>🎯 Goals</h1>
			<p class="page-sub">Gemma keeps this list from what you say (and what people ask of you) in chat. Check things off, remove what doesn't belong — completed goals stay below as history.</p>
		</div>

		{#if loading}
			<p class="empty">Loading…</p>
		{:else}
			{#if actionItems.length}
				<section class="goals-section">
					<h2>✅ Assignment items</h2>
					<ul class="goal-list">
						{#each actionItems as it (it.itemId)}
							<li class="goal" class:done={it.done}>
								<div class="goal-row">
									{#if it.requiresSubmission}
										<a class="goal-submit" href="/app">↗ {it.label} <span class="goal-hint">needs submission</span></a>
									{:else}
										<label class="goal-check">
											<input type="checkbox" checked={it.done} onchange={() => toggleAction(it)} />
											<span>{it.label}</span>
										</label>
									{/if}
								</div>
								<span class="goal-week">Week {it.week}{it.dueDate ? ` · due ${it.dueDate}` : ''}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="goals-section">
				<h2>Open</h2>
				{#if openGoals.length}
					<ul class="goal-list">
						{#each openGoals as g (g.goalId)}{@render goalRow(g)}{/each}
					</ul>
				{:else}
					<p class="empty">Nothing open — say what you're working on in chat and Gemma will pick it up.</p>
				{/if}
			</section>

			{#if doneGoals.length}
				<section class="goals-section">
					<h2>Completed</h2>
					<ul class="goal-list">
						{#each doneGoals as g (g.goalId)}{@render goalRow(g)}{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.goals-shell { min-height: 100%; background: var(--paper); }
	main { max-width: 640px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
	.page-head h1 { font-family: 'Avara', serif; font-size: 1.5rem; margin: 0 0 0.35rem; }
	.page-sub { font-size: 0.85rem; color: var(--muted-fg); margin: 0 0 1.5rem; line-height: 1.5; }
	.goals-section { margin-bottom: 1.75rem; }
	.goals-section h2 {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent));
		margin: 0 0 0.5rem;
	}
	.goal-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	.goal { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.6rem 0; }
	.goal:not(:last-child) { border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
	.goal-row { display: flex; align-items: flex-start; gap: 0.4rem; }
	.goal-check { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 0.55rem; cursor: pointer; }
	.goal-check input {
		appearance: none; -webkit-appearance: none;
		width: 24px; height: 24px; margin: 0; flex-shrink: 0;
		border: 2px solid var(--border); border-radius: 6px;
		background: var(--paper); cursor: pointer;
		display: inline-flex; align-items: center; justify-content: center;
		transition: all 0.15s;
	}
	.goal-check:hover input:not(:checked) { border-color: var(--muted-fg); }
	.goal-check input:checked { background: var(--ink); border-color: var(--ink); }
	.goal-check input:checked::after {
		content: '';
		width: 11px; height: 6px;
		border-left: 3px solid var(--paper);
		border-bottom: 3px solid var(--paper);
		transform: rotate(-45deg) translateY(-2px);
	}
	.goal-check span { padding-top: 2px; line-height: 1.45; font-size: 0.92rem; }
	.goal.done .goal-check > span { text-decoration: line-through; opacity: 0.55; }
	.goal-by {
		display: inline-block; margin-left: 0.4rem; padding: 0.05rem 0.4rem;
		font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
		color: var(--md-sys-color-primary, var(--accent));
		border: 1px solid color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 45%, transparent);
		border-radius: 99px; vertical-align: 1px;
	}
	.goal-done-date { margin-left: 0.4rem; font-size: 0.7rem; color: var(--muted-fg); text-decoration: none; }
	.goal-remove {
		background: none; border: none; cursor: pointer; padding: 0 0.15rem;
		color: var(--muted-fg); font-size: 0.75rem; line-height: 1.4; flex-shrink: 0;
	}
	.goal-remove:hover { color: var(--ink); }
	.goal-remove.armed {
		color: #fff; background: #c0392b; border-radius: 6px;
		font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.4rem;
	}
	.goal-srcbtn {
		display: inline-flex; align-items: center; gap: 0.25rem;
		background: none; border: none; cursor: pointer; padding: 0;
		margin-left: calc(24px + 0.55rem); margin-top: 0.1rem;
		font-size: 0.68rem; font-weight: 600; color: var(--muted-fg);
		align-self: flex-start;
	}
	.goal-srcbtn:hover { color: var(--md-sys-color-primary, var(--accent)); }
	.goal-srcbtn .msi { font-size: 14px; line-height: 1; }
	.goal-preview {
		display: block; margin-left: calc(24px + 0.55rem); margin-top: 0.15rem;
		padding: 0.35rem 0.55rem;
		font-size: 0.74rem; line-height: 1.45; color: var(--muted-fg);
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		border-left: 2.5px solid color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 55%, var(--border));
		border-radius: 0 8px 8px 0;
		text-decoration: none;
	}
	.goal-preview:hover { background: color-mix(in srgb, var(--ink) 9%, transparent); }
	.goal-preview mark {
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 26%, transparent);
		color: var(--ink); border-radius: 3px; padding: 0 2px;
	}
	.goal-preview-who { font-weight: 700; margin-right: 0.25rem; color: var(--ink); }
	.goal-src { font-size: 0.68rem; color: var(--muted-fg); text-decoration: none; margin-left: calc(24px + 0.55rem); }
	.goal-src:hover { color: var(--md-sys-color-primary, var(--accent)); text-decoration: underline; }
	.goal-submit { color: inherit; text-decoration: none; font-weight: 500; font-size: 0.92rem; }
	.goal-submit:hover { text-decoration: underline; }
	.goal-hint { font-size: 0.7rem; color: var(--muted-fg); font-weight: 400; }
	.goal-week { font-size: 0.7rem; color: var(--muted-fg); padding-left: calc(24px + 0.55rem); }
	.empty { color: var(--muted-fg); font-size: 0.85rem; }
</style>
