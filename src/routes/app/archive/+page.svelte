<script>
	// 📦 Work Archive — students hand their AI agent a token + prompt; the
	// agent gathers every project/idea/image, interviews them, and uploads a
	// manifest.json + media (protocol: /work-archive/PROTOCOL.md). Agents that
	// can't reach the network produce a .zip, uploaded here instead. Instructors
	// also get the class roster and exports.
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { pageTitle } from '$lib/page-title-store.js';
	import { PROTOCOL_URL, ARCHIVE_ORIGIN, ARCHIVE_LIMITS, MANIFEST_PATH, rerootArchiveFiles } from '$lib/work-archive.js';
	import { readZip } from '$lib/zip-read.js';

	let { data } = $props();
	const isInstructor = $derived(data.me.role === 'instructor');

	onMount(() => pageTitle.set('Work Archive'));

	// ── Dates / sizes ────────────────────────────────────────────────────
	function parseIso(iso) {
		if (!iso) return null;
		const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
		return isNaN(d) ? null : d;
	}
	function fmtDate(iso) {
		const d = parseIso(iso);
		return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
	}
	function fmtBytes(n) {
		if (!n) return '0 MB';
		return n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`;
	}

	// ── Token + agent prompt ─────────────────────────────────────────────
	let freshToken = $state(null);   // raw value, shown once
	let tokenBusy = $state(false);
	let tokenErr = $state('');
	async function generateToken() {
		tokenBusy = true;
		tokenErr = '';
		try {
			const r = await fetch('/api/archive/token', { method: 'POST' });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
			freshToken = j.token;
			await invalidateAll();
		} catch (e) {
			tokenErr = e.message;
		}
		tokenBusy = false;
	}
	let revokeArmed = $state(false);
	async function revokeToken() {
		if (!revokeArmed) { revokeArmed = true; setTimeout(() => (revokeArmed = false), 3000); return; }
		revokeArmed = false;
		await fetch('/api/archive/token', { method: 'DELETE' });
		freshToken = null;
		await invalidateAll();
	}

	const agentPrompt = $derived(`Please build and upload my Work Archive for Interactive Design Concepts on eating.computer. My instructor uses it to document everything the class has made with AI.

1. First, read the whole protocol and follow it step by step: ${PROTOCOL_URL}
2. My upload token is below. It works like a password: keep it in the EATING_ARCHIVE_TOKEN environment variable, only send it to ${ARCHIVE_ORIGIN}/api/archive, and never write it into a file, the manifest, or a commit.
   EATING_ARCHIVE_TOKEN=${freshToken ?? '<generate a token at ' + ARCHIVE_ORIGIN + '/app/archive and paste it here>'}
3. Ask me where my work lives and what you may look through before you search.
4. Be exhaustive: every project, prototype, experiment, abandoned attempt, and unbuilt idea, with as many images as you can gather. Don't invent anything. If you're unsure, ask me.
5. Interview me, ask the consent questions, and show me the full summary. Upload only after I say yes.
6. If you can't reach eating.computer from where you're running, build the archive folder, zip it, and give me the zip so I can upload it at ${ARCHIVE_ORIGIN}/app/archive.`);

	let copied = $state('');
	async function copy(text, which) {
		try {
			await navigator.clipboard.writeText(text);
			copied = which;
			setTimeout(() => { if (copied === which) copied = ''; }, 2000);
		} catch { /* clipboard blocked — the text is selectable */ }
	}

	// ── Browser upload (.zip or folder) ──────────────────────────────────
	let upPhase = $state('idle');    // idle | reading | checking | uploading | finishing | done | failed
	let upMsg = $state('');
	let upDone = $state(0);
	let upTotal = $state(0);
	let upReport = $state(null);     // { ok, errors, warnings, stats, url }
	let upSkipped = $state([]);
	let dragOver = $state(false);
	const busy = $derived(['reading', 'checking', 'uploading', 'finishing'].includes(upPhase));

	async function api(method, path, body) {
		const r = await fetch(path, {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : {},
			body: body ? JSON.stringify(body) : undefined
		});
		const j = await r.json().catch(() => ({}));
		return { status: r.status, ok: r.ok, data: j };
	}

	async function putWithRetry(u, blob) {
		for (let attempt = 1; ; attempt++) {
			try {
				const r = await fetch(u.url, { method: 'PUT', headers: u.headers, body: blob });
				if (r.ok) return;
				if (attempt >= 3) throw new Error(`storage returned ${r.status}`);
			} catch (e) {
				if (attempt >= 3) throw e;
			}
			await new Promise((res) => setTimeout(res, 800 * attempt));
		}
	}

	async function uploadEntries(entries) {
		upReport = null;
		upSkipped = [];
		upDone = 0;
		upPhase = 'checking';
		upMsg = 'Checking the archive…';
		const { files, skipped, error } = rerootArchiveFiles(entries);
		upSkipped = skipped ?? [];
		if (error) { upPhase = 'failed'; upMsg = error; return; }
		const manifestEntry = files.find((f) => f.path === MANIFEST_PATH);
		let manifest;
		try {
			manifest = JSON.parse(await (await manifestEntry.getBlob()).text());
		} catch (e) {
			upPhase = 'failed';
			upMsg = `manifest.json isn't valid JSON: ${e.message}`;
			return;
		}
		upTotal = files.length;

		if (manifestEntry.size < 3.5 * 1048576) {
			const v = await api('POST', '/api/archive/validate', { manifest, files: files.map((f) => ({ path: f.path, size: f.size })) });
			if (v.status !== 200 && v.status !== 422) { upPhase = 'failed'; upMsg = v.data.message ?? `Validation failed (${v.status})`; return; }
			if (!v.data.ok) { upPhase = 'failed'; upMsg = 'The archive has problems. Nothing was uploaded.'; upReport = v.data; return; }
		}

		const created = await api('POST', '/api/archive/submissions', { agent: 'Browser upload' });
		if (!created.ok) { upPhase = 'failed'; upMsg = created.data.message ?? `Couldn't start (${created.status})`; return; }
		const id = created.data.id;

		upPhase = 'uploading';
		const ordered = [...files.filter((f) => f.path !== MANIFEST_PATH), manifestEntry];
		try {
			for (let i = 0; i < ordered.length; i += ARCHIVE_LIMITS.presignBatch) {
				const batch = ordered.slice(i, i + ARCHIVE_LIMITS.presignBatch);
				const pre = await api('POST', `/api/archive/submissions/${id}/files`, { files: batch.map((f) => ({ path: f.path, size: f.size })) });
				if (!pre.ok) throw new Error(pre.data.message ?? `presign failed (${pre.status})`);
				if (pre.data.rejected?.length) upSkipped = [...upSkipped, ...pre.data.rejected];
				const byPath = new Map(batch.map((f) => [f.path, f]));
				const queue = [...pre.data.uploads];
				await Promise.all(Array.from({ length: 3 }, async () => {
					for (let u = queue.shift(); u; u = queue.shift()) {
						upMsg = `Uploading ${u.path}`;
						await putWithRetry(u, await byPath.get(u.path).getBlob());
						upDone++;
					}
				}));
			}
		} catch (e) {
			await api('DELETE', `/api/archive/submissions/${id}`);
			upPhase = 'failed';
			upMsg = `Upload failed: ${e.message}. Nothing was kept; try again.`;
			return;
		}

		upPhase = 'finishing';
		upMsg = 'Checking everything arrived…';
		const fin = await api('POST', `/api/archive/submissions/${id}/complete`);
		upReport = fin.data;
		if (fin.ok && fin.data.ok) {
			upPhase = 'done';
			upMsg = 'Archived.';
		} else {
			await api('DELETE', `/api/archive/submissions/${id}`);
			upPhase = 'failed';
			upMsg = fin.data.message ?? 'The archive has problems. Nothing was kept.';
		}
		await invalidateAll();
	}

	async function onZip(file) {
		if (!file) return;
		upPhase = 'reading';
		upMsg = `Reading ${file.name}…`;
		try {
			await uploadEntries(await readZip(file));
		} catch (e) {
			upPhase = 'failed';
			upMsg = e.message;
		}
	}
	function onFolder(fileList) {
		const list = [...(fileList ?? [])];
		if (!list.length) return;
		uploadEntries(list.map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, getBlob: async () => f })));
	}
	function onDrop(e) {
		e.preventDefault();
		dragOver = false;
		const f = e.dataTransfer?.files?.[0];
		if (f && /\.zip$/i.test(f.name)) onZip(f);
		else { upPhase = 'failed'; upMsg = 'Drop a .zip file. To upload a folder, use "Choose folder".'; }
	}

	// ── Delete a submission (two-step) ───────────────────────────────────
	let delArmed = $state(null);
	async function del(id) {
		if (delArmed !== id) { delArmed = id; setTimeout(() => { if (delArmed === id) delArmed = null; }, 3000); return; }
		delArmed = null;
		await fetch(`/api/archive/submissions/${id}`, { method: 'DELETE' });
		await invalidateAll();
	}

	// ── Instructor: roster ───────────────────────────────────────────────
	const archived = $derived((data.roster ?? []).filter((s) => s.latest));
	const totals = $derived(archived.reduce((t, s) => ({
		projects: t.projects + s.latest.projects,
		ideas: t.ideas + s.latest.ideas,
		assets: t.assets + s.latest.assets,
		bytes: t.bytes + s.latest.bytes
	}), { projects: 0, ideas: 0, assets: 0, bytes: 0 }));

	const announcement = `📦 Work Archive: I'm putting together a permanent record of everything this class has made with AI. It documents the class, and it's a big part of how I keep it funded. Please have your AI agent build and upload yours:

1. Go to ${ARCHIVE_ORIGIN}/app/archive and press "Generate token".
2. Copy the prompt on that page and paste it into Claude Code (or the Claude desktop app). Your agent will ask what it may look through, gather your projects and images, ask you a few questions, and show you everything before it uploads.
3. Include everything: finished work, experiments, things you abandoned, and ideas you never built. More is better.

It takes about 20–40 minutes. You decide how your work may be used and how you're credited, and you can delete your archive from the site at any time.`;
</script>

<div class="archive-shell">
	<main>
		<header class="page-head">
			<h1>Work Archive</h1>
			{#if isInstructor}
				<p class="page-sub">Each student's AI agent gathers everything they've made with AI (projects, experiments, ideas, images, process, and reflections), interviews them, and uploads it here, with the student's consent recorded.</p>
			{:else}
				<p class="page-sub">Your instructor is keeping a permanent record of everything this class makes with AI, to document the class and keep it funded. Your AI agent does the work: it gathers your projects, ideas, and images, asks you a few questions, and uploads it here. You see everything before it's sent, and you choose how it may be used.</p>
			{/if}
		</header>

		{#if isInstructor}
			<section class="block">
				<h2>Class</h2>
				<div class="stats">
					<div class="stat"><b>{archived.length}<span>/{data.roster.length}</span></b><span>students archived</span></div>
					<div class="stat"><b>{totals.projects}</b><span>projects</span></div>
					<div class="stat"><b>{totals.ideas}</b><span>ideas</span></div>
					<div class="stat"><b>{totals.assets}</b><span>files · {fmtBytes(totals.bytes)}</span></div>
				</div>
				<div class="actions">
					<button class="btn" onclick={() => copy(announcement, 'announce')}>{copied === 'announce' ? 'Copied ✓' : 'Copy announcement for students'}</button>
					<a class="btn ghost" href="/api/archive/export" download>Download all (JSON)</a>
					<a class="btn ghost" href={PROTOCOL_URL} target="_blank" rel="noopener">Agent protocol ↗</a>
				</div>

				<div class="table-wrap">
					<table class="roster">
						<thead>
							<tr><th>Student</th><th>Status</th><th class="num">Projects</th><th class="num">Ideas</th><th class="num">Files</th><th>Consent</th></tr>
						</thead>
						<tbody>
							{#each data.roster as s (s.id)}
								<tr class:muted={!s.latest}>
									<td class="who">
										{#if s.latest}<a href="/app/archive/{s.latest.id}">{s.name}</a>{:else}{s.name}{/if}
										{#if s.isTa}<span class="chip">TA</span>{/if}
										{#if s.hidden}<span class="chip">hidden</span>{/if}
									</td>
									<td class="status">
										{#if s.latest}
											<span class="ok">Archived</span> {fmtDate(s.latest.completedAt)}{#if s.versions > 1}{' '}<span class="dim">· v{s.versions}</span>{/if}
										{:else if s.open}
											<span class="pending">In progress</span>
										{:else}
											<span class="dim">Not yet</span>
										{/if}
									</td>
									<td class="num">{s.latest?.projects ?? ''}</td>
									<td class="num">{s.latest?.ideas ?? ''}</td>
									<td class="num">{s.latest?.assets ?? ''}</td>
									<td class="consent">
										{#if s.latest?.digest?.consent}
											{@const c = s.latest.digest.consent}
											<span class="chip" class:yes={c.funding} title="May be used in funding reports">funding {c.funding ? '✓' : '✗'}</span>
											<span class="chip" class:yes={c.showcase} title="May be shown publicly">public {c.showcase ? '✓' : '✗'}</span>
											<span class="chip" title="How to credit them">{(c.attribution ?? '').replace('_', ' ')}</span>
										{/if}
									</td>
								</tr>
							{:else}
								<tr><td colspan="6" class="dim">No approved students in this class yet.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<section class="block">
			<h2>{isInstructor ? 'Try it yourself' : '1 · Get your upload token'}</h2>
			<p class="note">The token lets your agent upload to <em>your</em> archive and nothing else. It's shown once and expires after 30 days. Generating a new one cancels the old one.</p>
			{#if freshToken}
				<div class="token-fresh">
					<code>{freshToken}</code>
					<button class="btn small" onclick={() => copy(freshToken, 'token')}>{copied === 'token' ? 'Copied ✓' : 'Copy'}</button>
				</div>
				<p class="note">It's already in the prompt below. Treat it like a password.</p>
			{:else if data.token}
				<p class="token-status">Active token ending <code>…{data.token.last4}</code>, expires {fmtDate(data.token.expiresAt)}{#if data.token.lastUsedAt}, last used {fmtDate(data.token.lastUsedAt)}{/if}.</p>
			{/if}
			<div class="actions">
				<button class="btn" onclick={generateToken} disabled={tokenBusy}>{tokenBusy ? 'Generating…' : data.token || freshToken ? 'Generate a new token' : 'Generate token'}</button>
				{#if data.token}
					<button class="btn ghost danger" class:armed={revokeArmed} onclick={revokeToken}>{revokeArmed ? 'Click again to revoke' : 'Revoke'}</button>
				{/if}
			</div>
			{#if tokenErr}<p class="err">{tokenErr}</p>{/if}
		</section>

		<section class="block">
			<h2>{isInstructor ? 'The prompt students paste' : '2 · Paste this into your agent'}</h2>
			<p class="note">Use <b>Claude Code</b> or the <b>Claude desktop app</b> on the computer where your work lives, so it can look through your projects. It works in claude.ai too, but there it can only see what you show it, and it'll give you a .zip to upload below.</p>
			<div class="prompt">
				<pre>{agentPrompt}</pre>
				<div class="prompt-bar">
					<button class="btn small" onclick={() => copy(agentPrompt, 'prompt')}>{copied === 'prompt' ? 'Copied ✓' : 'Copy prompt'}</button>
				</div>
			</div>
			{#if !freshToken}<p class="note">Generate a token first and it'll be filled in here.</p>{/if}
		</section>

		<section class="block">
			<h2>{isInstructor ? 'Manual upload' : '3 · If your agent gave you a .zip'}</h2>
			<p class="note">Upload the zip (or the folder) your agent made. It needs a <code>manifest.json</code> at the top. It's checked the same way as a direct upload.</p>
			<div
				class="drop"
				class:over={dragOver}
				role="region"
				aria-label="Drop a .zip here"
				ondragover={(e) => { e.preventDefault(); dragOver = true; }}
				ondragleave={() => (dragOver = false)}
				ondrop={onDrop}
			>
				<span>Drop a .zip here, or</span>
				<label class="btn small" class:disabled={busy}>
					Choose .zip
					<input type="file" accept=".zip,application/zip" disabled={busy} onchange={(e) => { onZip(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
				</label>
				<label class="btn small ghost" class:disabled={busy}>
					Choose folder
					<input type="file" webkitdirectory multiple disabled={busy} onchange={(e) => { onFolder(e.currentTarget.files); e.currentTarget.value = ''; }} />
				</label>
			</div>

			{#if upPhase !== 'idle'}
				<div class="upload-status" class:failed={upPhase === 'failed'} class:done={upPhase === 'done'} aria-live="polite">
					<p>{upMsg}</p>
					{#if upPhase === 'uploading' || upPhase === 'finishing'}
						<div class="bar"><div style:width="{upTotal ? (upDone / upTotal) * 100 : 0}%"></div></div>
						<p class="dim">{upDone} / {upTotal} files</p>
					{/if}
					{#if upReport}
						{#if upReport.ok && upReport.url}
							<p><a href={upReport.url.replace(ARCHIVE_ORIGIN, '')}>View the archive →</a> · {upReport.stats?.projects} projects, {upReport.stats?.ideas} ideas, {upReport.stats?.assets} files</p>
						{/if}
						{#if upReport.errors?.length}
							<ul class="report errors">{#each upReport.errors as e}<li>{e.message}{#if e.at}{' '}<code>{e.at}</code>{/if}</li>{/each}</ul>
						{/if}
						{#if upReport.warnings?.length}
							<details class="report-warn">
								<summary>{upReport.warnings.length} suggestion{upReport.warnings.length === 1 ? '' : 's'} to make it more complete</summary>
								<ul class="report">{#each upReport.warnings as w}<li>{w.message}</li>{/each}</ul>
							</details>
						{/if}
					{/if}
					{#if upSkipped.length}
						<details class="report-warn">
							<summary>{upSkipped.length} file{upSkipped.length === 1 ? '' : 's'} skipped</summary>
							<ul class="report">{#each upSkipped as s}<li><code>{s.path}</code>: {s.reason}</li>{/each}</ul>
						</details>
					{/if}
				</div>
			{/if}
		</section>

		<section class="block">
			<h2>{isInstructor ? 'Your uploads' : 'Your archives'}</h2>
			{#if data.mine.length}
				<ul class="subs">
					{#each data.mine as s (s.id)}
						<li>
							<div class="sub-main">
								{#if s.status === 'complete'}
									<a href="/app/archive/{s.id}">{fmtDate(s.completedAt)}</a>
									<span class="dim">{s.projects} projects · {s.ideas} ideas · {s.assets} files · {fmtBytes(s.bytes)}</span>
								{:else}
									<span class="pending">Unfinished</span> <span class="dim">started {fmtDate(s.createdAt)}{#if s.lastReport?.errors?.length}{' '}· {s.lastReport.errors.length} errors last check{/if}</span>
								{/if}
								{#if s.agent}<span class="dim agent">via {s.agent}</span>{/if}
							</div>
							<button class="btn small ghost danger" class:armed={delArmed === s.id} onclick={() => del(s.id)}>{delArmed === s.id ? 'Click again to delete' : 'Delete'}</button>
						</li>
					{/each}
				</ul>
				{#if !isInstructor}<p class="note">The newest one is what your instructor sees. Deleting removes it from eating.computer. If you also want it out of any copies your instructor has already saved, tell them.</p>{/if}
			{:else}
				<p class="dim">Nothing uploaded yet.</p>
			{/if}
		</section>
	</main>
</div>

<style>
	.archive-shell { min-height: 100%; background: var(--paper); }
	main { max-width: 820px; margin: 0 auto; padding: calc(1rem + var(--header-h, 52px)) 1rem 6rem; }
	.page-head h1 { font-family: 'Avara', serif; font-size: 1.5rem; margin: 0 0 0.35rem; }
	.page-sub { font-size: 0.9rem; color: var(--muted-fg); margin: 0 0 1.5rem; line-height: 1.55; max-width: 62ch; }
	.block { margin-bottom: 2.25rem; }
	.block h2 {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		color: var(--md-sys-color-primary, var(--accent)); margin: 0 0 0.6rem;
	}
	.note { font-size: 0.85rem; color: var(--muted-fg); line-height: 1.5; margin: 0 0 0.75rem; max-width: 62ch; }
	.dim { color: var(--muted-fg); }
	.err { color: var(--danger); font-size: 0.85rem; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }

	.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.25rem 0 1rem; }
	.btn {
		display: inline-flex; align-items: center; gap: 0.35rem; position: relative;
		border: 1.5px solid var(--accent); background: var(--accent); color: var(--paper);
		border-radius: 999px; padding: 0.45rem 0.95rem; font: inherit; font-size: 0.85rem; font-weight: 700;
		cursor: pointer; text-decoration: none; white-space: nowrap;
	}
	.btn.ghost { background: none; color: var(--ink); border-color: var(--border); }
	.btn.ghost:hover { border-color: var(--ink); }
	.btn.small { padding: 0.3rem 0.75rem; font-size: 0.8rem; }
	.btn.danger { color: var(--danger); }
	.btn.danger.armed { background: var(--danger); color: var(--on-danger); border-color: var(--danger); }
	.btn:disabled, .btn.disabled { opacity: 0.45; cursor: default; }
	.btn input[type='file'] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }

	.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
	.stat { border: 1px solid var(--border); border-radius: 12px; padding: 0.7rem 0.8rem; display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.stat b { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
	.stat b span { font-size: 0.9rem; color: var(--muted-fg); font-weight: 500; }
	.stat > span { font-size: 0.75rem; color: var(--muted-fg); }

	.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
	.roster { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
	.roster th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-fg); font-weight: 600; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--border); white-space: nowrap; }
	.roster td { padding: 0.55rem 0.7rem; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); vertical-align: middle; }
	.roster tr:last-child td { border-bottom: none; }
	.roster .num { text-align: right; font-variant-numeric: tabular-nums; }
	.roster tr.muted .who { color: var(--muted-fg); }
	.who { white-space: nowrap; }
	.who a { color: var(--ink); font-weight: 600; }
	.roster td.status { white-space: nowrap; }
	.consent { min-width: 12rem; }
	.chip { display: inline-block; font-size: 0.68rem; padding: 0.1rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-fg); margin-left: 0.2rem; }
	.chip.yes { color: var(--ink); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
	.ok { font-weight: 600; }
	.pending { color: var(--accent); font-weight: 600; }

	.token-fresh { display: flex; align-items: center; gap: 0.5rem; border: 1.5px dashed var(--accent); border-radius: 10px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; }
	.token-fresh code { flex: 1; min-width: 0; overflow-wrap: anywhere; user-select: all; }
	.token-status { font-size: 0.85rem; margin: 0 0 0.5rem; }

	.prompt { border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--paper) 92%, var(--ink) 8%); }
	.prompt pre { margin: 0; padding: 0.9rem 1rem 0.5rem; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; line-height: 1.55; user-select: all; }
	.prompt-bar { display: flex; justify-content: flex-end; padding: 0 0.6rem 0.6rem; }

	.drop {
		display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.6rem;
		border: 1.5px dashed var(--border); border-radius: 12px; padding: 1.4rem 1rem; font-size: 0.85rem; color: var(--muted-fg);
	}
	.drop.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
	.upload-status { margin-top: 0.75rem; border: 1px solid var(--border); border-radius: 12px; padding: 0.75rem 0.9rem; font-size: 0.85rem; }
	.upload-status p { margin: 0 0 0.4rem; overflow-wrap: anywhere; }
	.upload-status.failed { border-color: var(--danger); }
	.upload-status.done { border-color: var(--accent); }
	.bar { height: 6px; border-radius: 99px; background: var(--border); overflow: hidden; margin: 0.3rem 0; }
	.bar div { height: 100%; background: var(--accent); transition: width 0.2s ease; }
	.report { margin: 0.4rem 0 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; }
	.report li { overflow-wrap: anywhere; }
	.report.errors { color: var(--danger); }
	.report-warn { margin-top: 0.4rem; }
	.report-warn summary { cursor: pointer; color: var(--muted-fg); }

	.subs { list-style: none; margin: 0; padding: 0; }
	.subs li { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.6rem 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); }
	.sub-main { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; font-size: 0.85rem; min-width: 0; }
	.sub-main a { color: var(--ink); font-weight: 600; }
	.agent { font-size: 0.78rem; }

	@media (max-width: 640px) {
		main { padding-bottom: calc(6rem + 56px); }
		.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
