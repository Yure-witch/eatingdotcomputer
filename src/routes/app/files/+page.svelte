<script>
	import { onMount } from 'svelte';
	import ClassSwitcher from '$lib/components/ClassSwitcher.svelte';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';

	let { data } = $props();

	let links = $state(data.links);
	let uploadedFiles = $state(data.uploadedFiles ?? []);

	onMount(() => {
		// Fetch titles for uncached links — fire in parallel, update as they resolve
		for (const link of links.filter((l) => !l.title)) {
			fetch(`/api/link-meta?url=${encodeURIComponent(link.url)}`)
				.then((r) => (r.ok ? r.json() : null))
				.then((meta) => {
					if (meta?.title) {
						links = links.map((l) => (l.url === link.url ? { ...l, title: meta.title } : l));
					}
				})
				.catch(() => {});
		}
	});

	function getDomain(url) {
		try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
	}

	function getFavicon(url) {
		try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; } catch { return ''; }
	}

	function formatAge(ts) {
		const d = Date.now() - ts;
		if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
		if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
		if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatSize(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<svelte:head><title>Files — eating.computer</title></svelte:head>

<div class="shell">
	<header>
		<div class="wordmark-wrap">
			<a class="wordmark" href="/app">eating.computer</a>
			<ClassSwitcher {data} />
		</div>
		<div class="header-right">
			<a class="back-link" href="/app">Dashboard</a>
		</div>
	</header>

	<main>
		<div class="page-header">
			<h1>Files</h1>
			<p class="subtitle">Uploads and links shared in class</p>
		</div>

		{#if uploadedFiles.length > 0}
			<p class="section-label">Uploads</p>
			<div class="links-grid" style="margin-bottom: 2rem;">
				{#each uploadedFiles as f (f.id)}
					<a href={f.url} target="_blank" rel="noopener noreferrer" class="link-chip">
						<div class="chip-favicon">
							<FileTypeIcon filename={f.filename} mimetype={f.mimetype} url={f.url} iconSize={28} />
						</div>
						<div class="chip-body">
							<span class="chip-title">{f.filename}</span>
							<span class="chip-meta">
								<span class="chip-domain">{formatSize(f.size)}</span>
								<span class="chip-dot">·</span>
								<span>uploaded by {f.uploadedByName}</span>
								<span class="chip-dot">·</span>
								<span>{formatAge(f.uploadedAt)}</span>
								<span class="chip-dot">·</span>
								<span class="chip-channel">{f.contextType === 'dm' ? 'DM' : `#${f.convName}`}</span>
							</span>
						</div>
						<svg class="ext-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
					</a>
				{/each}
			</div>
		{/if}

		{#if links.length > 0}
			{#if uploadedFiles.length > 0}<p class="section-label">Links</p>{/if}
			<div class="links-grid">
				{#each links as link (link.url)}
					<a href={link.url} target="_blank" rel="noopener noreferrer" class="link-chip">
						<div class="chip-favicon">
							<img
								src={getFavicon(link.url)}
								alt=""
								loading="lazy"
								onerror={(e) => (e.currentTarget.style.visibility = "hidden")}
							/>
						</div>
						<div class="chip-body">
							<span class="chip-title">{link.title ?? getDomain(link.url)}</span>
							<span class="chip-meta">
								<span class="chip-domain">{getDomain(link.url)}</span>
								<span class="chip-dot">·</span>
								<span>shared by {link.sharedBy}</span>
								<span class="chip-dot">·</span>
								<span>{formatAge(link.sharedAt)}</span>
								<span class="chip-dot">·</span>
								<span class="chip-channel">#{link.convName}</span>
							</span>
						</div>
						<svg class="ext-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
					</a>
				{/each}
			</div>
		{/if}

		{#if uploadedFiles.length === 0 && links.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
				</div>
				<h2>No files yet</h2>
				<p>Files uploaded in chat and links shared in channels will appear here.</p>
			</div>
		{/if}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	/* ── Header ── */
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem;
		border-bottom: 1.5px solid #ddd7cc;
		flex-shrink: 0;
	}
	.wordmark-wrap {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	.wordmark {
		font-family: 'Cambridge', serif;
		font-size: 1.1rem;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
	}
	.wordmark:hover { opacity: 0.7; }
	.back-link {
		font-size: 0.82rem;
		color: #a09688;
		text-decoration: none;
		font-weight: 500;
	}
	.back-link:hover { color: var(--ink); }

	/* ── Main ── */
	main {
		flex: 1;
		padding: 2rem 1.5rem;
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.page-header { margin-bottom: 1.75rem; }
	h1 {
		font-family: 'Cambridge', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 0.25rem;
		color: var(--ink);
	}
	.subtitle {
		font-size: 0.85rem;
		color: #a09688;
		margin: 0;
	}
	.section-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #b0a898;
		margin: 0 0 0.6rem;
	}

	/* ── Empty state ── */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 4rem 1rem;
		color: #a09688;
		gap: 0.75rem;
	}
	.empty-icon {
		color: #c8c1b4;
		margin-bottom: 0.5rem;
	}
	.empty-state h2 {
		font-family: 'Cambridge', serif;
		font-size: 1.3rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0;
	}
	.empty-state p {
		font-size: 0.9rem;
		max-width: 340px;
		line-height: 1.5;
		margin: 0;
	}

	/* ── Link chips ── */
	.links-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.link-chip {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem 1rem;
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 12px;
		text-decoration: none;
		color: var(--ink);
		transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
		min-width: 0;
		overflow: hidden;
		width: 100%;
		box-sizing: border-box;
	}
	.link-chip:hover {
		border-color: #b0a898;
		background: #faf8f5;
		box-shadow: 0 2px 8px rgba(0,0,0,0.06);
	}

	.chip-favicon {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.chip-favicon img {
		width: 16px;
		height: 16px;
		border-radius: 3px;
	}
	.file-type-icon { color: #a09688; }
	.file-type-icon[data-type="image"] { color: #5ba4cf; }
	.file-type-icon[data-type="video"] { color: #e57373; }
	.file-type-icon[data-type="pdf"] { color: #e07550; }

	.chip-body {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.chip-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip-meta {
		font-size: 0.72rem;
		color: #a09688;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip-domain { font-weight: 600; color: #888; }
	.chip-channel { color: #a09688; }
	.chip-dot { opacity: 0.5; }

	.ext-icon {
		flex-shrink: 0;
		color: #c8c1b4;
		transition: color 0.15s;
	}
	.link-chip:hover .ext-icon { color: #a09688; }

	/* ── Mobile ── */
	@media (max-width: 640px) {
		header {
			position: fixed; top: 0; left: 0; right: 0; z-index: 10;
			background: var(--paper);
			padding: 0.75rem 1rem;
		}
		main {
			padding: 1.25rem 1rem;
			padding-top: 3.75rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		h1 { font-size: 1.5rem; }
		.back-link { display: none; }
		.chip-meta { display: none; }
		.chip-title { font-size: 0.875rem; }
		.link-chip { padding: 0.65rem 0.875rem; gap: 0.75rem; }
	}
</style>
