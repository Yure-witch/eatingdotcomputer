<script>
	import { onMount } from 'svelte';
	import { invalidateCustomEmojiCache } from '$lib/custom-emoji-store.js';

	let { onInsertEmoji, onInsertReaction } = $props();

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
	let corsStatus = $state(null); // null | 'checking' | 'ok' | 'fail'
	let corsTimer = null;

	async function loadEmoji() {
		emojiLoading = true; emojiError = null;
		try {
			const r = await fetch('/api/custom-emoji');
			if (!r.ok) throw new Error('Failed');
			emojiList = await r.json();
		} catch { emojiError = 'Failed to load'; }
		finally { emojiLoading = false; }
	}

	async function loadReactions() {
		reactionsLoading = true; reactionsError = null;
		try {
			const r = await fetch('/api/reaction-images');
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
			const r = await fetch('/api/custom-emoji', { method: 'POST', body: fd });
			if (!r.ok) { const t = await r.text(); throw new Error(t); }
			const newEmoji = await r.json();
			emojiList = [...emojiList, newEmoji];
			emojiShortcode = ''; emojiTags = ''; emojiFile = null;
			if (emojiFileInput) emojiFileInput.value = '';
			invalidateCustomEmojiCache();
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
			} else {
				fd.append('url', reactionUrl.trim());
			}
			const r = await fetch('/api/reaction-images', { method: 'POST', body: fd });
			if (!r.ok) { const t = await r.text(); throw new Error(t); }
			const newReaction = await r.json();
			reactionList = [...reactionList, newReaction];
			reactionName = ''; reactionTags = ''; reactionFile = null; reactionUrl = ''; corsStatus = null;
			if (reactionFileInput) reactionFileInput.value = '';
		} catch (e) { reactionUploadError = e.message || 'Upload failed'; }
		finally { reactionUploading = false; }
	}

	const canSubmitReaction = $derived(
		reactionName.trim().length > 0 && !reactionUploading && (
			reactionMode === 'file' ? !!reactionFile : (corsStatus === 'ok')
		)
	);

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
				<input type="file" accept="image/*" style="display:none" bind:this={emojiFileInput}
					onchange={(e) => { emojiFile = e.target.files?.[0] ?? null; }} />
			</label>
			<input class="ce-text-input" type="text" placeholder="shortcode (e.g. party_blob)"
				bind:value={emojiShortcode} maxlength="32" />
			<input class="ce-text-input" type="text" placeholder="tags (comma separated)"
				bind:value={emojiTags} />
			<button class="ce-upload-btn" onclick={uploadEmoji}
				disabled={emojiUploading || !emojiFile || !emojiShortcode.trim()}>
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
						<div class="ce-emoji-item" title=":${e.shortcode}:" onclick={() => onInsertEmoji('[ce:' + e.shortcode + ']')}>
							<img src={e.url} alt={':' + e.shortcode + ':'} width="56" height="56" loading="lazy" />
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
					<input type="file" accept="image/*" style="display:none" bind:this={reactionFileInput}
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
							<img src={r.url} alt={r.name} loading="lazy" crossorigin="anonymous" />
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

	.ce-upload-section { padding: 0.5rem 0.65rem 0.4rem; border-bottom: 1px solid #e8e0d2; display: flex; flex-direction: column; gap: 0.3rem; flex-shrink: 0; }

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
	.ce-emoji-item { width: 64px; height: 64px; border-radius: 10px; border: 1.5px solid #e0d9cc; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color 0.13s, transform 0.1s; overflow: hidden; }
	.ce-emoji-item:hover { border-color: var(--ink, #1a1a1a); transform: scale(1.06); }
	.ce-emoji-item img { width: 56px; height: 56px; object-fit: contain; display: block; }

	.ce-reaction-grid { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.ce-reaction-item { border-radius: 8px; border: 1.5px solid #e0d9cc; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color 0.13s, transform 0.1s; overflow: hidden; height: 80px; }
	.ce-reaction-item:hover { border-color: var(--ink, #1a1a1a); transform: scale(1.04); }
	.ce-reaction-item img { height: 80px; width: auto; max-width: 140px; object-fit: contain; display: block; }
</style>
