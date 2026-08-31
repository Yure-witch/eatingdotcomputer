<script>
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import RankList from '$lib/components/RankList.svelte';
	import FavoritesPicker from '$lib/components/FavoritesPicker.svelte';
	import { qrSvg } from '$lib/qr.js';
	import { db as rtdb } from '$lib/firebase.js';
	import { ref, onValue } from 'firebase/database';

	// Lab → Rank It: one poll. Either drag the whole pool into order, or pick
	// and rank your favorites and least favorites out of it — and put a QR on
	// the projector so people without accounts can take part too.

	let { data } = $props();
	const pollId = $derived($page.params.id);

	let poll = $state(null);
	let order = $state([]);        // 'full' format: the viewer's working ranking
	let favItems = $state([]);     // 'favorites' format: the two ends
	let leastItems = $state([]);
	let myRanking = $state(null);  // what's on file, so "changed" is distinguishable from "not sent"
	let myLeast = $state(null);
	let results = $state(null);
	let firstResults = $state(null);   // what the room said before it saw the tally
	let changedCount = $state(0);
	let showFirst = $state(false);
	let responseCount = $state(0);
	let respondents = $state(null);
	let canEdit = $state(false);

	let loading = $state(true);
	let loadError = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let justSaved = $state(false);
	let ranker = $state(null);     // RankList instance, so refreshes can tell if a drag is in flight
	let liveCount = $state(null);  // straight off RTDB
	let showBallots = $state(false);

	const isOpen = $derived(poll?.status === 'open');
	const isFavorites = $derived(poll?.format === 'favorites');
	const submitted = $derived(myRanking != null);
	const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

	// Has the working state drifted from what's on file?
	const dirty = $derived.by(() => {
		if (!submitted) return true;
		if (isFavorites) {
			return !sameIds(favItems.map((o) => o.id), myRanking ?? [])
				|| !sameIds(leastItems.map((o) => o.id), myLeast ?? []);
		}
		return !sameIds(order.map((o) => o.id), myRanking ?? []);
	});

	// Enough of each end picked to be allowed to send it.
	const meetsMinimums = $derived(
		!isFavorites
		|| (favItems.length >= (poll?.minFavorites ?? 0) && leastItems.length >= (poll?.minLeast ?? 0))
	);

	// The count in the header: RTDB while it's talking, the API's number otherwise.
	const shownCount = $derived(liveCount ?? responseCount);

	// The public join link, built from the code the server minted.
	const joinUrl = $derived(
		poll?.shareCode && typeof location !== 'undefined' ? `${location.origin}/r/${poll.shareCode}` : ''
	);
	// White-on-transparent reads badly off a projector, so keep the quiet zone opaque.
	const qrMarkup = $derived(joinUrl ? qrSvg(joinUrl, { dark: '#111111', light: '#ffffff' }) : '');

	async function load({ keepOrder = false } = {}) {
		try {
			const res = await fetch(`/api/lab/polls/${pollId}`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Could not load');
			const out = await res.json();
			poll = out.poll;
			myRanking = out.myRanking;
			myLeast = out.myLeast;
			results = out.results;
			firstResults = out.firstResults;
			changedCount = out.changedCount ?? 0;
			responseCount = out.responseCount ?? 0;
			respondents = out.respondents;
			canEdit = !!out.canEdit;
			// What `keepOrder` protects differs by format, because the two
			// formats keep the viewer's work in different places.
			//
			// 'favorites': the working answer is favItems/leastItems, and `order`
			// is just the POOL. The pool must always refresh, or a write-in
			// someone else adds never appears for anyone who hasn't submitted
			// yet — which is most of the room, most of the time.
			//
			// 'full': the working answer IS `order`, so a refresh mid-drag would
			// throw away an arrangement they haven't sent.
			if (out.poll?.format === 'favorites') {
				order = out.items ?? [];
				if (!keepOrder) {
					const byId = new Map((out.items ?? []).map((i) => [i.id, i]));
					favItems = (out.myRanking ?? []).map((id) => byId.get(id)).filter(Boolean);
					leastItems = (out.myLeast ?? []).map((id) => byId.get(id)).filter(Boolean);
				}
			} else if (!keepOrder) {
				order = out.items ?? [];
			}
			loadError = '';
		} catch (e) {
			loadError = e?.message || 'Could not load';
		} finally {
			loading = false;
		}
	}

	async function submit() {
		if (submitting) return;
		submitting = true;
		submitError = '';
		try {
			const res = await fetch(`/api/lab/polls/${pollId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					isFavorites
						? { ranking: favItems.map((o) => o.id), rankingLeast: leastItems.map((o) => o.id) }
						: { ranking: order.map((o) => o.id) }
				)
			});
			const out = await res.json().catch(() => ({}));
			if (res.status === 409) { await load(); throw new Error(out?.message || 'This poll changed — have another look'); }
			if (!res.ok) throw new Error(out?.message || 'That did not send');
			justSaved = true;
			await load({ keepOrder: true });
		} catch (e) {
			submitError = e?.message || 'That did not send';
		} finally {
			submitting = false;
		}
	}

	// ——— Instructor controls ——————————————————————————————————————

	async function patch(body) {
		await fetch(`/api/lab/polls/${pollId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		await load({ keepOrder: true });
	}

	let confirmingReset = $state(false);
	let confirmingDelete = $state(false);
	let showShare = $state(false);
	let copied = $state(false);

	async function reset() {
		confirmingReset = false;
		await patch({ action: 'reset' });
		await load();
	}

	async function destroy() {
		await fetch(`/api/lab/polls/${pollId}`, { method: 'DELETE' });
		location.href = '/app/lab/polls';
	}

	async function addOwn(label) {
		const res = await fetch(`/api/lab/polls/${pollId}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ label })
		});
		const out = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(out?.message || 'That did not go in');
		await load({ keepOrder: true });
	}

	async function removeItem(item) {
		await patch({ action: 'removeItem', itemId: item.id });
	}

	async function share() {
		if (!poll.shareCode) await patch({ action: 'share' });
		showShare = true;
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(joinUrl);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch { /* clipboard blocked — the link is on screen to read anyway */ }
	}

	// Projector view: big type, no chrome, for showing the room its own answer.
	let presenting = $state(false);
	function onKey(e) { if (e.key === 'Escape') presenting = false; }

	let timer;
	let unsubLive;
	let lastBeacon = 0;
	onMount(() => {
		load();

		// RTDB is the live wire: the server bumps `pollLive/{id}` on every
		// ballot, so the count moves the moment someone submits and the tally
		// refetches then, rather than on the next tick of a timer.
		try {
			unsubLive = onValue(ref(rtdb, `pollLive/${pollId}`), (snap) => {
				const v = snap.val();
				if (!v) return;
				liveCount = Number(v.n ?? 0);
				// `rev` moves on ANY change — a ballot, a write-in, a removal,
				// the poll opening or closing — not just the ones that shift
				// the count.
				const rev = Number(v.rev ?? v.at ?? 0);
				if (rev && rev !== lastBeacon) {
					lastBeacon = rev;
					if (!ranker?.dragging()) load({ keepOrder: dirty });
				}
			});
		} catch { /* no RTDB — the fallback below still keeps it moving */ }

		// A floor, not the mechanism: RTDB now announces every change, so this
		// only covers RTDB being unreachable.
		timer = setInterval(() => {
			if (!ranker?.dragging() && document.visibilityState === 'visible') load({ keepOrder: dirty });
		}, 45000);
		window.addEventListener('keydown', onKey);
	});
	onDestroy(() => {
		clearInterval(timer);
		unsubLive?.();
		if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
	});

	// A bar is only readable if it spans the range — best item full, worst item
	// a stub — so scale across the actual spread rather than from zero.
	function barWidth(r) {
		if (r.averageRank == null || !shownResults?.length) return 0;
		const ranks = shownResults.map((x) => x.averageRank).filter((x) => x != null);
		const best = Math.min(...ranks), worst = Math.max(...ranks);
		if (worst === best) return 100;
		return 12 + 88 * (1 - (r.averageRank - best) / (worst - best));
	}
	// Favorites format: one bar per side of a centre line, so "loved" and
	// "loathed" read as opposite directions instead of two numbers to compare.
	const half = (r) => Math.min(100, Math.abs(r.score) * 100);
	const ordinal = (n) => {
		const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};
</script>

<svelte:head><title>{poll?.title ?? 'Rank It'} — eating.computer</title></svelte:head>

<div class="shell" class:presenting>
	<main>
		{#if loading}
			<p class="muted">Loading…</p>
		{:else if loadError}
			<p class="error">{loadError}</p>
		{:else}
			{#if !presenting}
				<div class="page-header">
					<a class="back" href="/app/lab/polls"><span class="msi">arrow_back</span> Rank It</a>
					<h1>{poll.title}</h1>
					{#if poll.prompt}<p class="subtitle">{poll.prompt}</p>{/if}
					<p class="meta">
						<span class="badge" class:open={isOpen}>{isOpen ? 'Open' : 'Closed'}</span>
						<span class="badge">{isFavorites ? 'favorites + least' : 'full ranking'}</span>
						<span class="live" class:pulse={liveCount != null}>
							{shownCount} {shownCount === 1 ? 'response' : 'responses'}
						</span>
					</p>
				</div>
			{/if}

			{#if canEdit && !presenting}
				<div class="controls">
					{#if isOpen}
						<button class="accent" onclick={share}>
							<span class="msi">qr_code_2</span> {poll.shareCode ? 'Show QR' : 'Open to the room'}
						</button>
						<button onclick={() => patch({ action: 'close' })}>Close poll</button>
					{:else}
						<button onclick={() => patch({ action: 'open' })}>Reopen</button>
					{/if}
					<button onclick={() => patch({ reveal: poll.reveal === 'always' ? 'closed' : 'always' })}>
						{poll.reveal === 'always' ? 'Hide live results' : 'Show live results'}
					</button>
					{#if isFavorites}
						<button onclick={() => patch({ action: 'writeIns', on: !poll.allowWriteIns })}>
							{poll.allowWriteIns ? 'Stop write-ins' : 'Allow write-ins'}
						</button>
					{/if}
					{#if results?.length}
						<button onclick={() => (presenting = true)}>Present</button>
					{/if}
					<button class="danger" onclick={() => (confirmingReset = true)}>Clear responses</button>
					<button class="danger" onclick={() => (confirmingDelete = true)}>Delete</button>
				</div>

				{#if showShare && poll.shareCode}
					<div class="share">
						<div class="qr">{@html qrMarkup}</div>
						<div class="share-text">
							<p class="share-label">Scan to rank — no account needed</p>
							<p class="code">{poll.shareCode}</p>
							<p class="url">{joinUrl}</p>
							<div class="share-actions">
								<button onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
								<button onclick={() => (presenting = true)}>Full screen</button>
								<button onclick={() => (showShare = false)}>Hide</button>
								<button class="danger" onclick={() => { patch({ action: 'unshare' }); showShare = false; }}>
									Stop sharing
								</button>
							</div>
						</div>
					</div>
				{/if}

				{#if confirmingReset}
					<p class="confirm">
						Clear all {responseCount} {responseCount === 1 ? 'response' : 'responses'}? This can't be undone.
						<button class="danger" onclick={reset}>Clear them</button>
						<button onclick={() => (confirmingReset = false)}>Keep them</button>
					</p>
				{/if}
				{#if confirmingDelete}
					<p class="confirm">
						Delete this poll and its responses?
						<button class="danger" onclick={destroy}>Delete it</button>
						<button onclick={() => (confirmingDelete = false)}>Cancel</button>
					</p>
				{/if}
			{/if}

			{#if isOpen && !presenting}
				<section class="ballot">
					<h2>{isFavorites ? 'Your picks' : 'Your ranking'}</h2>
					{#if submitted}
						<p class="hint"><span class="on-file">Your answer is in — change it any time while the poll is open.</span></p>
					{/if}

					{#if isFavorites}
						<FavoritesPicker
							items={order}
							bind:favItems
							bind:leastItems
							minFav={poll.minFavorites}
							minLeast={poll.minLeast}
							canAdd={poll.allowWriteIns}
							onadd={addOwn}
							onremoveItem={canEdit ? removeItem : null}
							onchange={() => (justSaved = false)}
						/>
					{:else}
						<p class="hint">Drag by the handle, or use the arrows. Top is first.</p>
						<RankList bind:this={ranker} bind:items={order} onchange={() => (justSaved = false)} />
					{/if}

					<div class="submit-row">
						<button class="primary" onclick={submit} disabled={submitting || !meetsMinimums || (!dirty && submitted)}>
							{submitting ? 'Sending…' : submitted ? (dirty ? 'Update my answer' : 'Answer submitted') : 'Submit my answer'}
						</button>
						{#if justSaved && !dirty}<span class="saved">Saved</span>{/if}
						{#if !meetsMinimums}
							<span class="need">Pick at least {poll.minFavorites} favorites and {poll.minLeast} least favorites.</span>
						{/if}
					</div>
					{#if submitError}<p class="error">{submitError}</p>{/if}
				</section>
			{/if}

			{#if results}
				<section class="results">
					<div class="results-head">
						<h2>{presenting ? poll.title : showFirst ? 'First answers' : 'The class ranking'}</h2>
						{#if !presenting && changedCount > 0}
							<!-- Only worth offering once somebody has actually revised:
							     with no changes the two tallies are identical. -->
							<span class="firsts">
								<button class:on={!showFirst} onclick={() => (showFirst = false)}>Now</button>
								<button class:on={showFirst} onclick={() => (showFirst = true)}>First</button>
							</span>
						{/if}
						{#if presenting}
							<span class="present-count">{shownCount}</span>
							<button class="ghost" onclick={() => (presenting = false)}>Exit</button>
						{/if}
					</div>
					{#if !responseCount}
						<p class="muted">No responses yet{poll.shareCode ? ' — the QR is live.' : '.'}</p>
					{:else if isFavorites}
						<ol class="result-list">
							{#each shownResults as r, i (r.id)}
								<li class="result diverging" class:top={i === 0}>
									<span class="place">{ordinal(i + 1)}</span>
									<span class="d-label">{r.label}</span>
									<span class="d-bars">
										<span class="d-side left">
											{#if r.score < 0}<span class="d-bar least" style:width="{half(r)}%"></span>{/if}
										</span>
										<span class="d-axis"></span>
										<span class="d-side right">
											{#if r.score > 0}<span class="d-bar fav" style:width="{half(r)}%"></span>{/if}
										</span>
									</span>
									<span class="d-stat">
										{#if r.favCount}<span class="up">{r.favCount}♥</span>{/if}
										{#if r.leastCount}<span class="down">{r.leastCount}✕</span>{/if}
										{#if !r.mentions}<span class="none">no picks</span>{/if}
									</span>
								</li>
							{/each}
						</ol>
						<p class="footnote">
							Most loved at the top. Each ballot is weighted to itself, so ranking ten things
							doesn't outvote ranking three — across {responseCount}
							{responseCount === 1 ? 'ballot' : 'ballots'}.
							{#if showFirst}
								These are everyone's first answers, before they could see the tally.
							{:else if changedCount}
								{changedCount} {changedCount === 1 ? 'person has' : 'people have'} changed since
								first answering — “First” shows what they said before seeing this.
							{/if}
						</p>
					{:else}
						<ol class="result-list">
							{#each shownResults as r, i (r.id)}
								<li class="result">
									<span class="place">{ordinal(i + 1)}</span>
									<div class="bar-wrap">
										<div class="bar-label">
											<span class="r-label">{r.label}</span>
											<span class="r-stat">
												{r.averageRank != null ? `avg ${r.averageRank.toFixed(2)}` : 'no votes'}
												{#if r.firstPlace}· {r.firstPlace} first{/if}
											</span>
										</div>
										<div class="bar-track"><div class="bar" style:width="{barWidth(r)}%"></div></div>
									</div>
								</li>
							{/each}
						</ol>
						<p class="footnote">
							Ranked by average position across {responseCount}
							{responseCount === 1 ? 'ballot' : 'ballots'} — lower is better.
						</p>
					{/if}
				</section>
			{:else if !isOpen}
				<p class="muted">This poll is closed.</p>
			{:else if submitted}
				<p class="muted">Your answer is in. Results appear when the poll closes.</p>
			{/if}

			<!-- On the projector the QR stays up beside the tally, so someone who
			     walks in late can still join without the instructor changing view. -->
			{#if presenting && poll.shareCode}
				<div class="present-qr">
					<div class="qr">{@html qrMarkup}</div>
					<p class="code">{poll.shareCode}</p>
				</div>
			{/if}

			<!-- Who ranked what. The aggregate hides exactly the thing that's
			     often most useful in a crit — that two people put the same piece
			     at opposite ends. -->
			{#if canEdit && respondents?.length && !presenting}
				<section class="who">
					<button class="who-toggle" onclick={() => (showBallots = !showBallots)}>
						<span class="msi">{showBallots ? 'expand_less' : 'expand_more'}</span>
						{respondents.length} {respondents.length === 1 ? 'person has' : 'people have'} answered
					</button>
					{#if showBallots}
						<ul class="ballots">
							{#each respondents as r}
								<li>
									<p class="who-name">
										<span class:guest={r.guest}>{r.name}</span>
										{#if r.guest}<span class="tag">QR</span>{/if}
										{#if r.changed}<span class="tag changed">changed</span>{/if}
									</p>
									{#if isFavorites}
										<p class="who-line">
											<span class="who-key up">Favorites</span>
											{#each r.ranked as label, n}<span class="pick-n">{n + 1}.</span> {label}{#if n < r.ranked.length - 1}<span class="sep">·</span>{/if}{/each}
											{#if !r.ranked.length}—{/if}
										</p>
										<p class="who-line">
											<span class="who-key down">Least</span>
											{#each r.least ?? [] as label, n}<span class="pick-n">{n + 1}.</span> {label}{#if n < (r.least?.length ?? 0) - 1}<span class="sep">·</span>{/if}{/each}
											{#if !r.least?.length}—{/if}
										</p>
									{:else}
										<p class="who-line">
											{#each r.ranked as label, n}<span class="pick-n">{n + 1}.</span> {label}{#if n < r.ranked.length - 1}<span class="sep">·</span>{/if}{/each}
										</p>
									{/if}
									{#if r.changed}
										<p class="who-line first-line">
											<span class="who-key was">First</span>
											{#each r.firstRanked ?? [] as label, n}<span class="pick-n">{n + 1}.</span> {label}{#if n < (r.firstRanked?.length ?? 0) - 1}<span class="sep">·</span>{/if}{/each}
											{#if isFavorites && r.firstLeast?.length}
												<span class="who-key was least-key">/ least</span>
												{#each r.firstLeast as label, n}<span class="pick-n">{n + 1}.</span> {label}{#if n < r.firstLeast.length - 1}<span class="sep">·</span>{/if}{/each}
											{/if}
										</p>
									{/if}
								</li>
							{/each}
						</ul>
						<p class="who-note">
							Numbered best-first in each list — 1 is their strongest feeling.
							{#if respondents.some((r) => r.guest)}QR answers aren't attached to an account yet.{/if}
						</p>
					{/if}
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.shell { min-height: 100dvh; display: flex; flex-direction: column; background: var(--paper); }
	main {
		flex: 1;
		padding: 2rem 1.5rem;
		padding-top: calc(2rem + var(--header-h, 64px));
		max-width: 720px; width: 100%; margin: 0 auto; box-sizing: border-box;
	}
	/* Present mode drops this page's OWN chrome, but the app header is fixed and
	   still there — so it must keep the same offset, or the title and the QR sit
	   underneath it. */
	.presenting main { max-width: 1100px; position: relative; }

	.page-header { margin-bottom: 1.25rem; }
	.back {
		display: inline-flex; align-items: center; gap: 0.3rem;
		font-size: 0.8rem; color: var(--muted-fg); text-decoration: none; margin-bottom: 0.6rem;
	}
	.back:hover { color: var(--accent); }
	.back .msi { font-size: 1rem; }
	h1 { font-family: 'Avara', serif; font-size: 1.9rem; font-weight: 400; margin: 0 0 0.35rem; color: var(--ink); }
	h2 { font-family: 'Avara', serif; font-size: 1.05rem; font-weight: 400; margin: 0 0 0.3rem; color: var(--ink); }
	.subtitle { font-size: 0.88rem; color: var(--muted-fg); margin: 0 0 0.5rem; line-height: 1.5; }
	.meta { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; font-size: 0.78rem; color: var(--muted-fg); margin: 0; }
	.badge {
		font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
		padding: 0.15rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-fg);
	}
	.badge.open { border-color: var(--accent); color: var(--accent); }
	.live { font-variant-numeric: tabular-nums; }
	.live.pulse { color: var(--accent); }

	.controls { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.25rem; }
	.controls button, .confirm button, .share-actions button {
		display: inline-flex; align-items: center; gap: 0.3rem;
		font-family: inherit; font-size: 0.78rem; padding: 0.35rem 0.7rem;
		border: 1.5px solid var(--border); border-radius: 999px;
		background: transparent; color: var(--muted-fg); cursor: pointer;
	}
	.controls button:hover, .confirm button:hover, .share-actions button:hover {
		border-color: var(--accent); color: var(--accent);
	}
	.controls .accent { border-color: var(--accent); color: var(--accent); }
	.controls .accent .msi { font-size: 1rem; }
	.controls .danger:hover, .confirm .danger:hover, .share-actions .danger:hover {
		border-color: var(--md-sys-color-error, #b3261e); color: var(--md-sys-color-error, #b3261e);
	}
	.confirm {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
		font-size: 0.8rem; color: var(--muted-fg); margin: 0 0 1rem;
	}

	.share {
		display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap;
		border: 1.5px solid var(--border); border-radius: 16px;
		padding: 1.15rem; margin-bottom: 1.5rem;
	}
	.share .qr { width: 132px; height: 132px; flex: none; }
	.share .qr :global(svg) { width: 100%; height: 100%; display: block; border-radius: 8px; }
	.share-text { flex: 1; min-width: 190px; }
	.share-label { font-size: 0.82rem; color: var(--ink); margin: 0 0 0.35rem; }
	.code {
		font-family: 'Avara', serif; font-size: 1.7rem; letter-spacing: 0.12em;
		margin: 0 0 0.2rem; color: var(--accent);
	}
	.url { font-size: 0.72rem; color: var(--muted-fg); margin: 0 0 0.7rem; word-break: break-all; }
	.share-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }

	.present-qr { position: absolute; top: calc(var(--header-h, 64px) + 0.5rem); right: 0; text-align: center; }
	.present-qr .qr { width: 120px; height: 120px; }
	.present-qr .qr :global(svg) { width: 100%; height: 100%; display: block; border-radius: 8px; }
	.present-qr .code { font-size: 1rem; letter-spacing: 0.1em; margin: 0.35rem 0 0; }
	.present-count {
		font-family: 'Avara', serif; font-size: 1.6rem; color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.ballot { margin-bottom: 2rem; }
	.hint { font-size: 0.78rem; color: var(--muted-fg); margin: 0 0 0.85rem; line-height: 1.5; }
	.on-file { color: var(--accent); }

	.submit-row { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; margin-top: 1.25rem; }
	button.primary {
		font-family: inherit; font-size: 0.85rem; padding: 0.55rem 1.1rem;
		border-radius: 10px; cursor: pointer;
		background: var(--accent); border: 1.5px solid var(--accent); color: var(--paper);
	}
	button.primary:disabled { opacity: 0.5; cursor: default; }
	button.ghost {
		font-family: inherit; font-size: 0.8rem; padding: 0.35rem 0.8rem;
		border: 1.5px solid var(--border); border-radius: 999px;
		background: transparent; color: var(--muted-fg); cursor: pointer;
	}
	.saved { font-size: 0.78rem; color: var(--accent); }
	.need { font-size: 0.75rem; color: var(--muted-fg); }

	.results-head { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.75rem; }
	.results-head h2 { margin: 0; flex: 1; }
	.presenting .results-head h2 { font-size: 2.4rem; }
	.presenting .results { padding-right: 150px; }
	.result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
	.result { display: flex; align-items: center; gap: 0.75rem; }
	.place {
		flex: none; width: 2.4rem; text-align: right;
		font-family: 'Avara', serif; font-size: 0.85rem; color: var(--muted-fg);
	}
	.presenting .place { width: 3.4rem; font-size: 1.3rem; }
	.bar-wrap { flex: 1; min-width: 0; }
	.bar-label { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.22rem; }
	.r-label { font-size: 0.9rem; color: var(--ink); flex: 1; min-width: 0; }
	.presenting .r-label { font-size: 1.6rem; }
	.r-stat { font-size: 0.72rem; color: var(--muted-fg); white-space: nowrap; }
	.presenting .r-stat { font-size: 1rem; }
	.bar-track { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 8%, transparent); overflow: hidden; }
	.presenting .bar-track { height: 16px; }
	.bar {
		height: 100%; border-radius: 999px; background: var(--accent);
		transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* Favorites format: loved to the right of the axis, loathed to the left. */
	.result.diverging { display: grid; grid-template-columns: auto 1fr 2fr auto; gap: 0.6rem; align-items: center; }
	/* First place is the answer everyone came for — let it read as the answer. */
	.result.diverging.top .d-label { color: var(--accent); }
	.result.diverging.top .place { color: var(--accent); }
	.d-label { font-size: 0.88rem; color: var(--ink); min-width: 0; }
	.presenting .d-label { font-size: 1.4rem; }
	.d-bars { display: flex; align-items: center; height: 12px; }
	.d-side { flex: 1; display: flex; height: 100%; }
	.d-side.left { justify-content: flex-end; }
	.d-axis { width: 1.5px; height: 100%; background: color-mix(in srgb, var(--ink) 22%, transparent); flex: none; }
	.d-bar { height: 100%; transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1); }
	.d-bar.fav { background: var(--accent); border-radius: 0 999px 999px 0; }
	/* NOT the theme's error colour: in a dark theme that's a light pink meant
	   for TEXT, and as a filled bar it sits right next to the equally light
	   accent — two pale bars that read as the same thing pointing opposite
	   ways. A dimmed ink fill is unambiguously the accent's counterpart in
	   both themes. */
	.d-bar.least { background: color-mix(in srgb, var(--ink) 42%, transparent); border-radius: 999px 0 0 999px; }
	.d-stat { font-size: 0.72rem; color: var(--muted-fg); white-space: nowrap; display: flex; gap: 0.4rem; }
	.presenting .d-stat { font-size: 0.95rem; }
	.d-stat .up { color: var(--accent); }
	.d-stat .down { color: var(--md-sys-color-error, #b3261e); }
	.d-stat .none { opacity: 0.6; }

	.footnote { font-size: 0.72rem; color: var(--muted-fg); opacity: 0.8; margin: 0.9rem 0 0; line-height: 1.5; }
	.presenting .footnote { font-size: 0.9rem; }

	.who { margin-top: 2rem; border-top: 1.5px solid var(--border); padding-top: 1rem; }
	.who-toggle {
		display: inline-flex; align-items: center; gap: 0.3rem;
		font-family: inherit; font-size: 0.8rem; color: var(--muted-fg);
		background: transparent; border: none; padding: 0; cursor: pointer;
	}
	.who-toggle:hover { color: var(--accent); }
	.ballots { list-style: none; margin: 0.9rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.85rem; }
	.ballots li { border-left: 2px solid var(--border); padding-left: 0.75rem; }
	.who-name { margin: 0 0 0.2rem; font-size: 0.85rem; color: var(--ink); display: flex; align-items: center; gap: 0.4rem; }
	.who-name .guest { font-style: italic; }
	.tag {
		font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em;
		border: 1px solid var(--border); border-radius: 999px; padding: 0.05rem 0.35rem; color: var(--muted-fg);
	}
	.who-line { margin: 0.1rem 0; font-size: 0.78rem; color: var(--muted-fg); line-height: 1.5; }
	.who-key { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.3rem; }
	.who-key.up { color: var(--accent); }
	.who-key.down { color: var(--md-sys-color-error, #b3261e); }
	.pick-n { color: var(--ink); opacity: 0.5; font-variant-numeric: tabular-nums; }
	.sep { opacity: 0.35; margin: 0 0.15rem; }
	.firsts { display: inline-flex; border: 1.5px solid var(--border); border-radius: 999px; overflow: hidden; }
	.firsts button {
		font-family: inherit; font-size: 0.72rem; padding: 0.2rem 0.6rem;
		border: none; background: transparent; color: var(--muted-fg); cursor: pointer;
	}
	.firsts button.on { background: var(--accent); color: var(--paper); }
	.tag.changed { border-color: var(--accent); color: var(--accent); }
	.first-line { opacity: 0.7; }
	.who-key.was { color: var(--muted-fg); }
	.least-key { margin-left: 0.3rem; }
	.who-note { font-size: 0.72rem; color: var(--muted-fg); opacity: 0.75; margin: 0.8rem 0 0; }
	.muted { font-size: 0.85rem; color: var(--muted-fg); }
	.error { font-size: 0.82rem; color: var(--md-sys-color-error, #b3261e); }
</style>
