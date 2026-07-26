<script>
	// ✨ Inspiration — daily finds based on your interests, gathered by
	// Scout (seminal papers via OpenAlex, artworks from The Met / AIC /
	// Cleveland / V&A, are.na channels, Wikipedia overviews).
	// Save = keep forever (and a strong interest signal — future batches
	// lean toward what you save). Unsaved finds fade after 7 days; the
	// History view keeps the record.
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { pageTitle } from '$lib/page-title-store.js';

	// Two feeds live here. "Mine" is the student's own interest-driven feed
	// (personal reactions shape it). "Class" is a shared feed built from the
	// syllabus — everyone sees the same items, and the AGGREGATE of everyone's
	// reactions drives what floats up. Instructors also get "Students": a
	// window into what each student likes, personally and for the class.
	const isInstructor = $derived($page.data?.currentUser?.role === 'instructor');
	let scope = $state('class'); // class | mine | students

	let loading = $state(true);
	let items = $state([]);
	let interests = $state('');
	let topics = $state('');
	let editingTopics = $state(false);
	let topicsDraft = $state('');
	let topicsSaving = $state(false);
	let scoutOnline = $state(false);
	let pending = $state(false); // a batch is in flight on the worker
	let view = $state('fresh'); // fresh | saved | history (Mine only)
	let historyLoaded = $state(false);
	let insights = $state(null); // instructor Students view
	let pollTimer = null;
	// Poll a bounded number of times while a batch is in flight — a stuck
	// batch (worker down) must NOT poll forever, which would hammer the
	// API from every open tab. 10 × 10s ≈ 100s, then give up quietly.
	let pollsLeft = 0;
	const POLL_EVERY = 10000;
	const MAX_POLLS = 10;

	function schedulePoll() {
		if (pollTimer || pollsLeft <= 0) return;
		pollTimer = setTimeout(() => {
			pollTimer = null;
			// Don't poll a backgrounded tab.
			if (typeof document !== 'undefined' && document.hidden) { pollsLeft = 0; return; }
			pollsLeft -= 1;
			load();
		}, POLL_EVERY);
	}

	async function load() {
		loading = items.length === 0; // keep current items visible on re-poll
		if (scope === 'students') {
			try {
				const r = await fetch('/api/inspiration?insights=1');
				if (r.ok) insights = await r.json();
			} catch { /* empty state */ }
			loading = false;
			return;
		}
		const qs = scope === 'class' ? 'scope=class' : (view === 'history' ? 'history=1' : '');
		try {
			const r = await fetch(`/api/inspiration${qs ? '?' + qs : ''}`);
			if (r.ok) {
				const j = await r.json();
				items = j.items ?? [];
				interests = j.interests ?? '';
				topics = j.topics ?? '';
				scoutOnline = !!j.scoutOnline;
				pending = !!j.pending;
				if (scope === 'mine' && view === 'history') historyLoaded = true;
				if (pending) schedulePoll(); else pollsLeft = 0;
			}
		} catch { /* empty state below */ }
		loading = false;
	}

	function switchScope(s) {
		if (s === scope) return;
		scope = s;
		items = [];
		insights = null;
		historyLoaded = false;
		view = 'fresh';
		clearTimeout(pollTimer); pollTimer = null; pollsLeft = 0;
		load();
	}

	async function fetchMore() {
		pending = true;
		pollsLeft = MAX_POLLS;
		try {
			await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ more: true, scope })
			});
		} catch { /* poll picks up state either way */ }
		schedulePoll();
	}

	onMount(() => {
		pageTitle.set('Inspiration');
		load().then(() => { if (pending) { pollsLeft = MAX_POLLS; schedulePoll(); } });
		return () => clearTimeout(pollTimer);
	});

	function setView(v) {
		view = v;
		// History needs the full list (expired included) — fetch once.
		if (v === 'history' && !historyLoaded) load();
	}

	const visible = $derived.by(() => {
		if (scope === 'class') return items; // class feed: shared, ordered by aggregate
		if (view === 'saved') return items.filter((i) => i.saved);
		if (view === 'history') return items;
		return items.filter((i) => i.saved || !i.expired);
	});

	const KIND_SECTIONS = [
		{ key: 'paper', title: 'Seminal papers', sub: 'the most-cited scholarship on your interests — what everyone in the field has read. Opens through Cooper Library — sign in with your Cooper login.' },
		{ key: 'artwork', title: 'From the museums', sub: 'The Met · Art Institute of Chicago · Cleveland · V&A' },
		{ key: 'channel', title: 'are.na channels', sub: 'curated rabbit holes' },
		{ key: 'article', title: 'Overviews', sub: 'ground-floor context' },
		{ key: 'link', title: 'Elsewhere', sub: '' }
	];
	const grouped = $derived(
		KIND_SECTIONS.map((s) => ({ ...s, items: visible.filter((i) => i.kind === s.key) })).filter((s) => s.items.length)
	);

	// Cooper Union's OpenAthens proxy. ALL papers route through it — the
	// student signs in with their Cooper login and lands on the live
	// article via the school's subscriptions (free if open access,
	// unlocked if not). Sending papers straight to publisher/repository
	// URLs led to dead files and paywalls; the DOI + Cooper login always
	// resolves. Non-paper finds (art, are.na, wiki) link direct.
	const COOPER_PROXY = 'https://go.openathens.net/redirector/cooper.edu?url=';
	// Repair any HTML-mangled ampersands from bad legacy records before proxying.
	const cleanUrl = (u) => String(u ?? '').replace(/&amp;/g, '&');
	// A DOI-backed paper (journal article) → route through Cooper OpenAthens.
	// A no-DOI paper is a book find-a-copy search → link direct.
	const isDoiPaper = (item) => item.kind === 'paper' && /doi\.org\//i.test(cleanUrl(item.url));
	const linkFor = (item) => {
		if (item.kind !== 'paper') return item.url;
		const u = cleanUrl(item.url);
		return isDoiPaper(item) ? COOPER_PROXY + encodeURIComponent(u) : u;
	};

	async function toggleSave(item) {
		item.saved = !item.saved;
		if (scope === 'class') item.aggSaves = (item.aggSaves ?? 0) + (item.saved ? 1 : -1);
		try {
			const r = await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, saved: item.saved, scope })
			});
			if (!r.ok) item.saved = !item.saved;
		} catch { item.saved = !item.saved; }
	}

	// Edit the search topics. Saving immediately enqueues a fresh batch so
	// the change is felt right away; '' resets back to profile interests.
	async function saveTopics() {
		topicsSaving = true;
		try {
			const r = await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ topics: topicsDraft })
			});
			if (r.ok) {
				topics = topicsDraft.trim() || interests;
				editingTopics = false;
				pending = true;
				pollsLeft = MAX_POLLS;
				schedulePoll();
			}
		} catch { /* stays open, user can retry */ }
		topicsSaving = false;
	}

	// Download the whole "algorithm" — topics, every signal, and the
	// derived taste model — as a JSON file.
	function exportAlgorithm() {
		const a = document.createElement('a');
		a.href = '/api/inspiration?export=1';
		a.download = 'inspiration-algorithm.json';
		document.body.appendChild(a);
		a.click();
		a.remove();
	}

	// Like/dislike — teaches the algorithm (likes steer the next batch's
	// query; dislikes shrink that kind's quota + block recurring words).
	// Disliking removes the item from the feed on the spot.
	async function rate(item, rating) {
		const prev = item.rating;
		item.rating = item.rating === rating ? 0 : rating;
		// Keep the aggregate score in sync locally (class feed shows it live).
		if (scope === 'class') item.aggScore = (item.aggScore ?? 0) + (item.rating - prev);
		// Personal feed: a dislike drops the item from view immediately. Class
		// feed items are shared, so they stay (just re-scored).
		if (scope === 'mine' && item.rating === -1 && view !== 'history') {
			items = items.filter((i) => i.id !== item.id || i.saved);
		}
		try {
			const r = await fetch('/api/inspiration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId: item.id, rating: item.rating, scope })
			});
			if (!r.ok) item.rating = prev;
		} catch { item.rating = prev; }
	}
</script>

<svelte:head><title>Inspiration — eating.computer</title></svelte:head>

{#snippet itemActions(item)}
	<span class="act-cluster">
		<button class="act-btn" class:on-up={item.rating === 1} title="More like this" onclick={() => rate(item, 1)}>
			<span class="msi" class:msi-fill={item.rating === 1}>thumb_up</span>
		</button>
		<button class="act-btn" class:on-down={item.rating === -1} title="Less like this" onclick={() => rate(item, -1)}>
			<span class="msi" class:msi-fill={item.rating === -1}>thumb_down</span>
		</button>
		<button class="act-btn" class:on-save={item.saved} title={item.saved ? 'Saved — click to unsave' : 'Save forever'} onclick={() => toggleSave(item)}>
			<span class="msi" class:msi-fill={item.saved}>bookmark</span>
		</button>
	</span>
{/snippet}

<div class="inspo-shell">
	<main>
		<div class="page-head">
			<h1>Inspiration</h1>
			<p class="page-sub">
				{#if scope === 'class'}
					A shared feed built from the class syllabus. Everyone sees the same finds — <strong>👍 what resonates</strong>,
					and the ones the class rallies behind rise to the top.
				{:else if scope === 'mine'}
					Your own finds, based on your interests. <strong>Save what speaks to you</strong> and 👍/👎 teach it your
					taste. Unsaved finds fade after 7 days; History keeps the record.
				{:else}
					What each student is drawn to — personally and in the class feed. Their likes quietly steer their own
					feed, and shared favorites nudge the class feed for everyone.
				{/if}
			</p>
		</div>

		<div class="scope-tabs">
			<button class="scope-tab" class:active={scope === 'class'} onclick={() => switchScope('class')}>Class</button>
			<button class="scope-tab" class:active={scope === 'mine'} onclick={() => switchScope('mine')}>Mine</button>
			{#if isInstructor}
				<button class="scope-tab" class:active={scope === 'students'} onclick={() => switchScope('students')}>Students</button>
			{/if}
		</div>

		{#if scope === 'class'}
			{#if topics}
				<div class="topics-row">
					<span class="topics-label">From the syllabus:</span>
					<span class="topics-value">{topics}</span>
				</div>
			{/if}
		{:else if scope === 'mine' && (interests || topics)}
			<div class="topics-row">
				{#if editingTopics}
					<input
						class="topics-input"
						bind:value={topicsDraft}
						placeholder="e.g. risograph printing, algorithmic composition, brutalism"
						maxlength="300"
						onkeydown={(e) => { if (e.key === 'Enter') saveTopics(); if (e.key === 'Escape') editingTopics = false; }}
					/>
					<button class="view-chip" disabled={topicsSaving} onclick={saveTopics}>{topicsSaving ? 'Saving…' : 'Save & search'}</button>
					<button class="view-chip" onclick={() => (editingTopics = false)}>Cancel</button>
					{#if topics !== interests}
						<button class="view-chip" onclick={() => { topicsDraft = ''; saveTopics(); }}>Reset to interests</button>
					{/if}
				{:else}
					<span class="topics-label">Searching for:</span>
					<span class="topics-value">{topics}</span>
					<button class="topics-edit" title="Change the topics the feed searches for" onclick={() => { topicsDraft = topics; editingTopics = true; }}>
						<span class="msi">edit</span> Edit topics
					</button>
				{/if}
			</div>
		{/if}

		{#if scope === 'students'}
			{#if loading}
				<p class="empty"><span class="msi inspo-spin">progress_activity</span> Gathering what everyone likes…</p>
			{:else if insights}
				{#if insights.classFavorites?.length}
					<section class="inspo-section">
						<h2>Class favorites</h2>
						<p class="sec-sub">Shared finds the class rated highest.</p>
						<ul class="row-list">
							{#each insights.classFavorites as f (f.url)}
								<li class="row">
									<div class="row-body">
										<a class="row-title" href={f.url} target="_blank" rel="noopener noreferrer">{f.title}</a>
										<span class="row-meta">👍 {f.score} · 🔖 {f.saves} · {f.kind}</span>
									</div>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				<section class="inspo-section">
					<h2>Each student</h2>
					{#each insights.students as st (st.id)}
						<div class="student-card">
							<div class="student-head">
								<a class="student-name" href="/app/profile/{st.id}">{st.name}</a>
								<span class="student-stat">{st.likeCount} 👍 · {st.saveCount} 🔖</span>
							</div>
							{#if st.interests}<p class="student-interests">{st.interests}</p>{/if}
							{#if st.personalLikes.length}
								<ul class="student-likes">
									{#each st.personalLikes as l (l.url)}
										<li><a href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>{#if l.meta}<span class="student-like-meta"> · {l.meta}</span>{/if}</li>
									{/each}
								</ul>
							{:else}
								<p class="student-empty">Nothing liked yet.</p>
							{/if}
						</div>
					{/each}
				</section>
			{:else}
				<p class="empty">No student activity yet.</p>
			{/if}
		{:else}

		<details class="library-note">
			<summary><span class="msi">school</span> Reading paywalled papers with your Cooper login</summary>
			<div class="library-note-body">
				<p>
					Every paper here opens through <strong>Cooper Union's library</strong> (OpenAthens), so you read it
					with the school's access — free if it's open access, unlocked from behind the paywall if it isn't.
					Look for the <span class="msi lock-inline">account_balance</span> icon.
				</p>
				<p><strong>How it works:</strong></p>
				<ol>
					<li>Click a paper. You'll land on an OpenAthens sign-in page.</li>
					<li>Choose <strong>The Cooper Union</strong> if asked, then sign in with your Cooper email and password.</li>
					<li>You'll be dropped straight onto the article.</li>
				</ol>
				<p class="library-note-fine">
					Access depends on what Cooper subscribes to — a few titles may still be unavailable. Off-campus is
					fine; the login is what grants access, not your network. More at
					<a href="https://library.cooper.edu/offsite" target="_blank" rel="noopener noreferrer">the library's remote-access page</a>.
				</p>
			</div>
		</details>

		{#if scope === 'mine'}
			<div class="view-row">
				<button class="view-chip" class:active={view === 'fresh'} onclick={() => setView('fresh')}>Fresh</button>
				<button class="view-chip" class:active={view === 'saved'} onclick={() => setView('saved')}>Saved</button>
				<button class="view-chip" class:active={view === 'history'} onclick={() => setView('history')}>History</button>
				<button class="view-chip export-chip" title="Download your topics, saves, likes/dislikes, and the derived taste model as JSON" onclick={exportAlgorithm}>
					<span class="msi">download</span> Export my algorithm
				</button>
			</div>
		{/if}

		{#if loading}
			<p class="empty"><span class="msi inspo-spin">progress_activity</span> Gemma is out looking for new things…</p>
		{:else if scope === 'mine' && !topics}
			<p class="empty">No interests on file yet — add them in your <a href="/app/profile/edit">profile</a> (or ask your instructor to fill them in on the Manage page) and check back tomorrow.</p>
		{:else if scope === 'class' && !topics && !visible.length}
			<p class="empty">The class feed builds from the syllabus — add week topics on the <a href="/app/manage">Manage</a> page and finds will start arriving.</p>
		{:else if !visible.length}
			{#if view === 'saved'}
				<p class="empty">Nothing saved yet. Hit the bookmark on anything you want to keep.</p>
			{:else if !scoutOnline && !items.length}
				<p class="empty">Scout is offline right now, so no finds have come in yet — check back soon.</p>
			{:else}
				<p class="empty">Nothing here yet — new finds should arrive within a day.</p>
			{/if}
		{:else}
			{#each grouped as sec (sec.key)}
				<section class="inspo-section">
					<h2>{sec.title}</h2>
					{#if sec.sub}<p class="sec-sub">{sec.sub}</p>{/if}

					{#if sec.key === 'artwork'}
						<div class="art-grid">
							{#each sec.items as item (item.id)}
								<div class="art-card" class:expired={item.expired && !item.saved}>
									<a href={item.url} target="_blank" rel="noopener noreferrer" class="art-link">
										{#if item.image}
											<img src={item.image} alt={item.title} loading="lazy" />
										{:else}
											<div class="art-noimg">🖼️</div>
										{/if}
										<span class="art-title">{item.title}</span>
										{#if item.snippet}<span class="art-snip">{item.snippet}</span>{/if}
										<span class="art-meta">{item.meta}{#if scope === 'class' && item.aggScore > 0} · 👍 {item.aggScore}{/if}</span>
									</a>
									<span class="art-actions">{@render itemActions(item)}</span>
									{#if item.expired && !item.saved}<span class="expired-tag">faded</span>{/if}
								</div>
							{/each}
						</div>
					{:else}
						<ul class="row-list">
							{#each sec.items as item (item.id)}
								<li class="row" class:expired={item.expired && !item.saved}>
									{#if item.image}
										<img class="row-thumb" src={item.image} alt="" loading="lazy" />
									{/if}
									<div class="row-body">
										<a class="row-title" href={linkFor(item)} target="_blank" rel="noopener noreferrer">
											{#if item.kind === 'paper'}<span class="msi lock-icon" title={isDoiPaper(item) ? 'Opens through Cooper Library — sign in with your Cooper login' : 'Find a copy (usually a book)'}>{isDoiPaper(item) ? 'account_balance' : 'menu_book'}</span>{/if}{item.title}
										</a>
										{#if item.snippet}<span class="row-snip">{item.snippet}</span>{/if}
										{#if item.meta}<span class="row-meta">{item.meta}{#if isDoiPaper(item)} · via Cooper Library{/if}{#if scope === 'class' && item.aggScore > 0} · 👍 {item.aggScore} in class{/if}{#if item.expired && !item.saved} · faded{/if}</span>{/if}
									</div>
									{@render itemActions(item)}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		{/if}

		{#if topics && !loading && view !== 'saved'}
			<div class="more-row">
				{#if pending}
					<span class="more-pending"><span class="msi inspo-spin">progress_activity</span> Scout is out fetching a new batch — new finds drop in as they land…</span>
				{:else}
					<button class="more-btn" onclick={fetchMore}>
						<span class="msi">travel_explore</span> Fetch more
					</button>
					{#if !scoutOnline}<span class="more-note">Scout looks offline — it'll pick this up when it's back.</span>{/if}
				{/if}
			</div>
		{/if}
		{/if}
	</main>
</div>

<style>
	.inspo-shell { min-height: 100%; background: var(--paper); }
	main { max-width: 680px; margin: 0 auto; padding: calc(1rem + var(--header-h, 52px)) 1.25rem 4rem; }
	.page-head h1 { font-family: 'Avara', serif; font-size: 1.5rem; margin: 0 0 0.35rem; }
	.page-sub { font-size: 0.85rem; color: var(--muted-fg); margin: 0 0 1rem; line-height: 1.5; }
	.page-sub strong { color: var(--ink); font-weight: 600; }

	.scope-tabs {
		display: flex; gap: 0.25rem; margin-bottom: 1rem;
		border-bottom: 1.5px solid var(--border);
	}
	.scope-tab {
		padding: 0.5rem 1rem; font-family: inherit; font-size: 0.9rem; font-weight: 600;
		background: none; border: none; border-bottom: 2.5px solid transparent;
		color: var(--muted-fg); cursor: pointer; margin-bottom: -1.5px;
		transition: color 0.12s, border-color 0.12s;
	}
	.scope-tab:hover { color: var(--ink); }
	.scope-tab.active { color: var(--ink); border-bottom-color: var(--ink); }

	.student-card {
		border: 1.5px solid var(--border); border-radius: 12px;
		padding: 0.85rem 1rem; margin-bottom: 0.7rem;
	}
	.student-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
	.student-name { font-size: 0.95rem; font-weight: 600; color: var(--ink); text-decoration: none; }
	.student-name:hover { text-decoration: underline; }
	.student-stat { font-size: 0.78rem; color: var(--muted-fg); flex-shrink: 0; }
	.student-interests { font-size: 0.78rem; color: var(--muted-fg); margin: 0.25rem 0 0.5rem; font-style: italic; }
	.student-likes { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
	.student-likes li { font-size: 0.82rem; line-height: 1.35; }
	.student-likes a { color: var(--ink); text-decoration: none; }
	.student-likes a:hover { text-decoration: underline; }
	.student-like-meta { color: var(--muted-fg); font-size: 0.75rem; }
	.student-empty { font-size: 0.78rem; color: var(--muted-fg); margin: 0.4rem 0 0; }

	.topics-row {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
		margin-bottom: 0.75rem; font-size: 0.82rem;
	}
	.topics-label { color: var(--muted-fg); font-weight: 600; flex-shrink: 0; }
	.topics-value { color: var(--ink); }
	.topics-edit {
		display: inline-flex; align-items: center; gap: 0.25rem;
		background: none; border: none; padding: 0.15rem 0.3rem;
		font-family: inherit; font-size: 0.78rem; font-weight: 600;
		color: var(--md-sys-color-primary, var(--accent)); cursor: pointer;
	}
	.topics-edit:hover { text-decoration: underline; }
	.topics-edit .msi { font-size: 15px; }
	.topics-input {
		flex: 1; min-width: 220px;
		padding: 0.45rem 0.7rem; border: 1.5px solid var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; color: var(--ink); background: var(--paper);
		outline: none;
	}
	.topics-input:focus { border-color: var(--ink); }

	.library-note {
		border: 1.5px solid var(--border); border-radius: 10px;
		padding: 0.15rem 0.85rem; margin-bottom: 1rem;
		background: var(--surface-2);
	}
	.library-note summary {
		display: flex; align-items: center; gap: 0.45rem;
		padding: 0.6rem 0; cursor: pointer; list-style: none;
		font-size: 0.82rem; font-weight: 600; color: var(--ink);
	}
	.library-note summary::-webkit-details-marker { display: none; }
	.library-note summary .msi { font-size: 18px; color: var(--md-sys-color-primary, var(--accent)); }
	.library-note-body { font-size: 0.82rem; color: var(--muted-fg); line-height: 1.55; padding-bottom: 0.6rem; }
	.library-note-body p { margin: 0 0 0.6rem; }
	.library-note-body ol { margin: 0 0 0.6rem; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.3rem; }
	.library-note-body strong { color: var(--ink); }
	.library-note-body a { color: var(--md-sys-color-primary, var(--accent)); }
	.library-note-fine { font-size: 0.76rem; opacity: 0.9; }
	.lock-inline { font-size: 14px; vertical-align: -2px; }

	.view-row { display: flex; gap: 0.4rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
	.export-chip { display: inline-flex; align-items: center; gap: 0.3rem; margin-left: auto; }
	.export-chip .msi { font-size: 15px; }
	.view-chip {
		padding: 0.35rem 0.9rem; font-family: inherit; font-size: 0.8rem; font-weight: 600;
		background: none; color: var(--muted-fg); border: 1.5px solid var(--border);
		border-radius: 999px; cursor: pointer; transition: all 0.12s;
	}
	.view-chip:hover { border-color: var(--ink); color: var(--ink); }
	.view-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

	.empty { font-size: 0.88rem; color: var(--muted-fg); line-height: 1.5; }
	.empty a { color: var(--ink); }
	.inspo-spin { display: inline-block; vertical-align: -0.2em; animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.inspo-section { margin-bottom: 2rem; }
	.inspo-section h2 {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent));
		margin: 0 0 0.15rem;
	}
	.sec-sub { font-size: 0.75rem; color: var(--muted-fg); margin: 0 0 0.75rem; }

	/* papers / channels / articles — list rows */
	.row-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.row {
		display: flex; align-items: flex-start; gap: 0.7rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		padding: 0.7rem 0.85rem;
	}
	.row.expired { opacity: 0.55; }
	.row-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
	.row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
	.row-title {
		font-size: 0.88rem; font-weight: 600; color: var(--ink);
		text-decoration: none; line-height: 1.35;
	}
	.row-title:hover { text-decoration: underline; text-underline-offset: 2px; }
	.row-snip { font-size: 0.76rem; color: var(--muted-fg); line-height: 1.4; }
	.row-meta { font-size: 0.72rem; color: var(--md-sys-color-primary, var(--accent)); font-weight: 600; }
	.row-meta.meta-paywall { color: var(--muted-fg); }
	.lock-icon {
		font-size: 14px; vertical-align: -2px; margin-right: 0.15rem;
		color: var(--muted-fg);
	}

	/* artworks — image grid */
	.art-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
	.art-card { position: relative; border: 1.5px solid var(--border); border-radius: 12px; overflow: hidden; }
	.art-card.expired { opacity: 0.55; }
	.art-link { display: flex; flex-direction: column; text-decoration: none; color: var(--ink); }
	.art-link img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: var(--surface-2); }
	.art-noimg { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 2rem; background: var(--surface-2); }
	.art-title { font-size: 0.78rem; font-weight: 600; padding: 0.5rem 0.6rem 0; line-height: 1.3; }
	.art-snip { font-size: 0.7rem; color: var(--muted-fg); padding: 0.1rem 0.6rem 0; line-height: 1.3; }
	.art-meta { font-size: 0.66rem; color: var(--md-sys-color-primary, var(--accent)); font-weight: 600; padding: 0.15rem 0.6rem 0.55rem; }
	.expired-tag {
		position: absolute; top: 0.4rem; left: 0.4rem;
		font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
		background: rgba(0, 0, 0, 0.55); color: #fff;
		padding: 0.1rem 0.4rem; border-radius: 99px;
	}

	.act-cluster { display: inline-flex; gap: 0.1rem; flex-shrink: 0; align-items: center; }
	.act-btn {
		background: none; border: none; cursor: pointer; padding: 0.22rem;
		color: var(--muted-fg);
		transition: color 0.12s, transform 0.12s;
		line-height: 0;
	}
	.act-btn .msi { font-size: 19px; }
	.act-btn:hover { color: var(--ink); transform: scale(1.15); }
	.act-btn.on-up { color: #2e7d32; }
	.act-btn.on-down { color: #c62828; }
	.act-btn.on-save { color: var(--md-sys-color-primary, var(--accent)); }
	.art-actions .act-cluster {
		position: absolute; top: 0.3rem; right: 0.3rem;
		background: color-mix(in srgb, var(--paper) 82%, transparent);
		border-radius: 99px; backdrop-filter: blur(6px);
		padding: 0 0.15rem;
	}
	.msi-fill { font-variation-settings: 'FILL' 1; }

	.more-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap; }
	.more-btn {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.55rem 1.2rem; font-family: inherit; font-size: 0.85rem; font-weight: 600;
		background: var(--ink); color: var(--paper); border: none; border-radius: 999px;
		cursor: pointer; transition: opacity 0.15s;
	}
	.more-btn:hover { opacity: 0.85; }
	.more-btn .msi { font-size: 18px; }
	.more-pending { font-size: 0.82rem; color: var(--muted-fg); display: inline-flex; align-items: center; gap: 0.4rem; }
	.more-note { font-size: 0.75rem; color: var(--muted-fg); }
</style>
