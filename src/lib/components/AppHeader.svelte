<script>
	import { onMount, getContext } from 'svelte';
	import { page, navigating } from '$app/stores';
	import { goto } from '$app/navigation';
	import ClassSwitcher from './ClassSwitcher.svelte';
	import UserMenu from './UserMenu.svelte';
	import NotificationBell from './NotificationBell.svelte';
	import { pageTitle, pageTitleHref } from '$lib/page-title-store.js';

	// Live pager state (set by /app/+layout). Lets the header switch out of
	// chat-mode the moment a conversation is swiped past halfway toward the menu,
	// rather than lingering on the chat name until the route commit settles.
	const pagerNav = getContext('pagerNav');

	let { currentClass = null, allClasses = [], user = null } = $props();

	// In an individual conversation on mobile the header becomes a focused chat
	// bar: chat name + class subtitle on the left, a close (✕) on the right, and
	// the wordmark / bell / user menu hidden.
	// True while in a conversation OR already navigating to one — so the chat
	// header is shown immediately on tap and doesn't flicker standard→chat as
	// the route commits.
	const _convRe = /^\/app\/chat\/(channel|dm)\//;
	const _isConv = $derived(
		_convRe.test($page.url.pathname) ||
		(!!$navigating && _convRe.test($navigating.to?.url?.pathname ?? ''))
	);
	let _isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia('(max-width: 640px)');
		const u = () => (_isMobile = mq.matches);
		u();
		mq.addEventListener?.('change', u);
		return () => mq.removeEventListener?.('change', u);
	});
	// On mobile the conversation is a pager panel: while you swipe it away toward
	// the menu (covering = false) the route is briefly still the conversation, so
	// drop chat-mode live with the scroll. Other routes (desktop, profile, …)
	// ignore convCovering — they aren't pager conversations.
	const _convSwipedAway = $derived(
		_isConv && _isMobile && !!pagerNav && pagerNav.convCovering === false
	);
	const _convMobile = $derived(_isConv && _isMobile && !_convSwipedAway);

	// Publish the header's real rendered height as --header-h so the pager
	// panels / chat menu / overlay can sit EXACTLY below it (the hardcoded 52px
	// was a few px short, so the menu underlapped the bar). Tracks changes
	// (subtitle wrap, safe-area, font load) via ResizeObserver.
	let headerEl = $state(null);
	$effect(() => {
		if (!headerEl || typeof ResizeObserver === 'undefined') return;
		const apply = () => document.documentElement.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
		apply();
		const ro = new ResizeObserver(apply);
		ro.observe(headerEl);
		return () => ro.disconnect();
	});
</script>

<header class="app-header" class:conv-mobile={_convMobile} bind:this={headerEl}>
	{#if !_convMobile}
		<div class="wordmark-wrap">
			<a class="wordmark" href="/">eating.computer</a>
			<ClassSwitcher {currentClass} {allClasses} />
		</div>
	{/if}
	{#if $pageTitle && !_convSwipedAway}
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
		{#if _convMobile}
			<button class="header-close" onclick={() => goto('/app/chat')} title="Close chat" aria-label="Close chat">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		{:else}
			<NotificationBell {user} />
			<UserMenu {user} />
		{/if}
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
	.header-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border: none;
		border-radius: 10px;
		background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.05));
		color: var(--ink);
		cursor: pointer;
	}
	.header-close:active { background: color-mix(in srgb, var(--ink) 12%, transparent); }

	@media (max-width: 640px) {
		.app-header { left: 0; padding: 0.6rem 1rem; gap: 0.5rem; }
		/* Focused chat bar: match the standard header's wordmark-wrap dimensions
		   exactly (chat name == the 1.25rem wordmark, class subtitle == the
		   0.72rem class label, same 0.1rem gap) so the chat header is the same
		   height as every other page's header. */
		.app-header.conv-mobile .page-title-block { flex: 1; gap: 0.1rem; line-height: normal; }
		.app-header.conv-mobile .page-title { font-size: 1.25rem; }
	}
</style>
