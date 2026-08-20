<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let selected = $state(data.classes[0]?.id ?? '');
	// Nearly always exactly one class is open for enrollment, and asking someone
	// to "choose" from a list of one is a decision they can't actually make.
	// Confirm it instead; the radio list only appears when there IS a choice.
	const only = $derived(data.classes.length === 1 ? data.classes[0] : null);
</script>

<svelte:head><title>Choose your class — eating.computer</title></svelte:head>

<div class="card">
	<a class="back" href="/onboarding/profile">← Back</a>
	<h1>{only ? 'Is this right?' : 'Choose your class'}</h1>
	<p class="sub">Your instructor will approve your request before you get access.</p>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	<form method="POST" use:enhance>
		{#if only}
			<input type="hidden" name="class_id" value={only.id} />
			<div class="confirm-card">
				<span class="confirm-check" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
						stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
				</span>
				<span class="class-name">{only.name}</span>
				<span class="class-term">{only.term}</span>
				{#if only.description}<p class="class-desc">{only.description}</p>{/if}
			</div>
		{:else}
		<div class="class-list">
			{#each data.classes as cls}
				<label class="class-card" class:selected={selected === cls.id}>
					<input type="radio" name="class_id" value={cls.id} bind:group={selected} />
					<div class="class-info">
						<span class="class-name">{cls.name}</span>
						<span class="class-term">{cls.term}</span>
						{#if cls.description}<p class="class-desc">{cls.description}</p>{/if}
					</div>
					<span class="check">{selected === cls.id ? '●' : '○'}</span>
				</label>
			{/each}
		</div>
		{/if}

		{#if !data.classes.length}
			<p class="empty">No classes are open for enrollment yet. Check back soon.</p>
		{/if}

		<button type="submit" class="btn-primary" disabled={!data.classes.length || (!only && !selected)}>
			{only ? "Yes, that's my class" : 'Request to join →'}
		</button>
	</form>
</div>

<style>
	.card {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 480px;
	}

	.back {
		display: inline-block;
		font-size: 0.82rem;
		color: var(--muted-fg);
		text-decoration: none;
		margin-bottom: 1rem;
	}
	.back:hover { color: var(--ink, var(--ink)); }

	/* Single-class confirmation: no radio, no decision — just the class and a
	   tick, so the step reads as "confirm" rather than "pick one of one". */
	.confirm-card {
		display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
		padding: 1.75rem 1.25rem;
		border: 1.5px solid var(--md-sys-color-primary, var(--ink));
		border-radius: 14px;
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--ink)) 7%, var(--paper));
		text-align: center;
		margin-bottom: 1.25rem;
		animation: confirm-in 0.32s cubic-bezier(0.33, 1, 0.68, 1) both;
	}
	@keyframes confirm-in { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: none; } }
	@media (prefers-reduced-motion: reduce) { .confirm-card { animation: none; } }
	.confirm-check {
		display: inline-flex; align-items: center; justify-content: center;
		width: 46px; height: 46px; border-radius: 50%;
		background: var(--md-sys-color-primary, var(--ink));
		color: var(--md-sys-color-on-primary, var(--paper));
		margin-bottom: 0.4rem;
	}

	h1 {
		font-family: 'Avara', serif;
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0 0 0.4rem;
		color: var(--ink, var(--ink));
	}

	.sub {
		font-size: 0.9rem;
		color: var(--muted-fg);
		margin: 0 0 1.75rem;
	}

	.error {
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		font-size: 0.85rem;
		color: #b91c1c;
		margin-bottom: 1rem;
	}

	form { display: flex; flex-direction: column; gap: 1rem; }

	.class-list { display: flex; flex-direction: column; gap: 0.75rem; }

	.class-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border: 1.5px solid var(--border);
		border-radius: 12px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.class-card:hover { border-color: var(--muted-fg); }
	.class-card.selected { border-color: var(--ink, var(--ink)); background: var(--surface-2); }
	.class-card input[type="radio"] { display: none; }

	.class-info { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; }
	.class-name { font-size: 1rem; font-weight: 600; color: var(--ink, var(--ink)); }
	.class-term { font-size: 0.78rem; color: var(--muted-fg); font-weight: 500; }
	.class-desc { font-size: 0.82rem; color: var(--muted-fg); margin: 0.3rem 0 0; line-height: 1.4; }

	.check { font-size: 1rem; color: var(--ink, var(--ink)); flex-shrink: 0; margin-top: 0.1rem; }

	.empty { font-size: 0.9rem; color: var(--muted-fg); }

	.btn-primary {
		padding: 0.7rem 1.5rem;
		background: var(--ink, var(--ink));
		color: var(--paper, var(--paper));
		border: none;
		border-radius: 10px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
		align-self: flex-end;
	}
	.btn-primary:hover { opacity: 0.8; }
	.btn-primary:disabled { opacity: 0.4; cursor: default; }
</style>
