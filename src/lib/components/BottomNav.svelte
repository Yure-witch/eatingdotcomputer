<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let { isInstructor = false } = $props();

	let inputFocused = $state(false);

	onMount(() => {
		const onFocusIn = (e) => {
			if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
				inputFocused = true;
			}
		};
		const onFocusOut = (e) => {
			if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
				inputFocused = false;
			}
		};
		document.addEventListener('focusin', onFocusIn);
		document.addEventListener('focusout', onFocusOut);
		return () => {
			document.removeEventListener('focusin', onFocusIn);
			document.removeEventListener('focusout', onFocusOut);
		};
	});

	const baseItems = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
		},
		{
			href: '/app/chat',
			label: 'Chat',
			active: (p) => p.startsWith('/app/chat'),
			icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
		},
		{
			href: '/app/assignments',
			label: 'Roadmap',
			active: (p) => p.startsWith('/app/assignments'),
			icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`
		},
		{
			href: '/app/files',
			label: 'Files',
			active: (p) => p.startsWith('/app/files'),
			icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
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
<nav class="bottom-nav" class:hidden={inputFocused}>
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
			background: #1a1a1a;
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
			color: #555;
			text-decoration: none;
			transition: color 0.15s;
			-webkit-tap-highlight-color: transparent;
		}
		.nav-item.active { color: #f7f2ea; }
		.nav-item:not(.active):active { color: #888; }

		.label {
			font-size: 0.58rem;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}
	}
</style>
