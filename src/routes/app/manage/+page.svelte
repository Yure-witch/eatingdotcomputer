<script>
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let testNotifStatus = $state(null);

	async function sendTestNotification() {
		for (let i = 2; i >= 1; i--) {
			testNotifStatus = `Sending in ${i}s…`;
			await new Promise((r) => setTimeout(r, 1000));
		}
		testNotifStatus = 'Sending…';
		try {
			const res = await fetch('/api/push/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: 'eating.computer',
					body: 'Test notification — everything is working!',
					url: '/app',
					tag: 'test'
				})
			});
			const data = await res.json();
			testNotifStatus = res.ok ? `Sent to ${data.sent} device(s)` : 'Failed';
		} catch {
			testNotifStatus = 'Failed';
		}
		setTimeout(() => (testNotifStatus = null), 4000);
	}

	const TYPE_LABELS = { link: 'Link', image: 'Image', video: 'Video' };
	const ALL_TYPES = ['link', 'image', 'video'];

	// Which assignment is being edited (by id)
	let editing = $state(null);
	// New-assignment form state: which week panel is open
	let addingToWeek = $state(null);
	// New week form open
	let addingNewWeek = $state(false);
	// Default week for new week form
	let newWeekNumber = $state(data.maxWeek + 1);

	$effect(() => { newWeekNumber = data.maxWeek + 1; });
</script>

<svelte:head>
	<title>Manage — eating.computer</title>
</svelte:head>

<div class="shell">
	<header>
		<a class="wordmark" href="/">eating.computer</a>
		<nav>
			<a href="/app">Dashboard</a>
			<a href="/app/assignments">Assignments</a>
			<a href="/app/manage" class="active">Manage</a>
		</nav>
	</header>

	<main>
		<div class="page-header">
			<div>
				<h1>Manage assignments</h1>
				<p class="subtitle">Instructor view — students see assignments at <a href="/app/assignments">/app/assignments</a></p>
			</div>
			<div class="header-actions">
				<button class="btn-secondary" onclick={sendTestNotification} disabled={testNotifStatus === 'sending'}>
					{testNotifStatus ?? '🔔 Test notification'}
				</button>
				<button class="btn-primary" onclick={() => { addingNewWeek = !addingNewWeek; addingToWeek = null; }}>
					{addingNewWeek ? 'Cancel' : '+ Add assignment'}
				</button>
			</div>
		</div>

		<!-- ── Global create form ── -->
		{#if addingNewWeek}
			<div class="create-card">
				<h2>New assignment</h2>
				{#if form?.error && form?.action === 'create'}
					<p class="error">{form.error}</p>
				{/if}
				<form method="POST" action="?/create" use:enhance={() => () => { addingNewWeek = false; }}>
					<div class="form-row">
						<label>
							<span>Week <span class="req">*</span></span>
							<input type="number" name="week" min="1" max="52" required bind:value={newWeekNumber} />
						</label>
						<label class="grow">
							<span>Title <span class="req">*</span></span>
							<input type="text" name="title" required placeholder="e.g. Reading response" />
						</label>
						<label>
							<span>Due date</span>
							<input type="date" name="due_date" />
						</label>
					</div>
					<label>
						<span>Description / instructions</span>
						<textarea name="description" rows="3" placeholder="Instructions, links, rubric…"></textarea>
					</label>
					<fieldset>
						<legend>Accepted submissions <span class="req">*</span></legend>
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
						<button type="button" class="btn-ghost" onclick={() => (addingNewWeek = false)}>Cancel</button>
						<button type="submit" class="btn-primary">Create</button>
					</div>
				</form>
			</div>
		{/if}

		<!-- ── Week-by-week list ── -->
		{#if data.weeks.length === 0 && !addingNewWeek}
			<p class="empty">No assignments yet. Click "+ Add assignment" to get started.</p>
		{/if}

		{#each data.weeks as { week, assignments }}
			<section class="week-block">
				<div class="week-header">
					<h2>Week {week}</h2>
					<button
						class="btn-add-inline"
						onclick={() => { addingToWeek = addingToWeek === week ? null : week; addingNewWeek = false; }}
					>
						{addingToWeek === week ? 'Cancel' : '+ Add to week'}
					</button>
				</div>

				<!-- Inline add form for this week -->
				{#if addingToWeek === week}
					<div class="inline-form-card">
						{#if form?.error && form?.action === 'create'}
							<p class="error small">{form.error}</p>
						{/if}
						<form method="POST" action="?/create" use:enhance={() => () => { addingToWeek = null; }}>
							<input type="hidden" name="week" value={week} />
							<label class="grow">
								<span>Title <span class="req">*</span></span>
								<input type="text" name="title" required placeholder="Assignment title" autofocus />
							</label>
							<label>
								<span>Due date</span>
								<input type="date" name="due_date" />
							</label>
							<label>
								<span>Description</span>
								<textarea name="description" rows="2" placeholder="Optional instructions…"></textarea>
							</label>
							<fieldset>
								<legend>Accepted submissions</legend>
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
								<button type="button" class="btn-ghost" onclick={() => (addingToWeek = null)}>Cancel</button>
								<button type="submit" class="btn-primary small">Add</button>
							</div>
						</form>
					</div>
				{/if}

				<div class="assignment-table">
					{#each assignments as a}
						<div class="row">
							{#if editing === a.id}
								<!-- ── Edit form ── -->
								<div class="edit-form">
									{#if form?.error && form?.action === 'update' && form?.id === a.id}
										<p class="error small">{form.error}</p>
									{/if}
									<form method="POST" action="?/update" use:enhance={() => () => { editing = null; }}>
										<input type="hidden" name="id" value={a.id} />
										<div class="form-row">
											<label>
												<span>Week</span>
												<input type="number" name="week" min="1" max="52" required value={a.week} />
											</label>
											<label class="grow">
												<span>Title</span>
												<input type="text" name="title" required value={a.title} />
											</label>
											<label>
												<span>Due date</span>
												<input type="date" name="due_date" value={a.dueDate} />
											</label>
										</div>
										<label>
											<span>Description</span>
											<textarea name="description" rows="2">{a.description}</textarea>
										</label>
										<fieldset>
											<legend>Accepted submissions</legend>
											<div class="checkbox-row">
												{#each ALL_TYPES as t}
													<label class="checkbox-label">
														<input type="checkbox" name="accepted_types" value={t} checked={a.acceptedTypes.includes(t)} />
														{TYPE_LABELS[t]}
													</label>
												{/each}
											</div>
										</fieldset>
										<div class="form-actions">
											<button type="button" class="btn-ghost" onclick={() => (editing = null)}>Cancel</button>
											<button type="submit" class="btn-primary small">Save</button>
										</div>
									</form>
								</div>
							{:else}
								<!-- ── Read view ── -->
								<div class="row-info">
									<span class="row-title">{a.title}</span>
									{#if a.dueDate}
										<span class="row-due">Due {new Date(a.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
									{/if}
									<span class="row-types">{a.acceptedTypes.map((t) => TYPE_LABELS[t]).join(', ')}</span>
									<span class="row-subs">{a.submissionCount} sub{a.submissionCount === 1 ? '' : 's'}</span>
								</div>
								<div class="row-actions">
									<button class="btn-edit" onclick={() => (editing = a.id)}>Edit</button>
									<form method="POST" action="?/delete" use:enhance>
										<input type="hidden" name="id" value={a.id} />
										<button type="submit" class="btn-delete" onclick={(e) => { if (!confirm('Delete this assignment?')) e.preventDefault(); }}>Delete</button>
									</form>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}

	header {
		display: flex;
		align-items: center;
		gap: 2rem;
		padding: 1rem 2rem;
		border-bottom: 1.5px solid #ddd7cc;
	}

	.wordmark {
		font-family: 'Cambridge', serif;
		font-size: 1.25rem;
		color: var(--ink);
		text-decoration: none;
		flex-shrink: 0;
	}
	.wordmark:hover { opacity: 0.7; }

	nav { display: flex; gap: 1.25rem; font-size: 0.875rem; }
	nav a { color: #a09688; text-decoration: none; font-weight: 500; }
	nav a:hover, nav a.active { color: var(--ink); }

	main {
		padding: 2rem;
		max-width: 860px;
		width: 100%;
		margin: 0 auto;
		display: block;
		min-height: unset;
		place-items: unset;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-shrink: 0;
	}

	h1 {
		font-family: 'Cambridge', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 0.25rem;
	}

	.subtitle {
		font-size: 0.82rem;
		color: #a09688;
		margin: 0;
	}
	.subtitle a { color: inherit; }

	/* ── Forms ── */
	.create-card, .inline-form-card {
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 2rem;
	}
	.create-card h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0 0 1rem;
	}
	.inline-form-card {
		margin-bottom: 0.5rem;
		border-color: #c8c1b4;
	}

	form { display: flex; flex-direction: column; gap: 0.6rem; }

	.form-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.grow { flex: 1; min-width: 160px; }

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.82rem;
		font-weight: 500;
	}

	fieldset {
		border: 1.5px solid #c8c1b4;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		margin: 0;
	}
	legend { font-size: 0.82rem; font-weight: 500; padding: 0 0.2rem; }
	.checkbox-row { display: flex; gap: 1rem; margin-top: 0.35rem; }
	.checkbox-label {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		font-weight: 400;
		cursor: pointer;
	}

	input[type="text"],
	input[type="number"],
	input[type="date"],
	textarea {
		padding: 0.5rem 0.7rem;
		border: 1.5px solid #c8c1b4;
		border-radius: 8px;
		background: #fff;
		font-family: inherit;
		font-size: 0.875rem;
		color: var(--ink);
		outline: none;
		transition: border-color 0.15s;
		resize: vertical;
	}
	input:focus, textarea:focus { border-color: var(--ink); }
	input[type="number"] { width: 72px; }

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}

	/* ── Buttons ── */
	.btn-primary {
		padding: 0.5rem 1.1rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }
	.btn-primary.small { padding: 0.35rem 0.85rem; font-size: 0.82rem; }

	.btn-ghost {
		padding: 0.35rem 0.75rem;
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.82rem;
		color: #a09688;
		cursor: pointer;
	}
	.btn-ghost:hover { color: var(--ink); }

	.btn-add-inline {
		padding: 0.25rem 0.65rem;
		background: none;
		border: 1.5px solid #c8c1b4;
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 500;
		color: #a09688;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-add-inline:hover { border-color: var(--ink); color: var(--ink); }

	.btn-edit {
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink);
		background: none;
		border: 1.5px solid #c8c1b4;
		border-radius: 6px;
		padding: 0.2rem 0.55rem;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.btn-edit:hover { border-color: var(--ink); }

	.btn-delete {
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: #c0392b;
		background: none;
		border: 1.5px solid transparent;
		border-radius: 6px;
		padding: 0.2rem 0.55rem;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.btn-delete:hover { border-color: #c0392b; }

	.req { color: #c0392b; }

	.error {
		padding: 0.5rem 0.75rem;
		background: #fff0f0;
		border: 1.5px solid #f5c6cb;
		border-radius: 8px;
		color: #c0392b;
		font-size: 0.85rem;
		margin: 0;
	}
	.error.small { font-size: 0.8rem; padding: 0.35rem 0.6rem; }

	/* ── Week blocks ── */
	.week-block { margin-bottom: 2.5rem; }

	.week-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.6rem;
	}

	.week-header h2 {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: #a09688;
		margin: 0;
	}

	.assignment-table {
		border: 1.5px solid #ddd7cc;
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
	}

	.row {
		border-bottom: 1px solid #f0ece4;
	}
	.row:last-child { border-bottom: none; }

	.row-info {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		flex: 1;
		min-width: 0;
	}

	/* When in read mode, row is flex */
	.row:not(:has(.edit-form)) {
		display: flex;
		align-items: center;
	}

	.row-title {
		font-weight: 600;
		font-size: 0.9rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-due {
		font-size: 0.8rem;
		color: #555;
		white-space: nowrap;
	}

	.row-types {
		font-size: 0.75rem;
		color: #a09688;
		white-space: nowrap;
	}

	.row-subs {
		font-size: 0.75rem;
		color: #a09688;
		white-space: nowrap;
		min-width: 50px;
		text-align: right;
	}

	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.75rem;
		flex-shrink: 0;
	}

	.row-actions form { flex-direction: row; }

	.edit-form { padding: 1rem; }

	.empty { color: #a09688; font-size: 0.9rem; }
</style>
