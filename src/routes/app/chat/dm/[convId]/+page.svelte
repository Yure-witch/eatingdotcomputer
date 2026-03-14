<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { db } from '$lib/firebase.js';
	import { ref, onChildAdded, onValue, off, query, limitToLast, set, remove } from 'firebase/database';
	import { normaliseMessage, buildUserMap, formatTime } from '$lib/chat.js';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';

	let { data } = $props();

	const otherUserId = data.convId.replace(data.currentUser.id, '').replace(/^_|_$/, '');
	const otherUser = data.users.find((u) => u.id === otherUserId) ?? { name: 'Unknown', id: otherUserId };

	const userMap = buildUserMap(data.currentUser, data.users);

	let messages = $state([...data.history]);
	let input = $state('');
	let sending = $state(false);
	let uploading = $state(false);
	let listEl = $state(null);
	let inputEl = $state(null);
	let fileInputEl = $state(null);
	let typingUsers = $state([]);
	let keyboardOpen = $state(false);
	let inputAreaHeight = $state(0);

	// Replies
	let replyingTo = $state(null);

	// Pending attachment (preview before send)
	let pendingAttachment = $state(null);

	// Reactions: { [msgId]: { [emoji]: { [userId]: true } } }
	// Seeded from Turso (archived messages) on page load; Firebase onValue merges live reactions on top
	let reactions = $state({ ...(data.initialReactions ?? {}) });

	// Emoji picker
	let pickerMsgId = $state(null);
	let pickerPos = $state({ x: 0, y: 0 });

	let firebaseRef, typingRef, reactionsRef;
	let typingTimer;

	let userScrolledUp = false;

	function scrollToBottom() {
		tick().then(() => {
			if (!listEl) return;
			listEl.scrollTop = listEl.scrollHeight;
			userScrolledUp = false;
		});
	}

	// Called from image onload — scrolls only if user hasn't manually scrolled up
	function scrollIfNearBottom() {
		if (!userScrolledUp && listEl) listEl.scrollTop = listEl.scrollHeight;
	}

	function onListScroll() {
		if (!listEl) return;
		const dist = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
		userScrolledUp = dist > 80;
	}

	function scrollToMessage(id) {
		const el = listEl?.querySelector(`[data-msg-id="${id}"]`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function markRead() {
		set(ref(db, `lastRead/${data.currentUser.id}/${data.convId}`), Date.now());
	}

	function clearTyping() {
		clearTimeout(typingTimer);
		remove(ref(db, `typing/${data.convId}/${data.currentUser.id}`));
	}

	function startReply(msg) {
		replyingTo = { id: msg.id, userId: msg.userId, userName: msg.userName, content: msg.content };
		inputEl?.focus();
	}

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
		const uid = data.currentUser.id;
		const alreadyReacted = !!reactions[msgId]?.[emoji]?.[uid];

		// Optimistic local update so chips appear immediately
		const curMsg = reactions[msgId] ?? {};
		const curEmoji = curMsg[emoji] ?? {};
		const newEmoji = alreadyReacted
			? Object.fromEntries(Object.entries(curEmoji).filter(([k]) => k !== uid))
			: { ...curEmoji, [uid]: true };
		reactions = { ...reactions, [msgId]: { ...curMsg, [emoji]: newEmoji } };

		// Always route through the server API — uses firebase-admin which bypasses security rules
		await fetch('/api/chat/react', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, emoji, conversationId: data.convId })
		});
	}

	onMount(() => {
		markRead();
		scrollToBottom();

		firebaseRef = query(ref(db, `dms/${data.convId}/messages`), limitToLast(200));
		onChildAdded(firebaseRef, (snap) => {
			const msg = normaliseMessage(snap.key, snap.val(), userMap);
			if (!messages.find((m) => m.id === msg.id)) {
				messages = [...messages, msg];
				scrollToBottom();
				markRead();
			}
		});

		typingRef = ref(db, `typing/${data.convId}`);
		onValue(typingRef, (snap) => {
			if (!snap.exists()) { typingUsers = []; return; }
			const now = Date.now();
			typingUsers = Object.entries(snap.val())
				.filter(([uid, v]) => uid !== data.currentUser.id && (now - (v.ts ?? 0)) < 5000)
				.map(([, v]) => v.name);
		});

		reactionsRef = ref(db, `dms/${data.convId}/reactions`);
		onValue(reactionsRef, (snap) => {
			reactions = { ...(data.initialReactions ?? {}), ...(snap.exists() ? snap.val() : {}) };
		});
	});

	function cancelAttachment() {
		const att = pendingAttachment;
		if (!att) return;
		pendingAttachment = null;
		fetch(`/api/upload/${att.id}`, { method: 'DELETE' }).catch(() => {});
	}

	onDestroy(() => {
		if (firebaseRef) off(firebaseRef);
		if (typingRef) off(typingRef);
		if (reactionsRef) off(reactionsRef);
		clearTyping();
		cancelAttachment();
	});

	async function send() {
		const content = input.trim();
		const attSnap = pendingAttachment ? { ...pendingAttachment } : null;
		if (!content && !attSnap) return;
		if (sending) return;
		clearTyping();
		const replySnap = replyingTo ? { ...replyingTo } : null;
		const optimistic = {
			id: `opt-${Date.now()}`, userId: data.currentUser.id,
			userName: data.currentUser.name, userRole: data.currentUser.role,
			content: content || (attSnap ? attSnap.filename : ''), createdAt: Date.now(),
			pending: true, replyTo: replySnap, attachment: attSnap
		};
		messages = [...messages, optimistic];
		input = '';
		replyingTo = null;
		pendingAttachment = null;
		scrollToBottom();
		sending = true;
		try {
			await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content, to: otherUser.id, reply_to: replySnap, attachment: attSnap })
			});
			messages = messages.filter((m) => m.id !== optimistic.id);
		} catch {
			messages = messages.filter((m) => m.id !== optimistic.id);
			input = content;
			replyingTo = replySnap;
			pendingAttachment = attSnap;
		}
		sending = false;
		inputEl?.focus();
	}

	async function handleFileSelect(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = '';
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('contextType', 'dm');
			fd.append('contextId', data.convId);
			fd.append('classId', data.currentClass?.id ?? '');
			const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
			if (!uploadRes.ok) throw new Error(await uploadRes.text());
			pendingAttachment = await uploadRes.json();
			inputEl?.focus();
		} catch (err) {
			console.error('Upload failed', err);
		} finally {
			uploading = false;
		}
	}

	function formatSize(bytes) {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function onKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	}

	function onInput() {
		if (!input.trim()) { clearTyping(); return; }
		set(ref(db, `typing/${data.convId}/${data.currentUser.id}`), { name: data.currentUser.name, ts: Date.now() });
		clearTimeout(typingTimer);
		typingTimer = setTimeout(clearTyping, 4000);
	}
</script>

<svelte:head><title>DM: {otherUser.name} — eating.computer</title></svelte:head>

<div class="chat-header">
	<span class="avatar">{otherUser.name[0].toUpperCase()}</span>
	<h1>{otherUser.name}</h1>
	{#if otherUser.role === 'instructor'}<span class="badge">instructor</span>{/if}
</div>

<div class="message-list" bind:this={listEl} style:padding-bottom="{inputAreaHeight}px" onscroll={onListScroll}>
	{#if messages.length === 0}
		<p class="empty">Start your conversation with {otherUser.name}.</p>
	{/if}
	{#each messages as msg, i (msg.id)}
		{@const prev = messages[i - 1]}
		{@const isFirst = !prev || prev.userId !== msg.userId || msg.createdAt - prev.createdAt > 300000}
		{@const isMine = msg.userId === data.currentUser.id}
		{@const msgReactions = reactions[msg.id] ?? {}}
		{@const hasReactions = Object.values(msgReactions).some(u => Object.keys(u).length > 0)}
		<div class="message" class:mine={isMine} class:first={isFirst} data-msg-id={msg.id}>
			{#if isFirst}
				<div class="meta">
					<span class="name">{msg.userName}</span>
					<span class="time">{formatTime(msg.createdAt)}</span>
				</div>
			{/if}
			{#if msg.replyTo}
				<button class="reply-quote" onclick={() => scrollToMessage(msg.replyTo.id)}>
					<span class="reply-author">{msg.replyTo.userName}</span>
					<span class="reply-text">{msg.replyTo.content}</span>
				</button>
			{/if}
			<div class="bubble-row">
				{#if !msg.pending && !isMine}
					<div class="msg-actions">
						<button class="action-btn" onclick={(e) => openPicker(msg.id, e)} title="React">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
						</button>
						<button class="action-btn" onclick={() => startReply(msg)} title="Reply">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
						</button>
					</div>
				{/if}
				{#if msg.attachment}
					{#if msg.attachment.mimetype?.startsWith('image/')}
						<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-img" class:pending={msg.pending}>
							<img src={msg.attachment.url} alt={msg.attachment.filename} onload={scrollIfNearBottom} />
						</a>
					{:else}
						<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-file" class:pending={msg.pending} class:mine={isMine}>
							<FileTypeIcon filename={msg.attachment.filename} mimetype={msg.attachment.mimetype} iconSize={36} />
							<div class="att-info">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{formatSize(msg.attachment.size)}</span>
							</div>
						</a>
					{/if}
				{:else}
					<p class="bubble" class:pending={msg.pending}>{msg.content}</p>
				{/if}
				{#if !msg.pending && isMine}
					<div class="msg-actions">
						<button class="action-btn" onclick={(e) => openPicker(msg.id, e)} title="React">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
						</button>
						<button class="action-btn" onclick={() => startReply(msg)} title="Reply">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
						</button>
					</div>
				{/if}
			</div>
			{#if hasReactions}
				<div class="reactions">
					{#each Object.entries(msgReactions) as [emoji, users]}
						{@const count = Object.keys(users).length}
						{#if count > 0}
							<button class="reaction-chip" class:reacted={data.currentUser.id in users} onclick={() => toggleReaction(msg.id, emoji)}>
								{emoji} <span class="reaction-count">{count}</span>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

{#if pickerMsgId}
	<div class="picker-overlay" onclick={() => pickerMsgId = null} onkeydown={(e) => e.key === 'Escape' && (pickerMsgId = null)} role="presentation"></div>
	<div class="picker-popover" style:left="{pickerPos.x}px" style:top="{pickerPos.y}px">
		<EmojiPicker onSelect={(emoji) => { toggleReaction(pickerMsgId, emoji); pickerMsgId = null; }} />
	</div>
{/if}

<div class="input-area" class:kb-open={keyboardOpen} bind:clientHeight={inputAreaHeight}>
	{#if replyingTo}
		<div class="reply-bar">
			<div class="reply-bar-content">
				<span class="reply-bar-to">Replying to <strong>{replyingTo.userName}</strong></span>
				<span class="reply-bar-text">{replyingTo.content.slice(0, 80)}</span>
			</div>
			<button class="reply-bar-close" onclick={() => replyingTo = null}>×</button>
		</div>
	{/if}
	{#if pendingAttachment}
		<div class="reply-bar att-bar">
			{#if pendingAttachment.mimetype?.startsWith('image/')}
				<img class="att-bar-thumb" src={pendingAttachment.url} alt={pendingAttachment.filename} />
			{:else}
				<FileTypeIcon filename={pendingAttachment.filename} mimetype={pendingAttachment.mimetype} iconSize={32} />
			{/if}
			<div class="reply-bar-content">
				<span class="reply-bar-to">{pendingAttachment.filename}</span>
				<span class="reply-bar-text">{formatSize(pendingAttachment.size)}</span>
			</div>
			<button class="reply-bar-close" onclick={cancelAttachment}>×</button>
		</div>
	{/if}
	{#if typingUsers.length}
		<p class="typing-indicator">
			{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
		</p>
	{/if}
	<div class="input-bar">
		<label class="btn-attach" class:disabled={uploading || sending} title="Attach file">
			{#if uploading}
				<svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
			{:else}
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
			{/if}
			<input bind:this={fileInputEl} type="file" style="display:none" onchange={handleFileSelect} disabled={uploading || sending} />
		</label>
		<textarea bind:this={inputEl} bind:value={input} onkeydown={onKeydown} oninput={onInput} onfocus={() => keyboardOpen = true} onblur={() => keyboardOpen = false} placeholder="Message {otherUser.name}" rows="1" disabled={sending || uploading}></textarea>
		<button onclick={send} disabled={sending || uploading || (!input.trim() && !pendingAttachment)} class="btn-send">Send</button>
	</div>
</div>

<style>
	.chat-header {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 1rem 1.5rem 0.75rem; border-bottom: 1.5px solid #ddd7cc; flex-shrink: 0;
	}
	.chat-header h1 { font-family: 'Cambridge', serif; font-size: 1.25rem; font-weight: 400; margin: 0; }
	.avatar {
		width: 28px; height: 28px; border-radius: 7px; background: var(--ink); color: var(--paper);
		font-size: 0.8rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
	}
	.badge {
		font-size: 0.65rem; font-weight: 600; background: var(--ink); color: var(--paper);
		padding: 0.1rem 0.4rem; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.04em;
	}
	.message-list {
		flex: 1; overflow-y: auto; padding: 1rem 1.5rem;
		display: flex; flex-direction: column; gap: 0.15rem;
		scrollbar-width: none;
	}
	.message-list::-webkit-scrollbar { display: none; }
	.empty { color: #a09688; font-size: 0.9rem; text-align: center; margin: auto; }
	.message { display: flex; flex-direction: column; max-width: 75%; gap: 0.15rem; }
	.message.mine { align-self: flex-end; align-items: flex-end; }
	.message:not(.mine) { align-self: flex-start; align-items: flex-start; }
	.message.first { margin-top: 0.75rem; }
	.meta { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem; }
	.name { font-size: 0.78rem; font-weight: 600; color: var(--ink); }
	.time { font-size: 0.72rem; color: #a09688; }

	/* Reply quote */
	.reply-quote {
		display: flex; flex-direction: column; gap: 0.06rem;
		background: #f5f0e8; border-left: 3px solid #c8c1b4; border-radius: 0 6px 6px 0;
		padding: 0.28rem 0.6rem; margin-bottom: 0.1rem;
		cursor: pointer; max-width: 100%; overflow: hidden; text-align: left;
		border-top: none; border-right: 1px solid #e8e2d8; border-bottom: 1px solid #e8e2d8;
		font-family: inherit;
	}
	.reply-quote:hover { background: #ede8df; }
	.reply-author { font-size: 0.7rem; font-weight: 700; color: #4a4038; }
	.reply-text { font-size: 0.78rem; color: #6b5f54; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.message.mine .reply-quote { background: rgba(255,255,255,0.15); border-left-color: rgba(255,255,255,0.6); border-right-color: transparent; border-bottom-color: transparent; }
	.message.mine .reply-author { color: rgba(255,255,255,0.95); }
	.message.mine .reply-text { color: rgba(255,255,255,0.85); }

	/* Bubble row */
	.bubble-row { display: flex; align-items: flex-end; gap: 0.3rem; }
	.message.mine .bubble-row { flex-direction: row-reverse; }
	.msg-actions {
		display: flex; flex-direction: column; gap: 0.15rem;
		opacity: 0; transition: opacity 0.1s; flex-shrink: 0;
	}
	.message:hover .msg-actions { opacity: 1; }
	.action-btn {
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 6px;
		padding: 0.22rem 0.28rem; cursor: pointer; color: #a09688;
		display: flex; align-items: center; justify-content: center;
		transition: color 0.1s, border-color 0.1s;
	}
	.action-btn:hover { color: var(--ink); border-color: #b0a898; }

	.bubble {
		margin: 0; padding: 0.55rem 0.85rem; border-radius: 14px;
		font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		background: #fff; border: 1.5px solid #ddd7cc;
	}
	.message.mine .bubble { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.bubble.pending { opacity: 0.6; }

	.bubble-img {
		padding: 0; overflow: hidden; display: block; max-width: 260px; border-radius: 14px;
		text-decoration: none;
	}
	.bubble-img img {
		display: block; max-width: 260px; max-height: 320px;
		width: 100%; height: auto; object-fit: cover;
	}
	.bubble-file {
		display: flex; align-items: center; gap: 0.65rem;
		padding: 0.6rem 0.85rem; text-decoration: none; color: var(--ink);
		min-width: 0;
	}
	.bubble-file.mine { color: var(--paper); }
	.att-info { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
	.att-name { font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.att-size { font-size: 0.7rem; opacity: 0.6; }

	/* Reactions */
	.reactions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.2rem; }
	.reaction-chip {
		display: flex; align-items: center; gap: 0.22rem;
		background: #f5f0e8; border: 1.5px solid #ddd7cc; border-radius: 99px;
		padding: 0.12rem 0.5rem; font-size: 0.85rem; cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
	}
	.reaction-chip:hover { background: #ede8df; border-color: #c8c1b4; }
	.reaction-chip.reacted { background: #e8f0fe; border-color: #a0b8f0; }
	.reaction-count { font-size: 0.72rem; color: #555; font-weight: 600; }

	/* Emoji picker */
	.picker-overlay { position: fixed; inset: 0; z-index: 40; }
	.picker-popover {
		position: fixed; z-index: 41;
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0,0,0,0.12);
	}

	/* Reply bar */
	.reply-bar {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.4rem 1.5rem; border-top: 1px solid #ddd7cc; background: #faf8f5;
	}
	.reply-bar-content { flex: 1; display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
	.reply-bar-to { font-size: 0.72rem; color: #888; }
	.reply-bar-to strong { color: var(--ink); }
	.reply-bar-text { font-size: 0.78rem; color: #a09688; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.reply-bar-close {
		background: none; border: none; color: #a09688; font-size: 1.2rem;
		cursor: pointer; line-height: 1; padding: 0.1rem 0.35rem; border-radius: 4px; flex-shrink: 0;
	}
	.reply-bar-close:hover { color: var(--ink); background: #ede8df; }

	.att-bar { align-items: center; gap: 0.6rem; }
	.att-bar-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }

	.input-area { flex-shrink: 0; }
	.typing-indicator {
		font-size: 0.75rem; color: #a09688; padding: 0 1.5rem 0.25rem;
		margin: 0; min-height: 1.2rem;
	}
	.input-bar {
		display: flex; align-items: flex-end; gap: 0.5rem;
		padding: 0.75rem 1.5rem 1rem; border-top: 1.5px solid #ddd7cc;
	}
	textarea {
		flex: 1; padding: 0.6rem 0.85rem; border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; resize: none; field-sizing: content; max-height: 140px; transition: border-color 0.15s;
	}
	textarea:focus { border-color: var(--ink); }
	.btn-attach {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; flex-shrink: 0;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; color: #a09688; cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.btn-attach:hover { color: var(--ink); border-color: #b0a898; }
	.btn-attach.disabled { opacity: 0.4; pointer-events: none; }
	.spin { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.btn-send {
		padding: 0.6rem 1.1rem; background: var(--ink); color: var(--paper); border: none;
		border-radius: 10px; font-family: inherit; font-size: 0.875rem; font-weight: 600;
		cursor: pointer; transition: opacity 0.15s; flex-shrink: 0;
	}
	.btn-send:hover { opacity: 0.8; }
	.btn-send:disabled { opacity: 0.4; cursor: default; }

	@media (max-width: 640px) {
		.chat-header {
			position: fixed; top: 0; left: 0; right: 0;
			padding: 0.75rem 1rem 0.6rem; padding-left: 52px;
			background: var(--paper); z-index: 12;
		}
		.chat-header h1 { font-size: 1.1rem; }
		.message-list { padding: 0.75rem 0.875rem; padding-top: calc(0.75rem + 0.6rem + 1.54rem); }
		.message { max-width: 88%; }
		.msg-actions { opacity: 0.35; }
		.message:hover .msg-actions { opacity: 1; }
		.reply-bar { padding: 0.4rem 0.75rem; }
		.input-area {
			position: fixed; bottom: calc(56px + env(safe-area-inset-bottom, 0px)); left: 0; right: 0;
			background: var(--paper); z-index: 20;
		}
		.input-area.kb-open { bottom: 0; }
		.input-bar {
			padding: 0.5rem 0.75rem;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0.5rem));
			gap: 0.4rem;
		}
		.typing-indicator { padding: 0.2rem 0.875rem 0; }
		textarea { font-size: 1rem; }
	}
</style>
