<script>
	// Shared message-attachment renderer used anywhere a bubble can carry a
	// file/image/video outside the primary channel/DM message loop — the
	// thread panel, thread parent, and the react-preview / pinned bubble
	// (which previously rendered nothing for image/file-only messages).
	//
	// Source ↗ and Download are self-contained (pure URL ops). The in-app
	// "View" button only appears when the host passes an `onView` callback
	// (the channel/DM pages own the viewer modal); other surfaces fall back
	// to Source ↗.
	import FileTypeIcon from './FileTypeIcon.svelte';
	import { formatSize, isViewableFile, fileTypeName, downloadFile } from '$lib/file-utils.js';

	let {
		attachment,
		mine = false,
		compact = false,      // small preview: image thumb / icon+name, no action row
		onView = null,        // (url, filename) => void — enables the View button
		onImgLoad = null
	} = $props();

	const isImage = $derived(attachment?.mimetype?.startsWith('image/'));
	const isVideo = $derived(attachment?.mimetype?.startsWith('video/'));

	function imgErr(e) {
		const img = e.target;
		const r = parseInt(img.dataset.retries ?? '0');
		if (r < 3) { img.dataset.retries = r + 1; setTimeout(() => { img.src = img.src; }, 1000 * (r + 1)); }
		else { img.replaceWith(Object.assign(document.createElement('div'), { className: 'ma-img-removed', textContent: 'Image removed' })); }
	}
</script>

{#if attachment}
	{#if isImage}
		<a href={attachment.url} target="_blank" rel="noopener noreferrer" class="ma-img" class:compact>
			<img src={attachment.url} alt={attachment.filename} loading="lazy" onload={onImgLoad} onerror={imgErr} />
		</a>
	{:else if isVideo && !compact}
		<div class="ma-video">
			<video src={attachment.url} controls preload="metadata" onloadedmetadata={onImgLoad}></video>
			<div class="ma-file-body">
				<span class="ma-name">{attachment.filename}</span>
				<span class="ma-size">{formatSize(attachment.size)}</span>
			</div>
		</div>
	{:else}
		{@const viewable = isViewableFile(attachment.filename, attachment.mimetype, attachment.size)}
		<div class="ma-file" class:mine class:compact>
			<FileTypeIcon filename={attachment.filename} mimetype={attachment.mimetype} url={isVideo ? '' : ''} iconSize={compact ? 26 : 36} />
			<div class="ma-file-body">
				<span class="ma-name">{attachment.filename}</span>
				<span class="ma-size">{fileTypeName(attachment.filename) ? `${fileTypeName(attachment.filename)} · ` : ''}{formatSize(attachment.size)}</span>
				{#if !compact}
					<div class="ma-btns">
						{#if viewable && onView}
							<button class="ma-btn" onclick={() => onView(attachment.url, attachment.filename)}>
								<svg class="ma-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
								View
							</button>
						{/if}
						<a class="ma-btn" href={attachment.url} target="_blank" rel="noopener noreferrer">
							<svg class="ma-btn-icon" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></svg>
							Source
						</a>
						<button class="ma-btn" onclick={() => downloadFile(attachment.url, attachment.filename)}>
							<svg class="ma-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
							Download
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	.ma-img {
		padding: 0; overflow: hidden; display: block; max-width: 260px; border-radius: 14px;
		text-decoration: none;
	}
	.ma-img.compact { max-width: 140px; border-radius: 10px; }
	.ma-img img { display: block; max-width: 260px; max-height: 320px; width: 100%; height: auto; object-fit: cover; }
	.ma-img.compact img { max-width: 140px; max-height: 140px; }
	:global(.ma-img-removed) {
		display: flex; align-items: center; justify-content: center;
		width: 200px; height: 120px; background: var(--surface-2); color: var(--muted-fg);
		font-size: 0.78rem; font-family: inherit; border-radius: 8px;
	}
	.ma-video { padding: 0.5rem; max-width: 320px; display: block; }
	.ma-video video { display: block; width: 100%; max-height: 400px; border-radius: 8px; background: #000; }
	.ma-file {
		display: flex; align-items: flex-start; gap: 0.65rem;
		padding: 0.6rem 0.85rem; text-decoration: none; color: inherit; min-width: 0;
		background: var(--surface-2); border-radius: 14px; max-width: 320px;
	}
	.ma-file.compact { padding: 0.4rem 0.55rem; gap: 0.45rem; max-width: 240px; }
	.ma-file-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1; }
	.ma-name { font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ma-size { font-size: 0.7rem; opacity: 0.6; }
	.ma-btns { display: flex; gap: 0.3rem; margin-top: 0.25rem; flex-wrap: wrap; }
	.ma-btn {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.22rem 0.55rem; border-radius: 5px; font-family: inherit; font-size: 0.7rem;
		font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.1s;
		border: 1px solid var(--border); background: transparent; color: inherit;
	}
	.ma-btn:hover { background: rgba(0,0,0,0.06); }
	.ma-btn-icon { width: 13px; height: 13px; flex-shrink: 0; }
</style>
