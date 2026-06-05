<script>
	import { enhance } from '$app/forms';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';

	let { data, form } = $props();
	const isInstructor = data.role === 'instructor';

	const TYPE_LABELS = { link: 'Link', image: 'Image', video: 'Video' };
	const ALL_TYPES = ['link', 'image', 'video'];

	let showForm = $state(false);
	let openSubmit = $state(null);
	let submitTypes = $state({});

	let links = $state(data.links);
	let uploadedFiles = $state(data.uploadedFiles ?? []);
	let starredMessages = $state(data.starredMessages ?? []);

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

<svelte:head><title>Atlas — eating.computer</title></svelte:head>

<div class="shell">
	<main>
		<!-- ═══════════════════ ROADMAP ═══════════════════ -->
		<div class="page-header">
			<h1>Roadmap</h1>
			{#if isInstructor}
				<button class="btn-secondary" onclick={() => (showForm = !showForm)}>
					{showForm ? 'Cancel' : '+ New assignment'}
				</button>
			{/if}
		</div>

		{#if isInstructor && showForm}
			<div class="create-card">
				<h2>New Assignment</h2>
				{#if form?.error && form?.action === 'create'}
					<p class="error">{form.error}</p>
				{/if}
				<form method="POST" action="?/create" use:enhance={() => () => { showForm = false; }}>
					<input type="hidden" name="class_id" value={data.classId} />
					<div class="form-row">
						<label>
							<span>Week <span class="required">*</span></span>
							<input type="number" name="week" min="1" max="52" required placeholder="1" />
						</label>
						<label class="grow">
							<span>Title <span class="required">*</span></span>
							<input type="text" name="title" required placeholder="e.g. Reading response" />
						</label>
					</div>
					<label>
						<span>Description</span>
						<textarea name="description" rows="3" placeholder="Details, instructions, links…"></textarea>
					</label>
					<label>
						<span>Due date</span>
						<input type="date" name="due_date" />
					</label>
					<fieldset>
						<legend>Accepted submission types <span class="required">*</span></legend>
						<div class="checkbox-row">
							{#each ALL_TYPES as t}
								<label class="checkbox-label">
									<input type="checkbox" name="accepted_types" value={t} checked={t === 'link'} />
									{TYPE_LABELS[t]}
								</label>
							{/each}
						</div>
					</fieldset>
					<div class="form-actions">
						<button type="submit" class="btn-primary">Create</button>
					</div>
				</form>
			</div>
		{/if}

		{#if data.weeks.length === 0}
			<p class="empty">No assignments yet.</p>
		{:else}
			{#each data.weeks as { week, assignments }}
				<section class="week-section">
					<h2 class="week-label">Week {week}</h2>
					<div class="assignment-list">
						{#each assignments as a}
							<div class="assignment-card">
								<div class="card-top">
									<div class="assignment-body">
										<p class="assignment-title">{a.title}</p>
										{#if a.description}
											<p class="assignment-desc">{a.description}</p>
										{/if}
										{#if a.dueDate}
											<p class="due">Due {new Date(a.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
										{/if}
									</div>
									{#if isInstructor}
										<form method="POST" action="?/delete" use:enhance>
											<input type="hidden" name="id" value={a.id} />
											<button type="submit" class="btn-delete" aria-label="Delete">×</button>
										</form>
									{/if}
								</div>

								<p class="accepted-note">
									Accepted: {a.acceptedTypes.map((t) => TYPE_LABELS[t]).join(', ')}
								</p>

								{#if !isInstructor}
									{#if a.mySubmission}
										<div class="my-submission">
											<span class="submitted-label">Submitted</span>
											{#if a.mySubmission.type === 'link'}
												<a href={a.mySubmission.value} target="_blank" rel="noopener">{a.mySubmission.value}</a>
											{:else}
												<a href="/api/submissions/{a.mySubmission.id}" target="_blank">
													View {a.mySubmission.type}
												</a>
											{/if}
										</div>
									{:else if openSubmit === a.id}
										{@const chosenType = submitTypes[a.id] ?? a.acceptedTypes[0]}
										<div class="submit-form-wrap">
											{#if form?.action === 'submit' && form?.assignmentId === a.id && form?.error}
												<p class="error small">{form.error}</p>
											{/if}
											{#if a.acceptedTypes.length > 1}
												<div class="type-tabs">
													{#each a.acceptedTypes as t}
														<button
															type="button"
															class="type-tab"
															class:active={submitTypes[a.id] === t}
															onclick={() => (submitTypes[a.id] = t)}
														>{TYPE_LABELS[t]}</button>
													{/each}
												</div>
											{/if}
											<form
												method="POST"
												action="?/submit"
												enctype="multipart/form-data"
												use:enhance={() => () => { openSubmit = null; }}
											>
												<input type="hidden" name="assignment_id" value={a.id} />
												<input type="hidden" name="type" value={chosenType} />
												{#if chosenType === 'link'}
													<input type="url" name="link" placeholder="https://…" required />
												{:else if chosenType === 'image'}
													<input type="file" name="file" accept="image/*" required />
												{:else if chosenType === 'video'}
													<input type="file" name="file" accept="video/*" required />
												{/if}
												<div class="submit-actions">
													<button type="button" class="btn-ghost" onclick={() => (openSubmit = null)}>Cancel</button>
													<button type="submit" class="btn-primary small">Submit</button>
												</div>
											</form>
										</div>
									{:else}
										<button class="btn-submit" onclick={() => { openSubmit = a.id; submitTypes[a.id] = a.acceptedTypes[0]; }}>
											Submit work
										</button>
									{/if}
								{/if}

								{#if isInstructor && a.submissions}
									<div class="submissions-section">
										<p class="submissions-header">{a.submissions.length} submission{a.submissions.length === 1 ? '' : 's'}</p>
										{#if a.submissions.length > 0}
											<ul class="submissions-list">
												{#each a.submissions as s}
													<li class="submission-item">
														<span class="sub-student">{displayName(s)}</span>
														<span class="sub-type">{TYPE_LABELS[s.type]}</span>
														{#if s.type === 'link'}
															<a href={s.value} target="_blank" rel="noopener" class="sub-link">Open ↗</a>
														{:else}
															<a href="/api/submissions/{s.id}" target="_blank" class="sub-link">View ↗</a>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/each}
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

	/* ── Week sections ── */
	.week-section { margin-bottom: 2rem; }

	.week-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		margin: 0 0 0.75rem;
	}

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
