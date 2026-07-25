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
		loadDigests();
		syncDigestSetting();
	});

	// ── Daily digests ────────────────────────────────────────────────────
	// Digests are DM'd server-side by the gemma bot (see gemma-digest.js);
	// this page is their home. Fetch them, merge any new ones into the
	// thread (deduped by digestId), persist, and let the endpoint clear the
	// unread badge on the sidebar's Gemma entry.
	async function loadDigests() {
		try {
			const r = await fetch('/api/gemma/digest?history=1');
			if (!r.ok) return;
			const { digests } = await r.json();
			// Prune locally-cached digest bubbles the server no longer has
			// (instructor "reset & send first-time digest" wipes the conv) —
			// only when the server list is complete, so a >40-digest history
			// never self-truncates.
			if ((digests ?? []).length < 40) {
				const serverIds = new Set((digests ?? []).map((d) => d.id));
				const pruned = messages.filter((m) => !m.digestId || serverIds.has(m.digestId));
				if (pruned.length !== messages.length) { messages = pruned; persist(); }
			}
			const seen = new Set(messages.map((m) => m.digestId).filter(Boolean));
			const fresh = (digests ?? []).filter((d) => d.text && !seen.has(d.id));
			if (fresh.length) {
				messages = [...messages, ...fresh.map((d) => ({
					role: 'assistant', content: d.text, digestId: d.id, digestAt: d.at
				}))];
				persist();
			}
			scrollDown();
		} catch { /* digests are best-effort */ }
	}
	const digestDate = (at) => new Date(at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

	// Goals + assignment action items moved to /app/goals (the Goals page
	// in the Gemma sidebar section) — this thread is chat + digests.

	// ── Digest opt in/out ────────────────────────────────────────────────
	// Synced from the SERVER at mount (stale page data made "opt back in"
	// look broken); the button toggles both ways.
	let digestsOn = $state(null); // null until synced
	let digestsBusy = $state(false);
	async function syncDigestSetting() {
		try {
			const r = await fetch('/api/gemma/settings');
			if (r.ok) digestsOn = (await r.json()).optIn;
		} catch { /* leave null — button hides */ }
	}
	async function toggleDigests() {
		if (digestsOn === null || digestsBusy) return;
		if (digestsOn && !confirm('Are you sure you want to opt out of Gemma digests? You can opt back in right here any time.')) return;
		digestsBusy = true;
		const next = !digestsOn;
		try {
			const r = await fetch('/api/gemma/settings', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ optIn: next })
			});
			if (r.ok) digestsOn = next;
		} catch { /* keep old state */ }
		digestsBusy = false;
	}

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
	// Digest texts arrive as plain lines with "- " bullets. breaks:true keeps
	// single newlines as line breaks; the "• " rewrite repairs digests stored
	// before the generator switched to markdown hyphens.
	function digestMd(text) {
		try {
			return marked.parse(String(text).replace(/(^|\n)\s*[•▪]\s+/g, '$1- '), { breaks: true });
		} catch { return text; }
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
						<div class="gm-bubble" class:own={m.role === 'user'} class:digest={!!m.digestId}>
							{#if m.digestId}
								<div class="gm-digest-tag">📬 Digest{m.digestAt ? ` — ${digestDate(m.digestAt)}` : ''}</div>
							{/if}
							{#if msgImg(m)}
								<img class="gm-img" src={msgImg(m)} alt="attachment" />
							{/if}
							{#if m.role === 'assistant'}
								{#if m.content}
									{@html m.digestId ? digestMd(m.content) : mdSafe(m.content)}
								{:else}
									<span class="gm-typing"><i></i><i></i><i></i></span>
								{/if}
							{:else if msgText(m)}
								{msgText(m)}
							{/if}
						</div>
					</div>
				{/each}
				{#if digestsOn !== null}
					<div class="gm-optout-row">
						<button class="gm-optout" onclick={toggleDigests} disabled={digestsBusy}>
							{digestsBusy ? 'Saving…' : digestsOn ? 'Opt out of digests' : 'Digests are off — opt back in'}
						</button>
					</div>
				{/if}
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
	.gm-bubble.digest { border: 1.5px solid color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 45%, var(--border)); }
	.gm-digest-tag {
		font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent));
		margin-bottom: 0.35rem;
	}
	/* The checklist card gets room to breathe: generous padding, a wider
	   footprint than a chat bubble, soft separators between rows. */
	.gm-bubble.gm-actions {
		/* top padding matches the digest bubbles (0.6rem) so the section tag
		   sits at the same height as "📬 Digest" in the summaries above */
		padding: 0.6rem 1.15rem 0.85rem;
		max-width: min(560px, 92%);
		width: 100%;
	}
	.gm-actions .gm-digest-tag { margin: 0 0 0.2rem; }
	.gm-action-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
	.gm-action {
		display: flex; flex-direction: column; gap: 0.2rem;
		padding: 0.55rem 0;
	}
	.gm-action-list .gm-action:first-child { padding-top: 0.05rem; }
	.gm-action-list .gm-action:last-child { padding-bottom: 0.1rem; }
	.gm-action:not(:last-child) { border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
	.gm-actions .gm-tag-gap { margin-top: 0.7rem; }
	.gm-action-check { display: flex; align-items: flex-start; gap: 0.55rem; cursor: pointer; }
	/* Checkbox matches the homepage student checklist (.check-box): 24px,
	   2px border, 6px radius, ink fill + paper checkmark when checked. */
	.gm-action-check input {
		appearance: none; -webkit-appearance: none;
		width: 24px; height: 24px; margin: 0; flex-shrink: 0;
		border: 2px solid var(--border); border-radius: 6px;
		background: var(--paper); cursor: pointer;
		display: inline-flex; align-items: center; justify-content: center;
		transition: all 0.15s;
	}
	.gm-action-check:hover input:not(:checked) { border-color: var(--muted-fg); }
	.gm-action-check input:checked { background: var(--ink); border-color: var(--ink); }
	.gm-action-check input:checked::after {
		content: '';
		width: 11px; height: 6px;
		border-left: 3px solid var(--paper);
		border-bottom: 3px solid var(--paper);
		transform: rotate(-45deg) translateY(-2px);
	}
	.gm-action-check span { padding-top: 2px; line-height: 1.45; }
	.gm-action.done .gm-action-check span { text-decoration: line-through; opacity: 0.55; }
	.gm-action-submit { color: inherit; text-decoration: none; font-weight: 500; }
	.gm-action-submit:hover { text-decoration: underline; }
	.gm-action-hint { font-size: 0.7rem; color: var(--muted-fg); font-weight: 400; }
	.gm-action-week { font-size: 0.7rem; color: var(--muted-fg); padding-left: calc(24px + 0.55rem); }
	.gm-tag-gap { margin-top: 0.8rem; }
	.gm-goal-src {
		font-size: 0.68rem; color: var(--muted-fg); text-decoration: none;
		padding-left: calc(24px + 0.55rem);
	}
	.gm-goal-src:hover { color: var(--md-sys-color-primary, var(--accent)); text-decoration: underline; }
	.gm-goal-row { display: flex; align-items: flex-start; gap: 0.4rem; }
	.gm-goal-row .gm-action-check { flex: 1; min-width: 0; }
	.gm-goal-remove {
		background: none; border: none; cursor: pointer; padding: 0 0.15rem;
		color: var(--muted-fg); font-size: 0.75rem; line-height: 1.4; flex-shrink: 0;
	}
	.gm-goal-remove:hover { color: var(--ink); }
	.gm-goals-more {
		background: none; border: none; cursor: pointer;
		margin-top: 0.55rem; padding: 0;
		font-size: 0.75rem; font-weight: 600;
		color: var(--md-sys-color-primary, var(--accent));
	}
	.gm-goals-more:hover { text-decoration: underline; }
	.gm-goal-by {
		display: inline-block; margin-left: 0.4rem; padding: 0.05rem 0.4rem;
		font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
		color: var(--md-sys-color-primary, var(--accent));
		border: 1px solid color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 45%, transparent);
		border-radius: 99px; vertical-align: 1px;
	}
	.gm-goal-remove.armed {
		color: #fff; background: #c0392b; border-radius: 6px;
		font-size: 0.68rem; font-weight: 700; padding: 0.1rem 0.4rem;
	}
	.gm-goal-srcbtn {
		display: inline-flex; align-items: center; gap: 0.25rem;
		background: none; border: none; cursor: pointer; padding: 0;
		margin-left: calc(24px + 0.55rem); margin-top: 0.1rem;
		font-size: 0.68rem; font-weight: 600; color: var(--muted-fg);
		align-self: flex-start;
	}
	.gm-goal-srcbtn:hover { color: var(--md-sys-color-primary, var(--accent)); }
	.gm-goal-srcbtn .msi { font-size: 14px; line-height: 1; }
	.gm-goal-preview {
		display: block; margin-left: calc(24px + 0.55rem); margin-top: 0.15rem;
		padding: 0.35rem 0.55rem;
		font-size: 0.74rem; line-height: 1.45; color: var(--muted-fg);
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		border-left: 2.5px solid color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 55%, var(--border));
		border-radius: 0 8px 8px 0;
		text-decoration: none;
	}
	.gm-goal-preview:hover { background: color-mix(in srgb, var(--ink) 9%, transparent); }
	.gm-goal-preview mark {
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 26%, transparent);
		color: var(--ink); border-radius: 3px; padding: 0 2px;
	}
	.gm-goal-preview-who { font-weight: 700; margin-right: 0.25rem; color: var(--ink); }
	.gm-optout-row { display: flex; justify-content: center; padding: 0.5rem 0 0.25rem; }
	.gm-optout {
		background: none; border: none; cursor: pointer;
		margin-top: 0.9rem; padding: 0;
		font-size: 0.7rem; color: var(--muted-fg); text-decoration: underline;
	}
	.gm-optout:hover { color: var(--ink); }
	.gm-optout:disabled { cursor: default; text-decoration: none; }
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
