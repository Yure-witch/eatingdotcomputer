<script>
	/**
	 * A fixed control (close ✕ / search 🔍) that sits at the LEFT of a picker's
	 * category bar, OUTSIDE the horizontal scroller — so it stays put while the
	 * categories scroll beside it. `square` gives it the filled rounded-square
	 * tile used for the close button; otherwise it's a round icon button.
	 */
	let { onclick, title = '', label = '', square = false, active = false, children } = $props();
</script>

<button
	type="button"
	class="ctl-btn"
	class:square
	class:active
	{title}
	aria-label={label || title}
	onmousedown={(e) => { e.preventDefault(); }}
	onclick={onclick}
>
	{@render children?.()}
</button>

<style>
	.ctl-btn {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		transition: background 0.12s, filter 0.12s;
	}
	.ctl-btn :global(.msi) { font-size: 21px; line-height: 1; }
	.ctl-btn:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
	.ctl-btn.active { background: color-mix(in srgb, var(--ink) 12%, transparent); }

	/* Close: a rounded-square tile that FLOATS above the panel behind it —
	   same recipe as the app's bottom nav island and the picker's category
	   strip, so the picker's chrome reads as one family: opaque surface, hairline
	   border, soft drop shadow plus a light top edge for depth. */
	.ctl-btn.square {
		border-radius: 12px;
		background: var(--sidebar-bg, color-mix(in srgb, var(--ink) 7%, var(--paper)));
		border: 1px solid var(--sidebar-border, color-mix(in srgb, var(--ink) 8%, transparent));
		box-shadow:
			0 6px 16px rgba(0, 0, 0, 0.13),
			0 1px 4px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
	}
	.ctl-btn.square :global(.msi) { font-variation-settings: 'wght' 700; }
	.ctl-btn.square:hover { background: color-mix(in srgb, var(--ink) 8%, var(--sidebar-bg, var(--paper))); }

	@media (max-width: 640px) {
		.ctl-btn { width: 2.5rem; height: 2.5rem; }
		.ctl-btn :global(.msi) { font-size: 23px; }
	}
</style>
