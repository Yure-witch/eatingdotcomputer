<script>
	/**
	 * Desktop PWA install walkthrough — Safari's Add to Dock and the
	 * Chrome/Edge address-bar install icon.
	 *
	 * Shared by /pwadesktop (where it is the page) and /iosapp (where it is the
	 * answer to "I'm on a computer"). One copy, because two would drift the
	 * moment Chrome moves the menu item again — which it has, twice.
	 *
	 * Typography and colour are inherited from the host page on purpose, so the
	 * component drops into any of the install pages without carrying a second
	 * type scale around with it.
	 */
	import { onMount } from 'svelte';

	let isMac = $state(false);
	let installPrompt = $state(null);
	let installed = $state(false);
	let isStandalone = $state(false);

	onMount(() => {
		const ua = navigator.userAgent;
		isMac = /Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
		isStandalone = window.matchMedia('(display-mode: standalone)').matches;

		// Desktop Chrome and Edge fire this as well as Android — where the
		// browser offers it, the whole walkthrough collapses to one button.
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

{#if isStandalone}
	<div class="di-callout di-done">
		<strong>You're already running the installed app.</strong>
		<p>Nothing to do here.</p>
	</div>
{:else if installed}
	<div class="di-callout di-done">
		<strong>Installed.</strong>
		<p>Look for eating.computer in your Dock, taskbar or Start menu.</p>
	</div>
{:else}
	{#if installPrompt}
		<div class="di-callout di-go">
			<strong>Your browser can do this in one click.</strong>
			<p>No need for the steps below.</p>
			<button class="di-btn" onclick={install}>Install eating.computer</button>
		</div>
	{/if}

	<!-- Safari only exists on macOS, so Windows and Linux visitors are shown the
	     Chrome/Edge route alone rather than a step they cannot follow. -->
	{#if isMac}
		<p class="di-sub">Safari, on macOS Sonoma or later:</p>
		<ol>
			<li>Open <span class="di-mono">eating.computer</span> in Safari.</li>
			<li>Choose <strong>File → Add to Dock</strong>, then <strong>Add</strong>.</li>
		</ol>
	{/if}

	<p class="di-sub">Chrome or Edge:</p>
	<ol>
		<li>
			Look for the <strong>install icon</strong> at the right-hand end of the address bar —
			a small screen with a downward arrow.
		</li>
		<li>
			No icon? Open the <strong>⋮ menu</strong> and choose
			<strong>Install eating.computer</strong>, or
			<strong>Cast, save and share → Install page as app</strong> on newer versions.
		</li>
		<li>Confirm with <strong>Install</strong>.</li>
	</ol>

	<div class="di-note">
		<p>
			<strong>No install option anywhere?</strong> Firefox on the desktop doesn't support
			installing web apps — use Chrome, Edge or Safari. It also won't appear in a
			private window.
		</p>
	</div>
{/if}

<style>
	ol {
		margin: 0;
		padding-left: 1.25rem;
	}
	ol li {
		margin-bottom: 0.4rem;
	}

	.di-sub {
		margin: 1.25rem 0 0.4rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: #4a4040;
	}

	.di-mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
	}

	.di-callout {
		margin: 0 0 1.5rem;
		padding: 1rem 1.15rem;
		border: 1.5px solid #e5d9d6;
		border-radius: 12px;
		background: #fffdfc;
	}
	.di-callout strong {
		display: block;
		margin-bottom: 0.2rem;
	}
	.di-callout p {
		margin: 0 0 0.75rem;
		font-size: 0.925rem;
	}
	.di-callout p:last-child {
		margin-bottom: 0;
	}
	.di-go {
		border-color: #1a1414;
	}
	.di-done {
		border-color: #7fa87f;
		background: #f1f7f1;
	}

	.di-btn {
		display: inline-block;
		padding: 0.6rem 1.1rem;
		border: none;
		border-radius: 8px;
		background: #1a1414;
		color: #fff8f7;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}

	.di-note {
		margin: 1.75rem 0 0;
		padding: 0.9rem 1.1rem;
		border-left: 3px solid #e5d9d6;
		background: #fffdfc;
	}
	.di-note p {
		margin: 0;
		font-size: 0.9rem;
		color: #4a4040;
	}
</style>
