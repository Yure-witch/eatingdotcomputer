<script>
	import { onMount } from 'svelte';

	// The service worker serves this page when a navigation fails offline
	// (see src/service-worker.js). It renders the last snapshot the app
	// layout wrote to localStorage — your class, frozen in time — instead of
	// a generic apology. Self-sufficient on purpose: no data loads, nothing
	// that needs the network; the JS/CSS it uses are precached.
	let snap = $state(null);
	onMount(() => {
		try {
			const raw = localStorage.getItem('ec-offline-snapshot');
			if (raw) {
				const s = JSON.parse(raw);
				if (s?.v === 1 && Array.isArray(s.channels)) snap = s;
			}
		} catch { /* stays generic */ }
	});

	function agoLabel(at) {
		const mins = Math.max(1, Math.round((Date.now() - at) / 60000));
		if (mins < 60) return `${mins} min ago`;
		const hrs = Math.round(mins / 60);
		if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
		return `${Math.round(hrs / 24)} day${hrs < 48 ? '' : 's'} ago`;
	}

	function retry() {
		try {
			// Go where the user was headed, not to /offline itself.
			const back = document.referrer && new URL(document.referrer).origin === location.origin
				? document.referrer
				: '/app';
			location.replace(back);
		} catch {
			location.replace('/app');
		}
	}
</script>

<svelte:head><title>Offline — eating.computer</title></svelte:head>

<main class:has-snap={!!snap}>
	{#if snap}
		<div class="snap-wrap">
			<header class="snap-head">
				<img class="mark small" src="/favicon.svg" alt="" width="36" height="36" />
				<div class="snap-title">
					<h1>{snap.className || 'eating.computer'}</h1>
					<p class="snap-sub">Offline — showing what was here {agoLabel(snap.at)}</p>
				</div>
			</header>

			<div class="offline-pill" role="status">
				<span class="dot"></span> You're offline
				<button class="pill-retry" onclick={retry}>Try again</button>
			</div>

			{#if snap.channels.length}
				<section class="snap-section">
					<h2>Channels</h2>
					{#each snap.channels as ch (ch.id)}
						<div class="snap-channel">
							<span class="snap-hash">#</span>
							<div class="snap-ch-body">
								<span class="snap-ch-name">{ch.name}</span>
								{#if ch.last}
									<span class="snap-ch-last">{#if ch.lastUser}<strong>{ch.lastUser}:</strong>{/if} {ch.last}</span>
								{/if}
							</div>
						</div>
					{/each}
				</section>
			{/if}

			{#if snap.members?.length}
				<section class="snap-section">
					<h2>Members</h2>
					<p class="snap-members">
						{#each snap.members as m, i}{i > 0 ? ', ' : ''}{m.name}{m.role === 'instructor' ? ' (instructor)' : ''}{/each}
					</p>
				</section>
			{/if}

			<p class="snap-note">New messages, assignments, and sends need a connection — everything catches up the moment you're back.</p>
		</div>
	{:else}
		<div class="card">
			<img class="mark" src="/favicon.svg" alt="" width="64" height="64" />
			<h1>You're offline</h1>
			<p>eating.computer needs a connection for live class chat and assignments. Anything already loaded keeps working — the rest is waiting for you when you're back.</p>
			<button class="btn-retry" onclick={retry}>Try again</button>
		</div>
	{/if}
</main>

<style>
	main {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex; align-items: center; justify-content: center;
		padding: 2rem 1.25rem;
		background: var(--paper);
	}
	main.has-snap { align-items: flex-start; padding-top: max(2rem, env(safe-area-inset-top, 0px)); }

	/* ── Generic (no snapshot) ── */
	.card {
		max-width: 360px; text-align: center;
		display: flex; flex-direction: column; align-items: center; gap: 0.9rem;
	}
	.mark { border-radius: 16px; }
	.mark.small { border-radius: 9px; flex-shrink: 0; }
	h1 { font-family: 'Avara', serif; font-size: 1.8rem; font-weight: 400; margin: 0; color: var(--ink); }
	p { margin: 0; font-size: 0.9rem; color: var(--muted-fg); line-height: 1.55; }
	.btn-retry {
		margin-top: 0.35rem;
		padding: 0.6rem 1.5rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 10px;
		font-family: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer;
	}
	.btn-retry:hover { opacity: 0.85; }

	/* ── Snapshot view ── */
	.snap-wrap { width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 1.1rem; }
	.snap-head { display: flex; align-items: center; gap: 0.8rem; }
	.snap-title h1 { font-size: 1.25rem; line-height: 1.25; }
	.snap-sub { font-size: 0.8rem; margin-top: 0.15rem; }

	.offline-pill {
		display: flex; align-items: center; gap: 0.5rem;
		align-self: flex-start;
		background: #7f1d1d; color: #fff;
		border-radius: 999px; padding: 0.4rem 0.5rem 0.4rem 0.9rem;
		font-size: 0.82rem;
	}
	.dot { width: 8px; height: 8px; border-radius: 50%; background: #fca5a5; }
	.pill-retry {
		margin-left: 0.35rem;
		background: rgba(255, 255, 255, 0.16); color: #fff;
		border: none; border-radius: 999px; padding: 0.25rem 0.7rem;
		font-family: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer;
	}
	.pill-retry:hover { background: rgba(255, 255, 255, 0.28); }

	.snap-section {
		border: 1.5px solid var(--border); border-radius: 12px;
		padding: 0.9rem 1rem;
		display: flex; flex-direction: column; gap: 0.6rem;
	}
	.snap-section h2 {
		margin: 0; font-size: 0.72rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted-fg);
	}
	.snap-channel { display: flex; gap: 0.6rem; align-items: flex-start; }
	.snap-hash {
		width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		background: var(--surface-2, rgba(0, 0, 0, 0.05));
		font-weight: 700; color: var(--muted-fg);
	}
	.snap-ch-body { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
	.snap-ch-name { font-weight: 600; font-size: 0.92rem; color: var(--ink); }
	.snap-ch-last {
		font-size: 0.8rem; color: var(--muted-fg);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.snap-members { font-size: 0.85rem; line-height: 1.6; color: var(--ink); }
	.snap-note { font-size: 0.78rem; }
</style>
