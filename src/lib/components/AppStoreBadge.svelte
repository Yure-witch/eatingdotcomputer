<script>
	/**
	 * "Download on the App Store" badge.
	 *
	 * Built from HTML + CSS with the Apple mark as the only inline SVG. The
	 * first version drew the whole thing in SVG, including <text>, and it came
	 * out glitchy for two reasons worth remembering: SVG text is laid out at the
	 * viewBox scale and then scaled up, so it misses the hinting and subpixel
	 * antialiasing real text gets, and the border was a second <rect> sitting
	 * exactly on top of the filled one — two edges on the same subpixel, which
	 * reads as a doubled, muddy outline. Its 1px stroke was also multiplied by
	 * the viewBox scale (190/119.66 ≈ 1.6x), so the "thin" border wasn't thin.
	 *
	 * Here the border is one real 1px CSS border that stays 1px at any size, and
	 * the lockup is real text.
	 *
	 * Everything scales off `--asb-w`, keeping Apple's 119.66:40 proportions.
	 * Their guidelines say not to redraw or restyle the badge, so nothing here
	 * is themeable — `width` scales it, and that is the only knob.
	 *
	 * Renders nothing when `href` is empty: APP_STORE_URL is null until a
	 * listing exists, and a badge linking nowhere is worse than no badge.
	 */
	let { href = '', width = 170 } = $props();
</script>

{#if href}
	<a
		class="asb"
		{href}
		target="_blank"
		rel="noopener noreferrer"
		style:--asb-w="{width}px"
		aria-label="Download eating.computer on the App Store"
	>
		<svg class="asb-mark" viewBox="0 0 384 512" aria-hidden="true" focusable="false">
			<path
				fill="currentColor"
				d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
			/>
		</svg>
		<span class="asb-lockup">
			<span class="asb-sm">Download on the</span>
			<span class="asb-lg">App Store</span>
		</span>
	</a>
{/if}

<style>
	.asb {
		/* 119.66 x 40 is the official artwork; every measurement below is a
		   fraction of the width so the badge keeps those proportions exactly. */
		--asb-h: calc(var(--asb-w) / 2.9915);
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: calc(var(--asb-h) * 0.16);
		width: var(--asb-w);
		max-width: 100%;
		height: var(--asb-h);
		padding: 0 calc(var(--asb-h) * 0.3);
		border: 1px solid #a6a6a6;
		border-radius: calc(var(--asb-h) * 0.1625);
		background: #000;
		color: #fff;
		/* Artwork, not a text link — strip whatever the host page's `a {}` rules
		   would otherwise apply. */
		text-decoration: none;
		transition: opacity 0.15s;
	}
	.asb:hover {
		opacity: 0.85;
	}

	.asb-mark {
		flex: none;
		height: calc(var(--asb-h) * 0.55);
		width: auto;
		/* The Apple mark's optical centre sits above its bounding-box centre. */
		margin-top: calc(var(--asb-h) * -0.03);
	}

	.asb-lockup {
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-width: 0;
		/* The system face is what the official lockup is set in; deliberately
		   NOT the page font, badge before house style. */
		font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial,
			sans-serif;
	}

	.asb-sm {
		font-size: calc(var(--asb-h) * 0.175);
		line-height: 1.25;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	.asb-lg {
		font-size: calc(var(--asb-h) * 0.42);
		font-weight: 500;
		line-height: 1.15;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
</style>
