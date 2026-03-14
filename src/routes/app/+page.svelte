<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '$lib/push.js';
	import ClassSwitcher from '$lib/components/ClassSwitcher.svelte';

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
	let isMobile = $state(false);   // on a phone/tablet (regardless of PWA)
	let isIOS = $state(false);      // iOS device in browser (not standalone)
	let isAndroid = $state(false);

	// PWA notification gate — shown once on first PWA launch
	let notifOnboarded = $state(true); // default true to avoid flash; set properly in onMount
	let gateLoading = $state(false);

	onMount(async () => {
		if (!browser) return;

		// Auto-refresh so new assignments appear without a manual reload
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

		// PWA gate: show if in standalone and user hasn't been through the flow yet
		const onboarded = localStorage.getItem('pwa_notif_onboarded') === '1';
		// Also consider already-granted/denied as onboarded
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

	// Gate actions
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

	// ── Instructor: create form ──
	let linkUrl = $state('');
	let linkLabel = $state('');
	let attachedLinks = $state([]);
	let allowSubmissions = $state(false);

	function addLink() {
		if (!linkUrl.trim()) return;
		try { new URL(linkUrl.trim()); } catch { return; }
		attachedLinks = [...attachedLinks, { url: linkUrl.trim(), label: linkLabel.trim() }];
		linkUrl = '';
		linkLabel = '';
	}

	function removeLink(i) {
		attachedLinks = attachedLinks.filter((_, idx) => idx !== i);
	}

	// ── Student: UI state ──
	let showPrevious = $state(false);
	let showNext = $state(false);
	let submitting = $state(false);
	let submitType = $state('');
	let submitError = $state(form?.error ?? null);

	$effect(() => { submitError = form?.error ?? null; });

	function formatDate(iso) {
		if (!iso) return null;
		const d = new Date(iso + 'T00:00:00');
		return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
	}

	function getDomain(url) {
		try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
	}
</script>

<svelte:head><title>eating.computer</title></svelte:head>

<!-- ── PWA notification gate (blocks app until dismissed) ── -->
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
	<header>
		<div class="wordmark-wrap">
			<a class="wordmark" href="/">eating.computer</a>
			<ClassSwitcher currentClass={data.currentClass} allClasses={data.allClasses} />
		</div>
		<div class="header-right">
			{#if isInstructor}
				<a href="/app/manage" class="hdr-link">Manage</a>
			{/if}
			<a href="/app/profile/{user.id}" class="hdr-link">{user.name || user.email}</a>
			<form method="POST" action="?/signout">
				<button type="submit" class="hdr-btn">Sign out</button>
			</form>
		</div>
	</header>

	<main>
		{#if isInstructor}
			<!-- ══════════════ INSTRUCTOR VIEW ══════════════ -->
			<div class="page-header">
				<h1>Create assignment</h1>
				<p class="subtitle">Week {data.nextWeek}</p>
			</div>

			<form method="POST" action="?/create" class="create-form" use:enhance>
				<input type="hidden" name="class_id" value={data.classId} />
				<input type="hidden" name="week" value={data.nextWeek} />

				<div class="field">
					<label for="title">Title</label>
					<input id="title" name="title" type="text" placeholder="e.g. Project proposal" required />
				</div>

				<div class="field-row">
					<div class="field">
						<label for="due_date">Due date</label>
						<input id="due_date" name="due_date" type="date" />
					</div>
				</div>

				<div class="field">
					<label for="description">Description</label>
					<textarea id="description" name="description" placeholder="Instructions, context, links to readings…" rows="5"></textarea>
				</div>

				<!-- Attached links -->
				<div class="field">
					<label>Attach links</label>
					{#each attachedLinks as link, i}
						<input type="hidden" name="link_url" value={link.url} />
						<input type="hidden" name="link_label" value={link.label} />
						<div class="link-chip-row">
							<span class="link-chip-item">
								{#if link.label}<strong>{link.label}</strong> — {/if}{getDomain(link.url)}
							</span>
							<button type="button" class="remove-link" onclick={() => removeLink(i)}>×</button>
						</div>
					{/each}
					<div class="link-add-row">
						<input
							type="url"
							bind:value={linkUrl}
							placeholder="https://…"
							class="link-url-input"
							onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())}
						/>
						<input type="text" bind:value={linkLabel} placeholder="Label (optional)" class="link-label-input" />
						<button type="button" class="btn-add-link" onclick={addLink}>Add</button>
					</div>
				</div>

				<!-- Submissions -->
				<div class="field">
					<label>Submissions</label>
					<label class="toggle-row">
						<input type="checkbox" bind:checked={allowSubmissions} />
						Students submit work for this assignment
					</label>
					{#if allowSubmissions}
						<div class="sub-types">
							<label class="check-label"><input type="checkbox" name="accepted_types" value="link" checked /> Link</label>
							<label class="check-label"><input type="checkbox" name="accepted_types" value="image" /> Image</label>
							<label class="check-label"><input type="checkbox" name="accepted_types" value="video" /> Video</label>
						</div>
					{/if}
				</div>

				{#if form?.error && form?.action === 'create'}
					<p class="form-error">{form.error}</p>
				{/if}

				<button type="submit" class="btn-primary">Publish assignment</button>
			</form>

			{#if data.previous.length > 0}
				<div class="prev-section">
					<p class="section-label">Past assignments</p>
					{#each data.previous as a}
						<a href="/app/assignments" class="prev-item">
							<span class="prev-week">Wk {a.week}</span>
							<span class="prev-title">{a.title}</span>
							{#if a.dueDate}<span class="prev-date">{formatDate(a.dueDate)}</span>{/if}
						</a>
					{/each}
				</div>
			{/if}

		{:else}
			<!-- ══════════════ STUDENT VIEW ══════════════ -->

			{#if data.current}
				<div class="assignment-card">
					<div class="assign-meta">
						<span class="assign-week">Week {data.current.week}</span>
						{#if data.current.dueDate}
							<span class="assign-due">Due {formatDate(data.current.dueDate)}</span>
						{/if}
					</div>
					<h1 class="assign-title">{data.current.title}</h1>

					{#if data.current.description}
						<p class="assign-desc">{data.current.description}</p>
					{/if}

					{#if data.current.attachments?.length}
						<div class="assign-links">
							{#each data.current.attachments as att}
								<a href={att.url} target="_blank" rel="noopener noreferrer" class="assign-link-chip">
									{#if att.label}{att.label}{:else}{getDomain(att.url)}{/if}
									<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
								</a>
							{/each}
						</div>
					{/if}

					<!-- Submit work -->
					{#if data.current.acceptedTypes?.length > 0}
						{#if data.mySubmission}
							<div class="submitted-badge">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
								Submitted
							</div>
						{:else if submitting}
							<div class="submit-form-inline">
								{#if submitError}<p class="form-error">{submitError}</p>{/if}
								<div class="submit-type-tabs">
									{#each data.current.acceptedTypes as t}
										<button type="button" class="type-tab" class:active={submitType === t} onclick={() => submitType = t}>
											{t.charAt(0).toUpperCase() + t.slice(1)}
										</button>
									{/each}
								</div>
								{#if submitType}
									<form method="POST" action="?/submit" enctype="multipart/form-data" use:enhance>
										<input type="hidden" name="assignment_id" value={data.current.id} />
										<input type="hidden" name="type" value={submitType} />
										{#if submitType === 'link'}
											<input type="url" name="link" placeholder="https://…" class="submit-input" required />
										{:else}
											<input type="file" name="file" accept={submitType === 'image' ? 'image/*' : 'video/*'} class="submit-input" required />
										{/if}
										<div class="submit-row">
											<button type="submit" class="btn-primary sm">Submit</button>
											<button type="button" class="btn-ghost sm" onclick={() => { submitting = false; submitType = ''; }}>Cancel</button>
										</div>
									</form>
								{/if}
							</div>
						{:else}
							<button class="btn-primary" onclick={() => { submitting = true; submitType = data.current.acceptedTypes[0]; }}>
								Submit work
							</button>
						{/if}
					{/if}
				</div>

				<!-- Next assignment peek -->
				{#if data.next}
					<button class="peek-btn" onclick={() => showNext = !showNext}>
						{showNext ? 'Hide' : 'View'} next assignment
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style:transform={showNext ? 'rotate(180deg)' : ''} style:transition="transform 0.2s">
							<polyline points="6 9 12 15 18 9"/>
						</svg>
					</button>
					{#if showNext}
						<div class="peek-card">
							<div class="assign-meta">
								<span class="assign-week">Week {data.next.week}</span>
								{#if data.next.dueDate}<span class="assign-due">Due {formatDate(data.next.dueDate)}</span>{/if}
							</div>
							<p class="peek-title">{data.next.title}</p>
							{#if data.next.description}<p class="peek-desc">{data.next.description}</p>{/if}
						</div>
					{/if}
				{/if}

			{:else}
				<div class="empty-state">
					<h1>No assignments yet</h1>
					<p>Check back soon.</p>
				</div>
			{/if}

			<!-- Quick links -->
			<div class="quick-links">
				<a href="/app/assignments" class="quick-link">View syllabus →</a>
				<button class="quick-link" onclick={() => showPrevious = !showPrevious}>
					{showPrevious ? 'Hide' : 'Previous'} assignments {showPrevious ? '↑' : '↓'}
				</button>
			</div>

			{#if showPrevious && data.previous.length > 0}
				<div class="prev-section">
					{#each data.previous as a}
						<a href="/app/assignments" class="prev-item">
							<span class="prev-week">Wk {a.week}</span>
							<span class="prev-title">{a.title}</span>
							{#if a.dueDate}<span class="prev-date">{formatDate(a.dueDate)}</span>{/if}
						</a>
					{/each}
				</div>
			{:else if showPrevious}
				<p class="muted">No previous assignments.</p>
			{/if}

		{/if}

		<!-- ── Mobile install instructions (not in PWA) ── -->
		{#if isMobile && !isStandalone}
			<div class="install-banner">
				<p class="install-banner-title">📲 Install eating.computer</p>
				{#if installPrompt}
					<p class="install-banner-sub">Add to your home screen for the full experience — offline access, notifications, and no browser chrome.</p>
					<button class="btn-primary" onclick={install}>Install app</button>
				{:else if isIOS}
					<p class="install-banner-sub">To install on iPhone or iPad:</p>
					<ol class="install-steps">
						<li>Tap the <strong>Share</strong> button <span class="ios-share">⎙</span> at the bottom of Safari</li>
						<li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
						<li>Tap <strong>Add</strong> — done!</li>
					</ol>
					<p class="install-note">Once installed, you can enable push notifications for new assignments and messages.</p>
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

		<!-- ── Notification settings (in PWA, after onboarding) ── -->
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
					<p class="muted">Notifications blocked — enable them in Settings → Safari → eating.computer.</p>
				{/if}
				{#if pushError}<p class="form-error">{pushError}</p>{/if}
			</div>
		{/if}
	</main>
</div>

<style>
	.shell { min-height: 100dvh; display: flex; flex-direction: column; background: var(--paper); }

	/* Header */
	header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 1rem 1.5rem; border-bottom: 1.5px solid #ddd7cc; flex-shrink: 0;
	}
	.wordmark-wrap { display: flex; align-items: center; gap: 0.75rem; }
	.wordmark { font-family: 'Cambridge', serif; font-size: 1.1rem; color: var(--ink); text-decoration: none; }
	.wordmark:hover { opacity: 0.7; }
	.header-right { display: flex; align-items: center; gap: 0.6rem; }
	.hdr-link { font-size: 0.82rem; color: #a09688; text-decoration: none; font-weight: 500; }
	.hdr-link:hover { color: var(--ink); }
	.hdr-btn {
		background: none; border: 1.5px solid #ddd7cc; border-radius: 6px;
		padding: 0.25rem 0.6rem; font-family: inherit; font-size: 0.78rem;
		color: #a09688; cursor: pointer;
	}
	.hdr-btn:hover { border-color: var(--ink); color: var(--ink); }

	/* Main */
	main {
		flex: 1; padding: 2rem 1.5rem; max-width: 680px;
		width: 100%; margin: 0 auto; box-sizing: border-box;
	}
	.page-header { margin-bottom: 1.75rem; }
	.page-header h1 { font-family: 'Cambridge', serif; font-size: 2rem; font-weight: 400; margin: 0 0 0.2rem; }
	.subtitle { font-size: 0.85rem; color: #a09688; margin: 0; }

	/* Create form */
	.create-form { display: flex; flex-direction: column; gap: 1.25rem; }
	.field { display: flex; flex-direction: column; gap: 0.4rem; }
	.field-row { display: flex; gap: 1rem; }
	.field-row .field { flex: 1; }
	label { font-size: 0.78rem; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
	input[type="text"], input[type="url"], input[type="date"], textarea {
		padding: 0.6rem 0.85rem; border: 1.5px solid #ddd7cc; border-radius: 10px;
		background: #fff; font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; transition: border-color 0.15s; width: 100%; box-sizing: border-box;
	}
	input:focus, textarea:focus { border-color: var(--ink); }
	textarea { resize: vertical; min-height: 100px; }

	.toggle-row {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.88rem; color: var(--ink); font-weight: 400;
		text-transform: none; letter-spacing: 0; cursor: pointer;
	}
	.sub-types { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; }
	.check-label {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.88rem; color: var(--ink); font-weight: 400;
		text-transform: none; letter-spacing: 0; cursor: pointer;
	}

	/* Link attach */
	.link-chip-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.4rem 0.75rem; background: #f5f0e8; border-radius: 8px;
		font-size: 0.82rem; color: var(--ink); margin-bottom: 0.35rem;
	}
	.remove-link {
		background: none; border: none; color: #a09688; font-size: 1.1rem;
		cursor: pointer; line-height: 1; padding: 0;
	}
	.link-add-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.link-url-input { flex: 2; min-width: 0; }
	.link-label-input { flex: 1; min-width: 80px; }
	.btn-add-link {
		padding: 0.6rem 1rem; background: #f5f0e8; border: 1.5px solid #ddd7cc;
		border-radius: 10px; font-family: inherit; font-size: 0.85rem;
		color: var(--ink); cursor: pointer; white-space: nowrap;
	}
	.btn-add-link:hover { background: #ede8df; }

	/* Buttons */
	.btn-primary {
		padding: 0.65rem 1.4rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 10px; font-family: inherit; font-size: 0.9rem;
		font-weight: 600; cursor: pointer; transition: opacity 0.15s; align-self: flex-start;
	}
	.btn-primary:hover { opacity: 0.82; }
	.btn-primary.sm { padding: 0.5rem 1rem; font-size: 0.85rem; }
	.btn-ghost {
		padding: 0.65rem 1rem; background: none; border: 1.5px solid #ddd7cc;
		border-radius: 10px; font-family: inherit; font-size: 0.9rem;
		color: var(--ink); cursor: pointer;
	}
	.btn-ghost.sm { padding: 0.5rem 0.9rem; font-size: 0.85rem; }
	.btn-ghost:hover { border-color: var(--ink); }

	.form-error { font-size: 0.82rem; color: #c0392b; margin: 0; }

	/* Assignment card */
	.assignment-card {
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 16px;
		padding: 1.5rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.875rem;
	}
	.assign-meta { display: flex; align-items: center; gap: 0.75rem; }
	.assign-week {
		font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.07em; color: #b0a898;
	}
	.assign-due { font-size: 0.82rem; color: #e07550; font-weight: 500; }
	.assign-title {
		font-family: 'Cambridge', serif; font-size: 1.75rem; font-weight: 400;
		color: var(--ink); margin: 0; line-height: 1.2;
	}
	.assign-desc { font-size: 0.9rem; color: #555; line-height: 1.6; margin: 0; white-space: pre-wrap; }

	.assign-links { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.assign-link-chip {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.3rem 0.7rem; background: #f5f0e8; border-radius: 99px;
		font-size: 0.8rem; color: var(--ink); text-decoration: none;
		border: 1.5px solid #e8e2d8; transition: background 0.15s;
	}
	.assign-link-chip:hover { background: #ede8df; }

	/* Submitted badge */
	.submitted-badge {
		display: inline-flex; align-items: center; gap: 0.4rem;
		font-size: 0.82rem; font-weight: 600; color: #2e7d32;
	}

	/* Submit form inline */
	.submit-form-inline { display: flex; flex-direction: column; gap: 0.75rem; }
	.submit-type-tabs { display: flex; gap: 0.4rem; }
	.type-tab {
		padding: 0.35rem 0.85rem; border: 1.5px solid #ddd7cc; border-radius: 99px;
		background: none; font-family: inherit; font-size: 0.82rem; color: #888; cursor: pointer;
	}
	.type-tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.submit-input { width: 100%; box-sizing: border-box; }
	.submit-row { display: flex; gap: 0.5rem; align-items: center; }

	/* Peek next assignment */
	.peek-btn {
		display: flex; align-items: center; gap: 0.4rem;
		background: none; border: none; font-family: inherit; font-size: 0.85rem;
		color: #a09688; cursor: pointer; padding: 0; margin-bottom: 0.75rem;
	}
	.peek-btn:hover { color: var(--ink); }
	.peek-card {
		background: #faf8f5; border: 1.5px solid #e8e2d8; border-radius: 12px;
		padding: 1rem 1.25rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.5rem;
	}
	.peek-title { font-size: 1rem; font-weight: 600; color: var(--ink); margin: 0; }
	.peek-desc { font-size: 0.85rem; color: #888; margin: 0; line-height: 1.5; }

	/* Quick links */
	.quick-links {
		display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 0.5rem;
	}
	.quick-link {
		font-size: 0.85rem; color: #a09688; text-decoration: none; font-weight: 500;
		background: none; border: none; font-family: inherit; cursor: pointer; padding: 0;
	}
	.quick-link:hover { color: var(--ink); }

	/* Previous assignments */
	.section-label {
		font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.07em; color: #b0a898; margin: 0 0 0.6rem;
	}
	.prev-section { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 1rem; }
	.prev-item {
		display: flex; align-items: baseline; gap: 0.6rem;
		padding: 0.5rem 0.75rem; border-radius: 8px; text-decoration: none; color: var(--ink);
		transition: background 0.1s;
	}
	.prev-item:hover { background: #f5f0e8; }
	.prev-week { font-size: 0.72rem; font-weight: 700; color: #b0a898; flex-shrink: 0; }
	.prev-title { font-size: 0.88rem; flex: 1; }
	.prev-date { font-size: 0.75rem; color: #a09688; white-space: nowrap; }
	.muted { font-size: 0.85rem; color: #a09688; margin: 0.5rem 0; }

	/* Empty state */
	.empty-state { text-align: center; padding: 3rem 1rem; }
	.empty-state h1 { font-family: 'Cambridge', serif; font-size: 1.75rem; font-weight: 400; color: var(--ink); margin: 0 0 0.5rem; }
	.empty-state p { color: #a09688; font-size: 0.9rem; margin: 0; }

	/* Utility chips */
	.utility-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 2rem; }
	.utility-chip {
		padding: 0.4rem 0.9rem; background: #f5f0e8; border: 1.5px solid #e8e2d8;
		border-radius: 99px; font-family: inherit; font-size: 0.82rem;
		color: var(--ink); cursor: pointer; transition: background 0.15s;
	}
	.utility-chip:hover { background: #ede8df; }
	.utility-chip:disabled { opacity: 0.5; cursor: default; }

	/* Notification gate overlay */
	.gate-overlay {
		position: fixed; inset: 0; z-index: 9000;
		background: var(--paper);
		display: flex; align-items: center; justify-content: center;
		padding: 2rem 1.5rem;
	}
	.gate-card {
		display: flex; flex-direction: column; align-items: center;
		text-align: center; max-width: 360px; width: 100%; gap: 0.85rem;
	}
	.gate-wordmark {
		font-family: 'Cambridge', serif; font-size: 1.1rem; color: var(--ink);
		text-decoration: none; margin-bottom: 0.5rem;
	}
	.gate-wordmark:hover { opacity: 0.7; }
	.gate-icon { font-size: 2.5rem; line-height: 1; }
	.gate-title {
		font-family: 'Cambridge', serif; font-size: 1.75rem; font-weight: 400;
		color: var(--ink); margin: 0;
	}
	.gate-body {
		font-size: 0.9rem; color: #666; line-height: 1.6; margin: 0;
	}
	.gate-btn-primary {
		width: 100%; padding: 0.8rem 1.4rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 12px; font-family: inherit; font-size: 0.95rem;
		font-weight: 600; cursor: pointer; transition: opacity 0.15s; margin-top: 0.25rem;
	}
	.gate-btn-primary:hover { opacity: 0.82; }
	.gate-btn-primary:disabled { opacity: 0.5; cursor: default; }
	.gate-btn-skip {
		background: none; border: none; font-family: inherit; font-size: 0.85rem;
		color: #a09688; cursor: pointer; padding: 0.25rem;
	}
	.gate-btn-skip:hover { color: var(--ink); }
	.gate-denied { font-size: 0.8rem; color: #c0392b; margin: 0; }

	/* Mobile install banner */
	.install-banner {
		background: #f5f0e8; border: 1.5px solid #e8e2d8; border-radius: 14px;
		padding: 1.25rem 1.25rem; margin-top: 2rem;
		display: flex; flex-direction: column; gap: 0.6rem;
	}
	.install-banner-title { font-size: 0.95rem; font-weight: 700; color: var(--ink); margin: 0; }
	.install-banner-sub { font-size: 0.85rem; color: #666; margin: 0; }
	.install-steps {
		font-size: 0.85rem; color: var(--ink); margin: 0; padding-left: 1.25rem;
		display: flex; flex-direction: column; gap: 0.35rem;
	}
	.install-note { font-size: 0.8rem; color: #a09688; margin: 0; }
	.ios-share {
		display: inline-block; font-style: normal; font-weight: 700;
		background: #e8e2d8; border-radius: 4px; padding: 0 0.25rem; font-size: 0.8rem;
	}

	/* Mobile */
	@media (max-width: 640px) {
		header {
			position: fixed; top: 0; left: 0; right: 0; z-index: 10;
			background: var(--paper); padding: 0.75rem 1rem;
		}
		main {
			padding: 1.25rem 1rem;
			padding-top: 3.75rem;
			padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem);
		}
		.assign-title { font-size: 1.4rem; }
		.field-row { flex-direction: column; gap: 0; }
		.link-add-row { flex-direction: column; }
		.link-url-input, .link-label-input { width: 100%; }
	}
</style>
