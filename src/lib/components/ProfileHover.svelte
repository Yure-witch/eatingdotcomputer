<script module>
	// Shared across all instances so re-hovering the same user is instant
	const cache = {};
</script>

<script>
	import { onMount, tick, getContext } from 'svelte';
	import Avatar from './Avatar.svelte';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';

	let { userId, children } = $props();
	const { contentHtml } = createContentRenderer();
	// Live presence comes from the layout's contexts so the hover
	// card reflects whatever the sidebar / chat bubble dot is showing
	// — no separate Firebase subscription needed.
	const presenceStatusCtx = getContext('presenceStatus');
	const rawPresenceCtx = getContext('rawPresence');
	// Tick once a minute so "last active 4m ago" rolls forward while
	// the card is open without waiting for a presence write.
	let nowTick = $state(Date.now());
	let nowTickTimer;

	const CARD_W = 228;
	const CARD_H = 220;

	let profile = $state(null);
	let bioEl = $state(null);
	$effect(() => {
		if (!bioEl || !profile?.bio) return;
		tick().then(() => mountStaticEmotes(bioEl));
	});
	let loading = $state(true);
	let anchorEl = $state(null);
	let x = $state(0);
	let y = $state(0);
	let mobileActive = $state(false);

	$effect(() => {
		if (!userId) return;
		loading = true;
		if (cache[userId]) { profile = cache[userId]; loading = false; return; }
		fetch(`/api/profile/${userId}`)
			.then(r => r.ok ? r.json() : null)
			.then(d => { if (d) cache[userId] = d; profile = d; loading = false; })
			.catch(() => { loading = false; });
	});

	function updatePos() {
		if (!anchorEl) return;
		const rect = anchorEl.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let cx = rect.right + 8;
		if (cx + CARD_W > vw) cx = Math.max(8, rect.left - CARD_W - 8);
		let cy = rect.top;
		if (cy + CARD_H > vh) cy = Math.max(8, vh - CARD_H - 8);
		x = cx;
		y = cy;
	}

	onMount(() => {
		updatePos();
		// Keep position accurate while the message list scrolls
		const scrollEl = anchorEl?.closest('.message-list');
		scrollEl?.addEventListener('scroll', updatePos, { passive: true });
		window.addEventListener('resize', updatePos, { passive: true });
		nowTickTimer = setInterval(() => { nowTick = Date.now(); }, 60_000);
		return () => {
			scrollEl?.removeEventListener('scroll', updatePos);
			window.removeEventListener('resize', updatePos);
			clearInterval(nowTickTimer);
		};
	});

	// Derived presence summary for the hovered user. Reads both the
	// 'active' / 'idle' / 'offline' classification AND the underlying
	// lastInputAt timestamp so the card can show:
	//   active   → "Active now"
	//   idle     → "Last active {N} ago"  (relative to lastInputAt)
	//   offline  → "Last online {N} ago"  (also relative to lastInputAt,
	//              since lastSeen is the heartbeat — input is the real
	//              "was here doing things" signal)
	const presence = $derived.by(() => {
		nowTick; // keep the relative phrasing fresh as time passes
		if (!userId) return null;
		const status = presenceStatusCtx?.value?.[userId] ?? 'offline';
		const raw = rawPresenceCtx?.value?.[userId];
		let lastInputAt = raw?.lastInputAt ?? 0;
		if (Array.isArray(raw?.devices)) {
			for (const d of raw.devices) lastInputAt = Math.max(lastInputAt, d.lastInputAt ?? 0);
		}
		// Fall back to lastSeen if no device ever wrote lastInputAt
		// (pre-rollout sessions). It's the next best proxy.
		if (!lastInputAt) lastInputAt = raw?.lastSeen ?? 0;
		return { status, lastInputAt };
	});

	function formatRelative(ts) {
		if (!ts) return 'a while ago';
		const diff = Math.max(0, nowTick - ts);
		if (diff < 60_000) return 'just now';
		const mins = Math.floor(diff / 60_000);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	// Mobile: tap the name to toggle; tap anywhere else to dismiss
	function onTap(e) {
		if (!window.matchMedia('(hover: none)').matches) return;
		e.stopPropagation();
		mobileActive = !mobileActive;
		if (mobileActive) updatePos();
	}

	$effect(() => {
		if (!mobileActive) return;
		function onOutside() { mobileActive = false; }
		document.addEventListener('click', onOutside);
		return () => document.removeEventListener('click', onOutside);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="ph-anchor" class:active={mobileActive} bind:this={anchorEl} onclick={onTap}>
	{@render children?.()}

	<div class="hover-card" style="left:{x}px;top:{y}px">
		{#if loading}
			<div class="hc-loading">…</div>
		{:else if profile}
			<div class="hc-top">
				<Avatar
					name={profile.name ?? ''}
					uid={profile.id ?? userId}
					avatarKind={profile.avatarKind ?? 'gen'}
					avatarValue={profile.avatarValue ?? null}
					size={44}
				/>
				<div class="hc-meta">
					<div class="hc-name-row">
						<span class="hc-name">{profile.name || 'Unnamed'}</span>
						{#if profile.pronouns}<span class="hc-pronouns">{profile.pronouns}</span>{/if}
					</div>
					<div class="hc-sub-row">
						<span class="hc-role" class:instructor={profile.role === 'instructor'}>{profile.role}</span>
						{#if presence}
							<span class="hc-status hc-status-{presence.status}">
								<span class="hc-status-dot"></span>
								{#if presence.status === 'active'}
									Active now
								{:else if presence.status === 'idle'}
									Last active {formatRelative(presence.lastInputAt)}
								{:else}
									Last online {formatRelative(presence.lastInputAt)}
								{/if}
							</span>
						{/if}
					</div>
				</div>
			</div>
			{#if profile.year || profile.school || profile.focus}
				<div class="hc-details">
					{#if profile.year}<span class="hc-tag">{profile.year}</span>{/if}
					{#if profile.school}<span class="hc-tag">{profile.school}</span>{/if}
					{#if profile.focus}<span class="hc-tag">{profile.focus}</span>{/if}
				</div>
			{/if}
			{#if profile.bio}
				<!-- Bio may contain inline emote tokens; render through
				     contentHtml so the chips show as actual emotes
				     instead of `[ek:…]` / `[tg:…]` raw strings. We
				     truncate the SOURCE string before rendering so a
				     long token doesn't get split mid-marker. -->
				<p class="hc-bio" bind:this={bioEl}>{@html contentHtml(profile.bio.slice(0, 200), false)}{profile.bio.length > 200 ? '…' : ''}</p>
			{/if}
			{#if profile.website}
				<a class="hc-website" href={profile.website} target="_blank" rel="noopener noreferrer">
					{profile.website.replace(/^https?:\/\//, '')}
				</a>
			{/if}
			<a class="hc-link" href="/app/profile/{userId}">View full profile →</a>
		{/if}
	</div>
</span>

<style>
	.ph-anchor {
		position: relative;
		display: inline;
	}

	/* Card hidden by default; shown on CSS hover (desktop) or .active (mobile tap) */
	.hover-card {
		display: none;
		position: fixed;
		z-index: 1000;
		background: var(--ink);
		color: var(--border);
		border-radius: 12px;
		padding: 1rem;
		width: 220px;
		box-shadow: 0 8px 32px rgba(0,0,0,0.35);
		flex-direction: column;
		gap: 0.6rem;
		font-size: 0.82rem;
		/* Don't let the card itself close the mobile tap */
		pointer-events: auto;
	}

	.ph-anchor:hover .hover-card,
	.ph-anchor.active .hover-card {
		display: flex;
	}

	.hc-loading { color: var(--muted-fg); font-size: 0.8rem; }

	.hc-top { display: flex; gap: 0.6rem; align-items: flex-start; }

	/* Old .hc-avatar styles removed — the Avatar component now owns
	   sizing + typography for the hover card. */

	.hc-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }

	.hc-name-row { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
	.hc-name { font-weight: 600; color: var(--paper); font-size: 0.88rem; }
	.hc-pronouns { font-size: 0.72rem; color: var(--muted-fg); }

	.hc-sub-row { display: flex; align-items: center; gap: 0.5rem; }
	.hc-role {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: #333; color: var(--muted-fg); padding: 0.1rem 0.35rem; border-radius: 99px;
	}
	.hc-role.instructor { background: var(--paper); color: var(--ink); }

	/* Live presence line. Colour-coded dot + a relative timestamp;
	   the row is hidden entirely when no presence has been written
	   for this user yet so we don't show "Last online a while ago"
	   for someone the card just doesn't have data for. */
	.hc-status {
		display: inline-flex; align-items: center; gap: 0.3rem;
		font-size: 0.68rem; color: var(--muted-fg);
		white-space: nowrap;
	}
	.hc-status-dot {
		width: 7px; height: 7px; border-radius: 50%;
		background: #888; flex-shrink: 0;
	}
	.hc-status-active { color: var(--paper); }
	.hc-status-active .hc-status-dot { background: #4caf50; }
	.hc-status-idle .hc-status-dot { background: #ffc107; }
	.hc-status-offline .hc-status-dot { background: #777; }

	.hc-details { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.hc-tag {
		font-size: 0.7rem; background: #2a2a2a; color: var(--muted-fg);
		padding: 0.15rem 0.5rem; border-radius: 99px;
	}

	.hc-bio { font-size: 0.78rem; color: var(--muted-fg); margin: 0; line-height: 1.5; }

	.hc-website {
		font-size: 0.72rem; color: var(--muted-fg); text-decoration: underline;
		text-underline-offset: 2px;
	}

	.hc-link {
		font-size: 0.72rem; color: var(--muted-fg); text-decoration: none; margin-top: 0.1rem;
	}
	.hc-link:hover { color: var(--paper); }
</style>
