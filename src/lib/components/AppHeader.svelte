<script>
	import ClassSwitcher from './ClassSwitcher.svelte';
	import UserMenu from './UserMenu.svelte';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import NotificationBell from './NotificationBell.svelte';
	import { pageTitle, pageTitleHref } from '$lib/page-title-store.js';

	let { currentClass = null, allClasses = [], user = null } = $props();
</script>

<header class="app-header">
	<div class="wordmark-wrap">
		<a class="wordmark" href="/">eating.computer</a>
		<ClassSwitcher {currentClass} {allClasses} />
	</div>
	{#if $pageTitle}
		<!-- Per-page title (e.g. chat channel name, DM partner). Pages
		     publish this via the pageTitle store — set on mount, clear
		     on destroy. If the page also sets pageTitleHref, the title
		     renders as a link (e.g. DM partner's name → their profile),
		     otherwise as plain text.
		     The class name renders as a subtitle directly under the
		     title so a #channel or a DM partner is always grounded in
		     which class context the conversation belongs to. */ -->
		<div class="page-title-block">
			{#if $pageTitleHref}
				<a class="page-title page-title-link" href={$pageTitleHref}>{$pageTitle}</a>
			{:else}
				<h1 class="page-title">{$pageTitle}</h1>
			{/if}
			{#if currentClass?.name}
				<span class="page-subtitle">{currentClass.name}</span>
			{/if}
		</div>
	{/if}
	<div class="header-right">
		<NotificationBell {user} />
		<ThemeSwitcher />
		<UserMenu {user} />
	</div>
</header>

<style>
	.app-header {
		display: flex; align-items: center; gap: 2rem;
		padding: 1rem 2rem; border-bottom: 1.5px solid var(--border);
		position: fixed; top: 0; right: 0; left: var(--sidebar-width, 220px); z-index: 10;
		background: var(--paper); box-sizing: border-box;
	}
	.wordmark-wrap {
		display: flex; flex-direction: column; gap: 0.1rem; flex-shrink: 0;
	}
	.wordmark {
		font-family: 'Avara', serif; font-size: 1.25rem; color: var(--ink);
		text-decoration: none; white-space: nowrap;
	}
	.wordmark:hover { opacity: 0.7; }
	/* Title + class subtitle stack. The block grows into the flex
	   space the lone <h1> used to take, so the right-side controls
	   keep their alignment. */
	.page-title-block {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 0.05rem;
		line-height: 1.15;
	}
	.page-title {
		font-family: 'Avara', serif;
		font-weight: 400;
		font-size: 1.05rem;
		color: var(--ink);
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	.page-subtitle {
		font-size: 0.72rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		text-transform: uppercase;
		letter-spacing: 0.08em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.page-title-link {
		text-decoration: none;
		padding: 0.2rem 0.45rem;
		margin: 0 -0.45rem;
		border-radius: 8px;
		transition: background 140ms ease;
	}
	.page-title-link:hover {
		background: color-mix(in srgb, var(--ink) 7%, transparent);
	}
	.header-right {
		margin-left: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	@media (max-width: 640px) {
		.app-header { left: 0; padding: 0.6rem 1rem; gap: 0.5rem; }
	}
</style>
