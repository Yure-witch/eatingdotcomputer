<script>
	/**
	 * "Download on the App Store" badge, drawn inline rather than loaded as an
	 * image.
	 *
	 * Apple supplies this badge for linking to your own listing, and its
	 * guidelines say not to redraw or restyle it — so the proportions here
	 * follow the official artwork (119.66 × 40, the Apple mark at the left, the
	 * lockup set in the system font) and nothing about it is themeable. Scale it
	 * with the `width` prop; don't recolour it.
	 *
	 * Inline SVG rather than a PNG because it stays sharp at any size, needs no
	 * network round trip, and can't 404 the way a hotlinked Apple asset can.
	 *
	 * Renders nothing at all when `href` is empty — APP_STORE_URL is null until
	 * a listing exists, and a badge linking nowhere is worse than no badge.
	 */
	let { href = '', width = 170 } = $props();
</script>

{#if href}
	<a
		class="asb"
		{href}
		target="_blank"
		rel="noopener noreferrer"
		style:width="{width}px"
		aria-label="Download eating.computer on the App Store"
	>
		<svg viewBox="0 0 119.66 40" role="img" aria-hidden="true" focusable="false">
			<rect x="0.5" y="0.5" width="118.66" height="39" rx="6.5" fill="#000" />
			<rect
				x="0.5"
				y="0.5"
				width="118.66"
				height="39"
				rx="6.5"
				fill="none"
				stroke="#a6a6a6"
				stroke-width="1"
			/>
			<!-- Apple mark -->
			<g transform="translate(11.5 8.2) scale(0.0455)" fill="#fff">
				<path
					d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
				/>
			</g>
			<text class="asb-sm" x="41" y="16.2">Download on the</text>
			<text class="asb-lg" x="41" y="31">App Store</text>
		</svg>
	</a>
{/if}

<style>
	.asb {
		display: inline-block;
		max-width: 100%;
		line-height: 0;
		border-radius: 7px;
		/* The badge is artwork, not a text link — strip anything the host page's
		   `a { … }` rules would otherwise put on it. */
		text-decoration: none;
		transition: opacity 0.15s;
	}
	.asb:hover {
		opacity: 0.85;
	}
	.asb svg {
		width: 100%;
		height: auto;
		display: block;
	}
	/* -apple-system first so it renders in the real system face on Apple
	   hardware, which is what the official lockup uses. */
	.asb-sm,
	.asb-lg {
		fill: #fff;
		font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial,
			sans-serif;
	}
	.asb-sm {
		font-size: 7.5px;
		letter-spacing: 0.02em;
	}
	.asb-lg {
		font-size: 16.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
</style>
