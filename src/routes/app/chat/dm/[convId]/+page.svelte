<script>
	import { onMount, onDestroy, tick, getContext } from 'svelte';
	import { db } from '$lib/firebase.js';
	import { ref, onChildAdded, onValue, off, query, limitToLast, set, remove } from 'firebase/database';
	import { normaliseMessage, buildUserMap, formatTime } from '$lib/chat.js';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';

	let { data } = $props();

	const openSidebar = getContext('openSidebar');
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

	let kebabOpenId = $state(null);
	let editingMsgId = $state(null);
	let editContent = $state('');
	let starredIds = $state(new Set(data.starredMessageIds ?? []));

	function startEdit(msg) {
		editingMsgId = msg.id;
		editContent = msg.content;
	}

	async function saveEdit() {
		const msgId = editingMsgId;
		const content = editContent.trim();
		if (!content || !msgId) { editingMsgId = null; return; }
		editingMsgId = null;
		messages = messages.map((m) => m.id === msgId ? { ...m, content, edited: true } : m);
		await fetch('/api/chat/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, conversationId: data.convId, content })
		}).catch(() => {});
	}

	async function toggleStar(msg) {
		const wasStarred = starredIds.has(msg.id);
		starredIds = new Set(wasStarred
			? [...starredIds].filter((id) => id !== msg.id)
			: [...starredIds, msg.id]);
		await fetch('/api/chat/star', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messageId: msg.id,
				conversationId: data.convId,
				snapshot: { content: msg.content, authorName: msg.userName, authorId: msg.userId, attachment: msg.attachment ?? null, convName: null }
			})
		}).catch(() => {});
	}

	async function deleteMessage(msg) {
		messages = messages.filter((m) => m.id !== msg.id);
		await fetch('/api/chat/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msg.id, conversationId: data.convId, authorId: msg.userId })
		}).catch(() => {});
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
			const fbReactions = snap.exists() ? snap.val() : {};
			const base = data.initialReactions ?? {};
			// Deep merge per message: Turso base → current state (optimistic) → Firebase
			const merged = {};
			const allMsgIds = new Set([...Object.keys(base), ...Object.keys(reactions), ...Object.keys(fbReactions)]);
			for (const msgId of allMsgIds) {
				merged[msgId] = { ...(base[msgId] ?? {}), ...(reactions[msgId] ?? {}), ...(fbReactions[msgId] ?? {}) };
			}
			reactions = merged;
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
	<button class="sidebar-toggle" onclick={openSidebar} aria-label="Open menu">
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
	</button>
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
		<div class="message" class:mine={isMine} class:first={isFirst} class:starred={starredIds.has(msg.id)} data-msg-id={msg.id}>
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
				{#if msg.attachment}
					{#if msg.attachment.mimetype?.startsWith('image/')}
						<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-img" class:pending={msg.pending}>
							<img src={msg.attachment.url} alt={msg.attachment.filename} onload={scrollIfNearBottom} />
						</a>
					{:else if msg.attachment.mimetype?.startsWith('video/')}
						<div class="bubble bubble-video" class:pending={msg.pending}>
							<video src={msg.attachment.url} controls preload="metadata" class="att-video" onloadedmetadata={scrollIfNearBottom}></video>
							<div class="att-info att-info-video">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{formatSize(msg.attachment.size)}</span>
							</div>
						</div>
					{:else}
						<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-file" class:pending={msg.pending} class:mine={isMine}>
							<FileTypeIcon filename={msg.attachment.filename} mimetype={msg.attachment.mimetype} iconSize={36} />
							<div class="att-info">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{formatSize(msg.attachment.size)}</span>
							</div>
						</a>
					{/if}
				{:else if editingMsgId === msg.id}
					<div class="bubble edit-bubble" class:mine={isMine}>
						<textarea class="edit-textarea" bind:value={editContent} rows="2"
							onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') editingMsgId = null; }}
						></textarea>
						<div class="edit-controls">
							<button class="edit-cancel" onclick={() => editingMsgId = null}>Cancel</button>
							<button class="edit-save" onclick={saveEdit}>Save</button>
						</div>
					</div>
				{:else}
					<p class="bubble" class:pending={msg.pending}>{msg.content}{#if msg.edited}<span class="edited-tag"> (edited)</span>{/if}</p>
				{/if}
			</div>
			{#if starredIds.has(msg.id)}
				<div class="saved-label">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
					Saved
				</div>
			{/if}
			{#if hasReactions}
				<div class="reactions">
					{#each Object.entries(msgReactions) as [emoji, users]}
						{@const count = Object.keys(users).length}
						{#if count > 0}
							<button class="reaction-chip" class:reacted={data.currentUser.id in users} onclick={() => toggleReaction(msg.id, emoji)}>
								{emoji} <span class="reaction-count">{count}</span>
								<div class="reaction-tooltip">
									{#each Object.keys(users) as uid}
										<div>{userMap[uid]?.name ?? 'Someone'}</div>
									{/each}
								</div>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
			{#if !msg.pending}
				<div class="msg-actions">
					<button class="action-btn" onclick={(e) => openPicker(msg.id, e)} title="Add reaction">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
					</button>
					<button class="action-btn" onclick={() => startReply(msg)} title="Reply">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
					</button>
					<button class="action-btn" class:action-btn-starred={starredIds.has(msg.id)} onclick={() => toggleStar(msg)} title={starredIds.has(msg.id) ? 'Unstar' : 'Star message'}>
						{#if starredIds.has(msg.id)}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
						{/if}
					</button>
					<button class="action-btn" title="Add effect">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
					</button>
					{#if isMine}
						<button class="action-btn" onclick={() => startEdit(msg)} title="Edit message">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
						</button>
						<button class="action-btn action-btn-delete" onclick={() => { if (confirm('Delete this message?')) deleteMessage(msg); }} title="Delete">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
						</button>
					{:else if data.currentUser.role === 'instructor'}
						<div class="kebab-wrap">
							<button class="action-btn" onclick={() => kebabOpenId = kebabOpenId === msg.id ? null : msg.id} title="More">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
							</button>
							{#if kebabOpenId === msg.id}
								<div class="kebab-overlay" onclick={() => kebabOpenId = null} role="presentation"></div>
								<div class="kebab-menu">
									<button class="kebab-item kebab-item-delete" onclick={() => { kebabOpenId = null; if (confirm('Delete this message?')) deleteMessage(msg); }}>Delete</button>
								</div>
							{/if}
						</div>
					{/if}
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
	.chat-header h1 { font-family: 'Cambridge', serif; font-size: 1.25rem; font-weight: 400; margin: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.sidebar-toggle {
		display: none;
		background: none; border: none; color: var(--ink);
		cursor: pointer; padding: 0.3rem; border-radius: 6px;
		flex-shrink: 0; align-items: center; justify-content: center;
		-webkit-tap-highlight-color: transparent;
	}
	.sidebar-toggle:active { background: rgba(0,0,0,0.06); }
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
	.message { display: flex; flex-direction: column; max-width: 75%; gap: 0.15rem; position: relative; }
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

	/* Action toolbar — floats above message on hover, takes no vertical space */
	.msg-actions {
		position: absolute;
		top: 0; right: 0;
		z-index: 5;
		display: flex; flex-direction: row; gap: 0;
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 10px;
		padding: 0; overflow: hidden;
		box-shadow: 0 2px 10px rgba(0,0,0,0.1);
		opacity: 0; pointer-events: none;
		transition: opacity 0.12s;
	}
	.message:hover .msg-actions { opacity: 1; pointer-events: auto; }
	.action-btn {
		background: transparent; border: none; border-radius: 0;
		width: 40px; height: 40px; padding: 10px; cursor: pointer; color: #a09688;
		display: flex; align-items: center; justify-content: center;
		transition: color 0.1s, background 0.1s;
		flex-shrink: 0;
	}
	.action-btn:hover { color: var(--ink); background: rgba(0,0,0,0.06); }
	.action-btn-delete:hover { color: #c0392b; background: rgba(192,57,43,0.08); }
	.action-btn-starred { color: #e6a817; }
	.action-btn-starred:hover { color: #c8900f; background: rgba(230,168,23,0.1); }

	/* Edit mode */
	.edit-bubble { padding: 0.4rem !important; min-width: 220px; background: #fff !important; border: 1.5px solid var(--ink) !important; }
	.edit-textarea {
		width: 100%; min-height: 56px; padding: 0.4rem 0.5rem;
		border: none; background: transparent; font-family: inherit;
		font-size: 0.9rem; color: var(--ink); resize: vertical;
		outline: none; display: block; field-sizing: content;
	}
	.edit-controls { display: flex; gap: 0.25rem; justify-content: flex-end; margin-top: 0.25rem; }
	.edit-cancel {
		padding: 0.25rem 0.65rem; background: none; border: none;
		font-family: inherit; font-size: 0.78rem; color: #a09688; cursor: pointer; border-radius: 5px;
	}
	.edit-cancel:hover { background: #f0ece4; color: var(--ink); }
	.edit-save {
		padding: 0.25rem 0.65rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 5px; font-family: inherit; font-size: 0.78rem;
		font-weight: 600; cursor: pointer;
	}
	.edit-save:hover { opacity: 0.8; }
	.edited-tag { font-size: 0.68rem; opacity: 0.5; font-style: italic; }

	.kebab-wrap { position: relative; }
	.kebab-overlay { position: fixed; inset: 0; z-index: 20; }
	.kebab-menu {
		position: absolute; top: calc(100% + 4px); right: 0; z-index: 21;
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 110px; overflow: hidden;
	}
	.kebab-item {
		display: block; width: 100%; text-align: left;
		padding: 0.5rem 0.85rem; font-family: inherit; font-size: 0.82rem;
		background: none; border: none; cursor: pointer; color: var(--ink);
		transition: background 0.1s;
	}
	.kebab-item:hover { background: #f5f0e8; }
	.kebab-item-delete { color: #c0392b; }
	.kebab-item-delete:hover { background: #fff0f0; }


	.bubble {
		margin: 0; padding: 0.55rem 0.85rem; border-radius: 14px;
		font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		background: #fff; border: 1.5px solid #ddd7cc;
	}
	.message.mine .bubble { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.message.starred:not(.mine) .bubble { background: #fff8e6; border-color: #e6cc70; }
	.message.starred.mine .bubble { border-color: #c8900f; }
	.bubble.pending { opacity: 0.6; }

	.saved-label {
		display: flex; align-items: center; gap: 0.2rem;
		font-size: 0.62rem; font-weight: 600; color: #c8900f;
		padding: 0.1rem 0.5rem; letter-spacing: 0.02em;
	}
	.message.mine .saved-label { justify-content: flex-end; }

	.bubble-img {
		padding: 0; overflow: hidden; display: block; max-width: 260px; border-radius: 14px;
		text-decoration: none; background: transparent !important; border-color: transparent !important;
	}
	.bubble-img img {
		display: block; max-width: 260px; max-height: 320px;
		width: 100%; height: auto; object-fit: cover;
	}
	.bubble-video {
		padding: 0.5rem; max-width: 320px; display: block;
	}
	.att-video {
		display: block; width: 100%; max-height: 400px;
		border-radius: 8px; background: #000;
	}
	.att-info-video { padding: 0.1rem 0.35rem 0; }
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
		position: relative;
		display: flex; align-items: center; gap: 0.22rem;
		background: #f5f0e8; border: 1.5px solid #ddd7cc; border-radius: 99px;
		padding: 0.12rem 0.5rem; font-size: 0.85rem; cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
	}
	.reaction-chip:hover { background: #ede8df; border-color: #c8c1b4; }
	.reaction-chip.reacted { background: #e8f0fe; border-color: #a0b8f0; }
	.reaction-count { font-size: 0.72rem; color: #555; font-weight: 600; }
	.reaction-tooltip {
		display: none;
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%; transform: translateX(-50%);
		background: #1a1a1a; color: #f7f2ea;
		border-radius: 7px; padding: 0.35rem 0.65rem;
		font-size: 0.72rem; white-space: nowrap;
		z-index: 30; pointer-events: none;
		flex-direction: column; gap: 0.1rem;
		box-shadow: 0 2px 8px rgba(0,0,0,0.2);
		text-align: left;
	}
	.reaction-chip:hover .reaction-tooltip { display: flex; }

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
		.sidebar-toggle { display: flex; }
		.chat-header {
			padding: 0.6rem 0.75rem 0.5rem;
			gap: 0.5rem;
			background: var(--paper);
		}
		.chat-header h1 { font-size: 1.1rem; }
		.message-list { padding: 0.75rem 0.875rem; }
		.message { max-width: 88%; }
		.msg-actions { opacity: 0; }
		.reply-bar { padding: 0.4rem 0.75rem; }
		.input-area {
			background: var(--paper);
		}
		.input-bar {
			padding: 0.5rem 0.75rem;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0.5rem));
			gap: 0.4rem;
		}
		.typing-indicator { padding: 0.2rem 0.875rem 0; }
		textarea { font-size: 1rem; }
	}
</style>
