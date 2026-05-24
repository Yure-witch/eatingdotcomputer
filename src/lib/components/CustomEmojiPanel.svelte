<script>
	import { onMount } from 'svelte';
	import { invalidateCustomEmojiCache, addToCustomEmojiCache, removeFromCustomEmojiCache } from '$lib/custom-emoji-store.js';

	let { onInsertEmoji, onInsertReaction, isInstructor = false } = $props();

	let tab = $state('emoji'); // 'emoji' | 'reactions'

	// Emoji tab state
	let emojiList = $state([]);
	let emojiLoading = $state(true);
	let emojiError = $state(null);
	let emojiFile = $state(null);
	let emojiShortcode = $state('');
	let emojiTags = $state('');
	let emojiUploading = $state(false);
	let emojiUploadError = $state(null);
	let emojiFileInput = $state(null);
	let emojiRemoveBg = $state(false);
	let emojiBgColor = $state(null); // [r,g,b] sampled color
	let emojiBgCanvas = $state(null);

	// Reactions tab state
	let reactionList = $state([]);
	let reactionsLoading = $state(true);
	let reactionsError = $state(null);
	let reactionMode = $state('file'); // 'file' | 'url'
	let reactionFile = $state(null);
	let reactionUrl = $state('');
	let reactionName = $state('');
	let reactionTags = $state('');
	let reactionUploading = $state(false);
	let reactionUploadError = $state(null);
	let reactionFileInput = $state(null);
	let reactionRemoveBg = $state(false);
	let reactionBgColor = $state(null); // [r,g,b]
	let reactionBgCanvas = $state(null);
	let corsStatus = $state(null); // null | 'checking' | 'ok' | 'fail'
	let corsTimer = null;

	async function loadEmoji() {
		emojiLoading = true; emojiError = null;
		try {
			const r = await fetch('/api/custom-emoji', { cache: 'no-store' });
			if (!r.ok) throw new Error('Failed');
			emojiList = await r.json();
		} catch { emojiError = 'Failed to load'; }
		finally { emojiLoading = false; }
	}

	async function loadReactions() {
		reactionsLoading = true; reactionsError = null;
		try {
			const r = await fetch('/api/reaction-images', { cache: 'no-store' });
			if (!r.ok) throw new Error('Failed');
			reactionList = await r.json();
		} catch { reactionsError = 'Failed to load'; }
		finally { reactionsLoading = false; }
	}

	async function uploadEmoji() {
		if (!emojiFile || !emojiShortcode.trim()) return;
		emojiUploading = true; emojiUploadError = null;
		try {
			const fd = new FormData();
			fd.append('file', emojiFile);
			fd.append('shortcode', emojiShortcode.trim());
			fd.append('tags', emojiTags.trim());
			if (emojiRemoveBg && emojiBgColor) {
				fd.append('removeBg', '1');
				fd.append('removeBgColor', emojiBgColor.join(','));
			}
			const r = await fetch('/api/custom-emoji', { method: 'POST', body: fd });
			if (!r.ok) { const t = await r.text(); try { throw new Error(JSON.parse(t).message); } catch { throw new Error(t); } }
			const newEmoji = await r.json();
			emojiList = [...emojiList, newEmoji];
			emojiShortcode = ''; emojiTags = ''; emojiFile = null; emojiRemoveBg = false; emojiBgColor = null;
			if (emojiFileInput) emojiFileInput.value = '';
			addToCustomEmojiCache(newEmoji.shortcode, newEmoji.url);
		} catch (e) { emojiUploadError = e.message || 'Upload failed'; }
		finally { emojiUploading = false; }
	}

	async function checkCors(url) {
		if (!url) { corsStatus = null; return; }
		try { new URL(url); } catch { corsStatus = 'fail'; return; }
		corsStatus = 'checking';
		try {
			const r = await fetch(`/api/reaction-images?cors=${encodeURIComponent(url)}`);
			const data = await r.json();
			corsStatus = data.ok ? 'ok' : 'fail';
		} catch { corsStatus = 'fail'; }
	}

	function onUrlInput() {
		corsStatus = null;
		clearTimeout(corsTimer);
		corsTimer = setTimeout(() => checkCors(reactionUrl), 600);
	}

	async function uploadReaction() {
		if (!reactionName.trim()) return;
		if (reactionMode === 'file' && !reactionFile) return;
		if (reactionMode === 'url' && (!reactionUrl.trim() || corsStatus !== 'ok')) return;
		reactionUploading = true; reactionUploadError = null;
		try {
			const fd = new FormData();
			fd.append('name', reactionName.trim());
			fd.append('tags', reactionTags.trim());
			if (reactionMode === 'file') {
				fd.append('file', reactionFile);
				if (reactionRemoveBg && reactionBgColor) {
					fd.append('removeBg', '1');
					fd.append('removeBgColor', reactionBgColor.join(','));
				}
			} else {
				fd.append('url', reactionUrl.trim());
			}
			const r = await fetch('/api/reaction-images', { method: 'POST', body: fd });
			if (!r.ok) { const t = await r.text(); try { throw new Error(JSON.parse(t).message); } catch { throw new Error(t); } }
			const newReaction = await r.json();
			reactionList = [...reactionList, newReaction];
			reactionName = ''; reactionTags = ''; reactionFile = null; reactionUrl = ''; corsStatus = null; reactionRemoveBg = false; reactionBgColor = null;
			if (reactionFileInput) reactionFileInput.value = '';
		} catch (e) { reactionUploadError = e.message || 'Upload failed'; }
		finally { reactionUploading = false; }
	}

	const canSubmitReaction = $derived(
		reactionName.trim().length > 0 && !reactionUploading && (
			reactionMode === 'file' ? (!!reactionFile && (!reactionRemoveBg || !!reactionBgColor)) : (corsStatus === 'ok')
		)
	);

	async function deleteEmoji(id) {
		if (!confirm('Remove this custom emote?')) return;
		try {
			const r = await fetch('/api/custom-emoji', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
			if (!r.ok) throw new Error(await r.text());
			const removed = emojiList.find(e => e.id === id);
			emojiList = emojiList.filter(e => e.id !== id);
			if (removed) removeFromCustomEmojiCache(removed.shortcode);
		} catch (e) { alert('Delete failed: ' + e.message); }
	}

	async function deleteReaction(id) {
		if (!confirm('Remove this reaction image?')) return;
		try {
			const r = await fetch('/api/reaction-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
			if (!r.ok) throw new Error(await r.text());
			reactionList = reactionList.filter(e => e.id !== id);
		} catch (e) { alert('Delete failed: ' + e.message); }
	}

	function sampleColor(e, setBgColor) {
		const canvas = e.currentTarget;
		const rect = canvas.getBoundingClientRect();
		const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
		const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
		const ctx = canvas.getContext('2d');
		const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
		setBgColor([r, g, b]);
	}

	function renderPreview(canvasEl, file) {
		if (!file || !canvasEl) return;
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const maxW = 280, maxH = 140;
			const scale = Math.min(1, maxW / img.width, maxH / img.height);
			canvasEl.width = Math.round(img.width * scale);
			canvasEl.height = Math.round(img.height * scale);
			canvasEl.getContext('2d').drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
			URL.revokeObjectURL(url);
		};
		img.src = url;
	}
	$effect(() => { if (emojiBgCanvas && emojiFile) renderPreview(emojiBgCanvas, emojiFile); });
	$effect(() => { if (reactionBgCanvas && reactionFile) renderPreview(reactionBgCanvas, reactionFile); });

	onMount(() => { loadEmoji(); loadReactions(); });
</script>

<div class="ce-panel">
	<div class="ce-tabs">
		<button class="ce-tab" class:active={tab === 'emoji'} onclick={() => tab = 'emoji'}>Custom Emotes</button>
		<button class="ce-tab" class:active={tab === 'reactions'} onclick={() => tab = 'reactions'}>Reaction Images</button>
	</div>

	{#if tab === 'emoji'}
		<div class="ce-upload-section">
			<label class="ce-file-label">
				<span class="ce-file-btn">{emojiFile ? emojiFile.name.slice(0, 20) : 'Choose image…'}</span>
				<input type="file" accept="image/*,.heic,.heif" style="display:none" bind:this={emojiFileInput}
					onchange={(e) => { emojiFile = e.target.files?.[0] ?? null; }} />
			</label>
			<input class="ce-text-input" type="text" placeholder="shortcode (e.g. party_blob)"
				bind:value={emojiShortcode} maxlength="32" />
			<input class="ce-text-input" type="text" placeholder="tags (comma separated)"
				bind:value={emojiTags} />
			<label class="ce-checkbox-label">
				<input type="checkbox" bind:checked={emojiRemoveBg} onchange={() => { emojiBgColor = null; }} />
				<span>Remove solid background</span>
			</label>
			{#if emojiRemoveBg && emojiFile}
				<div class="ce-bg-picker">
					<span class="ce-bg-hint">Click image to sample background color</span>
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<canvas class="ce-bg-canvas"
						bind:this={emojiBgCanvas}
						onclick={(e) => sampleColor(e, c => emojiBgColor = c)}></canvas>
					{#if emojiBgColor}
						<div class="ce-bg-swatch-row">
							<span class="ce-bg-swatch" style="background: rgb({emojiBgColor.join(',')})"></span>
							<span class="ce-bg-swatch-label">rgb({emojiBgColor.join(', ')})</span>
						</div>
					{/if}
				</div>
			{/if}
			<button class="ce-upload-btn" onclick={uploadEmoji}
				disabled={emojiUploading || !emojiFile || !emojiShortcode.trim() || (emojiRemoveBg && !emojiBgColor)}>
				{emojiUploading ? 'Uploading…' : 'Upload'}
			</button>
			{#if emojiUploadError}<div class="ce-error">{emojiUploadError}</div>{/if}
		</div>
		<div class="ce-grid-wrap">
			{#if emojiLoading}
				<div class="ce-loading"><span class="ce-spinner"></span>Loading…</div>
			{:else if emojiError}
				<div class="ce-error-msg">{emojiError}</div>
			{:else if emojiList.length === 0}
				<div class="ce-empty">No custom emoji yet.</div>
			{:else}
				<div class="ce-emoji-grid">
					{#each emojiList as e}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="ce-emoji-item" title=":${e.shortcode}:" onclick={() => onInsertEmoji({ shortcode: e.shortcode, url: e.url })}>
							<img src={e.url} alt={':' + e.shortcode + ':'} width="56" height="56" loading="lazy" />
							{#if isInstructor}<button class="ce-delete-btn" title="Remove" onclick={(ev) => { ev.stopPropagation(); deleteEmoji(e.id); }}>x</button>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

	{:else}
		<div class="ce-upload-section">
			<div class="ce-mode-toggle">
				<button class="ce-mode-btn" class:active={reactionMode === 'file'} onclick={() => { reactionMode = 'file'; corsStatus = null; }}>Upload file</button>
				<button class="ce-mode-btn" class:active={reactionMode === 'url'} onclick={() => { reactionMode = 'url'; reactionFile = null; }}>Link URL</button>
			</div>

			{#if reactionMode === 'file'}
				<label class="ce-file-label">
					<span class="ce-file-btn">{reactionFile ? reactionFile.name.slice(0, 20) : 'Choose image…'}</span>
					<input type="file" accept="image/*,.heic,.heif" style="display:none" bind:this={reactionFileInput}
						onchange={(e) => { reactionFile = e.target.files?.[0] ?? null; }} />
				</label>
			{:else}
				<div class="ce-url-row">
					<input class="ce-text-input ce-url-input" type="url" placeholder="https://example.com/image.png"
						bind:value={reactionUrl} oninput={onUrlInput} />
					{#if corsStatus === 'checking'}
						<span class="cors-badge cors-checking"><span class="ce-spinner ce-spinner-sm"></span></span>
					{:else if corsStatus === 'ok'}
						<span class="cors-badge cors-ok">✓ CORS</span>
					{:else if corsStatus === 'fail'}
						<span class="cors-badge cors-fail">✗ No CORS</span>
					{/if}
				</div>
			{/if}

			<input class="ce-text-input" type="text" placeholder="name" bind:value={reactionName} />
			<input class="ce-text-input" type="text" placeholder="tags (comma separated)" bind:value={reactionTags} />
			{#if reactionMode === 'file'}
				<label class="ce-checkbox-label">
					<input type="checkbox" bind:checked={reactionRemoveBg} onchange={() => { reactionBgColor = null; }} />
					<span>Remove solid background</span>
				</label>
				{#if reactionRemoveBg && reactionFile}
					<div class="ce-bg-picker">
						<span class="ce-bg-hint">Click image to sample background color</span>
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<canvas class="ce-bg-canvas"
							bind:this={reactionBgCanvas}
							onclick={(e) => sampleColor(e, c => reactionBgColor = c)}></canvas>
						{#if reactionBgColor}
							<div class="ce-bg-swatch-row">
								<span class="ce-bg-swatch" style="background: rgb({reactionBgColor.join(',')})"></span>
								<span class="ce-bg-swatch-label">rgb({reactionBgColor.join(', ')})</span>
							</div>
						{/if}
					</div>
				{/if}
			{/if}
			<button class="ce-upload-btn" onclick={uploadReaction} disabled={!canSubmitReaction}>
				{reactionUploading ? 'Saving…' : reactionMode === 'url' ? 'Add link' : 'Upload'}
			</button>
			{#if reactionUploadError}<div class="ce-error">{reactionUploadError}</div>{/if}
		</div>

		<div class="ce-grid-wrap">
			{#if reactionsLoading}
				<div class="ce-loading"><span class="ce-spinner"></span>Loading…</div>
			{:else if reactionsError}
				<div class="ce-error-msg">{reactionsError}</div>
			{:else if reactionList.length === 0}
				<div class="ce-empty">No reaction images yet.</div>
			{:else}
				<div class="ce-reaction-grid">
					{#each reactionList as r}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="ce-reaction-item" title={r.name} onclick={() => onInsertReaction({ url: r.url, name: r.name })}>
							<img src={r.url} alt={r.name} loading="lazy" />
							{#if isInstructor}<button class="ce-delete-btn" title="Remove" onclick={(ev) => { ev.stopPropagation(); deleteReaction(r.id); }}>x</button>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ce-panel {
		width: 340px; height: 420px;
		background: var(--paper, #f7f2ea); color: var(--ink, #1a1a1a);
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		display: flex; flex-direction: column; overflow: hidden;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-size: 0.85rem;
	}
	.ce-tabs { display: flex; border-bottom: 1.5px solid #e8e0d2; background: #f0ebe0; flex-shrink: 0; }
	.ce-tab { flex: 1; padding: 0.55rem 0; border: none; background: none; color: #a09688; font-family: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: color 0.15s, background 0.15s; letter-spacing: 0.02em; }
	.ce-tab:hover { color: var(--ink, #1a1a1a); background: #ece5d8; }
	.ce-tab.active { color: var(--ink, #1a1a1a); background: var(--paper, #f7f2ea); border-bottom: 2px solid var(--ink, #1a1a1a); margin-bottom: -1.5px; }

	.ce-upload-section { padding: 0.5rem 0.65rem 0.4rem; border-bottom: 1px solid #e8e0d2; display: flex; flex-direction: column; gap: 0.3rem; flex-shrink: 0; max-height: 55%; overflow-y: auto; }

	.ce-mode-toggle { display: flex; gap: 0.3rem; }
	.ce-mode-btn { flex: 1; padding: 0.22rem 0; border: 1.5px solid #d5cdc0; border-radius: 6px; background: #fff; color: #8a8078; font-family: inherit; font-size: 0.75rem; cursor: pointer; transition: all 0.13s; }
	.ce-mode-btn.active { background: var(--ink, #1a1a1a); color: #fff; border-color: var(--ink, #1a1a1a); }

	.ce-url-row { display: flex; align-items: center; gap: 0.35rem; }
	.ce-url-input { flex: 1; min-width: 0; }
	.cors-badge { font-size: 0.7rem; font-weight: 600; white-space: nowrap; padding: 0.15rem 0.4rem; border-radius: 5px; display: flex; align-items: center; gap: 0.2rem; }
	.cors-checking { background: #f0ebe0; color: #a09688; }
	.cors-ok { background: #e6f4ec; color: #2a7a4b; }
	.cors-fail { background: #fdecea; color: #c0392b; }

	.ce-file-label { cursor: pointer; }
	.ce-file-btn { display: inline-block; padding: 0.28rem 0.6rem; border: 1.5px solid #d5cdc0; border-radius: 7px; background: #fff; color: #5a5248; font-size: 0.78rem; cursor: pointer; transition: border-color 0.13s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
	.ce-file-btn:hover { border-color: var(--ink, #1a1a1a); }

	.ce-text-input { width: 100%; box-sizing: border-box; padding: 0.28rem 0.6rem; border: 1.5px solid #d5cdc0; border-radius: 7px; background: #fff; font-family: inherit; font-size: 0.78rem; color: var(--ink, #1a1a1a); outline: none; transition: border-color 0.13s; }
	.ce-text-input:focus { border-color: var(--ink, #1a1a1a); }
	.ce-text-input::placeholder { color: #b0a898; }

	.ce-upload-btn { align-self: flex-end; padding: 0.28rem 0.85rem; border: none; border-radius: 7px; background: var(--ink, #1a1a1a); color: #fff; font-family: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: opacity 0.13s; }
	.ce-upload-btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.ce-upload-btn:not(:disabled):hover { opacity: 0.82; }

	.ce-checkbox-label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: #6b5f54; cursor: pointer; user-select: none; }
	.ce-checkbox-label input[type="checkbox"] { margin: 0; accent-color: var(--ink, #1a1a1a); cursor: pointer; }

	.ce-bg-picker { display: flex; flex-direction: column; gap: 0.3rem; }
	.ce-bg-hint { font-size: 0.7rem; color: #a09688; }
	.ce-bg-canvas { border: 1.5px solid #d5cdc0; border-radius: 6px; cursor: crosshair; max-width: 100%; align-self: flex-start; }
	.ce-bg-swatch-row { display: flex; align-items: center; gap: 0.35rem; }
	.ce-bg-swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid #ccc; flex-shrink: 0; }
	.ce-bg-swatch-label { font-size: 0.7rem; color: #6b5f54; font-family: monospace; }
	.ce-error { font-size: 0.72rem; color: #c0392b; }

	.ce-grid-wrap { flex: 1; overflow-y: auto; padding: 0.5rem 0.65rem; min-height: 0; }
	.ce-grid-wrap::-webkit-scrollbar { width: 4px; }
	.ce-grid-wrap::-webkit-scrollbar-thumb { background: #d5cdc0; border-radius: 2px; }

	.ce-loading { display: flex; align-items: center; gap: 0.5rem; color: #a09688; font-size: 0.82rem; justify-content: center; padding: 1.5rem 0; }
	.ce-spinner { width: 14px; height: 14px; border: 2px solid #d5cdc0; border-top-color: var(--ink, #1a1a1a); border-radius: 50%; animation: cespin 0.8s linear infinite; flex-shrink: 0; }
	.ce-spinner-sm { width: 10px; height: 10px; border-width: 1.5px; }
	@keyframes cespin { to { transform: rotate(360deg); } }

	.ce-error-msg { color: #c0392b; font-size: 0.8rem; text-align: center; padding: 1rem 0; }
	.ce-empty { color: #a09688; font-size: 0.8rem; text-align: center; padding: 1.5rem 0; }

	.ce-emoji-grid { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.ce-emoji-item { position: relative; width: 64px; height: 64px; border-radius: 10px; border: 1.5px solid #e0d9cc; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color 0.13s, transform 0.1s; overflow: hidden; }
	.ce-emoji-item:hover { border-color: var(--ink, #1a1a1a); transform: scale(1.06); }
	.ce-emoji-item img { width: 56px; height: 56px; object-fit: contain; display: block; }

	.ce-reaction-grid { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.ce-reaction-item { position: relative; border-radius: 8px; border: 1.5px solid #e0d9cc; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color 0.13s, transform 0.1s; overflow: hidden; height: 80px; }
	.ce-reaction-item:hover { border-color: var(--ink, #1a1a1a); transform: scale(1.04); }
	.ce-reaction-item img { height: 80px; width: auto; max-width: 140px; object-fit: contain; display: block; }

	.ce-delete-btn {
		position: absolute; top: 2px; right: 2px;
		width: 16px; height: 16px; padding: 0;
		border: none; border-radius: 50%;
		background: rgba(0,0,0,0.55); color: #fff;
		font-size: 10px; line-height: 1; cursor: pointer;
		display: none; align-items: center; justify-content: center;
	}
	.ce-emoji-item:hover .ce-delete-btn,
	.ce-reaction-item:hover .ce-delete-btn { display: flex; }
</style>
