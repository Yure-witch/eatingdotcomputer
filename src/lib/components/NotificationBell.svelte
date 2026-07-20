<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { db as rtdb } from '$lib/firebase.js';
	import { ref, onValue, off, set, query, limitToLast } from 'firebase/database';
	import Avatar from './Avatar.svelte';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import { getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';

	let { user = null } = $props();

	let notifs = $state({});    // live RTDB: notifId -> { type, fromUid, fromName, convType, convId, msgId, snippet, createdAt }
	let archived = $state([]);  // Turso history (>24h old), fetched once on mount
	let readAt = $state(0);
	let menuOpen = $state(false);
	let menuEl = $state(null);
	let triggerEl = $state(null);
	// Reactions get their own tab — rich-content reacts (emoji, kitchen
	// mixes, emotes, TG stickers) are a different kind of signal than
	// mentions / replies / thread replies.
	let bellTab = $state('activity'); // 'activity' | 'reactions'

	let notifsRef = null;
	let readRef = null;

	// Reaction snippets can be rich tokens ([ek:]/[ce:]/[tg:]/[tgc:]) —
	// render them through the shared message renderer like reaction chips do.
	const { contentHtml } = createContentRenderer({ getCeMap: () => getCachedCustomEmojiMap() || {} });

	const unreadCount = $derived.by(() => {
		let n = 0;
		for (const id in notifs) {
			if ((notifs[id]?.createdAt ?? 0) > readAt) n++;
		}
		return n;
	});

	const allNotifs = $derived.by(() => {
		const seen = new Set();
		const arr = [];
		for (const [id, v] of Object.entries(notifs)) { seen.add(id); arr.push({ id, ...v }); }
		for (const n of archived) { if (!seen.has(n.id)) arr.push(n); }
		arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
		return arr;
	});
	const activityNotifs = $derived(allNotifs.filter((n) => n.type !== 'reaction').slice(0, 40));
	const reactionNotifs = $derived(allNotifs.filter((n) => n.type === 'reaction').slice(0, 40));
	const sortedNotifs = $derived(bellTab === 'reactions' ? reactionNotifs : activityNotifs);
	// `readAt` is stamped to NOW the moment the menu opens (clears the bell
	// badge) — so the per-item "you haven't seen this yet" marker compares
	// against a snapshot FROZEN at open instead, and stays put while you look.
	let seenCutoff = $state(0);
	$effect(() => { if (!menuOpen) seenCutoff = readAt; });
	const isUnseen = (n) => (n.createdAt ?? 0) > seenCutoff;
	const unreadActivity = $derived(activityNotifs.filter(isUnseen).length);
	const unreadReactions = $derived(reactionNotifs.filter(isUnseen).length);

	// animate any TG sticker reacts whenever the visible list changes
	$effect(() => {
		void sortedNotifs; void menuOpen;
		if (menuOpen) tick().then(() => { if (menuEl) mountStaticEmotes(menuEl); });
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
		// archived history (>24h, synced to Turso) — merged under the live set
		fetch('/api/notifications')
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => { if (d?.notifications) archived = d.notifications; })
			.catch(() => {});
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
				<div class="menu-tabs">
					<button class="menu-tab" class:on={bellTab === 'activity'} onclick={() => (bellTab = 'activity')}>
						Activity{#if unreadActivity > 0}<span class="tab-dot">{unreadActivity}</span>{/if}
					</button>
					<button class="menu-tab" class:on={bellTab === 'reactions'} onclick={() => (bellTab = 'reactions')}>
						Reactions{#if unreadReactions > 0}<span class="tab-dot">{unreadReactions}</span>{/if}
					</button>
				</div>
				{#if sortedNotifs.length === 0}
					<div class="menu-empty">Nothing yet.</div>
				{:else}
					<div class="menu-list">
						{#each sortedNotifs as n (n.id)}
							<a
								class="notif-item"
								class:unread={isUnseen(n)}
								href={notifHref(n)}
								onclick={closeMenu}
							>
								{#if isUnseen(n)}<span class="notif-dot" aria-label="Unseen"></span>{/if}
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
												reacted <span class="notif-react">{@html contentHtml(n.snippet ?? '')}</span>
											{:else if n.type === 'thread'}
												replied in your thread
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
		/* unread is ALWAYS red — same #e53935 as the sidebar/bottom-nav badges */
		background: #e53935;
		color: #fff;
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
		right: 0; /* bell sits top-right (left of the avatar) — menu opens leftward */
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
	.menu-tabs { display: flex; gap: 0.3rem; padding: 0 6px 6px; }
	.menu-tab {
		flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
		padding: 0.32rem 0.5rem; border: 1px solid var(--border); border-radius: 8px;
		background: transparent; color: var(--muted-fg);
		font-family: inherit; font-size: 0.76rem; font-weight: 600; cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.menu-tab.on {
		background: var(--md-sys-color-secondary-container, var(--surface-2));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: var(--md-sys-color-secondary, var(--border));
	}
	.tab-dot {
		min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
		background: #e53935; color: #fff;
		font-size: 0.62rem; font-weight: 700;
		display: inline-flex; align-items: center; justify-content: center; line-height: 1;
	}
	.notif-react :global(img), .notif-react :global(.tg-emoji) {
		width: 1.2em; height: 1.2em; vertical-align: -0.25em;
	}
	.menu-empty {
		padding: 1.5rem 1rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--muted-fg);
	}
	.menu-list { display: flex; flex-direction: column; gap: 1px; max-height: 60vh; overflow-y: auto; }
	.notif-item {
		position: relative;
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
	/* red "you haven't seen this yet" dot, pinned to the row's left edge */
	.notif-dot {
		position: absolute;
		left: 2px; top: 50%; transform: translateY(-50%);
		width: 7px; height: 7px; border-radius: 50%;
		background: #e53935;
	}
	.notif-item.unread { padding-left: 14px; }
	.notif-age {
		font-size: 0.7rem;
		color: var(--muted-fg);
		flex-shrink: 0;
	}
</style>
