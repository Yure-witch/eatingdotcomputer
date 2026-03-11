<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { db } from '$lib/firebase.js';
	import { ref, onChildAdded, onValue, off, query, limitToLast, set, remove } from 'firebase/database';
	import { normaliseMessage, buildUserMap, formatTime } from '$lib/chat.js';

	let { data } = $props();

	const otherUserId = data.convId.replace(data.currentUser.id, '').replace(/^_|_$/, '');
	const otherUser = data.users.find((u) => u.id === otherUserId) ?? { name: 'Unknown', id: otherUserId };

	const userMap = buildUserMap(data.currentUser, data.users);

	let messages = $state([...data.history]);
	let input = $state('');
	let sending = $state(false);
	let listEl = $state(null);
	let inputEl = $state(null);
	let typingUsers = $state([]);

	let firebaseRef, typingRef;
	let typingTimer;

	function scrollToBottom() {
		tick().then(() => { if (listEl) listEl.scrollTop = listEl.scrollHeight; });
	}

	function markRead() {
		set(ref(db, `lastRead/${data.currentUser.id}/${data.convId}`), Date.now());
	}

	function clearTyping() {
		clearTimeout(typingTimer);
		remove(ref(db, `typing/${data.convId}/${data.currentUser.id}`));
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
	});

	onDestroy(() => {
		if (firebaseRef) off(firebaseRef);
		if (typingRef) off(typingRef);
		clearTyping();
	});

	async function send() {
		const content = input.trim();
		if (!content || sending) return;
		clearTyping();
		const optimistic = {
			id: `opt-${Date.now()}`, userId: data.currentUser.id,
			userName: data.currentUser.name, userRole: data.currentUser.role,
			content, createdAt: Date.now(), pending: true
		};
		messages = [...messages, optimistic];
		input = '';
		scrollToBottom();
		sending = true;
		try {
			await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content, to: otherUser.id })
			});
			messages = messages.filter((m) => m.id !== optimistic.id);
		} catch {
			messages = messages.filter((m) => m.id !== optimistic.id);
			input = content;
		}
		sending = false;
		inputEl?.focus();
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

<div class="message-list" bind:this={listEl}>
	{#if messages.length === 0}
		<p class="empty">Start your conversation with {otherUser.name}.</p>
	{/if}
	{#each messages as msg, i (msg.id)}
		{@const prev = messages[i - 1]}
		{@const isFirst = !prev || prev.userId !== msg.userId || msg.createdAt - prev.createdAt > 300000}
		<div class="message" class:mine={msg.userId === data.currentUser.id} class:first={isFirst}>
			{#if isFirst}
				<div class="meta">
					<span class="name">{msg.userName}</span>
					<span class="time">{formatTime(msg.createdAt)}</span>
				</div>
			{/if}
			<p class="bubble" class:pending={msg.pending}>{msg.content}</p>
		</div>
	{/each}
</div>

{#if typingUsers.length}
	<p class="typing-indicator">
		{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
	</p>
{/if}

<div class="input-bar">
	<textarea bind:this={inputEl} bind:value={input} onkeydown={onKeydown} oninput={onInput} placeholder="Message {otherUser.name}" rows="1" disabled={sending}></textarea>
	<button onclick={send} disabled={sending || !input.trim()} class="btn-send">Send</button>
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
	}
	.empty { color: #a09688; font-size: 0.9rem; text-align: center; margin: auto; }
	.message { display: flex; flex-direction: column; max-width: 75%; gap: 0.15rem; }
	.message.mine { align-self: flex-end; align-items: flex-end; }
	.message:not(.mine) { align-self: flex-start; align-items: flex-start; }
	.message.first { margin-top: 0.75rem; }
	.meta { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem; }
	.name { font-size: 0.78rem; font-weight: 600; color: var(--ink); }
	.time { font-size: 0.72rem; color: #a09688; }
	.bubble {
		margin: 0; padding: 0.55rem 0.85rem; border-radius: 14px;
		font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		background: #fff; border: 1.5px solid #ddd7cc;
	}
	.message.mine .bubble { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.bubble.pending { opacity: 0.6; }
	.typing-indicator {
		font-size: 0.75rem; color: #a09688; padding: 0 1.5rem 0.25rem;
		margin: 0; flex-shrink: 0; min-height: 1.2rem;
	}
	.input-bar {
		display: flex; align-items: flex-end; gap: 0.5rem;
		padding: 0.75rem 1.5rem 1rem; border-top: 1.5px solid #ddd7cc; flex-shrink: 0;
	}
	textarea {
		flex: 1; padding: 0.6rem 0.85rem; border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; resize: none; field-sizing: content; max-height: 140px; transition: border-color 0.15s;
	}
	textarea:focus { border-color: var(--ink); }
	.btn-send {
		padding: 0.6rem 1.1rem; background: var(--ink); color: var(--paper); border: none;
		border-radius: 10px; font-family: inherit; font-size: 0.875rem; font-weight: 600;
		cursor: pointer; transition: opacity 0.15s; flex-shrink: 0;
	}
	.btn-send:hover { opacity: 0.8; }
	.btn-send:disabled { opacity: 0.4; cursor: default; }
</style>
