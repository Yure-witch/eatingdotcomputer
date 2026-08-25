<script>
	import { enhance } from '$app/forms';
	let submitting = $state(false);
</script>

<svelte:head><title>Terms of Use — eating.computer</title></svelte:head>

<main>
	<div class="card">
		<a class="brand" href="/">
			<img class="mark" src="/favicon.svg" alt="" width="56" height="56" />
			<span class="brand-name">eating.computer</span>
		</a>

		<h1>Before you continue</h1>
		<p class="intro">
			eating.computer is a shared classroom. Using it means agreeing to the
			<a href="/terms" target="_blank" rel="noopener">Terms of Use</a>. In short:
		</p>

		<ul class="points">
			<li>
				<strong>No tolerance for objectionable content or abusive behavior.</strong>
				Harassment, hate speech, explicit material, spam — none of it is
				acceptable here. Offending content is removed and the accounts that
				post it are ejected.
			</li>
			<li>
				<strong>Every message can be reported.</strong> Reports go to the
				instructor's moderation queue and are acted on within 24 hours.
			</li>
			<li>
				<strong>You can block anyone.</strong> Their messages disappear from
				your view instantly, and the moderator is notified.
			</li>
			<li>
				What you post stays yours, and the
				<a href="/privacy" target="_blank" rel="noopener">privacy policy</a>
				covers what is collected and why.
			</li>
		</ul>

		<form method="POST" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false; }; }}>
			<button type="submit" class="btn-primary" disabled={submitting}>
				I agree to the Terms of Use
			</button>
		</form>
		<!-- Sign-out goes through the same /app?/signout action as the user
		     menu (clears the class cookie, redirects to /login). The /logout
		     page is a trap here: it auto-resubmits signOut with no redirect
		     target, which loops right back to itself. -->
		<p class="fine">If you don't agree, <button type="submit" form="terms-signout" class="link-btn">sign out</button> — the app can't be used without accepting.</p>
		<form id="terms-signout" method="POST" action="/app?/signout" hidden></form>
	</div>
</main>

<style>
	main {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		/* The native shell draws edge-to-edge (viewport-fit=cover), so the
		   top padding has to clear the camera housing. env() is 0 on the
		   plain web — no visual change there. */
		padding: calc(2rem + env(safe-area-inset-top, 0px)) 1.25rem calc(2rem + env(safe-area-inset-bottom, 0px));
		background: var(--paper);
	}

	.card {
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		text-decoration: none;
		margin-bottom: 0.5rem;
	}
	.brand:hover { opacity: 0.8; }
	.mark { width: 56px; height: 56px; border-radius: 14px; }
	.brand-name {
		font-family: 'Avara', serif;
		font-size: 1.5rem;
		color: var(--ink);
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: 1.35rem;
		color: var(--ink);
		text-align: center;
		letter-spacing: -0.01em;
	}

	.intro {
		margin: 0;
		font-size: 0.92rem;
		color: var(--ink);
		line-height: 1.5;
	}

	.points {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--ink);
	}

	a { color: var(--ink); }

	.btn-primary {
		width: 100%;
		padding: 0.7rem 1rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.85; }
	.btn-primary:disabled { opacity: 0.5; cursor: default; }

	.fine {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted-fg);
		text-align: center;
	}

	.link-btn {
		display: inline;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	@media (max-width: 640px) {
		main { padding: calc(1.25rem + env(safe-area-inset-top, 0px)) 1.25rem calc(1.25rem + env(safe-area-inset-bottom, 0px)); align-items: flex-start; }
		.brand { margin-bottom: 0.1rem; }
		.mark { width: 44px; height: 44px; border-radius: 11px; }
	}
</style>
