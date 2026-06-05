<script>
	import { onMount, getContext } from 'svelte';
	import { page } from '$app/stores';

	const openSidebar = getContext('openSidebar');

	let { isInstructor = false, totalUnread = 0 } = $props();

	// Hide the nav when a text-input control is focused on a TOUCH
	// device — that's when focus is a reliable signal the on-screen
	// keyboard has opened. On a MacBook (or anything with a fine
	// pointer / trackpad / mouse) focusing a textbox doesn't summon
	// a keyboard, so we keep the nav visible even if the window
	// happens to be narrower than 640px (devtools, narrow split, etc.).
	//
	// `(pointer: coarse)` is the right test: phones + tablets are
	// coarse, MacBooks + desktops are fine — even iPad Safari without
	// a keyboard reports coarse. `matchMedia` lets us re-evaluate if
	// the user plugs in or unplugs a pointing device mid-session.
	let keyboardOpen = $state(false);
	let isTouchDevice = $state(false);

	function isTextInput(el) {
		if (!el || el.nodeType !== 1) return false;
		if (el.isContentEditable) return true;
		if (el.tagName === 'TEXTAREA') return true;
		if (el.tagName === 'INPUT') {
			const t = (el.type || 'text').toLowerCase();
			// File pickers, buttons, etc. don't summon a keyboard.
			return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(t);
		}
		return false;
	}

	onMount(() => {
		const mq = window.matchMedia('(pointer: coarse)');
		const updateTouch = () => { isTouchDevice = mq.matches; };
		updateTouch();
		mq.addEventListener?.('change', updateTouch);

		const onFocusIn = (e) => {
			if (!isTouchDevice) return;
			if (isTextInput(e.target)) keyboardOpen = true;
		};
		const onFocusOut = (e) => {
			if (!isTextInput(e.target)) return;
			keyboardOpen = false;
			if (!isTouchDevice) return;
			// iOS Safari has TWO bugs after a keyboard close:
			//   1. The document scroll position is left at wherever
			//      iOS scrolled to reveal the focused input, so
			//      position:fixed elements look offset.
			//   2. Even after we scroll back, fixed elements keep
			//      acting like position:absolute relative to the
			//      document — scrolling moves them with the content
			//      instead of pinning to the viewport. They stay in
			//      this broken state until something forces iOS to
			//      re-resolve their containing block.
			//
			// Fix:
			//   - rAF #1: scroll to 0 (after iOS settles).
			//   - rAF #2: set a transient `transform` on <html>.
			//     Any non-`none` transform makes the element a new
			//     containing block for fixed descendants, which is
			//     exactly what iOS needs to "wake up" and re-anchor
			//     them. We pull it back off the next frame so it
			//     doesn't actually become a containing block for
			//     keeps — the bump alone is enough.
			requestAnimationFrame(() => {
				window.scrollTo(0, 0);
				const root = document.documentElement;
				root.style.transform = 'translateZ(0)';
				requestAnimationFrame(() => {
					root.style.transform = '';
				});
			});
		};
		document.addEventListener('focusin', onFocusIn);
		document.addEventListener('focusout', onFocusOut);
		return () => {
			mq.removeEventListener?.('change', updateTouch);
			document.removeEventListener('focusin', onFocusIn);
			document.removeEventListener('focusout', onFocusOut);
			document.documentElement.classList.remove('kb-open');
		};
	});

	// Mirror the keyboard state to a class on <html> so any page CSS
	// (the chat layout that subtracts 56px for the nav, etc.) can
	// reclaim the bottom strip when the nav is hidden. CSS-only
	// solution would be cleaner, but the nav-shows-or-not decision
	// lives in JS (touch + focus), so we propagate via a class.
	$effect(() => {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		if (keyboardOpen) root.classList.add('kb-open');
		else root.classList.remove('kb-open');
	});

	// Bottom-nav icons render as Material Symbols ligatures so the FILL
	// axis is available — the active row flips to `msi-fill` for the
	// classic "outlined idle, filled selected" M3 nav-bar behaviour.
	const chatIconName = 'chat';

	const baseItems = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			iconName: 'home'
		},
		{
			href: '/app/atlas',
			label: 'Orbit',
			active: (p) => p.startsWith('/app/atlas') || p.startsWith('/app/collection') || p.startsWith('/app/assignments') || p.startsWith('/app/files'),
			iconName: 'planet'
		},
		{
			href: '/app/playground',
			label: 'Lab',
			active: (p) => p.startsWith('/app/playground'),
			iconName: 'experiment'
		}
	];

	const manageItem = {
		href: '/app/manage',
		label: 'Manage',
		active: (p) => p.startsWith('/app/manage'),
		iconName: 'tune'
	};

	const items = $derived(isInstructor ? [...baseItems, manageItem] : baseItems);
	const chatActive = $derived($page.url.pathname.startsWith('/app/chat'));
</script>

<!-- Mobile bottom nav only — desktop nav is in the global sidebar (app/+layout.svelte) -->
<nav class="bottom-nav" class:hidden={keyboardOpen}>
	<!-- Chat button opens the full-screen sidebar instead of navigating -->
	<button class="nav-item" class:active={chatActive} onclick={openSidebar} type="button">
		<span class="icon-wrap">
			<span class="msi msi-20" class:msi-fill={chatActive}>{chatIconName}</span>
			{#if totalUnread > 0}
				<span class="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
			{/if}
		</span>
		<span class="label">Chat</span>
	</button>
	{#each items as item}
		{@const isActive = item.active($page.url.pathname)}
		<a href={item.href} class="nav-item" class:active={isActive}>
			<span class="icon-wrap">
				<span class="msi msi-20" class:msi-fill={isActive}>{item.iconName}</span>
			</span>
			<span class="label">{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.bottom-nav { display: none; }
	.bottom-nav.hidden { display: none !important; }

	@media (max-width: 640px) {
		.bottom-nav {
			display: flex;
			position: fixed;
			bottom: 0; left: 0; right: 0;
			height: calc(56px + env(safe-area-inset-bottom, 0px));
			padding-bottom: env(safe-area-inset-bottom, 0px);
			/* Reuse the sidebar tokens so the mobile bottom nav reads
			   as the same chrome surface as the desktop left rail —
			   secondary-family-tinted bg + matching border + the
			   same active-pill colour scheme. Previously this was
			   var(--ink) which never tracked the theme palette. */
			background: var(--sidebar-bg);
			border-top: 1px solid var(--sidebar-border);
			z-index: 1000;
		}

		.nav-item {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.2rem;
			color: var(--sidebar-fg-muted);
			text-decoration: none;
			transition: color 0.15s;
			-webkit-tap-highlight-color: transparent;
			/* reset button defaults */
			background: none;
			border: none;
			padding: 0;
			font-family: inherit;
			cursor: pointer;
		}
		/* Active item gets an M3 nav-bar pill behind its icon, fed by
		   the same --sidebar-active token the desktop rail uses for
		   selected rows. The pill lives on the .icon-wrap so the
		   label below stays unwrapped. */
		.nav-item.active { color: var(--sidebar-active-fg); }
		.nav-item:not(.active):active { color: var(--sidebar-fg-muted); }

		.label {
			font-size: 0.58rem;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		.icon-wrap {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 3px 14px;
			border-radius: 999px;
			transition: background 0.15s;
		}
		.nav-item.active .icon-wrap {
			background: var(--sidebar-active);
		}

		.nav-badge {
			position: absolute;
			top: -6px;
			right: -8px;
			background: #e53935;
			color: #fff;
			font-size: 0.55rem;
			font-weight: 700;
			border-radius: 99px;
			padding: 0.06rem 0.28rem;
			min-width: 14px;
			text-align: center;
			line-height: 1.5;
			pointer-events: none;
		}
	}
</style>
