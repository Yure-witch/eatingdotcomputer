<!--
	Android PWA install instructions. PUBLIC and unauthenticated on purpose —
	the whole point is that you can send someone this link before they have an
	account, and they can install the app and then sign in from it. There is no
	auth gate in hooks.server.js, so a top-level route like this is open by
	default (same as /terms and /privacy).

	iPhone users get sent to the App Store instead; the native shell has real
	APNs push, which a home-screen web app on iOS still cannot match.
-->
<script>
	import { onMount } from 'svelte';
	// Single source of truth — the same constant the in-app install banner and
	// GetAppBanner use, so a store-URL change lands everywhere at once.
	import { APP_STORE_URL } from '$lib/native.js';

	let installPrompt = $state(null);
	let installed = $state(false);
	let isAndroid = $state(false);
	let isIOS = $state(false);
	let isStandalone = $state(false);
	let inAppBrowser = $state(false);
	let checked = $state(false);

	onMount(() => {
		const ua = navigator.userAgent;
		isStandalone =
			window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
		isAndroid = /android/i.test(ua);
		isIOS = /iphone|ipad|ipod/i.test(ua);
		// Instagram, Facebook, TikTok and friends render pages in a webview that
		// has no install path at all — the ⋮ menu simply has no "Install app"
		// entry. Worth calling out, because otherwise people follow the steps,
		// find nothing, and conclude the app is broken.
		inAppBrowser = /\b(FBAN|FBAV|Instagram|Line|TikTok|Snapchat|Twitter)\b/i.test(ua);
		checked = true;

		// Chrome fires this when the page qualifies for installation. Holding on
		// to it turns the manual walkthrough below into a single button.
		const onPrompt = (e) => {
			e.preventDefault();
			installPrompt = e;
		};
		const onInstalled = () => {
			installed = true;
			installPrompt = null;
		};
		window.addEventListener('beforeinstallprompt', onPrompt);
		window.addEventListener('appinstalled', onInstalled);
		return () => {
			window.removeEventListener('beforeinstallprompt', onPrompt);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	async function install() {
		if (!installPrompt) return;
		installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') installed = true;
		installPrompt = null;
	}
</script>

<svelte:head>
	<title>Install on Android — eating.computer</title>
	<meta
		name="description"
		content="How to install eating.computer on an Android phone, so it opens like an app and can send you notifications."
	/>
</svelte:head>

<main>
	<p class="eyebrow">eating.computer</p>
	<h1>Install on Android</h1>
	<p class="lede">
		eating.computer installs straight from the browser — no Play Store, no download.
		It gets its own icon on your home screen, opens without browser chrome, and can
		send you notifications for mentions, replies and DMs.
	</p>

	{#if checked && isStandalone}
		<div class="callout callout-done">
			<strong>You're already running the installed app.</strong>
			<p>Nothing to do here. <a href="/login">Sign in →</a></p>
		</div>
	{:else if checked && installed}
		<div class="callout callout-done">
			<strong>Installed.</strong>
			<p>Look for the eating.computer icon on your home screen, then sign in there.</p>
		</div>
	{:else}
		{#if checked && isIOS}
			<div class="callout">
				<strong>You're on an iPhone or iPad.</strong>
				{#if APP_STORE_URL}
					<p>
						This page is for Android. On iOS, get the real app instead — it has proper
						notifications that a home-screen web app can't do.
					</p>
					<a class="btn" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
						Download on the App Store
					</a>
				{:else}
					<!-- No listing yet, so no button — see /iosapp for the same guard. -->
					<p>
						This page is for Android. The iPhone app isn't on the App Store yet;
						until it is, add eating.computer to your home screen from Safari.
					</p>
					<a class="btn btn-quiet" href="/iosapp">iPhone instructions →</a>
				{/if}
			</div>
		{/if}

		{#if checked && inAppBrowser}
			<div class="callout callout-warn">
				<strong>Open this page in Chrome first.</strong>
				<p>
					You're viewing it inside another app's built-in browser, which has no way to
					install anything. Tap the <strong>⋮</strong> menu and choose
					<strong>"Open in Chrome"</strong> (or copy this link into Chrome), then come back.
				</p>
			</div>
		{/if}

		{#if installPrompt}
			<div class="callout callout-go">
				<strong>Your browser can do this in one tap.</strong>
				<p>No need for the steps below.</p>
				<button class="btn" onclick={install}>Install eating.computer</button>
			</div>
		{/if}

		<h2>Chrome</h2>
		<ol>
			<li>Tap the <strong>⋮ menu</strong> in the top right.</li>
			<li>
				Tap <strong>Add to Home screen</strong>. Some versions call it
				<strong>Install app</strong>, and newer ones put it under <strong>Share</strong> first.
			</li>
			<li>Tap <strong>Install</strong> to confirm.</li>
		</ol>

		<h2>Samsung Internet</h2>
		<ol>
			<li>Tap the <strong>☰ menu</strong> at the bottom right.</li>
			<li>Tap <strong>Add page to</strong>, then <strong>Home screen</strong>.</li>
			<li>Tap <strong>Add</strong>.</li>
		</ol>

		<h2>Firefox</h2>
		<ol>
			<li>Tap the <strong>⋮ menu</strong>.</li>
			<li>Tap <strong>Install</strong>, or <strong>Add to Home screen</strong>.</li>
		</ol>

		<div class="note">
			<p>
				<strong>Don't see the option?</strong> It only appears on a page served over HTTPS
				in a normal browser tab — not in private/incognito mode, and not inside another
				app's browser. Make sure you're on
				<span class="mono">eating.computer</span> in Chrome and reload.
			</p>
		</div>
	{/if}

	<h2>After you install</h2>
	<p>
		Open the app from your home screen and sign in. The first time you land in the
		chat it will ask whether to allow notifications — say yes if you want mentions,
		replies and DMs to reach you when the app is closed. You can change your mind
		later from your profile.
	</p>

	<p class="foot">
		<a href="/login">Sign in</a> · <a href="/signup">Create an account</a> ·
		<a href="/privacy">Privacy</a>
	</p>
</main>

<style>
	/* app.css styles every bare <main> for the LANDING page:
	     main { min-height: 100dvh; display: grid; place-items: center; … }
	   Overriding `display` alone is not enough — `place-items: center` survives
	   and still shrink-wraps and centres each child, so headings float in the
	   middle of the column while paragraphs run full width. Reset the whole set,
	   the same way `.app-shell main` does in app.css. */
	main {
		display: block;
		place-items: initial;
		min-height: 0;
		overflow: visible;
		text-align: left;
		max-width: 40rem;
		margin: 0 auto;
		padding: 3.5rem 1.5rem 5rem;
		font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.65;
		color: #1a1414;
		background: #fff8f7;
	}

	/* Standalone page — must be readable before any app CSS or theme variables
	   load, since someone may open it cold from a link they were texted. */
	:global(body:has(> div > main)) {
		background: #fff8f7;
	}

	.eyebrow {
		margin: 0 0 0.35rem;
		font-family: 'Avara', Georgia, serif;
		font-size: 0.95rem;
		color: #8a7f7d;
	}

	h1 {
		font-size: 2.4rem;
		line-height: 1.1;
		letter-spacing: -0.02em;
		margin: 0 0 1rem;
	}

	h2 {
		font-size: 1.15rem;
		margin: 2.25rem 0 0.5rem;
		letter-spacing: -0.01em;
	}

	.lede {
		font-size: 1.075rem;
		margin: 0 0 2rem;
	}

	ol {
		margin: 0;
		padding-left: 1.25rem;
	}
	ol li {
		margin-bottom: 0.4rem;
	}

	.callout {
		margin: 0 0 2rem;
		padding: 1rem 1.15rem;
		border: 1.5px solid #e5d9d6;
		border-radius: 12px;
		background: #fffdfc;
	}
	.callout strong {
		display: block;
		margin-bottom: 0.2rem;
	}
	.callout p {
		margin: 0 0 0.75rem;
		font-size: 0.925rem;
	}
	.callout p:last-child {
		margin-bottom: 0;
	}
	.callout-go {
		border-color: #1a1414;
	}
	.callout-warn {
		border-color: #d99b6c;
		background: #fdf4ec;
	}
	.callout-done {
		border-color: #7fa87f;
		background: #f1f7f1;
	}

	.btn {
		display: inline-block;
		padding: 0.6rem 1.1rem;
		border: none;
		border-radius: 8px;
		background: #1a1414;
		color: #fff8f7;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	.btn-quiet {
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
		background: transparent;
		color: #1a1414;
		border: 1.5px solid #1a1414;
	}

	.note {
		margin: 2rem 0 0;
		padding: 0.9rem 1.1rem;
		border-left: 3px solid #e5d9d6;
		background: #fffdfc;
	}
	.note p {
		margin: 0;
		font-size: 0.9rem;
		color: #4a4040;
	}

	.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
	}

	.foot {
		margin-top: 3rem;
		padding-top: 1.5rem;
		border-top: 1.5px solid #e5d9d6;
		font-size: 0.9rem;
		color: #8a7f7d;
	}

	a {
		color: inherit;
	}

	@media (max-width: 640px) {
		main {
			padding: 2.5rem 1.15rem 4rem;
		}
		h1 {
			font-size: 1.9rem;
		}
	}
</style>
