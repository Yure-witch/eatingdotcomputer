<script>
	/**
	 * Compact user avatar. v1 shows the first character of the user's
	 * name on a deterministic-by-uid background tint. When profile
	 * photo uploads ship, this is the one place to swap in an `<img>`.
	 *
	 * Sized via the `size` prop (CSS pixels). Default 24 is the right
	 * scale for inline lists (mention picker, notification bell items).
	 */
	let { name = '', uid = '', size = 24 } = $props();

	const initial = $derived(((name || '?').trim().charAt(0) || '?').toUpperCase());

	// Stable hue from the uid (or name as fallback) so each user
	// always gets the same tint. Hash via djb2 → 0–359 hue.
	const hue = $derived.by(() => {
		const seed = uid || name || '';
		let h = 5381;
		for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
		return Math.abs(h) % 360;
	});
</script>

<span
	class="avatar"
	style:width="{size}px"
	style:height="{size}px"
	style:background="hsl({hue}, 35%, 78%)"
	style:color="hsl({hue}, 38%, 22%)"
	style:font-size="{Math.round(size * 0.46)}px"
	aria-hidden="true"
>{initial}</span>

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		font-weight: 700;
		flex-shrink: 0;
		line-height: 1;
		font-family: 'Avara', serif;
	}
</style>
