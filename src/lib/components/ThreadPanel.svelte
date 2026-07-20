<script>
	// Slack-style thread panel: parent message pinned on top, replies
	// below (archived from Turso + live from Firebase), compose at the
	// bottom. Desktop: side panel docked right. Mobile: full-width sheet.
	//
	// Live replies: threads/{convId}/{parentId}/messages, compact { u, c }
	// with push-ID timestamps — the same contract as channel/DM messages.
	// /api/chat/sync archives them into thread_messages after 24h; this
	// panel merges both sources and dedupes by id.
	import { onMount, onDestroy, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { db as rtdb } from '$lib/firebase.js';
	import { ref, onChildAdded, off, set } from 'firebase/database';
	import { createContentRenderer, jumboEmojiCountM, bubbleFontSize } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import { getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import FormattedInput from './FormattedInput.svelte';
	import ExpressionTip from './ExpressionTip.svelte';
	import { wrapEmojiInText } from '$lib/emoji-tip.js';

	let {
		convId,               // channel id or DM conversation id
		parent,               // { id, userName, content, createdAt }
		currentUser,          // { id, name, role }
		resolveUser = null,   // (uid) => { name, role } for live compact msgs
		onClose = null,
		onCountChange = null, // (parentId, totalCount) → parent page updates its chip
		classId = null        // for /api/upload bookkeeping
	} = $props();

	// wrapEmoji bakes .e-tip name pops into plain emoji — hover parity with chat
	// Captured at init: the page can null/replace `parent` while the fly-out
	// transition is still running, and onDestroy (markRead) fires AFTER that —
	// reading the live prop there crashed on thread switches.
	const parentId = parent.id;
	const parentSnapshot = parent;

	const { contentHtml } = createContentRenderer({ getCeMap: () => getCachedCustomEmojiMap() || {}, wrapEmoji: wrapEmojiInText });

	let replies = $state([]);
	let loading = $state(true);
	let draft = $state('');
	let pendingAtt = $state(null); // { id, url, filename, mimetype, size } from /api/upload
	let uploading = $state(false);
	let fileEl = $state(null);
	let listEl = $state(null);
	let panelEl = $state(null);
	let _ref = null;
	const _seen = new Set();

	const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
	function pushIdToTimestamp(id) {
		let ts = 0;
		for (let i = 0; i < 8; i++) ts = ts * 64 + PUSH_CHARS.indexOf(id[i]);
		return ts;
	}

	// Per-user thread read cursor (threadReads/{uid}/{parentId}, ms) — same
	// contract as lastRead/{uid}/{convId}. Stamped while the panel is open,
	// so anything arriving under your eyes (including your own sends) never
	// counts as unread; the chat pages compare this against the thread's
	// last-activity time to light the chip's unread dot.
	function markRead() {
		if (!currentUser?.id) return;
		set(ref(rtdb, `threadReads/${currentUser.id}/${parentId}`), Date.now()).catch(() => {});
	}

	function addReply(msg) {
		if (_seen.has(msg.id)) return;
		_seen.add(msg.id);
		replies = [...replies, msg].sort((a, b) => a.createdAt - b.createdAt);
		onCountChange?.(parentId, replies.length);
		markRead();
		tick().then(() => {
			listEl?.scrollTo({ top: listEl.scrollHeight });
			if (panelEl) mountStaticEmotes(panelEl);
		});
	}

	onMount(async () => {
		// 1) archived history from Turso
		try {
			const res = await fetch(`/api/chat/thread?convId=${encodeURIComponent(convId)}&parentId=${encodeURIComponent(parentId)}`);
			if (res.ok) {
				const data = await res.json();
				for (const m of data.messages || []) addReply(m);
			}
		} catch { /* live-only fallback */ }
		loading = false;

		// 2) live replies from Firebase
		_ref = ref(rtdb, `threads/${convId}/${parentId}/messages`);
		onChildAdded(_ref, (snap) => {
			const v = snap.val() || {};
			const uid = v.u ?? v.userId ?? '';
			const who = resolveUser?.(uid);
			addReply({
				id: snap.key,
				userId: uid,
				userName: who?.name ?? v.userName ?? 'Unknown',
				userRole: who?.role ?? v.userRole ?? 'student',
				content: v.c ?? v.content ?? '',
				createdAt: pushIdToTimestamp(snap.key),
				attachment: v.att?.url ? { url: v.att.url, filename: v.att.name, mimetype: v.att.type, size: v.att.size } : null
			});
		});

		markRead();
		tick().then(() => { if (panelEl) mountStaticEmotes(panelEl); });
	});

	onDestroy(() => {
		if (_ref) off(_ref);
		markRead(); // closing the panel = you've seen everything in it
	});

	// Same upload pipeline as the chat compose: R2 via /api/upload,
	// then the attachment descriptor rides on the reply.
	async function onFilePick(e) {
		const file = e.target?.files?.[0];
		if (fileEl) fileEl.value = '';
		if (!file) return;
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file, file.name);
			fd.append('contextType', convId.includes('_') ? 'dm' : 'channel');
			fd.append('contextId', convId);
			if (classId) fd.append('classId', classId);
			const res = await fetch('/api/upload', { method: 'POST', body: fd });
			if (res.ok) pendingAtt = await res.json();
		} catch { /* leave pendingAtt unset */ }
		uploading = false;
	}
	function removePendingAtt() {
		if (pendingAtt?.id) fetch(`/api/upload/${pendingAtt.id}`, { method: 'DELETE' }).catch(() => {});
		pendingAtt = null;
	}

	async function send() {
		const text = draft.trim();
		if ((!text && !pendingAtt) || !currentUser?.id) return;
		draft = '';
		// Server-side write (admin SDK) — RTDB rules keep message paths
		// read-only for clients, same as top-level sends via POST /api/chat.
		// The reply appears via our own onChildAdded subscription.
		const att = pendingAtt;
		pendingAtt = null;
		try {
			const res = await fetch('/api/chat/thread', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					convId, parentId, content: text,
					attachment: att ? { url: att.url, filename: att.filename, mimetype: att.mimetype, size: att.size } : null
				})
			});
			if (!res.ok) { draft = text; pendingAtt = att; } // restore so nothing is lost
		} catch {
			draft = text; pendingAtt = att;
		}
	}

	// Enter sends (Shift+Enter = newline) — captured on the compose wrapper
	// since FormattedInput owns its contenteditable internally.
	function onComposeKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey && e.target?.closest?.('.fi-ce')) {
			e.preventDefault();
			e.stopPropagation();
			send();
		}
	}

	function fmtTime(ts) {
		return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}
</script>

<!-- |global: transitions are LOCAL by default, and the {#key} wrapper the
     pages use for thread-switch remounts made the mount belong to an outer
     block — silently skipping the intro. Global plays it on every mount. -->
<aside class="thread-panel" bind:this={panelEl} aria-label="Thread" transition:fly|global={{ x: 420, duration: 260, easing: cubicOut }}>
	<header class="thread-head">
		<span class="thread-title">Thread</span>
		<button class="thread-close" onclick={onClose} title="Close thread" aria-label="Close thread">✕</button>
	</header>

	<div class="thread-scroll" bind:this={listEl}>
		<div class="thread-parent">
			<div class="thread-msg-meta"><b>{parentSnapshot.userName}</b><span class="thread-time">{fmtTime(parentSnapshot.createdAt)}</span></div>
			<!-- emoji/emote-only messages go jumbo, exactly like chat bubbles -->
			<div class="thread-msg-body" class:jumbo={jumboEmojiCountM(parentSnapshot.content) > 0} style:font-size={bubbleFontSize(parentSnapshot.content, 1)}>{@html contentHtml(parentSnapshot.content)}</div>
		</div>
		<div class="thread-count-rule">
			{#if loading}
				<span>Loading replies…</span>
			{:else}
				<span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
			{/if}
		</div>
		{#each replies as r (r.id)}
			<div class="thread-reply" class:mine={r.userId === currentUser?.id}>
				<div class="thread-msg-meta"><b>{r.userName}</b><span class="thread-time">{fmtTime(r.createdAt)}</span></div>
				{#if r.content}
					<div class="thread-msg-body" class:jumbo={jumboEmojiCountM(r.content) > 0} style:font-size={bubbleFontSize(r.content, 1)}>{@html contentHtml(r.content)}</div>
				{/if}
				{#if r.attachment}
					{#if r.attachment.mimetype?.startsWith('image/')}
						<a class="thread-att-img" href={r.attachment.url} target="_blank" rel="noreferrer">
							<img src={r.attachment.url} alt={r.attachment.filename || 'attachment'} loading="lazy" />
						</a>
					{:else}
						<a class="thread-att-file" href={r.attachment.url} target="_blank" rel="noreferrer">📎 {r.attachment.filename || 'file'}</a>
					{/if}
				{/if}
			</div>
		{/each}
		{#if !loading && !replies.length}
			<p class="thread-empty">No replies yet — start the thread.</p>
		{/if}
	</div>

	{#if pendingAtt}
		<div class="thread-pending-att">
			{#if pendingAtt.mimetype?.startsWith('image/')}<img src={pendingAtt.url} alt="" />{/if}
			<span class="tpa-name">{pendingAtt.filename}</span>
			<button class="tpa-x" onclick={removePendingAtt} title="Remove attachment">✕</button>
		</div>
	{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="thread-compose" onkeydowncapture={onComposeKeydown}>
		<input type="file" accept="image/*,video/*,audio/*,.pdf,.zip,.heic,.heif" style="display:none" bind:this={fileEl} onchange={onFilePick} />
		<button class="thread-attach" onclick={() => fileEl?.click()} disabled={uploading} title="Attach a file" aria-label="Attach a file">
			<span class="msi msi-20" class:msi-spin={uploading}>{uploading ? 'progress_activity' : 'attach_file'}</span>
		</button>
		<!-- Full rich compose — the same FormattedInput the assignment fields
		     use: bold/italic/colours, typographic sliders, text effects,
		     emoji / kitchen / emote / sticker pickers. Serialises to the
		     exact message markup regular chat stores, so replies render
		     identically everywhere. Enter sends; Shift+Enter for newline. -->
		<div class="thread-fi">
			<FormattedInput bind:value={draft} placeholder="Reply in thread…" />
		</div>
		<button class="thread-send" onclick={send} disabled={!draft.trim() && !pendingAtt} title="Send reply">
			<span class="msi msi-20">send</span>
		</button>
	</div>
</aside>

<ExpressionTip root={panelEl} />

<style>
	.thread-panel {
		position: fixed;
		top: 0; right: 0; bottom: 0;
		width: min(400px, 100vw);
		display: flex; flex-direction: column;
		background: var(--paper);
		border-left: 1.5px solid var(--border);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
		z-index: 300;
	}
	.thread-head {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.thread-title { font-weight: 700; font-size: 0.95rem; color: var(--ink); }
	.thread-close {
		background: none; border: none; cursor: pointer;
		color: var(--muted-fg); font-size: 0.95rem; line-height: 1; padding: 0.25rem 0.4rem;
	}
	.thread-close:hover { color: var(--ink); }
	.thread-scroll { flex: 1; overflow-y: auto; padding: 0.85rem 1rem; min-height: 0; }
	.thread-parent {
		padding-bottom: 0.75rem;
	}
	.thread-count-rule {
		display: flex; align-items: center; gap: 0.6rem;
		font-size: 0.72rem; font-weight: 600; color: var(--muted-fg);
		margin-bottom: 0.75rem;
	}
	.thread-count-rule::after {
		content: ''; flex: 1; height: 1px; background: var(--border);
	}
	.thread-reply { margin-bottom: 0.7rem; }
	.thread-msg-meta {
		display: flex; align-items: baseline; gap: 0.45rem;
		font-size: 0.78rem; color: var(--ink); margin-bottom: 0.1rem;
	}
	.thread-time { font-size: 0.66rem; color: var(--muted-fg); }
	.thread-msg-body {
		/* Same stack as chat bubbles — Google Sans Flex carries a REAL
		   italic; the inherited Space Grotesk faux-obliqued it. */
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		font-optical-sizing: auto;
		font-size: 0.9rem; line-height: 1.45; color: var(--ink);
		word-break: break-word; white-space: pre-wrap;
	}
	.thread-empty { color: var(--muted-fg); font-size: 0.82rem; text-align: center; padding: 1rem 0; }
	.thread-compose {
		display: flex; align-items: flex-end; gap: 0.4rem;
		padding: 0.6rem 0.75rem;
		border-top: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.thread-fi { flex: 1; min-width: 0; }
	.thread-attach {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; flex-shrink: 0;
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); color: var(--muted-fg); cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
	}
	.thread-attach:hover:not(:disabled) { color: var(--ink); border-color: var(--ink); }
	.thread-attach:disabled { opacity: 0.6; cursor: default; }
	:global(.msi-spin) { animation: thread-spin 0.9s linear infinite; display: inline-block; }
	@keyframes thread-spin { to { transform: rotate(360deg); } }
	.thread-pending-att {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		border-top: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		font-size: 0.78rem; color: var(--ink);
	}
	.thread-pending-att img { width: 34px; height: 34px; object-fit: cover; border-radius: 7px; }
	.tpa-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.tpa-x { background: none; border: none; color: var(--muted-fg); cursor: pointer; font-size: 0.8rem; padding: 0.2rem; }
	.tpa-x:hover { color: var(--ink); }
	.thread-att-img { display: block; margin-top: 0.25rem; max-width: 260px; }
	.thread-att-img img { max-width: 100%; border-radius: 10px; border: 1.5px solid var(--border); display: block; }
	.thread-att-file {
		display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.25rem;
		padding: 0.3rem 0.6rem; border: 1.5px solid var(--border); border-radius: 8px;
		font-size: 0.8rem; color: var(--ink); text-decoration: none; background: var(--surface-2);
	}
	.thread-att-file:hover { border-color: var(--ink); }
	/* jumbo (emoji-only) messages keep their glyph scale like chat bubbles */
	.thread-msg-body.jumbo { line-height: 1.2; }
	.thread-send {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; flex-shrink: 0;
		border: none; border-radius: 10px;
		background: var(--ink); color: var(--paper);
		cursor: pointer;
	}
	.thread-send:disabled { opacity: 0.35; cursor: default; }

	@media (max-width: 640px) {
		.thread-panel { width: 100vw; border-left: none; }
	}
</style>
