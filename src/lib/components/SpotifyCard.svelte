<script module>
	// One in-flight request per URL, shared across every message that links the
	// same song — a class passing one track around shouldn't mean thirty
	// identical fetches, and the answer never changes within a session.
	const cache = new Map();

	function load(url) {
		if (!cache.has(url)) {
			cache.set(
				url,
				fetch(`/api/link-meta?url=${encodeURIComponent(url)}`)
					.then((r) => (r.ok ? r.json() : null))
					.catch(() => null)
			);
		}
		return cache.get(url);
	}
</script>

<script>
	import { spotifySubtitle, spotifyTitle, SPOTIFY_LABEL } from '$lib/spotify.js';

	let { link, mine = false } = $props(); // link: { url, kind, id }

	let meta = $state(null);
	let failed = $state(false);

	$effect(() => {
		let cancelled = false;
		load(link.url).then((m) => {
			if (cancelled) return;
			// No title means the fetch found nothing usable. Render NOTHING rather
			// than an empty grey card — the URL is still there in the message text,
			// so the message is never left worse off than before.
			if (!m?.title) failed = true;
			else meta = m;
		});
		return () => { cancelled = true; };
	});

	const subtitle = $derived(meta ? spotifySubtitle(meta.description, link.kind) : '');
	const title = $derived(meta ? spotifyTitle(meta.title) : '');
	const label = $derived(SPOTIFY_LABEL[link.kind] ?? 'Spotify');
</script>

{#if meta && !failed}
	<a
		class="spotify-card"
		class:mine
		href={link.url}
		target="_blank"
		rel="noopener noreferrer"
	>
		{#if meta.image}
			<img class="art" src={meta.image} alt="" loading="lazy" decoding="async" />
		{:else}
			<span class="art art-empty" aria-hidden="true"></span>
		{/if}
		<span class="body">
			<span class="title">{title}</span>
			{#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
			<span class="brand">
				<!-- Spotify's mark, inline: an <img> to their CDN would be a second
				     network round trip for an icon that never changes. -->
				<svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
					<path
						fill="currentColor"
						d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.586 14.424a.623.623 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 1 1-.277-1.216c3.809-.871 7.077-.496 9.712 1.115a.623.623 0 0 1 .207.858Zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 1 1-.452-1.492c3.632-1.102 8.147-.568 11.232 1.329a.78.78 0 0 1 .257 1.072Zm.105-2.835c-3.223-1.914-8.54-2.09-11.617-1.156a.935.935 0 1 1-.542-1.79c3.532-1.072 9.404-.865 13.115 1.338a.935.935 0 1 1-.956 1.608Z"
					/>
				</svg>
				<span class="brand-text">{label} · Spotify</span>
			</span>
		</span>
	</a>
{/if}

<style>
	.spotify-card {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		max-width: min(320px, 78vw);
		margin-top: 0.3rem;
		padding: 0.55rem;
		border: 1.5px solid var(--border);
		border-radius: 14px;
		background: var(--md-sys-color-surface-container-low, var(--paper));
		text-decoration: none;
		color: var(--ink);
		transition: border-color 0.15s, transform 0.15s;
	}
	.spotify-card:hover { border-color: #1db954; transform: translateY(-1px); }
	.spotify-card.mine { margin-left: auto; }

	.art {
		flex: none;
		width: 56px;
		height: 56px;
		border-radius: 8px;
		object-fit: cover;
		background: color-mix(in srgb, var(--ink) 10%, transparent);
	}
	.art-empty { display: block; }

	.body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
	.title {
		font-size: 0.88rem;
		font-weight: 600;
		line-height: 1.25;
		/* Two lines then ellipsis: song titles run long and a card that grows
		   with the title stops looking like a card. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.subtitle {
		font-size: 0.76rem;
		color: var(--muted-fg);
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.brand { display: flex; align-items: center; gap: 0.25rem; margin-top: 0.15rem; }
	.logo { width: 13px; height: 13px; flex: none; color: #1db954; }
	.brand-text {
		font-size: 0.68rem;
		color: var(--muted-fg);
		letter-spacing: 0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (prefers-reduced-motion: reduce) {
		.spotify-card { transition: none; }
		.spotify-card:hover { transform: none; }
	}
</style>
