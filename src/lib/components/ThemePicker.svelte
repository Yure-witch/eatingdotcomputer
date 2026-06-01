<script>
	import { themeStore, PRESETS, setPreset, setSeed, setDark } from '$lib/theme-store.js';

	// Live preview of the palette roles. These are the same M3 system
	// tokens the theme store writes to :root, so the swatches update
	// instantly when the seed/dark toggle changes.
	const SWATCHES = [
		{ token: 'primary',            label: 'Primary' },
		{ token: 'primary-container',  label: 'Primary container' },
		{ token: 'secondary',          label: 'Secondary' },
		{ token: 'secondary-container', label: 'Secondary container' },
		{ token: 'tertiary',           label: 'Tertiary' },
		{ token: 'tertiary-container', label: 'Tertiary container' },
		{ token: 'surface',            label: 'Surface' },
		{ token: 'surface-variant',    label: 'Surface variant' },
		{ token: 'outline',            label: 'Outline' },
		{ token: 'error',              label: 'Error' }
	];

	const onSeedInput = (e) => setSeed(e.target.value);
</script>

<section class="theme-picker">
	<header>
		<h2>Color theme</h2>
		<p class="hint">Pick a seed color — every UI token derives from it via Google's Material 3 palette generator.</p>
	</header>

	<div class="preset-row">
		{#each PRESETS as p}
			<button
				type="button"
				class="preset"
				class:active={$themeStore.presetId === p.id}
				style:--swatch={p.seed}
				onclick={() => setPreset(p.id)}
				title={p.name}
			>
				<span class="dot"></span>
				<span class="name">{p.emoji} {p.name}</span>
			</button>
		{/each}
	</div>

	<div class="controls">
		<label class="custom-seed">
			<span>Custom seed</span>
			<input type="color" value={$themeStore.seed} oninput={onSeedInput} />
			<code>{$themeStore.seed}</code>
		</label>

		<label class="mode-toggle">
			<input
				type="checkbox"
				checked={$themeStore.dark}
				onchange={(e) => setDark(e.target.checked)}
			/>
			<span>Dark mode</span>
		</label>
	</div>

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
</section>

<style>
	.theme-picker {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.5rem;
		background: var(--md-sys-color-surface-container, var(--paper));
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.08));
		border-radius: 16px;
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
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--swatch);
		box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
	}
	.custom-seed {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
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
	.custom-seed code,
	.swatch code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.mode-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--ink);
		cursor: pointer;
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
</style>
