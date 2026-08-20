<script>
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off } from 'firebase/database';

	let { data, form } = $props();

	let approvalRef;
	// Quiet by default: a spinner alone, because approval is usually quick and
	// a wall of "awaiting approval" copy makes a two-second wait feel like a
	// dead end. Only after 30s do we explain what's being waited on.
	let waitingLong = $state(false);
	let longTimer;

	onMount(async () => {
		longTimer = setTimeout(() => (waitingLong = true), 30000);
		if (!data.firebaseToken || !data.userId) return;
		try {
			await signInWithCustomToken(auth, data.firebaseToken);
		} catch { /* ignore — polling fallback still works */ }

		approvalRef = ref(rtdb, `approvals/${data.userId}`);
		onValue(approvalRef, (snap) => {
			if (snap.exists()) goto('/app');
		});
	});

	onDestroy(() => {
		if (approvalRef) off(approvalRef);
		clearTimeout(longTimer);
	});
</script>

<svelte:head><title>Pending approval — eating.computer</title></svelte:head>

<div class="card">
	{#if data.status === 'denied'}
		<div class="icon">✗</div>
		<h1>Request denied</h1>
		<p class="sub">Your request to join <strong>{data.className}</strong> ({data.term}) was not approved. Contact your instructor if you think this is a mistake.</p>
	{:else}
		<div class="spinner" role="status" aria-live="polite"
			aria-label={waitingLong ? 'Waiting for instructor to approve enrollment' : 'Working'}></div>

		{#if waitingLong}
			<p class="waiting-long">Waiting for instructor to approve enrollment</p>
			{#if form?.status === 'pending'}
				<p class="still-pending">Still pending — check back in a bit.</p>
			{/if}
			<form method="POST" action="?/check" use:enhance>
				<button type="submit" class="btn-check">Check status</button>
			</form>
			<form method="POST" action="?/back" use:enhance>
				<button type="submit" class="btn-back">← Choose a different class</button>
			</form>
		{/if}
	{/if}
</div>

<style>
	.card {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		padding: 3rem 2rem;
		width: 100%;
		max-width: 420px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	/* Indeterminate — there's no progress to report, and a determinate bar
	   would be a lie. Approval arrives over the RTDB listener above, so this
	   usually resolves before the 30s message ever appears. */
	.spinner {
		width: 42px; height: 42px;
		border-radius: 50%;
		border: 3px solid color-mix(in srgb, var(--md-sys-color-primary, var(--ink)) 18%, transparent);
		border-top-color: var(--md-sys-color-primary, var(--ink));
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) {
		.spinner { animation-duration: 2.4s; }
	}
	.btn-back {
		min-height: 44px;
		padding: 0.6rem 1rem;
		border: none; background: none;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		font: inherit; font-size: 0.9rem; cursor: pointer;
		text-decoration: underline;
	}
	.waiting-long {
		font-size: 0.95rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		margin: 0.25rem 0 0;
		animation: fade-in 0.35s ease both;
	}
	@keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

	.icon {
		font-size: 2.5rem;
		color: var(--muted-fg);
		line-height: 1;
		margin-bottom: 0.25rem;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.spin { display: inline-block; animation: spin 2s linear infinite; }

	h1 {
		font-family: 'Avara', serif;
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0;
		color: var(--ink, var(--ink));
	}

	.sub {
		font-size: 0.9rem;
		color: var(--muted-fg);
		line-height: 1.5;
		margin: 0;
		max-width: 320px;
	}

	.still-pending {
		font-size: 0.82rem;
		color: var(--muted-fg);
		margin: 0;
	}

	.btn-check {
		margin-top: 0.5rem;
		padding: 0.6rem 1.5rem;
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 10px;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		color: var(--ink, var(--ink));
		transition: border-color 0.15s;
	}
	.btn-check:hover { border-color: var(--ink, var(--ink)); }
</style>
