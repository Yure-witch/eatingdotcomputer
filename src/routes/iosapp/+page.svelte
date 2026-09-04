<!--
	App Store link. PUBLIC and unauthenticated, same reasoning as /androidpwa:
	this is a link you text to someone who doesn't have an account yet.

	A page rather than a bare redirect, because a redirect strands the two
	audiences it can't help — an Android visitor lands on an iPhone-only store
	listing with no way back, and a desktop visitor gets a page that can't
	install anything. Both get pointed somewhere useful here instead.
-->
<script>
	import { onMount } from 'svelte';
	import { APP_STORE_URL } from '$lib/native.js';
	import DesktopInstallSteps from '$lib/components/DesktopInstallSteps.svelte';

	let isAndroid = $state(false);
	let isIOS = $state(false);
	let checked = $state(false);

	onMount(() => {
		const ua = navigator.userAgent;
		isAndroid = /android/i.test(ua);
		isIOS = /iphone|ipad|ipod/i.test(ua);
		checked = true;
	});
</script>

<svelte:head>
	<title>Get the iPhone app — eating.computer</title>
	<meta
		name="description"
		content="Download eating.computer for iPhone and iPad on the App Store."
	/>
</svelte:head>

<main>
	<p class="eyebrow">eating.computer</p>
	<h1>Get the iPhone app</h1>
	<p class="lede">
		The iOS app gets notifications that actually arrive — mentions, replies and DMs
		land on your lock screen, even when the app is closed.
	</p>

	{#if APP_STORE_URL}
		<a class="btn" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
			Download on the App Store
		</a>
	{:else}
		<!-- APP_STORE_URL is null until the listing is live (see native.js).
		     Rendering the button anyway gave a link to nowhere, so while there
		     is nothing to download the page has to be useful on its own — the
		     home-screen route works today and is what people actually need. -->
		<div class="callout callout-warn">
			<strong>Not on the App Store yet.</strong>
			<p>
				The iPhone app is still in review. Until it lands you can add
				eating.computer to your home screen — it looks and works the same
				day to day; the difference is that notifications are less reliable.
			</p>
		</div>

		<h2>Add to your home screen</h2>
		<ol>
			<li>Open <span class="mono">eating.computer</span> in <strong>Safari</strong> (it has to be Safari).</li>
			<li>Tap the <strong>Share</strong> button at the bottom of the screen.</li>
			<li>Scroll down, tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
		</ol>
	{/if}

	{#if checked && isAndroid}
		<div class="callout callout-warn">
			<strong>You're on Android.</strong>
			<p>
				This page is about the iPhone app. On Android you install straight from
				the browser — it takes about ten seconds.
			</p>
			<a class="btn btn-quiet" href="/androidpwa">Install on Android →</a>
		</div>
	{:else if checked && !isIOS}
		<!-- "Nothing to install" was wrong: it installs on the desktop too, in
		     its own window with no browser chrome. Steps come from the shared
		     component so they can't drift from /pwadesktop. -->
		<div class="callout">
			<strong>On a computer?</strong>
			<p>
				You can install it here too. It gets its own window and its own icon in the
				Dock or taskbar, with no browser chrome around it.
			</p>
		</div>

		<h2>Install on your computer</h2>
		<DesktopInstallSteps />

		<p class="foot-note">
			Also at <a href="/pwadesktop">eating.computer/pwadesktop</a>. Prefer a plain tab?
			Nothing is required — <a href="/login">sign in</a> and it works exactly the same
			in the browser.
		</p>
	{/if}

	<h2>On Android instead?</h2>
	<p>
		There's no Play Store listing — the Android version installs straight from the
		browser. <a href="/androidpwa">Here's how</a>.
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
		margin: 2.5rem 0 0.5rem;
		letter-spacing: -0.01em;
	}

	.lede {
		font-size: 1.075rem;
		margin: 0 0 1.75rem;
	}

	ol {
		margin: 0;
		padding-left: 1.25rem;
	}
	ol li {
		margin-bottom: 0.4rem;
	}

	.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
	}

	.foot-note {
		margin: 1.5rem 0 0;
		font-size: 0.9rem;
		color: #8a7f7d;
	}

	.btn {
		display: inline-block;
		padding: 0.7rem 1.25rem;
		border: none;
		border-radius: 8px;
		background: #1a1414;
		color: #fff8f7;
		font-family: inherit;
		font-size: 1rem;
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

	.callout {
		margin: 2rem 0 0;
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
	.callout-warn {
		border-color: #d99b6c;
		background: #fdf4ec;
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
