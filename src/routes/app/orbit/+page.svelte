<script>
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';

	let { data, form } = $props();
	const isInstructor = data.role === 'instructor';
	const { contentHtml } = createContentRenderer();

	// Static-frame mounting for `.tg-emoji` spans rendered by
	// contentHtml() inside week headlines / topic previews / item
	// labels. Without this they show up as empty boxes outside chat,
	// where the full Lottie pipeline isn't running.
	let pageEl = $state(null);
	$effect(() => {
		void data.weeks;
		if (!pageEl) return;
		tick().then(() => mountStaticEmotes(pageEl));
	});

	function fmtDueDate(s) {
		if (!s) return '';
		return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	const TYPE_LABELS = { link: 'Link', image: 'Image', video: 'Video' };
	const ALL_TYPES = ['link', 'image', 'video'];

	// 5-week window centered on the current plan: 2 prior, current,
	// 2 upcoming. If we're sitting near the beginning or end of the
	// term, the window slides over so it always shows up to 5 rows
	// when there's that much data available — never an awkward "+1
	// week before and 3 after" because we clamped early.
	const WINDOW_RADIUS = 2;
	const orderedWeeks = $derived(
		[...(data.weeks ?? [])].sort((a, b) => a.week - b.week)
	);
	const currentIdx = $derived(
		data.currentPlanId
			? orderedWeeks.findIndex((w) => w.planId === data.currentPlanId)
			: -1
	);
	// Roadmap shows just the CURRENT week + the NEXT one; the "See all
	// weeks" toggle below the window expands the full timeline inline
	// (same pattern as the Syllabus section below it).
	let roadmapExpanded = $state(false);
	const visibleWeeks = $derived.by(() => {
		if (!orderedWeeks.length) return [];
		if (roadmapExpanded) return orderedWeeks;
		const start = currentIdx < 0 ? 0 : currentIdx;
		return orderedWeeks.slice(start, start + 2);
	});
	const hasMoreWeeks = $derived(orderedWeeks.length > visibleWeeks.length);

	// Per-week status for the student. Instructors get a flat
	// "N items" tag so they see the shape of each week without a
	// personal completion icon (they don't submit anything).
	function weekStatus(wk) {
		const items = wk.items ?? [];
		if (!items.length) return { kind: 'empty', label: 'No tasks' };
		const done = items.filter((it) => it.mine).length;
		if (done === items.length) return { kind: 'done', label: 'Completed', done, total: items.length };
		if (done > 0) return { kind: 'progress', label: `${done}/${items.length} done`, done, total: items.length };
		return { kind: 'todo', label: 'Not started', done: 0, total: items.length };
	}

	let showForm = $state(false);
	let openSubmit = $state(null);
	let submitTypes = $state({});

	// ── Syllabus section ─────────────────────────────────────────────
	// Collapsed: just the NEXT week's header + topics. Expanded: every
	// week of the key syllabus in a detailed outline.
	let syllabusExpanded = $state(false);
	const syllabusShownWeeks = $derived(
		syllabusExpanded
			? (data.syllabusWeeks ?? [])
			: (data.syllabusWeeks ?? []).filter((w) => w.week === data.syllabusNextWeek)
	);
	function fmtWeekOf(iso) {
		if (!iso) return '';
		const [y, m, d] = String(iso).split('-').map(Number);
		if (!y || !m || !d) return '';
		return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
	}

	// Streamed Collection data — starts empty so the roadmap paints instantly,
	// then fills in when load()'s `collection` promise resolves a beat later.
	// The $effect re-subscribes on navigation so a new page's data replaces
	// the old. `collectionLoading` drives the Files-section skeleton.
	let links = $state([]);
	let uploadedFiles = $state([]);
	let starredMessages = $state([]);
	let collectionLoading = $state(true);
	$effect(() => {
		let cancelled = false;
		collectionLoading = true;
		Promise.resolve(data.collection).then((c) => {
			if (cancelled || !c) return;
			links = c.links ?? [];
			uploadedFiles = c.uploadedFiles ?? [];
			starredMessages = c.starredMessages ?? [];
			collectionLoading = false;
		});
		return () => { cancelled = true; };
	});

	// Instructor delete-from-Orbit. Hits the existing /api/upload/[id]
	// DELETE which now also accepts instructor callers (see
	// src/routes/api/upload/[id]/+server.js). Optimistic remove first
	// so the chip disappears immediately; refilled from server on
	// next page load.
	async function deleteUpload(file) {
		if (!confirm(`Delete "${file.filename}"? This removes it from R2 and from anywhere it's referenced.`)) return;
		const id = file.id;
		uploadedFiles = uploadedFiles.filter((u) => u.id !== id);
		try {
			const r = await fetch(`/api/upload/${id}`, { method: 'DELETE' });
			if (!r.ok) throw new Error(await r.text());
		} catch (e) {
			alert('Delete failed: ' + (e?.message ?? e));
			// Restore the chip so the user can retry.
			uploadedFiles = [...uploadedFiles, file].sort((a, b) => b.uploadedAt - a.uploadedAt);
		}
	}

	function displayName(sub) {
		return sub.name || sub.email;
	}

	function getDomain(url) {
		try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
	}

	function getFavicon(url) {
		try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; } catch { return ''; }
	}

	function formatAge(ts) {
		const d = Date.now() - ts;
		if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
		if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
		if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatSize(bytes) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<svelte:head><title>Orbit — eating.computer</title></svelte:head>

<div class="shell">
	<main bind:this={pageEl}>
		<!-- ═══════════════════ ROADMAP ═══════════════════ -->
		<!--
			Roadmap is now sourced from the same week_plans the home page
			renders. Instructors create / edit assignments on /app; this
			page is the read-only "map" view — every week is here in
			order, with its headline + items. Click any row to jump to
			that week on the home page (or, for instructors, into the
			edit form via /app#edit-{id}).
		-->
		<div class="page-header">
			<h1>Roadmap</h1>
			<a class="btn-secondary" href="/app">
				{isInstructor ? 'Manage on home →' : 'Open current week →'}
			</a>
		</div>

		<!--
			Compact 5-week window. The current week sits in the middle
			(highlighted) with up to two prior + two upcoming weeks around
			it. Each row is just topic + status — for the full checklist
			the student / instructor jumps to the home page via the
			button above (or by clicking a row).
		-->
		{#if visibleWeeks.length === 0}
			<p class="empty">No assignments yet.</p>
		{:else}
			<ul class="roadmap-window">
				{#each visibleWeeks as wk (wk.planId)}
					{@const isCurrent = wk.planId === data.currentPlanId}
					{@const isPast = !!data.currentWeekNum && wk.week < data.currentWeekNum && !isCurrent}
					{@const status = weekStatus(wk)}
					<li class="roadmap-row" class:current={isCurrent} class:past={isPast}>
						<a class="roadmap-link" href="/app">
							<span class="roadmap-week-num">Week {wk.week}</span>
							<div class="roadmap-body">
								{#if wk.headline}
									<span class="roadmap-headline">{@html contentHtml(wk.headline, false)}</span>
								{:else}
									<span class="roadmap-headline muted">Untitled week</span>
								{/if}
								{#if wk.dueDate && !isPast}
									<span class="roadmap-due">Due {fmtDueDate(wk.dueDate)}</span>
								{/if}
							</div>
							{#if isPast}
								<!-- Passed weeks: name only — no status / due noise -->
							{:else if isInstructor}
								<span class="roadmap-status instructor">
									{wk.items.length} item{wk.items.length === 1 ? '' : 's'}
								</span>
							{:else}
								<span class="roadmap-status status-{status.kind}">
									{#if status.kind === 'done'}
										<span class="msi msi-18 msi-fill">check_circle</span>
									{:else if status.kind === 'progress'}
										<span class="msi msi-18">timelapse</span>
									{:else if status.kind === 'todo'}
										<span class="msi msi-18">radio_button_unchecked</span>
									{:else}
										<span class="msi msi-18">remove</span>
									{/if}
									{status.label}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
			{#if hasMoreWeeks || roadmapExpanded}
				<button class="roadmap-all-link sylo-all-btn" onclick={() => (roadmapExpanded = !roadmapExpanded)}>
					<span>{roadmapExpanded ? 'Just the current week' : `See all ${orderedWeeks.length} weeks`}</span>
					<span class="msi msi-18">{roadmapExpanded ? 'expand_less' : 'expand_more'}</span>
				</button>
			{/if}
		{/if}

		<!-- ═══════════════════ SYLLABUS ═══════════════════ -->
		{#if data.syllabusWeeks?.length}
			<div class="files-divider"></div>
			<div class="page-header">
				<h1>Syllabus</h1>
			</div>
			<ul class="sylo-weeks">
				{#each syllabusShownWeeks as w (w.week)}
					{@const isPast = !!data.currentWeekNum && w.week < data.currentWeekNum}
					<li class="sylo-week" class:next={w.week === data.syllabusNextWeek} class:past={isPast}>
						{#if w.week === data.syllabusNextWeek}<span class="sylo-next-tag">upcoming</span>{/if}
						<div class="sylo-card">
							<div class="sylo-week-head">
								<span class="sylo-week-num">Class {w.week}</span>
								<span class="sylo-week-title">{w.title || 'Untitled'}</span>
								{#if w.weekOf}<span class="sylo-week-of">{fmtWeekOf(w.weekOf)}</span>{/if}
							</div>
							<!-- Passed weeks collapse to just the name — topics only
							     render for the current week onward. -->
							{#if w.topics.length && !isPast}
								<ul class="sylo-topics">
									{#each w.topics as t}<li>{t}</li>{/each}
								</ul>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			<button class="roadmap-all-link sylo-all-btn" onclick={() => (syllabusExpanded = !syllabusExpanded)}>
				<span>{syllabusExpanded ? 'Just the next class' : `See all ${data.syllabusWeeks.length} classes`}</span>
				<span class="msi msi-18">{syllabusExpanded ? 'expand_less' : 'expand_more'}</span>
			</button>
		{/if}

		<!-- ═══════════════════ FILES ═══════════════════ -->
		<div class="files-divider"></div>

		<div class="page-header">
			<h1>Files</h1>
		</div>

		{#if uploadedFiles.length > 0}
			<p class="section-label">Uploads</p>
			<div class="links-grid" style="margin-bottom: 2rem;">
				{#each uploadedFiles as f (f.id)}
					<!-- Wrapper turns the anchor into "row + trailing
					     instructor-only delete button". The anchor still
					     opens the file in a new tab; the delete button
					     is its own click target. -->
					<div class="chip-with-actions">
						<a href={f.url} target="_blank" rel="noopener noreferrer" class="link-chip">
							<div class="chip-favicon">
								<FileTypeIcon filename={f.filename} mimetype={f.mimetype} url={f.url} iconSize={28} />
							</div>
							<div class="chip-body">
								<span class="chip-title">{f.filename}</span>
								<span class="chip-meta">
									<span class="chip-domain">{formatSize(f.size)}</span>
									<span class="chip-dot">·</span>
									<span>uploaded by {f.uploadedByName}</span>
									<span class="chip-dot">·</span>
									<span>{formatAge(f.uploadedAt)}</span>
									<span class="chip-dot">·</span>
									<span class="chip-channel">{f.contextType === 'dm' ? 'DM' : `#${f.convName}`}</span>
								</span>
							</div>
							<svg class="ext-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
						</a>
						{#if isInstructor}
							<button type="button" class="chip-delete-btn" title="Delete from R2 and Orbit"
								onclick={() => deleteUpload(f)}>
								<span class="msi msi-18">delete</span>
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if links.length > 0}
			{#if uploadedFiles.length > 0}<p class="section-label">Links</p>{/if}
			<div class="links-grid">
				{#each links as link (link.url)}
					<a href={link.url} target="_blank" rel="noopener noreferrer" class="link-chip">
						<div class="chip-favicon">
							<img
								src={getFavicon(link.url)}
								alt=""
								loading="lazy"
								onerror={(e) => (e.currentTarget.style.visibility = "hidden")}
							/>
						</div>
						<div class="chip-body">
							<span class="chip-title">{link.title ?? getDomain(link.url)}</span>
							<span class="chip-meta">
								<span class="chip-domain">{getDomain(link.url)}</span>
								<span class="chip-dot">·</span>
								<span>shared by {link.sharedBy}</span>
								<span class="chip-dot">·</span>
								<span>{formatAge(link.sharedAt)}</span>
								<span class="chip-dot">·</span>
								<span class="chip-channel">#{link.convName}</span>
							</span>
						</div>
						<svg class="ext-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
					</a>
				{/each}
			</div>
		{/if}

		{#if starredMessages.length > 0}
			<p class="section-label">Starred messages</p>
			<div class="starred-list">
				{#each starredMessages as s (s.id)}
					<div class="starred-card">
						<div class="starred-meta">
							<span class="starred-author">{s.authorName}</span>
							<span class="chip-dot">·</span>
							<span class="starred-conv">{s.convName ? `#${s.convName}` : 'DM'}</span>
							<span class="chip-dot">·</span>
							<span>{formatAge(s.starredAt)}</span>
						</div>
						{#if s.content}
							<p class="starred-content">{s.content}</p>
						{/if}
						{#if s.attachment}
							<a href={s.attachment.url} target="_blank" rel="noopener noreferrer" class="starred-att">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
								{s.attachment.filename}
							</a>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if uploadedFiles.length === 0 && links.length === 0 && starredMessages.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
				</div>
				<h2>No files yet</h2>
				<p>Files uploaded in chat and links shared in channels will appear here.</p>
			</div>
		{/if}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	main {
		flex: 1;
		padding: 2rem 1.5rem;
		padding-top: calc(2rem + 52px);
		max-width: 900px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.page-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-family: 'Avara', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0;
		color: var(--ink);
	}

	.subtitle {
		font-size: 0.85rem;
		color: var(--muted-fg);
		margin: 0;
	}

	/* ── Divider between Roadmap and Files ── */
	.files-divider {
		border-top: 2px solid var(--border);
		margin: 2.5rem 0;
	}

	/* ── Create form ── */
	.create-card {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 2rem;
	}
	.create-card h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0 0 1rem;
	}

	form { display: flex; flex-direction: column; gap: 0.75rem; }

	.form-row { display: flex; gap: 0.75rem; }
	.grow { flex: 1; }

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		font-weight: 500;
	}

	fieldset {
		border: 1.5px solid var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.75rem;
		margin: 0;
	}
	legend {
		font-size: 0.85rem;
		font-weight: 500;
		padding: 0 0.25rem;
	}
	.checkbox-row { display: flex; gap: 1rem; margin-top: 0.4rem; }
	.checkbox-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.875rem;
		font-weight: 400;
		cursor: pointer;
	}

	input[type="text"],
	input[type="number"],
	input[type="url"],
	input[type="date"],
	textarea {
		padding: 0.55rem 0.75rem;
		border: 1.5px solid var(--border);
		border-radius: 8px;
		background: var(--paper);
		font-family: inherit;
		font-size: 0.9rem;
		color: var(--ink);
		outline: none;
		transition: border-color 0.15s;
		resize: vertical;
	}
	input:focus, textarea:focus { border-color: var(--ink); }
	input[type="number"] { width: 80px; }
	input[type="file"] { font-size: 0.85rem; }

	.form-actions { display: flex; justify-content: flex-end; }

	/* ── Buttons ── */
	.btn-primary {
		padding: 0.55rem 1.25rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }
	.btn-primary.small { padding: 0.4rem 0.9rem; font-size: 0.85rem; }

	.btn-secondary {
		padding: 0.4rem 0.9rem;
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--ink);
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.btn-secondary:hover { border-color: var(--ink); }

	.btn-ghost {
		padding: 0.4rem 0.75rem;
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.85rem;
		color: var(--muted-fg);
		cursor: pointer;
	}
	.btn-ghost:hover { color: var(--ink); }

	.btn-submit {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink);
		cursor: pointer;
		transition: border-color 0.15s;
		margin-top: 0.25rem;
	}
	.btn-submit:hover { border-color: var(--ink); }

	.btn-delete {
		background: none;
		border: none;
		font-size: 1.2rem;
		color: var(--border);
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
		flex-shrink: 0;
		transition: color 0.15s;
	}
	.btn-delete:hover { color: var(--danger); }

	.required { color: var(--danger); }

	.error {
		padding: 0.5rem 0.75rem;
		background: #fff0f0;
		border: 1.5px solid #f5c6cb;
		border-radius: 8px;
		color: var(--danger);
		font-size: 0.85rem;
		margin: 0;
	}
	.error.small { font-size: 0.8rem; padding: 0.4rem 0.6rem; }

	/* ── Compact roadmap window ──────────────────────
	   Replaces the long per-week sections with a 5-row list centered
	   on the current week. Rows themselves are plain anchors that
	   jump to /app for the full checklist. */
	/* ── Syllabus section (key-syllabus outline) ── */
	.sylo-all-btn { background: none; border: none; cursor: pointer; font-family: inherit; }
	.sylo-weeks {
		list-style: none;
		padding: 0;
		margin: 0 0 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.sylo-week { display: flex; flex-direction: column; align-items: stretch; gap: 0.3rem; }
	.sylo-week.past .sylo-card { opacity: 0.65; }
	.roadmap-row.past .roadmap-link { opacity: 0.65; padding-top: 0.5rem; padding-bottom: 0.5rem; }
	.sylo-card {
		padding: 0.7rem 0.95rem;
		background: var(--md-sys-color-surface-container, var(--surface-2));
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 12px;
	}
	.sylo-week.next .sylo-card {
		/* Gentle tint over the normal surface — the full primary-container
		   read as too dark/intense against the light-theme surfaces. */
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 8%, var(--md-sys-color-surface-container, var(--surface-2)));
		border-color: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 45%, var(--md-sys-color-outline-variant, var(--border)));
	}
	.sylo-week-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.sylo-week-num {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--md-sys-color-secondary, var(--muted-fg));
		flex-shrink: 0;
	}
	.sylo-week-title {
		font-family: 'Avara', serif;
		font-size: 1.02rem;
		font-weight: 600;
		min-width: 0;
	}
	.sylo-next-tag {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, var(--paper));
		padding: 0.14rem 0.45rem; border-radius: 99px;
		align-self: flex-start; flex-shrink: 0;
	}
	.sylo-week-of {
		margin-left: auto;
		font-size: 0.78rem;
		color: var(--md-sys-color-secondary, var(--muted-fg));
		flex-shrink: 0;
	}
	.sylo-topics {
		margin: 0.45rem 0 0.1rem;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.88rem;
		line-height: 1.45;
	}

	.roadmap-all-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: -0.5rem 0 2rem;
		padding: 0.5rem 0.25rem;
		color: var(--accent);
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.roadmap-all-link:hover { text-decoration: underline; }
	.roadmap-window {
		list-style: none;
		padding: 0;
		margin: 0 0 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.roadmap-row { display: block; }
	.roadmap-link {
		display: grid;
		grid-template-columns: 64px 1fr auto;
		align-items: center;
		gap: 0.85rem;
		padding: 0.7rem 0.95rem;
		background: var(--md-sys-color-surface-container, var(--surface-2));
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 12px;
		text-decoration: none;
		color: var(--ink);
		transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
	}
	.roadmap-link:hover {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 50%, var(--border));
	}
	.roadmap-row.current .roadmap-link {
		/* Same gentle tint as the Syllabus upcoming card — the full
		   primary-container + glow was too dark/intense on light theme. */
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 8%, var(--md-sys-color-surface-container, var(--surface-2)));
		border-color: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 45%, var(--md-sys-color-outline-variant, var(--border)));
	}
	.roadmap-row.current .roadmap-link:hover { transform: translateY(-1px); }

	.roadmap-week-num {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--md-sys-color-secondary, var(--muted-fg));
	}

	.roadmap-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.roadmap-headline {
		font-family: 'Avara', serif;
		font-size: 0.98rem;
		line-height: 1.2;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.roadmap-headline.muted { color: var(--muted-fg); font-style: italic; }
	.roadmap-due {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.7rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}

	.roadmap-status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		color: var(--muted-fg);
		flex-shrink: 0;
	}
	.roadmap-status.status-done {
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 18%, transparent);
		color: var(--md-sys-color-primary, var(--accent));
	}
	.roadmap-status.status-progress {
		background: color-mix(in srgb, var(--md-sys-color-tertiary, var(--accent)) 18%, transparent);
		color: var(--md-sys-color-tertiary, var(--accent));
	}
	.roadmap-status.status-todo,
	.roadmap-status.status-empty,
	.roadmap-status.instructor {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}

	@media (max-width: 600px) {
		.roadmap-link {
			grid-template-columns: 56px 1fr;
			gap: 0.65rem;
		}
		.roadmap-status {
			grid-column: 2;
			justify-self: start;
			margin-top: 0.15rem;
		}
	}

	/* ── Week sections ── (Roadmap reads from week_plans now) */
	.week-section {
		margin-bottom: 1.5rem;
		padding: 1.1rem 1.2rem;
		background: var(--md-sys-color-surface-container, var(--surface-2));
		border: 1px solid var(--border);
		border-radius: 14px;
	}
	.week-head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-bottom: 0.5rem;
	}
	.week-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--md-sys-color-secondary, var(--muted-fg));
		margin: 0;
	}
	.due-pill {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.7rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}
	.week-headline {
		font-family: 'Avara', serif;
		font-size: 1.1rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0 0 0.3rem;
	}
	.week-topic-preview {
		font-size: 0.82rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		font-style: italic;
		margin: 0 0 0.75rem;
	}
	.item-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.item-row {
		display: grid;
		grid-template-columns: 22px 1fr auto auto;
		align-items: center;
		gap: 0.55rem;
		padding: 0.4rem 0.6rem;
		background: var(--paper);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 0.88rem;
		color: var(--ink);
	}
	.item-row.done .item-label { color: var(--muted-fg); text-decoration: line-through; text-decoration-thickness: 1px; }
	.item-bullet {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--md-sys-color-secondary, var(--muted-fg));
	}
	.item-row.done .item-bullet { color: var(--md-sys-color-primary, var(--accent)); }
	.item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-tag {
		font-size: 0.68rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		background: color-mix(in srgb, var(--md-sys-color-secondary, var(--accent)) 12%, transparent);
		padding: 0.08rem 0.45rem;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.item-count {
		font-size: 0.72rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: var(--muted-fg);
	}
	.item-count.positive {
		color: var(--md-sys-color-primary, var(--accent));
		font-weight: 600;
	}
	.empty.small { font-size: 0.82rem; padding: 0.35rem 0; }

	/* Old assignments-render leftovers — kept so file uploads + the
	   legacy form actions still resolve their CSS, but no longer
	   rendered by the Roadmap. */
	.assignment-list { display: flex; flex-direction: column; gap: 0.75rem; }

	.assignment-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 10px;
		padding: 1rem 1.1rem;
	}

	.card-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.assignment-body { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; }
	.assignment-title { font-weight: 600; font-size: 0.95rem; margin: 0; }
	.assignment-desc { font-size: 0.875rem; color: var(--muted-fg); margin: 0; white-space: pre-wrap; }
	.due { font-size: 0.8rem; color: var(--muted-fg); margin: 0; }

	.accepted-note {
		font-size: 0.78rem;
		color: var(--muted-fg);
		margin: 0;
		border-top: 1px solid var(--surface-2);
		padding-top: 0.5rem;
	}

	.my-submission {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
	}
	.submitted-label {
		background: #e8f5e9;
		color: #2e7d32;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}
	.my-submission a { color: var(--ink); font-size: 0.85rem; }

	.submit-form-wrap { display: flex; flex-direction: column; gap: 0.5rem; }

	.type-tabs { display: flex; gap: 0.4rem; }
	.type-tab {
		padding: 0.3rem 0.7rem;
		border: 1.5px solid var(--border);
		border-radius: 6px;
		background: none;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--muted-fg);
		cursor: pointer;
		transition: all 0.15s;
	}
	.type-tab.active { border-color: var(--ink); color: var(--ink); }
	.type-tab:hover { border-color: var(--ink); color: var(--ink); }

	.submit-actions { display: flex; align-items: center; gap: 0.25rem; }

	.submissions-section {
		border-top: 1px solid var(--surface-2);
		padding-top: 0.6rem;
	}
	.submissions-header {
		font-size: 0.78rem;
		color: var(--muted-fg);
		font-weight: 600;
		margin: 0 0 0.4rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.submissions-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.submission-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
	}
	.sub-student { font-weight: 500; flex: 1; }
	.sub-type {
		font-size: 0.75rem;
		color: var(--muted-fg);
		background: var(--surface-2);
		padding: 0.1rem 0.45rem;
		border-radius: 99px;
	}
	.sub-link { color: var(--ink); font-size: 0.82rem; }

	.empty { color: var(--muted-fg); font-size: 0.9rem; }

	/* ── Section labels (Files) ── */
	.section-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted-fg);
		margin: 0 0 0.6rem;
	}

	/* ── Empty state ── */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 4rem 1rem;
		color: var(--muted-fg);
		gap: 0.75rem;
	}
	.empty-icon {
		color: var(--border);
		margin-bottom: 0.5rem;
	}
	.empty-state h2 {
		font-family: 'Avara', serif;
		font-size: 1.3rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0;
	}
	.empty-state p {
		font-size: 0.9rem;
		max-width: 340px;
		line-height: 1.5;
		margin: 0;
	}

	/* ── Starred messages ── */
	.starred-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 2rem; }
	.starred-card {
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.35rem;
	}
	.starred-meta { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: var(--muted-fg); flex-wrap: wrap; }
	.starred-author { font-weight: 600; color: var(--ink); }
	.starred-conv { font-weight: 500; }
	.starred-content { font-size: 0.875rem; color: var(--ink); margin: 0; white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
	.starred-att {
		display: inline-flex; align-items: center; gap: 0.35rem;
		font-size: 0.78rem; color: var(--ink); text-decoration: underline;
		text-underline-offset: 2px; opacity: 0.7;
	}
	.starred-att:hover { opacity: 1; }

	/* ── Link chips ── */
	.links-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Wraps the chip + instructor-only delete button so they read as
	   one row. The button sits flush to the chip's right edge with a
	   slim gap. */
	.chip-with-actions {
		display: flex;
		align-items: stretch;
		gap: 0.35rem;
	}
	.chip-with-actions .link-chip { flex: 1; min-width: 0; }
	.chip-delete-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		flex-shrink: 0;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 12px;
		color: var(--md-sys-color-error, var(--danger));
		cursor: pointer;
		transition: background 140ms ease, border-color 140ms ease;
	}
	.chip-delete-btn:hover {
		background: color-mix(in srgb, var(--md-sys-color-error, var(--danger)) 12%, transparent);
		border-color: var(--md-sys-color-error, var(--danger));
	}

	.link-chip {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem 1rem;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 12px;
		text-decoration: none;
		color: var(--ink);
		transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
		min-width: 0;
		overflow: hidden;
		width: 100%;
		box-sizing: border-box;
	}
	.link-chip:hover {
		border-color: var(--muted-fg);
		background: var(--surface-2);
		box-shadow: 0 2px 8px rgba(0,0,0,0.06);
	}

	.chip-favicon {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.chip-favicon img {
		width: 16px;
		height: 16px;
		border-radius: 3px;
	}

	.chip-body {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.chip-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip-meta {
		font-size: 0.72rem;
		color: var(--muted-fg);
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip-domain { font-weight: 600; color: var(--muted-fg); }
	.chip-channel { color: var(--muted-fg); }
	.chip-dot { opacity: 0.5; }

	.ext-icon {
		flex-shrink: 0;
		color: var(--border);
		transition: color 0.15s;
	}
	.link-chip:hover .ext-icon { color: var(--muted-fg); }

	/* ── Mobile ── */
	@media (max-width: 640px) {
		main {
			padding: 1.25rem 1rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		h1 { font-size: 1.5rem; }
		.page-header { margin-bottom: 1rem; }
		.create-card { padding: 1rem; }
		.form-row { flex-direction: column; gap: 0.5rem; }
		.checkbox-row { flex-wrap: wrap; gap: 0.5rem 1rem; }
		.week-section { margin-bottom: 1.5rem; }
		.card-top { flex-wrap: wrap; gap: 0.5rem; }
		.submission-item { flex-wrap: wrap; gap: 0.35rem; }
		.sub-student { min-width: 100%; }
		.chip-meta { display: none; }
		.chip-title { font-size: 0.875rem; }
		.link-chip { padding: 0.65rem 0.875rem; gap: 0.75rem; }
	}
</style>
