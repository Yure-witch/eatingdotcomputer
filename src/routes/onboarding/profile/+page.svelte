<script>
	import { enhance } from '$app/forms';
	import AvatarPicker from '$lib/components/AvatarPicker.svelte';
	import FormattedInput from '$lib/components/FormattedInput.svelte';
	let { data, form } = $props();

	const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Other'];

	// Same picker shape /app/profile/edit uses. Default to 'gen' so a
	// brand-new user gets the generative gradient + initial without
	// having to interact with the picker. They can swap to photo or
	// emote any time later from their profile.
	let avatarKind = $state(data.prefill.avatarKind ?? 'gen');
	let avatarValue = $state(data.prefill.avatarValue ?? null);
	let photoFile = $state(null);

	// Bio uses FormattedInput so students/teachers can drop inline
	// emotes (emoji, Emoji Kitchen mixes, custom emotes, animated TG
	// stickers) into their own bio at onboarding. Hidden input mirrors
	// the value into the form payload so the existing server action
	// (which reads `data.get('bio')`) keeps working unchanged.
	let bioValue = $state(form?.bio ?? data.prefill.bio ?? '');
</script>

<svelte:head><title>Set up your profile — eating.computer</title></svelte:head>

<div class="card">
	<h1>Set up your profile</h1>
	<p class="sub">This is how your classmates will see you.</p>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{/if}

	<form method="POST" enctype="multipart/form-data" use:enhance={({ formData }) => {
		if (avatarKind === 'photo' && photoFile) {
			formData.append('avatar_photo', photoFile);
		}
	}}>
		<div class="avatar-section">
			<AvatarPicker
				name={form?.name ?? data.prefill.name}
				uid={data.session?.user?.id ?? data.prefill.name}
				bind:avatarKind
				bind:avatarValue
				bind:photoFile
			/>
		</div>
		<input type="hidden" name="avatar_kind" value={avatarKind} />
		<input type="hidden" name="avatar_value" value={avatarKind === 'expr' ? (avatarValue ?? '') : ''} />

		<label>
			<span>Name <span class="req">*</span></span>
			<input type="text" name="name" value={form?.name ?? data.prefill.name} required placeholder="Your full name" />
		</label>

		<label>
			<span>Pronouns</span>
			<input type="text" name="pronouns" value={form?.pronouns ?? data.prefill.pronouns} placeholder="e.g. she/her, they/them" />
		</label>

		<div class="row-2">
			<label>
				<span>Year</span>
				<select name="year">
					<option value="">Select year</option>
					{#each YEARS as y}
						<option value={y} selected={(form?.year ?? data.prefill.year) === y}>{y}</option>
					{/each}
				</select>
			</label>

			<label class="grow">
				<span>School / University</span>
				<input type="text" name="school" value={form?.school ?? data.prefill.school} placeholder="e.g. RISD, Parsons" />
			</label>
		</div>

		<label>
			<span>Focus / Major</span>
			<input type="text" name="focus" value={form?.focus ?? data.prefill.focus} placeholder="e.g. Graphic Design, Illustration" />
		</label>

		<label>
			<span>Bio</span>
			<input type="hidden" name="bio" value={bioValue} />
			<div class="bio-fi">
				<FormattedInput bind:value={bioValue} placeholder="A little about yourself…" />
			</div>
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
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		padding: 2.5rem 2rem;
		width: 100%;
		max-width: 480px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	h1 {
		font-family: 'Avara', serif;
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0 0 0.1rem;
		color: var(--ink, var(--ink));
	}

	.sub {
		font-size: 0.9rem;
		color: var(--muted-fg);
		margin: 0 0 0.5rem;
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

	form { display: flex; flex-direction: column; gap: 0.9rem; }
	label { display: flex; flex-direction: column; gap: 0.35rem; }
	label span { font-size: 0.82rem; font-weight: 600; color: var(--ink, var(--ink)); }
	.req { color: #e53935; }

	.row-2 { display: flex; gap: 0.75rem; }
	.row-2 label { flex: 1; min-width: 0; }
	.grow { flex: 2 !important; }

	input, textarea, select {
		padding: 0.6rem 0.85rem;
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.9rem;
		color: var(--ink, var(--ink));
		background: var(--paper);
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}
	input:focus, textarea:focus, select:focus { border-color: var(--ink, var(--ink)); }
	textarea { resize: vertical; }

	.btn-primary {
		margin-top: 0.25rem;
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
	/* Match the visual weight of the textarea this replaced — same
	   border / radius / min-height so the bio field doesn't suddenly
	   feel foreign next to the inputs above it. The inner contenteditable
	   gets its own padding from FormattedInput's defaults. */
	.bio-fi {
		border: 1.5px solid var(--border);
		border-radius: 8px;
		background: var(--paper);
	}
	.bio-fi :global(.fi-wrap) { padding: 0; }
	.bio-fi :global(.fi-ce) {
		min-height: 72px; padding: 0.55rem 0.75rem;
		font-size: 0.9rem; line-height: 1.45;
	}

	.avatar-section {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0 0.5rem;
		position: relative;
	}
</style>
