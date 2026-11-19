<script>
	// The teaching archive, shared by the public homepage ("/") and the in-app
	// Archive page (/app/years). Content lives in $lib/archive.js.
	//
	// Each year is a spine down the left edge, set in one face from the old
	// landing page's type cast; pointing at a spine swaps it to another face
	// (the same hard swap the font field used to do).
	import { archive, PEOPLE_GROUPS, person } from '$lib/archive.js';

	const CAST = [
		{ css: '"Avara", "Old English Text MT", serif', scale: 1.3, weight: 700 },
		{ css: '"Playfair Display", Georgia, serif', scale: 1.2, weight: 800 },
		{ css: '"Bungee", Impact, sans-serif', scale: 0.9, weight: 400 },
		{ css: '"Rye", Georgia, serif', scale: 1.05, weight: 400 },
		{ css: '"UnifrakturCook", "Old English Text MT", serif', scale: 1.3, weight: 700 },
		{ css: '"Monoton", sans-serif', scale: 1.0, weight: 400 },
		{ css: '"Pacifico", "Brush Script MT", cursive', scale: 1.0, weight: 400 },
		{ css: '"Space Grotesk", Arial, sans-serif', scale: 1.1, weight: 600 },
		{ css: '"Caveat", "Comic Sans MS", cursive', scale: 1.5, weight: 700 },
		{ css: '"Silkscreen", "Press Start 2P", monospace', scale: 0.95, weight: 400 },
		{ css: '"Press Start 2P", monospace', scale: 0.75, weight: 400 },
		{ css: '"Space Mono", ui-monospace, monospace', scale: 1.0, weight: 700 }
	];

	const years = archive.years;
	// Newest year opens in Avara; the rest step through the cast so
	// neighbouring spines never share a face.
	let faces = $state(years.map((_, i) => (i * 5) % CAST.length));

	function swap(i) {
		let next = faces[i];
		while (next === faces[i]) next = (Math.random() * CAST.length) | 0;
		faces[i] = next;
	}

	const isCurrent = (y) => y.courses.some((c) => c.current);
	const external = (url) => /^https?:\/\//.test(url);
</script>

{#snippet link(url, label)}
	<a href={url} target={external(url) ? '_blank' : null} rel={external(url) ? 'noopener noreferrer' : null}>{label}</a>
{/snippet}

<div class="archive">
	<header class="intro">
		<h1>{archive.owner}</h1>
		<p>{archive.intro}</p>
		{#if years.length > 1}
			<nav class="year-index" aria-label="Years">
				{#each years as y}
					<a href="#y{y.year}">{y.year}</a>
				{/each}
			</nav>
		{/if}
	</header>

	{#each years as y, i (y.year)}
		{@const face = CAST[faces[i]]}
		<section class="year" id="y{y.year}" aria-labelledby="yh-{y.year}">
			<div class="spine-col">
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<h2
					class="spine"
					class:current={isCurrent(y)}
					id="yh-{y.year}"
					style:font-family={face.css}
					style:font-weight={face.weight}
					style:--face-scale={face.scale}
					onpointerenter={() => swap(i)}
				>{y.year}</h2>
			</div>

			<div class="courses">
				{#each y.courses as c}
					<article class="course">
						<header class="course-head">
							<h3>{c.title}</h3>
							<p class="when">
								{c.term}{#if c.school}, {c.school}{/if}
								{#if c.current}<span class="in-session">In session</span>{/if}
							</p>
							{#if c.description}<p class="desc">{c.description}</p>{/if}
						</header>

						<div class="record">
							{#if c.highlights?.length}
								<div class="field">
									<h4>Selected work</h4>
									<ul class="highlights">
										{#each c.highlights as h}
											<li>
												<span class="h-title">{#if h.url}{@render link(h.url, h.title)}{:else}{h.title}{/if}</span>
												<span class="h-by">{h.by.join(' and ')}</span>
												<span class="h-about">{h.about}</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if c.materials?.length}
								<div class="field">
									<h4>Materials</h4>
									<ul class="materials">
										{#each c.materials as m}
											<li>
												{@render link(m.url, m.label)}
												{#if m.note}<span class="note">{m.note}</span>{/if}
											</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if c.lectures?.length}
								<div class="field">
									<h4>Lectures</h4>
									<ol class="lectures">
										{#each c.lectures as l}
											<li>
												<span class="week">Week {l.week}</span>
												<span class="lecture">
													{#if l.url}{@render link(l.url, l.title)}{:else}<span>{l.title}</span>{/if}
													{#if l.homework}<span class="note">Homework: {l.homework}</span>{/if}
												</span>
											</li>
										{/each}
									</ol>
								</div>
							{/if}

							{#each PEOPLE_GROUPS as g}
								{@const list = (c[g.key] ?? []).map(person)}
								{#if list.length}
									<div class="field">
										<h4>{list.length === 1 ? g.one : g.many}{#if list.length > 1}<span class="count">{list.length}</span>{/if}</h4>
										<ul class="names" class:detailed={list.some((p) => p.note || p.work?.length)}>
											{#each list as p}
												<li>
													{#if p.url}{@render link(p.url, p.name)}{:else}<span class="name">{p.name}</span>{/if}
													{#if p.note}<span class="note">{p.note}</span>{/if}
													{#if p.work?.length}
														<span class="work-items">
															{#each p.work as it, j}{@render link(it.url, it.label)}{#if j < p.work.length - 1}{', '}{/if}{/each}
														</span>
													{/if}
												</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if g.key === 'students' && c.work?.length}
									<div class="field">
										<h4>All student work</h4>
										<ul class="work">
											{#each c.work as w}
												<li>
													<span class="work-name">{w.name}</span>
													<span class="work-items">
														{#each w.items as it, j}{@render link(it.url, it.label)}{#if j < w.items.length - 1}{', '}{/if}{/each}
													</span>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
							{/each}
						</div>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.archive {
		--spine-size: clamp(4rem, 7vw, 6rem);
		max-width: 64rem;
		margin: 0 auto;
		padding: 0 1rem 6rem;
		color: var(--ink);
	}

	/* ── Intro ─────────────────────────────────────────────── */
	.intro {
		padding: 2.5rem 0 3rem;
		max-width: 40rem;
	}
	.intro h1 {
		font-size: clamp(1.9rem, 4.2vw, 2.6rem);
		font-weight: 600;
		letter-spacing: -0.015em;
		line-height: 1.1;
		margin: 0 0 0.75rem;
	}
	.intro p {
		font-size: 1.08rem;
		line-height: 1.55;
		color: var(--muted-fg);
		margin: 0;
		max-width: 34em;
	}
	.year-index {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.1rem;
		margin-top: 1.5rem;
		font-weight: 600;
	}
	.year-index a { color: var(--ink); text-underline-offset: 0.2em; }
	.year-index a:hover { color: var(--accent); }

	/* ── Year: a spine on the left, the record on the right ── */
	.year {
		display: grid;
		grid-template-columns: calc(var(--spine-size) * 1.25) minmax(0, 1fr);
		column-gap: clamp(1.5rem, 4vw, 3.5rem);
		border-top: 1px solid var(--border);
		padding: 2.5rem 0 3.5rem;
		scroll-margin-top: var(--archive-top, 1rem);
	}
	.spine-col { position: relative; }
	.spine {
		position: sticky;
		top: var(--archive-top, 1rem);
		margin: 0;
		writing-mode: vertical-rl;
		/* Line height stays fixed while the face (and its size) swaps, so the
		   column never jumps when you point at it. */
		font-size: calc(var(--spine-size) * var(--face-scale, 1));
		line-height: var(--spine-size);
		width: var(--spine-size);
		letter-spacing: 0.02em;
		font-variant-numeric: lining-nums;
		color: var(--ink);
		cursor: default;
		user-select: none;
	}
	.spine.current { color: var(--accent); }

	/* ── Course ───────────────────────────────────────────── */
	.course + .course {
		margin-top: 3rem;
		padding-top: 2.5rem;
		border-top: 1px dashed var(--border);
	}
	.course-head { margin-bottom: 1.75rem; }
	.course-head h3 {
		font-size: clamp(1.4rem, 2.6vw, 1.75rem);
		font-weight: 600;
		letter-spacing: -0.01em;
		line-height: 1.2;
		margin: 0 0 0.3rem;
	}
	.when {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.75rem;
		margin: 0;
		color: var(--muted-fg);
		font-size: 1rem;
	}
	.in-session {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--accent);
		border: 1.5px solid currentColor;
		border-radius: 999px;
		padding: 0.05rem 0.55rem;
	}
	.desc {
		margin: 0.85rem 0 0;
		line-height: 1.6;
		max-width: 36em;
	}

	/* A catalogue record: field name on the left, entries on the right. */
	.field {
		display: grid;
		grid-template-columns: 11rem minmax(0, 1fr);
		column-gap: 1.5rem;
		padding: 0.9rem 0;
		border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
	}
	.field:first-child { border-top: 0; padding-top: 0; }
	.field h4 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.5;
	}
	.count {
		margin-left: 0.45em;
		font-weight: 400;
		color: var(--muted-fg);
		font-variant-numeric: tabular-nums;
	}
	ul { list-style: none; margin: 0; padding: 0; }

	.names {
		columns: 12rem auto;
		column-gap: 1.5rem;
		line-height: 1.5;
	}
	.names li { break-inside: avoid; }
	.names.detailed { columns: auto; }
	.names.detailed li + li,
	.materials li + li { margin-top: 0.45rem; }

	.materials { line-height: 1.5; }

	/* Selected work: title, who made it, what it does. */
	.highlights {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 1.4rem 2rem;
	}
	.highlights li { line-height: 1.45; }
	.h-title {
		display: block;
		font-size: 1.05rem;
		font-weight: 600;
	}
	.h-by {
		display: block;
		font-size: 0.88rem;
		color: var(--muted-fg);
		margin-bottom: 0.25rem;
	}
	.h-about {
		display: block;
		font-size: 0.95rem;
		max-width: 32em;
	}

	/* Lectures are a sequence, so the week number leads each row. */
	.lectures {
		list-style: none;
		margin: 0;
		padding: 0;
		line-height: 1.5;
	}
	.lectures li {
		display: grid;
		grid-template-columns: 4.75rem minmax(0, 1fr);
		column-gap: 0.75rem;
	}
	.lectures li + li { margin-top: 0.45rem; }
	.lecture { display: block; }
	.week {
		color: var(--muted-fg);
		font-variant-numeric: tabular-nums;
	}

	.work { line-height: 1.5; }
	.work li + li { margin-top: 0.7rem; }
	.work-name { display: block; font-weight: 600; }
	.work-items { display: block; }
	.note {
		display: block;
		font-size: 0.88rem;
		color: var(--muted-fg);
	}
	.record a {
		color: var(--ink);
		text-decoration-color: color-mix(in srgb, var(--accent) 70%, transparent);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 0.18em;
	}
	.record a:hover { color: var(--accent); }
	a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* ── Narrow screens: spine lies down above the record ─── */
	@media (max-width: 720px) {
		.archive { --spine-size: 3.25rem; }
		.intro { padding: 1.75rem 0 2.25rem; }
		.year {
			grid-template-columns: minmax(0, 1fr);
			padding: 1.75rem 0 2.5rem;
		}
		.spine {
			position: static;
			writing-mode: horizontal-tb;
			width: auto;
			margin-bottom: 1rem;
		}
		.field {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 0.35rem;
		}
		.names { columns: 2; }
	}
</style>
