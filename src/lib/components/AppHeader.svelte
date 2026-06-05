<script>
	import ClassSwitcher from './ClassSwitcher.svelte';
	import UserMenu from './UserMenu.svelte';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import NotificationBell from './NotificationBell.svelte';
	import { pageTitle } from '$lib/page-title-store.js';

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
		     on destroy — so the global header always shows where you
		     are without the page needing to render its own duplicate
		     title bar. -->
		<h1 class="page-title">{$pageTitle}</h1>
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
	.page-title {
		font-family: 'Avara', serif;
		font-weight: 400;
		font-size: 1.05rem;
		color: var(--ink);
		margin: 0;
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
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
