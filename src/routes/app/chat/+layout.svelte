<script>
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth, db } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, goOffline, goOnline } from 'firebase/database';
	import { preload as preloadEK } from '$lib/components/EmojiKitchen.svelte';
	import ConvSkeleton from '$lib/components/ConvSkeleton.svelte';

	let { data, children } = $props();

	// Mark individual conversations (channel/DM) so the mobile bottom nav hides
	// and the chat reclaims its 56px strip. The menu list (/app/chat) is the
	// pager on mobile, so it keeps the nav.
	$effect(() => {
		if (typeof document === 'undefined') return;
		const isConv = /^\/app\/chat\/(channel|dm)\//.test($page.url.pathname);
		document.documentElement.classList.toggle('in-conversation', isConv);
	});

	let firebaseReady = $state(false);
	let firebaseError = $state(false);
	let retryAttempts = $state(0);
	let online = $state(true);      // navigator.onLine, kept live via events
	let reloadCount = $state(0);    // how many times we've auto-reloaded this tab session
	let rtdbConnected = $state(true); // RTDB .info/connected — drops when the socket dies
	let _retryTimer = null;
	let _connWatch = null;          // unsubscribe for the .info/connected listener
	let _resyncTimer = null;        // debounce for the force-reconnect kick
	let _destroyed = false;

	// A sign-in that never resolves (half-open socket after sleep) would wedge
	// the whole "Connecting…" gate — so every attempt is raced against this.
	const CONNECT_TIMEOUT_MS = 8000;

	// After this many failed in-place retries (while online) we give the
	// window a full reload — a last-resort recovery when re-signing-in
	// isn't clearing a wedged connection. Bounded by MAX_RELOADS so a
	// genuinely-down service can't put us in a reload loop; past that we
	// just keep retrying in place. The count is persisted in sessionStorage
	// so it survives the reloads (and clears on a successful connect / when
	// the tab closes).
	const RETRY_INTERVAL_MS = 3000;
	const RELOAD_AFTER_ATTEMPTS = 5;
	const MAX_RELOADS = 3;
	const RELOAD_KEY = 'ec:chat-reloads';

	// A fresh custom token — the one from page load expires after ~1h, so a
	// tab resumed from a long sleep needs a new one. Falls back to the baked-in
	// token if the fetch fails (still valid within the first hour).
	async function freshToken() {
		try {
			const r = await fetch('/api/firebase-token', { cache: 'no-store' });
			if (r.ok) return (await r.json())?.token ?? data.firebaseToken;
		} catch { /* offline — use the page-load token */ }
		return data.firebaseToken;
	}

	// One sign-in attempt. Resolves true on success, false on failure or
	// timeout — the timeout is the key fix: a hung sign-in used to block the
	// initial connect loop forever, leaving the chat stuck on "Connecting…".
	async function tryConnect() {
		try {
			const token = await freshToken();
			if (!token) return false;
			await Promise.race([
				signInWithCustomToken(auth, token),
				new Promise((_, reject) => setTimeout(() => reject(new Error('connect-timeout')), CONNECT_TIMEOUT_MS))
			]);
			return true;
		} catch {
			return false;
		}
	}

	// Kick the RTDB SDK to rebuild a dead websocket (common after sleep/wake).
	// Auth persists across this, so no re-sign-in is needed — it just forces
	// the transport to reconnect instead of waiting on the SDK's own backoff.
	function forceReconnect() {
		clearTimeout(_resyncTimer);
		_resyncTimer = setTimeout(() => {
			if (_destroyed || !online) return;
			try { goOffline(db); goOnline(db); } catch { /* SDK not ready */ }
		}, 150);
	}

	function onConnected() {
		stopRetryLoop();
		firebaseError = false;
		firebaseReady = true;
		reloadCount = 0;
		try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* private mode */ }
	}

	// Background retry while the error banner is showing. Re-attempts the
	// sign-in in place every 3s so the chat snaps back the moment the
	// service returns. While OFFLINE we pause (a reload/retry can't help
	// with no network) and let the 'online' handler kick a retry the
	// instant the connection is back. After RELOAD_AFTER_ATTEMPTS failed
	// attempts we reload the window (up to MAX_RELOADS).
	function startRetryLoop() {
		if (_retryTimer || _destroyed) return;
		_retryTimer = setInterval(async () => {
			if (_destroyed) { stopRetryLoop(); return; }
			if (!online) return; // hold while offline
			retryAttempts++;
			if (await tryConnect()) { onConnected(); return; }
			if (retryAttempts >= RELOAD_AFTER_ATTEMPTS && reloadCount < MAX_RELOADS) {
				try { sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1)); } catch { /* private mode */ }
				location.reload();
			}
		}, RETRY_INTERVAL_MS);
	}
	function stopRetryLoop() {
		if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
	}

	function handleOnline() {
		online = true;
		// Back online — recover immediately instead of waiting for a tick.
		if (firebaseError || !firebaseReady) tryConnect().then((ok) => { if (ok) onConnected(); });
		else forceReconnect(); // authed already — just rebuild the socket
	}
	function handleOffline() { online = false; }

	// Tab resumed (laptop woke, app foregrounded). The socket is usually dead
	// but the SDK can be slow to notice — nudge it right away.
	function handleVisible() {
		if (document.visibilityState !== 'visible' || !online) return;
		if (firebaseError || !firebaseReady) tryConnect().then((ok) => { if (ok) onConnected(); });
		else if (!rtdbConnected) forceReconnect();
	}

	// Watch the live connection status. If the socket stays down for a few
	// seconds while we believe we're connected, force a reconnect so a
	// wedged post-sleep socket heals without the user refreshing.
	function watchConnection() {
		const connRef = ref(db, '.info/connected');
		_connWatch = onValue(connRef, (snap) => {
			const wasDown = !rtdbConnected;
			rtdbConnected = snap.val() === true;
			if (rtdbConnected) { clearTimeout(_resyncTimer); return; }
			if (!wasDown && firebaseReady && online) {
				clearTimeout(_resyncTimer);
				_resyncTimer = setTimeout(() => { if (!rtdbConnected && online && !_destroyed) forceReconnect(); }, 4000);
			}
		});
	}

	onMount(async () => {
		// Lock the document so the chat layout can't be scrolled by
		// the page itself — only the `.message-list` inside scrolls.
		// Removed on destroy so other app routes stay scrollable.
		// CSS lives in `src/app.css` under `html.in-chat`.
		document.documentElement.classList.add('in-chat');

		online = navigator.onLine;
		try { reloadCount = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* private mode */ }
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		document.addEventListener('visibilitychange', handleVisible);
		watchConnection();

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
			onConnected();
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
		clearTimeout(_resyncTimer);
		if (_connWatch) { try { _connWatch(); } catch { /* already off */ } _connWatch = null; }
		if (typeof window !== 'undefined') {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			document.removeEventListener('visibilitychange', handleVisible);
		}
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove('in-chat');
		document.documentElement.classList.remove('in-conversation');
	});
</script>

<div class="chat-wrap">
	{#if !firebaseReady}
		<!-- Mobile: keep showing the conversation skeleton (same as the tap
		     transition) so it goes template → fully-rendered chat with no
		     "Connecting…" flash in between. Desktop keeps the text. -->
		<ConvSkeleton />
		<div class="chat-loading connecting-text">Connecting…</div>
	{:else if firebaseError}
		<div class="chat-loading error">
			{#if !online}
				You're offline — chat will reconnect when your connection is back.
			{:else}
				Chat unavailable — couldn't connect to the real-time service.
			{/if}
			<div class="auto-retry">
				<span class="dot" class:offline={!online}></span>
				{#if !online}
					Paused while offline · retrying the moment you're back online.
				{:else if reloadCount >= MAX_RELOADS}
					Still no luck after {reloadCount} reload{reloadCount === 1 ? '' : 's'} — retrying in place every 3 seconds{retryAttempts > 0 ? ` (attempt ${retryAttempts})` : ''}…
				{:else}
					Retrying every 3 seconds{retryAttempts > 0 ? ` (attempt ${retryAttempts})` : ''}{reloadCount > 0 ? ` · reloaded ${reloadCount}×` : ''}…
				{/if}
			</div>
			<div class="error-actions">
				<button onclick={() => location.reload()}>Reload page</button>
				<a href="/login">Log back in</a>
			</div>
		</div>
	{:else}
		{#if online && !rtdbConnected}
			<div class="reconnecting-pill" role="status">
				<span class="dot"></span> Reconnecting…
			</div>
		{/if}
		{#key $page.url.pathname}
			{@render children()}
		{/key}
	{/if}
</div>

<style>
	/* Transient status when the socket dropped but auth is still good — the
	   SDK (or our force-reconnect) is rebuilding it; chat stays usable. */
	.reconnecting-pill {
		position: fixed; top: calc(52px + 8px); left: 50%; transform: translateX(-50%);
		z-index: 50; display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.3rem 0.75rem; border-radius: 999px;
		background: var(--surface-2); color: var(--muted-fg);
		border: 1px solid var(--border); font-size: 0.75rem; font-weight: 600;
		box-shadow: 0 4px 14px rgba(0,0,0,0.12);
	}
	.reconnecting-pill .dot {
		width: 7px; height: 7px; border-radius: 50%; background: var(--accent, #ffa305);
		animation: reconnect-pulse 1.2s ease-in-out infinite;
	}
	@keyframes reconnect-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }

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
			height: calc(100dvh - 52px - var(--native-top-inset, 0px) - 56px - env(safe-area-inset-bottom, 0px));
			margin-top: 52px;
		}
		/* When the bottom nav hides for the on-screen keyboard
		   (BottomNav.svelte adds `html.kb-open`), reclaim the strip
		   it was occupying so the compose docks right above the
		   keyboard instead of leaving 56 px of empty space. */
		:global(html.kb-open) .chat-wrap {
			height: calc(100dvh - 52px - var(--native-top-inset, 0px));
		}
		/* Same reclaim when the expression picker is open: the bottom nav is
		   hidden (body.expr-picker-open), so without this the chat keeps a
		   56 px reservation for it and the picker ends up with a big strip of
		   empty space below the docked sheet. */
		:global(body.expr-picker-open) .chat-wrap {
			height: calc(100dvh - 52px - var(--native-top-inset, 0px));
		}
		/* In an individual conversation the bottom nav is hidden, so reclaim the
		   FULL bottom strip (the input bar owns the safe-area via its own
		   padding-bottom). Same height as the kb-open / picker-open cases so
		   there's never a conflicting safe-area gap when those engage. */
		:global(html.in-conversation) .chat-wrap {
			height: calc(100dvh - 52px - var(--native-top-inset, 0px));
		}
	}

	@media (min-width: 641px) {
		.chat-wrap {
			height: calc(100dvh - 52px - var(--native-top-inset, 0px));
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
	/* On mobile the skeleton stands in for the "Connecting…" text. */
	@media (max-width: 640px) {
		.connecting-text { display: none; }
	}

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
	/* Offline: a steady, muted dot — we're paused, not actively hammering. */
	.auto-retry .dot.offline {
		background: var(--muted-fg);
		animation: none;
		opacity: 0.6;
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
