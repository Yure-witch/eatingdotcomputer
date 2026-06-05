<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '$lib/push.js';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';
	import FormattedInput from '$lib/components/FormattedInput.svelte';
	import { createContentRenderer } from '$lib/message-render.js';

	const { contentHtml } = createContentRenderer();

	let { data, form } = $props();
	const user = data.session.user;
	const isInstructor = user.role === 'instructor';

	// ── Notifications / Install ──
	let pushSupported = $state(false);
	let pushSubscribed = $state(false);
	let pushLoading = $state(false);
	let pushError = $state(null);
	let notifPermission = $state('default');
	let installPrompt = $state(null);
	let isStandalone = $state(false);
	let isMobile = $state(false);
	let isIOS = $state(false);
	let isAndroid = $state(false);

	let notifOnboarded = $state(true);
	let gateLoading = $state(false);

	onMount(async () => {
		if (!browser) return;
		const refreshTimer = setInterval(() => invalidateAll(), 30_000);
		isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
		const iosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent);
		const androidDevice = /android/i.test(navigator.userAgent);
		isMobile = iosDevice || androidDevice;
		isIOS = iosDevice && !isStandalone;
		isAndroid = androidDevice && !isStandalone;
		pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !(iosDevice && !isStandalone);
		if (pushSupported) {
			pushSubscribed = await isPushSubscribed();
			notifPermission = Notification.permission;
		}
		const onboarded = localStorage.getItem('pwa_notif_onboarded') === '1';
		notifOnboarded = onboarded || !isStandalone || !pushSupported || notifPermission !== 'default';
		window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
		window.addEventListener('appinstalled', () => { isStandalone = true; installPrompt = null; });
		return () => clearInterval(refreshTimer);
	});

	async function install() {
		if (!installPrompt) return;
		installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') isStandalone = true;
		installPrompt = null;
	}

	async function togglePush() {
		pushLoading = true; pushError = null;
		if (pushSubscribed) { await unsubscribeFromPush(); pushSubscribed = false; }
		else {
			const result = await subscribeToPush();
			if (result?.error) pushError = result.error;
			else pushSubscribed = true;
		}
		notifPermission = Notification.permission;
		pushLoading = false;
	}

	async function requestPermission() {
		const result = await Notification.requestPermission();
		notifPermission = result;
		if (result === 'granted') await togglePush();
	}

	async function gateEnable() {
		gateLoading = true;
		await requestPermission();
		gateLoading = false;
		localStorage.setItem('pwa_notif_onboarded', '1');
		notifOnboarded = true;
	}

	function gateSkip() {
		localStorage.setItem('pwa_notif_onboarded', '1');
		notifOnboarded = true;
	}

	// ── Instructor: create form state ──
	let headlineValue = $state('');
	let items = $state([{ label: '', requiresSubmission: false, acceptedTypes: ['link'], resourceUrl: '', resourceLabel: '', resourceFile: null }]);

	function addItem() {
		items = [...items, { label: '', requiresSubmission: false, acceptedTypes: ['link'], resourceUrl: '', resourceLabel: '', resourceFile: null }];
	}

	function removeItem(i) {
		items = items.filter((_, idx) => idx !== i);
	}

	function toggleItemType(i, type) {
		const cur = items[i].acceptedTypes;
		if (cur.includes(type)) {
			items[i].acceptedTypes = cur.filter((t) => t !== type);
			if (items[i].acceptedTypes.length === 0) items[i].acceptedTypes = ['link'];
		} else {
			items[i].acceptedTypes = [...cur, type];
		}
		items = [...items];
	}

	// ── Instructor: expanded item submissions ──
	let expandedItemSubs = $state(null); // item id whose submissions are shown

	// ── Student: UI state ──
	let expandedItemId = $state(null);
	let submitType = $state('');

	// Optimistic completions (clone from server data)
	let completions = $state({ ...data.completions });

	function formatDate(iso) {
		if (!iso) return null;
		const d = new Date(iso + 'T00:00:00');
		return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
	}

	function timeAgo(isoStr) {
		const ms = Date.now() - new Date(isoStr).getTime();
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}
</script>

<svelte:head><title>eating.computer</title></svelte:head>

<!-- PWA notification gate -->
{#if !notifOnboarded}
	<div class="gate-overlay">
		<div class="gate-card">
			<a class="gate-wordmark" href="/">eating.computer</a>
			<div class="gate-icon">🔔</div>
			<h1 class="gate-title">Stay in the loop</h1>
			<p class="gate-body">
				Enable notifications so you hear about new assignments, messages, and class updates the moment they happen.
			</p>
			<button class="gate-btn-primary" onclick={gateEnable} disabled={gateLoading}>
				{gateLoading ? 'Setting up…' : 'Enable notifications'}
			</button>
			{#if notifPermission === 'denied'}
				<p class="gate-denied">Notifications are blocked in your browser settings. Please enable them there, then reload.</p>
			{/if}
			<button class="gate-btn-skip" onclick={gateSkip}>Not now</button>
		</div>
	</div>
{/if}

<div class="shell">
	<main>
		{#if isInstructor}
			<!-- ══════════════ INSTRUCTOR VIEW ══════════════ -->
			<form method="POST" action="?/createWeekPlan" enctype="multipart/form-data" class="create-form" use:enhance={() => {
				return async ({ update }) => {
					await update();
					headlineValue = '';
					items = [{ label: '', requiresSubmission: false, acceptedTypes: ['link'], resourceUrl: '', resourceLabel: '', resourceFile: null }];
				};
			}}>
				<input type="hidden" name="class_id" value={data.classId} />
				<input type="hidden" name="week" value={data.nextWeekNumber} />

				<p class="week-number">Week {data.nextWeekNumber}</p>

				<div class="field">
					<label>Headline</label>
					<input type="hidden" name="headline" value={headlineValue} />
					<FormattedInput bind:value={headlineValue} placeholder="e.g. Read Chapter 3 and sketch 2 concepts" singleLine />
				</div>

				<div class="field">
					<label for="due_date">Due date</label>
					<input id="due_date" name="due_date" type="date" />
				</div>

				<div class="field">
					<label>Checklist items</label>
					<div class="items-list">
						{#each items as item, i}
							<div class="item-row">
								<div class="item-main">
									<input type="hidden" name="item_label" value={item.label} />
									<FormattedInput bind:value={item.label} placeholder="e.g. Read the assigned article" singleLine />
									<input type="hidden" name="item_requires_submission" value={item.requiresSubmission ? '1' : '0'} />
									<label class="req-toggle">
										<input type="checkbox" bind:checked={item.requiresSubmission} />
										Requires submission
									</label>
									{#if items.length > 1}
										<button type="button" class="remove-item" onclick={() => removeItem(i)}>×</button>
									{/if}
								</div>
								<div class="item-resource">
									{#if item.resourceFile}
										<div class="resource-file-preview">
											<FileTypeIcon filename={item.resourceFile.name} mimetype={item.resourceFile.type} iconSize={24} />
											<span class="resource-file-name">{item.resourceFile.name}</span>
											<button type="button" class="remove-item" onclick={() => { item.resourceFile = null; items = [...items]; }}>×</button>
										</div>
										<input type="hidden" name="item_resource_url" value="" />
										<input type="hidden" name="item_resource_label" value="" />
									{:else}
										<input type="text" name="item_resource_url" bind:value={item.resourceUrl} placeholder="Attach a link (optional)" class="resource-input" />
										{#if item.resourceUrl.trim()}
											<input type="text" name="item_resource_label" bind:value={item.resourceLabel} placeholder="Label (optional)" class="resource-label-input" />
										{:else}
											<input type="hidden" name="item_resource_label" value="" />
										{/if}
										<label class="upload-btn" title="Upload a file">
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
											<input type="file" name="item_resource_file_{i}" class="sr-only" onchange={(e) => { item.resourceFile = e.target.files[0] || null; items = [...items]; }} />
										</label>
									{/if}
								</div>
								{#if item.requiresSubmission}
									<div class="item-types">
										<span class="types-label">Accept:</span>
										{#each ['link', 'text', 'image', 'video'] as t}
											<label class="type-check">
												<input type="checkbox" name="item_accepted_types_{i}" value={t} checked={item.acceptedTypes.includes(t)} onchange={() => toggleItemType(i, t)} />
												{t.charAt(0).toUpperCase() + t.slice(1)}
											</label>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
					<button type="button" class="btn-add-item" onclick={addItem}>+ Add item</button>
				</div>

				<div class="field">
					<label for="topic_preview">Next week preview <span class="optional">(optional)</span></label>
					<input id="topic_preview" name="topic_preview" type="text" placeholder="e.g. Introduction to Prototyping" />
				</div>

				{#if form?.error && form?.action === 'createWeekPlan'}
					<p class="form-error">{form.error}</p>
				{/if}

				<button type="submit" class="btn-primary">Publish week</button>
			</form>

			<!-- All assignments with submissions grouped per item -->
			{#if data.allPlans.length > 0}
				<div class="divider"></div>
				<p class="section-label">All Assignments</p>
				<div class="assignments-overview">
					{#each [...data.allPlans].reverse() as plan}
						<div class="overview-plan" class:is-current={plan.id === data.currentPlan?.id}>
							<div class="overview-header">
								<span class="overview-week">Week {plan.week}</span>
								<span class="overview-title">{@html contentHtml(plan.headline, false)}</span>
								{#if plan.dueDate}
									<span class="overview-due">{formatDate(plan.dueDate)}</span>
								{/if}
								<form method="POST" action="?/toggleWeekVisibility" use:enhance class="vis-toggle-form">
									<input type="hidden" name="plan_id" value={plan.id} />
									<input type="hidden" name="show" value={plan.showSubmissions ? '0' : '1'} />
									<button type="submit" class="vis-toggle-btn" class:vis-on={plan.showSubmissions} title={plan.showSubmissions ? 'Submissions visible to students — click to hide' : 'Submissions hidden from students — click to show'}>
										{#if plan.showSubmissions}
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
										{:else}
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
										{/if}
									</button>
								</form>
							</div>
							{#if plan.items.length > 0}
								<div class="overview-items">
									{#each plan.items as item}
										{@const subs = data.submissionsByItem[item.id] ?? []}
										{@const isOpen = expandedItemSubs === item.id}
										<div class="overview-item-block">
											<button class="overview-item" class:has-subs={subs.length > 0} onclick={() => expandedItemSubs = isOpen ? null : item.id}>
												<span class="overview-item-label">{@html contentHtml(item.label, false)}</span>
												{#if item.requiresSubmission}
													<span class="preview-badge">submission</span>
												{/if}
												{#if subs.length > 0}
													<span class="overview-item-count has-completions">{subs.length} done</span>
													<span class="overview-chevron" class:open={isOpen}>›</span>
												{:else}
													<span class="overview-item-count">0 done</span>
												{/if}
											</button>
											{#if isOpen && subs.length > 0}
												<div class="item-subs-list">
													{#each subs as sub}
														<div class="item-sub-row">
															<span class="sub-name">{sub.studentName}</span>
															{#if sub.submissionType === 'link'}
																<a href={sub.submissionUrl} target="_blank" rel="noopener noreferrer" class="sub-link-full">{sub.submissionValue}</a>
															{:else if sub.submissionType === 'text'}
																<p class="sub-text-content">{sub.submissionValue}</p>
															{:else if sub.submissionType === 'image'}
																<a href={sub.submissionUrl} target="_blank" rel="noopener noreferrer">
																	<img src={sub.submissionUrl} alt="Submission by {sub.studentName}" class="sub-image" />
																</a>
															{:else if sub.submissionType === 'video'}
																<!-- svelte-ignore a11y_media_has_caption -->
																<video src={sub.submissionUrl} controls class="sub-video"></video>
															{:else}
																<span class="sub-type">checked off</span>
															{/if}
															<span class="sub-time">{timeAgo(sub.completedAt)}</span>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
							<form method="POST" action="?/deleteWeekPlan" use:enhance style="margin-top: 0.5rem;">
								<input type="hidden" name="id" value={plan.id} />
								<button type="submit" class="btn-delete-plan">Delete</button>
							</form>
						</div>
					{/each}
				</div>
			{/if}

		{:else}
			<!-- ══════════════ STUDENT VIEW ══════════════ -->

			{#if data.currentPlan}
				<div class="week-meta">
					<span class="week-tag">Week {data.currentPlan.week}</span>
					{#if data.currentPlan.dueDate}
						<span class="due-date">Due {formatDate(data.currentPlan.dueDate)}</span>
					{/if}
				</div>

				<h1 class="headline">{@html contentHtml(data.currentPlan.headline, false)}</h1>

				{#if data.currentPlan.items.length > 0}
					<div class="checklist">
						{#each data.currentPlan.items as item (item.id)}
							{@const done = !!completions[item.id]}
							{@const peers = data.peerSubmissions?.[item.id] ?? []}
							<div class="check-row" class:completed={done}>
								{#if item.requiresSubmission}
									<!-- Submission item -->
									<div class="check-box-wrap">
										<div class="check-box" class:checked={done}>
											{#if done}
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
											{/if}
										</div>
									</div>
									<div class="check-content">
										<span class="check-label" class:done>{@html contentHtml(item.label, false)}</span>
										{#if item.resourceUrl}
											<a href={item.resourceUrl} target="_blank" rel="noopener noreferrer" class="item-resource-chip">
												{#if item.resourceFilename}
													<FileTypeIcon filename={item.resourceFilename} mimetype={item.resourceMimetype ?? ''} url={item.resourceMimetype?.startsWith('image/') ? item.resourceUrl : ''} iconSize={22} />
													<span class="resource-chip-name">{item.resourceLabel || item.resourceFilename}</span>
												{:else}
													<svg class="resource-chip-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
													<span class="resource-chip-name">{item.resourceLabel || item.resourceUrl}</span>
												{/if}
												<svg class="resource-chip-ext" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
											</a>
										{/if}
										{#if done}
											<span class="submitted-tag">Submitted</span>
										{:else if expandedItemId === item.id}
											<div class="inline-submit">
												{#if form?.error && form?.action === 'completeItem' && form?.itemId === item.id}
													<p class="form-error">{form.error}</p>
												{/if}
												<div class="submit-type-tabs">
													{#each item.acceptedTypes as t}
														<button type="button" class="type-tab" class:active={submitType === t} onclick={() => submitType = t}>
															{t.charAt(0).toUpperCase() + t.slice(1)}
														</button>
													{/each}
												</div>
												{#if submitType}
													<form method="POST" action="?/completeItem" enctype="multipart/form-data" use:enhance={() => {
														return async ({ update }) => {
															await update();
															expandedItemId = null;
															submitType = '';
														};
													}}>
														<input type="hidden" name="item_id" value={item.id} />
														<input type="hidden" name="requires_submission" value="1" />
														<input type="hidden" name="type" value={submitType} />
														{#if submitType === 'link'}
															<input type="url" name="link" placeholder="https://…" class="submit-input" required />
														{:else if submitType === 'text'}
															<textarea name="text" placeholder="Type your response…" class="submit-input submit-textarea" rows="4" required></textarea>
														{:else}
															<input type="file" name="file" accept={submitType === 'image' ? 'image/*' : 'video/*'} class="submit-input" required />
														{/if}
														<div class="submit-row">
															<button type="submit" class="btn-primary sm">Submit</button>
															<button type="button" class="btn-ghost sm" onclick={() => { expandedItemId = null; submitType = ''; }}>Cancel</button>
														</div>
													</form>
												{/if}
											</div>
										{:else}
											<button class="btn-submit-inline" onclick={() => { expandedItemId = item.id; submitType = item.acceptedTypes[0]; }}>
												Submit
											</button>
										{/if}
									</div>
								{:else}
									<!-- Self-check item -->
									{#if done}
										<form method="POST" action="?/uncompleteItem" use:enhance={() => {
											completions = { ...completions };
											delete completions[item.id];
											return async ({ update }) => { await update({ reset: false }); };
										}}>
											<input type="hidden" name="item_id" value={item.id} />
											<button type="submit" class="check-box-wrap check-btn">
												<div class="check-box checked">
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
												</div>
											</button>
										</form>
									{:else}
										<form method="POST" action="?/completeItem" use:enhance={() => {
											completions = { ...completions, [item.id]: { completedAt: new Date().toISOString() } };
											return async ({ update }) => { await update({ reset: false }); };
										}}>
											<input type="hidden" name="item_id" value={item.id} />
											<input type="hidden" name="requires_submission" value="0" />
											<button type="submit" class="check-box-wrap check-btn">
												<div class="check-box"></div>
											</button>
										</form>
									{/if}
									<div class="check-content">
										<span class="check-label" class:done>{@html contentHtml(item.label, false)}</span>
										{#if item.resourceUrl}
											<a href={item.resourceUrl} target="_blank" rel="noopener noreferrer" class="item-resource-chip">
												{#if item.resourceFilename}
													<FileTypeIcon filename={item.resourceFilename} mimetype={item.resourceMimetype ?? ''} url={item.resourceMimetype?.startsWith('image/') ? item.resourceUrl : ''} iconSize={22} />
													<span class="resource-chip-name">{item.resourceLabel || item.resourceFilename}</span>
												{:else}
													<svg class="resource-chip-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
													<span class="resource-chip-name">{item.resourceLabel || item.resourceUrl}</span>
												{/if}
												<svg class="resource-chip-ext" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
											</a>
										{/if}
									</div>
								{/if}
								{#if peers.length > 0}
									<div class="peer-subs">
										<span class="peer-subs-label">Classmates</span>
										{#each peers.filter(p => p.studentId !== data.session.user.id) as sub}
											<div class="peer-sub-row">
												<span class="peer-name">{sub.studentName}</span>
												{#if sub.submissionType === 'link'}
													<a href={sub.submissionUrl} target="_blank" rel="noopener noreferrer" class="peer-link">{sub.submissionValue}</a>
												{:else if sub.submissionType === 'text'}
													<p class="peer-text">{sub.submissionValue}</p>
												{:else if sub.submissionType === 'image'}
													<a href={sub.submissionUrl} target="_blank" rel="noopener noreferrer">
														<img src={sub.submissionUrl} alt="by {sub.studentName}" class="peer-img" />
													</a>
												{:else if sub.submissionType === 'video'}
													<!-- svelte-ignore a11y_media_has_caption -->
													<video src={sub.submissionUrl} controls class="peer-video"></video>
												{:else}
													<span class="peer-check">done</span>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Next week preview -->
				{#if data.nextPlan}
					<div class="next-preview">
						<span class="next-label">Next week</span>
						<span class="next-text">{@html contentHtml(data.nextPlan.topicPreview || data.nextPlan.headline, false)}</span>
					</div>
				{/if}

				<div class="bottom-links">
					<a href="/app/atlas" class="atlas-link">View previous weeks →</a>
				</div>

			{:else}
				<div class="empty-state">
					<h1>No assignments yet</h1>
					<p>Check back soon.</p>
				</div>
			{/if}
		{/if}

		<!-- Mobile install instructions -->
		{#if isMobile && !isStandalone}
			<div class="install-banner">
				<p class="install-banner-title">📲 Install eating.computer</p>
				{#if installPrompt}
					<p class="install-banner-sub">Add to your home screen for the full experience.</p>
					<button class="btn-primary" onclick={install}>Install app</button>
				{:else if isIOS}
					<p class="install-banner-sub">To install on iPhone or iPad:</p>
					<ol class="install-steps">
						<li>Tap the <strong>Share</strong> button <span class="ios-share">⎙</span> at the bottom of Safari</li>
						<li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
						<li>Tap <strong>Add</strong></li>
					</ol>
				{:else if isAndroid}
					<p class="install-banner-sub">To install on Android:</p>
					<ol class="install-steps">
						<li>Tap the <strong>⋮ menu</strong> in Chrome</li>
						<li>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></li>
						<li>Tap <strong>Install</strong></li>
					</ol>
				{/if}
			</div>
		{/if}

		<!-- Notification settings -->
		{#if isStandalone && notifOnboarded && pushSupported}
			<div class="utility-row">
				{#if pushSubscribed}
					<button class="utility-chip" onclick={togglePush} disabled={pushLoading}>
						🔔 {pushLoading ? '…' : 'Disable notifications'}
					</button>
				{:else if notifPermission === 'granted'}
					<button class="utility-chip" onclick={togglePush} disabled={pushLoading}>
						🔕 {pushLoading ? '…' : 'Re-enable notifications'}
					</button>
				{:else if notifPermission === 'denied'}
					<p class="muted">Notifications blocked — enable them in Settings.</p>
				{/if}
				{#if pushError}<p class="form-error">{pushError}</p>{/if}
			</div>
		{/if}
	</main>
</div>

<style>

	.shell { min-height: 100dvh; display: flex; flex-direction: column; background: var(--paper); }

	/* Main */
	main {
		flex: 1; padding: 2.5rem 1.5rem; padding-top: calc(2.5rem + 52px); max-width: 680px;
		width: 100%; margin: 0 auto; box-sizing: border-box;
	}

	/* ── Week meta ── */
	.week-meta { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem; }
	.week-tag {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.08em; color: var(--muted-fg);
	}
	.due-date { font-size: 0.88rem; color: #e07550; font-weight: 500; }

	/* ── Student: headline ── */
	.headline {
		font-family: 'Avara', serif; font-size: 2.25rem; font-weight: 400;
		color: var(--ink); margin: 0 0 2rem; line-height: 1.2;
	}

	/* ── Student: checklist ── */
	.checklist { display: flex; flex-direction: column; gap: 0; }
	.check-row {
		display: flex; align-items: flex-start; gap: 0.875rem;
		padding: 1rem 0; border-bottom: 1px solid var(--surface-2);
	}
	.check-row:first-child { border-top: 1px solid var(--surface-2); }

	.check-box-wrap {
		flex-shrink: 0; display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; padding: 0; margin-top: 1px;
	}
	.check-btn {
		background: none; border: none; cursor: pointer; padding: 0;
		display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px;
	}
	.check-box {
		width: 24px; height: 24px; border: 2px solid var(--border); border-radius: 6px;
		display: flex; align-items: center; justify-content: center;
		transition: all 0.15s; background: var(--paper);
	}
	.check-box.checked {
		background: var(--ink); border-color: var(--ink); color: var(--paper);
	}
	.check-btn:hover .check-box:not(.checked) { border-color: var(--muted-fg); }

	.check-content {
		flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem;
	}
	.check-label {
		font-size: 1.05rem; color: var(--ink); line-height: 1.4;
	}
	.check-label.done { color: var(--muted-fg); text-decoration: line-through; }

	.submitted-tag {
		display: inline-flex; align-items: center; gap: 0.3rem;
		font-size: 0.78rem; font-weight: 600; color: #2e7d32;
	}

	.item-resource-chip {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.3rem 0.6rem; background: var(--surface-2); border: 1.5px solid var(--border);
		border-radius: 8px; text-decoration: none; color: var(--ink);
		font-size: 0.82rem; transition: background 0.15s;
	}
	.item-resource-chip:hover { background: var(--surface-2); }
	.resource-chip-name {
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;
	}
	.resource-chip-icon { flex-shrink: 0; color: var(--muted-fg); }
	.resource-chip-ext { flex-shrink: 0; color: var(--border); }

	.resource-file-preview {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.3rem 0.5rem; background: var(--surface-2); border-radius: 8px;
		font-size: 0.82rem;
	}
	.resource-file-name {
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
	}

	.upload-btn {
		display: flex; align-items: center; justify-content: center;
		width: 34px; height: 34px; border: 1.5px solid var(--border); border-radius: 8px;
		cursor: pointer; color: var(--muted-fg); transition: all 0.15s; flex-shrink: 0;
		text-transform: none; letter-spacing: 0; font-weight: 400;
	}
	.upload-btn:hover { border-color: var(--ink); color: var(--ink); }
	.sr-only {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0,0,0,0); border: 0;
	}

	.submit-textarea {
		resize: vertical; min-height: 80px; font-family: inherit; line-height: 1.5;
	}

	.btn-submit-inline {
		align-self: flex-start;
		padding: 0.4rem 1rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 8px; font-family: inherit; font-size: 0.82rem;
		font-weight: 600; cursor: pointer; transition: opacity 0.15s;
	}
	.btn-submit-inline:hover { opacity: 0.82; }

	/* Inline submit form */
	.inline-submit { display: flex; flex-direction: column; gap: 0.6rem; }
	.submit-type-tabs { display: flex; gap: 0.4rem; }
	.type-tab {
		padding: 0.3rem 0.75rem; border: 1.5px solid var(--border); border-radius: 99px;
		background: none; font-family: inherit; font-size: 0.8rem; color: var(--muted-fg); cursor: pointer;
	}
	.type-tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.submit-input {
		width: 100%; box-sizing: border-box; padding: 0.55rem 0.75rem;
		border: 1.5px solid var(--border); border-radius: 8px; background: var(--paper);
		font-family: inherit; font-size: 0.88rem; color: var(--ink); outline: none;
	}
	.submit-input:focus { border-color: var(--ink); }
	.submit-row { display: flex; gap: 0.5rem; align-items: center; }

	/* Next week preview */
	.next-preview {
		display: flex; align-items: baseline; gap: 0.6rem;
		margin-top: 2rem; padding: 1rem 0;
		border-top: 2px solid var(--border);
	}
	.next-label {
		font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.07em; color: var(--muted-fg); flex-shrink: 0;
	}
	.next-text { font-size: 1rem; color: var(--muted-fg); font-style: italic; }

	/* Bottom links */
	.bottom-links { margin-top: 1.5rem; }
	.atlas-link {
		font-size: 0.88rem; color: var(--muted-fg); text-decoration: none; font-weight: 500;
	}
	.atlas-link:hover { color: var(--ink); }

	/* ── Instructor ── */
	.week-number {
		font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.08em; color: var(--muted-fg); margin: 0 0 1rem;
	}
	.create-form { display: flex; flex-direction: column; gap: 1.25rem; }
	.field { display: flex; flex-direction: column; gap: 0.4rem; }
	label { font-size: 0.78rem; font-weight: 600; color: var(--muted-fg); text-transform: uppercase; letter-spacing: 0.05em; }
	.optional { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--muted-fg); }

	input[type="text"], input[type="url"], input[type="date"], textarea {
		padding: 0.6rem 0.85rem; border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; transition: border-color 0.15s; width: 100%; box-sizing: border-box;
	}
	input:focus, textarea:focus { border-color: var(--ink); }

	.headline-input { font-size: 1.1rem; padding: 0.75rem 0.85rem; }

	/* Checklist item builder */
	.items-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.item-row {
		background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 10px;
		padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;
	}
	.item-main { display: flex; align-items: center; gap: 0.5rem; }
	.item-input { flex: 1; min-width: 0; }
	.req-toggle {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.78rem; color: var(--ink); font-weight: 400;
		text-transform: none; letter-spacing: 0; cursor: pointer;
		white-space: nowrap; flex-shrink: 0;
	}
	.remove-item {
		background: none; border: none; font-size: 1.2rem; color: var(--border);
		cursor: pointer; padding: 0 0.25rem; line-height: 1; flex-shrink: 0;
	}
	.remove-item:hover { color: var(--danger); }

	.item-resource { display: flex; gap: 0.5rem; }
	.resource-input { flex: 2; min-width: 0; font-size: 0.82rem !important; padding: 0.4rem 0.7rem !important; }
	.resource-label-input { flex: 1; min-width: 60px; font-size: 0.82rem !important; padding: 0.4rem 0.7rem !important; }

	.item-types {
		display: flex; align-items: center; gap: 0.6rem; padding-left: 0.25rem;
	}
	.types-label { font-size: 0.72rem; color: var(--muted-fg); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
	.type-check {
		display: flex; align-items: center; gap: 0.3rem;
		font-size: 0.82rem; color: var(--ink); font-weight: 400;
		text-transform: none; letter-spacing: 0; cursor: pointer;
	}

	.btn-add-item {
		align-self: flex-start; padding: 0.4rem 0.9rem;
		background: none; border: 1.5px dashed var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.82rem; color: var(--muted-fg);
		cursor: pointer; transition: all 0.15s;
	}
	.btn-add-item:hover { border-color: var(--ink); color: var(--ink); }

	/* Divider */
	.divider { border-top: 2px solid var(--border); margin: 2rem 0; }

	.preview-badge {
		font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.05em; color: var(--muted-fg); background: var(--surface-2);
		padding: 0.1rem 0.4rem; border-radius: 99px;
	}
	.btn-delete-plan {
		background: none; border: none; font-family: inherit; font-size: 0.78rem;
		color: var(--danger); cursor: pointer; padding: 0; opacity: 0.6;
	}
	.btn-delete-plan:hover { opacity: 1; }

	.section-label {
		font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.07em; color: var(--muted-fg); margin: 0 0 0.6rem;
	}

	/* Assignments overview */
	.assignments-overview { display: flex; flex-direction: column; gap: 1rem; }
	.overview-plan {
		background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 10px;
		padding: 0.85rem 1rem;
	}
	.overview-plan.is-current { border-color: var(--ink); }
	.overview-header { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
	.overview-week { font-size: 0.72rem; font-weight: 700; color: var(--muted-fg); flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.05em; }
	.overview-title { font-size: 0.95rem; font-weight: 500; color: var(--ink); flex: 1; min-width: 0; }
	.overview-due { font-size: 0.75rem; color: #e07550; white-space: nowrap; }
	.overview-items { display: flex; flex-direction: column; gap: 0; }
	.overview-item-block { border-bottom: 1px solid #eee8df; }
	.overview-item-block:last-child { border-bottom: none; }
	.overview-item {
		display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: var(--ink);
		padding: 0.35rem 0; width: 100%; background: none; border: none;
		font-family: inherit; text-align: left; cursor: default;
	}
	.overview-item.has-subs { cursor: pointer; }
	.overview-item.has-subs:hover { background: var(--surface-2); margin: 0 -0.5rem; padding-left: 0.5rem; padding-right: 0.5rem; border-radius: 6px; width: calc(100% + 1rem); }
	.overview-item-label { flex: 1; min-width: 0; }
	.overview-item-count { font-size: 0.72rem; color: var(--muted-fg); white-space: nowrap; }
	.overview-item-count.has-completions { color: #2e7d32; font-weight: 500; }
	.overview-chevron {
		font-size: 0.9rem; color: var(--muted-fg); transition: transform 0.15s; flex-shrink: 0;
	}
	.overview-chevron.open { transform: rotate(90deg); }

	/* Grouped submissions under each item */
	.item-subs-list {
		display: flex; flex-direction: column; gap: 0;
		padding: 0.25rem 0 0.5rem 1.5rem; border-left: 2px solid var(--border); margin-left: 0.25rem;
	}
	.item-sub-row {
		display: flex; align-items: flex-start; gap: 0.5rem;
		padding: 0.4rem 0; font-size: 0.82rem; border-bottom: 1px solid var(--surface-2);
	}
	.item-sub-row:last-child { border-bottom: none; }
	.sub-name { font-weight: 600; color: var(--ink); flex-shrink: 0; }
	.sub-type { font-size: 0.72rem; color: var(--muted-fg); flex-shrink: 0; }
	.sub-time { font-size: 0.72rem; color: var(--muted-fg); flex-shrink: 0; white-space: nowrap; margin-left: auto; }
	.sub-link-full {
		font-size: 0.82rem; color: #2980b9; word-break: break-all;
		text-decoration: underline; text-underline-offset: 2px; flex: 1; min-width: 0;
	}
	.sub-text-content {
		font-size: 0.82rem; color: var(--ink); margin: 0; line-height: 1.5;
		white-space: pre-wrap; flex: 1; min-width: 0;
	}
	.sub-image { max-width: 100%; max-height: 300px; border-radius: 6px; display: block; }
	.sub-video { max-width: 100%; max-height: 300px; border-radius: 6px; display: block; }

	/* Buttons */
	.btn-primary {
		padding: 0.65rem 1.4rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 10px; font-family: inherit; font-size: 0.9rem;
		font-weight: 600; cursor: pointer; transition: opacity 0.15s; align-self: flex-start;
	}
	.btn-primary:hover { opacity: 0.82; }
	.btn-primary.sm { padding: 0.45rem 1rem; font-size: 0.82rem; }
	.btn-ghost {
		padding: 0.45rem 0.9rem; background: none; border: 1.5px solid var(--border);
		border-radius: 8px; font-family: inherit; font-size: 0.82rem;
		color: var(--ink); cursor: pointer;
	}
	.btn-ghost.sm { padding: 0.4rem 0.8rem; font-size: 0.8rem; }
	.btn-ghost:hover { border-color: var(--ink); }

	.form-error { font-size: 0.82rem; color: var(--danger); margin: 0; }
	.muted { font-size: 0.85rem; color: var(--muted-fg); margin: 0.5rem 0; }

	/* Visibility toggle */
	.vis-toggle-form { display: inline-flex; margin-left: auto; flex-shrink: 0; }
	.vis-toggle-btn {
		display: flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.4rem;
		background: none; border: 1.5px solid var(--border); border-radius: 6px;
		cursor: pointer; color: var(--muted-fg); font-size: 0.72rem; font-family: inherit;
		transition: all 0.15s;
	}
	.vis-toggle-btn:hover { border-color: var(--muted-fg); color: var(--ink); }
	.vis-toggle-btn.vis-on { border-color: #27ae60; color: #27ae60; background: #e8f8f0; }

	/* Peer submissions */
	.peer-subs {
		grid-column: 1 / -1; margin-top: 0.5rem; padding: 0.5rem 0 0 2.2rem;
		border-top: 1px solid #ede9e3;
	}
	.peer-subs-label {
		display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.05em; color: var(--muted-fg); margin-bottom: 0.4rem;
	}
	.peer-sub-row {
		display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.3rem 0;
		font-size: 0.82rem; color: var(--ink);
	}
	.peer-name { font-weight: 600; flex-shrink: 0; font-size: 0.78rem; color: var(--muted-fg); }
	.peer-link { color: #2980b9; text-decoration: underline; word-break: break-all; font-size: 0.78rem; }
	.peer-text { margin: 0; font-size: 0.78rem; color: var(--ink); white-space: pre-wrap; }
	.peer-img { max-width: 120px; max-height: 80px; border-radius: 4px; display: block; }
	.peer-video { max-width: 160px; max-height: 100px; border-radius: 4px; display: block; }
	.peer-check { font-size: 0.72rem; color: #27ae60; }

	/* Empty state */
	.empty-state { text-align: center; padding: 3rem 1rem; }
	.empty-state h1 { font-family: 'Avara', serif; font-size: 1.75rem; font-weight: 400; color: var(--ink); margin: 0 0 0.5rem; }
	.empty-state p { color: var(--muted-fg); font-size: 0.9rem; margin: 0; }

	/* Utility */
	.utility-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 2rem; }
	.utility-chip {
		padding: 0.4rem 0.9rem; background: var(--surface-2); border: 1.5px solid var(--border);
		border-radius: 99px; font-family: inherit; font-size: 0.82rem;
		color: var(--ink); cursor: pointer;
	}
	.utility-chip:hover { background: var(--surface-2); }
	.utility-chip:disabled { opacity: 0.5; cursor: default; }

	/* Gate overlay */
	.gate-overlay {
		position: fixed; inset: 0; z-index: 9000; background: var(--paper);
		display: flex; align-items: center; justify-content: center; padding: 2rem 1.5rem;
	}
	.gate-card {
		display: flex; flex-direction: column; align-items: center;
		text-align: center; max-width: 360px; width: 100%; gap: 0.85rem;
	}
	.gate-wordmark { font-family: 'Avara', serif; font-size: 1.1rem; color: var(--ink); text-decoration: none; margin-bottom: 0.5rem; }
	.gate-wordmark:hover { opacity: 0.7; }
	.gate-icon { font-size: 2.5rem; line-height: 1; }
	.gate-title { font-family: 'Avara', serif; font-size: 1.75rem; font-weight: 400; color: var(--ink); margin: 0; }
	.gate-body { font-size: 0.9rem; color: var(--muted-fg); line-height: 1.6; margin: 0; }
	.gate-btn-primary {
		width: 100%; padding: 0.8rem 1.4rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 12px; font-family: inherit; font-size: 0.95rem;
		font-weight: 600; cursor: pointer; margin-top: 0.25rem;
	}
	.gate-btn-primary:hover { opacity: 0.82; }
	.gate-btn-primary:disabled { opacity: 0.5; cursor: default; }
	.gate-btn-skip { background: none; border: none; font-family: inherit; font-size: 0.85rem; color: var(--muted-fg); cursor: pointer; }
	.gate-btn-skip:hover { color: var(--ink); }
	.gate-denied { font-size: 0.8rem; color: var(--danger); margin: 0; }

	/* Install banner */
	.install-banner {
		background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 14px;
		padding: 1.25rem; margin-top: 2rem; display: flex; flex-direction: column; gap: 0.6rem;
	}
	.install-banner-title { font-size: 0.95rem; font-weight: 700; color: var(--ink); margin: 0; }
	.install-banner-sub { font-size: 0.85rem; color: var(--muted-fg); margin: 0; }
	.install-steps { font-size: 0.85rem; color: var(--ink); margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.35rem; }
	.ios-share { display: inline-block; font-weight: 700; background: var(--border); border-radius: 4px; padding: 0 0.25rem; font-size: 0.8rem; }

	/* Mobile */
	@media (max-width: 640px) {
		main {
			padding: 1.25rem 1rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		.headline { font-size: 1.6rem; margin-bottom: 1.5rem; }
		.item-main { flex-wrap: wrap; }
		.req-toggle { width: 100%; margin-top: 0.25rem; }
	}
</style>
