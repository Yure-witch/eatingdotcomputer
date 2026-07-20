<script>
	// Gemma avatar — the gemma.webp artwork (1280×1280) served from
	// /static, rendered round so it slots into every avatar spot.
	let { size = 26 } = $props();
</script>

<img
	class="gemma-icon"
	src="/gemma.webp"
	alt=""
	width={size}
	height={size}
	loading="lazy"
	draggable="false"
/>

<style>
	.gemma-icon {
		display: block;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
		user-select: none;
	}
</style>
