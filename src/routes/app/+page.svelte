<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '$lib/push.js';

	let { data } = $props();
	const user = data.session.user;

	let pushSupported = $state(false);
	let pushSubscribed = $state(false);
	let pushLoading = $state(false);
	let pushError = $state(null);
	let notifPermission = $state('default'); // 'default' | 'granted' | 'denied'

	let installPrompt = $state(null);
	let isStandalone = $state(false);
	let isIOS = $state(false);

	onMount(async () => {
		if (!browser) return;
		pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
		if (pushSupported) {
			pushSubscribed = await isPushSubscribed();
			notifPermission = Notification.permission;
		}

		isStandalone = window.matchMedia('(display-mode: standalone)').matches;
		isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;

		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			installPrompt = e;
		});
		window.addEventListener('appinstalled', () => {
			isStandalone = true;
			installPrompt = null;
		});
	});

	async function install() {
		if (!installPrompt) return;
		installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') isStandalone = true;
		installPrompt = null;
	}

	async function togglePush() {
		pushLoading = true;
		pushError = null;
		if (pushSubscribed) {
			await unsubscribeFromPush();
			pushSubscribed = false;
		} else {
			const result = await subscribeToPush();
			if (result?.error) pushError = result.error;
			else pushSubscribed = true;
		}
		notifPermission = Notification.permission;
		pushLoading = false;
	}

	async function requestPermission() {
		const result = await Notification.requestPermission();
		notifPermission = result;
		if (result === 'granted') await togglePush();
	}
</script>

<svelte:head>
	<title>Dashboard — eating.computer</title>
</svelte:head>

<div class="shell">
	<header>
		<a class="wordmark" href="/">eating.computer</a>
		<div class="header-right">
			{#if user.role === 'instructor'}
				<a href="/app/manage" class="manage-link">Manage</a>
			{/if}
			<span class="user-name">{user.name || user.email}</span>
			<span class="badge">{user.role ?? 'student'}</span>
			<form method="POST" action="?/signout">
				<button type="submit" class="sign-out">Sign out</button>
			</form>
		</div>
	</header>

	<main>
		<h1>Dashboard</h1>

		<div class="sections">
			<a class="card" href="/app/assignments">
				<h2>Assignments</h2>
				<p class="empty">View week-by-week assignments →</p>
			</a>

			{#if user.role === 'instructor'}
				<a class="card" href="/app/manage">
					<h2>Manage</h2>
					<p class="empty">Create and edit assignments →</p>
				</a>
			{/if}

			<section class="card">
				<h2>Lecture Notes</h2>
				<p class="empty">No notes yet.</p>
			</section>

			<section class="card">
				<h2>Files</h2>
				<p class="empty">No files yet.</p>
			</section>

			<a class="card" href="/app/chat">
				<h2>Chat</h2>
				<p class="empty">Channels, DMs, and class chat →</p>
			</a>

			{#if pushSupported}
				<section class="card notif-card">
					<h2>Notifications</h2>

					{#if notifPermission === 'granted' && pushSubscribed}
						<!-- All good -->
						<div class="notif-status ok">
							<span class="status-dot green"></span>
							<span>Notifications enabled on this device</span>
						</div>
						<button class="btn-push subscribed" onclick={togglePush} disabled={pushLoading}>
							{pushLoading ? '…' : 'Disable'}
						</button>

					{:else if notifPermission === 'denied'}
						<!-- Blocked — show fix instructions -->
						<div class="notif-status warn">
							<span class="status-dot red"></span>
							<span>Notifications are blocked</span>
						</div>
						<div class="notif-instructions">
							<p class="instruct-label">To fix in Chrome:</p>
							<ol>
								<li>Click the <strong>lock icon</strong> in the address bar</li>
								<li>Set <strong>Notifications</strong> → <strong>Allow</strong></li>
								<li>Reload the page</li>
							</ol>
							<p class="instruct-label" style="margin-top: 0.75rem">If that doesn't work — macOS is blocking Chrome:</p>
							<ol>
								<li>Open <strong>System Settings</strong> → <strong>Notifications</strong></li>
								<li>Find <strong>Chrome</strong> and turn on <strong>Allow notifications</strong></li>
								<li>Come back here and reload</li>
							</ol>
						</div>

					{:else if notifPermission === 'default'}
						<!-- Not asked yet -->
						<p class="empty" style="margin-bottom: 0.75rem">Get notified when new assignments are posted.</p>
						<button class="btn-push" onclick={requestPermission} disabled={pushLoading}>
							{pushLoading ? '…' : 'Enable notifications'}
						</button>

					{:else}
						<!-- Granted but not subscribed yet -->
						<p class="empty" style="margin-bottom: 0.75rem">Permission granted — finish setup below.</p>
						<button class="btn-push" onclick={togglePush} disabled={pushLoading}>
							{pushLoading ? '…' : 'Subscribe'}
						</button>
					{/if}

					{#if pushError}
						<p class="push-error">{pushError}</p>
					{/if}
				</section>
			{/if}

			{#if !isStandalone}
				<section class="card install-card">
					<h2>Install app</h2>
					{#if installPrompt}
						<p class="empty" style="margin-bottom: 0.75rem">Install eating.computer to your home screen for the full experience.</p>
						<button class="btn-push" onclick={install}>Install</button>
					{:else if isIOS}
						<p class="empty">To install on iPhone or iPad:</p>
						<ol class="install-steps">
							<li>Tap the <strong>Share</strong> button <span class="ios-icon">⎙</span> in Safari</li>
							<li>Scroll down and tap <strong>Add to Home Screen</strong></li>
							<li>Tap <strong>Add</strong></li>
						</ol>
					{:else}
						<p class="empty">To install, open this page in Chrome or Edge and look for the install icon in the address bar, or use the browser menu → <strong>Install app</strong>.</p>
					{/if}
				</section>
			{/if}
		</div>
	</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 2rem;
		border-bottom: 1.5px solid #ddd7cc;
	}

	.wordmark {
		font-family: 'Cambridge', serif;
		font-size: 1.25rem;
		color: var(--ink);
		text-decoration: none;
	}

	.wordmark:hover {
		opacity: 0.7;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.875rem;
	}

	.user-name {
		color: var(--ink);
		font-weight: 500;
	}

	.badge {
		background: var(--ink);
		color: var(--paper);
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.sign-out {
		background: none;
		border: 1.5px solid #c8c1b4;
		border-radius: 6px;
		padding: 0.3rem 0.7rem;
		font-family: inherit;
		font-size: 0.8rem;
		color: var(--ink);
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.sign-out:hover {
		border-color: var(--ink);
	}

	.manage-link {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink);
		text-decoration: none;
		padding: 0.3rem 0.7rem;
		border: 1.5px solid #c8c1b4;
		border-radius: 6px;
		transition: border-color 0.15s;
	}

	.manage-link:hover {
		border-color: var(--ink);
	}

	main {
		padding: 2rem;
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
		display: block;
		min-height: unset;
		place-items: unset;
	}

	h1 {
		font-family: 'Cambridge', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 1.5rem;
	}

	.sections {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.card {
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		text-decoration: none;
		color: inherit;
		display: block;
		transition: border-color 0.15s;
	}

	.card:hover {
		border-color: var(--ink);
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: var(--ink);
	}

	.empty {
		font-size: 0.875rem;
		color: #a09688;
		margin: 0;
	}

	.btn-push {
		padding: 0.4rem 0.85rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-push:hover { opacity: 0.8; }
	.btn-push:disabled { opacity: 0.5; cursor: default; }
	.btn-push.subscribed {
		background: none;
		color: var(--ink);
		border: 1.5px solid #c8c1b4;
	}
	.btn-push.subscribed:hover { border-color: var(--ink); }

	.push-error {
		font-size: 0.8rem;
		color: #c0392b;
		margin: 0.5rem 0 0;
	}

	.notif-card {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.notif-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.status-dot.green { background: #2e7d32; }
	.status-dot.red   { background: #c0392b; }

	.notif-instructions {
		font-size: 0.82rem;
		color: #555;
		background: #f9f5ee;
		border-radius: 8px;
		padding: 0.75rem;
	}

	.instruct-label {
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 0.35rem;
	}

	.notif-instructions ol {
		margin: 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.install-steps {
		font-size: 0.875rem;
		color: #555;
		margin: 0.5rem 0 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.ios-icon {
		font-style: normal;
	}
</style>
