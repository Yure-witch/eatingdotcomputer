<script>
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off, set, onDisconnect } from 'firebase/database';
	import { getConvId } from '$lib/convId.js';
	import { invalidateAll } from '$app/navigation';

	let { data, children } = $props();

	let firebaseReady = $state(false);
	let dmList = $state([]);
	let showUserPicker = $state(false);
	let showNewChannel = $state(false);
	let newChannelName = $state('');
	let creatingChannel = $state(false);
	let channelError = $state(null);

	// Unread tracking
	let lastRead = $state({});        // { [convId]: timestamp }
	let channelMeta = $state({});     // { [channelId]: { lastAt, lastMessage, lastUser } }

	// Presence — raw snapshot + stale-filtered derived set
	const PRESENCE_TTL = 3 * 60 * 1000; // 3 min — must be > heartbeat interval
	const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 min
	let rawPresence = $state({});
	let presenceTick = $state(0); // incremented every minute to force stale re-eval

	// Re-compute online set: online:true AND lastSeen within TTL
	let onlineIds = $derived.by(() => {
		presenceTick; // subscribe to tick so this re-runs on the interval
		const cutoff = Date.now() - PRESENCE_TTL;
		return new Set(
			Object.entries(rawPresence)
				.filter(([, v]) => v.online && (v.lastSeen ?? 0) > cutoff)
				.map(([uid]) => uid)
		);
	});

	// Mobile sidebar
	let sidebarOpen = $state(false);

	// Toasts
	let toasts = $state([]);          // { id, convId, convPath, title, body }
	let toastId = 0;

	// Hover card
	let hoverUserId = $state(null);
	let hoverX = $state(0);
	let hoverY = $state(0);
	let hoverTimer;

	function showHover(e, userId) {
		clearTimeout(hoverTimer);
		const rect = e.currentTarget.getBoundingClientRect();
		hoverX = rect.right + 8;
		hoverY = Math.min(rect.top, window.innerHeight - 280);
		hoverUserId = userId;
	}
	function hideHover() {
		hoverTimer = setTimeout(() => { hoverUserId = null; }, 150);
	}

	let userChatsRef, lastReadRef, presenceRef, connectedRef, allPresenceRef;
	let heartbeatTimer, tickTimer, presencePollTimer;
	const channelRefs = {};

	async function pollPresence() {
		try {
			const res = await fetch('/api/presence');
			if (!res.ok) return;
			const apiData = await res.json();
			// Merge API data into rawPresence — API is authoritative for non-chat users
			rawPresence = { ...rawPresence, ...apiData };
		} catch { /* ignore */ }
	}

	function isUnread(convId, lastAt) {
		return (lastAt ?? 0) > (lastRead[convId] ?? 0);
	}

	function addToast(convId, convPath, title, body) {
		const currentPath = $page.url.pathname;
		if (currentPath === convPath) return; // already viewing it
		const id = ++toastId;
		toasts = [...toasts, { id, convId, convPath, title, body }];
		setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, 5000);
	}

	function dismissToast(id) {
		toasts = toasts.filter((t) => t.id !== id);
	}

	onMount(async () => {
		await signInWithCustomToken(auth, data.firebaseToken);
		firebaseReady = true;

		// Presence — use Firebase's .info/connected + onDisconnect for reliable cleanup
		presenceRef = ref(rtdb, `presence/${data.currentUser.id}`);
		connectedRef = ref(rtdb, '.info/connected');
		onValue(connectedRef, (snap) => {
			if (!snap.val()) return;
			onDisconnect(presenceRef).update({ online: false, lastSeen: Date.now() });
			set(presenceRef, { name: data.currentUser.name, online: true, lastSeen: Date.now() });
		});

		// Subscribe to all presence for online dots — merge so API-based entries aren't lost
		allPresenceRef = ref(rtdb, 'presence');
		onValue(allPresenceRef, (snap) => {
			const firebaseData = snap.exists() ? snap.val() : {};
			rawPresence = { ...rawPresence, ...firebaseData };
		});

		// Heartbeat — keep lastSeen fresh so stale detection works
		heartbeatTimer = setInterval(() => {
			if (presenceRef) set(presenceRef, { name: data.currentUser.name, online: true, lastSeen: Date.now() });
		}, HEARTBEAT_INTERVAL);

		// Tick every minute to force stale re-evaluation in the derived
		tickTimer = setInterval(() => { presenceTick++; }, 60_000);

		// Poll /api/presence to catch users on non-chat pages (user_activity based)
		await pollPresence();
		presencePollTimer = setInterval(pollPresence, 60_000);

		// DMs
		userChatsRef = ref(rtdb, `userChats/${data.currentUser.id}`);
		let prevDmLastAt = {};
		onValue(userChatsRef, (snap) => {
			if (!snap.exists()) { dmList = []; return; }
			const entries = Object.entries(snap.val())
				.map(([convId, meta]) => ({ convId, ...meta }))
				.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
			// Toast on new DM message
			for (const dm of entries) {
				const prev = prevDmLastAt[dm.convId];
				if (prev !== undefined && (dm.lastAt ?? 0) > prev) {
					const otherName = data.users.find((u) => u.id === dm.otherUserId)?.name ?? dm.otherUserName ?? '?';
					addToast(dm.convId, `/app/chat/dm/${dm.convId}`, otherName, dm.lastMessage ?? '');
				}
				prevDmLastAt[dm.convId] = dm.lastAt ?? 0;
			}
			dmList = entries;
		});

		// lastRead
		lastReadRef = ref(rtdb, `lastRead/${data.currentUser.id}`);
		onValue(lastReadRef, (snap) => {
			lastRead = snap.exists() ? snap.val() : {};
		});

		// Channel metadata (lastAt, lastMessage, lastUser)
		const prevChannelLastAt = {};
		for (const ch of data.channels) {
			const r = ref(rtdb, `channels/${ch.id}`);
			channelRefs[ch.id] = r;
			onValue(r, (snap) => {
				if (!snap.exists()) return;
				const val = snap.val();
				const meta = { lastAt: val.lastAt ?? 0, lastMessage: val.lastMessage ?? '', lastUser: val.lastUser ?? '' };
				channelMeta = { ...channelMeta, [ch.id]: meta };
				// Toast on new channel message
				const prev = prevChannelLastAt[ch.id];
				if (prev !== undefined && meta.lastAt > prev) {
					addToast(ch.id, `/app/chat/channel/${ch.id}`, `#${ch.name}`, `${meta.lastUser}: ${meta.lastMessage}`);
				}
				prevChannelLastAt[ch.id] = meta.lastAt;
			});
		}
	});

	onDestroy(() => {
		if (userChatsRef) off(userChatsRef);
		if (lastReadRef) off(lastReadRef);
		if (allPresenceRef) off(allPresenceRef);
		if (connectedRef) off(connectedRef);
		clearInterval(heartbeatTimer);
		clearInterval(tickTimer);
		clearInterval(presencePollTimer);
		for (const r of Object.values(channelRefs)) off(r);
	});

	function startDm(user) {
		const convId = getConvId(data.currentUser.id, user.id);
		showUserPicker = false;
		window.location.href = `/app/chat/dm/${convId}`;
	}

	async function createChannel() {
		const name = newChannelName.trim();
		if (!name) return;
		creatingChannel = true;
		channelError = null;
		try {
			const res = await fetch('/api/channels', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, class_id: data.classId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				channelError = err.message ?? 'Failed to create channel';
			} else {
				const { id } = await res.json();
				newChannelName = '';
				showNewChannel = false;
				await invalidateAll();
				window.location.href = `/app/chat/channel/${id}`;
			}
		} catch {
			channelError = 'Something went wrong';
		}
		creatingChannel = false;
	}

	function onChannelKeydown(e) {
		if (e.key === 'Enter') createChannel();
		if (e.key === 'Escape') { showNewChannel = false; newChannelName = ''; }
	}

	$effect(() => {
		$page.url.pathname;
		showUserPicker = false;
		sidebarOpen = false;
	});
</script>

<div class="chat-shell">
	{#if sidebarOpen}
		<div class="sidebar-backdrop" onclick={() => sidebarOpen = false}></div>
	{/if}

	<ProfileHover userId={hoverUserId} x={hoverX} y={hoverY} {onlineIds} />

	<div class="sidebar" class:open={sidebarOpen}>
		<div class="sidebar-header">
			<div class="sidebar-header-top">
				<a class="wordmark" href="/app">eating.computer</a>
				<div class="sidebar-header-right">
					<a class="profile-link" href="/app/profile/{data.currentUser.id}" title="My profile">
						<span class="avatar sm">{data.currentUser.name[0].toUpperCase()}</span>
					</a>
					<button class="btn-icon sidebar-close" onclick={() => sidebarOpen = false}>×</button>
				</div>
			</div>
			{#if data.currentClass}
				<span class="class-label">{data.currentClass.name} — {data.currentClass.term}</span>
			{/if}
		</div>

		<!-- Channels -->
		<div class="sidebar-section">
			<div class="section-header">
				<span>Channels</span>
				{#if data.currentUser.role === 'instructor'}
					<button class="btn-icon" onclick={() => { showNewChannel = !showNewChannel; channelError = null; }} title="New channel">+</button>
				{/if}
			</div>

			{#if showNewChannel}
				<div class="inline-input">
					<span class="hash">#</span>
					<input
						type="text"
						bind:value={newChannelName}
						onkeydown={onChannelKeydown}
						placeholder="channel-name"
						autofocus
						disabled={creatingChannel}
					/>
					{#if channelError}<span class="inline-error">{channelError}</span>{/if}
				</div>
			{/if}

			{#each data.channels as ch}
				{@const path = `/app/chat/channel/${ch.id}`}
				{@const unread = isUnread(ch.id, channelMeta[ch.id]?.lastAt)}
				<a href={path} class="sidebar-item" class:active={$page.url.pathname === path}>
					<span class="hash">#</span>
					<span class="item-name" class:bold={unread}>{ch.name}</span>
					{#if unread}<span class="unread-dot"></span>{/if}
				</a>
			{/each}
		</div>

		<!-- Members (click to DM, hover for profile card) -->
		<div class="sidebar-section">
			<div class="section-header">
				<span>Members</span>
				{#if onlineIds.size > 0}
					<span class="online-count">{onlineIds.size} online</span>
				{/if}
			</div>
			{#each [data.currentUser, ...data.users] as u}
				{@const isOnline = onlineIds.has(u.id)}
				{@const convId = u.id === data.currentUser.id ? null : getConvId(data.currentUser.id, u.id)}
				{@const dmPath = convId ? `/app/chat/dm/${convId}` : null}
				{@const dmUnread = convId ? isUnread(convId, dmList.find(d => d.convId === convId)?.lastAt) : false}
				{@const lastMsg = dmList.find(d => d.convId === convId)?.lastMessage ?? null}
				<div
					class="member-row"
					class:self={u.id === data.currentUser.id}
					onmouseenter={(e) => showHover(e, u.id)}
					onmouseleave={hideHover}
				>
					{#if dmPath}
						<a class="member-inner" href={dmPath} class:active={$page.url.pathname === dmPath}>
							<span class="avatar-wrap">
								<span class="avatar">{u.name[0].toUpperCase()}</span>
								{#if isOnline}<span class="presence-dot"></span>{/if}
							</span>
							<div class="member-text">
								<span class="member-name" class:bold={dmUnread}>{u.name}</span>
								{#if lastMsg}<span class="dm-last">{lastMsg}</span>{/if}
							</div>
							{#if u.role === 'instructor'}<span class="role-badge">instr.</span>{/if}
							{#if dmUnread}<span class="unread-dot"></span>{/if}
						</a>
					{:else}
						<a class="member-inner self-link" href="/app/profile/{u.id}">
							<span class="avatar-wrap">
								<span class="avatar">{u.name[0].toUpperCase()}</span>
								<span class="presence-dot"></span>
							</span>
							<div class="member-text">
								<span class="member-name">{u.name} <span class="you-tag">you</span></span>
							</div>
							{#if u.role === 'instructor'}<span class="role-badge">instr.</span>{/if}
						</a>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="chat-main">
		<div class="mobile-topbar">
			<button class="mobile-menu-btn" onclick={() => sidebarOpen = true}>☰</button>
		</div>
		{#if firebaseReady}
			{@render children()}
		{:else}
			<div class="loading">Connecting…</div>
		{/if}
	</div>
</div>

{#if toasts.length}
	<div class="toast-stack">
		{#each toasts as t (t.id)}
			<a href={t.convPath} class="toast" onclick={() => dismissToast(t.id)}>
				<div class="toast-header">
					<span class="toast-title">{t.title}</span>
					<button class="toast-close" onclick={(e) => { e.preventDefault(); e.stopPropagation(); dismissToast(t.id); }}>×</button>
				</div>
				<p class="toast-body">{t.body}</p>
			</a>
		{/each}
	</div>
{/if}

<style>
	.chat-shell { height: 100vh; height: 100dvh; display: flex; background: var(--paper); }

	/* ── Sidebar ── */
	.sidebar {
		width: 220px; flex-shrink: 0;
		background: #1a1a1a; color: #c8c1b4;
		display: flex; flex-direction: column; overflow-y: auto;
	}

	.sidebar-header { padding: 0.9rem 1rem 0.75rem; border-bottom: 1px solid #2a2a2a; display: flex; flex-direction: column; gap: 0.25rem; }

	.sidebar-header-top { display: flex; align-items: center; justify-content: space-between; }

	.class-label { font-size: 0.68rem; color: #555; font-weight: 500; letter-spacing: 0.01em; }

	.wordmark { font-family: 'Cambridge', serif; font-size: 1.1rem; color: #f7f2ea; text-decoration: none; }
	.wordmark:hover { opacity: 0.8; }

	.sidebar-section { padding: 0.75rem 0.5rem 0; }

	.section-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0 0.6rem; margin-bottom: 0.3rem;
		font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #666;
	}

	.btn-icon {
		background: none; border: none; color: #666; font-size: 1rem;
		cursor: pointer; line-height: 1; padding: 0; transition: color 0.1s;
	}
	.btn-icon:hover { color: #f7f2ea; }

	.inline-input {
		display: flex; align-items: center; gap: 0.25rem;
		padding: 0.25rem 0.5rem; margin-bottom: 0.25rem;
	}
	.inline-input input {
		flex: 1; background: #2a2a2a; border: 1px solid #444; border-radius: 5px;
		color: #f7f2ea; font-family: inherit; font-size: 0.82rem;
		padding: 0.3rem 0.4rem; outline: none;
	}
	.inline-input input:focus { border-color: #888; }
	.inline-error { font-size: 0.7rem; color: #e57373; }

	.hash { opacity: 0.5; font-size: 0.95rem; flex-shrink: 0; }

	.sidebar-item {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.28rem 0.6rem; border-radius: 5px;
		font-size: 0.875rem; color: #a09688; text-decoration: none; transition: all 0.1s;
	}
	.sidebar-item:hover, .sidebar-item.active { background: #2a2a2a; color: #f7f2ea; }

	.user-picker {
		background: #222; border-radius: 7px; margin: 0 0.25rem 0.4rem;
		padding: 0.2rem; display: flex; flex-direction: column;
	}
	.user-option {
		display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem;
		background: none; border: none; border-radius: 5px; color: #c8c1b4;
		font-family: inherit; font-size: 0.82rem; cursor: pointer; text-align: left; transition: background 0.1s;
	}
	.user-option:hover { background: #333; color: #f7f2ea; }

	.avatar {
		width: 20px; height: 20px; border-radius: 4px; background: #444; color: #f7f2ea;
		font-size: 0.68rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
	}

	.role-badge {
		font-size: 0.6rem; font-weight: 600; background: #333; color: #888;
		padding: 0.08rem 0.3rem; border-radius: 99px; text-transform: uppercase; margin-left: auto;
	}

	.dm-item { padding: 0.28rem 0.5rem; }

	.dm-meta { display: flex; flex-direction: column; min-width: 0; }
	.dm-name { font-size: 0.875rem; color: #a09688; }
	.sidebar-item.active .dm-name, .sidebar-item:hover .dm-name { color: #f7f2ea; }
	.dm-last { font-size: 0.7rem; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.muted { font-size: 0.75rem; color: #555; padding: 0.25rem 0.5rem; margin: 0; }

	.item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-name.bold { color: #f7f2ea; font-weight: 600; }
	.dm-name.bold { color: #f7f2ea; font-weight: 600; }

	.unread-dot {
		width: 8px; height: 8px; border-radius: 50%;
		background: #e53935; flex-shrink: 0; margin-left: auto;
	}

	.online-count {
		font-size: 0.65rem; color: #4caf50; font-weight: 600;
		margin-right: auto; margin-left: 0.3rem;
	}

	.avatar-wrap { position: relative; flex-shrink: 0; }

	.presence-dot {
		position: absolute; bottom: -1px; right: -1px;
		width: 7px; height: 7px; border-radius: 50%;
		background: #4caf50; border: 1.5px solid #1a1a1a;
	}

	.member-row { /* wrapper */ }

	.member-inner {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.22rem 0.6rem; border-radius: 5px; width: 100%;
		font-size: 0.82rem; color: #a09688; text-decoration: none;
		transition: background 0.1s; box-sizing: border-box;
	}
	.member-inner:hover, .member-inner.active { background: #2a2a2a; color: #f7f2ea; }
	.member-inner.active .member-name,
	.member-inner:hover .member-name { color: #f7f2ea; }

	.member-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.08rem; }

	.member-name {
		font-size: 0.875rem; color: #a09688;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.member-name.bold { font-weight: 600; color: #f7f2ea; }

	.you-tag { font-size: 0.65rem; color: #555; font-weight: 400; margin-left: 0.2rem; }

	.self-link { opacity: 0.75; }
	.self-link:hover { opacity: 1; }

	.sidebar-header-right { display: flex; align-items: center; gap: 0.4rem; }
	.profile-link { display: flex; align-items: center; border-radius: 4px; }
	.profile-link:hover .avatar { background: #555; }
	.avatar.sm { width: 22px; height: 22px; font-size: 0.7rem; }

	.sidebar-close { display: none; font-size: 1.2rem; }

	/* ── Main ── */
	.chat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }

	.mobile-topbar {
		display: none;
	}

	.mobile-menu-btn {
		background: none; border: none; color: var(--ink);
		font-size: 1.3rem; cursor: pointer; line-height: 1;
		padding: 0; width: 44px; height: 44px;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0;
	}

	.mobile-back {
		font-size: 0.85rem;
		font-weight: 500;
		color: #a09688;
		text-decoration: none;
		flex: 1;
	}
	.mobile-back:hover { color: var(--ink); }

	.sidebar-backdrop { display: none; }

	.loading { flex: 1; display: flex; align-items: center; justify-content: center; color: #a09688; font-size: 0.9rem; }

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.chat-shell { height: calc(100dvh - 56px - env(safe-area-inset-bottom, 0px)); }
		.sidebar {
			position: fixed; inset: 0; z-index: 1200;
			width: 85vw; max-width: 300px;
			transform: translateX(-100%);
			transition: transform 0.22s ease;
			padding-bottom: env(safe-area-inset-bottom, 0);
		}
		.sidebar.open { transform: translateX(0); }
		.sidebar-close { display: block; margin-left: auto; }
		.sidebar-backdrop {
			display: block; position: fixed; inset: 0; z-index: 1100;
			background: rgba(0,0,0,0.45);
		}
		.mobile-topbar {
			display: flex;
			align-items: center;
			position: fixed;
			top: 0; left: 0;
			z-index: 15;
		}
	}

	/* ── Toasts ── */
	.toast-stack {
		position: fixed; top: 1.5rem; right: 1.5rem;
		display: flex; flex-direction: column; gap: 0.5rem;
		z-index: 100; pointer-events: none;
	}
	.toast {
		background: #1a1a1a; color: #f7f2ea;
		border: 1px solid #333; border-radius: 10px;
		padding: 0.75rem 1rem; width: 260px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.35);
		pointer-events: all; cursor: pointer; text-decoration: none;
		display: block;
		animation: slide-in 0.2s ease;
	}
	.toast:hover { border-color: #555; }
	.toast-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem; }
	.toast-title { font-size: 0.82rem; font-weight: 700; color: #f7f2ea; }
	.toast-close {
		background: none; border: none; color: #666; font-size: 1rem;
		cursor: pointer; line-height: 1; padding: 0; margin-left: 0.5rem;
	}
	.toast-close:hover { color: #f7f2ea; }
	.toast-body { margin: 0; font-size: 0.78rem; color: #a09688; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	@keyframes slide-in {
		from { opacity: 0; transform: translateY(8px); }
		to   { opacity: 1; transform: translateY(0); }
	}
</style>
