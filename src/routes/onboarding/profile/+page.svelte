<script>
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<svelte:head><title>Set up your profile — eating.computer</title></svelte:head>

<div class="card">
	<div class="step-label">Step 1 of 2</div>
	<h1>Set up your profile</h1>
	<p class="sub">This is how your classmates will see you.</p>

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
			<textarea name="bio" placeholder="A little about yourself…" rows="3">{form?.bio ?? data.prefill.bio}</textarea>
		</label>

		<label>
			<span>Website / portfolio</span>
			<input type="url" name="website" value={form?.website ?? data.prefill.website} placeholder="https://yoursite.com" />
		</label>

		<button type="submit" class="btn-primary">Continue →</button>
	</form>
</div>

<style>
	.card {
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 16px;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 440px;
	}

	.step-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #a09688;
		margin-bottom: 0.75rem;
	}

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

	label { display: flex; flex-direction: column; gap: 0.35rem; }
	label span { font-size: 0.82rem; font-weight: 600; color: var(--ink, #1a1a1a); }

	.req { color: #e53935; }

	input, textarea {
		padding: 0.6rem 0.85rem;
		border: 1.5px solid #c8c1b4;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.9rem;
		color: var(--ink, #1a1a1a);
		background: #fff;
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}
	input:focus, textarea:focus { border-color: var(--ink, #1a1a1a); }
	textarea { resize: vertical; }

	.btn-primary {
		margin-top: 0.5rem;
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
</style>
