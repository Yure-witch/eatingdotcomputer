<script>
	import { onMount, getContext } from 'svelte';
	import { page, navigating } from '$app/stores';
	import { goto } from '$app/navigation';
	import ClassSwitcher from './ClassSwitcher.svelte';
	import UserMenu from './UserMenu.svelte';
	import NotificationBell from './NotificationBell.svelte';
	import { pageTitle, pageTitleHref } from '$lib/page-title-store.js';
	import GemmaIcon from '$lib/components/GemmaIcon.svelte';

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
	// Real conversations = pager panel 0 (they can be swiped away in the pager).
	const _isPagerConv = $derived(
		_convRe.test($page.url.pathname) ||
		(!!$navigating && _convRe.test($navigating.to?.url?.pathname ?? ''))
	);
	// Gemma and Tasks aren't message threads, but they're chat-adjacent surfaces
	// reached from the chat menu — give them the same focused chat bar (name +
	// class + ✕ close) on mobile, and the same swipe-away state below.
	const _chatLikeRe = /^\/app\/chat\/gemma$|^\/app\/goals$|^\/app\/inspiration$/;
	const _isConv = $derived(
		_isPagerConv ||
		_chatLikeRe.test($page.url.pathname) ||
		(!!$navigating && _chatLikeRe.test($navigating.to?.url?.pathname ?? ''))
	);
	let _isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia('(max-width: 640px)');
		const u = () => (_isMobile = mq.matches);
		u();
		mq.addEventListener?.('change', u);
		return () => mq.removeEventListener?.('change', u);
	});
	// On mobile a chat surface is a layer over the pager: while you swipe it away
	// the route is briefly still the chat, so drop chat-mode live with the finger
	// rather than at the commit. This covers Gemma / Tasks / Recommendations as
	// well as real conversations — in chat mode the header renders ONLY the title
	// block, so if the title clears before the route changes the bar is empty, and
	// on those surfaces that lasted the whole navigation.
	// `convCovering` is true whenever a chat surface owns the screen (including
	// one being navigated into), so `=== false` here means swiped past — not
	// merely "not a pager conversation", which is what it used to mean.
	const _convSwipedAway = $derived(
		_isConv && _isMobile && !!pagerNav && pagerNav.convCovering === false
	);
	const _convMobile = $derived(_isConv && _isMobile && !_convSwipedAway);

	// When a page publishes a title, the title lockup carries the class
	// switcher; the wordmark block is then EMPTY on desktop (the wordmark
	// itself is desktop-hidden — the sidebar has it) but still eats a flex
	// gap, indenting the title ~2rem past where other pages' header content
	// starts. Hide the whole block on desktop in that case.
	const _titleHasSwitcher = $derived(!!($pageTitle && currentClass?.name && !_convSwipedAway));
	// A page title is showing (Tasks, Gemma, a channel …). On mobile that means
	// the "eating.computer" wordmark is redundant — the title IS the heading —
	// so we hide the wordmark and let the section name stand alone.
	const _titlePresent = $derived(!!$pageTitle && !_convSwipedAway);
	const _isGemma = $derived($page.url.pathname === '/app/chat/gemma');
	// A small identifying glyph next to the title. Gemma keeps its own mark;
	// other chat surfaces get a chat bubble; Tasks gets a target.
	const _titleIcon = $derived.by(() => {
		const p = $page.url.pathname;
		if (p === '/app/chat/gemma') return 'gemma';
		if (p.startsWith('/app/chat')) return 'chat';
		if (p === '/app/goals') return 'tasks';
		if (p === '/app/inspiration') return 'tasks';
		return null;
	});

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
	{#if _convMobile}
		<!-- ✕ close in the TOP-LEFT corner (iOS-style). Slide back to the chat
		     menu like a swipe would; hard-navigate if the pager isn't active. -->
		<button class="header-close header-close-left" onclick={() => { if (!pagerNav?.slideToChatMenu?.()) goto('/app/chat'); }} title="Close chat" aria-label="Close chat">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
		</button>
	{/if}
	{#if !_convMobile}
		<div class="wordmark-wrap" class:desktop-hidden={_titleHasSwitcher} class:title-present={_titlePresent}>
			<a class="wordmark" href="/">eating.computer</a>
			<!-- When a page title is showing, ITS lockup carries the class
			     switcher (title + dropdown) — don't render a second, lone
			     switcher under the wordmark next to it. -->
			{#if !_titleHasSwitcher}
				<ClassSwitcher {currentClass} {allClasses} />
			{/if}
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
			<div class="page-title-row">
				{#if _titleIcon === 'gemma'}<GemmaIcon size={22} />{:else if _titleIcon === 'chat'}<svg class="title-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>{:else if _titleIcon === 'tasks'}<svg class="title-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg>{/if}
				{#if $pageTitleHref}
					<a class="page-title page-title-link" href={$pageTitleHref}>{$pageTitle}</a>
				{:else}
					<h1 class="page-title">{$pageTitle}</h1>
				{/if}
				{#if _isGemma}<span class="page-title-desc">AI assistant · runs on your own key</span>{/if}
			</div>
			{#if currentClass?.name}
				<!-- The class dropdown rides under the page title on every
				     surface (mobile chat bar AND desktop) — not a plain-text
				     label. Same ClassSwitcher the wordmark block carries. -->
				<ClassSwitcher {currentClass} {allClasses} />
			{/if}
		</div>
	{/if}
	<div class="header-right">
		{#if !_convMobile}
			<!-- Bell sits top-right, just left of the profile photo -->
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
	@media (min-width: 641px) {
		/* Empty on desktop when the title carries the switcher — drop it so
		   the title lockup starts at the same left offset as every page. */
		.wordmark-wrap.desktop-hidden { display: none; }
	}
	/* Title + class subtitle stack. The block grows into the flex
	   space the lone <h1> used to take, so the right-side controls
	   keep their alignment. */
	.page-title-row { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
	.title-icon { color: var(--accent); flex-shrink: 0; }
	.page-title-desc { font-size: 0.72rem; color: var(--muted-fg); white-space: nowrap; }
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
		/* When a page publishes its own title (Tasks, Gemma, a channel), the
		   "eating.computer" wordmark is redundant on mobile — drop it so the
		   section name stands alone as the heading instead of sitting beside it. */
		.wordmark-wrap.title-present { display: none; }
		/* Match the wordmark-wrap's exact metrics (1.25rem heading + 0.1rem gap)
		   so a titled page (Tasks / Weeks / Gemma) is the SAME header height as
		   Home / Orbit — otherwise the tighter title block read a few px shorter. */
		.page-title { font-size: 1.25rem; }
		.page-title-block { gap: 0.1rem; line-height: normal; }
		/* The inline "AI assistant · …" note crowds the title on a phone and
		   truncated it to "Gem…"; the class subtitle already grounds the page. */
		.page-title-desc { display: none; }
		/* Focused chat bar: match the standard header's wordmark-wrap dimensions
		   exactly (chat name == the 1.25rem wordmark, class subtitle == the
		   0.72rem class label, same 0.1rem gap) so the chat header is the same
		   height as every other page's header. */
		.app-header.conv-mobile .page-title-block { flex: 1; gap: 0.1rem; line-height: normal; }
		.app-header.conv-mobile .page-title { font-size: 1.25rem; }
		/* A DM's title is a LINK (to the partner's profile); its vertical padding
		   made the DM header ~6px taller than a channel's plain title, so leaving a
		   DM changed --header-h and relayed out the pager mid-snap (DMs settled
		   weird, channels didn't). Drop the vertical padding so every conversation
		   header is the exact same height. */
		.app-header.conv-mobile .page-title-link { padding-top: 0; padding-bottom: 0; }
	}
</style>
