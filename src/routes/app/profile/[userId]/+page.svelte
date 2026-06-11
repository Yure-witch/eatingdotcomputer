<script>
	import { onMount, tick } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';

	let { data } = $props();
	const { profile, isOwnProfile, currentUserId } = data;
	const { contentHtml } = createContentRenderer();

	// Mount static-frame emotes after the bio renders so TG / TGC
	// tokens animate / show frames instead of empty spans.
	let bioEl = $state(null);
	$effect(() => {
		if (!bioEl) return;
		void profile.bio;
		tick().then(() => mountStaticEmotes(bioEl));
	});

	function formatJoined(str) {
		if (!str) return '';
		return new Date(str).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	}

	function formatLastSeen(ts) {
		if (!ts) return 'never';
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>{profile.name || 'Profile'} — eating.computer</title></svelte:head>

<div class="shell">
	<header>
		<a class="wordmark" href="/">eating.computer</a>
		<nav>
			<a href="/app">Dashboard</a>
			<a href="/app/chat">Chat</a>
		</nav>
	</header>

	<main>
		<a class="back" href="/app">← Back</a>

		<div class="profile-card">
			<div class="profile-top">
				<Avatar
					name={profile.name ?? ''}
					uid={profile.id}
					avatarKind={profile.avatarKind ?? 'gen'}
					avatarValue={profile.avatarValue ?? null}
					size={84}
				/>
				<div class="profile-meta">
					<div class="name-row">
						<h1>{profile.name || 'Unnamed'}</h1>
						{#if profile.pronouns}
							<span class="pronouns">{profile.pronouns}</span>
						{/if}
						<span class="role-pill" class:instructor={profile.role === 'instructor'}>{profile.role}</span>
					</div>
					<div class="status-row">
						{#if profile.online}
							<span class="status-online">● online</span>
						{:else}
							<span class="status-offline">○ last seen {formatLastSeen(profile.lastSeen)}</span>
						{/if}
						{#if profile.joinedAt}
							<span class="joined">Joined {formatJoined(profile.joinedAt)}</span>
						{/if}
					</div>
				</div>
				<div class="profile-actions">
					{#if isOwnProfile}
						<a class="btn-secondary" href="/app/profile/edit">Edit profile</a>
					{:else}
						<a class="btn-primary" href="/app/chat/dm/{[currentUserId, profile.id].sort().join('-')}">Message</a>
					{/if}
				</div>
			</div>

			{#if profile.bio}
				<div class="section">
					<h2>About</h2>
					<p class="bio" bind:this={bioEl}>{@html contentHtml(profile.bio, false)}</p>
				</div>
			{/if}

			<!-- Study details: year + school + focus. Rendered together
			     as a key/value list whenever any of the three is set so
			     the layout stays cohesive even with partial info. -->
			{#if profile.year || profile.school || profile.focus}
				<div class="section">
					<h2>Studies</h2>
					<dl class="detail-list">
						{#if profile.year}
							<div class="detail-row">
								<dt>Year</dt>
								<dd>{profile.year}</dd>
							</div>
						{/if}
						{#if profile.school}
							<div class="detail-row">
								<dt>School</dt>
								<dd>{profile.school}</dd>
							</div>
						{/if}
						{#if profile.focus}
							<div class="detail-row">
								<dt>Focus</dt>
								<dd>{profile.focus}</dd>
							</div>
						{/if}
					</dl>
				</div>
			{/if}

			{#if profile.website}
				<div class="section">
					<h2>Website</h2>
					<a class="website-link" href={profile.website} target="_blank" rel="noopener noreferrer">{profile.website.replace(/^https?:\/\//, '')}</a>
				</div>
			{/if}

			{#if !profile.bio && !profile.website && !profile.year && !profile.school && !profile.focus && !isOwnProfile}
				<p class="empty">This person hasn't filled out their profile yet.</p>
			{/if}

			{#if isOwnProfile && !profile.bio && !profile.website && !profile.year && !profile.school && !profile.focus}
				<div class="empty-own">
					<p>Your profile is pretty bare. <a href="/app/profile/edit">Add a bio, school, and more →</a></p>
				</div>
			{/if}
		</div>
	</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	header {
		display: flex;
		align-items: center;
		gap: 2rem;
		padding: 1rem 2rem;
		border-bottom: 1.5px solid var(--border);
	}

	.wordmark {
		font-family: 'Avara', serif;
		font-size: 1.25rem;
		color: var(--ink);
		text-decoration: none;
		flex-shrink: 0;
	}
	.wordmark:hover { opacity: 0.7; }

	nav { display: flex; gap: 1.25rem; font-size: 0.875rem; }
	nav a { color: var(--muted-fg); text-decoration: none; font-weight: 500; }
	nav a:hover { color: var(--ink); }

	main {
		padding: 2rem;
		max-width: 640px;
		width: 100%;
		margin: 0 auto;
	}

	.back {
		display: inline-block;
		font-size: 0.85rem;
		color: var(--muted-fg);
		text-decoration: none;
		margin-bottom: 1.5rem;
	}
	.back:hover { color: var(--ink); }

	.profile-card {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.profile-top {
		display: flex;
		align-items: flex-start;
		gap: 1.25rem;
		flex-wrap: wrap;
	}

	/* Old .avatar styles removed — the shared Avatar component
	   owns the typography + gradient now. */

	.profile-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.name-row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	h1 {
		font-family: 'Avara', serif;
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0;
		color: var(--ink);
	}

	.pronouns {
		font-size: 0.85rem;
		color: var(--muted-fg);
	}

	.role-pill {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--surface-2);
		color: var(--muted-fg);
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
	}
	.role-pill.instructor { background: var(--ink); color: var(--paper); }

	.status-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}

	.status-online { color: #2e7d32; font-weight: 600; }
	.status-offline { color: #bbb; }
	.joined { color: var(--muted-fg); }

	.profile-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.btn-primary {
		padding: 0.5rem 1.1rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }

	.btn-secondary {
		padding: 0.5rem 1.1rem;
		background: none;
		color: var(--ink);
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
		transition: border-color 0.15s;
	}
	.btn-secondary:hover { border-color: var(--ink); }

	.section h2 {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		margin: 0 0 0.5rem;
	}

	.bio {
		font-size: 0.9rem;
		color: var(--ink);
		line-height: 1.6;
		margin: 0;
		white-space: pre-wrap;
	}

	.detail-list {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.detail-row {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 0.75rem;
		align-items: baseline;
	}
	.detail-row dt {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted-fg);
		margin: 0;
	}
	.detail-row dd {
		font-size: 0.9rem;
		color: var(--ink);
		margin: 0;
		line-height: 1.4;
	}

	.website-link {
		font-size: 0.9rem;
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.empty {
		font-size: 0.9rem;
		color: var(--muted-fg);
		margin: 0;
	}

	.empty-own {
		background: var(--surface-2);
		border: 1.5px dashed var(--border);
		border-radius: 10px;
		padding: 1rem 1.25rem;
		font-size: 0.9rem;
		color: var(--muted-fg);
	}
	.empty-own p { margin: 0; }
	.empty-own a { color: var(--ink); }
</style>
