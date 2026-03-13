<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let keyboardOpen = $state(false);

	onMount(() => {
		if (!window.visualViewport) return;
		const handler = () => { keyboardOpen = window.innerHeight - window.visualViewport.height > 150; };
		window.visualViewport.addEventListener('resize', handler);
		return () => window.visualViewport.removeEventListener('resize', handler);
	});

	const items = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
		},
		{
			href: '/app/chat',
			label: 'Chat',
			active: (p) => p.startsWith('/app/chat'),
			icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`
		},
		{
			href: '/app/assignments',
			label: 'Roadmap',
			active: (p) => p.startsWith('/app/assignments'),
			icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`
		},
		{
			href: '/app/files',
			label: 'Files',
			active: (p) => p.startsWith('/app/files'),
			icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
		}
	];
</script>

<nav class="bottom-nav" class:hidden={keyboardOpen}>
	{#each items as item}
		{@const isActive = item.active($page.url.pathname)}
		<a href={item.href} class="nav-item" class:active={isActive}>
			{@html item.icon}
			<span class="label">{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.bottom-nav {
		display: none;
	}
	.bottom-nav.hidden {
		display: none !important;
	}

	@media (max-width: 640px) {
		.bottom-nav {
			display: flex;
			position: fixed;
			bottom: 0; left: 0; right: 0;
			height: 56px;
			padding-bottom: env(safe-area-inset-bottom, 0);
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
