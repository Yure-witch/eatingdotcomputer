<script>
	/**
	 * Phone-sized colour scheme picker.
	 *
	 * The desktop `ThemePicker` exposes the whole Material 3 surface —
	 * variant, contrast, per-family seeds and four separate chroma
	 * sliders. That's the wrong shape for a thumb, so this view keeps only
	 * the three decisions that actually change how the app feels:
	 *
	 *   1. light or dark
	 *   2. which palette (presets, painted in their own colours, plus a
	 *      custom seed)
	 *   3. how saturated — one Vibrance slider standing in for all four
	 *      chroma controls (see `setVibrance` in theme-store)
	 *
	 * Everything else stays reachable behind the "All controls" disclosure
	 * at the bottom, which just drops the full desktop picker inline — no
	 * setting is lost on mobile, it's only demoted.
	 *
	 * The live sample under the swatches is `ThemeDemo`, so the roles the
	 * scheme defines (selected states included) are visible while you pick
	 * instead of being something you discover later in the app.
	 */
	import {
		themeStore, PRESETS, setPreset, setSeed, setDark, setVibrance,
		setMasterChroma, MASTER_CHROMA_MAX, autoChromaFor,
		previewRolesForPreset, previewRoles
	} from '$lib/theme-store.js';
	import ThemeDemo from '$lib/components/ThemeDemo.svelte';
	import ThemePicker from '$lib/components/ThemePicker.svelte';

	let advanced = $state(false);

	// Each chip renders in the palette it would produce — dark mode and
	// the current vibrance carry into the preview because setPreset
	// preserves both.
	const chips = $derived(
		PRESETS.map((p) => ({ ...p, roles: previewRolesForPreset(p, $themeStore) }))
	);

	// "Custom" is active whenever no preset owns the current record.
	const isCustom = $derived(!$themeStore.presetId);
	const customRoles = $derived(previewRoles($themeStore));

	const vibrance = $derived($themeStore.vibrance ?? 100);

	// Master chroma is null until touched, so the thumb needs a resting
	// place. Primary's auto chroma is the honest answer — it's the family
	// the eye reads first — clamped into the slider's range. The label
	// says "Auto" until there's a real value, so a parked thumb is never
	// mistaken for a setting.
	const chromaIsAuto = $derived($themeStore.masterChroma == null);
	const masterChroma = $derived(
		$themeStore.masterChroma
			?? Math.round(Math.min(MASTER_CHROMA_MAX, autoChromaFor($themeStore, 'primary')))
	);
</script>

<section class="mtp">
	<!-- Light / dark ------------------------------------------------------ -->
	<div class="mode" role="radiogroup" aria-label="Light or dark">
		<button
			type="button"
			class="mode-btn"
			class:on={!$themeStore.dark}
			role="radio"
			aria-checked={!$themeStore.dark}
			onclick={() => setDark(false)}
		>
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="4"/>
				<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
			</svg>
			Light
		</button>
		<button
			type="button"
			class="mode-btn"
			class:on={$themeStore.dark}
			role="radio"
			aria-checked={$themeStore.dark}
			onclick={() => setDark(true)}
		>
			<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
			</svg>
			Dark
		</button>
	</div>

	<!-- Palette grid ------------------------------------------------------ -->
	<div class="label">Palette</div>
	<div class="grid">
		{#each chips as p (p.id)}
			<button
				type="button"
				class="cell"
				class:on={$themeStore.presetId === p.id}
				style:--surface={p.roles.surface}
				style:--p={p.roles.primary}
				style:--s={p.roles.secondary}
				style:--t={p.roles.tertiary}
				onclick={() => setPreset(p.id)}
				aria-pressed={$themeStore.presetId === p.id}
				aria-label={p.name}
			>
				<span class="tile">
					<span class="blob p"></span>
					<span class="blob s"></span>
					<span class="blob t"></span>
					{#if $themeStore.presetId === p.id}
						<span class="tick">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
						</span>
					{/if}
				</span>
				<span class="cell-name">{p.name}</span>
			</button>
		{/each}

		<!-- Custom seed. The native colour input sits invisibly on top of
		     the tile so the whole cell is the tap target — iOS/Android
		     then open their own system picker, which beats anything we'd
		     draw ourselves at this size. -->
		<label
			class="cell custom"
			class:on={isCustom}
			style:--surface={customRoles.surface}
			style:--p={customRoles.primary}
			style:--s={customRoles.secondary}
			style:--t={customRoles.tertiary}
		>
			<span class="tile">
				{#if isCustom}
					<span class="blob p"></span>
					<span class="blob s"></span>
					<span class="blob t"></span>
					<span class="tick">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
					</span>
				{:else}
					<span class="wheel"></span>
				{/if}
				<input
					type="color"
					value={$themeStore.seed}
					oninput={(e) => setSeed(e.target.value)}
					aria-label="Custom seed color"
				/>
			</span>
			<span class="cell-name">Custom</span>
		</label>
	</div>

	{#if isCustom}
		<div class="seed-line">
			Seed <code>{$themeStore.seed}</code>
			<span class="dot" style:background={$themeStore.seed}></span>
		</div>
	{/if}

	<!-- Vibrance ---------------------------------------------------------- -->
	<div class="label vib-label">
		Vibrance
		<em>{vibrance}%</em>
		{#if vibrance !== 100}
			<button type="button" class="reset" onclick={() => setVibrance(100)}>Reset</button>
		{/if}
	</div>
	<input
		class="vib"
		type="range"
		min="0"
		max="200"
		step="5"
		value={vibrance}
		oninput={(e) => setVibrance(parseFloat(e.target.value))}
		aria-label="Vibrance"
	/>
	<p class="note">Scales the palette's own saturation up or down, keeping the balance between roles.</p>

	<!-- Master chroma ------------------------------------------------------ -->
	<div class="label vib-label">
		Chroma
		<em>{chromaIsAuto ? 'Auto' : masterChroma}</em>
		{#if !chromaIsAuto}
			<button type="button" class="reset" onclick={() => setMasterChroma(null)}>Auto</button>
		{/if}
	</div>
	<input
		class="vib chroma"
		type="range"
		min="0"
		max={MASTER_CHROMA_MAX}
		step="1"
		value={masterChroma}
		oninput={(e) => setMasterChroma(parseFloat(e.target.value))}
		aria-label="Chroma"
	/>
	<p class="note">Sets one flat saturation for every role at once — accents and surfaces alike — instead of scaling what's there.</p>

	<!-- Live sample -------------------------------------------------------- -->
	<div class="label">Preview</div>
	<div class="preview">
		<ThemeDemo roles={true} />
	</div>

	<p class="sync">
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4"/>
			<polyline points="21 3 21 7 17 7"/><polyline points="3 21 3 17 7 17"/>
		</svg>
		Saved to your account — this scheme follows you to every device you sign in on.
	</p>

	<!-- Escape hatch to the full desktop control set. -->
	<button type="button" class="adv-toggle" onclick={() => (advanced = !advanced)} aria-expanded={advanced}>
		{advanced ? 'Hide' : 'Show'} all controls
		<svg class:flip={advanced} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
	</button>
	{#if advanced}
		<div class="adv"><ThemePicker /></div>
	{/if}
</section>

<style>
	.mtp {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		color: var(--ink);
	}
	.label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		margin-top: 0.4rem;
	}

	/* ── Light / dark ─────────────────────────────────────────────── */
	.mode {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3px;
		padding: 3px;
		border-radius: 999px;
		background: var(--md-sys-color-surface-container-high, rgba(0,0,0,0.06));
	}
	.mode-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.6rem 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 160ms ease, color 160ms ease;
	}
	.mode-btn.on {
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, #fff);
	}

	/* ── Palette grid ─────────────────────────────────────────────── */
	.grid {
		display: grid;
		/* 4 across on a normal phone, 3 on the narrowest ones. */
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 0.5rem;
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.28rem;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.tile {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 16px;
		overflow: hidden;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px rgba(128,128,128,0.28);
		transition: box-shadow 140ms ease, transform 140ms ease;
	}
	.cell:active .tile { transform: scale(0.94); }
	.cell.on .tile {
		box-shadow:
			inset 0 0 0 1px rgba(128,128,128,0.2),
			0 0 0 3px var(--md-sys-color-primary, var(--accent));
	}
	/* Three overlapping discs read as "a palette" far faster than a
	   single seed dot, and they show the secondary/tertiary hues that
	   several presets deliberately pull away from primary. */
	.blob {
		position: absolute;
		border-radius: 50%;
	}
	.blob.p { inset: 18% 18% auto auto; width: 54%; height: 54%; background: var(--p); }
	.blob.s { inset: auto auto 16% 14%; width: 38%; height: 38%; background: var(--s); }
	.blob.t { inset: auto 16% 18% auto; width: 26%; height: 26%; background: var(--t); }
	/* A corner badge rather than a wash over the whole tile — the point
	   of the tile is to show the palette, and covering it in primary at
	   the exact moment it's selected hides what you just chose. */
	.tick {
		position: absolute;
		top: 4px;
		left: 4px;
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		color: var(--md-sys-color-on-primary, #fff);
		background: var(--md-sys-color-primary, var(--accent));
		box-shadow: 0 1px 3px rgba(0,0,0,0.35);
	}
	.cell-name {
		font-size: 0.63rem;
		line-height: 1.15;
		text-align: center;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell.on .cell-name {
		color: var(--ink);
		font-weight: 700;
	}

	.custom .wheel {
		position: absolute;
		inset: 18%;
		border-radius: 50%;
		background: conic-gradient(
			#ff5252, #ffb142, #ffe14d, #6ede6e, #4dd0e1,
			#5c7cfa, #a55eea, #ff5cb0, #ff5252
		);
	}
	/* The native input covers the tile and is invisible — the tile art
	   below is what the user sees, the OS picker is what they get. */
	.custom input[type="color"] {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		border: none;
		padding: 0;
		background: none;
		cursor: pointer;
	}

	.seed-line {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.seed-line code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
	}
	.seed-line .dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);
	}

	/* ── Vibrance ─────────────────────────────────────────────────── */
	.vib-label em {
		font-style: normal;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		letter-spacing: 0;
		text-transform: none;
		opacity: 0.8;
	}
	.reset {
		margin-left: auto;
		padding: 0.16rem 0.5rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.15));
		border-radius: 999px;
		background: transparent;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		font: inherit;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	/* Custom track so the slider itself shows what it does: grey at 0,
	   full primary at the far end. */
	.vib {
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		height: 34px;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}
	.vib::-webkit-slider-runnable-track {
		height: 12px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--md-sys-color-surface-container-highest, #ddd),
			var(--md-sys-color-primary, var(--accent))
		);
	}
	.vib::-moz-range-track {
		height: 12px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--md-sys-color-surface-container-highest, #ddd),
			var(--md-sys-color-primary, var(--accent))
		);
	}
	.vib::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 26px;
		height: 26px;
		margin-top: -7px;
		border-radius: 50%;
		background: var(--md-sys-color-surface, #fff);
		box-shadow: 0 1px 4px rgba(0,0,0,0.3), inset 0 0 0 3px var(--md-sys-color-primary, var(--accent));
	}
	.vib::-moz-range-thumb {
		width: 26px;
		height: 26px;
		border: none;
		border-radius: 50%;
		background: var(--md-sys-color-surface, #fff);
		box-shadow: 0 1px 4px rgba(0,0,0,0.3), inset 0 0 0 3px var(--md-sys-color-primary, var(--accent));
	}
	/* Chroma's track runs neutral → full-strength secondary so it reads as
	   a different control from vibrance's neutral → primary ramp. */
	.vib.chroma::-webkit-slider-runnable-track {
		background: linear-gradient(
			to right,
			var(--md-sys-color-surface-container-highest, #ddd),
			var(--md-sys-color-secondary, var(--accent))
		);
	}
	.vib.chroma::-moz-range-track {
		background: linear-gradient(
			to right,
			var(--md-sys-color-surface-container-highest, #ddd),
			var(--md-sys-color-secondary, var(--accent))
		);
	}
	.note {
		margin: -0.15rem 0 0;
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}

	/* ── Preview ──────────────────────────────────────────────────── */
	.preview {
		padding: 0.75rem;
		border-radius: 14px;
		background: var(--md-sys-color-surface, var(--paper));
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.1));
	}

	.sync {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0.5rem 0 0;
		font-size: 0.7rem;
		line-height: 1.35;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.sync svg { flex-shrink: 0; margin-top: 0.12rem; }

	/* ── Advanced disclosure ──────────────────────────────────────── */
	.adv-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		margin-top: 0.6rem;
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.15));
		border-radius: 999px;
		background: transparent;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.adv-toggle svg { transition: transform 180ms ease; }
	.adv-toggle svg.flip { transform: rotate(180deg); }
	.adv { margin-top: 0.5rem; }
</style>
