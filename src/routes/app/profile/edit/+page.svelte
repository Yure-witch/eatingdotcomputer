<script>
	import { enhance } from '$app/forms';
	import AvatarPicker from '$lib/components/AvatarPicker.svelte';
	import FormattedInput from '$lib/components/FormattedInput.svelte';
	let { data, form } = $props();

	const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Other'];

	// Avatar state. Pre-filled from whatever is already on the row;
	// the AvatarPicker binds these so submit picks them up. photoFile
	// is the raw File object the user picked — appended to the form
	// FormData inside use:enhance so the server can stream it to R2.
	let avatarKind = $state(data.prefill.avatarKind ?? 'gen');
	let avatarValue = $state(data.prefill.avatarValue ?? null);
	let photoFile = $state(null);

	// Bio uses FormattedInput so inline emotes work here too. Hidden
	// input mirrors the value into the form payload; the existing
	// server action reads `data.get('bio')` unchanged.
	let bioValue = $state(form?.bio ?? data.prefill.bio ?? '');

	// Gemma digest opt-in (instant save, independent of the form). Synced
	// from the server at mount — page-load data can be stale if the setting
	// changed elsewhere (e.g. the opt-out button on the Gemma page).
	import { onMount } from 'svelte';
	let gemmaOptIn = $state(data.prefill.gemmaDigest ?? false);
	let gemmaOptInStatus = $state('');
	let gemmaScanDms = $state(false);
	let gemmaScanStatus = $state('');
	onMount(async () => {
		try {
			const r = await fetch('/api/gemma/settings');
			if (r.ok) {
				const j = await r.json();
				gemmaOptIn = j.optIn;
				gemmaScanDms = j.scanDms ?? false;
			}
		} catch { /* keep prefill */ }
	});
	async function toggleGemmaScanDms() {
		gemmaScanDms = !gemmaScanDms;
		gemmaScanStatus = 'saving…';
		try {
			const r = await fetch('/api/gemma/settings', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ scanDms: gemmaScanDms })
			});
			gemmaScanStatus = r.ok ? 'saved' : 'failed';
			if (!r.ok) gemmaScanDms = !gemmaScanDms;
		} catch { gemmaScanStatus = 'failed'; gemmaScanDms = !gemmaScanDms; }
		setTimeout(() => (gemmaScanStatus = ''), 2000);
	}
	async function toggleGemmaOptIn() {
		gemmaOptIn = !gemmaOptIn;
		gemmaOptInStatus = 'saving…';
		try {
			const r = await fetch('/api/gemma/settings', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ optIn: gemmaOptIn })
			});
			gemmaOptInStatus = r.ok ? 'saved' : 'failed';
			if (!r.ok) gemmaOptIn = !gemmaOptIn;
		} catch { gemmaOptInStatus = 'failed'; gemmaOptIn = !gemmaOptIn; }
		setTimeout(() => (gemmaOptInStatus = ''), 2000);
	}
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

			<form method="POST" enctype="multipart/form-data" use:enhance={({ formData }) => {
				// AvatarPicker holds the photo File outside the form so
				// SvelteKit's FormData serialisation doesn't know about
				// it. Append at submit time. The hidden fields below
				// already carry kind + value.
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

				<div class="form-actions">
					<a class="btn-ghost" href="/app">Cancel</a>
					<button type="submit" class="btn-primary">Save changes</button>
				</div>
			</form>

			<!-- Gemma daily digest opt-in — saved instantly, separate from the
			     profile form (hits /api/gemma/settings directly). -->
			<label class="gemma-optin-row">
				<input type="checkbox" checked={gemmaOptIn} onchange={toggleGemmaOptIn} />
				<span class="gemma-optin-text">
					<span class="gemma-optin-title">Gemma digest</span>
					<span class="gemma-optin-sub">Each morning Gemma DMs you a recap of yesterday's class chat, reminders for anything you haven't finished, and a little inspiration. If nothing's changed, you just get a short reminder (or nothing at all). Opt out any time.{gemmaOptInStatus ? ` — ${gemmaOptInStatus}` : ''}</span>
				</span>
			</label>

			<label class="gemma-optin-row gemma-optin-sub-row">
				<input type="checkbox" checked={gemmaScanDms} onchange={toggleGemmaScanDms} />
				<span class="gemma-optin-text">
					<span class="gemma-optin-title">Let Gemma read all my DMs</span>
					<span class="gemma-optin-sub">For goal tracking, Gemma normally only reads class channels and your chats with instructors. Turn this on to let her also pick up goals and requests from your other DMs.{gemmaScanStatus ? ` — ${gemmaScanStatus}` : ''}</span>
				</span>
			</label>
		</div>
	</main>
</div>

<style>
	.shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--paper); }

	header { display: flex; align-items: center; padding: 1rem 2rem; border-bottom: 1.5px solid var(--border); }
	.wordmark { font-family: 'Avara', serif; font-size: 1.25rem; color: var(--ink); text-decoration: none; }
	.wordmark:hover { opacity: 0.7; }

	main { padding: 2rem; max-width: 480px; width: 100%; margin: 0 auto; }

	.back { display: inline-block; font-size: 0.85rem; color: var(--muted-fg); text-decoration: none; margin-bottom: 1.5rem; }
	.back:hover { color: var(--ink); }

	.gemma-optin-row {
		display: flex; align-items: flex-start; gap: 0.6rem;
		margin-top: 1.25rem; padding-top: 1.25rem;
		border-top: 1.5px solid var(--border);
		cursor: pointer;
	}
	.gemma-optin-row input { margin-top: 0.2rem; accent-color: var(--ink); cursor: pointer; }
	.gemma-optin-sub-row { margin-top: 0.75rem; padding-top: 0; border-top: none; }
	.gemma-optin-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.gemma-optin-title { font-weight: 600; font-size: 0.9rem; }
	.gemma-optin-sub { font-size: 0.78rem; color: var(--muted-fg); line-height: 1.4; }

	.card {
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 16px;
		padding: 2rem; display: flex; flex-direction: column; gap: 1rem;
	}

	h1 { font-family: 'Avara', serif; font-size: 1.75rem; font-weight: 400; margin: 0 0 0.25rem; color: var(--ink); }

	.error { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 0.6rem 0.85rem; font-size: 0.85rem; color: #b91c1c; margin: 0; }

	form { display: flex; flex-direction: column; gap: 1rem; }
	label { display: flex; flex-direction: column; gap: 0.35rem; }
	label span { font-size: 0.82rem; font-weight: 600; color: var(--ink); }
	.req { color: #e53935; }

	.row-2 { display: flex; gap: 0.75rem; }
	.row-2 label { flex: 1; min-width: 0; }
	.grow { flex: 2 !important; }

	input, textarea, select {
		padding: 0.6rem 0.85rem; border: 1.5px solid var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.9rem; color: var(--ink); background: var(--paper);
		outline: none; transition: border-color 0.15s; width: 100%; box-sizing: border-box;
	}
	input:focus, textarea:focus, select:focus { border-color: var(--ink); }
	textarea { resize: vertical; }

	.form-actions { display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }

	.btn-primary {
		padding: 0.6rem 1.4rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 8px; font-family: inherit; font-size: 0.95rem;
		font-weight: 600; cursor: pointer; transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }

	.btn-ghost { padding: 0.6rem 0.75rem; background: none; border: none; font-family: inherit; font-size: 0.9rem; color: var(--muted-fg); cursor: pointer; text-decoration: none; }
	.btn-ghost:hover { color: var(--ink); }
	/* Bio wrapper mirrors the visual weight of the textarea this
	   replaced so the rich-text field sits naturally next to the
	   other inputs. FormattedInput owns the inner contenteditable. */
	.bio-fi {
		border: 1.5px solid var(--border);
		border-radius: 8px;
		background: var(--paper);
	}
	.bio-fi :global(.fi-wrap) { padding: 0; }
	.bio-fi :global(.fi-ce) {
		min-height: 80px; padding: 0.6rem 0.85rem;
		font-size: 0.9rem; line-height: 1.45;
	}

	.avatar-section {
		display: flex; justify-content: center;
		padding: 0.25rem 0 0.75rem;
		position: relative;
	}
</style>
