<script>
	/**
	 * "Get the native app" nudge — shown ONLY to mobile-web visitors (touch
	 * browser, not the native shell, not desktop) once APP_STORE_URL is set.
	 * Hidden entirely while the store link is null, so it never shows a dead
	 * button. Dismissible; the choice persists in localStorage.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { APP_STORE_URL, shouldPromoteApp, isIOSWeb } from '$lib/native.js';

	const DISMISS_KEY = 'getAppDismissed';
	// The install pages ARE this banner, at length. Nudging someone toward the
	// app while they are reading how to install it is just noise in the way.
	const HIDE_ON = ['/androidpwa', '/iosapp', '/pwadesktop'];
	let show = $state(false);
	let ios = $state(false);

	onMount(() => {
		if (!shouldPromoteApp()) return;
		try {
			if (localStorage.getItem(DISMISS_KEY) === '1') return;
		} catch {}
		ios = isIOSWeb();
		show = true;
	});

	// Android has no store listing — it installs from the browser — so sending
	// an Android visitor to APP_STORE_URL handed them an iPhone-only Apple page
	// they could do nothing with. They get the install walkthrough instead.
	const href = $derived(ios ? APP_STORE_URL : '/androidpwa');
	const external = $derived(ios);

	function dismiss() {
		show = false;
		try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
	}

	const storeLabel = $derived(ios ? 'App Store' : 'Install');
</script>

{#if show && !HIDE_ON.includes($page.url.pathname)}
	<div class="get-app" role="region" aria-label="Get the native app">
		<div class="ga-icon" aria-hidden="true">
			<span class="msi msi-20">install_mobile</span>
		</div>
		<div class="ga-text">
			<strong>eating.computer is better as an app</strong>
			<span>Smoother chat, a proper keyboard, and notifications.</span>
		</div>
		<a class="ga-cta" {href} target={external ? '_blank' : null} rel={external ? 'noopener' : null}>{storeLabel}</a>
		<button class="ga-close" onclick={dismiss} title="Dismiss" aria-label="Dismiss">
			<span class="msi msi-18">close</span>
		</button>
	</div>
{/if}

<style>
	.get-app {
		position: fixed;
		left: 0.6rem; right: 0.6rem;
		bottom: calc(0.6rem + env(safe-area-inset-bottom, 0px));
		z-index: 980;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem 0.8rem;
		background: var(--paper, #fff);
		color: var(--ink, #2b2620);
		border: 1px solid var(--border, #e3ddcf);
		border-radius: 16px;
		box-shadow: 0 8px 28px rgba(0,0,0,0.18);
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
	}
	.ga-icon {
		flex: 0 0 auto;
		width: 2.4rem; height: 2.4rem;
		display: grid; place-items: center;
		border-radius: 12px;
		background: var(--md-sys-color-secondary-container, var(--surface-2, #f0ead9));
		color: var(--md-sys-color-on-secondary-container, var(--ink, #2b2620));
	}
	.ga-text {
		flex: 1; min-width: 0;
		display: flex; flex-direction: column; gap: 0.1rem;
	}
	.ga-text strong { font-size: 0.85rem; font-weight: 600; line-height: 1.2; }
	.ga-text span {
		font-size: 0.72rem; color: var(--muted-fg, #8a8175);
		overflow: hidden; text-overflow: ellipsis;
	}
	.ga-cta {
		flex: 0 0 auto;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: var(--accent, var(--ink, #2b2620));
		color: var(--paper, #fff);
		font-size: 0.8rem; font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.ga-close {
		flex: 0 0 auto;
		width: 1.8rem; height: 1.8rem;
		display: grid; place-items: center;
		border: none; border-radius: 999px;
		background: transparent; color: var(--muted-fg, #8a8175);
		cursor: pointer;
	}

	/* Desktop never sees it (shouldPromoteApp gates on touch anyway, but
	   this is a belt-and-suspenders so a stray render can't show on wide
	   screens). */
	@media (min-width: 641px) and (pointer: fine) {
		.get-app { display: none; }
	}
</style>
