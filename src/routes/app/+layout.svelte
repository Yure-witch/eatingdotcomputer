<script>
	import { browser } from '$app/environment';
	import { onMount, onDestroy, setContext } from 'svelte';
	import { page } from '$app/stores';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off, set, onDisconnect } from 'firebase/database';
	import { getConvId } from '$lib/convId.js';
	import { invalidateAll } from '$app/navigation';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { data, children } = $props();

	// ── Nav items (Chat omitted — sidebar always shows channels/DMs) ──
	const navItems = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
		},
		{
			href: '/app/assignments',
			label: 'Roadmap',
			active: (p) => p.startsWith('/app/assignments'),
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`
		},
		{
			href: '/app/files',
			label: 'Files',
			active: (p) => p.startsWith('/app/files'),
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
		},
		{
			href: '/app/manage',
			label: 'Manage',
			active: (p) => p.startsWith('/app/manage'),
			instructorOnly: true,
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`
		}
	];

	// ── Sidebar state ──
	let sidebarOpen = $state(false);
	let sidebarCollapsed = $state(false);

	setContext('openSidebar', () => { sidebarOpen = true; });
	let showNewChannel = $state(false);
	let newChannelName = $state('');
	let creatingChannel = $state(false);
	let channelError = $state(null);

	// ── Unread / DMs ──
	let lastRead = $state({});
	let channelMeta = $state({});
	let unreadCounts = $state({});
	let dmList = $state([]);

	function isUnread(convId, lastAt) {
		return (lastAt ?? 0) > (lastRead[convId] ?? 0);
	}

	// ── App badge (iOS PWA / desktop PWA) ──
	const totalUnread = $derived.by(() => {
		let count = 0;
		for (const ch of (data.channels ?? [])) {
			count += unreadCounts[ch.id] ?? 0;
		}
		for (const dm of dmList) {
			if (isUnread(dm.convId, dm.lastAt)) count++;
		}
		return count;
	});

	$effect(() => {
		if (!('setAppBadge' in navigator)) return;
		if (totalUnread > 0) {
			navigator.setAppBadge(totalUnread).catch(() => {});
		} else {
			navigator.clearAppBadge().catch(() => {});
		}
	});

	// ── Presence ──
	const PRESENCE_TTL = 3 * 60 * 1000;
	const HEARTBEAT_INTERVAL = 2 * 60 * 1000;
	let rawPresence = $state({});
	let presenceTick = $state(0);

	let onlineIds = $derived.by(() => {
		presenceTick;
		const cutoff = Date.now() - PRESENCE_TTL;
		return new Set(
			Object.entries(rawPresence)
				.filter(([, v]) => v.online && (v.lastSeen ?? 0) > cutoff)
				.map(([uid]) => uid)
		);
	});

	// ── Profile hover card ──
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

	// ── Toasts ──
	let toasts = $state([]);
	let toastId = 0;

	function addToast(convId, convPath, title, body) {
		const currentPath = $page.url.pathname;
		if (currentPath === convPath) return;
		const id = ++toastId;
		toasts = [...toasts, { id, convId, convPath, title, body }];
		if (soundEnabled) playSound();
		setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, 5000);
	}
	function dismissToast(id) { toasts = toasts.filter((t) => t.id !== id); }

	// ── PWA / sound ──
	let installPrompt = $state(null);
	let installed = $state(false);
	let dismissed = $state(false);
	let soundEnabled = $state(true);

	function playSound() {
		try {
			const ctx = new AudioContext();
			const frequencies = [880, 1100];
			let t = ctx.currentTime;
			for (const freq of frequencies) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = 'sine';
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0, t);
				gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
				gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
				osc.start(t);
				osc.stop(t + 0.35);
				t += 0.1;
			}
		} catch { /* AudioContext not available */ }
	}

	// ── Firebase refs ──
	let userChatsRef, lastReadRef, presenceRef, connectedRef, allPresenceRef;
	let channelMetaRef, unreadCountsRef;
	let heartbeatTimer, tickTimer, presencePollTimer, activityTimer;

	async function pollPresence() {
		try {
			const res = await fetch('/api/presence');
			if (!res.ok) return;
			rawPresence = { ...rawPresence, ...(await res.json()) };
		} catch { /* ignore */ }
	}

	// device info populated after onMount computes isPwa / isMobile
	let _deviceType = 'desktop';
	let _isPwa = false;

	async function logActivity() {
		try {
			await fetch('/api/presence/log', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ deviceType: _deviceType, isPwa: _isPwa })
			});
		} catch { /* ignore */ }
	}

	function startDm(user) {
		const convId = getConvId(data.currentUser.id, user.id);
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
				newChannelName = '';
				showNewChannel = false;
				await invalidateAll();
				const { id } = await res.json().catch(() => ({}));
				if (id) window.location.href = `/app/chat/channel/${id}`;
			}
		} catch { channelError = 'Something went wrong'; }
		creatingChannel = false;
	}

	function onChannelKeydown(e) {
		if (e.key === 'Enter') createChannel();
		if (e.key === 'Escape') { showNewChannel = false; newChannelName = ''; }
	}

	async function install() {
		if (!installPrompt) return;
		installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') installed = true;
		installPrompt = null;
	}

	onMount(async () => {
		logActivity();
		activityTimer = setInterval(logActivity, 5 * 60_000);

		sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === '1';
		soundEnabled = localStorage.getItem('notif_sound') !== 'false';

		if (window.matchMedia('(display-mode: standalone)').matches) installed = true;
		window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
		window.addEventListener('appinstalled', () => { installed = true; installPrompt = null; });

		if (!data?.firebaseToken || !data?.currentUser) return;

		try { await signInWithCustomToken(auth, data.firebaseToken); } catch { /* ignore */ }

		// Presence write — per-device so two simultaneous logins don't clobber each other
		let deviceId = sessionStorage.getItem('ec_device_id');
		if (!deviceId) {
			deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
			sessionStorage.setItem('ec_device_id', deviceId);
		}
		presenceRef = ref(rtdb, `presence/${data.currentUser.id}/${deviceId}`);
		connectedRef = ref(rtdb, '.info/connected');
		const isPwa = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
		const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (screen.width <= 768 && 'ontouchstart' in window);
		_isPwa = isPwa;
		_deviceType = isMobile ? 'mobile' : 'desktop';

		// Check notification permission + active push subscription
		let hasNotif = typeof Notification !== 'undefined' && Notification.permission === 'granted';
		if (hasNotif && 'serviceWorker' in navigator) {
			try {
				const reg = await navigator.serviceWorker.ready;
				const sub = await reg.pushManager.getSubscription();
				hasNotif = !!sub;
			} catch { hasNotif = false; }
		}

		const presencePayload = () => ({
			name: data.currentUser.name,
			online: true,
			lastSeen: Date.now(),
			ua: navigator.userAgent,
			screen: `${screen.width}x${screen.height}`,
			pwa: isPwa,
			mobile: isMobile,
			notif: hasNotif
		});
		onValue(connectedRef, (snap) => {
			if (!snap.val()) return;
			onDisconnect(presenceRef).update({ online: false, lastSeen: Date.now() });
			set(presenceRef, presencePayload());
		});
		heartbeatTimer = setInterval(() => { if (presenceRef) set(presenceRef, presencePayload()); }, HEARTBEAT_INTERVAL);
		tickTimer = setInterval(() => { presenceTick++; }, 60_000);

		// All presence (online dots) — normalize both old (flat) and new (per-device) formats
		allPresenceRef = ref(rtdb, 'presence');
		onValue(allPresenceRef, (snap) => {
			if (!snap.exists()) return;
			const fb = snap.val();
			const normalized = {};
			for (const [uid, v] of Object.entries(fb)) {
				if (!v || typeof v !== 'object') continue;
				if (typeof v.online !== 'undefined') {
					// Old single-device format
					normalized[uid] = { online: !!v.online, lastSeen: v.lastSeen ?? 0 };
				} else {
					// New per-device format: a user is online if ANY device is online
					let online = false, lastSeen = 0;
					for (const d of Object.values(v)) {
						if (d?.online) online = true;
						if ((d?.lastSeen ?? 0) > lastSeen) lastSeen = d.lastSeen;
					}
					normalized[uid] = { online, lastSeen };
				}
			}
			rawPresence = { ...rawPresence, ...normalized };
		});

		await pollPresence();
		presencePollTimer = setInterval(pollPresence, 60_000);

		// DMs
		userChatsRef = ref(rtdb, `userChats/${data.currentUser.id}`);
		const prevDmLastAt = {};
		onValue(userChatsRef, (snap) => {
			if (!snap.exists()) { dmList = []; return; }
			const entries = Object.entries(snap.val())
				.map(([convId, meta]) => ({ convId, ...meta }))
				.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
			for (const dm of entries) {
				const prev = prevDmLastAt[dm.convId];
				if (prev !== undefined && (dm.lastAt ?? 0) > prev) {
					const name = data.users?.find((u) => u.id === dm.otherUserId)?.name ?? dm.otherUserName ?? '?';
					addToast(dm.convId, `/app/chat/dm/${dm.convId}`, name, dm.lastMessage ?? '');
				}
				prevDmLastAt[dm.convId] = dm.lastAt ?? 0;
			}
			dmList = entries;
		});

		// Last-read timestamps
		lastReadRef = ref(rtdb, `lastRead/${data.currentUser.id}`);
		onValue(lastReadRef, (snap) => { lastRead = snap.exists() ? snap.val() : {}; });

		// Channel metadata — single lightweight subscription (no messages payload)
		const prevChannelLastAt = {};
		const channelMap = Object.fromEntries((data.channels ?? []).map((ch) => [ch.id, ch]));
		channelMetaRef = ref(rtdb, 'channelMeta');
		onValue(channelMetaRef, (snap) => {
			if (!snap.exists()) { channelMeta = {}; return; }
			const allMeta = snap.val();
			const newMeta = {};
			for (const [chId, raw] of Object.entries(allMeta)) {
				const meta = { lastAt: raw.lastAt ?? 0, lastMessage: raw.lastMessage ?? '', lastUser: raw.lastUser ?? '' };
				newMeta[chId] = meta;
				const ch = channelMap[chId];
				if (ch) {
					const prev = prevChannelLastAt[chId];
					if (prev !== undefined && meta.lastAt > prev) {
						addToast(chId, `/app/chat/channel/${chId}`, `#${ch.name}`, `${meta.lastUser}: ${meta.lastMessage}`);
					}
					prevChannelLastAt[chId] = meta.lastAt;
				}
			}
			channelMeta = newMeta;
		});

		// Per-user unread counts per channel
		unreadCountsRef = ref(rtdb, `unreadCounts/${data.currentUser.id}`);
		onValue(unreadCountsRef, (snap) => {
			unreadCounts = snap.exists() ? snap.val() : {};
		});
	});

	onDestroy(() => {
		clearInterval(activityTimer);
		clearInterval(heartbeatTimer);
		clearInterval(tickTimer);
		clearInterval(presencePollTimer);
		if (userChatsRef) off(userChatsRef);
		if (lastReadRef) off(lastReadRef);
		if (allPresenceRef) off(allPresenceRef);
		if (connectedRef) off(connectedRef);
		if (channelMetaRef) off(channelMetaRef);
		if (unreadCountsRef) off(unreadCountsRef);
	});

	function toggleCollapse() {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem('sidebar_collapsed', sidebarCollapsed ? '1' : '0');
	}

	$effect(() => {
		$page.url.pathname;
		sidebarOpen = false;
	});
</script>

<!-- Profile hover card (desktop) -->
<ProfileHover userId={hoverUserId} x={hoverX} y={hoverY} {onlineIds} />

{#if sidebarOpen}
	<div class="sidebar-backdrop" onclick={() => sidebarOpen = false}></div>
{/if}

<!-- Global sidebar -->
<nav class="global-sidebar" class:open={sidebarOpen} class:collapsed={sidebarCollapsed}>
	<!-- Header: logo + collapse toggle in one row -->
	<div class="sidebar-header">
		<a class="sidebar-logo" href="/app" title="eating.computer">eating.computer</a>
		<span class="sidebar-class-name">{data.currentClass?.name ?? 'Class'}</span>
		<button class="collapse-btn" onclick={toggleCollapse} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
			{#if sidebarCollapsed}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
			{:else}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
			{/if}
		</button>
		<button class="collapse-btn mobile-close-btn" onclick={() => sidebarOpen = false} title="Close">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</button>
	</div>

	<!-- Main nav -->
	<div class="sidebar-nav">
		{#each navItems as item}
			{#if !item.instructorOnly || data.currentUser?.role === 'instructor'}
				{@const isActive = item.active($page.url.pathname)}
				<a href={item.href} class="nav-item" class:active={isActive} title={item.label}>
					{@html item.icon}
					<span class="nav-label">{item.label}</span>
				</a>
			{/if}
		{/each}
	</div>

	<div class="sidebar-divider"></div>

	{#if data.channels?.length}
		<!-- Channels -->
		<div class="sidebar-section">
			<div class="section-header">
				<span>Channels</span>
				{#if data.currentUser?.role === 'instructor'}
					<button class="btn-icon" onclick={() => { showNewChannel = !showNewChannel; channelError = null; }} title="New channel">+</button>
				{/if}
			</div>

			{#if showNewChannel}
				<div class="inline-input">
					<span class="hash">#</span>
					<input type="text" bind:value={newChannelName} onkeydown={onChannelKeydown} placeholder="channel-name" autofocus disabled={creatingChannel} />
					{#if channelError}<span class="inline-error">{channelError}</span>{/if}
				</div>
			{/if}

			{#each data.channels as ch}
				{@const path = `/app/chat/channel/${ch.id}`}
				{@const unreadCount = unreadCounts[ch.id] ?? 0}
				<a href={path} class="sidebar-item" class:active={$page.url.pathname === path}>
					<span class="hash">#</span>
					<span class="item-name" class:bold={unreadCount > 0}>{ch.name}</span>
					{#if unreadCount > 0}<span class="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>{/if}
				</a>
			{/each}
		</div>
	{/if}

	{#if data.users?.length}
		<!-- Members (DMs) -->
		<div class="sidebar-section">
			<div class="section-header">
				<span>Members</span>
				{#if onlineIds.size > 0}<span class="online-count">{onlineIds.size} online</span>{/if}
			</div>

			{#if data.currentUser}
				<div class="member-row self" onmouseenter={(e) => showHover(e, data.currentUser.id)} onmouseleave={hideHover}>
					<a class="member-inner" href="/app/profile/{data.currentUser.id}">
						<span class="avatar-wrap">
							<span class="avatar">{data.currentUser.name[0].toUpperCase()}</span>
							<span class="presence-dot"></span>
						</span>
						<div class="member-text">
							<span class="member-name">{data.currentUser.name} <span class="you-tag">you</span></span>
						</div>
						{#if data.currentUser.role === 'instructor'}<span class="role-badge">instr.</span>{/if}
					</a>
				</div>
			{/if}

			{#each data.users as u}
				{@const isOnline = onlineIds.has(u.id)}
				{@const convId = getConvId(data.currentUser.id, u.id)}
				{@const dmPath = `/app/chat/dm/${convId}`}
				{@const dmUnread = isUnread(convId, dmList.find((d) => d.convId === convId)?.lastAt)}
				{@const lastMsg = dmList.find((d) => d.convId === convId)?.lastMessage ?? null}
				<div class="member-row" onmouseenter={(e) => showHover(e, u.id)} onmouseleave={hideHover}>
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
				</div>
			{/each}
		</div>
	{/if}
</nav>

<!-- Mobile hamburger -->
<button class="mobile-menu-btn" onclick={() => sidebarOpen = true} aria-label="Menu">
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>

<BottomNav isInstructor={data.currentUser?.role === 'instructor'} />

<div class="app-shell" style:margin-left={sidebarCollapsed ? '52px' : null}>
	{@render children()}
</div>

<!-- Toasts -->
{#if toasts.length}
	<div class="toast-stack">
		{#each toasts as t (t.id)}
			<a href={t.convPath || '#'} class="toast" onclick={() => dismissToast(t.id)}>
				<div class="toast-header">
					<span class="toast-title">{t.title}</span>
					<button class="toast-close" onclick={(e) => { e.preventDefault(); e.stopPropagation(); dismissToast(t.id); }}>×</button>
				</div>
				<p class="toast-body">{t.body}</p>
			</a>
		{/each}
	</div>
{/if}

<!-- Install banner -->
{#if browser && installPrompt && !installed && !dismissed}
	<div class="install-banner">
		<div class="install-text">
			<strong>Install eating.computer</strong>
			<span>Get the full app experience with notifications</span>
		</div>
		<div class="install-actions">
			<button class="btn-install" onclick={install}>Install</button>
			<button class="btn-dismiss" onclick={() => (dismissed = true)} aria-label="Dismiss">×</button>
		</div>
	</div>
{/if}

<style>
	/* ── Global sidebar ── */
	.global-sidebar {
		display: none;
	}

	@media (min-width: 641px) {
		.global-sidebar {
			display: flex;
			flex-direction: column;
			position: fixed;
			top: 0; left: 0; bottom: 0;
			width: var(--sidebar-width);
			background: #1a1a1a;
			color: #c8c1b4;
			overflow-y: auto;
			overflow-x: hidden;
			z-index: 200;
			scrollbar-width: none;
			transition: width 0.2s ease;
		}
		.global-sidebar::-webkit-scrollbar { display: none; }
		.global-sidebar.collapsed { width: 52px; }
		.global-sidebar.collapsed .sidebar-logo,
		.global-sidebar.collapsed .nav-label,
		.global-sidebar.collapsed .sidebar-section,
		.global-sidebar.collapsed .sidebar-divider { display: none; }
		.global-sidebar.collapsed .sidebar-header { justify-content: center; padding: 0.5rem 0; }
		.global-sidebar.collapsed .sidebar-nav { flex-direction: column; padding: 0.25rem 0.3rem; }
		.global-sidebar.collapsed .nav-item { flex: none; width: 100%; }
	}

	/* ── Sidebar header ── */
	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 0.6rem 0.25rem 1rem;
		flex-shrink: 0;
		gap: 0.5rem;
	}

	/* ── Logo ── */
	.sidebar-logo {
		font-family: 'Cambridge', serif;
		font-size: 0.9rem;
		color: #f7f2ea;
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		flex: 1;
		min-width: 0;
	}
	.sidebar-logo:hover { opacity: 0.75; }

	/* ── Class name (mobile sidebar header only) ── */
	.sidebar-class-name {
		display: none;
		font-family: 'Cambridge', serif;
		font-size: 0.9rem;
		color: #f7f2ea;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	/* ── Mobile close button (hidden on desktop) ── */
	.mobile-close-btn { display: none; }

	/* ── Collapse button ── */
	.collapse-btn {
		display: none;
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 5px;
		transition: color 0.1s, background 0.1s;
		flex-shrink: 0;
	}
	.collapse-btn:hover { color: #f7f2ea; background: #2a2a2a; }
	@media (min-width: 641px) {
		.collapse-btn { display: flex; align-items: center; justify-content: center; }
		.mobile-close-btn { display: none !important; }
	}

	/* ── Nav items ── */
	.sidebar-nav {
		display: flex;
		flex-direction: row;
		padding: 0.25rem 0.5rem 0.5rem;
		gap: 0.15rem;
		flex-shrink: 0;
	}

	.nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		flex: 1;
		padding: 0.45rem 0.2rem;
		border-radius: 7px;
		color: #666;
		text-decoration: none;
		font-size: 0.55rem;
		font-weight: 500;
		transition: background 0.12s, color 0.12s;
		text-align: center;
	}
	.nav-item:hover { background: #2a2a2a; color: #f7f2ea; }
	.nav-item.active { background: #2a2a2a; color: #f7f2ea; font-weight: 600; }

	.nav-label { text-transform: uppercase; letter-spacing: 0.04em; }

	/* ── Divider ── */
	.sidebar-divider {
		height: 1px;
		background: #2a2a2a;
		margin: 0.25rem 0.75rem;
		flex-shrink: 0;
	}

	/* ── Sections ── */
	.sidebar-section { padding: 0.5rem 0.5rem 0; flex-shrink: 0; }

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.6rem;
		margin-bottom: 0.25rem;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #555;
	}

	.btn-icon {
		background: none; border: none; color: #666;
		font-size: 1rem; cursor: pointer; line-height: 1; padding: 0;
		transition: color 0.1s;
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
		font-size: 0.875rem; color: #a09688; text-decoration: none;
		transition: all 0.1s;
	}
	.sidebar-item:hover, .sidebar-item.active { background: #2a2a2a; color: #f7f2ea; }

	.item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-name.bold { color: #f7f2ea; font-weight: 600; }

	.unread-badge {
		font-size: 0.6rem;
		font-weight: 700;
		background: #e53935;
		color: #fff;
		border-radius: 99px;
		padding: 0.1rem 0.35rem;
		min-width: 16px;
		text-align: center;
		flex-shrink: 0;
		margin-left: auto;
		line-height: 1.4;
	}
	.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: #e53935; flex-shrink: 0; margin-left: auto; }
	.online-count { font-size: 0.65rem; color: #4caf50; font-weight: 600; margin-right: auto; margin-left: 0.3rem; }

	/* ── Members ── */
	.member-row { /* wrapper */ }
	.member-row.self { opacity: 0.75; }
	.member-row.self:hover { opacity: 1; }

	.member-inner {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.22rem 0.6rem; border-radius: 5px; width: 100%;
		font-size: 0.82rem; color: #a09688; text-decoration: none;
		transition: background 0.1s; box-sizing: border-box;
	}
	.member-inner:hover, .member-inner.active { background: #2a2a2a; color: #f7f2ea; }

	.avatar-wrap { position: relative; flex-shrink: 0; }
	.avatar {
		width: 20px; height: 20px; border-radius: 4px; background: #444; color: #f7f2ea;
		font-size: 0.68rem; font-weight: 700; display: flex; align-items: center; justify-content: center;
	}
	.presence-dot {
		position: absolute; bottom: -1px; right: -1px;
		width: 7px; height: 7px; border-radius: 50%;
		background: #4caf50; border: 1.5px solid #1a1a1a;
	}

	.member-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.05rem; }
	.member-name { font-size: 0.82rem; color: #a09688; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.member-name.bold { font-weight: 600; color: #f7f2ea; }
	.you-tag { font-size: 0.65rem; color: #555; font-weight: 400; margin-left: 0.2rem; }
	.dm-last { font-size: 0.68rem; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.role-badge {
		font-size: 0.6rem; font-weight: 600; background: #333; color: #888;
		padding: 0.08rem 0.3rem; border-radius: 99px; text-transform: uppercase; margin-left: auto; flex-shrink: 0;
	}

	/* Mobile hamburger — hidden by default (chat layout shows its own) */
	.mobile-menu-btn { display: none; }

	/* Mobile sidebar drawer */
	@media (max-width: 640px) {
		.global-sidebar {
			display: flex;
			flex-direction: column;
			position: fixed;
			top: 0; left: 0; bottom: 0;
			width: 280px;
			background: #1a1a1a;
			color: #c8c1b4;
			overflow-y: auto;
			overflow-x: hidden;
			z-index: 500;
			scrollbar-width: none;
			transform: translateX(-100%);
			transition: transform 0.22s ease;
		}
		.global-sidebar.open { transform: translateX(0); }
		/* Hide nav items on mobile — bottom bar handles navigation */
		.global-sidebar .sidebar-nav,
		.global-sidebar .sidebar-divider { display: none; }
		/* Show header on mobile but swap logo → class name, and collapse btn → close btn */
		.global-sidebar .sidebar-logo { display: none; }
		.global-sidebar .collapse-btn { display: none; }
		.global-sidebar .mobile-close-btn { display: flex; }
		.global-sidebar .sidebar-class-name { display: block; }
		.sidebar-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.5);
			z-index: 499;
		}
	}

	/* ── App shell ── */
	.app-shell { min-height: 100vh; }

	@media (min-width: 641px) {
		/* Default margin matches sidebar width; overridden by inline style when collapsed */
		.app-shell { margin-left: var(--sidebar-width); transition: margin-left 0.2s ease; }
	}

	/* ── Toasts ── */
	.toast-stack {
		position: fixed; top: 1.5rem; right: 1.5rem;
		display: flex; flex-direction: column; gap: 0.5rem;
		z-index: 300; pointer-events: none;
	}
	.toast {
		background: #1a1a1a; color: #f7f2ea;
		border: 1px solid #333; border-radius: 10px;
		padding: 0.75rem 1rem; width: 260px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.35);
		pointer-events: all; cursor: pointer; text-decoration: none;
		display: block; animation: slide-in 0.2s ease;
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

	/* ── Install banner ── */
	.install-banner {
		position: fixed; bottom: 1.25rem; left: 50%;
		transform: translateX(-50%);
		width: calc(100% - 2.5rem); max-width: 480px;
		background: var(--ink); color: var(--paper);
		border-radius: 12px; padding: 0.85rem 1rem;
		display: flex; align-items: center; justify-content: space-between; gap: 1rem;
		box-shadow: 0 4px 24px rgba(0,0,0,0.18); z-index: 100;
	}
	.install-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.install-text strong { font-size: 0.9rem; }
	.install-text span { font-size: 0.78rem; opacity: 0.7; }
	.install-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
	.btn-install {
		padding: 0.4rem 0.9rem; background: var(--paper); color: var(--ink);
		border: none; border-radius: 8px; font-family: inherit;
		font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
	}
	.btn-install:hover { opacity: 0.85; }
	.btn-dismiss {
		background: none; border: none; color: var(--paper);
		opacity: 0.6; font-size: 1.2rem; cursor: pointer; padding: 0 0.2rem; line-height: 1;
	}
	.btn-dismiss:hover { opacity: 1; }

	@media (max-width: 640px) {
		.install-banner { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 0.75rem); }
	}
</style>
