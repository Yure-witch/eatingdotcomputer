<script>
	let { userId, name, x = 0, y = 0, onlineIds = new Set() } = $props();

	let profile = $state(null);
	let loading = $state(true);

	const cache = {};

	$effect(() => {
		if (!userId) return;
		loading = true;
		if (cache[userId]) {
			profile = cache[userId];
			loading = false;
			return;
		}
		fetch(`/api/profile/${userId}`)
			.then((r) => r.ok ? r.json() : null)
			.then((d) => {
				if (d) cache[userId] = d;
				profile = d;
				loading = false;
			})
			.catch(() => { loading = false; });
	});

	let online = $derived(onlineIds.has(userId));
</script>

{#if userId}
	<div class="hover-card" style="left: {x}px; top: {y}px">
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
						{#if online}<span class="hc-online">● online</span>{/if}
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
{/if}

<style>
	.hover-card {
		position: fixed;
		z-index: 1000;
		background: #1a1a1a;
		color: #c8c1b4;
		border-radius: 12px;
		padding: 1rem;
		width: 220px;
		box-shadow: 0 8px 32px rgba(0,0,0,0.35);
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		font-size: 0.82rem;
	}

	.hc-loading { color: #666; font-size: 0.8rem; }

	.hc-top { display: flex; gap: 0.6rem; align-items: flex-start; }

	.hc-avatar {
		width: 36px; height: 36px; border-radius: 8px;
		background: #333; color: #f7f2ea;
		display: flex; align-items: center; justify-content: center;
		font-family: 'Cambridge', serif; font-size: 1.1rem; flex-shrink: 0;
	}

	.hc-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }

	.hc-name-row { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
	.hc-name { font-weight: 600; color: #f7f2ea; font-size: 0.88rem; }
	.hc-pronouns { font-size: 0.72rem; color: #666; }

	.hc-sub-row { display: flex; align-items: center; gap: 0.5rem; }
	.hc-online { font-size: 0.72rem; color: #4caf50; }
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
		text-underline-offset: 2px; pointer-events: auto;
	}

	.hc-link {
		font-size: 0.72rem; color: #888; text-decoration: none;
		margin-top: 0.1rem; pointer-events: auto;
	}
	.hc-link:hover { color: #f7f2ea; }
</style>
