<!--
	Desktop install instructions. PUBLIC and unauthenticated, same as
	/androidpwa and /iosapp — the point is a link you can send to someone who
	doesn't have an account yet.

	The steps themselves live in DesktopInstallSteps.svelte because /iosapp
	answers "I'm on a computer" with the same walkthrough.
-->
<script>
	import { onMount } from 'svelte';
	import DesktopInstallSteps from '$lib/components/DesktopInstallSteps.svelte';

	let isPhone = $state(false);
	let isAndroid = $state(false);
	let checked = $state(false);

	onMount(() => {
		const ua = navigator.userAgent;
		isAndroid = /android/i.test(ua);
		isPhone = isAndroid || /iphone|ipad|ipod/i.test(ua);
		checked = true;
	});
</script>

<svelte:head>
	<title>Install on your computer — eating.computer</title>
	<meta
		name="description"
		content="How to install eating.computer as a desktop app in Safari, Chrome or Edge."
	/>
</svelte:head>

<main>
	<p class="eyebrow">eating.computer</p>
	<h1>Install on your computer</h1>
	<p class="lede">
		eating.computer installs on a desktop too, straight from the browser. It gets its
		own window with no browser chrome around it, and its own icon in the Dock,
		taskbar or Start menu — it stops being a tab you keep losing.
	</p>

	{#if checked && isPhone}
		<div class="callout callout-warn">
			<strong>You're on a phone.</strong>
			<p>These steps are for a computer. Here's the one for the device you're holding:</p>
			<a class="btn btn-quiet" href={isAndroid ? '/androidpwa' : '/iosapp'}>
				{isAndroid ? 'Install on Android →' : 'Get the iPhone app →'}
			</a>
		</div>
	{/if}

	<DesktopInstallSteps />

	<h2>What you get</h2>
	<p>
		The same app, in its own window — chat, assignments, files, everything. It keeps
		you signed in, shows up in your app switcher, and can send desktop notifications
		for mentions, replies and DMs. Nothing is lost by staying in a browser tab
		instead; this is a convenience, not a different product.
	</p>

	<h2>On a phone instead?</h2>
	<p>
		<a href="/iosapp">iPhone and iPad</a> · <a href="/androidpwa">Android</a>
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
		/* Google Sans Flex is the app's face (loaded in app.css); Space Grotesk
		   stays as the fallback it was before, not as the default. */
		font-family: 'Google Sans Flex', 'Space Grotesk', system-ui, -apple-system, sans-serif;
		font-size: 1rem;
		line-height: 1.65;
		color: #1a1414;
		background: #fff8f7;
	}

	/* Standalone page — must be readable before any app CSS or theme variables
	   load, since someone may open it cold from a link they were sent. */
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
		margin: 0 0 2rem;
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
	.callout-warn {
		border-color: #d99b6c;
		background: #fdf4ec;
	}

	.btn-quiet {
		display: inline-block;
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		background: transparent;
		color: #1a1414;
		border: 1.5px solid #1a1414;
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
