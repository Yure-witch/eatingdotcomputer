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
			if (isTextInput(e.target)) keyboardOpen = false;
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

	const chatIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

	const baseItems = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
		},
		{
			href: '/app/atlas',
			label: 'Atlas',
			active: (p) => p.startsWith('/app/atlas') || p.startsWith('/app/collection') || p.startsWith('/app/assignments') || p.startsWith('/app/files'),
			icon: `<svg width="20" height="20" viewBox="0 -960 960 960" fill="currentColor"><path d="M280-80q-50 0-85-35t-35-85q0-39 22.5-70t57.5-43v-334q-35-12-57.5-43T160-760q0-50 35-85t85-35q50 0 85 35t35 85q0 39-22.5 70T320-647v7q0 50 35 85t85 35h80q83 0 141.5 58.5T720-320v7q35 12 57.5 43t22.5 70q0 50-35 85t-85 35q-50 0-85-35t-35-85q0-39 22.5-70t57.5-43v-7q0-50-35-85t-85-35h-80q-34 0-64.5-10.5T320-480v167q35 12 57.5 43t22.5 70q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T320-200q0-17-11.5-28.5T280-240q-17 0-28.5 11.5T240-200q0 17 11.5 28.5T280-160Zm400 0q17 0 28.5-11.5T720-200q0-17-11.5-28.5T680-240q-17 0-28.5 11.5T640-200q0 17 11.5 28.5T680-160ZM280-720q17 0 28.5-11.5T320-760q0-17-11.5-28.5T280-800q-17 0-28.5 11.5T240-760q0 17 11.5 28.5T280-720Z"/></svg>`
		},
		{
			href: '/app/playground',
			label: 'Lab',
			active: (p) => p.startsWith('/app/playground'),
			icon: `<svg width="20" height="20" viewBox="0 0 18 18" fill="currentColor"><path d="M17.1778 13.7607L12.0833 5.96232C11.7775 5.50541 11.6077 4.98344 11.6077 4.46125V1.29615H12.0153C12.355 1.29615 12.6266 1.03506 12.6266 0.708906C12.6266 0.415179 12.3548 0.154297 12.0153 0.154297H5.96984C5.63013 0.154297 5.39255 0.415388 5.39255 0.708906C5.39255 1.03527 5.63035 1.29615 5.96984 1.29615H6.37749V4.46125C6.37749 4.98323 6.20764 5.50541 5.93587 5.96232L0.807364 13.7607C-0.0756596 15.2618 1.04516 17.1543 2.87915 17.1543H15.1402C16.9402 17.1543 18.095 15.2618 17.178 13.7607H17.1778ZM6.30933 12.1946C5.29042 12.4883 3.28658 12.162 3.93181 11.1831L6.92059 6.5822C7.32824 5.92968 7.56582 5.21168 7.56582 4.46125V1.29615H10.4527V4.46125C10.4527 5.21168 10.6565 5.92968 11.0639 6.5822L12.796 9.25776C13.1018 9.71467 12.6262 9.94291 12.2527 9.97555C9.53569 10.1714 8.55053 11.5743 6.30911 12.1944L6.30933 12.1946Z"/></svg>`
		}
	];

	const manageItem = {
		href: '/app/manage',
		label: 'Manage',
		active: (p) => p.startsWith('/app/manage'),
		icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`
	};

	const items = $derived(isInstructor ? [...baseItems, manageItem] : baseItems);
</script>

<!-- Mobile bottom nav only — desktop nav is in the global sidebar (app/+layout.svelte) -->
<nav class="bottom-nav" class:hidden={keyboardOpen}>
	<!-- Chat button opens the full-screen sidebar instead of navigating -->
	<button class="nav-item" class:active={$page.url.pathname.startsWith('/app/chat')} onclick={openSidebar} type="button">
		<span class="icon-wrap">
			{@html chatIcon}
			{#if totalUnread > 0}
				<span class="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
			{/if}
		</span>
		<span class="label">Chat</span>
	</button>
	{#each items as item}
		{@const isActive = item.active($page.url.pathname)}
		<a href={item.href} class="nav-item" class:active={isActive}>
			{@html item.icon}
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
			background: var(--ink);
			border-top: 1px solid #2a2a2a;
			z-index: 1000;
		}

		.nav-item {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.2rem;
			color: var(--muted-fg);
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
		.nav-item.active { color: var(--paper); }
		.nav-item:not(.active):active { color: var(--muted-fg); }

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
