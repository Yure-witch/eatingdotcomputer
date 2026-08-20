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
	import { ref, onChildAdded, onValue, off, set } from 'firebase/database';
	import { createContentRenderer, jumboEmojiCountM, bubbleFontSize } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import { getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import FormattedInput from './FormattedInput.svelte';
	// ── Swipe back to the parent conversation ───────────────────────────
	// A thread sits on top of a conversation, so a rightward swipe means "back
	// to the parent" — the same gesture the conversation itself uses to go back
	// to the chat list, one level in. The app shell's exit gesture explicitly
	// stands down over `.thread-panel` so the two can't both fire.
	const TP_COMMIT_PX = 30;   // matches the chat exit: intent, in pixels
	const TP_EXIT_MS = 190;
	let _tpArmed = false, _tpDecided = false;
	let _tpStartX = 0, _tpStartY = 0, _tpLastDx = 0;
	let _tpVelX = 0, _tpPrevX = 0, _tpPrevT = 0;
	let _tpSwiping = $state(false);   // we're driving the transform
	let _tpDragging = $state(false);  // finger down — no transition
	// Set before onClose() so the fly-out runs at zero duration: the panel is
	// already off-screen under its own power, and letting the transition start
	// from x=0 would snap it back into view first.
	let _tpClosing = $state(false);
	let _tpExitT;
	function _tpSet(px) {
		if (panelEl) panelEl.style.transform = px ? `translate3d(${px}px, 0, 0)` : '';
	}
	function tpTouchStart(e) {
		if (window.innerWidth > 640) { _tpArmed = false; return; }
		// The compose and its pickers keep their own horizontal gestures.
		if (e.target?.closest?.('.thread-compose, .expr-panel, .picker-popover, .compose-picker-pop, input[type="range"]')) { _tpArmed = false; return; }
		const t = e.changedTouches?.[0] ?? e.touches?.[0];
		if (!t) { _tpArmed = false; return; }
		clearTimeout(_tpExitT);
		_tpStartX = t.clientX; _tpStartY = t.clientY;
		_tpPrevX = t.clientX; _tpPrevT = e.timeStamp; _tpVelX = 0; _tpLastDx = 0;
		_tpArmed = true; _tpDecided = false;
	}
	function tpTouchMove(e) {
		if (!_tpArmed || _tpClosing) return;
		const t = e.touches?.[0]; if (!t) return;
		const dx = t.clientX - _tpStartX, dy = t.clientY - _tpStartY;
		_tpLastDx = dx;
		const dt = e.timeStamp - _tpPrevT;
		if (dt > 0) _tpVelX = (t.clientX - _tpPrevX) / dt;
		_tpPrevX = t.clientX; _tpPrevT = e.timeStamp;
		if (!_tpDecided) {
			if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
			// Vertical belongs to the reply list; leftward has nowhere to go.
			if (Math.abs(dy) >= Math.abs(dx) || dx < 0) { _tpArmed = false; return; }
			_tpDecided = true;
			_tpSwiping = true; _tpDragging = true;
		}
		_tpSet(Math.max(0, dx));
	}
	function tpTouchEnd() {
		if (!_tpArmed) return;
		_tpArmed = false;
		if (!_tpDecided) return;
		_tpDragging = false; // let it animate to wherever it's going
		if (_tpLastDx >= TP_COMMIT_PX || _tpVelX > 0.4) {
			_tpClosing = true;
			if (panelEl) panelEl.style.transform = 'translate3d(100%, 0, 0)';
			_tpExitT = setTimeout(() => onClose?.(), TP_EXIT_MS);
			return;
		}
		_tpSet(0); // not far enough — settle back against the edge
		_tpExitT = setTimeout(() => { _tpSwiping = false; }, TP_EXIT_MS + 20);
	}
	import ExpressionTip from './ExpressionTip.svelte';
	import MessageAttachment from './MessageAttachment.svelte';
	import ExpressionPicker from './ExpressionPicker.svelte';
	import { decodeReactionKey } from '$lib/reaction-key.js';
	import { positionReactionTooltip } from '$lib/reaction-tooltip.js';
	import { wrapEmojiInText } from '$lib/emoji-tip.js';

	let {
		convId,               // channel id or DM conversation id
		parent,               // { id, userName, content, createdAt }
		currentUser,          // { id, name, role }
		resolveUser = null,   // (uid) => { name, role } for live compact msgs
		onClose = null,
		onCountChange = null, // (parentId, totalCount) → parent page updates its chip
		classId = null,       // for /api/upload bookkeeping
		chatName = '',        // "# general" / the DM partner — shown in the header
		userMap = {}          // uid → { name } for reaction tooltips
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
				for (const m of data.messages || []) {
					if (m.reactions) _archivedRx[m.id] = m.reactions;
					addReply(m);
				}
				if (Object.keys(_archivedRx).length) reactions = { ..._archivedRx, ...reactions };
			}
		} catch { /* live-only fallback */ }
		loading = false;

		// 2) live replies from Firebase
		_ref = ref(rtdb, `threads/${convId}/${parentId}/messages`);
		watchReactions();
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
		_rxUnsub?.();
		clearTimeout(_tpExitT);
		markRead(); // closing the panel = you've seen everything in it
	});

	// Same upload pipeline as the chat compose: R2 via /api/upload,
	// then the attachment descriptor rides on the reply.
	async function uploadAtt(file) {
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
	async function onFilePick(e) {
		const file = e.target?.files?.[0];
		if (fileEl) fileEl.value = '';
		await uploadAtt(file);
	}

	// Drag-and-drop upload onto the thread panel.
	let dragActive = $state(false);
	let _dragDepth = 0;
	const _dragHasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
	function onDragEnter(e) { if (!_dragHasFiles(e)) return; e.preventDefault(); _dragDepth++; dragActive = true; }
	function onDragOver(e) { if (_dragHasFiles(e)) e.preventDefault(); }
	function onDragLeave(e) { if (!_dragHasFiles(e)) return; _dragDepth = Math.max(0, _dragDepth - 1); if (!_dragDepth) dragActive = false; }
	function onDrop(e) {
		_dragDepth = 0; dragActive = false;
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		e.preventDefault();
		uploadAtt(file);
	}
	function removePendingAtt() {
		if (pendingAtt?.id) fetch(`/api/upload/${pendingAtt.id}`, { method: 'DELETE' }).catch(() => {});
		pendingAtt = null;
	}

	// ── Reactions ───────────────────────────────────────────────────────
	// Same contract as chat: live state at threads/{convId}/{parentId}/reactions
	// as { [messageId]: { [encodedEmoji]: { [uid]: true } } }, written only by
	// the server (RTDB rules keep these paths client-read-only), and archived
	// replies bring theirs back from Turso in the GET above. Merged here so a
	// reply's chips look the same either side of the 24h line.
	let reactions = $state({});
	let _rxUnsub = null;
	function watchReactions() {
		const r = ref(rtdb, `threads/${convId}/${parentId}/reactions`);
		_rxUnsub = onValue(r, (snap) => {
			const live = snap.val() ?? {};
			// Live wins per-message: it's the same data, just fresher.
			reactions = { ..._archivedRx, ...live };
		});
	}
	let _archivedRx = {};
	// Reaction KEYS are Firebase-escaped; the raw token is what renders and what
	// the API expects back.
	const rxEntries = (msgId) => Object.entries(reactions[msgId] ?? {})
		.map(([k, users]) => [decodeReactionKey(k), users])
		.filter(([, users]) => Object.keys(users ?? {}).length > 0);

	let pickerMsgId = $state(null);
	let pickerPos = $state({ x: 0, y: 0 });
	function openPicker(msgId, e) {
		if (pickerMsgId === msgId) { pickerMsgId = null; return; }
		const rect = e.currentTarget.getBoundingClientRect();
		const pw = 264, ph = 192;
		let x = rect.left;
		let y = rect.top - ph - 8;
		if (x + pw > window.innerWidth - 8) x = window.innerWidth - pw - 8;
		if (y < 8) y = rect.bottom + 8;
		pickerPos = { x, y };
		pickerMsgId = msgId;
	}
	async function toggleReaction(msgId, emoji) {
		if (!msgId || !emoji) return;
		await fetch('/api/chat/react', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, emoji, conversationId: convId, type: 'thread', parentId })
		}).catch(() => {});
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
{#snippet reactionRow(msgId)}
	<div class="thread-rx">
		{#each rxEntries(msgId) as [emoji, users] (emoji)}
			{@const mine = currentUser?.id in (users ?? {})}
			<button class="reaction-chip thread-rx-chip" class:reacted={mine}
				onclick={() => toggleReaction(msgId, emoji)}
				onmouseenter={positionReactionTooltip}
				onfocus={positionReactionTooltip}>
				<span class="thread-rx-emoji">{@html contentHtml(emoji)}</span>
				<span class="thread-rx-count">{Object.keys(users).length}</span>
				<div class="reaction-tooltip">
					<span class="reaction-tooltip-emoji">{@html contentHtml(emoji)}</span>
					<div class="reaction-tooltip-text">
						<span class="reaction-tooltip-names">{Object.keys(users).map((uid) => userMap[uid]?.name ?? 'Someone').join(', ')}</span>
						<span class="reaction-tooltip-label">reacted</span>
					</div>
				</div>
			</button>
		{/each}
		<button class="thread-rx-add" onclick={(e) => openPicker(msgId, e)} title="Add reaction" aria-label="Add reaction">
			<span class="msi msi-18">add_reaction</span>
		</button>
	</div>
{/snippet}

<aside class="thread-panel" class:tp-swiping={_tpSwiping} class:tp-dragging={_tpDragging} bind:this={panelEl} aria-label="Thread" transition:fly|global={{ x: 420, duration: _tpClosing ? 0 : 260, easing: cubicOut }} ontouchstart={tpTouchStart} ontouchmove={tpTouchMove} ontouchend={tpTouchEnd} ontouchcancel={tpTouchEnd} ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
	{#if dragActive}
		<div class="thread-drop" aria-hidden="true">
			<div class="thread-drop-card">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="12 3 12 15"/><polyline points="7 8 12 3 17 8"/></svg>
				<span>Drop to send</span>
			</div>
		</div>
	{/if}
	<header class="thread-head">
		<!-- Back, not close: a thread sits on top of its conversation, and the
		     arrow says which way out — matching the swipe that does the same. -->
		<button class="thread-back" onclick={onClose} title="Back to the conversation" aria-label="Back to the conversation">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
		</button>
		<span class="thread-title">
			Thread{#if chatName}<span class="thread-title-in"> in </span><span class="thread-title-chat">{chatName}</span>{/if}
		</span>
	</header>

	<div class="thread-scroll" bind:this={listEl}>
		<div class="thread-parent">
			<div class="thread-msg-meta"><b>{parentSnapshot.userName}</b><span class="thread-time">{fmtTime(parentSnapshot.createdAt)}</span></div>
			<!-- emoji/emote-only messages go jumbo, exactly like chat bubbles -->
			{#if parentSnapshot.content}
				<div class="thread-msg-body" class:jumbo={jumboEmojiCountM(parentSnapshot.content) > 0} style:font-size={bubbleFontSize(parentSnapshot.content, 1)}>{@html contentHtml(parentSnapshot.content)}</div>
			{/if}
			{#if parentSnapshot.attachment}
				<div class="thread-att"><MessageAttachment attachment={parentSnapshot.attachment} /></div>
			{/if}
			{@render reactionRow(parentSnapshot.id)}
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
					<div class="thread-att"><MessageAttachment attachment={r.attachment} mine={r.userId === currentUser?.id} /></div>
				{/if}
				{@render reactionRow(r.id)}
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

{#if pickerMsgId}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="thread-picker-overlay" onclick={() => (pickerMsgId = null)}></div>
	<div class="thread-picker-pop" style:left="{pickerPos.x}px" style:top="{pickerPos.y}px">
		<!-- The same inline picker chat's reaction popover uses, so threads get
		     the identical four tabs (Emoji / Kitchen / Emotes / Animated). -->
		<ExpressionPicker
			inline
			isInstructor={currentUser?.role === 'instructor'}
			onClose={() => (pickerMsgId = null)}
			onSelectEmoji={(emoji) => { toggleReaction(pickerMsgId, emoji); pickerMsgId = null; }}
			onInsertKitchen={(token) => { toggleReaction(pickerMsgId, token); pickerMsgId = null; }}
			onInsertCustomEmoji={(emoji) => { toggleReaction(pickerMsgId, `[ce:${emoji.shortcode}]`); pickerMsgId = null; }}
			onInsertTgEmoji={(it) => { toggleReaction(pickerMsgId, it.token ?? `[tg:${it.id}]`); pickerMsgId = null; }}
		/>
	</div>
{/if}

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
	/* Only while WE are driving the transform — never during the fly, which
	   writes transform itself and would smear against a CSS transition. */
	.thread-panel.tp-swiping { transition: transform 0.19s cubic-bezier(0.33, 1, 0.68, 1); }
	.thread-panel.tp-swiping.tp-dragging { transition: none; }
	.thread-head {
		display: flex; align-items: center; justify-content: flex-start; gap: 0.1rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.thread-title {
		font-weight: 700; font-size: 0.95rem; color: var(--ink);
		min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	/* "in" stays quiet so the chat's name is what you actually read. */
	.thread-title-in { font-weight: 400; color: var(--muted-fg); }
	.thread-title-chat { font-weight: 700; }
	.thread-back {
		display: flex; align-items: center; justify-content: center;
		width: 34px; height: 34px; flex-shrink: 0; margin-right: 0.15rem;
		background: none; border: none; border-radius: 999px;
		color: var(--ink); cursor: pointer;
	}
	.thread-back:hover { background: var(--surface-2); }

	/* ── Reactions ── */
	.thread-rx { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; margin-top: 0.3rem; }
	.thread-rx-chip {
		display: inline-flex; align-items: center; gap: 0.25rem;
		padding: 0.1rem 0.45rem;
		border: 1.5px solid var(--border); border-radius: 999px;
		background: var(--paper); color: var(--ink);
		font: inherit; font-size: 0.75rem; cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.thread-rx-chip:hover { background: var(--surface-2); }
	/* Same hover card as chat — positioned by the shared clamp so it can't run
	   off either edge, which a 400px panel makes very easy. */
	.thread-rx-chip { position: relative; }
	.reaction-tooltip {
		display: none;
		position: absolute;
		top: calc(100% + 6px);
		left: 50%; transform: translateX(-50%);
		min-width: max-content;
		background: var(--paper); color: var(--ink);
		border: 1.5px solid var(--border);
		border-radius: 10px; padding: 0.5rem 0.75rem;
		font-size: 0.78rem; white-space: nowrap;
		z-index: 30; pointer-events: none;
		flex-direction: row; align-items: center; gap: 0.55rem;
		box-shadow: 0 4px 18px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		text-align: left;
	}
	.thread-rx-chip:hover .reaction-tooltip,
	.thread-rx-chip:focus-visible .reaction-tooltip { display: flex; }
	.reaction-tooltip-emoji { display: inline-flex; align-items: center; font-size: 1.1rem; }
	.reaction-tooltip-text { display: flex; flex-direction: column; }
	.reaction-tooltip-names { font-weight: 700; }
	.reaction-tooltip-label { color: var(--muted-fg); }
	.thread-rx-chip.reacted { border-color: var(--md-sys-color-primary, var(--accent)); background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 12%, transparent); }
	.thread-rx-emoji { display: inline-flex; align-items: center; line-height: 1; }
	.thread-rx-count { font-weight: 700; font-variant-numeric: tabular-nums; }
	/* Hidden until the message it belongs to is hovered — and on iOS a tap
	   produces that hover state, which is exactly how chat's message action bar
	   behaves. No touch special-case: a row of permanently visible buttons down
	   a thread is clutter, and this way threads and chat are the same gesture.
	   pointer-events follows opacity so an invisible button can't eat the tap
	   that's meant to reveal it. */
	.thread-rx-add {
		display: inline-flex; align-items: center; justify-content: center;
		width: 24px; height: 24px; padding: 0;
		border: none; border-radius: 999px;
		background: none; color: var(--muted-fg); cursor: pointer;
		opacity: 0; pointer-events: none;
		transition: opacity 0.1s, color 0.12s;
	}
	.thread-reply:hover .thread-rx-add,
	.thread-parent:hover .thread-rx-add,
	.thread-rx-add:focus-visible { opacity: 1; pointer-events: auto; }
	.thread-rx-add:hover { color: var(--ink); background: var(--surface-2); }
	.thread-picker-overlay { position: fixed; inset: 0; z-index: 340; }
	.thread-picker-pop { position: fixed; z-index: 341; }
	@media (max-width: 640px) {
		/* Dock it as a bottom sheet, like the chat reaction picker. */
		.thread-picker-pop {
			left: 0 !important; right: 0;
			top: auto !important; bottom: 0;
			height: calc(min(58vh, 22rem) + env(safe-area-inset-bottom, 0px));
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}
		.thread-picker-overlay { background: rgba(0,0,0,0.45); }
	}
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
	/* Matches the chat input bar: same paper ground, same generous padding, no
	   dividing rule — a thread composes the same way a conversation does, so it
	   shouldn't read as a different kind of surface. */
	.thread-compose {
		display: flex; align-items: flex-end; gap: 0.5rem;
		padding: 0.75rem 1rem 1rem;
		/* Clear the home indicator — the panel runs to bottom:0. */
		padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		background: var(--paper);
		flex-shrink: 0;
	}
	/* The compose box carries the border, exactly like .compose-wrap in chat,
	   rather than the bar around it. */
	.thread-fi {
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); transition: border-color 0.15s;
	}
	.thread-fi:focus-within { border-color: var(--md-sys-color-primary, var(--ink)); }
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
	.thread-att { margin-top: 0.25rem; }
	.thread-drop {
		position: absolute; inset: 0; z-index: 5; pointer-events: none;
		display: flex; align-items: center; justify-content: center;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		backdrop-filter: blur(1.5px);
	}
	.thread-drop-card {
		display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
		padding: 1.2rem 1.8rem; border-radius: 16px;
		border: 2px dashed var(--accent); background: var(--paper); color: var(--accent);
		font-weight: 700; font-size: 0.9rem;
	}
	.thread-drop-card svg { width: 30px; height: 30px; }
	/* jumbo (emoji-only) messages keep their glyph scale like chat bubbles */
	.thread-msg-body.jumbo { line-height: 1.2; }
	.thread-send {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; flex-shrink: 0;
		border: none; border-radius: 10px;
		/* Themed rather than flat ink, matching chat's send button: it's the one
		   true action in the bar, so it carries the scheme's primary colour. */
		background: var(--md-sys-color-primary, var(--ink));
		color: var(--md-sys-color-on-primary, var(--paper));
		cursor: pointer;
	}
	.thread-send:disabled { opacity: 0.35; cursor: default; }

	@media (max-width: 640px) {
		/* left/right rather than 100vw: the viewport unit counts the scrollbar and
		   overflows the page by its width. */
		.thread-panel { left: 0; right: 0; width: auto; border-left: none; }
		/* The panel covers the app header, so it owns the notch itself. */
		.thread-head { padding-top: calc(0.7rem + var(--native-top-inset, 0px)); }
	}
</style>
