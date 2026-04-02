<script module>
	// Shared across all instances so re-hovering the same user is instant
	const cache = {};
</script>

<script>
	import { onMount } from 'svelte';

	let { userId, children } = $props();

	const CARD_W = 228;
	const CARD_H = 220;

	let profile = $state(null);
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
		return () => {
			scrollEl?.removeEventListener('scroll', updatePos);
			window.removeEventListener('resize', updatePos);
		};
	});

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
				<div class="hc-avatar">{profile.name?.[0]?.toUpperCase() ?? '?'}</div>
				<div class="hc-meta">
					<div class="hc-name-row">
						<span class="hc-name">{profile.name || 'Unnamed'}</span>
						{#if profile.pronouns}<span class="hc-pronouns">{profile.pronouns}</span>{/if}
					</div>
					<div class="hc-sub-row">
						<span class="hc-role" class:instructor={profile.role === 'instructor'}>{profile.role}</span>
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
				<p class="hc-bio">{profile.bio.slice(0, 120)}{profile.bio.length > 120 ? '…' : ''}</p>
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
		background: #1a1a1a;
		color: #c8c1b4;
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

	.hc-loading { color: #666; font-size: 0.8rem; }

	.hc-top { display: flex; gap: 0.6rem; align-items: flex-start; }

	.hc-avatar {
		width: 36px; height: 36px; border-radius: 8px;
		background: #333; color: #f7f2ea;
		display: flex; align-items: center; justify-content: center;
		font-family: 'Avara', serif; font-size: 1.1rem; flex-shrink: 0;
	}

	.hc-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }

	.hc-name-row { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
	.hc-name { font-weight: 600; color: #f7f2ea; font-size: 0.88rem; }
	.hc-pronouns { font-size: 0.72rem; color: #666; }

	.hc-sub-row { display: flex; align-items: center; gap: 0.5rem; }
	.hc-role {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: #333; color: #888; padding: 0.1rem 0.35rem; border-radius: 99px;
	}
	.hc-role.instructor { background: #f7f2ea; color: #1a1a1a; }

	.hc-details { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.hc-tag {
		font-size: 0.7rem; background: #2a2a2a; color: #a09688;
		padding: 0.15rem 0.5rem; border-radius: 99px;
	}

	.hc-bio { font-size: 0.78rem; color: #a09688; margin: 0; line-height: 1.5; }

	.hc-website {
		font-size: 0.72rem; color: #888; text-decoration: underline;
		text-underline-offset: 2px;
	}

	.hc-link {
		font-size: 0.72rem; color: #888; text-decoration: none; margin-top: 0.1rem;
	}
	.hc-link:hover { color: #f7f2ea; }
</style>
