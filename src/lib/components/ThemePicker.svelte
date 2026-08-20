<script>
	import {
		themeStore,
		savedSchemesStore,
		PRESETS,
		VARIANTS,
		setPreset,
		setSeed,
		setSecondarySeed,
		setSecondaryMode,
		setTertiarySeed,
		setTertiaryMode,
		setPrimaryChroma,
		setSecondaryChroma,
		setTertiaryChroma,
		setNeutralChroma,
		setVibrance,
		autoChromaFor,
		setVariant,
		setContrast,
		setDark,
		complementOf,
		saveCurrentScheme,
		applySavedScheme,
		deleteSavedScheme,
		renameSavedScheme,
		presetSnippetFor,
		previewRolesForPreset
	} from '$lib/theme-store.js';
	import ThemeDemo from '$lib/components/ThemeDemo.svelte';

	// Preset chips preview the palette each one RESOLVES to in the current
	// mode, not its raw seed. A seed is an input to the M3 generator, not a
	// colour the app ever paints: Raspberry's #b61d3e seed renders a blue
	// primary under `expressive`, and every seed dot looks identical in
	// light and dark even though the themes don't. Two-tone (surface behind,
	// primary in front) so the chip reads as a theme rather than a colour.
	const presetChips = $derived(
		PRESETS.map((x) => ({ ...x, roles: previewRolesForPreset(x, $themeStore) }))
	);

	// Live preview of the palette roles. These are the same M3 system
	// tokens the theme store writes to :root, so the swatches update
	// instantly when the seed/dark toggle changes.
	const SWATCHES = [
		{ token: 'primary',             label: 'Primary' },
		{ token: 'primary-container',   label: 'Primary container' },
		{ token: 'secondary',           label: 'Secondary' },
		{ token: 'secondary-container', label: 'Secondary container' },
		{ token: 'tertiary',            label: 'Tertiary' },
		{ token: 'tertiary-container',  label: 'Tertiary container' },
		{ token: 'surface',             label: 'Surface' },
		{ token: 'surface-variant',     label: 'Surface variant' },
		{ token: 'outline',             label: 'Outline' },
		{ token: 'error',               label: 'Error' }
	];

	// Computed complement preview — derived live from the current seed
	// via TemperatureCache so users can see what the M3 "true"
	// complement looks like even when they're in 'auto' or 'custom' mode.
	const complementPreview = $derived(complementOf($themeStore.seed));

	// Live "auto" chroma for each family — the value the variant would
	// produce with no override. Shown next to the slider as the rest
	// position so the user knows what the scheme picked organically.
	const autoP = $derived(autoChromaFor($themeStore, 'primary'));
	const autoS = $derived(autoChromaFor($themeStore, 'secondary'));
	const autoT = $derived(autoChromaFor($themeStore, 'tertiary'));
	const autoN = $derived(autoChromaFor($themeStore, 'neutral'));

	// Effective slider position when nothing has been set — falls back
	// to the variant's auto value so the thumb sits at the meaningful
	// rest position rather than 0.
	const primaryChromaValue   = $derived($themeStore.primaryChroma   ?? autoP);
	const secondaryChromaValue = $derived($themeStore.secondaryChroma ?? autoS);
	const tertiaryChromaValue  = $derived($themeStore.tertiaryChroma  ?? autoT);
	const neutralChromaValue   = $derived($themeStore.neutralChroma   ?? autoN);

	// Master saturation. Lives on mobile as the ONLY colour-strength
	// control; kept here too so a value set on a phone is visible and
	// resettable from the desktop picker rather than acting as an
	// invisible multiplier under the per-family sliders.
	const vibrance = $derived($themeStore.vibrance ?? 100);

	function chromaInputHandler(setter) {
		return (e) => setter(parseFloat(e.target.value));
	}

	let saveName = $state('');
	let savedJustNow = $state(null);
	function onSave() {
		const entry = saveCurrentScheme(saveName);
		if (entry) {
			saveName = '';
			savedJustNow = entry.id;
			// Brief affordance to flash the new row green.
			setTimeout(() => { if (savedJustNow === entry.id) savedJustNow = null; }, 1400);
		}
	}

	// Track which saved row has its JSON snippet currently expanded.
	let openSnippetId = $state(null);
	let lastCopiedId = $state(null);
	function copySnippet(saved) {
		try {
			navigator.clipboard.writeText(presetSnippetFor(saved));
			lastCopiedId = saved.id;
			setTimeout(() => { if (lastCopiedId === saved.id) lastCopiedId = null; }, 1400);
		} catch {}
	}

	// Inline rename — editing is keyed by id so only one row is editable
	// at a time.
	let renameId = $state(null);
	let renameValue = $state('');
	function startRename(s) { renameId = s.id; renameValue = s.name; }
	function commitRename(s) {
		if (renameValue.trim() && renameValue.trim() !== s.name) {
			renameSavedScheme(s.id, renameValue.trim());
		}
		renameId = null;
	}

	const onSeedInput = (e) => setSeed(e.target.value);
	const onSecondarySeedInput = (e) => setSecondarySeed(e.target.value);
	const onTertiarySeedInput = (e) => setTertiarySeed(e.target.value);
</script>

<section class="theme-picker">
	<header>
		<h2>Color theme</h2>
		<p class="hint">Pick a seed — every UI token derives from it via Google's Material 3 palette generator. Customisation knobs below let you steer the secondary family, contrast, and variant.</p>
	</header>

	<!-- Built-in presets ---------------------------------------------------- -->
	<div class="row-label">Presets</div>
	<div class="preset-row">
		{#each presetChips as p (p.id)}
			<!-- Default keeps its written name; every other preset
			     shows just its emoji as the chip label. Tooltip still
			     surfaces the real name on hover for accessibility. -->
			<button
				type="button"
				class="preset"
				class:active={$themeStore.presetId === p.id}
				style:--swatch={p.roles.primary}
				style:--swatch-bg={p.roles.surface}
				onclick={() => setPreset(p.id)}
				title={p.name}
				aria-label={p.name}
			>
				<span class="dot"></span>
				<span class="name">{p.id === 'default' ? p.name : p.emoji}</span>
			</button>
		{/each}
	</div>

	<!-- Core controls ------------------------------------------------------- -->
	<div class="controls">
		<!-- Light/dark mode as an icon on the left of Seed. -->
		<button
			class="mode-icon"
			onclick={() => setDark(!$themeStore.dark)}
			title={$themeStore.dark ? 'Switch to light mode' : 'Switch to dark mode'}
			aria-label="Toggle dark mode"
		>
			{#if $themeStore.dark}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="4"/>
					<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
				</svg>
			{/if}
		</button>

		<label class="custom-seed">
			<span>Seed</span>
			<input type="color" value={$themeStore.seed} oninput={onSeedInput} />
			<code>{$themeStore.seed}</code>
		</label>

		<label class="select-label">
			<span>Variant</span>
			<select value={$themeStore.variant} onchange={(e) => setVariant(e.target.value)}>
				{#each VARIANTS as v}
					<option value={v.id}>{v.label}</option>
				{/each}
			</select>
		</label>

		<label class="slider-label">
			<span>Contrast <em>{$themeStore.contrastLevel.toFixed(2)}</em></span>
			<input
				type="range"
				min="-1"
				max="1"
				step="0.05"
				value={$themeStore.contrastLevel}
				oninput={(e) => setContrast(parseFloat(e.target.value))}
			/>
		</label>
	</div>

	<!-- Secondary color customisation -------------------------------------- -->
	<div class="row-label">Secondary color</div>
	<div class="secondary-row">
		<div class="seg" role="radiogroup" aria-label="Secondary color source">
			<button
				type="button"
				class="seg-btn"
				class:active={$themeStore.secondaryMode === 'auto'}
				role="radio"
				aria-checked={$themeStore.secondaryMode === 'auto'}
				onclick={() => setSecondaryMode('auto')}
			>Auto</button>
			<button
				type="button"
				class="seg-btn"
				class:active={$themeStore.secondaryMode === 'complement'}
				role="radio"
				aria-checked={$themeStore.secondaryMode === 'complement'}
				onclick={() => setSecondaryMode('complement')}
				title="Material 3 TemperatureCache complement — the same algorithm Monet Gallery uses. Cool-warm balanced, not just hue + 180°."
			>Complement</button>
			<button
				type="button"
				class="seg-btn"
				class:active={$themeStore.secondaryMode === 'custom'}
				role="radio"
				aria-checked={$themeStore.secondaryMode === 'custom'}
				onclick={() => setSecondaryMode('custom')}
			>Custom</button>
		</div>

		{#if $themeStore.secondaryMode === 'complement'}
			<div class="hint-row" title="Computed live from the seed">
				<span class="cmp-dot" style:background={complementPreview}></span>
				<code>{complementPreview}</code>
				<span class="cmp-note">via TemperatureCache</span>
			</div>
		{:else if $themeStore.secondaryMode === 'custom'}
			<label class="custom-seed">
				<span>Hex</span>
				<input type="color" value={$themeStore.secondarySeed} oninput={onSecondarySeedInput} />
				<code>{$themeStore.secondarySeed}</code>
			</label>
		{:else}
			<div class="hint-row muted">Variant decides — secondary is derived from seed per the M3 spec.</div>
		{/if}
	</div>

	<!-- Tertiary color customisation --------------------------------------- -->
	<div class="row-label">Tertiary color</div>
	<div class="secondary-row">
		<div class="seg" role="radiogroup" aria-label="Tertiary color source">
			<button
				type="button"
				class="seg-btn"
				class:active={$themeStore.tertiaryMode === 'auto'}
				role="radio"
				aria-checked={$themeStore.tertiaryMode === 'auto'}
				onclick={() => setTertiaryMode('auto')}
			>Auto</button>
			<button
				type="button"
				class="seg-btn"
				class:active={$themeStore.tertiaryMode === 'complement'}
				role="radio"
				aria-checked={$themeStore.tertiaryMode === 'complement'}
				onclick={() => setTertiaryMode('complement')}
				title="Same TemperatureCache complement of the seed. Picking 'complement' for both secondary and tertiary makes them identical — use 'custom' on one if you want them distinct."
			>Complement</button>
			<button
				type="button"
				class="seg-btn"
				class:active={$themeStore.tertiaryMode === 'custom'}
				role="radio"
				aria-checked={$themeStore.tertiaryMode === 'custom'}
				onclick={() => setTertiaryMode('custom')}
			>Custom</button>
		</div>

		{#if $themeStore.tertiaryMode === 'complement'}
			<div class="hint-row" title="Computed live from the seed">
				<span class="cmp-dot" style:background={complementPreview}></span>
				<code>{complementPreview}</code>
				<span class="cmp-note">
					{$themeStore.secondaryMode === 'complement' ? '⚠︎ same as secondary complement' : 'via TemperatureCache'}
				</span>
			</div>
		{:else if $themeStore.tertiaryMode === 'custom'}
			<label class="custom-seed">
				<span>Hex</span>
				<input type="color" value={$themeStore.tertiarySeed} oninput={onTertiarySeedInput} />
				<code>{$themeStore.tertiarySeed}</code>
			</label>
		{:else}
			<div class="hint-row muted">Variant decides — tertiary is derived from seed (typically a hue rotation) per the M3 spec.</div>
		{/if}
	</div>

	<!-- Chroma overrides per family ---------------------------------------- -->
	<div class="row-label">Chroma per family</div>
	<p class="hint" style="margin: 0 0 0.25rem">
		Higher = more saturated; 0 = grayscale. The hue stays put — only the chroma axis of the HCT palette is replaced. Hit "Auto" to revert to whatever the variant derives by default.
	</p>
	<div class="chroma-grid">
		<!-- Master row — scales every family below it at once. -->
		<div class="chroma-row master">
			<div class="chroma-label">
				<span class="chip vib-chip"></span>
				<span class="role">Vibrance</span>
				<em class="auto-val">all families ×{(vibrance / 100).toFixed(2)}</em>
			</div>
			<input
				class="chroma-slider"
				type="range" min="0" max="200" step="5"
				value={vibrance}
				oninput={(e) => setVibrance(parseFloat(e.target.value))}
			/>
			<span class="chroma-val">{vibrance}%</span>
			<button
				type="button"
				class="reset-btn"
				class:dim={vibrance === 100}
				disabled={vibrance === 100}
				onclick={() => setVibrance(100)}
				title="Reset to 100%"
			>100%</button>
		</div>

		<div class="chroma-row">
			<div class="chroma-label">
				<span class="chip" style:background={`var(--md-sys-color-primary)`}></span>
				<span class="role">Primary</span>
				<em class="auto-val" title="Variant's auto chroma">auto · {Math.round(autoP)}</em>
			</div>
			<input
				class="chroma-slider"
				type="range" min="0" max="120" step="1"
				value={primaryChromaValue}
				oninput={chromaInputHandler(setPrimaryChroma)}
			/>
			<span class="chroma-val">{Math.round(primaryChromaValue)}</span>
			<button
				type="button"
				class="reset-btn"
				class:dim={$themeStore.primaryChroma == null}
				disabled={$themeStore.primaryChroma == null}
				onclick={() => setPrimaryChroma(null)}
				title="Reset to auto"
			>Auto</button>
		</div>

		<div class="chroma-row">
			<div class="chroma-label">
				<span class="chip" style:background={`var(--md-sys-color-secondary)`}></span>
				<span class="role">Secondary</span>
				<em class="auto-val">auto · {Math.round(autoS)}</em>
			</div>
			<input
				class="chroma-slider"
				type="range" min="0" max="120" step="1"
				value={secondaryChromaValue}
				oninput={chromaInputHandler(setSecondaryChroma)}
			/>
			<span class="chroma-val">{Math.round(secondaryChromaValue)}</span>
			<button
				type="button"
				class="reset-btn"
				class:dim={$themeStore.secondaryChroma == null}
				disabled={$themeStore.secondaryChroma == null}
				onclick={() => setSecondaryChroma(null)}
				title="Reset to auto"
			>Auto</button>
		</div>

		<div class="chroma-row">
			<div class="chroma-label">
				<span class="chip" style:background={`var(--md-sys-color-tertiary)`}></span>
				<span class="role">Tertiary</span>
				<em class="auto-val">auto · {Math.round(autoT)}</em>
			</div>
			<input
				class="chroma-slider"
				type="range" min="0" max="120" step="1"
				value={tertiaryChromaValue}
				oninput={chromaInputHandler(setTertiaryChroma)}
			/>
			<span class="chroma-val">{Math.round(tertiaryChromaValue)}</span>
			<button
				type="button"
				class="reset-btn"
				class:dim={$themeStore.tertiaryChroma == null}
				disabled={$themeStore.tertiaryChroma == null}
				onclick={() => setTertiaryChroma(null)}
				title="Reset to auto"
			>Auto</button>
		</div>

		<!-- Surface chroma — drives BOTH the neutralPalette (surface,
		     surfaceContainer, on-surface) and the neutralVariantPalette
		     (surfaceVariant, outline). Scaled proportionally so the
		     small chroma differential between them is preserved. -->
		<div class="chroma-row">
			<div class="chroma-label">
				<span class="chip" style:background={`var(--md-sys-color-surface-variant)`}></span>
				<span class="role">Surface</span>
				<em class="auto-val">auto · {Math.round(autoN)}</em>
			</div>
			<input
				class="chroma-slider"
				type="range" min="0" max="80" step="1"
				value={neutralChromaValue}
				oninput={chromaInputHandler(setNeutralChroma)}
			/>
			<span class="chroma-val">{Math.round(neutralChromaValue)}</span>
			<button
				type="button"
				class="reset-btn"
				class:dim={$themeStore.neutralChroma == null}
				disabled={$themeStore.neutralChroma == null}
				onclick={() => setNeutralChroma(null)}
				title="Reset to auto"
			>Auto</button>
		</div>
	</div>

	<!-- Live preview ------------------------------------------------------- -->
	<div class="swatch-grid">
		{#each SWATCHES as s}
			<div class="swatch">
				<div class="chip" style:background={`var(--md-sys-color-${s.token})`}></div>
				<div class="meta">
					<span class="role">{s.label}</span>
					<code>--md-sys-color-{s.token}</code>
				</div>
			</div>
		{/each}
	</div>

	<!-- Roles in context ---------------------------------------------------- -->
	<div class="row-label">In context</div>
	<p class="hint" style="margin: 0 0 0.25rem">
		The same tokens rendered as real components — swatches don't show what a role is <em>for</em>, and selected states in particular only reveal themselves next to their unselected twin.
	</p>
	<div class="demo-wrap">
		<ThemeDemo />
	</div>

	<!-- Saved schemes ------------------------------------------------------ -->
	<div class="row-label">Saved schemes</div>
	<form class="save-row" onsubmit={(e) => { e.preventDefault(); onSave(); }}>
		<input
			type="text"
			class="save-input"
			placeholder="Name this scheme…"
			bind:value={saveName}
			maxlength="40"
		/>
		<button type="submit" class="save-btn" disabled={!saveName.trim()}>Save current</button>
	</form>

	{#if $savedSchemesStore.length === 0}
		<p class="empty">No saved schemes yet. Tune the controls above and hit "Save current".</p>
	{:else}
		<ul class="saved-list">
			{#each $savedSchemesStore as s (s.id)}
				<li class="saved-row" class:flash={savedJustNow === s.id}>
					<button class="saved-apply" type="button" onclick={() => applySavedScheme(s.id)} title="Apply this scheme">
						<span class="saved-dot" style:background={s.seed}></span>
						{#if renameId === s.id}
							<input
								class="rename-input"
								type="text"
								bind:value={renameValue}
								onclick={(e) => e.stopPropagation()}
								onkeydown={(e) => { if (e.key === 'Enter') commitRename(s); if (e.key === 'Escape') renameId = null; }}
								onblur={() => commitRename(s)}
								onfocus={(e) => e.currentTarget.select()}
								autofocus
							/>
						{:else}
							<span class="saved-name">{s.name}</span>
						{/if}
						<span class="saved-meta">
							{s.variant}{s.dark ? ' · dark' : ''}{s.secondaryMode && s.secondaryMode !== 'auto' ? ` · ${s.secondaryMode} 2nd` : ''}{s.tertiaryMode && s.tertiaryMode !== 'auto' ? ` · ${s.tertiaryMode} 3rd` : ''}{s.contrastLevel ? ` · c${s.contrastLevel.toFixed(2)}` : ''}{s.primaryChroma != null ? ` · pCh ${Math.round(s.primaryChroma)}` : ''}{s.secondaryChroma != null ? ` · sCh ${Math.round(s.secondaryChroma)}` : ''}{s.tertiaryChroma != null ? ` · tCh ${Math.round(s.tertiaryChroma)}` : ''}{s.neutralChroma != null ? ` · nCh ${Math.round(s.neutralChroma)}` : ''}
						</span>
					</button>
					<div class="saved-actions">
						<button type="button" class="ghost" onclick={() => startRename(s)} title="Rename">
							<span class="msi msi-18">edit</span>
						</button>
						<button type="button" class="ghost" onclick={() => copySnippet(s)} title="Copy preset JSON (for promoting to a built-in)">
							<span class="msi msi-18">{lastCopiedId === s.id ? 'check' : 'content_copy'}</span>
						</button>
						<button type="button" class="ghost" onclick={() => openSnippetId = openSnippetId === s.id ? null : s.id} title="Show preset JSON">
							<span class="msi msi-18">code</span>
						</button>
						<button type="button" class="ghost danger" onclick={() => deleteSavedScheme(s.id)} title="Delete">
							<span class="msi msi-18">delete</span>
						</button>
					</div>
					{#if openSnippetId === s.id}
						<pre class="snippet"><code>{presetSnippetFor(s)}</code></pre>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.theme-picker {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		background: var(--md-sys-color-surface-container, var(--paper));
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.08));
		border-radius: 16px;
		color: var(--ink);
	}
	header h2 {
		font-family: 'Avara', serif;
		font-weight: 400;
		font-size: 1.15rem;
		margin: 0 0 0.25rem;
		color: var(--ink);
	}
	.hint {
		font-size: 0.85rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		margin: 0;
		line-height: 1.4;
	}

	.row-label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		margin-top: 0.25rem;
	}

	.preset-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.preset {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem 0.4rem 0.5rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 999px;
		background: var(--md-sys-color-surface, transparent);
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: border-color 160ms ease, transform 120ms ease;
	}
	.preset:hover { transform: translateY(-1px); }
	.preset.active {
		border-color: var(--md-sys-color-primary, var(--accent));
		border-width: 2px;
		padding: calc(0.4rem - 1px) calc(0.75rem - 1px) calc(0.4rem - 1px) calc(0.5rem - 1px);
	}
	.preset .dot {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		/* Primary disc on the theme's own surface, so the chip previews
		   the pair the page will actually render. */
		background:
			radial-gradient(circle at 50% 50%,
				var(--swatch) 0 55%,
				var(--swatch-bg) 56% 100%);
		box-shadow: 0 0 0 1px rgba(128,128,128,0.35);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 1.25rem;
		align-items: center;
	}
	.custom-seed,
	.mode-toggle,
	.select-label,
	.slider-label {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.slider-label { flex-direction: column; align-items: flex-start; gap: 0.2rem; min-width: 180px; }
	.slider-label em { font-style: normal; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.78rem; opacity: 0.75; }
	.slider-label input[type="range"] { width: 100%; }
	.custom-seed input[type="color"] {
		appearance: none;
		-webkit-appearance: none;
		width: 36px;
		height: 36px;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 8px;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}
	.select-label select {
		appearance: none;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 1.75rem 0.35rem 0.65rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 8px;
		background: var(--md-sys-color-surface, var(--paper));
		color: var(--ink);
		cursor: pointer;
	}
	.custom-seed code,
	.swatch code,
	.hint-row code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.mode-toggle { cursor: pointer; color: var(--ink); }
	.mode-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		flex-shrink: 0;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 9px;
		background: var(--md-sys-color-surface, var(--paper));
		color: var(--ink);
		cursor: pointer;
		transition: background 140ms ease;
	}
	.mode-icon:hover { background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.05)); }

	/* Secondary mode segmented control */
	.secondary-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 999px;
		padding: 2px;
		gap: 2px;
		background: var(--md-sys-color-surface, var(--paper));
	}
	.seg-btn {
		padding: 0.3rem 0.85rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.seg-btn.active {
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, white);
	}
	.hint-row {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--ink);
	}
	.hint-row.muted { color: var(--md-sys-color-on-surface-variant, #6f655a); font-style: italic; }
	.cmp-dot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
	}
	.cmp-note { color: var(--md-sys-color-on-surface-variant, #6f655a); font-size: 0.72rem; }

	/* Chroma sliders */
	.chroma-grid {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.chroma-row {
		display: grid;
		grid-template-columns: minmax(140px, 1fr) minmax(160px, 2fr) 2.4rem auto;
		align-items: center;
		gap: 0.6rem;
	}
	.chroma-label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--ink);
	}
	.chroma-label .chip {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
	}
	.chroma-label .role { font-weight: 600; }
	.chroma-label .auto-val {
		font-style: normal;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.66rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.chroma-slider { width: 100%; }
	.chroma-val {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.76rem;
		color: var(--ink);
		text-align: right;
	}
	.reset-btn {
		padding: 0.18rem 0.55rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
	}
	.reset-btn.dim { opacity: 0.45; cursor: default; }
	/* Master vibrance row sits slightly apart from the per-family ones
	   it multiplies. */
	.chroma-row.master {
		padding-bottom: 0.55rem;
		border-bottom: 1px dashed var(--md-sys-color-outline-variant, rgba(0,0,0,0.15));
	}
	.chroma-label .vib-chip {
		background: linear-gradient(
			to right,
			var(--md-sys-color-surface-container-highest, #ddd),
			var(--md-sys-color-primary, var(--accent))
		);
	}
	.reset-btn:not(.dim):hover {
		background: color-mix(in srgb, var(--ink) 7%, transparent);
	}
	@media (max-width: 640px) {
		.chroma-row {
			grid-template-columns: 1fr auto;
			grid-template-areas:
				'label reset'
				'slider val';
			row-gap: 0.25rem;
		}
		.chroma-label  { grid-area: label; }
		.reset-btn     { grid-area: reset; }
		.chroma-slider { grid-area: slider; }
		.chroma-val    { grid-area: val; }
	}

	.demo-wrap {
		padding: 0.9rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.1));
		border-radius: 12px;
		background: var(--md-sys-color-surface, var(--paper));
	}

	.swatch-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.6rem;
	}
	.swatch {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.08));
		border-radius: 10px;
		background: var(--md-sys-color-surface, var(--paper));
	}
	.chip {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);
	}
	.meta { display: flex; flex-direction: column; gap: 0.1rem; line-height: 1.1; min-width: 0; }
	.role { font-size: 0.78rem; color: var(--ink); }

	/* Save / saved list */
	.save-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.save-input {
		flex: 1;
		min-width: 0;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 8px;
		background: var(--md-sys-color-surface, var(--paper));
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
	}
	.save-input:focus { outline: 2px solid var(--md-sys-color-primary, var(--accent)); outline-offset: 1px; }
	.save-btn {
		padding: 0.45rem 0.9rem;
		border: none;
		border-radius: 8px;
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, white);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}
	.save-btn:disabled { opacity: 0.4; cursor: default; }

	.empty {
		font-size: 0.82rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		margin: 0;
		padding: 0.5rem 0;
		font-style: italic;
	}
	.saved-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.saved-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.1));
		border-radius: 10px;
		background: var(--md-sys-color-surface, var(--paper));
		position: relative;
	}
	.saved-row.flash { animation: flash-bg 1.4s ease-out; }
	@keyframes flash-bg {
		0%   { background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 25%, transparent); }
		100% { background: var(--md-sys-color-surface, var(--paper)); }
	}
	.saved-apply {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.1rem 0.25rem;
		background: transparent;
		border: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
		text-align: left;
		min-width: 0;
	}
	.saved-dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
	}
	.saved-name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.saved-meta {
		font-size: 0.72rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rename-input {
		font: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		padding: 0.15rem 0.35rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.2));
		border-radius: 5px;
		background: var(--md-sys-color-surface, var(--paper));
		color: var(--ink);
		min-width: 80px;
	}
	.saved-actions { display: inline-flex; align-items: center; gap: 0.15rem; }
	.ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
	}
	.ghost:hover { background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.05)); }
	.ghost.danger:hover { color: var(--md-sys-color-error, #b3261e); }
	.snippet {
		grid-column: 1 / -1;
		margin: 0.4rem 0 0;
		padding: 0.55rem 0.7rem;
		background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.04));
		border-radius: 8px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--ink);
		overflow-x: auto;
		white-space: pre;
	}
</style>
