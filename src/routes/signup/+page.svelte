<script>
	import { enhance } from '$app/forms';

	let { form } = $props();

	// Held locally so the auto sign-in can replay the same credentials
	// through the login page's action once creation succeeds — that action
	// owns the Auth.js cookie handshake and the /app redirect.
	let username = $state(form?.username ?? '');
	let password = $state('');
	let signingIn = $state(false);

	// Custom enhance callback: apply the action result WITHOUT the default
	// form reset or invalidation, then hand off to a full-page credentials
	// POST built on the spot from local state. A pre-rendered hidden form
	// raced enhance's post-submit work here and went out empty.
	function onSignup() {
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.created) {
				signingIn = true;
				await update({ reset: false, invalidateAll: false });
				const f = document.createElement('form');
				f.method = 'POST';
				f.action = '/login';
				const add = (n, v) => {
					const i = document.createElement('input');
					i.type = 'hidden'; i.name = n; i.value = v;
					f.appendChild(i);
				};
				add('providerId', 'credentials');
				add('redirectTo', '/app');
				add('email', username);
				add('password', password);
				document.body.appendChild(f);
				f.submit();
				return;
			}
			await update({ reset: false });
		};
	}
</script>

<svelte:head><title>Create account — eating.computer</title></svelte:head>

<main>
	<div class="card">
		<a class="brand" href="/">
			<img class="mark" src="/favicon.svg" alt="" width="72" height="72" />
			<span class="brand-name">eating.computer</span>
		</a>

		{#if form?.error}
			<p class="error">{form.error}</p>
		{/if}
		{#if form?.created}
			<p class="ok">Account created — signing you in…</p>
		{/if}

		<form method="POST" use:enhance={onSignup}>
			<label>
				<span>Name</span>
				<input type="text" name="name" required value={form?.name ?? ''} autocomplete="name" placeholder="Your full name" />
			</label>
			<label>
				<span>Username</span>
				<input type="text" name="username" required bind:value={username} autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="e.g. riso_fan" />
			</label>
			<label>
				<span>Email <em class="opt">(optional — for reminders)</em></span>
				<input type="email" name="email" value={form?.email ?? ''} autocomplete="email" placeholder="you@example.com" />
			</label>
			<label>
				<span>Password</span>
				<input type="password" name="password" required bind:value={password} minlength="8" autocomplete="new-password" placeholder="At least 8 characters" />
			</label>
			<button type="submit" class="btn-primary" disabled={signingIn}>Create account</button>
		</form>

		<p class="login-hint">Already have an account? <a href="/login">Sign in</a></p>
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
	.brand:hover { opacity: 0.8; }
	.mark { width: 72px; height: 72px; border-radius: 18px; }
	.brand-name {
		font-family: 'Avara', serif;
		font-size: clamp(1.6rem, 6vw, 2rem);
		color: var(--ink);
		text-align: center;
	}

	form { display: flex; flex-direction: column; gap: 0.75rem; }

	label {
		display: flex; flex-direction: column; gap: 0.3rem;
		font-size: 0.85rem; font-weight: 500; color: var(--ink);
	}
	.opt { font-weight: 400; font-style: normal; color: var(--muted-fg); }

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
	input:focus { border-color: var(--ink); }

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
	.btn-primary:hover { opacity: 0.85; }
	.btn-primary:disabled { opacity: 0.5; cursor: default; }

	.error {
		background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px;
		padding: 0.6rem 0.85rem; font-size: 0.85rem; color: #b91c1c; margin: 0;
	}
	.ok {
		border: 1.5px solid var(--border); border-radius: 8px;
		padding: 0.6rem 0.85rem; font-size: 0.85rem; color: var(--ink); margin: 0;
	}

	.login-hint {
		margin: 0.25rem 0 0; text-align: center;
		font-size: 0.85rem; color: var(--muted-fg);
	}
	.login-hint a { color: var(--ink); }

	/* Phones: four fields + button must fit WITHOUT scrolling — needing to
	   scroll to find the password box on a sign-up form is a losing first
	   impression (and looks clumsy on the App Review recording). The brand
	   lockup gives up most of the space; the field gaps give up the rest. */
	@media (max-width: 640px) {
		main { padding: 1rem 1.25rem; align-items: flex-start; }
		.card { gap: 0.7rem; }
		.brand { margin-bottom: 0.1rem; gap: 0.5rem; }
		.mark { width: 44px; height: 44px; border-radius: 11px; }
		.brand-name { font-size: 1.35rem; }
		form { gap: 0.55rem; }
		input { padding: 0.55rem 0.75rem; }
	}
</style>
