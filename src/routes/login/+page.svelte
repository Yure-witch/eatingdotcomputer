<script>
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';

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
		<a class="wordmark" href="/">eating.computer</a>

		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}

		<!-- Google -->
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

		<div class="divider"><span>or</span></div>

		<!-- Email + password -->
		<form method="POST" use:enhance>
			<input type="hidden" name="providerId" value="credentials" />
			<input type="hidden" name="redirectTo" value="/app" />
			<label>
				<span>Email</span>
				<input type="email" name="email" required autocomplete="email" placeholder="you@example.com" />
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
		display: grid;
		place-items: center;
		padding: 2rem;
		background: var(--paper);
	}

	.card {
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.wordmark {
		font-family: 'Avara', serif;
		font-size: 1.5rem;
		color: var(--ink);
		text-decoration: none;
		margin-bottom: 0.5rem;
		display: inline-block;
	}

	.wordmark:hover {
		opacity: 0.7;
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
		border: 1.5px solid #c8c1b4;
		border-radius: 8px;
		background: #fff;
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
		background: #fff;
		border: 1.5px solid #c8c1b4;
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

	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: #a09688;
		font-size: 0.8rem;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: #c8c1b4;
	}

	.error {
		padding: 0.6rem 0.75rem;
		background: #fff0f0;
		border: 1.5px solid #f5c6cb;
		border-radius: 8px;
		color: #c0392b;
		font-size: 0.85rem;
		margin: 0;
	}
</style>
