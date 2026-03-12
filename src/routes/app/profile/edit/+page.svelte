<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<svelte:head><title>Edit profile — eating.computer</title></svelte:head>

<div class="shell">
	<header>
		<a class="wordmark" href="/">eating.computer</a>
	</header>

	<main>
		<a class="back" href="/app">← Back</a>

		<div class="card">
			<h1>Edit profile</h1>

			{#if form?.error}
				<p class="error">{form.error}</p>
			{/if}

			<form method="POST" use:enhance>
				<label>
					<span>Name <span class="req">*</span></span>
					<input type="text" name="name" value={form?.name ?? data.prefill.name} required placeholder="Your full name" />
				</label>

				<label>
					<span>Pronouns</span>
					<input type="text" name="pronouns" value={form?.pronouns ?? data.prefill.pronouns} placeholder="e.g. she/her, they/them" />
				</label>

				<label>
					<span>Bio</span>
					<textarea name="bio" placeholder="A little about yourself…" rows="4">{form?.bio ?? data.prefill.bio}</textarea>
				</label>

				<label>
					<span>Website / portfolio</span>
					<input type="url" name="website" value={form?.website ?? data.prefill.website} placeholder="https://yoursite.com" />
				</label>

				<div class="form-actions">
					<a class="btn-ghost" href="/app">Cancel</a>
					<button type="submit" class="btn-primary">Save changes</button>
				</div>
			</form>
		</div>
	</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	header {
		display: flex;
		align-items: center;
		padding: 1rem 2rem;
		border-bottom: 1.5px solid #ddd7cc;
	}

	.wordmark {
		font-family: 'Cambridge', serif;
		font-size: 1.25rem;
		color: var(--ink);
		text-decoration: none;
	}
	.wordmark:hover { opacity: 0.7; }

	main {
		padding: 2rem;
		max-width: 480px;
		width: 100%;
		margin: 0 auto;
	}

	.back {
		display: inline-block;
		font-size: 0.85rem;
		color: #a09688;
		text-decoration: none;
		margin-bottom: 1.5rem;
	}
	.back:hover { color: var(--ink); }

	.card {
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 16px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	h1 {
		font-family: 'Cambridge', serif;
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0 0 0.25rem;
		color: var(--ink);
	}

	.error {
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		font-size: 0.85rem;
		color: #b91c1c;
		margin: 0;
	}

	form { display: flex; flex-direction: column; gap: 1rem; }
	label { display: flex; flex-direction: column; gap: 0.35rem; }
	label span { font-size: 0.82rem; font-weight: 600; color: var(--ink); }
	.req { color: #e53935; }

	input, textarea {
		padding: 0.6rem 0.85rem;
		border: 1.5px solid #c8c1b4;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.9rem;
		color: var(--ink);
		background: #fff;
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}
	input:focus, textarea:focus { border-color: var(--ink); }
	textarea { resize: vertical; }

	.form-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.btn-primary {
		padding: 0.6rem 1.4rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }

	.btn-ghost {
		padding: 0.6rem 0.75rem;
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.9rem;
		color: #a09688;
		cursor: pointer;
		text-decoration: none;
	}
	.btn-ghost:hover { color: var(--ink); }
</style>
