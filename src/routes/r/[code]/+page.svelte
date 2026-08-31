<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import RankList from '$lib/components/RankList.svelte';
	import { db as rtdb } from '$lib/firebase.js';
	import { ref, onValue } from 'firebase/database';
	import FavoritesPicker from '$lib/components/FavoritesPicker.svelte';

	// PUBLIC — no account, no login. Someone scanned a QR off a screen, so the
	// whole page is one name field and one list, sized for a phone held in one
	// hand. Nothing here asks them to sign up.

	const code = $derived(($page.params.code ?? '').toUpperCase());

	let poll = $state(null);
	let items = $state([]);
	let favItems = $state([]);
	let leastItems = $state([]);
	let myRanking = $state(null);
	let myLeast = $state(null);
	let results = $state(null);
	let responseCount = $state(0);

	let name = $state('');
	let guestId = $state('');
	let started = $state(false); // past the name step

	let loading = $state(true);
	let loadError = $state('');
	let sending = $state(false);
	let sendError = $state('');
	let sent = $state(false);
	// Remembered locally so a returning phone knows it already answered before
	// the network says so — the ballot itself lives on the server, this is just
	// what lets the page say "you've done this" on the very first paint.
	let remembered = $state(null);

	const isFavorites = $derived(poll?.format === 'favorites');
	const submitted = $derived(myRanking != null);
	const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
	const dirty = $derived.by(() => {
		if (!submitted) return true;
		if (isFavorites) {
			return !sameIds(favItems.map((o) => o.id), myRanking ?? [])
				|| !sameIds(leastItems.map((o) => o.id), myLeast ?? []);
		}
		return !sameIds(items.map((o) => o.id), myRanking ?? []);
	});
	const meetsMinimums = $derived(
		!isFavorites
		|| (favItems.length >= (poll?.minFavorites ?? 0) && leastItems.length >= (poll?.minLeast ?? 0))
	);

	// One id per phone, kept locally. It's what makes coming back to fix your
	// order an edit rather than a second ballot — and it's not an account: it
	// says nothing about who they are beyond the name they chose to type.
	function deviceId() {
		try {
			const k = 'ec:rank:guest';
			let v = localStorage.getItem(k);
			if (!v) { v = `guest:${crypto.randomUUID()}`; localStorage.setItem(k, v); }
			return v;
		} catch {
			return `guest:${crypto.randomUUID()}`; // private mode — one ballot, no memory of it
		}
	}

	const memoryKey = 'ec:rank:answered';
	function readMemory() {
		try { return JSON.parse(localStorage.getItem(memoryKey) || '{}')[code] ?? null; } catch { return null; }
	}
	function rememberAnswered() {
		try {
			const all = JSON.parse(localStorage.getItem(memoryKey) || '{}');
			all[code] = { name, at: Date.now(), title: poll?.title ?? '' };
			localStorage.setItem(memoryKey, JSON.stringify(all));
			remembered = all[code];
		} catch { /* private mode — the server still has the ballot */ }
	}

	async function load({ keepPicks = false } = {}) {
		try {
			const res = await fetch(`/api/rank/${code}?g=${encodeURIComponent(guestId)}`);
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.message || 'That code is not open');
			poll = out.poll;
			items = out.items ?? [];
			myRanking = out.myRanking;
			myLeast = out.myLeast;
			results = out.results;
			responseCount = out.responseCount ?? 0;
			// A background refresh picks up other people's write-ins, and must
			// not disturb picks this person is still making.
			if (out.poll?.format === 'favorites' && !keepPicks) {
				const byId = new Map(items.map((i) => [i.id, i]));
				favItems = (out.myRanking ?? []).map((id) => byId.get(id)).filter(Boolean);
				leastItems = (out.myLeast ?? []).map((id) => byId.get(id)).filter(Boolean);
			}
			if (out.myName) { name = out.myName; started = true; }
			loadError = '';
		} catch (e) {
			loadError = e?.message || 'That code is not open';
		} finally {
			loading = false;
		}
	}

	async function submit() {
		if (sending) return;
		sending = true;
		sendError = '';
		try {
			const res = await fetch(`/api/rank/${code}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					guestId, name,
					...(isFavorites
						? { ranking: favItems.map((o) => o.id), rankingLeast: leastItems.map((o) => o.id) }
						: { ranking: items.map((o) => o.id) })
				})
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.message || 'That did not send');
			sent = true;
			rememberAnswered();
			await load({ keepPicks: true });
		} catch (e) {
			sendError = e?.message || 'That did not send';
		} finally {
			sending = false;
		}
	}

	async function addOwn(label) {
		const res = await fetch(`/api/rank/${code}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ guestId, name, label })
		});
		const out = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(out?.message || 'That did not go in');
		await load({ keepPicks: true });
	}

	let refresh;
	let unsubLive;
	let lastRev = 0;
	onMount(() => {
		guestId = deviceId();
		remembered = readMemory();
		load();

		// `pollRoom/{code}` is world-readable precisely so a phone with no
		// account can watch it. It carries a revision, not the tally: when
		// anything changes — someone's ballot, a write-in, a removal, the poll
		// closing — the revision moves and we refetch, which keeps the
		// results-gating server-side instead of publishing scores to the room.
		try {
			unsubLive = onValue(ref(rtdb, `pollRoom/${code}`), (snap) => {
				const v = snap.val();
				if (!v) return;
				const rev = Number(v.rev ?? 0);
				if (rev && rev !== lastRev) {
					lastRev = rev;
					// keepPicks: someone else's ballot landing must never disturb
					// the picks this person is still making.
					load({ keepPicks: true });
				}
			});
		} catch { /* no RTDB — the floor below still catches up */ }

		// A floor, not the mechanism: covers RTDB being unreachable.
		refresh = setInterval(() => {
			if (document.visibilityState === 'visible' && poll?.status === 'open') load({ keepPicks: true });
		}, 45000);
		return () => { clearInterval(refresh); unsubLive?.(); };
	});
</script>

<svelte:head>
	<title>{poll?.title ?? 'Rank it'}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
	{#if loading}
		<p class="muted">Loading…</p>
	{:else if loadError}
		<div class="gone">
			<span class="msi">link_off</span>
			<p>{loadError}</p>
			<p class="small">Check the code on the screen — <strong>{code}</strong></p>
		</div>
	{:else}
		<header>
			<h1>{poll.title}</h1>
			{#if poll.prompt}<p class="prompt">{poll.prompt}</p>{/if}
		</header>

		{#if remembered && !sent}
			<p class="already">
				<span class="msi">check_circle</span>
				<span>
					<!-- Branch the whole sentence rather than splicing an inline {#if}:
					     Svelte trims the block's leading space, which ran "this" into "as". -->
					{#if remembered.name}
						You already sent an answer to this as <strong>{remembered.name}</strong>.
					{:else}
						You already sent an answer to this.
					{/if}
					{#if poll.status === 'open'}You can change it below.{/if}
				</span>
			</p>
		{/if}

		{#if poll.status !== 'open'}
			<p class="muted">This poll has closed. Thanks for taking part.</p>
		{:else if !started}
			<!-- Step one, and the only thing we ask for. -->
			<form class="name-step" onsubmit={(e) => { e.preventDefault(); if (name.trim()) started = true; }}>
				<label for="who">What's your name?</label>
				<input id="who" bind:value={name} placeholder="Your name" maxlength="60" autocomplete="name" />
				<button class="primary" type="submit" disabled={!name.trim()}>Start ranking</button>
				<p class="small">No account needed.</p>
			</form>
		{:else}
			{#if isFavorites}
				<FavoritesPicker
					{items}
					bind:favItems
					bind:leastItems
					minFav={poll.minFavorites}
					minLeast={poll.minLeast}
					canAdd={poll.allowWriteIns}
					onadd={addOwn}
					onchange={() => (sent = false)}
				/>
			{:else}
				<p class="hint">
					Drag by the handle, or use the arrows. Top is your first choice.
				</p>
				<RankList bind:items onchange={() => (sent = false)} />
			{/if}
			<div class="submit-row">
				<button class="primary" onclick={submit} disabled={sending || !meetsMinimums || (!dirty && submitted)}>
					{sending ? 'Sending…' : submitted ? (dirty ? 'Update my answer' : 'Answer sent') : 'Send my answer'}
				</button>
				{#if sent && !dirty}<span class="ok">Thanks, {name.split(' ')[0]}!</span>{/if}
				{#if !meetsMinimums}
					<span class="need">
						Pick at least {poll.minFavorites} favorites and {poll.minLeast} least favorites.
					</span>
				{/if}
			</div>
			{#if sendError}<p class="error">{sendError}</p>{/if}
			{#if submitted}
				<p class="small">
					You're counted as <strong>{name}</strong> — {responseCount}
					{responseCount === 1 ? 'person has' : 'people have'} ranked this.
					You can change your order until the poll closes.
				</p>
			{/if}

			{#if results?.length}
				<section class="results">
					<h2>How the room is ranking it</h2>
					<ol>
						{#each results as r, i (r.id)}
							<li class:top={i === 0}>
								<!-- Explicit, not the <ol> marker: `display:flex` on the row
								     drops `display:list-item`, which takes the number with it. -->
								<span class="r-place">{i + 1}</span>
								<span class="r-label">{r.label}</span>
								<span class="r-stat">
									{#if isFavorites}
										{r.favCount ? `${r.favCount}♥` : ''}{r.favCount && r.leastCount ? ' ' : ''}{r.leastCount ? `${r.leastCount}✕` : ''}
										{#if !r.mentions}—{/if}
									{:else}
										avg {r.averageRank.toFixed(2)}
									{/if}
								</span>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.wrap {
		min-height: 100dvh;
		box-sizing: border-box;
		padding: 2rem 1.25rem calc(2rem + env(safe-area-inset-bottom));
		max-width: 520px;
		margin: 0 auto;
		background: var(--paper);
		color: var(--ink);
	}
	header { margin-bottom: 1.25rem; }
	h1 { font-family: 'Avara', serif; font-size: 1.6rem; font-weight: 400; margin: 0 0 0.4rem; line-height: 1.2; }
	h2 { font-family: 'Avara', serif; font-size: 1.05rem; font-weight: 400; margin: 0 0 0.6rem; }
	.prompt { font-size: 0.92rem; color: var(--muted-fg); margin: 0; line-height: 1.5; }
	.hint { font-size: 0.82rem; color: var(--muted-fg); margin: 0 0 0.9rem; line-height: 1.5; }

	.name-step { display: flex; flex-direction: column; gap: 0.75rem; }
	.name-step label { font-size: 0.9rem; color: var(--ink); }
	.name-step input {
		font-family: inherit; font-size: 1.05rem; color: var(--ink);
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 12px;
		padding: 0.8rem 0.9rem; box-sizing: border-box; width: 100%;
	}
	.name-step input:focus { outline: none; border-color: var(--accent); }

	button.primary {
		font-family: inherit; font-size: 1rem; padding: 0.85rem 1.2rem;
		border-radius: 12px; cursor: pointer; width: 100%;
		background: var(--accent); border: 1.5px solid var(--accent); color: var(--paper);
	}
	button.primary:disabled { opacity: 0.5; cursor: default; }
	.submit-row { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; margin-top: 1.1rem; }
	.ok { font-size: 0.9rem; color: var(--accent); }
	.need { font-size: 0.8rem; color: var(--muted-fg); text-align: center; line-height: 1.45; }

	.results { margin-top: 2rem; border-top: 1.5px solid var(--border); padding-top: 1.1rem; }
	.results ol { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 0.4rem; }
	.results li { font-size: 0.9rem; display: flex; gap: 0.6rem; align-items: baseline; }
	.r-place {
		flex: none; min-width: 1.1rem; font-family: 'Avara', serif;
		color: var(--muted-fg); font-variant-numeric: tabular-nums;
	}
	.results li.top .r-place, .results li.top .r-label { color: var(--accent); }
	.r-label { flex: 1; }
	.r-stat { color: var(--muted-fg); font-size: 0.78rem; white-space: nowrap; }

	.already {
		display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
		font-size: 0.82rem; color: var(--accent); line-height: 1.5;
		border: 1.5px solid var(--accent); border-radius: 12px;
		padding: 0.6rem 0.75rem; margin: 0 0 1.1rem;
	}
	.already .msi { font-size: 1.05rem; }
	.gone { text-align: center; padding: 4rem 1rem; color: var(--muted-fg); }
	.gone .msi { font-size: 2.5rem; opacity: 0.5; }
	.muted { font-size: 0.9rem; color: var(--muted-fg); }
	.small { font-size: 0.78rem; color: var(--muted-fg); line-height: 1.5; text-align: center; margin: 0.4rem 0 0; }
	.error { font-size: 0.85rem; color: var(--md-sys-color-error, #b3261e); text-align: center; }
</style>
