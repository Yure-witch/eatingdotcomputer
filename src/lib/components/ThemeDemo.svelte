<script>
	/**
	 * Live sample of the current Material 3 scheme rendered as real UI
	 * rather than a grid of anonymous squares. Every element paints
	 * straight from the `--md-sys-color-*` vars the theme store writes to
	 * `:root`, so it repaints the instant a preset, seed or the vibrance
	 * slider changes — no props, no re-render plumbing.
	 *
	 * The point is to answer "what does this role actually DO?" — which
	 * is hard to read off a swatch and obvious the moment you see it as a
	 * button, a selected chip or a chat bubble. Selected/unselected pairs
	 * are shown side by side for exactly that reason.
	 *
	 * `roles` (default true) prints the token name under each group; the
	 * mobile picker turns it off to keep the preview short.
	 */
	let { roles = true } = $props();

	// Chips carry a fake selection so the selected-vs-unselected contrast
	// is visible at a glance. Interactive on purpose: tapping through them
	// is the quickest way to feel whether a scheme's selected state reads.
	let selectedChip = $state(1);
	const chips = ['Sketch', 'Type', 'Motion'];

	let switchOn = $state(true);
</script>

<div class="demo">
	<!-- Surface ladder — the four greys (or near-greys) everything sits on. -->
	<div class="group">
		{#if roles}<span class="cap">Surfaces</span>{/if}
		<div class="surfaces">
			<div class="surf s-bg"><span>bg</span></div>
			<div class="surf s-surface"><span>surface</span></div>
			<div class="surf s-container"><span>container</span></div>
			<div class="surf s-high"><span>+high</span></div>
		</div>
	</div>

	<!-- Buttons — primary / secondary / outline, the three action weights. -->
	<div class="group">
		{#if roles}<span class="cap">Actions</span>{/if}
		<div class="row">
			<button type="button" class="btn filled">Primary</button>
			<button type="button" class="btn tonal">Tonal</button>
			<button type="button" class="btn outlined">Outlined</button>
		</div>
	</div>

	<!-- Selected state — secondary-container is M3's "this one is on". -->
	<div class="group">
		{#if roles}<span class="cap">Selected state</span>{/if}
		<div class="row">
			{#each chips as c, i}
				<button
					type="button"
					class="chip"
					class:on={selectedChip === i}
					onclick={() => (selectedChip = i)}
					aria-pressed={selectedChip === i}
				>
					{#if selectedChip === i}
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
					{c}
				</button>
			{/each}
			<button
				type="button"
				class="switch"
				class:on={switchOn}
				onclick={() => (switchOn = !switchOn)}
				role="switch"
				aria-checked={switchOn}
				aria-label="Sample toggle"
			><span class="knob"></span></button>
		</div>
	</div>

	<!-- Chat bubbles — the app's most colour-sensitive surface. -->
	<div class="group">
		{#if roles}<span class="cap">Messages</span>{/if}
		<div class="chat">
			<div class="bubble them">Does the contrast hold up?</div>
			<div class="bubble me">Looks right to me</div>
		</div>
	</div>

	<!-- Card + accents — tertiary as a highlight, error as the alarm. -->
	<div class="group">
		{#if roles}<span class="cap">Card &amp; accents</span>{/if}
		<div class="card">
			<div class="card-head">
				<span class="card-title">Week 04 — Kinetic type</span>
				<span class="badge tertiary">New</span>
			</div>
			<p class="card-body">Body copy sits on <code>on-surface-variant</code>, one step quieter than the title.</p>
			<div class="row tight">
				<span class="badge error">Overdue</span>
				<span class="link">A themed link</span>
			</div>
		</div>
	</div>
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.group { display: flex; flex-direction: column; gap: 0.35rem; }
	.cap {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
	.row.tight { gap: 0.5rem; margin-top: 0.15rem; }

	/* ── Surfaces ──────────────────────────────────────────────────── */
	.surfaces {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 2px;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
	}
	.surf {
		min-height: 42px;
		display: flex;
		align-items: flex-end;
		padding: 0.3rem;
	}
	.surf span {
		font-size: 0.58rem;
		white-space: nowrap;
		line-height: 1.1;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.s-bg        { background: var(--md-sys-color-background, var(--paper)); }
	.s-surface   { background: var(--md-sys-color-surface, var(--paper)); }
	.s-container { background: var(--md-sys-color-surface-container, var(--paper)); }
	.s-high      { background: var(--md-sys-color-surface-container-high, var(--paper)); }

	/* ── Buttons ───────────────────────────────────────────────────── */
	.btn {
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.42rem 0.9rem;
		border-radius: 999px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: filter 120ms ease;
	}
	.btn:active { filter: brightness(0.94); }
	.filled {
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, #fff);
	}
	.tonal {
		background: var(--md-sys-color-secondary-container, rgba(0,0,0,0.06));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
	}
	.outlined {
		background: transparent;
		border-color: var(--md-sys-color-outline, rgba(0,0,0,0.3));
		color: var(--md-sys-color-primary, var(--accent));
	}

	/* ── Chips + switch ────────────────────────────────────────────── */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.34rem 0.72rem;
		border-radius: 8px;
		cursor: pointer;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.2));
		background: transparent;
		color: var(--md-sys-color-on-surface-variant, var(--ink));
	}
	.chip.on {
		background: var(--md-sys-color-secondary-container, rgba(0,0,0,0.08));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: transparent;
	}
	.switch {
		position: relative;
		width: 44px;
		height: 26px;
		flex-shrink: 0;
		border-radius: 999px;
		cursor: pointer;
		padding: 0;
		margin-left: auto;
		border: 2px solid var(--md-sys-color-outline, rgba(0,0,0,0.3));
		background: var(--md-sys-color-surface-container-highest, rgba(0,0,0,0.06));
		transition: background 160ms ease, border-color 160ms ease;
	}
	.switch.on {
		background: var(--md-sys-color-primary, var(--accent));
		border-color: var(--md-sys-color-primary, var(--accent));
	}
	.knob {
		position: absolute;
		top: 50%;
		left: 4px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		transform: translateY(-50%);
		background: var(--md-sys-color-outline, rgba(0,0,0,0.4));
		transition: left 160ms ease, width 160ms ease, height 160ms ease, background 160ms ease;
	}
	.switch.on .knob {
		left: 21px;
		width: 18px;
		height: 18px;
		background: var(--md-sys-color-on-primary, #fff);
	}

	/* ── Chat bubbles ──────────────────────────────────────────────── */
	.chat { display: flex; flex-direction: column; gap: 0.3rem; }
	.bubble {
		max-width: 78%;
		padding: 0.42rem 0.7rem;
		border-radius: 14px;
		font-size: 0.8rem;
		line-height: 1.3;
	}
	.them {
		align-self: flex-start;
		border-bottom-left-radius: 5px;
		background: var(--md-sys-color-surface-container-high, rgba(0,0,0,0.06));
		color: var(--md-sys-color-on-surface, var(--ink));
	}
	.me {
		align-self: flex-end;
		border-bottom-right-radius: 5px;
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, #fff);
	}

	/* ── Card ──────────────────────────────────────────────────────── */
	.card {
		padding: 0.7rem 0.8rem;
		border-radius: 12px;
		background: var(--md-sys-color-surface-container, var(--paper));
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.1));
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.card-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--md-sys-color-on-surface, var(--ink));
	}
	.card-body {
		margin: 0.3rem 0 0;
		font-size: 0.76rem;
		line-height: 1.4;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	.card-body code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.7rem;
	}
	.badge {
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		padding: 0.16rem 0.45rem;
		border-radius: 6px;
		white-space: nowrap;
	}
	.badge.tertiary {
		background: var(--md-sys-color-tertiary-container, rgba(0,0,0,0.06));
		color: var(--md-sys-color-on-tertiary-container, var(--ink));
	}
	.badge.error {
		background: var(--md-sys-color-error-container, #f9dedc);
		color: var(--md-sys-color-on-error-container, #410e0b);
	}
	.link {
		font-size: 0.76rem;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		color: var(--md-sys-color-primary, var(--accent));
	}
</style>
