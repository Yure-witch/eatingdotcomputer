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

	/* Close: a premium filled rounded-square tile with a bold ✕. */
	.ctl-btn.square {
		border-radius: 11px;
		background: color-mix(in srgb, var(--ink) 7%, var(--paper));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent);
	}
	.ctl-btn.square :global(.msi) { font-variation-settings: 'wght' 700; }
	.ctl-btn.square:hover { background: color-mix(in srgb, var(--ink) 13%, var(--paper)); }

	@media (max-width: 640px) {
		.ctl-btn { width: 2.5rem; height: 2.5rem; }
		.ctl-btn :global(.msi) { font-size: 23px; }
	}
</style>
