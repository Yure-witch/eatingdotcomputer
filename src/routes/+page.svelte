<script>
	// Public homepage: the teaching archive with a log-in button. Signed-in
	// visitors are redirected to /app by +page.server.js and reach the same
	// archive from the sidebar (/app/years).
	import YearsArchive from '$lib/components/YearsArchive.svelte';
	import { archive } from '$lib/archive.js';
</script>

<svelte:head>
	<title>eating.computer</title>
	<meta name="description" content="{archive.owner}: {archive.intro}" />
</svelte:head>

<div class="public">
	<header class="topbar">
		<a class="site" href="/">eating.computer</a>
		<a class="login" href="/login">Log in</a>
	</header>
	<main class="public-main">
		<YearsArchive />
	</main>
</div>

<style>
	.public {
		--archive-top: 5rem;
		min-height: 100dvh;
		background: var(--paper);
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem max(1rem, env(safe-area-inset-right)) 0.85rem max(1rem, env(safe-area-inset-left));
		padding-top: max(0.85rem, env(safe-area-inset-top));
		background: var(--paper);
		border-bottom: 1px solid var(--border);
	}
	.site {
		font-family: 'Avara', serif;
		font-weight: 700;
		font-size: 1.2rem;
		color: var(--ink);
		text-decoration: none;
	}
	.login {
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--paper);
		background: var(--ink);
		text-decoration: none;
		padding: 0.5rem 1.15rem;
		border-radius: 999px;
		transition: background 0.15s, color 0.15s;
	}
	.login:hover { background: var(--accent); color: var(--paper); }
	.site:focus-visible,
	.login:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	/* The global `main` rule centres a full-height grid and hides overflow
	   (which would also break the sticky year spines); this page is a
	   normal top-down document. */
	main.public-main {
		display: block;
		min-height: 0;
		padding: 0;
		overflow: visible;
		place-items: initial;
	}
</style>
