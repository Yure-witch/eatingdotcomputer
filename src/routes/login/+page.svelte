<script>
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { tick, onMount } from 'svelte';
	import { isNativeApp, nativeGoogleIdToken, nativeAppleIdToken } from '$lib/native.js';

	// Capacitor only resolves client-side, so this stays false through SSR and
	// flips on mount — the Apple button is native-only.
	let isNative = false;
	onMount(() => { isNative = isNativeApp(); });

	let appleForm;
	let appleIdToken = '';
	let appleName = '';

	async function handleApple() {
		if (nativeBusy) return;
		nativeBusy = true;
		nativeError = '';
		try {
			const res = await nativeAppleIdToken();
			if (!res) { nativeError = 'Apple sign-in was cancelled.'; return; }
			appleIdToken = res.idToken;
			appleName = res.name;
			await tick();
			appleForm.requestSubmit();
		} catch (err) {
			console.warn('[auth] native Apple sign-in failed', err);
			nativeError = 'Could not sign in with Apple. Please try again.';
		} finally {
			nativeBusy = false;
		}
	}

	let googleForm;
	let nativeIdToken = '';
	let nativeBusy = false;
	let nativeError = '';

	/**
	 * Inside the Capacitor shell Google refuses the webview OAuth redirect, so
	 * we sign in with the native SDK first and post the resulting ID token to
	 * the `google-native` provider instead. On the plain web this handler does
	 * nothing and the form submits normally.
	 */
	async function handleGoogle() {
		if (nativeBusy) return;
		nativeBusy = true;
		nativeError = '';
		try {
			const token = await nativeGoogleIdToken();
			if (!token) { nativeError = 'Google sign-in was cancelled.'; return; }
			nativeIdToken = token;
			// Let the bound value land in the DOM before submitting the form.
			await tick();
			googleForm.requestSubmit();
		} catch (err) {
			console.warn('[auth] native Google sign-in failed', err);
			nativeError = 'Could not sign in with Google. Please try again.';
		} finally {
			nativeBusy = false;
		}
	}

	const errorMessages = {
		CredentialsSignin: 'Incorrect email or password.',
		OAuthSignin: 'Could not sign in with Google. Please try again.',
		Default: 'Something went wrong. Please try again.'
	};

	$: error = $page.url.searchParams.get('error');
	$: errorMessage = error ? (errorMessages[error] ?? errorMessages.Default) : null;
</script>

<svelte:head>
	<title>Log in — eating.computer</title>
</svelte:head>

<main>
	<div class="card">
		<a class="brand" href="/">
			<img class="mark" src="/favicon.svg" alt="" width="72" height="72" />
			<span class="brand-name">eating.computer</span>
		</a>

		{#if errorMessage || nativeError}
			<p class="error">{nativeError || errorMessage}</p>
		{/if}

		<!-- Google. On the web this is an ordinary Auth.js form post. In the
		     native shell that flow is impossible (Google blocks OAuth in an
		     embedded webview), so we render a plain button instead and submit the
		     hidden form ourselves once the native SDK has returned an ID token.
		     The two paths are kept separate on purpose: intercepting submit on a
		     use:enhance form does NOT stop enhance's own listener, so a
		     preventDefault() here would still fire the web sign-in underneath. -->
		{#if isNative}
			<button type="button" class="btn-google" on:click={handleGoogle} disabled={nativeBusy}>
				<svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
					<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
					<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
					<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
					<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
				</svg>
				Continue with Google
			</button>
			<form method="POST" use:enhance bind:this={googleForm} hidden>
				<input type="hidden" name="providerId" value="google-native" />
				<input type="hidden" name="idToken" value={nativeIdToken} />
				<input type="hidden" name="redirectTo" value="/app" />
			</form>

			<!-- Apple — native only. Required alongside Google by Guideline 4.8. -->
			<button type="button" class="btn-apple" on:click={handleApple} disabled={nativeBusy}>
				<svg class="apple-icon" viewBox="0 0 24 24" aria-hidden="true">
						<path fill="currentColor" d="M16.36 12.78c.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.32-3.5zM14.2 6.1c.6-.74 1.01-1.76.9-2.78-.87.04-1.93.58-2.56 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.97-.49 2.58-1.22z"/>
					</svg>
				Continue with Apple
			</button>
			<form method="POST" use:enhance bind:this={appleForm} hidden>
				<input type="hidden" name="providerId" value="apple-native" />
				<input type="hidden" name="idToken" value={appleIdToken} />
				<input type="hidden" name="name" value={appleName} />
				<input type="hidden" name="redirectTo" value="/app" />
			</form>
		{:else}
			<form method="POST" use:enhance>
				<input type="hidden" name="providerId" value="google" />
				<input type="hidden" name="redirectTo" value="/app" />
				<button type="submit" class="btn-google">
					<svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
					<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
					<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
					<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
					<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
				</svg>
					Continue with Google
				</button>
			</form>
		{/if}

		<div class="divider"><span>or</span></div>

		<!-- Email + password -->
		<form method="POST" use:enhance>
			<input type="hidden" name="providerId" value="credentials" />
			<input type="hidden" name="redirectTo" value="/app" />
			<label>
				<span>Email or username</span>
				<input type="text" name="email" required autocomplete="username" placeholder="you@example.com" />
			</label>

			<label>
				<span>Password</span>
				<input type="password" name="password" required autocomplete="current-password" placeholder="••••••••" />
			</label>

			<button type="submit" class="btn-primary">Sign in</button>
		</form>
	</div>
</main>

<style>
	main {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1.25rem;
		background: var(--paper);
	}

	.card {
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		text-decoration: none;
		margin-bottom: 1rem;
	}

	.brand:hover {
		opacity: 0.8;
	}

	.mark {
		width: 72px;
		height: 72px;
		border-radius: 18px;
	}

	/* Named brand-name, not wordmark — app.css hides .wordmark on desktop
	   (sidebar carries the logo there), but this page has no sidebar. */
	.brand-name {
		font-family: 'Avara', serif;
		font-size: clamp(1.6rem, 6vw, 2rem);
		color: var(--ink);
		text-align: center;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--ink);
	}

	input {
		padding: 0.6rem 0.75rem;
		border: 1.5px solid var(--border);
		border-radius: 8px;
		background: var(--paper);
		font-family: inherit;
		font-size: 0.95rem;
		color: var(--ink);
		outline: none;
		transition: border-color 0.15s;
	}

	input:focus {
		border-color: var(--ink);
	}

	.btn-google {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.65rem 1rem;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--ink);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.btn-google:hover {
		border-color: var(--ink);
		background: #f0ebe2;
	}

	.google-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.btn-primary {
		width: 100%;
		padding: 0.65rem 1rem;
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

	.btn-primary:hover {
		opacity: 0.8;
	}

	.btn-apple {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.8rem 1rem;
		border: 1px solid #000;
		border-radius: 8px;
		background: #000;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-apple:disabled { opacity: 0.6; cursor: default; }
	.apple-icon { width: 20px; height: 20px; }

	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--muted-fg);
		font-size: 0.8rem;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border);
	}

	.error {
		padding: 0.6rem 0.75rem;
		background: #fff0f0;
		border: 1.5px solid #f5c6cb;
		border-radius: 8px;
		color: var(--danger);
		font-size: 0.85rem;
		margin: 0;
	}
</style>
