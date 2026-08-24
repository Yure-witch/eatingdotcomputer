<script>
	// Onboarding, Cooper Union edition — a short 2-step wizard:
	//   1. You      — avatar, name*, pronouns, and (students) which Cooper
	//                 school* + optional focus.  (Year is NOT asked here — the
	//                 instructor sets each student's year in Manage.)
	//   2. Share about yourself — interests, bio, website. All optional; you can
	//                 Finish with nothing filled and add it later on your profile.
	// One form, one final submit — the steps are client-side, so the existing
	// server action stays a single POST.
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { PRESETS, setPreset, setDark, themeStore, previewRolesForPreset } from '$lib/theme-store.js';

	// Each swatch renders in the palette it actually RESOLVES to under the
	// currently-selected mode, not its raw seed. A seed is an input to the M3
	// generator, not a colour the app paints — and it looks identical in light
	// and dark, which made the mode toggle above look like it did nothing to
	// the grid it explicitly claims to recolour.
	const swatches = $derived(
		PRESETS.map((p) => ({ ...p, roles: previewRolesForPreset(p, $themeStore) }))
	);
	import AvatarPicker from '$lib/components/AvatarPicker.svelte';
	import FormattedInput from '$lib/components/FormattedInput.svelte';
	let { data, form } = $props();

	// Preview mode (?preview=1): an instructor can walk the STUDENT version of
	// this step to see exactly what students get — renders the student layout
	// and swaps the final submit for a harmless "Exit preview" so nothing is
	// written to the instructor's own profile.
	const preview = $derived($page.url.searchParams.has('preview'));
	const isInstructor = $derived(!preview && data.user?.role === 'instructor');

	const SCHOOLS = [
		{ id: 'Architecture', icon: '🏛️', label: 'Architecture', full: 'Irwin S. Chanin School of Architecture' },
		{ id: 'Art', icon: '🎨', label: 'Art', full: 'School of Art' },
		{ id: 'Engineering', icon: '⚙️', label: 'Engineering', full: 'Albert Nerken School of Engineering' }
	];

	const steps = [
		{ id: 'who', label: 'You' },
		{ id: 'share', label: 'About you' },
		{ id: 'style', label: 'Style' }
	];
	let stepIdx = $state(0);
	// +1 forward, -1 back — the step slides in from the side you're travelling.
	let dir = $state(1);
	const step = $derived(steps[stepIdx].id);

	// Field state (mirrored into hidden inputs for the single POST)
	let name = $state(form?.name ?? data.prefill.name ?? '');
	let pronouns = $state(form?.pronouns ?? data.prefill.pronouns ?? '');
	let school = $state(form?.school ?? data.prefill.school ?? '');
	let focus = $state(form?.focus ?? data.prefill.focus ?? '');
	let interests = $state(form?.interests ?? data.prefill.interests ?? '');
	let website = $state(form?.website ?? data.prefill.website ?? '');
	let bioValue = $state(form?.bio ?? data.prefill.bio ?? '');

	let avatarKind = $state(data.prefill.avatarKind ?? 'gen');
	let avatarValue = $state(data.prefill.avatarValue ?? null);
	let photoFile = $state(null);

	let stepError = $state(null);
	// Blur before switching steps: leaving a focused field mounted while it is
	// removed leaves the keyboard up over the next step's inputs.
	function blurActive() {
		try { document.activeElement?.blur?.(); } catch { /* not fatal */ }
	}
	function next() {
		blurActive();
		dir = 1;
		stepError = null;
		if (step === 'who') {
			if (!name.trim()) { stepError = 'Your name, at least!'; return; }
			if (!isInstructor && !school) { stepError = 'Pick your school.'; return; }
		}
		if (stepIdx < steps.length - 1) stepIdx += 1;
	}
	function back() {
		blurActive();
		dir = -1;
		stepError = null;
		if (stepIdx > 0) stepIdx -= 1;
	}
</script>

<svelte:head><title>Welcome — eating.computer</title></svelte:head>

<div class="card">
	{#if preview}
		<div class="preview-banner">
			<span>👀 Preview — this is the student view. Nothing you enter here is saved.</span>
			<a href="/app">Exit</a>
		</div>
	{/if}
	<div class="progress">
		{#each steps as s, i}
			<button type="button" class="prog-step" class:active={i === stepIdx} class:done={i < stepIdx}
				onclick={() => { if (i < stepIdx) { stepError = null; stepIdx = i; } }}>
				<span class="prog-dot">{i < stepIdx ? '✓' : i + 1}</span>
				<span class="prog-label">{s.label}</span>
			</button>
			{#if i < steps.length - 1}<span class="prog-line" class:done={i < stepIdx}></span>{/if}
		{/each}
	</div>

	{#if form?.error}
		<p class="error">{form.error}</p>
	{:else if stepError}
		<p class="error">{stepError}</p>
	{/if}

	<form method="POST" enctype="multipart/form-data" use:enhance={({ formData }) => {
		if (avatarKind === 'photo' && photoFile) {
			formData.append('avatar_photo', photoFile);
		}
	}}>
		<!-- every field rides hidden so the one POST carries all steps -->
		<input type="hidden" name="name" value={name} />
		<input type="hidden" name="pronouns" value={pronouns} />
		<input type="hidden" name="school" value={school} />
		<input type="hidden" name="focus" value={focus} />
		<input type="hidden" name="interests" value={interests} />
		<input type="hidden" name="website" value={website} />
		<input type="hidden" name="bio" value={bioValue} />
		<input type="hidden" name="avatar_kind" value={avatarKind} />
		<input type="hidden" name="avatar_value" value={avatarKind === 'expr' ? (avatarValue ?? '') : ''} />

		{#key stepIdx}
		<div class="step-pane"
			in:fly={{ x: dir * 28, duration: 260, easing: cubicOut, opacity: 0 }}>
		{#if step === 'who'}
			<h1>Hi! Who are you?</h1>
			<p class="sub">This is how your classmates will see you.</p>

			<div class="avatar-section">
				<AvatarPicker
					name={name}
					uid={data.user?.id ?? name}
					bind:avatarKind
					bind:avatarValue
					bind:photoFile
				/>
			</div>

			<label>
				<span>Name <span class="req">*</span></span>
				<input type="text" bind:value={name} required placeholder="Your full name" />
			</label>

			<label>
				<span>Pronouns <span class="opt">(optional)</span></span>
				<input type="text" bind:value={pronouns} placeholder="e.g. she/her, they/them" />
			</label>

			{#if !isInstructor}
				<div class="year-row">
					<span class="field-title">Your school at Cooper <span class="req">*</span></span>
					<div class="school-cards">
						{#each SCHOOLS as s (s.id)}
							<button type="button" class="school-card" class:selected={school === s.id} onclick={() => (school = s.id)}>
								<span class="school-icon">{s.icon}</span>
								<span class="school-label">{s.label}</span>
								<span class="school-full">{s.full}</span>
							</button>
						{/each}
					</div>
				</div>

				<label>
					<span>Focus / concentration <span class="opt">(optional)</span></span>
					<input type="text" bind:value={focus} placeholder="e.g. Sculpture, Electrical Engineering, Drawing…" />
				</label>
			{/if}

		{:else if step === 'share'}
			<h1>Share about yourself</h1>
			<p class="sub">Totally optional — but a little personality helps your classmates (and Gemma) get to know you. You can always add more later on your profile.</p>

			<label>
				<span>Your interests <span class="opt">(optional)</span></span>
				<textarea rows="4" bind:value={interests} placeholder="e.g. I make generative type posters and small synths. This semester I want to get better at creative coding and build an interactive installation…"></textarea>
			</label>

			<label>
				<span>Bio <span class="opt">(optional)</span></span>
				<div class="bio-fi">
					<FormattedInput bind:value={bioValue} placeholder="A little about yourself…" />
				</div>
			</label>

			<label>
				<span>Website / portfolio <span class="opt">(optional)</span></span>
				<input type="url" bind:value={website} placeholder="https://yoursite.com" />
			</label>

		{:else}
			<h1>Pick a colour scheme</h1>
			<p class="sub">This is yours alone — it changes how the app looks for you, and you can swap it any time from your avatar menu.</p>

			<!-- Light/dark first: it recolours every swatch below it, so choosing
			     the colour against the wrong ground means choosing twice. -->
			<div class="mode-row" role="group" aria-label="Light or dark">
				<button type="button" class="mode-btn" class:selected={!$themeStore.dark} onclick={() => setDark(false)} aria-pressed={!$themeStore.dark}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4"/></svg>
					Light
				</button>
				<button type="button" class="mode-btn" class:selected={$themeStore.dark} onclick={() => setDark(true)} aria-pressed={$themeStore.dark}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8z"/></svg>
					Dark
				</button>
			</div>

			<!-- Applies immediately: the whole page recolours as you tap, so the
			     swatch grid IS the preview. Theme lives in localStorage, so
			     there's nothing to submit with the form. -->
			<div class="theme-grid">
				{#each swatches as p (p.id)}
					<button type="button" class="theme-swatch" class:selected={$themeStore.presetId === p.id}
						onclick={() => setPreset(p.id)} title={p.name} aria-label={p.name}
						style="--sw: {p.roles.primary}; --sw-bg: {p.roles.surface}; --sw-2: {p.roles.secondary}">
						<span class="sw-dot" aria-hidden="true"></span>
						<span class="sw-name">{p.name}</span>
					</button>
				{/each}
			</div>
		{/if}
		</div>
		{/key}

		<div class="nav-row">
			{#if stepIdx > 0}
				<button type="button" class="btn-ghost" onclick={back}>← Back</button>
			{:else}
				<span></span>
			{/if}
			{#if stepIdx < steps.length - 1}
				<button type="button" class="btn-primary" onclick={next}>Continue →</button>
			{:else if preview}
				<a class="btn-primary" href="/app" style="text-decoration:none">Done previewing</a>
			{:else}
				<button type="submit" class="btn-primary">Finish →</button>
			{/if}
		</div>
	</form>
</div>

<style>
	.card {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		padding: 2rem 2rem 1.75rem;
		width: 100%;
		max-width: 500px;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.progress { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem; }
	.prog-step {
		display: flex; align-items: center; gap: 0.4rem;
		background: none; border: none; padding: 0; cursor: default;
		color: var(--muted-fg); font-family: inherit;
	}
	.prog-step.done { cursor: pointer; }
	.prog-dot {
		width: 22px; height: 22px; border-radius: 50%;
		display: inline-flex; align-items: center; justify-content: center;
		border: 1.5px solid var(--border); font-size: 0.7rem; font-weight: 700;
		background: var(--paper); flex-shrink: 0;
	}
	.prog-step.active .prog-dot { background: var(--ink); border-color: var(--ink); color: var(--paper); }
	.prog-step.done .prog-dot { border-color: var(--ink); color: var(--ink); }
	.prog-step.active { color: var(--ink); font-weight: 600; }
	.prog-label { font-size: 0.75rem; }
	.prog-line { flex: 1; height: 1.5px; background: var(--border); min-width: 12px; }
	.prog-line.done { background: var(--ink); }

	h1 {
		font-family: 'Avara', serif;
		font-size: 1.6rem;
		font-weight: 400;
		margin: 0;
		color: var(--ink);
	}
	.sub { font-size: 0.88rem; color: var(--muted-fg); margin: -0.35rem 0 0.25rem; line-height: 1.45; }

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
	/* The pane owns the per-step layout so the transition moves one element
	   rather than every field independently. */
	.step-pane { display: flex; flex-direction: column; gap: 0.9rem; }

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
		gap: 0.6rem;
	}
	.theme-swatch {
		display: flex; flex-direction: column; align-items: center; gap: 0.45rem;
		min-height: 92px; padding: 0.8rem 0.4rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: var(--paper); color: var(--ink);
		font: inherit; font-size: 0.78rem; cursor: pointer;
		transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
	}
	.theme-swatch:active { transform: scale(0.97); }
	.theme-swatch.selected {
		border-color: var(--md-sys-color-primary, var(--ink));
		box-shadow: inset 0 0 0 1px var(--md-sys-color-primary, var(--ink));
	}
	/* Primary disc on that theme's own surface, with a bite of its secondary —
	   the pair the page will actually render, rather than one flat seed. */
	.sw-dot {
		width: 34px; height: 34px; border-radius: 50%;
		background:
			linear-gradient(135deg, var(--sw) 0 62%, var(--sw-2) 62% 100%);
		box-shadow:
			0 0 0 3px var(--sw-bg),
			0 0 0 4px rgba(128,128,128,0.28);
	}
	.sw-name { text-align: center; line-height: 1.2; }

	.mode-row { display: flex; gap: 0.6rem; }
	.mode-btn {
		flex: 1;
		display: flex; align-items: center; justify-content: center; gap: 0.45rem;
		padding: 0.8rem 0.5rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: var(--paper); color: var(--ink);
		font: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.mode-btn.selected {
		border-color: var(--accent, var(--ink));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, var(--ink)) 25%, transparent);
	}
	@media (prefers-reduced-motion: reduce) {
		.step-pane { transition: none !important; animation: none !important; }
	}
	label { display: flex; flex-direction: column; gap: 0.35rem; }
	label span, .field-title { font-size: 0.82rem; font-weight: 600; color: var(--ink); }
	.req { color: #e53935; }
	.opt { font-weight: 400; color: var(--muted-fg); }

	input, textarea {
		padding: 0.85rem 0.95rem;
		border: 1.5px solid var(--border);
		border-radius: 10px;
		font-family: inherit;
		/* 16px EXACTLY — iOS auto-zooms the page when a focused field is any
		   smaller, which yanks the layout on every tap. This is the single
		   biggest source of the jank here, not the animations. */
		font-size: 16px;
		color: var(--ink);
		background: var(--paper);
		outline: none;
		transition: border-color 0.15s;
		width: 100%;
		box-sizing: border-box;
	}
	input:focus, textarea:focus {
		border-color: var(--md-sys-color-primary, var(--ink));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-sys-color-primary, var(--ink)) 14%, transparent);
	}
	textarea { resize: vertical; line-height: 1.5; }

	.school-cards { display: flex; gap: 0.6rem; }
	.school-card {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
		padding: 1.1rem 0.5rem 0.95rem;
		min-height: 96px; justify-content: center;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: var(--paper); cursor: pointer;
		font-family: inherit; color: var(--ink);
		transition: border-color 0.15s, background 0.15s, transform 0.15s;
	}
	/* Hover only where hover exists — on touch it sticks after a tap and reads
	   as a stuck button. */
	@media (hover: hover) {
		.school-card:hover { transform: translateY(-1px); border-color: var(--muted-fg); }
	}
	.school-card:active { transform: scale(0.98); }
	.school-card.selected {
		border-color: var(--md-sys-color-primary, var(--ink));
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--ink)) 8%, var(--paper));
		box-shadow: inset 0 0 0 1px var(--md-sys-color-primary, var(--ink));
	}
	.school-icon { font-size: 1.5rem; line-height: 1; }
	.school-label { font-weight: 700; font-size: 0.9rem; }
	.school-full { font-size: 0.62rem; color: var(--muted-fg); text-align: center; line-height: 1.25; }

	.year-row { display: flex; flex-direction: column; gap: 0.35rem; }
	.year-pills { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.year-pill {
		padding: 0.4rem 0.8rem;
		border: 1.5px solid var(--border); border-radius: 999px;
		background: var(--paper); cursor: pointer;
		font-family: inherit; font-size: 0.82rem; color: var(--ink);
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}
	@media (hover: hover) { .year-pill:hover { border-color: var(--muted-fg); } }
	.year-pill.selected { background: var(--ink); border-color: var(--ink); color: var(--paper); font-weight: 600; }

	.nav-row { display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem; }
	.btn-primary {
		min-height: 52px;
		padding: 0.9rem 1.75rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 10px;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.12s ease, opacity 0.15s ease, box-shadow 0.15s ease;
	}
	.btn-primary:hover { opacity: 0.8; }
	.btn-ghost {
		padding: 0.7rem 1rem;
		background: none; border: none;
		font-family: inherit; font-size: 0.9rem;
		color: var(--muted-fg); cursor: pointer;
	}
	.btn-ghost:hover { color: var(--ink); }

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
		padding: 0.25rem 0;
		position: relative;
	}

	.preview-banner {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		padding: 0.5rem 0.75rem; margin: -0.4rem 0 0.2rem;
		background: color-mix(in srgb, var(--accent) 14%, var(--paper));
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: 9px; font-size: 0.78rem; color: var(--ink);
	}
	.preview-banner a { color: var(--ink); font-weight: 700; text-decoration: none; flex-shrink: 0; }
</style>
