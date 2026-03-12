<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let selected = $state(data.classes[0]?.id ?? '');
</script>

<svelte:head><title>Choose your class — eating.computer</title></svelte:head>

<div class="card">
	<a class="back" href="/onboarding/profile">← Back</a>
	<h1>Choose your class</h1>
	<p class="sub">Your instructor will approve your request before you get access.</p>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	<form method="POST" use:enhance>
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
			{#if !data.classes.length}
				<p class="empty">No classes are available yet. Check back soon.</p>
			{/if}
		</div>

		<button type="submit" class="btn-primary" disabled={!selected || !data.classes.length}>
			Request to join →
		</button>
	</form>
</div>

<style>
	.card {
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 16px;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 480px;
	}

	.back {
		display: inline-block;
		font-size: 0.82rem;
		color: #a09688;
		text-decoration: none;
		margin-bottom: 1rem;
	}
	.back:hover { color: var(--ink, #1a1a1a); }

	h1 {
		font-family: 'Cambridge', serif;
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0 0 0.4rem;
		color: var(--ink, #1a1a1a);
	}

	.sub {
		font-size: 0.9rem;
		color: #a09688;
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
		border: 1.5px solid #ddd7cc;
		border-radius: 12px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.class-card:hover { border-color: #a09688; }
	.class-card.selected { border-color: var(--ink, #1a1a1a); background: #faf7f2; }
	.class-card input[type="radio"] { display: none; }

	.class-info { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; }
	.class-name { font-size: 1rem; font-weight: 600; color: var(--ink, #1a1a1a); }
	.class-term { font-size: 0.78rem; color: #a09688; font-weight: 500; }
	.class-desc { font-size: 0.82rem; color: #666; margin: 0.3rem 0 0; line-height: 1.4; }

	.check { font-size: 1rem; color: var(--ink, #1a1a1a); flex-shrink: 0; margin-top: 0.1rem; }

	.empty { font-size: 0.9rem; color: #a09688; }

	.btn-primary {
		padding: 0.7rem 1.5rem;
		background: var(--ink, #1a1a1a);
		color: var(--paper, #f7f2ea);
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
