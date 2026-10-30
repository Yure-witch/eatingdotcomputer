<script>
	// One Work Archive, rendered from its manifest.json. Agent-written JSON is
	// untrusted in SHAPE as well as content, so every field goes through the
	// t()/list()/o() guards and is rendered as text (never {@html}).
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';

	let { data } = $props();
	const m = $derived(data.manifest ?? {});
	const sub = $derived(data.submission);

	onMount(() => pageTitle.set('Work Archive'));

	const t = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
	const list = (v) => (Array.isArray(v) ? v : []);
	const o = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
	const words = (v) => list(v).map(t).filter(Boolean);
	const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '—');
	// Only http(s) — a `javascript:` URL in agent-written JSON must never become a live link.
	const safeUrl = (v) => (/^https?:\/\//i.test(t(v)) ? t(v) : '');

	// path → uploaded file
	const files = $derived(new Map(data.assets.map((a) => [a.path, a])));
	const manifestFile = $derived(files.get('manifest.json'));

	/** Normalise an asset reference (string or { path, caption, … }) to a renderable item. */
	function asset(a) {
		const path = (typeof a === 'string' ? a : t(a?.path ?? a?.src)).replace(/^\.\//, '');
		const f = files.get(path);
		if (!f?.url) return null;
		return { path, url: f.url, kind: f.kind, caption: t(a?.caption), alt: t(a?.alt) || t(a?.caption) || path, date: t(a?.date), credit: t(a?.credit), role: t(a?.kind) };
	}
	const assetsOf = (v) => list(v).map(asset).filter(Boolean);

	function fmtDate(iso) {
		if (!iso) return '';
		const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
		return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	const projects = $derived(list(m.projects).filter((p) => p && typeof p === 'object'));
	const ideas = $derived(list(m.ideas).filter((p) => p && typeof p === 'object'));
	const consent = $derived(o(m.consent));
	const student = $derived(o(m.student));
	const overview = $derived(o(m.overview));
	const reflections = $derived(o(m.reflections));

	// Files not shown anywhere above (so nothing uploaded is invisible).
	const shownPaths = $derived.by(() => {
		const s = new Set();
		const take = (v) => assetsOf(v).forEach((a) => s.add(a.path));
		for (const p of projects) {
			take(p.assets);
			take([p.hero_asset]);
			for (const step of list(p.process)) take(step?.assets);
		}
		for (const d of ideas) take(d.assets);
		return s;
	});
	const otherFiles = $derived(data.assets.filter((a) => a.path !== 'manifest.json' && a.uploaded && !shownPaths.has(a.path)));

	let showRaw = $state(false);
	const rawJson = $derived(showRaw ? JSON.stringify(data.manifest, null, 2) : '');
</script>

{#snippet media(a, big = false)}
	<figure class="media" class:big>
		{#if a.kind === 'image'}
			<a href={a.url} target="_blank" rel="noopener"><img src={a.url} alt={a.alt} loading="lazy" /></a>
		{:else if a.kind === 'video'}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video src={a.url} controls preload="metadata" playsinline></video>
		{:else}
			<a class="file-link" href={a.url} target="_blank" rel="noopener">📄 {a.path.split('/').pop()}</a>
		{/if}
		{#if a.caption || a.role || a.date}
			<figcaption>{a.caption}{#if a.role || a.date || a.credit}<span class="dim">{' '}{[a.role, a.date, a.credit && `by ${a.credit}`].filter(Boolean).join(' · ')}</span>{/if}</figcaption>
		{/if}
	</figure>
{/snippet}

{#snippet kv(label, value)}
	{#if t(value)}<div class="kv"><dt>{label}</dt><dd>{t(value)}</dd></div>{/if}
{/snippet}

<div class="archive-shell">
	<main>
		<a class="back" href="/app/archive">← Work Archive</a>

		<header class="head">
			<h1>{t(student.name) || data.owner.name}</h1>
			<p class="meta">
				{[t(student.pronouns), t(student.program), t(student.year)].filter(Boolean).join(' · ')}
			</p>
			<p class="meta dim">
				{#if sub.status === 'complete'}Archived {fmtDate(sub.completedAt)}{:else}<b class="pending">Unfinished upload</b> (started {fmtDate(sub.createdAt)}){/if}
				· {sub.projects} projects · {sub.ideas} ideas · {sub.assets} files
				{#if t(o(m.generator).agent)}{' '}· built by {[t(o(m.generator).agent), t(o(m.generator).model)].filter(Boolean).join(' / ')}{/if}
			</p>
			<div class="consent">
				<span class="chip yes">archive ✓</span>
				<span class="chip" class:yes={consent.use_in_funding_reports === true}>funding reports: {yn(consent.use_in_funding_reports)}</span>
				<span class="chip" class:yes={consent.use_in_public_showcase === true}>public showcase: {yn(consent.use_in_public_showcase)}</span>
				<span class="chip" class:yes={consent.quote_permission === true}>quotes: {yn(consent.quote_permission)}</span>
				<span class="chip">credit as: {t(consent.attribution).replace('_', ' ') || '—'}</span>
				{#if t(consent.confirmed_by_student_at)}<span class="chip">confirmed {fmtDate(t(consent.confirmed_by_student_at))}</span>{/if}
			</div>
			{#if t(consent.notes)}<p class="note">Consent note: {t(consent.notes)}</p>{/if}
			{#if list(student.links).some((l) => safeUrl(o(l).url))}
				<p class="links">{#each list(student.links) as ln}{@const l = o(ln)}{#if safeUrl(l.url)}<a href={safeUrl(l.url)} target="_blank" rel="noopener nofollow">{t(l.label) || 'Link'} ↗</a>{/if}{/each}</p>
			{/if}
			<div class="actions">
				{#if manifestFile?.url}<a class="btn ghost small" href={manifestFile.url} target="_blank" rel="noopener">manifest.json ↗</a>{/if}
				<button class="btn ghost small" onclick={() => (showRaw = !showRaw)}>{showRaw ? 'Hide' : 'Show'} raw JSON</button>
			</div>
			{#if showRaw}<pre class="raw">{rawJson}</pre>{/if}
		</header>

		{#if !data.manifest}
			<p class="err">The manifest couldn't be read from storage.</p>
		{/if}

		{#if t(overview.summary) || t(student.background) || t(overview.growth_narrative)}
			<section class="block">
				<h2>Overview</h2>
				{#if t(overview.summary)}<p class="prose">{t(overview.summary)}</p>{/if}
				{#if words(overview.themes).length}<p class="chips">{#each words(overview.themes) as th}<span class="chip">{th}</span>{/each}</p>{/if}
				<dl>
					{@render kv('Background', student.background)}
					{@render kv('Coding before', o(student.prior_experience).coding)}
					{@render kv('Design before', o(student.prior_experience).design)}
					{@render kv('AI tools before', o(student.prior_experience).ai_tools)}
					{@render kv('Goals for the class', student.goals_for_class)}
					{@render kv('Growth', overview.growth_narrative)}
				</dl>
			</section>
		{/if}

		{#if projects.length}
			<section class="block">
				<h2>Projects ({projects.length})</h2>
				<nav class="toc">
					{#each projects as p, i}<a href="#p-{i}">{t(p.title) || t(p.id)}</a>{/each}
				</nav>
				{#each projects as p, i}
					{@const hero = asset(p.hero_asset) ?? assetsOf(p.assets)[0]}
					{@const ai = o(p.ai_usage)}
					{@const learning = o(p.learning)}
					{@const tech = o(p.technical)}
					{@const out = o(p.outcomes)}
					{@const prov = o(p.provenance)}
					{@const gallery = assetsOf(p.assets).filter((a) => a.path !== hero?.path)}
					<article class="project" id="p-{i}">
						{#if hero}{@render media(hero, true)}{/if}
						<h3>{t(p.title) || t(p.id)}</h3>
						{#if t(p.one_liner)}<p class="one-liner">{t(p.one_liner)}</p>{/if}
						<p class="chips">
							{#if t(p.status)}<span class="chip status">{t(p.status).replace('_', ' ')}</span>{/if}
							{#each words(p.kind) as k}<span class="chip">{k}</span>{/each}
							{#if t(o(p.course_connection).assignment)}<span class="chip">{t(o(p.course_connection).assignment)}</span>{/if}
							{#if o(p.course_connection).self_initiated === true}<span class="chip">self-initiated</span>{/if}
						</p>
						<p class="dim small">
							{[t(o(p.dates).started) && `started ${t(o(p.dates).started)}`, t(o(p.dates).completed) && `completed ${t(o(p.dates).completed)}`, t(o(p.dates).last_worked) && `last worked ${t(o(p.dates).last_worked)}`, typeof p.time_spent_hours === 'number' && `~${p.time_spent_hours} h${t(p.time_spent_basis) ? ` (${t(p.time_spent_basis)})` : ''}`].filter(Boolean).join(' · ')}
						</p>
						{#if t(p.description)}<p class="prose">{t(p.description)}</p>{/if}

						{#if Object.keys(ai).length}
							<h4>AI use</h4>
							{#if list(ai.tools).length}
								<p class="chips">{#each list(ai.tools) as tool}{@const to = typeof tool === 'string' ? { name: tool } : o(tool)}<span class="chip" title={t(to.used_for)}>{t(to.name)}{#if t(to.model)}{' '}· {t(to.model)}{/if}</span>{/each}</p>
							{/if}
							<dl>
								{@render kv('AI did', ai.role_of_ai)}
								{@render kv('Student did', ai.role_of_student)}
								{@render kv('Share AI-generated', ai.share_ai_generated)}
								{@render kv('What worked', ai.what_worked)}
								{@render kv("What didn't", ai.what_didnt)}
								{@render kv('Surprises', ai.surprises)}
							</dl>
							{#each list(ai.tools) as tool}{@const to = o(tool)}{#if t(to.used_for)}<p class="small"><b>{t(to.name)}</b>: {t(to.used_for)}</p>{/if}{/each}
							{#if list(ai.key_prompts).length}
								<ul class="prompts">
									{#each list(ai.key_prompts) as kp}{@const k = o(kp)}
										<li><q>{t(k.prompt)}</q>{#if t(k.outcome)}<span class="dim">{' '}→ {t(k.outcome)}</span>{/if}{#if t(k.date)}{' '}<span class="dim small">({t(k.date)})</span>{/if}</li>
									{/each}
								</ul>
							{/if}
						{/if}

						{#if list(p.process).length}
							<h4>Process</h4>
							<ol class="process">
								{#each list(p.process) as step}{@const s = o(step)}
									<li>
										<p><b>{t(s.title)}</b>{#if t(s.date)}{' '}<span class="dim small">{t(s.date)}</span>{/if}</p>
										{#if t(s.description)}<p class="prose">{t(s.description)}</p>{/if}
										{#if assetsOf(s.assets).length}<div class="grid small-grid">{#each assetsOf(s.assets) as a}{@render media(a)}{/each}</div>{/if}
									</li>
								{/each}
							</ol>
						{/if}

						{#if gallery.length}
							<h4>Images &amp; media ({gallery.length})</h4>
							<div class="grid">{#each gallery as a}{@render media(a)}{/each}</div>
						{/if}

						{#if Object.keys(learning).length}
							<h4>Learning</h4>
							{#if words(learning.skills_gained).length}<p class="chips">{#each words(learning.skills_gained) as s}<span class="chip">{s}</span>{/each}</p>{/if}
							<dl>
								{@render kv('Concepts', words(learning.concepts).join(', '))}
								{@render kv('Challenges', words(learning.challenges).join('; '))}
								{@render kv('Reflection', learning.reflection)}
							</dl>
						{/if}

						{#if list(p.quotes).length}
							{#each list(p.quotes) as qq}{@const q = o(qq)}{#if t(q.text)}<blockquote>“{t(q.text)}”{#if t(q.context)}<cite>{t(q.context)}{#if t(q.source)}{' '}· {t(q.source)}{/if}</cite>{/if}</blockquote>{/if}{/each}
						{/if}

						{#if Object.keys(out).length || Object.keys(tech).length}
							<h4>Outcome &amp; technical</h4>
							<dl>
								{@render kv('Result', out.result)}
								{@render kv('Audience', out.audience)}
								{@render kv('Feedback', out.feedback)}
								{@render kv('Metrics', typeof out.metrics === 'object' && out.metrics ? JSON.stringify(out.metrics) : out.metrics)}
								{@render kv('Languages', words(tech.languages).join(', '))}
								{@render kv('Frameworks', words(tech.frameworks).join(', '))}
								{@render kv('APIs', words(tech.apis).join(', '))}
								{@render kv('Hosting', tech.hosting)}
								{@render kv('Commits', tech.commits)}
								{@render kv('Lines of code', tech.lines_of_code)}
							</dl>
						{/if}

						{#if list(p.links).length || safeUrl(tech.live_url) || safeUrl(tech.repo_url)}
							<p class="links">
								{#if safeUrl(tech.live_url)}<a href={safeUrl(tech.live_url)} target="_blank" rel="noopener nofollow">Live ↗</a>{/if}
								{#if safeUrl(tech.repo_url)}<a href={safeUrl(tech.repo_url)} target="_blank" rel="noopener nofollow">Repo ↗</a>{/if}
								{#each list(p.links) as ln}{@const l = o(ln)}{#if safeUrl(l.url)}<a href={safeUrl(l.url)} target="_blank" rel="noopener nofollow">{t(l.label) || t(l.kind) || 'Link'} ↗</a>{/if}{/each}
							</p>
						{/if}

						{#if words(prov.sources).length || t(prov.confidence)}
							<details class="prov">
								<summary>Sources{#if t(prov.confidence)}{' '}· confidence {t(prov.confidence)}{/if}</summary>
								<ul>{#each words(prov.sources) as s}<li>{s}</li>{/each}</ul>
								{#if t(prov.notes)}<p class="small">{t(prov.notes)}</p>{/if}
							</details>
						{/if}
					</article>
				{/each}
			</section>
		{/if}

		{#if ideas.length}
			<section class="block">
				<h2>Ideas ({ideas.length})</h2>
				<div class="ideas">
					{#each ideas as d}
						<div class="idea">
							{#each assetsOf(d.assets).slice(0, 1) as a}{@render media(a)}{/each}
							<h3>{t(d.title)}</h3>
							<p class="chips">{#if t(d.status)}<span class="chip status">{t(d.status).replace('_', ' ')}</span>{/if}{#if t(d.date)}<span class="chip">{t(d.date)}</span>{/if}</p>
							{#if t(d.description)}<p class="prose small">{t(d.description)}</p>{/if}
							{#if t(d.why_not_pursued)}<p class="small dim">Not pursued: {t(d.why_not_pursued)}</p>{/if}
							{#if t(d.origin)}<p class="small dim">From: {t(d.origin)}</p>{/if}
							{#if assetsOf(d.assets).length > 1}<div class="grid small-grid">{#each assetsOf(d.assets).slice(1) as a}{@render media(a)}{/each}</div>{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if list(m.tools).length || list(m.skills).length}
			<section class="block">
				<h2>Tools &amp; skills</h2>
				{#if list(m.tools).length}
					<div class="table-wrap">
						<table>
							<thead><tr><th>Tool</th><th>Used for</th><th>How often</th><th>Opinion</th></tr></thead>
							<tbody>
								{#each list(m.tools) as tl}{@const x = o(tl)}
									<tr><td><b>{t(x.name)}</b>{#if t(x.category)}{' '}<span class="dim small">{t(x.category)}</span>{/if}</td><td>{t(x.used_for)}</td><td>{t(x.frequency)}</td><td>{t(x.opinion)}</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
				{#if list(m.skills).length}
					<div class="table-wrap">
						<table>
							<thead><tr><th>Skill</th><th>Before</th><th>After</th></tr></thead>
							<tbody>
								{#each list(m.skills) as sk}{@const x = o(sk)}
									<tr><td><b>{t(x.name)}</b></td><td>{t(x.before)}</td><td>{t(x.after)}</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/if}

		{#if list(m.timeline).length}
			<section class="block">
				<h2>Timeline</h2>
				<ul class="timeline">
					{#each list(m.timeline) as ev}{@const e = o(ev)}
						<li><span class="dim">{t(e.date)}</span> {t(e.event)}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if Object.keys(reflections).length || t(m.testimonial)}
			<section class="block">
				<h2>Reflections</h2>
				{#if t(m.testimonial)}<blockquote class="testimonial">“{t(m.testimonial)}”</blockquote>{/if}
				<dl>
					{@render kv('On AI', reflections.on_ai)}
					{@render kv('On the class', reflections.on_class)}
					{@render kv('How the process changed', reflections.process_change)}
					{@render kv('Advice to future students', reflections.advice_to_future_students)}
					{@render kv("What's next", reflections.what_next)}
				</dl>
			</section>
		{/if}

		{#if otherFiles.length}
			<section class="block">
				<h2>Other files ({otherFiles.length})</h2>
				<div class="grid">{#each otherFiles as f}{@render media({ ...f, caption: f.path, alt: f.path })}{/each}</div>
			</section>
		{/if}

		<section class="block">
			<h2>How this was gathered</h2>
			{#if words(m.sources_searched).length}
				<p class="small"><b>Searched:</b></p>
				<ul class="small">{#each words(m.sources_searched) as s}<li>{s}</li>{/each}</ul>
			{/if}
			{#if list(m.omissions).length}
				<p class="small"><b>Left out:</b></p>
				<ul class="small">{#each list(m.omissions) as om}{@const x = o(om)}<li>{t(x.what) || t(om)}{#if t(x.reason)}: <span class="dim">{t(x.reason)}</span>{/if}</li>{/each}</ul>
			{/if}
			{#if t(o(m.generator).notes)}<p class="small dim">{t(o(m.generator).notes)}</p>{/if}
			{#if sub.lastReport?.warnings?.length}
				<details class="prov">
					<summary>{sub.lastReport.warnings.length} gaps the validator noticed</summary>
					<ul>{#each sub.lastReport.warnings as w}<li>{w.message}</li>{/each}</ul>
				</details>
			{/if}
		</section>
	</main>
</div>

<style>
	.archive-shell { min-height: 100%; background: var(--paper); }
	main { max-width: 860px; margin: 0 auto; padding: calc(1rem + var(--header-h, 52px)) 1rem 6rem; }
	.back { font-size: 0.8rem; color: var(--muted-fg); text-decoration: none; }
	.head { margin: 0.75rem 0 2rem; }
	.head h1 { font-family: 'Avara', serif; font-size: 1.7rem; margin: 0 0 0.2rem; overflow-wrap: anywhere; }
	.meta { margin: 0 0 0.3rem; font-size: 0.85rem; }
	.dim { color: var(--muted-fg); }
	.small { font-size: 0.8rem; }
	.note { font-size: 0.85rem; color: var(--muted-fg); }
	.err { color: var(--danger); }
	.pending { color: var(--accent); }
	.consent, .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.5rem 0; }
	.chip { font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-fg); }
	.chip.yes { color: var(--ink); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
	.chip.status { color: var(--paper); background: var(--ink); border-color: var(--ink); }
	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; }
	.btn {
		display: inline-flex; align-items: center; border: 1.5px solid var(--border); background: none; color: var(--ink);
		border-radius: 999px; padding: 0.3rem 0.75rem; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; text-decoration: none;
	}
	.btn:hover { border-color: var(--ink); }
	.raw { max-height: 28rem; overflow: auto; font-size: 0.72rem; line-height: 1.45; border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; }

	.block { margin-bottom: 2.5rem; }
	.block > h2 {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent)); margin: 0 0 0.75rem;
	}
	.prose { white-space: pre-wrap; line-height: 1.6; font-size: 0.92rem; margin: 0.4rem 0 0.8rem; overflow-wrap: anywhere; max-width: 68ch; }
	dl { margin: 0.4rem 0 0.8rem; display: flex; flex-direction: column; gap: 0.4rem; }
	.kv { display: grid; grid-template-columns: 10rem minmax(0, 1fr); gap: 0.75rem; font-size: 0.85rem; }
	.kv dt { color: var(--muted-fg); }
	.kv dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }

	.toc { display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; font-size: 0.82rem; margin-bottom: 1.25rem; }
	.toc a { color: var(--ink); }
	.project { border-top: 1px solid var(--border); padding: 1.5rem 0 1rem; scroll-margin-top: calc(var(--header-h, 52px) + 1rem); }
	.project h3 { font-family: 'Avara', serif; font-size: 1.3rem; margin: 0.75rem 0 0.2rem; overflow-wrap: anywhere; }
	.project h4 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-fg); margin: 1.25rem 0 0.4rem; }
	.one-liner { font-size: 1rem; margin: 0 0 0.4rem; }
	.prompts { padding-left: 1.1rem; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.35rem; }
	.prompts q { font-style: italic; }
	.process { padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.6rem; }
	.process p { margin: 0; }
	blockquote { margin: 0.75rem 0; padding: 0.4rem 0 0.4rem 0.9rem; border-left: 3px solid var(--accent); font-size: 0.95rem; }
	blockquote cite { display: block; font-size: 0.75rem; color: var(--muted-fg); font-style: normal; margin-top: 0.2rem; }
	.testimonial { font-size: 1.1rem; }
	.links { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.85rem; }
	.links a { color: var(--ink); }
	.prov { font-size: 0.8rem; margin-top: 0.75rem; color: var(--muted-fg); }
	.prov summary { cursor: pointer; }
	.prov ul { padding-left: 1.1rem; overflow-wrap: anywhere; }

	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 0.75rem; }
	.small-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); margin-top: 0.4rem; }
	.media { margin: 0; min-width: 0; }
	.media img, .media video { display: block; width: 100%; border-radius: 10px; border: 1px solid var(--border); background: color-mix(in srgb, var(--paper) 90%, var(--ink) 10%); }
	.media:not(.big) img { aspect-ratio: 4 / 3; object-fit: cover; }
	.media.big img, .media.big video { max-height: 520px; object-fit: contain; }
	.media figcaption { font-size: 0.75rem; margin-top: 0.3rem; line-height: 1.4; overflow-wrap: anywhere; }
	.file-link { display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; border: 1px solid var(--border); border-radius: 10px; font-size: 0.8rem; color: var(--ink); text-decoration: none; padding: 0.5rem; overflow-wrap: anywhere; text-align: center; }

	.ideas { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 1rem; }
	.idea { border: 1px solid var(--border); border-radius: 12px; padding: 0.8rem; min-width: 0; }
	.idea h3 { font-size: 1rem; margin: 0.5rem 0 0.2rem; overflow-wrap: anywhere; }
	.idea p { margin: 0.3rem 0; }

	.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 1rem; }
	table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
	th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-fg); font-weight: 600; padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--border); }
	td { padding: 0.5rem 0.7rem; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); vertical-align: top; }
	tr:last-child td { border-bottom: none; }
	.timeline { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.3rem; }

	@media (max-width: 640px) {
		main { padding-bottom: calc(6rem + 56px); }
		.kv { grid-template-columns: minmax(0, 1fr); gap: 0.1rem; }
	}
</style>
