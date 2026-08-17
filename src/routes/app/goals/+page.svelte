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
		pageTitle.set('Tasks');
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

	// ── Manual add ───────────────────────────────────────────────────────
	// A task you type yourself (source='manual'), sitting alongside the ones
	// Gemma harvests from chat. Optimistic prepend; roll back on failure.
	let newTask = $state('');
	let adding = $state(false);
	async function addTask() {
		const label = newTask.trim();
		if (!label || adding) return;
		adding = true;
		try {
			const r = await fetch('/api/gemma/goal', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ add: label })
			});
			if (r.ok) {
				const j = await r.json().catch(() => ({}));
				if (j.goal) goals = [j.goal, ...goals];
				newTask = '';
			}
		} catch { /* leave the text in place so the user can retry */ }
		adding = false;
	}
	function onAddKey(e) {
		if (e.key === 'Enter') { e.preventDefault(); addTask(); }
	}

	// ── Group by date ────────────────────────────────────────────────────
	// Open goals group by the day they were harvested; completed goals by
	// the day they were checked off. Lists arrive newest-first, so groups
	// come out newest-first too.
	function parseIso(iso) {
		if (!iso) return null;
		try { return new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z'); } catch { return null; }
	}
	function dayLabel(iso) {
		const d = parseIso(iso);
		if (!d || isNaN(d)) return 'Earlier';
		const today = new Date(); today.setHours(0, 0, 0, 0);
		const day = new Date(d); day.setHours(0, 0, 0, 0);
		const diff = Math.round((today - day) / 86400000);
		if (diff <= 0) return 'Today';
		if (diff === 1) return 'Yesterday';
		return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
	}
	function groupByDay(list, dateOf) {
		const groups = [];
		for (const g of list) {
			const label = dayLabel(dateOf(g));
			const last = groups[groups.length - 1];
			if (last && last.label === label) last.items.push(g);
			else groups.push({ label, items: [g] });
		}
		return groups;
	}
	const openGroups = $derived(groupByDay(openGoals, (g) => g.createdAt));
	const doneGroups = $derived(groupByDay(doneGoals, (g) => g.doneAt ?? g.createdAt));

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

	// Pin a task as top priority (overrides Gemma's auto-rank). Re-sorts the
	// open list so the pinned one leads.
	async function togglePin(g) {
		const next = !g.priorityLocked;
		const prev = goals;
		goals = goals.map((x) => (x.goalId === g.goalId ? { ...x, priorityLocked: next } : x));
		sortGoals();
		try {
			const r = await fetch('/api/gemma/goal', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ goalId: g.goalId, pin: next })
			});
			if (!r.ok) throw new Error();
		} catch { goals = prev; }
	}
	// Keep open tasks ordered: pinned first, then their existing order.
	function sortGoals() {
		const open = goals.filter((g) => !g.done);
		const done = goals.filter((g) => g.done);
		open.sort((a, b) => (b.priorityLocked ? 1 : 0) - (a.priorityLocked ? 1 : 0));
		goals = [...open, ...done];
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

<svelte:head><title>Tasks — eating.computer</title></svelte:head>

{#snippet goalRow(g)}
	<li class="goal" class:done={g.done}>
		<div class="goal-row">
			<label class="goal-check">
				<input type="checkbox" checked={g.done} onchange={() => toggleGoal(g)} />
				<span>{g.label}{#if g.priorityLocked && !g.done}<span class="goal-top">top priority</span>{/if}{#if g.requestedBy}<span class="goal-by">asked by {g.requestedBy}</span>{/if}{#if g.done && g.doneAt}<span class="goal-done-date">✓ {doneDate(g.doneAt)}</span>{/if}</span>
			</label>
			<!-- Always rendered (visually hidden once done) so checking a task off
			     doesn't reflow the row width — the pin column keeps its space. -->
			<button class="goal-pin" class:pinned={g.priorityLocked} class:goal-pin-hidden={g.done} title={g.priorityLocked ? 'Unpin — let Gemma prioritize' : 'Pin as top priority'} disabled={g.done} onclick={() => togglePin(g)}>
				{g.priorityLocked ? '★' : '☆'}
			</button>
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
			<!-- The header already shows the "Tasks" title, so the body heading is
			     redundant — lead with the description instead. -->
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
					{#each openGroups as grp (grp.label)}
						<h3 class="goal-date">{grp.label}</h3>
						<ul class="goal-list">
							{#each grp.items as g (g.goalId)}{@render goalRow(g)}{/each}
						</ul>
					{/each}
				{:else}
					<p class="empty">Nothing open — say what you're working on in chat and Gemma will pick it up.</p>
				{/if}
			</section>

			{#if doneGoals.length}
				<section class="goals-section">
					<h2>Completed</h2>
					{#each doneGroups as grp (grp.label)}
						<h3 class="goal-date">{grp.label}</h3>
						<ul class="goal-list">
							{#each grp.items as g (g.goalId)}{@render goalRow(g)}{/each}
						</ul>
					{/each}
				</section>
			{/if}
		{/if}
	</main>

	<!-- Quick-add bar, pinned to the bottom. Lifts above the keyboard on the
	     native shell via the same --kb-height transform the chat compose uses. -->
	<div class="goal-add">
		<div class="goal-add-inner">
			<input
				class="goal-add-input"
				type="text"
				placeholder="Add a task…"
				enterkeyhint="done"
				bind:value={newTask}
				onkeydown={onAddKey}
			/>
			<button class="goal-add-btn" disabled={!newTask.trim() || adding} onclick={addTask}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				<span>Add</span>
			</button>
		</div>
	</div>
</div>

<style>
	.goals-shell { min-height: 100%; background: var(--paper); }
	/* Bottom padding clears the fixed quick-add bar so the last task isn't
	   hidden behind it. */
	main { max-width: 640px; margin: 0 auto; padding: calc(1rem + var(--header-h, 52px)) 1.25rem 6rem; }

	/* Quick-add composer, pinned to the bottom of the viewport (offset past the
	   sidebar on desktop, full width on a phone). */
	.goal-add {
		position: fixed; bottom: 0; right: 0; left: var(--sidebar-width, 220px);
		z-index: 20;
		background: color-mix(in srgb, var(--paper) 90%, transparent);
		-webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
		padding: 0.6rem 1.25rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
		transition: transform 0.2s ease;
	}
	/* Match the chat compose: lift above the keyboard on the native shell. */
	:global(body.native-app.kb-native-open) .goal-add {
		transform: translateY(calc(-1 * var(--kb-height, 0px)));
	}
	.goal-add-inner {
		max-width: 640px; margin: 0 auto;
		display: flex; align-items: center; gap: 0.5rem;
		background: var(--paper);
		border: 1.5px solid var(--border); border-radius: 999px;
		padding: 0.3rem 0.4rem 0.3rem 0.95rem;
	}
	.goal-add-inner:focus-within { border-color: var(--accent); }
	.goal-add-input {
		flex: 1; min-width: 0; border: none; background: none; outline: none;
		font-size: 0.95rem; color: var(--ink); font-family: inherit;
	}
	.goal-add-input::placeholder { color: var(--muted-fg); }
	.goal-add-btn {
		flex-shrink: 0; border: none; border-radius: 999px;
		background: var(--accent); color: var(--paper);
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.45rem 0.9rem 0.45rem 0.75rem;
		font-family: inherit; font-size: 0.85rem; font-weight: 700; cursor: pointer;
		transition: opacity 0.15s ease;
	}
	.goal-add-btn svg { display: block; }
	.goal-add-btn:disabled { opacity: 0.35; cursor: default; }
	@media (max-width: 640px) {
		/* Sit directly above the fixed bottom nav (56px tall + its safe-area pad),
		   not underneath it. The nav already carries the home-indicator inset, so
		   drop this bar's own bottom safe-area padding here. */
		.goal-add {
			left: 0; padding-left: 1rem; padding-right: 1rem;
			bottom: calc(56px + env(safe-area-inset-bottom, 0px));
			padding-bottom: 0.6rem;
		}
		/* Clear the add bar (~3.4rem) sitting above the bottom nav. */
		main { padding-bottom: 4rem; }
	}
	.page-head h1 { font-family: 'Avara', serif; font-size: 1.5rem; margin: 0 0 0.35rem; }
	.page-sub { font-size: 0.85rem; color: var(--muted-fg); margin: 0 0 1.5rem; line-height: 1.5; }
	.goals-section { margin-bottom: 1.75rem; }
	.goals-section h2 {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent));
		margin: 0 0 0.5rem;
	}
	.goal-date {
		font-size: 0.72rem; font-weight: 600; color: var(--muted-fg);
		margin: 0.9rem 0 0.15rem;
	}
	.goal-date:first-of-type { margin-top: 0.25rem; }
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
	.goal-top {
		display: inline-block; margin-left: 0.4rem; padding: 0.05rem 0.4rem;
		font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		border-radius: 99px; vertical-align: 1px;
	}
	.goal-pin {
		background: none; border: none; cursor: pointer; padding: 0 0.15rem;
		color: var(--muted-fg); font-size: 1rem; line-height: 1.2; flex-shrink: 0;
	}
	.goal-pin-hidden { visibility: hidden; pointer-events: none; }
	.goal-pin:hover { color: var(--accent); }
	.goal-pin.pinned { color: var(--accent); }
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
