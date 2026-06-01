<script>
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { preload as preloadEK } from '$lib/components/EmojiKitchen.svelte';

	let { data, children } = $props();

	let firebaseReady = $state(false);
	let firebaseError = $state(false);

	onMount(async () => {
		// Lock the document so the chat layout can't be scrolled by
		// the page itself — only the `.message-list` inside scrolls.
		// Removed on destroy so other app routes stay scrollable.
		// CSS lives in `src/app.css` under `html.in-chat`.
		document.documentElement.classList.add('in-chat');

		const MAX_RETRIES = 5;
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				await signInWithCustomToken(auth, data.firebaseToken);
				break;
			} catch (e) {
				if (attempt === MAX_RETRIES) { firebaseError = true; }
				else { await new Promise((r) => setTimeout(r, 1000 * attempt)); }
			}
		}
		firebaseReady = true;
		// Preload EK data in the background so the picker opens instantly
		setTimeout(preloadEK, 1000);
	});

	onDestroy(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove('in-chat');
	});
</script>

<div class="chat-wrap">
	{#if !firebaseReady}
		<div class="chat-loading">Connecting…</div>
	{:else if firebaseError}
		<div class="chat-loading error">
			Chat unavailable — couldn't connect to real-time service.
			<div class="error-actions">
				<button onclick={() => location.reload()}>Retry</button>
				<a href="/login">Log back in</a>
			</div>
		</div>
	{:else}
		{#key $page.url.pathname}
			{@render children()}
		{/key}
	{/if}
</div>

<style>
	.chat-wrap {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		overscroll-behavior: none;
	}

	@media (max-width: 640px) {
		.chat-wrap {
			height: calc(100dvh - 56px - env(safe-area-inset-bottom, 0px));
		}
		/* When the bottom nav hides for the on-screen keyboard
		   (BottomNav.svelte adds `html.kb-open`), reclaim the strip
		   it was occupying so the compose docks right above the
		   keyboard instead of leaving 56 px of empty space. */
		:global(html.kb-open) .chat-wrap {
			height: 100dvh;
		}
	}

	@media (min-width: 641px) {
		.chat-wrap {
			height: 100dvh;
		}
	}

	.chat-loading {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 1rem;
		color: var(--muted-fg);
		font-size: 0.9rem;
		text-align: center;
		padding: 2rem;
	}
	.chat-loading.error { color: var(--danger); }

	.error-actions { display: flex; gap: 0.6rem; align-items: center; }
	.error-actions button, .error-actions a {
		padding: 0.4rem 1rem; border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; cursor: pointer; text-decoration: none;
	}
	.error-actions button { background: #c0392b; color: #fff; border: none; }
	.error-actions a { background: transparent; color: var(--danger); border: 1.5px solid #c0392b; }
	.error-actions button:hover, .error-actions a:hover { opacity: 0.8; }
</style>
