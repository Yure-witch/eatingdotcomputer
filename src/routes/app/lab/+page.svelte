<script>
	let { data } = $props();

	// Lab tools. Add new experiments here as they're built.
	const tools = [
		{
			href: '/app/lab/gif',
			title: 'Kinetic Type',
			blurb: 'Mesmerizing variable-font title animations for slide decks — export as GIF.',
			icon: 'gif_box',
			ready: true
		},
		{
			// Route is /websites, not /inspiration — /app/inspiration is already
			// the Scout-generated per-student feed, and these are two different
			// things wearing one name.
			href: '/app/lab/websites',
			title: 'Inspiration',
			blurb: 'Websites and pages worth your time, collected for the class — with previews.',
			icon: 'gallery_thumbnail',
			ready: true
		},
		{
			href: '/app/lab/marquee',
			title: 'Marquee',
			blurb: 'Put the ricky.now kinetic-type set on the projector, and let the room change the words by QR code.',
			icon: 'qr_code_2',
			ready: true
		},
		{
			href: '/app/lab/text-gifs',
			title: 'Text GIFs',
			blurb: 'Type a word, pick an animated text effect — rainbow, neon, wave, glitch — and export a looping GIF.',
			icon: 'title',
			ready: true
		}
	];
</script>

<svelte:head><title>Lab — eating.computer</title></svelte:head>

<div class="shell">
	<main>
		<div class="page-header">
			<h1>Lab</h1>
			<p class="subtitle">A creative sandbox for experiments and tools</p>
		</div>

		<div class="tool-grid">
			{#each tools as t}
				<a class="tool-card" class:soon={!t.ready} href={t.ready ? t.href : undefined}>
					<span class="tool-icon msi">{t.icon}</span>
					<span class="tool-title">{t.title}</span>
					<span class="tool-blurb">{t.blurb}</span>
					{#if !t.ready}<span class="tool-tag">Soon</span>{/if}
				</a>
			{/each}
		</div>
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}
	main {
		flex: 1;
		padding: 2rem 1.5rem;
		padding-top: calc(2rem + var(--header-h, 52px));
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.page-header { margin-bottom: 1.75rem; }
	h1 {
		font-family: 'Avara', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 0.25rem;
		color: var(--ink);
	}
	.subtitle { font-size: 0.85rem; color: var(--muted-fg); margin: 0; }

	.tool-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 1rem;
	}
	.tool-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 1.25rem;
		border: 1.5px solid var(--border);
		border-radius: 16px;
		background: var(--md-sys-color-surface-container-low, var(--paper));
		text-decoration: none;
		color: var(--ink);
		position: relative;
		transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
	}
	.tool-card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
		box-shadow: 0 6px 20px -8px color-mix(in srgb, var(--ink) 25%, transparent);
	}
	.tool-card.soon { opacity: 0.55; pointer-events: none; }
	.tool-icon {
		font-size: 2rem;
		line-height: 1;
		color: var(--accent);
		margin-bottom: 0.35rem;
	}
	.tool-title {
		font-family: 'Avara', serif;
		font-size: 1.1rem;
		color: var(--ink);
	}
	.tool-blurb { font-size: 0.82rem; color: var(--muted-fg); line-height: 1.45; }
	.tool-tag {
		position: absolute;
		top: 0.9rem;
		right: 0.9rem;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		color: var(--muted-fg);
		border: 1px solid var(--border);
		border-radius: 99px;
		padding: 0.1rem 0.5rem;
	}

	@media (max-width: 640px) {
		main {
			padding: 1.25rem 1rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		h1 { font-size: 1.5rem; }
	}
</style>
