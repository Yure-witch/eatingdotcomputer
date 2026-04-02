<script>
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off } from 'firebase/database';

	let { data, form } = $props();

	let approvalRef;

	onMount(async () => {
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
	});
</script>

<svelte:head><title>Pending approval — eating.computer</title></svelte:head>

<div class="card">
	{#if data.status === 'denied'}
		<div class="icon">✗</div>
		<h1>Request denied</h1>
		<p class="sub">Your request to join <strong>{data.className}</strong> ({data.term}) was not approved. Contact your instructor if you think this is a mistake.</p>
	{:else}
		<div class="icon spin">◌</div>
		<h1>Waiting for approval</h1>
		<p class="sub">
			Your request to join <strong>{data.className}</strong> ({data.term}) has been sent.
			Your instructor will approve it shortly.
		</p>

		{#if form?.status === 'pending'}
			<p class="still-pending">Still pending — check back in a bit.</p>
		{/if}

		<form method="POST" action="?/check" use:enhance>
			<button type="submit" class="btn-check">Check status</button>
		</form>
	{/if}
</div>

<style>
	.card {
		background: #fff;
		border: 1.5px solid #ddd7cc;
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

	.icon {
		font-size: 2.5rem;
		color: #a09688;
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
		color: var(--ink, #1a1a1a);
	}

	.sub {
		font-size: 0.9rem;
		color: #666;
		line-height: 1.5;
		margin: 0;
		max-width: 320px;
	}

	.still-pending {
		font-size: 0.82rem;
		color: #a09688;
		margin: 0;
	}

	.btn-check {
		margin-top: 0.5rem;
		padding: 0.6rem 1.5rem;
		background: none;
		border: 1.5px solid #c8c1b4;
		border-radius: 10px;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		color: var(--ink, #1a1a1a);
		transition: border-color 0.15s;
	}
	.btn-check:hover { border-color: var(--ink, #1a1a1a); }
</style>
