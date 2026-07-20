<script>
	import { onMount, tick } from 'svelte';
	import { marked } from 'marked';
	import GemmaIcon from '$lib/components/GemmaIcon.svelte';
	import { pageTitle } from '$lib/page-title-store.js';

	// Gemma chat — talks to the user's OWN saved endpoint via the server
	// proxy. History is local to this browser (no Firebase/Turso rows).
	// Messages may be plain strings or OpenAI content-part arrays (text +
	// image_url) — Gemma is multimodal, images ride as data URLs.
	let checked = $state(false);
	let hasKey = $state(false);
	let messages = $state([]);
	let draft = $state('');
	let pendingImg = $state(null);   // { dataUrl, name }
	let streaming = $state(false);
	let errorText = $state(null);
	let scroller = $state(null);
	let fileInput = $state(null);

	const STORE = 'gemma-chat-v1';

	onMount(async () => {
		pageTitle.set('Gemma');
		try { messages = JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { messages = []; }
		const res = await fetch('/api/ai/key');
		if (res.ok) hasKey = (await res.json()).hasKey;
		checked = true;
		scrollDown();
	});

	function persist() {
		try {
			// keep localStorage under quota: strip image data from all but
			// the most recent exchanges (the API only needs recent context)
			const out = messages.slice(-200).map((m, i, arr) => {
				if (typeof m.content === 'string' || i >= arr.length - 12) return m;
				return { ...m, content: m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') || '[image]' };
			});
			localStorage.setItem(STORE, JSON.stringify(out));
		} catch { /* quota — history just won't survive reload */ }
	}
	async function scrollDown() { await tick(); scroller?.scrollTo({ top: scroller.scrollHeight }); }

	function msgText(m) {
		return typeof m.content === 'string' ? m.content : (m.content.find((p) => p.type === 'text')?.text ?? '');
	}
	function msgImg(m) {
		return typeof m.content === 'string' ? null : (m.content.find((p) => p.type === 'image_url')?.image_url?.url ?? null);
	}

	async function onPickImage(e) {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file || !file.type.startsWith('image/')) return;
		// downscale client-side: multimodal models don't need more than
		// ~1280px, and data URLs ride inside the JSON request body
		const bmp = await createImageBitmap(file);
		const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
		const cv = document.createElement('canvas');
		cv.width = Math.round(bmp.width * k);
		cv.height = Math.round(bmp.height * k);
		cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
		pendingImg = { dataUrl: cv.toDataURL('image/jpeg', 0.85), name: file.name };
	}

	async function send() {
		const text = draft.trim();
		if ((!text && !pendingImg) || streaming) return;
		const img = pendingImg;
		draft = ''; pendingImg = null;
		errorText = null;
		const content = img
			? [...(text ? [{ type: 'text', text }] : []), { type: 'image_url', image_url: { url: img.dataUrl } }]
			: text;
		messages = [...messages, { role: 'user', content }, { role: 'assistant', content: '' }];
		persist(); scrollDown();
		streaming = true;
		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: messages.slice(0, -1) })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				if (body?.code === 'no_key') { hasKey = false; messages = messages.slice(0, -2); }
				else if (body?.code === 'auth_failed') errorText = `Your API key was rejected (${body.status}) — check it in Gemma settings.`;
				else if (body?.status) errorText = `Gemma is down right now (${body.status}) — try again later.`;
				else errorText = 'Gemma is unreachable right now.';
				if (errorText) messages = messages.slice(0, -1);
				return;
			}
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				const lines = buf.split('\n');
				buf = lines.pop();
				for (const ln of lines) {
					const t = ln.trim();
					if (!t.startsWith('data:')) continue;
					const payload = t.slice(5).trim();
					if (payload === '[DONE]') continue;
					try {
						const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
						if (delta) {
							messages[messages.length - 1].content += delta;
							messages = messages;
							scrollDown();
						}
					} catch { /* partial frame */ }
				}
			}
			if (!messages[messages.length - 1].content) {
				messages = messages.slice(0, -1);
				errorText = 'Gemma sent nothing back — try again.';
			}
		} catch {
			errorText = 'Connection dropped mid-reply.';
		} finally {
			streaming = false;
			persist(); scrollDown();
		}
	}

	function clearChat() {
		if (messages.length && !confirm('Clear this conversation?')) return;
		messages = [];
		persist();
	}

	function mdSafe(text) {
		try { return marked.parse(text); } catch { return text; }
	}

	function onKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	}
</script>

<svelte:head><title>Gemma — eating.computer</title></svelte:head>

<main class="gm-page">

	{#if checked && !hasKey}
		<div class="gm-setup">
			<p><b>Gemma needs your API key first.</b> It takes a minute:</p>
			<ol>
				<li>Log in at <a href="https://chatterbox.ee.cooper.edu/" target="_blank" rel="noopener">chatterbox.ee.cooper.edu</a> (through Kahan).</li>
				<li>Click your name in the <b>bottom-left corner</b> → <b>Settings</b>.</li>
				<li>Open <b>Account</b> → <b>API keys</b> → <b>Show</b>, then copy the key.</li>
				<li>Paste it into <a href="/app/ai">Gemma settings</a> here and hit Save.</li>
			</ol>
			<a class="gm-setup-btn" href="/app/ai">Add my API key →</a>
		</div>
	{:else if checked}
		<div class="gm-scroll" bind:this={scroller}>
			<div class="gm-col">
				{#if messages.length === 0}
					<div class="gm-empty">
						<GemmaIcon size={56} />
						<p>Say hi — Gemma can help with coursework, code, writing, ideas. Attach an image and ask about it, too.</p>
					</div>
				{/if}
				{#each messages as m, i (i)}
					<div class="gm-row" class:own={m.role === 'user'}>
						{#if m.role === 'assistant'}
							<span class="gm-msg-icon"><GemmaIcon size={24} /></span>
						{/if}
						<div class="gm-bubble" class:own={m.role === 'user'}>
							{#if msgImg(m)}
								<img class="gm-img" src={msgImg(m)} alt="attachment" />
							{/if}
							{#if m.role === 'assistant'}
								{#if m.content}
									{@html mdSafe(m.content)}
								{:else}
									<span class="gm-typing"><i></i><i></i><i></i></span>
								{/if}
							{:else if msgText(m)}
								{msgText(m)}
							{/if}
						</div>
					</div>
				{/each}
				{#if errorText}<p class="gm-error">{errorText}</p>{/if}
			</div>
		</div>

		<div class="gm-compose-wrap">
			<div class="gm-compose">
				{#if pendingImg}
					<div class="gm-attach-preview">
						<img src={pendingImg.dataUrl} alt={pendingImg.name} />
						<button class="gm-attach-x" onclick={() => (pendingImg = null)} title="Remove image">×</button>
					</div>
				{/if}
				<div class="gm-compose-row">
					<button class="gm-attach-btn" onclick={() => fileInput?.click()} disabled={streaming} title="Attach image">
						<span class="msi msi-20">image</span>
					</button>
					{#if messages.length}
						<button class="gm-attach-btn" onclick={clearChat} disabled={streaming} title="Clear chat">
							<span class="msi msi-20">delete_sweep</span>
						</button>
					{/if}
					<input type="file" accept="image/*" style="display:none" bind:this={fileInput} onchange={onPickImage} />
					<textarea
						rows="1"
						placeholder="Message Gemma…"
						bind:value={draft}
						onkeydown={onKeydown}
						disabled={streaming}
					></textarea>
					<button class="gm-send" onclick={send} disabled={streaming || (!draft.trim() && !pendingImg)}>Send</button>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	/* Lives INSIDE the chat +layout's .chat-wrap — which already offsets
	   below the header and sizes the column (same as channel/DM pages).
	   Adding our own 100dvh/padding-top here double-offset the content
	   and clipped the top of the messages. Just fill the wrap. */
	.gm-page {
		flex: 1;
		min-height: 0;
		display: flex; flex-direction: column;
		align-items: stretch;
		place-items: unset;
		padding: 0; /* global main padding (2rem) was shoving the scroll area down */
		background: var(--paper);
		box-sizing: border-box;
	}

	.gm-setup {
		max-width: 560px; margin: 3rem auto; padding: 0 1.5rem;
		font-size: 0.95rem; line-height: 1.6;
	}
	.gm-setup ol { padding-left: 1.3rem; }
	.gm-setup li { margin-bottom: 0.45rem; }
	.gm-setup a { color: var(--ink); }
	.gm-setup-btn {
		display: inline-block; margin-top: 0.8rem;
		background: var(--ink); color: var(--paper) !important;
		text-decoration: none; font-weight: 600; font-size: 0.9rem;
		padding: 0.55rem 1rem; border-radius: 10px;
	}

	.gm-scroll {
		flex: 1; overflow-y: auto;
		/* same as the DM/channel pages: no visible scrollbar — its
		   appearance was reflowing the centred column (and the compose
		   bar) whenever messages overflowed */
		scrollbar-width: none;
	}
	.gm-scroll::-webkit-scrollbar { display: none; }
	/* Same centred 840px reading column as the channel/DM pages, so
	   switching between Gemma and other chats never shifts width. */
	.gm-col {
		width: 100%; max-width: 840px; margin: 0 auto;
		padding: 1rem 1.5rem; box-sizing: border-box;
		display: flex; flex-direction: column;
	}
	.gm-empty {
		display: flex; flex-direction: column; align-items: center; gap: 0.8rem;
		margin-top: 14vh; color: var(--muted-fg); font-size: 0.92rem; text-align: center;
	}
	.gm-row { display: flex; gap: 0.5rem; margin-bottom: 0.8rem; align-items: flex-end; }
	.gm-row.own { justify-content: flex-end; }
	.gm-msg-icon { flex-shrink: 0; }
	.gm-bubble {
		max-width: 75%;
		background: var(--surface-2);
		border-radius: 16px;
		padding: 0.6rem 0.9rem;
		font-size: 0.93rem; line-height: 1.55;
		overflow-wrap: break-word;
		white-space: pre-wrap;
	}
	.gm-bubble.own { background: var(--ink); color: var(--paper); }
	.gm-img {
		display: block; max-width: 260px; max-height: 320px;
		border-radius: 10px; margin-bottom: 0.4rem; object-fit: cover;
	}
	.gm-bubble :global(p) { margin: 0 0 0.5em; white-space: normal; }
	.gm-bubble :global(p:last-child) { margin-bottom: 0; }
	.gm-bubble :global(pre) {
		background: rgba(0, 0, 0, 0.08); border-radius: 8px;
		padding: 0.6rem 0.7rem; overflow-x: auto; white-space: pre;
		font-size: 0.82rem;
	}
	.gm-bubble :global(code) { font-size: 0.85em; }
	.gm-bubble :global(ul), .gm-bubble :global(ol) { margin: 0.3em 0; padding-left: 1.3em; white-space: normal; }
	.gm-typing { display: inline-flex; gap: 4px; padding: 0.2rem 0; }
	.gm-typing i {
		width: 6px; height: 6px; border-radius: 50%; background: var(--muted-fg);
		animation: gmblink 1.2s infinite;
	}
	.gm-typing i:nth-child(2) { animation-delay: 0.2s; }
	.gm-typing i:nth-child(3) { animation-delay: 0.4s; }
	@keyframes gmblink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
	.gm-error { color: #c0392b; font-size: 0.85rem; text-align: center; }

	.gm-compose-wrap { background: var(--paper); position: relative; }
	/* same message-fade the class chat has above its input bar */
	.gm-compose-wrap::before {
		content: '';
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		height: 40px;
		background: linear-gradient(to bottom, transparent 0%, var(--paper) 100%);
		pointer-events: none;
		z-index: 1;
	}
	/* Same 840px column + textarea styling as the DM/channel input bar. */
	.gm-compose {
		width: 100%; max-width: 840px; margin: 0 auto;
		padding: 0.75rem 1.5rem 1.5rem; box-sizing: border-box;
	}
	.gm-compose-row { display: flex; gap: 0.5rem; align-items: flex-end; }
	.gm-attach-btn {
		background: none; border: none; cursor: pointer;
		color: var(--muted-fg); padding: 0.5rem 0.2rem;
		display: flex; align-items: center;
	}
	.gm-attach-btn:hover { color: var(--ink); }
	.gm-attach-btn:disabled { opacity: 0.4; cursor: default; }
	.gm-attach-preview { position: relative; display: inline-block; margin-bottom: 0.5rem; }
	.gm-attach-preview img {
		display: block; max-width: 140px; max-height: 100px;
		border-radius: 10px; border: 1px solid var(--border); object-fit: cover;
	}
	.gm-attach-x {
		position: absolute; top: -8px; right: -8px;
		width: 22px; height: 22px; border-radius: 50%;
		background: var(--ink); color: var(--paper);
		border: none; cursor: pointer; font-size: 0.85rem; line-height: 1;
	}
	textarea {
		flex: 1; min-width: 0; /* flex refuses to shrink below content width otherwise — the bar would breathe with message length */
		padding: 0.6rem 0.85rem; border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; resize: none; field-sizing: content; max-height: 140px; transition: border-color 0.15s;
	}
	textarea:focus { border-color: var(--ink); }
	.gm-send {
		font-family: inherit; font-size: 0.9rem; font-weight: 600;
		background: var(--ink); color: var(--paper);
		border: none; border-radius: 10px; padding: 0.6rem 1.1rem; cursor: pointer;
	}
	.gm-send:disabled { opacity: 0.45; cursor: default; }

	/* mobile bottom-nav clearance comes from .chat-wrap, like other chats */
</style>
