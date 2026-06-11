<script>
	import { onMount, onDestroy } from 'svelte';
	import { db as rtdb } from '$lib/firebase.js';
	import { ref, onValue, off, set, query, limitToLast } from 'firebase/database';
	import Avatar from './Avatar.svelte';

	let { user = null } = $props();

	let notifs = $state({}); // notifId -> { type, fromUid, fromName, convType, convId, msgId, snippet, createdAt }
	let readAt = $state(0);
	let menuOpen = $state(false);
	let menuEl = $state(null);
	let triggerEl = $state(null);

	let notifsRef = null;
	let readRef = null;

	const unreadCount = $derived.by(() => {
		let n = 0;
		for (const id in notifs) {
			if ((notifs[id]?.createdAt ?? 0) > readAt) n++;
		}
		return n;
	});

	const sortedNotifs = $derived.by(() => {
		const arr = Object.entries(notifs).map(([id, v]) => ({ id, ...v }));
		arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
		return arr.slice(0, 25);
	});

	function notifHref(n) {
		if (!n?.convType || !n?.convId) return '#';
		const base = n.convType === 'channel'
			? `/app/chat/channel/${encodeURIComponent(n.convId)}`
			: `/app/chat/dm/${encodeURIComponent(n.convId)}`;
		// `?msg=ID` tells the chat page to scroll the targeted bubble
		// into view + briefly highlight it on arrival.
		return n.msgId ? `${base}?msg=${encodeURIComponent(n.msgId)}` : base;
	}

	function formatAge(ms) {
		const dt = Date.now() - ms;
		if (dt < 60_000) return 'now';
		if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m`;
		if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h`;
		return `${Math.floor(dt / 86_400_000)}d`;
	}

	function toggleMenu() {
		menuOpen = !menuOpen;
		if (menuOpen && user?.id) {
			// Mark all current notifs as read on open: stamp readAt
			// with Date.now() so everything older drops out of the
			// badge count immediately. Future incoming notifs (newer
			// createdAt) re-light the dot.
			const now = Date.now();
			readAt = now;
			set(ref(rtdb, `notifReadAt/${user.id}`), now).catch(() => {});
		}
	}
	function closeMenu() { menuOpen = false; }

	function onWindowClick(e) {
		if (!menuOpen) return;
		if (menuEl?.contains(e.target) || triggerEl?.contains(e.target)) return;
		closeMenu();
	}
	function onKey(e) { if (e.key === 'Escape' && menuOpen) closeMenu(); }

	onMount(() => {
		if (!user?.id) return;
		notifsRef = query(ref(rtdb, `notifications/${user.id}`), limitToLast(50));
		onValue(notifsRef, (snap) => {
			const val = snap.val() || {};
			notifs = val;
		});
		readRef = ref(rtdb, `notifReadAt/${user.id}`);
		onValue(readRef, (snap) => {
			readAt = Number(snap.val() ?? 0);
		});
	});

	onDestroy(() => {
		if (notifsRef) off(notifsRef);
		if (readRef) off(readRef);
	});
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

{#if user?.id}
	<div class="notif-bell">
		<button
			bind:this={triggerEl}
			type="button"
			class="bell-btn"
			aria-label="Notifications"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={toggleMenu}
			title="Notifications"
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
				<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
			</svg>
			{#if unreadCount > 0}
				<span class="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
			{/if}
		</button>

		{#if menuOpen}
			<div bind:this={menuEl} class="menu" role="menu">
				<div class="menu-head">
					<span class="menu-title">Notifications</span>
				</div>
				{#if sortedNotifs.length === 0}
					<div class="menu-empty">Nothing yet.</div>
				{:else}
					<div class="menu-list">
						{#each sortedNotifs as n (n.id)}
							<a
								class="notif-item"
								class:unread={(n.createdAt ?? 0) > readAt}
								href={notifHref(n)}
								onclick={closeMenu}
							>
								<Avatar
									name={n.fromName}
									uid={n.fromUid}
									avatarKind={n.fromAvatarKind ?? 'gen'}
									avatarValue={n.fromAvatarValue ?? null}
									size={28}
								/>
								<span class="notif-body">
									<span class="notif-line">
										<strong>{n.fromName}</strong>
										<span class="notif-verb">
											{#if n.type === 'mention'}
												mentioned you
											{:else if n.type === 'reaction'}
												reacted {n.snippet ?? ''}
											{:else}
												replied to you
											{/if}
										</span>
									</span>
									{#if n.type !== 'reaction'}
										<span class="notif-snip">{n.snippet || ''}</span>
									{/if}
								</span>
								<span class="notif-age">{formatAge(n.createdAt ?? Date.now())}</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.notif-bell { position: relative; display: inline-flex; }
	.bell-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		transition: background 140ms ease, border-color 140ms ease;
	}
	.bell-btn:hover { background: var(--surface-2); }
	.badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--ink);
		font-size: 0.66rem;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		pointer-events: none;
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		width: min(360px, calc(100vw - 24px));
		padding: 4px;
		background: var(--paper);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.12);
		z-index: 100;
	}
	.menu-head {
		padding: 8px 10px 6px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-fg);
	}
	.menu-empty {
		padding: 1.5rem 1rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--muted-fg);
	}
	.menu-list { display: flex; flex-direction: column; gap: 1px; max-height: 60vh; overflow-y: auto; }
	.notif-item {
		display: grid;
		grid-template-columns: 28px 1fr auto;
		gap: 0.55rem;
		padding: 8px 10px;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		align-items: start;
	}
	.notif-item:hover { background: var(--surface-2); }
	.notif-item.unread { background: color-mix(in srgb, var(--accent) 12%, transparent); }
	.notif-item.unread:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
	.notif-body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
	.notif-line { font-size: 0.85rem; color: var(--ink); display: flex; gap: 0.3rem; flex-wrap: wrap; }
	.notif-verb { color: var(--muted-fg); }
	.notif-snip {
		font-size: 0.78rem;
		color: var(--muted-fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.notif-age {
		font-size: 0.7rem;
		color: var(--muted-fg);
		flex-shrink: 0;
	}
</style>
