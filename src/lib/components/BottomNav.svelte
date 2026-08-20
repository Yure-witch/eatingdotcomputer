<script>
	import { onMount, getContext } from 'svelte';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';

	const openSidebar = getContext('openSidebar');
	// Live pager state (set by /app/+layout.svelte): the section currently in
	// view follows the swipe so the selected tab updates instantly, and the
	// chat drawer being open keeps the Chat icon selected.
	const pagerNav = getContext('pagerNav');
	const activePath = $derived(pagerNav?.activeRoute ?? $page.url.pathname);

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

	// Leaving a chat tears the focused compose input out of the DOM, and iOS does
	// not reliably fire focusout for an element that was removed rather than
	// blurred — so keyboardOpen stuck true and the bottom nav stayed hidden for
	// the rest of the session. Clear it on every navigation; a real keyboard will
	// re-announce itself via focusin.
	afterNavigate(() => { keyboardOpen = false; });

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
			// /app/weeks (the "view previous weeks" page) is a Home sub-view, so
			// keep Home selected there.
			active: (p) => p === '/app' || p.startsWith('/app/weeks'),
			iconName: 'home'
		},
		{
			href: '/app/orbit',
			label: 'Orbit',
			// Aliases include the old /app/atlas + adjacent /assignments,
			// /files, /collection routes so the active highlight survives
			// the rename until those old routes have all redirected.
			active: (p) => p.startsWith('/app/orbit') || p.startsWith('/app/atlas') || p.startsWith('/app/collection') || p.startsWith('/app/assignments') || p.startsWith('/app/files'),
			iconName: 'planet'
		},
		{
			href: '/app/lab',
			label: 'Lab',
			active: (p) => p.startsWith('/app/lab') || p.startsWith('/app/playground'),
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
	// Chat is selected on the chat menu panel OR any chat route (conversation).
	const chatActive = $derived(activePath.startsWith('/app/chat'));

	// Sliding highlight: nav slots (Home, Chat, Orbit, Lab, …) map 1:1 to the pager
	// panels, so the pill rides the live pager fraction. Off the pager (in a
	// conversation) it parks on Chat (slot 1).
	const slotCount = $derived(items.length + 1);
	// The pill's fractional position rides the CSS var `--nav-frac`, written
	// straight to <html> by the pager (imperatively, per scroll frame) for 60fps —
	// no Svelte reactivity in the hot path. We only feed it the (stable) slot count.
	//
	// …but the pager only writes that var once it has scrolled. On a cold load of
	// a non-Home route it is unset, so the pill parked on slot 0 while a
	// different item was actually selected — two things looking chosen at once.
	// This fallback puts it on the real slot until the pager takes over.
	const activeSlot = $derived.by(() => {
		if (chatActive) return 1;
		const i = items.findIndex((it) => it.active(activePath));
		return i < 0 ? 0 : (i === 0 ? 0 : i + 1);
	});
</script>

<!-- Mobile bottom nav only — desktop nav is in the global sidebar (app/+layout.svelte) -->
<nav class="bottom-nav" class:hidden={keyboardOpen}>
	<span class="nav-indicator" style:--slot-count={slotCount} style:--nav-slot={activeSlot}></span>
	<!-- Order: Home, Chat, Orbit, Lab, [Manage] — Chat sits immediately right of
	     Home so a rightward swipe out of a conversation reads as going "back". -->
	{#each items as item, idx}
		{@const isActive = !chatActive && item.active(activePath)}
		<a href={item.href} class="nav-item" class:active={isActive}
			onclick={(e) => { if (pagerNav?.goToSection?.(item.href)) e.preventDefault(); }}>
			<span class="icon-wrap">
				<span class="msi msi-24" class:msi-fill={isActive}>{item.iconName}</span>
			</span>
			<span class="label">{item.label}</span>
		</a>
		{#if idx === 0}
			<!-- Chat is a real tab: scrolls the pager to the chat-menu panel (or
			     navigates to it from a conversation). -->
			<a href="/app/chat" class="nav-item" class:active={chatActive}
				onclick={(e) => { if (pagerNav?.goToSection?.('/app/chat')) e.preventDefault(); }}>
				<span class="icon-wrap">
					<span class="msi msi-24" class:msi-fill={chatActive}>{chatIconName}</span>
					{#if totalUnread > 0}
						<span class="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
					{/if}
				</span>
				<span class="label">Chat</span>
			</a>
		{/if}
	{/each}
</nav>

<style>
	.bottom-nav { display: none; }
	.bottom-nav.hidden { display: none !important; }
	/* Hide the nav while the docked reaction picker (a full-width bottom
	   sheet on mobile) is open, exactly like it hides for the compose
	   keyboard/picker. The chat page toggles this class on <html>. */
	:global(html.reaction-picker-open) .bottom-nav { display: none !important; }
	/* Hidden while the conversation panel covers most of the screen (set live by
	   the pager in /app/+layout — follows the swipe, not just the route, so the
	   nav reveals the instant you cross halfway back toward the menu). */
	:global(html.conv-covering) .bottom-nav { display: none !important; }
	/* Coming back to the menu, rise up from the bottom instead of popping in. */
	:global(html.nav-rising) .bottom-nav { animation: nav-rise 0.32s cubic-bezier(0.33, 1, 0.68, 1); }
	@keyframes nav-rise {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	@media (max-width: 640px) {
		.bottom-nav {
			display: flex;
			position: fixed;
			/* A narrow, fully rounded pill floating clear of the screen edge —
			   icons close together, little dead space beside them, and the page
			   visibly continuing underneath rather than stopping at a bar. That
			   read is what sells the "glass", not transparency: the surface is
			   fully opaque and gets its depth from elevation alone. */
			--nav-inset: 56px;
			/* Breathing room inside the rounded ends — the slots span the padded
			   box, not the full pill, so the icons sit closer together and the
			   curves stay empty. */
			/* Enough that the surface stays VISIBLE to the left and right of the
			   selected pill at the end slots — at 3px the pill ran into the bar's
			   own curve and read as sitting on the page rather than on the bar. */
			--nav-pad: 6px;
			padding-left: var(--nav-pad);
			padding-right: var(--nav-pad);
			box-sizing: border-box;
			/* Sits just above the home indicator rather than well clear of it —
			   max() keeps a small gap on the plain web, where there is no inset. */
			bottom: max(6px, env(safe-area-inset-bottom, 0px));
			left: var(--nav-inset); right: var(--nav-inset);
			height: 60px;
			padding-bottom: 0;
			border-radius: 999px;
			/* Reuse the sidebar tokens so the mobile bottom nav reads
			   as the same chrome surface as the desktop left rail —
			   secondary-family-tinted bg + matching border + the
			   same active-pill colour scheme. Previously this was
			   var(--ink) which never tracked the theme palette. */
			/* Fully opaque — depth comes from elevation and a light top edge, not
			   from blur or translucency. */
			background: var(--sidebar-bg);
			border: 1px solid var(--sidebar-border);
			/* The boundary is only just visible — depth comes from a soft drop
			   shadow and a faint inner highlight along the top edge, never from
			   blur or transparency. */
			box-shadow:
				0 10px 30px rgba(0, 0, 0, 0.14),
				0 2px 8px rgba(0, 0, 0, 0.07),
				inset 0 1px 0 rgba(255, 255, 255, 0.45);
			z-index: 1000;
		}

		/* Sliding highlight pill — one element that glides between slots with
		   the live scroll fraction instead of a per-item pill snapping on/off.
		   Sits behind the icons (z-index 0); positioned at the icon row. */
		.nav-indicator {
			position: absolute;
			/* Concentric with the bar: the pill is inset 3px on every side, so for
			   its curve to run parallel to the bar's its radius must be the bar's
			   MINUS that inset. A fully-rounded pill's radius IS half its height,
			   so height and gap are locked together — the bar and pill heights
			   have to move together to hold a 3px gap: 60px bar (radius 30) with
			   a 54px pill (radius 27), since 30 − 3 = 27. Note `top` is measured from the PADDING box,
			   inside the 1px border, so top:3 lands 4px in from the outer edge and
			   the remaining 3px + border matches it at the bottom.

			   The width is deliberately wider than a slot: neighbouring pills
			   would overlap, which never shows because only one is ever drawn,
			   and it buys a highlight that wraps the whole item instead of
			   leaving dead space at the bar's ends.

			   Starts after the bar's inner padding, which the slot maths above
			   also subtracts. */
			top: 2px;
			left: var(--nav-pad, 0px);
			width: 78px;
			height: 54px;
			border-radius: 999px;
			/* Move with transform (compositor / GPU) instead of `left` (which forced a
			   layout reflow every scroll frame → framey). The nav is full-viewport
			   width, so each slot is 100vw/slot-count; centre on the slot, minus half
			   the pill's own width. --nav-frac is written straight to <html> by the
			   pager (imperatively, per frame) so there's no Svelte flush in the hot
			   path; --slot-count is the stable inline value. */
			/* The bar is an inset island now, so a slot is (viewport - insets) wide,
			   NOT 100vw — using the viewport put the pill progressively further
			   right than its icon. --nav-inset keeps the two in one place. */
			transform: translateX(calc((var(--nav-frac, var(--nav-slot, 0)) + 0.5) * ((100vw - (2 * var(--nav-inset, 12px)) - (2 * var(--nav-pad, 0px))) / var(--slot-count, 5)) - 50%));
			will-change: transform;
			background: var(--sidebar-active);
			border-radius: 999px;
			pointer-events: none;
			z-index: 0;
		}
		/* Set locally — .msi only defines 18/20/24, so a size class here would be
		   inventing one that doesn't exist. */
		.bottom-nav .msi { font-size: 25px; }

		.nav-item {
			position: relative;
			z-index: 1;
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			/* Glyph and label read as one unit rather than two stacked things. */
			gap: 0.05rem;
			color: var(--sidebar-fg-muted);
			opacity: 0.72;
			text-decoration: none;
			transition: color 0.15s, opacity 0.15s;
			-webkit-tap-highlight-color: transparent;
			/* reset button defaults */
			background: none;
			border: none;
			padding: 0 0.4rem;
			font-family: inherit;
			cursor: pointer;
		}
		/* Active item gets an M3 nav-bar pill behind its icon, fed by
		   the same --sidebar-active token the desktop rail uses for
		   selected rows. The pill lives on the .icon-wrap so the
		   label below stays unwrapped. Only the ICON takes the active
		   colour — the highlight pill covers just the icon, so the
		   label keeps its resting colour in every state. */
		.nav-item.active { opacity: 1; }
		.nav-item.active .icon-wrap { color: var(--sidebar-active-fg); }
		/* Darker + heavier label on the selected item, so selection doesn't rest
		   on the fill alone. */
		.nav-item.active .label { color: var(--sidebar-active-fg); font-weight: 700; }
		.nav-item:not(.active):active { color: var(--sidebar-fg-muted); }

		.label {
			font-size: 0.52rem;
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
		}
		/* The active pill is now the shared sliding .nav-indicator above. */

		.nav-badge {
			position: absolute;
			/* Touching the glyph's VISIBLE edge, not its box. A negative offset
			   pushed the badge clear of the icon entirely — the chat bubble very
			   nearly fills its 28px box, so the badge has to sit INSIDE the box
			   to overlap the artwork. Measured: right:-6 left a 5.5px gap to the
			   box (~7px to the ink); +2 closes it to a slight overlap. */
			top: -2px;
			right: 2px;
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
