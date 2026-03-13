<script>
	import { enhance } from '$app/forms';
	import ClassSwitcher from '$lib/components/ClassSwitcher.svelte';

	let { data, form } = $props();
	const isInstructor = data.role === 'instructor';

	const TYPE_LABELS = { link: 'Link', image: 'Image', video: 'Video' };
	const ALL_TYPES = ['link', 'image', 'video'];

	let showForm = $state(false);
	// Track which assignment's submit form is open (by id)
	let openSubmit = $state(null);
	// Track chosen submission type per assignment
	let submitTypes = $state({});

	function displayName(sub) {
		return sub.name || sub.email;
	}
</script>

<svelte:head>
	<title>Assignments — eating.computer</title>
</svelte:head>

<div class="shell">
	<header>
		<div class="wordmark-wrap">
			<a class="wordmark" href="/">eating.computer</a>
			<ClassSwitcher currentClass={data.currentClass} allClasses={data.allClasses} />
		</div>
		<nav>
			<a href="/app">Dashboard</a>
			<a href="/app/assignments" class="active">Assignments</a>
			{#if isInstructor}
				<a href="/app/manage">Manage</a>
			{/if}
		</nav>
	</header>

	<main>
		<div class="page-header">
			<h1>Assignments</h1>
			{#if isInstructor}
				<button class="btn-secondary" onclick={() => (showForm = !showForm)}>
					{showForm ? 'Cancel' : '+ New assignment'}
				</button>
			{/if}
		</div>

		<!-- ── Instructor: create form ── -->
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

		<!-- ── Assignment list ── -->
		{#if data.weeks.length === 0}
			<p class="empty">No assignments yet.</p>
		{:else}
			{#each data.weeks as { week, assignments }}
				<section class="week-section">
					<h2 class="week-label">Week {week}</h2>

					<div class="assignment-list">
						{#each assignments as a}
							<div class="assignment-card">
								<!-- Card header -->
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

								<!-- Accepted types note -->
								<p class="accepted-note">
									Accepted: {a.acceptedTypes.map((t) => TYPE_LABELS[t]).join(', ')}
								</p>

								<!-- ── Student: submit / my submission ── -->
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

											<!-- Type selector (only if multiple types accepted) -->
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

								<!-- ── Instructor: submissions list ── -->
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

	.wordmark-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex-shrink: 0;
	}

	.wordmark {
		font-family: 'Cambridge', serif;
		font-size: 1.25rem;
		color: var(--ink);
		text-decoration: none;
	}
	.wordmark:hover { opacity: 0.7; }


	nav { display: flex; gap: 1.25rem; font-size: 0.875rem; }
	nav a { color: #a09688; text-decoration: none; font-weight: 500; }
	nav a:hover, nav a.active { color: var(--ink); }

	main {
		padding: 2rem;
		max-width: 760px;
		width: 100%;
		margin: 0 auto;
		display: block;
		min-height: unset;
		place-items: unset;
	}

	.page-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-family: 'Cambridge', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0;
	}

	/* ── Create form ── */
	.create-card {
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
		border: 1.5px solid #c8c1b4;
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
		border: 1.5px solid #c8c1b4;
		border-radius: 8px;
		background: #fff;
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
		border: 1.5px solid #c8c1b4;
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
		color: #a09688;
		cursor: pointer;
	}
	.btn-ghost:hover { color: var(--ink); }

	.btn-submit {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		background: none;
		border: 1.5px solid #c8c1b4;
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
		color: #c8c1b4;
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
		flex-shrink: 0;
		transition: color 0.15s;
	}
	.btn-delete:hover { color: #c0392b; }

	.required { color: #c0392b; }

	.error {
		padding: 0.5rem 0.75rem;
		background: #fff0f0;
		border: 1.5px solid #f5c6cb;
		border-radius: 8px;
		color: #c0392b;
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
		color: #a09688;
		margin: 0 0 0.75rem;
	}

	.assignment-list { display: flex; flex-direction: column; gap: 0.75rem; }

	.assignment-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: #fff;
		border: 1.5px solid #ddd7cc;
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
	.assignment-desc { font-size: 0.875rem; color: #555; margin: 0; white-space: pre-wrap; }
	.due { font-size: 0.8rem; color: #a09688; margin: 0; }

	/* ── Accepted types note ── */
	.accepted-note {
		font-size: 0.78rem;
		color: #a09688;
		margin: 0;
		border-top: 1px solid #f0ece4;
		padding-top: 0.5rem;
	}

	/* ── Student submission ── */
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
		border: 1.5px solid #c8c1b4;
		border-radius: 6px;
		background: none;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: #a09688;
		cursor: pointer;
		transition: all 0.15s;
	}
	.type-tab.active { border-color: var(--ink); color: var(--ink); }
	.type-tab:hover { border-color: var(--ink); color: var(--ink); }

	.submit-actions { display: flex; align-items: center; gap: 0.25rem; }

	/* ── Instructor submissions ── */
	.submissions-section {
		border-top: 1px solid #f0ece4;
		padding-top: 0.6rem;
	}
	.submissions-header {
		font-size: 0.78rem;
		color: #a09688;
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
		color: #a09688;
		background: #f5f0e8;
		padding: 0.1rem 0.45rem;
		border-radius: 99px;
	}
	.sub-link { color: var(--ink); font-size: 0.82rem; }

	.empty { color: #a09688; font-size: 0.9rem; }

	@media (max-width: 640px) {
		header {
			position: fixed; top: 0; left: 0; right: 0; z-index: 10;
			background: var(--paper);
			flex-wrap: wrap;
			padding: 0.75rem 1rem;
			gap: 0.4rem 1.5rem;
			align-items: flex-start;
		}
		nav { font-size: 0.8rem; gap: 0.75rem; }

		main { padding: 1.25rem 1rem; padding-top: 5.5rem; padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem); }
		h1 { font-size: 1.5rem; }
		.page-header { margin-bottom: 1rem; }

		.create-card { padding: 1rem; }
		.form-row { flex-direction: column; gap: 0.5rem; }
		.checkbox-row { flex-wrap: wrap; gap: 0.5rem 1rem; }

		.week-section { margin-bottom: 1.5rem; }
		.card { padding: 1rem; }
		.card-top { flex-wrap: wrap; gap: 0.5rem; }

		.submission-item { flex-wrap: wrap; gap: 0.35rem; }
		.sub-student { min-width: 100%; }

		.submit-form { gap: 0.5rem; }
	}
</style>
