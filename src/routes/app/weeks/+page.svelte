<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';

	let { data } = $props();
	const { contentHtml } = createContentRenderer();

	onMount(() => pageTitle.set('Weeks'));
	onDestroy(() => pageTitle.set(null));

	// Scan rendered content for `.tg-emoji` / `.tgc-emoji` spans and
	// drop in static-frame <img>s. Chat surfaces run a full Lottie
	// pipeline; outside of chat we just want the rest-pose image so
	// emote tokens in headlines / topic previews / rail tooltips
	// don't render as empty boxes.
	let pageEl = $state(null);
	$effect(() => {
		// Re-read the bits of `data` that drive headline / tooltip
		// content so this effect re-runs after each navigation.
		void data.allWeeks;
		void data.pastPlans;
		void data.futurePlans;
		if (!pageEl) return;
		tick().then(() => mountStaticEmotes(pageEl));
	});

	const isInstructor = $derived(data.session?.user?.role === 'instructor');

	// Position summary. `currentPlan` may be null (no plans yet); guard
	// every downstream calc.
	const currentWeek = $derived(data.currentPlan?.week ?? null);
	const pastCount = $derived(data.pastPlans?.length ?? 0);
	const futureCount = $derived(data.futurePlans?.length ?? 0);
	const totalCount = $derived(pastCount + (data.currentPlan ? 1 : 0) + futureCount);
	const positionIndex = $derived(data.currentPlan ? pastCount + 1 : null);
	// Ordered list of week summaries — feeds the per-week dots on the
	// progress rail. Each entry knows whether it's past / current /
	// future and whether the instructor flagged it as a milestone.
	const allWeeks = $derived(data.allWeeks ?? []);
	const currentIndex = $derived(
		data.currentPlan ? allWeeks.findIndex((w) => w.id === data.currentPlan.id) : -1
	);
	const progressPct = $derived(
		allWeeks.length > 1 && currentIndex >= 0
			? (currentIndex / (allWeeks.length - 1)) * 100
			: 0
	);

	// Hovered/focused week index — drives the tooltip on the rail. Same
	// state for touch (tap) and pointer (hover) so the UI stays in sync.
	let hoveredIdx = $state(null);
	const hoveredWeek = $derived(
		hoveredIdx != null && allWeeks[hoveredIdx] ? allWeeks[hoveredIdx] : null
	);

	function dotPct(i) {
		if (allWeeks.length <= 1) return 0;
		return (i / (allWeeks.length - 1)) * 100;
	}

	function fmtDate(iso) {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		} catch { return ''; }
	}

	function completionRatio(plan, completions = {}) {
		const items = plan.items ?? [];
		if (!items.length) return null;
		const done = items.filter((it) => completions[it.id]).length;
		return { done, total: items.length };
	}
</script>

<svelte:head><title>Weeks — eating.computer</title></svelte:head>

<main class="weeks-page" bind:this={pageEl}>
	<nav class="crumbs" aria-label="Breadcrumb">
		<a class="crumb" href="/app">Home</a>
		<span class="crumb-sep" aria-hidden="true">›</span>
		<span class="crumb crumb-current" aria-current="page">Weeks</span>
	</nav>

	<!-- ════════ Hero position summary ════════
	     The most important glance — where am I and how much is left.
	     Big stat treatment with a thin progress rail underneath.
	-->
	{#if data.currentPlan}
		<section class="hero" aria-label="Current position">
			<div class="hero-now">
				<span class="hero-eyebrow">Where you are</span>
				<div class="hero-week">
					<span class="hero-week-label">Week</span>
					<span class="hero-week-num">{currentWeek}</span>
				</div>
				<span class="hero-of">of {data.totalWeeks ?? totalCount}</span>
			</div>

			<!-- Progress rail. Each posted week renders as a dot along
			     the rail; "important" weeks (midterms, finals, big crits)
			     get a larger, more prominent dot. Hover (desktop) or tap
			     (mobile) a dot to reveal a tooltip with the week's
			     headline + due date. On desktop the rail is horizontal
			     and stretches the full hero width; on mobile (≤800px)
			     the same rail rotates 90°, becoming a vertical timeline. -->
			<div
				class="rail"
				style:--rail-pct="{progressPct}%"
				role="group"
				aria-label="Week-by-week progress"
				onpointerleave={() => (hoveredIdx = null)}
			>
				<div class="rail-track"></div>
				<div class="rail-fill"></div>
				{#each allWeeks as w, i (w.id)}
					<button
						type="button"
						class="rail-dot"
						class:past={w.isPast}
						class:current={w.isCurrent}
						class:future={!w.isPast && !w.isCurrent}
						class:unpublished={w.published === false}
						class:important={w.important}
						class:hovered={hoveredIdx === i}
						style:--dot-pct="{dotPct(i)}%"
						onpointerenter={() => (hoveredIdx = i)}
						onfocus={() => (hoveredIdx = i)}
						onblur={() => (hoveredIdx = null)}
						onclick={() => (hoveredIdx = hoveredIdx === i ? null : i)}
						aria-label="Week {w.week}{w.important ? ' (important)' : ''} — {w.headline}"
					>
						<span class="rail-dot-inner"></span>
					</button>
				{/each}

				{#if hoveredWeek}
					<div
						class="rail-tip"
						class:important={hoveredWeek.important}
						style:--dot-pct="{dotPct(hoveredIdx)}%"
						role="tooltip"
					>
						<span class="rail-tip-eyebrow">
							Week {hoveredWeek.week}
							{#if hoveredWeek.important}
								<span class="rail-tip-badge"><span class="msi msi-14 msi-fill">star</span> important</span>
							{/if}
							{#if hoveredWeek.isCurrent}<span class="rail-tip-badge current">now</span>{/if}
						</span>
						<span class="rail-tip-headline">{@html contentHtml(hoveredWeek.headline, false)}</span>
						{#if hoveredWeek.published !== false && hoveredWeek.sylTitle}
							<span class="rail-tip-syl">From {hoveredWeek.sylWeekOf ? new Date(...hoveredWeek.sylWeekOf.split('-').map((v, i) => i === 1 ? v - 1 : +v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' : ''}{hoveredWeek.sylTitle}</span>
						{/if}
						{#if hoveredWeek.published === false}
							<span class="rail-tip-due">Not posted yet{hoveredWeek.sylWeekOf ? ` · ${new Date(...hoveredWeek.sylWeekOf.split('-').map((v, i) => i === 1 ? v - 1 : +v)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
						{:else if hoveredWeek.dueDate}
							<span class="rail-tip-due">
								{hoveredWeek.isPast ? 'Was due ' : 'Due '}{fmtDate(hoveredWeek.dueDate)}
							</span>
						{/if}
					</div>
				{/if}
			</div>

			<a class="hero-now-link" href="/app">
				<span class="msi msi-18 msi-fill">target</span>
				Jump to current week
				<span class="msi msi-18">arrow_forward</span>
			</a>
		</section>
	{:else}
		<header class="page-header">
			<h1>No weeks yet</h1>
			<p class="subtitle">Your instructor hasn't posted any assignments yet. Check back soon.</p>
		</header>
	{/if}

	<!-- ════════ Lists ════════ -->
	{#if totalCount > 0}
		<div class="cols">
			<!-- ── Past ───────────────────────────── -->
			<section class="col">
				<header class="col-head">
					<h2 class="col-title">
						<span class="msi msi-18 msi-fill col-icon">history</span>
						Past
					</h2>
					<span class="col-count">{pastCount}</span>
				</header>
				{#if pastCount === 0}
					<p class="empty">No past weeks yet.</p>
				{:else}
					<ul class="plan-list">
						{#each data.pastPlans as p (p.id)}
							{@const ratio = isInstructor ? null : completionRatio(p, data.completionsByPlan[p.id] ?? {})}
							<li class="plan-card past">
								<div class="plan-meta">
									<span class="week-num">Week {p.week}</span>
									{#if p.dueDate}<span class="due past-due">Was due {fmtDate(p.dueDate)}</span>{/if}
								</div>
								<h3 class="plan-headline">{@html contentHtml(p.headline, false)}</h3>
								{#if p.topicPreview}
									<p class="plan-preview">{@html contentHtml(p.topicPreview, false)}</p>
								{/if}
								{#if ratio}
									<div class="plan-ratio-row">
										<div class="ratio-bar">
											<div class="ratio-bar-fill" style:width="{(ratio.done / ratio.total) * 100}%"></div>
										</div>
										<span class="ratio-label" class:complete={ratio.done === ratio.total}>
											{ratio.done}/{ratio.total} done
										</span>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Up next ────────────────────────── -->
			<section class="col">
				<header class="col-head">
					<h2 class="col-title">
						<span class="msi msi-18 msi-fill col-icon">arrow_forward</span>
						Up next
					</h2>
					<span class="col-count">{futureCount}</span>
				</header>
				{#if futureCount === 0}
					<p class="empty">Nothing queued ahead yet.</p>
				{:else}
					<ul class="plan-list">
						{#each data.futurePlans as p (p.id)}
							<li class="plan-card future">
								<div class="plan-meta">
									<span class="week-num">Week {p.week}</span>
									{#if p.dueDate}<span class="due">Due {fmtDate(p.dueDate)}</span>{/if}
								</div>
								<h3 class="plan-headline">{@html contentHtml(p.headline, false)}</h3>
								{#if p.topicPreview}
									<p class="plan-preview">{@html contentHtml(p.topicPreview, false)}</p>
								{/if}
								{#if (p.items ?? []).length}
									<p class="plan-count">{p.items.length} item{p.items.length === 1 ? '' : 's'}</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{/if}
</main>

<style>
	.weeks-page {
		min-height: 100dvh;
		background: var(--paper);
		padding: calc(2rem + var(--header-h, 52px)) 2rem 4rem;
		max-width: 1120px;
		margin: 0 auto;
		box-sizing: border-box;
	}

	/* ── Breadcrumbs ───────────────────────────── */
	.crumbs {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--muted-fg);
		margin-bottom: 0.6rem;
	}
	.crumb {
		color: var(--muted-fg);
		text-decoration: none;
		padding: 0.15rem 0.4rem;
		border-radius: 6px;
		transition: background 120ms ease, color 120ms ease;
	}
	.crumb:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
	.crumb-current { color: var(--ink); font-weight: 600; }
	.crumb-sep { color: var(--muted-fg); }

	/* ── Hero ──────────────────────────────────── */
	.hero {
		position: relative;
		background: var(--md-sys-color-surface-container, var(--surface-2));
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 24px;
		padding: 2.2rem 2.4rem;
		margin-bottom: 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* "Where you are" block */
	.hero-now {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	.hero-eyebrow {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}
	.hero-week {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
	}
	.hero-week-label {
		font-family: 'Avara', serif;
		font-size: 1.4rem;
		font-weight: 400;
		color: var(--muted-fg);
	}
	.hero-week-num {
		font-family: 'Avara', serif;
		font-size: 4rem;
		font-weight: 900;
		line-height: 1;
		color: var(--ink);
		margin-top: 0.1rem;
		letter-spacing: -0.02em;
	}
	.hero-of {
		font-size: 0.85rem;
		color: var(--muted-fg);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}

	/* ── Rail ───────────────────────────────────
	   Desktop: full-width horizontal rail with one dot per posted
	   week. Important weeks render bigger so milestones jump out.
	   Hovering a dot reveals an absolute-positioned tooltip with the
	   week's headline + due date. The rail leaves vertical breathing
	   room so the dots (especially the bigger important ones) and
	   the tooltip don't crash into the surrounding content. */
	.rail {
		position: relative;
		width: 100%;
		height: 60px;
		--rail-pct: 0%;
	}
	.rail-track {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 6px;
		transform: translateY(-50%);
		background: color-mix(in srgb, var(--ink) 9%, transparent);
		border-radius: 999px;
	}
	.rail-fill {
		position: absolute;
		top: 50%;
		left: 0;
		height: 6px;
		width: var(--rail-pct);
		transform: translateY(-50%);
		background: var(--md-sys-color-primary, var(--accent));
		border-radius: 999px;
		transition: width 360ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.rail-dot {
		position: absolute;
		top: 50%;
		left: var(--dot-pct);
		transform: translate(-50%, -50%);
		width: 14px;
		height: 14px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		cursor: pointer;
		outline: none;
		transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.rail-dot::after {
		/* Larger invisible hit target so the dots are easy to grab on
		   touch + tight mouse motion. */
		content: '';
		position: absolute;
		inset: -10px;
	}
	.rail-dot-inner {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: var(--paper);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ink) 20%, transparent);
		transition: box-shadow 160ms ease, background 160ms ease, transform 160ms ease;
	}
	.rail-dot.past .rail-dot-inner {
		background: var(--md-sys-color-primary, var(--accent));
		box-shadow: 0 0 0 2px var(--md-sys-color-primary, var(--accent));
	}
	.rail-dot.future .rail-dot-inner {
		background: var(--paper);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ink) 22%, transparent);
	}
	/* Weeks the syllabus lists but the instructor hasn't posted yet — fainter
	   so the rail reads as "posted so far" vs "still to come". */
	.rail-dot.unpublished .rail-dot-inner {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--ink) 11%, transparent);
	}
	.rail-dot.unpublished { opacity: 0.7; }
	.rail-dot.current {
		width: 22px;
		height: 22px;
		z-index: 2;
	}
	.rail-dot.current .rail-dot-inner {
		background: var(--paper);
		box-shadow:
			0 0 0 3px var(--md-sys-color-primary, var(--accent)),
			0 2px 10px color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 40%, transparent);
		position: relative;
	}
	.rail-dot.current .rail-dot-inner::after {
		content: '';
		position: absolute;
		inset: 4px;
		border-radius: 50%;
		background: var(--md-sys-color-primary, var(--accent));
	}
	/* Important weeks get a beefier dot so milestones (midterm, final,
	   big crit) read at a glance. Past-important = filled secondary;
	   future-important = ringed secondary; current-important keeps the
	   primary-ringed marker and adds a secondary halo. */
	.rail-dot.important {
		width: 20px;
		height: 20px;
		z-index: 1;
	}
	.rail-dot.important .rail-dot-inner {
		box-shadow: 0 0 0 3px var(--md-sys-color-secondary, var(--md-sys-color-primary, var(--accent)));
	}
	.rail-dot.important.past .rail-dot-inner {
		background: var(--md-sys-color-secondary, var(--md-sys-color-primary, var(--accent)));
	}
	.rail-dot.important.future .rail-dot-inner {
		background: var(--paper);
	}
	.rail-dot.important.current {
		width: 26px;
		height: 26px;
	}
	.rail-dot.important.current .rail-dot-inner {
		box-shadow:
			0 0 0 3px var(--md-sys-color-primary, var(--accent)),
			0 0 0 6px color-mix(in srgb, var(--md-sys-color-secondary, var(--md-sys-color-primary, var(--accent))) 55%, transparent),
			0 4px 14px color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 40%, transparent);
	}

	.rail-dot:hover,
	.rail-dot.hovered,
	.rail-dot:focus-visible {
		transform: translate(-50%, -50%) scale(1.18);
	}

	/* Tooltip — anchored to the same percentage as the dot it
	   describes. Sits above the rail on desktop; flips below on
	   mobile (vertical rail) so it doesn't overflow the card edge. */
	.rail-tip {
		position: absolute;
		bottom: calc(100% + 14px);
		left: var(--dot-pct);
		transform: translateX(-50%);
		min-width: 200px;
		max-width: 260px;
		padding: 0.6rem 0.8rem;
		background: var(--md-sys-color-inverse-surface, var(--ink));
		color: var(--md-sys-color-inverse-on-surface, var(--paper));
		border-radius: 10px;
		font-size: 0.78rem;
		line-height: 1.35;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		pointer-events: none;
		z-index: 5;
	}
	.rail-tip::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 6px solid transparent;
		border-top-color: var(--md-sys-color-inverse-surface, var(--ink));
	}
	.rail-tip-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.75;
	}
	.rail-tip-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.6rem;
		background: color-mix(in srgb, var(--md-sys-color-secondary, var(--accent)) 40%, transparent);
		color: var(--md-sys-color-inverse-on-surface, var(--paper));
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.rail-tip-badge.current {
		background: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 55%, transparent);
	}
	.rail-tip-headline { font-family: 'Avara', serif; font-size: 0.95rem; line-height: 1.25; }
	.rail-tip-syl { display: block; font-size: 0.78rem; color: var(--muted-fg); margin-top: 0.15rem; }
	.rail-tip-due {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		opacity: 0.7;
	}

	/* "Jump to current week" CTA */
	.hero-now-link {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin-top: 1.5rem;
		padding: 0.55rem 1rem 0.55rem 0.85rem;
		background: var(--md-sys-color-primary, var(--accent));
		color: var(--md-sys-color-on-primary, var(--paper));
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: none;
		border-radius: 999px;
		transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
		position: relative;
	}
	.hero-now-link:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 16px color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 35%, transparent);
	}

	/* ── Empty / no-current header ──────────────── */
	.page-header { margin-bottom: 2rem; }
	h1 {
		font-family: 'Avara', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 0.35rem;
		color: var(--ink);
	}
	.subtitle {
		font-size: 0.92rem;
		color: var(--muted-fg);
		margin: 0;
	}

	/* ── Columns ──────────────────────────────── */
	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
	}

	.col-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.85rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--md-sys-color-outline-variant, var(--border));
	}
	.col-title {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-family: 'Avara', serif;
		font-size: 1.05rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0;
	}
	.col-icon { color: var(--md-sys-color-secondary, var(--accent)); }
	.col-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		color: var(--muted-fg);
		margin-left: auto;
	}

	.empty {
		font-size: 0.85rem;
		color: var(--muted-fg);
		margin: 0;
		font-style: italic;
		padding: 0.5rem 0;
	}

	/* ── Plan cards ───────────────────────────── */
	.plan-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.65rem; }
	.plan-card {
		background: var(--paper);
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 14px;
		padding: 1rem 1.1rem;
		transition: transform 140ms ease, border-color 140ms ease;
	}
	.plan-card:hover {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, var(--md-sys-color-primary, var(--accent)) 50%, var(--border));
	}
	.plan-card.future {
		border-left: 3px solid var(--md-sys-color-tertiary, var(--accent));
		border-top-left-radius: 6px;
		border-bottom-left-radius: 6px;
	}
	.plan-card.past {
		opacity: 0.96;
	}

	.plan-meta {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted-fg);
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}
	.week-num {
		font-weight: 700;
		color: var(--md-sys-color-secondary, var(--ink));
	}
	.due, .past-due { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.68rem; }

	.plan-headline {
		font-family: 'Avara', serif;
		font-size: 1.1rem;
		font-weight: 400;
		color: var(--ink);
		margin: 0 0 0.35rem;
		line-height: 1.25;
	}
	.plan-preview {
		font-size: 0.86rem;
		color: var(--muted-fg);
		margin: 0;
		line-height: 1.45;
	}
	.plan-count {
		font-size: 0.7rem;
		color: var(--muted-fg);
		margin: 0.5rem 0 0;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.plan-ratio-row {
		margin-top: 0.7rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ratio-bar {
		flex: 1;
		height: 4px;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		border-radius: 999px;
		overflow: hidden;
	}
	.ratio-bar-fill {
		height: 100%;
		background: var(--md-sys-color-primary, var(--accent));
		border-radius: 999px;
		transition: width 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.ratio-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.7rem;
		color: var(--muted-fg);
		flex-shrink: 0;
	}
	.ratio-label.complete {
		color: var(--md-sys-color-primary, var(--accent));
		font-weight: 600;
	}

	/* ── Responsive ───────────────────────────── */
	@media (max-width: 800px) {
		.weeks-page {
			padding: calc(0.75rem + var(--header-h, 52px)) 1rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		/* Redundant on a phone — the header already says "Weeks" and the bottom
		   nav has Home. Dropping it pulls the card up and kills the top gap. */
		.crumbs { display: none; }
		/* Keep the clean STACKED card on mobile — eyebrow → big Week N →
		   horizontal rail → CTA. (The old design flipped to a row with the
		   rail pinned to the far-right edge and the button floated absolutely
		   at the bottom, which left an awkward gap and read wonky.) */
		.hero {
			padding: 1.4rem 1.4rem;
			border-radius: 18px;
			gap: 1.2rem;
			margin-bottom: 1.25rem;
		}
		.cols { margin-top: 0; }
		.hero-week-num { font-size: 3.4rem; }
		.hero-now-link { margin-top: 0.25rem; align-self: flex-start; }
		.cols { grid-template-columns: 1fr; gap: 1rem; }
		h1 { font-size: 1.5rem; }
	}
</style>
