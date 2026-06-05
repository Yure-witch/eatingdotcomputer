<script>
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { preload as preloadEK } from '$lib/components/EmojiKitchen.svelte';

	let { data, children } = $props();

	let firebaseReady = $state(false);
	let firebaseError = $state(false);
	let retryAttempts = $state(0);
	let _retryTimer = null;
	let _destroyed = false;

	// One sign-in attempt. Resolves true on success, false on failure
	// (so callers can drive their own retry cadence without needing to
	// try/catch around the Firebase SDK).
	async function tryConnect() {
		try {
			await signInWithCustomToken(auth, data.firebaseToken);
			return true;
		} catch {
			return false;
		}
	}

	// Background retry while the error banner is showing. The user
	// asked for "refresh every 3s until it does" — we don't reload
	// the page; we just re-attempt the sign-in in place so the chat
	// snaps in the moment the network/service comes back, without
	// losing the route, scroll position, or compose draft.
	const RETRY_INTERVAL_MS = 3000;
	function startRetryLoop() {
		if (_retryTimer || _destroyed) return;
		_retryTimer = setInterval(async () => {
			if (_destroyed) { stopRetryLoop(); return; }
			retryAttempts++;
			const ok = await tryConnect();
			if (ok) {
				stopRetryLoop();
				firebaseError = false;
				firebaseReady = true;
			}
		}, RETRY_INTERVAL_MS);
	}
	function stopRetryLoop() {
		if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
	}

	onMount(async () => {
		// Lock the document so the chat layout can't be scrolled by
		// the page itself — only the `.message-list` inside scrolls.
		// Removed on destroy so other app routes stay scrollable.
		// CSS lives in `src/app.css` under `html.in-chat`.
		document.documentElement.classList.add('in-chat');

		// Initial connect: 5 attempts with linear-ish backoff to ride
		// out short flaps quickly. If that whole sequence fails we
		// surface the error banner AND start the 3s background
		// retry loop so the user doesn't have to touch anything.
		const MAX_RETRIES = 5;
		let connected = false;
		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			if (await tryConnect()) { connected = true; break; }
			if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * attempt));
		}
		if (connected) {
			firebaseReady = true;
		} else {
			firebaseError = true;
			firebaseReady = true;
			startRetryLoop();
		}
		// Preload EK data in the background so the picker opens instantly
		setTimeout(preloadEK, 1000);
	});

	onDestroy(() => {
		_destroyed = true;
		stopRetryLoop();
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
			<div class="auto-retry">
				<span class="dot"></span>
				Retrying every 3 seconds{retryAttempts > 0 ? ` (attempt ${retryAttempts})` : ''}…
			</div>
			<div class="error-actions">
				<button onclick={() => location.reload()}>Reload page</button>
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
		/* Push the chat below the fixed AppHeader (rendered from
		   /app/+layout.svelte). Without this, the top of the message
		   list slides behind the header. */
		margin-top: 52px;
	}

	@media (max-width: 640px) {
		.chat-wrap {
			/* Subtract the AppHeader (52px on mobile too — its mobile
			   media query keeps the same height) AND the bottom nav
			   (56 px) AND any safe-area inset. */
			height: calc(100dvh - 52px - 56px - env(safe-area-inset-bottom, 0px));
			margin-top: 52px;
		}
		/* When the bottom nav hides for the on-screen keyboard
		   (BottomNav.svelte adds `html.kb-open`), reclaim the strip
		   it was occupying so the compose docks right above the
		   keyboard instead of leaving 56 px of empty space. */
		:global(html.kb-open) .chat-wrap {
			height: calc(100dvh - 52px);
		}
	}

	@media (min-width: 641px) {
		.chat-wrap {
			height: calc(100dvh - 52px);
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

	.auto-retry {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: var(--muted-fg);
	}
	.auto-retry .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--danger);
		animation: retry-pulse 1.6s ease-in-out infinite;
	}
	@keyframes retry-pulse {
		0%, 100% { opacity: 0.35; transform: scale(0.8); }
		50%      { opacity: 1;    transform: scale(1.05); }
	}

	.error-actions { display: flex; gap: 0.6rem; align-items: center; }
	.error-actions button, .error-actions a {
		padding: 0.4rem 1rem; border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; cursor: pointer; text-decoration: none;
	}
	.error-actions button { background: #c0392b; color: #fff; border: none; }
	.error-actions a { background: transparent; color: var(--danger); border: 1.5px solid #c0392b; }
	.error-actions button:hover, .error-actions a:hover { opacity: 0.8; }
</style>
