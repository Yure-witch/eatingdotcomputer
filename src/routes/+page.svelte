<script>
	const { data } = $props();
</script>

<div class="page">
	<section class="container hero">
		<div>
			<span class="pill">Eating.Computer Studio</span>
			<h1>Build a class website that feels like a studio lab.</h1>
			<p>
				A bold, story-first SvelteKit site wired for Turso data, Cloudflare R2 assets,
				and Vercel hosting. Built for your class, designed to look like a curated
				exhibit.
			</p>
			<div class="cta">
				<a class="button primary" href="#modules">Explore the modules</a>
				<a class="button secondary" href="#stack">View the stack</a>
			</div>
		</div>
		<div class="hero-card">
			<h3>Live Studio Pulse</h3>
			<div class="stat-grid">
				<div class="stat">
					<span class="tag">Turso</span>
					<strong>{data.stats.totalEntries ?? '—'}</strong>
					<span>entries logged</span>
				</div>
				<div class="stat">
					<span class="tag">R2</span>
					<strong>{data.assets.length}</strong>
					<span>recent uploads</span>
				</div>
				<div class="stat">
					<span class="tag">Status</span>
					<strong>{data.dbReady && data.r2Ready ? 'Ready' : 'Setup'}</strong>
					<span>config check</span>
				</div>
			</div>
			<div class="stack">
				<span class="tag">Latest R2 keys</span>
				{#if data.assets.length === 0}
					<p>Add your first project upload to see it here.</p>
				{:else}
					{#each data.assets as asset}
						<span>{asset}</span>
					{/each}
				{/if}
			</div>
		</div>
	</section>

	<section class="container section" id="modules">
		<h2>Modules for a living syllabus</h2>
		<div class="grid">
			<article class="card">
				<span class="tag">Week 1</span>
				<h3>Signal &amp; Noise</h3>
				<p>Collect daily artifacts, log reflections in Turso, and track the theme arc.</p>
			</article>
			<article class="card">
				<span class="tag">Week 4</span>
				<h3>Field Captures</h3>
				<p>Upload interviews, scans, and photos to R2. Display them as a live gallery.</p>
			</article>
			<article class="card">
				<span class="tag">Week 7</span>
				<h3>Studio Crits</h3>
				<p>Record feedback loops, notes, and verdicts. Visualize momentum week to week.</p>
			</article>
			<article class="card">
				<span class="tag">Week 10</span>
				<h3>Final Exhibit</h3>
				<p>Ship the capstone with story cards, a timeline, and the full R2 archive.</p>
			</article>
		</div>
	</section>

	<section class="container section" id="stack">
		<h2>Stack that ships</h2>
		<div class="grid">
			<article class="card">
				<h3>SvelteKit + Vercel</h3>
				<p>Fast previews, edge-friendly routing, and instant deployments for every build.</p>
			</article>
			<article class="card">
				<h3>Turso</h3>
				<p>SQLite everywhere, syncing class notes and submissions across devices.</p>
			</article>
			<article class="card">
				<h3>Cloudflare R2</h3>
				<p>Affordable storage for rich media, stitched into the site with signed URLs.</p>
			</article>
		</div>
	</section>

	<section class="container section">
		<div class="highlight">
			<h3>Next step: seed the studio</h3>
			<p>
				Add your Turso and R2 credentials, then publish the first class upload. The
				live card will flip from “Setup” to “Ready”.
			</p>
			<div class="cta">
				<a class="button primary" href="#setup">Configure environment</a>
				<a class="button secondary" href="#modules">Plan content</a>
			</div>
		</div>
	</section>

	<section class="container section" id="setup">
		<h2>Setup checklist</h2>
		<div class="grid">
			<article class="card">
				<h3>Turso</h3>
				<p>Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel.</p>
			</article>
			<article class="card">
				<h3>R2</h3>
				<p>
					Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
					`R2_BUCKET`.
				</p>
			</article>
			<article class="card">
				<h3>Seed data</h3>
				<p>Create an `entries` table and start logging your first reflections.</p>
			</article>
		</div>
	</section>

	<footer class="container footer">
		<span>Built for your class studio on {new Date().getFullYear()}.</span>
		<span>Made with SvelteKit, Turso, R2, and Vercel.</span>
	</footer>
</div>
