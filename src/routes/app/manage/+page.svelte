<script>
	import { enhance } from '$app/forms';
	import ClassSwitcher from '$lib/components/ClassSwitcher.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off } from 'firebase/database';

	let { data, form } = $props();

	// Activity chart
	const W = 480, H = 80, PAD = 4;
	const RANGES = [
		{ key: '12h', label: '12hr', hours: 12 },
		{ key: '1d',  label: '1d',   hours: 24 },
		{ key: '7d',  label: '7d',   hours: 24 * 7 },
		{ key: '1m',  label: '1m',   days: 30 },
		{ key: '6m',  label: '6m',   days: 180 }
	];
	let selectedRange = $state('7d');

	let activityChart = $derived.by(() => {
		const range = RANGES.find((r) => r.key === selectedRange);
		const now = Date.now();

		// Choose source dataset and optionally filter
		let series;
		if (range.hours) {
			const cutoff = new Date(now - range.hours * 3600_000).toISOString().slice(0, 13) + ':00';
			series = data.activityByUser.hourly.map((u) => ({
				...u,
				points: u.points.filter((p) => p.bucket >= cutoff)
			})).filter((u) => u.points.length);
		} else {
			const cutoff = new Date(now - range.days * 86400_000).toISOString().slice(0, 10);
			series = data.activityByUser.daily.map((u) => ({
				...u,
				points: u.points.filter((p) => p.bucket >= cutoff)
			})).filter((u) => u.points.length);
		}

		// Sort by total activity descending (most active first)
		series = series
			.map((u) => ({ ...u, total: u.points.reduce((s, p) => s + p.count, 0) }))
			.sort((a, b) => b.total - a.total);

		if (!series.length) return { lines: [] };

		// Collect all buckets (sorted)
		const bucketSet = new Set();
		for (const u of series) for (const p of u.points) bucketSet.add(p.bucket);
		const buckets = [...bucketSet].sort();

		const maxCount = Math.max(1, ...series.flatMap((u) => u.points.map((p) => p.count)));
		const xOf = (b) => PAD + (buckets.indexOf(b) / Math.max(buckets.length - 1, 1)) * (W - PAD * 2);
		const yOf = (c) => H - PAD - (c / maxCount) * (H - PAD * 2);

		const lines = series.map((u, i) => ({
			userId: u.userId,
			name: u.name,
			total: u.total,
			points: u.points.map((p) => `${xOf(p.bucket).toFixed(1)},${yOf(p.count).toFixed(1)}`).join(' '),
			rawPoints: u.points,
			hue: (i * 67) % 360,
			opacity: Math.max(0.35, 1 - i * 0.12)
		}));

		return { lines, buckets };
	});

	// Presence — mirrors the chat layout pattern (rawPresence → $derived presenceMap)
	const PRESENCE_TTL = 3 * 60 * 1000;

	// Raw snapshots: Firebase overwrites, API poll merges in
	let rawPresence = $state(
		Object.fromEntries(data.members.map((m) => [m.id, { online: m.online ?? false, lastSeen: m.lastSeen ?? null, ua: m.ua ?? null, screen: m.screen ?? null, pwa: m.pwa ?? null, mobile: m.mobile ?? null, notif: m.notif ?? null }]))
	);
	let presenceTick = $state(0); // increments every 30s to force stale re-eval
	let now = $state(Date.now());
	let pollTimer;
	let tickTimer;
	let presenceRef;
	let pendingRequestsRef;

	// Derived map — recomputes whenever rawPresence or tick changes
	const presenceMap = $derived.by(() => {
		presenceTick; // subscribe so stale entries are re-evaluated on tick
		const cutoff = Date.now() - PRESENCE_TTL;
		const result = {};
		for (const [uid, val] of Object.entries(rawPresence)) {
			const online = !!(val.online && (val.lastSeen ?? 0) > cutoff);
			result[uid] = {
				online,
				lastSeen: val.lastSeen ?? null,
				ua: online ? (val.ua ?? null) : null,
				screen: online ? (val.screen ?? null) : null,
				pwa: online ? (val.pwa ?? null) : null,
				mobile: online ? (val.mobile ?? null) : null,
				notif: val.notif ?? null
			};
		}
		return result;
	});

	function deviceLabel(p) {
		if (!p) return null;
		const mobile = p.mobile ?? /iphone|android.*mobile|windows phone/i.test(p.ua ?? '');
		const pwa = p.pwa ?? false;
		if (mobile && pwa)  return { icon: '📱', label: 'Mobile app' };
		if (mobile)         return { icon: '🌐', label: 'Mobile browser' };
		if (pwa)            return { icon: '🖥️', label: 'Desktop app' };
		return               { icon: '💻', label: 'Desktop browser' };
	}

	async function pollPresence() {
		try {
			const res = await fetch('/api/presence');
			if (!res.ok) return;
			const apiData = await res.json();
			// Merge: API is authoritative for non-chat users; Firebase wins for online ones
			// Merge: fresh API data updates the map; Firebase onValue re-overrides for real-time users
			rawPresence = { ...rawPresence, ...apiData };
		} catch { /* ignore */ }
	}

	onMount(async () => {
		// Ensure Firebase is authenticated before subscribing
		if (data.firebaseToken) {
			try { await signInWithCustomToken(auth, data.firebaseToken); } catch { /* already authed */ }
		}

		presenceRef = ref(rtdb, 'presence');
		onValue(presenceRef, (snap) => {
			// Merge Firebase data into rawPresence — Firebase is authoritative
			rawPresence = { ...rawPresence, ...(snap.exists() ? snap.val() : {}) };
			now = Date.now();
		});

		// Subscribe to join-request signals — any write here means a new request came in
		if (data.currentClass?.id) {
			pendingRequestsRef = ref(rtdb, `pendingRequests/${data.currentClass.id}`);
			let firstPending = true;
			onValue(pendingRequestsRef, () => {
				if (firstPending) { firstPending = false; return; } // skip initial fire
				invalidateAll();
			});
		}

		pollPresence();
		pollTimer = setInterval(pollPresence, 30_000);
		tickTimer = setInterval(() => { presenceTick++; now = Date.now(); }, 30_000);
	});
	onDestroy(() => {
		clearInterval(pollTimer);
		clearInterval(tickTimer);
		if (presenceRef) off(presenceRef);
		if (pendingRequestsRef) off(pendingRequestsRef);
	});

	function formatLastSeen(ts) {
		if (!ts) return 'never';
		const diff = now - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

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
					title: 'Test notification',
					body: 'Everything is working!',
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

	// User × device bar chart — shares selectedRange with the activity line chart
	const userBars = $derived.by(() => {
		const range = RANGES.find((r) => r.key === selectedRange);
		const now = Date.now();
		let rows;
		let cutoff;
		if (range.hours) {
			cutoff = new Date(now - range.hours * 3600_000).toISOString().slice(0, 13) + ':00';
			rows = data.userDeviceActivity.hourly;
		} else {
			cutoff = new Date(now - range.days * 86400_000).toISOString().slice(0, 10);
			rows = data.userDeviceActivity.daily;
		}

		const byUser = {};
		for (const r of rows) {
			if (r.bucket < cutoff) continue;
			const uid = r.userId;
			if (!byUser[uid]) byUser[uid] = { userId: uid, name: r.name, total: 0, desktop: 0, mobile: 0, desktopNoNotif: 0, mobileNoNotif: 0 };
			const mins = r.pings * 5;
			byUser[uid].total += mins;
			if (r.deviceType === 'desktop') byUser[uid].desktop += mins;
			if (r.deviceType === 'mobile')  byUser[uid].mobile += mins;
			if (r.deviceType === 'desktop' && !r.hasNotif) byUser[uid].desktopNoNotif += mins;
			if (r.deviceType === 'mobile'  && !r.hasNotif) byUser[uid].mobileNoNotif += mins;
		}

		const users = Object.values(byUser).sort((a, b) => b.total - a.total);
		const maxVal = Math.max(1, ...users.map((u) => u.total));
		return { users, maxVal };
	});

	// Chart hover tooltip
	let hoverIdx = $state(null);
	let hoverPct = $state(0); // 0–1, for tooltip positioning
	let chartEl = $state(null);

	function handleChartMouseMove(e) {
		const rect = e.currentTarget.getBoundingClientRect();
		const svgX = ((e.clientX - rect.left) / rect.width) * W;
		const buckets = activityChart.buckets;
		if (!buckets?.length) return;
		const raw = (svgX - PAD) / (W - PAD * 2) * (buckets.length - 1);
		hoverIdx = Math.max(0, Math.min(buckets.length - 1, Math.round(raw)));
		hoverPct = (e.clientX - rect.left) / rect.width;
	}

	function handleChartMouseLeave() { hoverIdx = null; }

	function formatBucket(bucket) {
		if (!bucket) return '';
		if (bucket.includes('T')) {
			const [date, time] = bucket.split('T');
			const [y, m, d] = date.split('-').map(Number);
			const h = parseInt(time);
			const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
			return `${new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${label}`;
		}
		const [y, m, d] = bucket.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>Manage — eating.computer</title>
</svelte:head>

<div class="shell">
	<header>
		<div class="wordmark-wrap">
			<a class="wordmark" href="/">eating.computer</a>
			<ClassSwitcher currentClass={data.currentClass} allClasses={data.allClasses} />
		</div>

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
				<input type="hidden" name="class_id" value={data.classId} />
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
							<input type="hidden" name="class_id" value={data.classId} />
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
	{#if data.pendingRequests.length > 0}
	<section class="members-section pending-section">
		<h2>Pending requests <span class="member-count">({data.pendingRequests.length})</span></h2>
		<div class="pending-list">
			{#each data.pendingRequests as req}
				<div class="pending-card">
					<div class="pending-avatar">{req.userName ? req.userName[0].toUpperCase() : '?'}</div>
					<div class="pending-info">
						<div class="pending-name-row">
							<a class="pending-name" href="/app/profile/{req.userId}">{req.userName || 'Unnamed'}</a>
							{#if req.pronouns}<span class="pending-pronouns">{req.pronouns}</span>{/if}
						</div>
						<div class="pending-email">{req.email}</div>
						<div class="pending-class">{req.className} · {req.term}</div>
						{#if req.bio}<p class="pending-bio">{req.bio}</p>{/if}
						{#if req.website}<a class="pending-website" href={req.website} target="_blank" rel="noopener noreferrer">{req.website.replace(/^https?:\/\//, '')}</a>{/if}
					</div>
					<div class="pending-actions">
						<form method="POST" action="?/approve" use:enhance>
							<input type="hidden" name="id" value={req.id} />
							<button type="submit" class="btn-approve">Approve</button>
						</form>
						<form method="POST" action="?/deny" use:enhance>
							<input type="hidden" name="id" value={req.id} />
							<button type="submit" class="btn-deny">Deny</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	</section>
	{/if}

	<section class="members-section">
		<div class="chart-header">
			<h2>Activity</h2>
			<div class="range-tabs">
				{#each RANGES as r}
					<button
						class="range-tab"
						class:active={selectedRange === r.key}
						onclick={() => selectedRange = r.key}
					>{r.label}</button>
				{/each}
			</div>
		</div>
		<div class="activity-chart" bind:this={chartEl}>
			{#if activityChart.lines?.length}
				<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="chart-svg"
					onmousemove={handleChartMouseMove}
					onmouseleave={handleChartMouseLeave}>
					{#each activityChart.lines as line}
						<polyline
							points={line.points}
							fill="none"
							stroke="hsl({line.hue} 30% 40%)"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							opacity={line.opacity}
						/>
					{/each}
					{#if hoverIdx !== null && activityChart.buckets?.length}
						{@const bx = (PAD + (hoverIdx / Math.max(activityChart.buckets.length - 1, 1)) * (W - PAD * 2)).toFixed(1)}
						<line x1={bx} y1={PAD} x2={bx} y2={H - PAD} stroke="rgba(0,0,0,0.25)" stroke-width="0.75" stroke-dasharray="2,2" />
					{/if}
				</svg>
				{#if hoverIdx !== null && activityChart.buckets?.length}
					{@const bucket = activityChart.buckets[hoverIdx]}
					{@const tooltipLeft = Math.min(Math.max(hoverPct * 100, 5), 80)}
					<div class="chart-tooltip" style="left: {tooltipLeft}%">
						<div class="tooltip-date">{formatBucket(bucket)}</div>
						{#each activityChart.lines as line}
							{@const pt = line.rawPoints.find(p => p.bucket === bucket)}
							{#if pt?.count}
								<div class="tooltip-row">
									<span class="tooltip-dot" style="background: hsl({line.hue} 30% 40%)"></span>
									<span>{line.name}</span>
									<span class="tooltip-count">{pt.count}</span>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
				<div class="chart-legend">
					{#each activityChart.lines as line}
						<span class="legend-item">
							<span class="legend-dot" style="background: hsl({line.hue} 30% 40%); opacity: {line.opacity}"></span>
							{line.name || 'Unknown'}
							<span class="legend-count">{line.total}</span>
						</span>
					{/each}
				</div>
			{:else}
				<p class="chart-empty">No activity in this period.</p>
			{/if}
		</div>
	</section>

	<section class="members-section">
		<div class="chart-header">
			<div>
				<h2>Time in app by user</h2>
				<p class="subtitle" style="margin: 0.15rem 0 0">Minutes · each bar = one metric per person</p>
			</div>
			<div class="range-tabs">
				{#each RANGES as r}
					<button class="range-tab" class:active={selectedRange === r.key} onclick={() => selectedRange = r.key}>{r.label}</button>
				{/each}
			</div>
		</div>
		{#if userBars.users.length}
			{@const BAR_W = 8}
			{@const BAR_GAP = 2}
			{@const N_BARS = 5}
			{@const GROUP_GAP = 14}
			{@const CHART_H = 120}
			{@const LABEL_H = 32}
			{@const SVG_H = CHART_H + LABEL_H}
			{@const groupW = N_BARS * BAR_W + (N_BARS - 1) * BAR_GAP}
			{@const SVG_W = userBars.users.length * (groupW + GROUP_GAP) + 24}
			<div class="device-chart-wrap">
				<svg viewBox="0 0 {SVG_W} {SVG_H}" class="device-chart-svg" style="min-width: {Math.max(260, SVG_W)}px">
					<!-- baseline -->
					<line x1="0" y1={CHART_H} x2={SVG_W} y2={CHART_H} stroke="#ddd7cc" stroke-width="1"/>
					{#each userBars.users as u, i}
						{@const gx = 12 + i * (groupW + GROUP_GAP)}
						{@const bars = [
							{ val: u.total,          fill: 'hsl(200 55% 48%)', title: 'Total' },
							{ val: u.desktop,        fill: 'hsl(220 45% 52%)', title: 'Desktop' },
							{ val: u.mobile,         fill: 'hsl(270 40% 55%)', title: 'Mobile' },
							{ val: u.desktopNoNotif, fill: 'hsl(220 25% 72%)', title: 'Desktop, no notif' },
							{ val: u.mobileNoNotif,  fill: 'hsl(270 20% 72%)', title: 'Mobile, no notif' }
						]}
						{#each bars as b, bi}
							{@const bx = gx + bi * (BAR_W + BAR_GAP)}
							{@const h = (b.val / userBars.maxVal) * CHART_H}
							{#if h > 0}
								<rect x={bx} y={CHART_H - h} width={BAR_W} height={h} rx="2" fill={b.fill} opacity="0.9">
									<title>{u.name} · {b.title}: {b.val}m</title>
								</rect>
							{/if}
						{/each}
						<!-- name label -->
						{@const firstName = u.name.split(' ')[0]}
						<text x={gx + groupW / 2} y={CHART_H + 14} text-anchor="middle" font-size="7.5" fill="#6b5f54">{firstName}</text>
					{/each}
				</svg>
			</div>
			<!-- Legend -->
			<div class="ud-legend">
				<span class="ud-swatch" style="background: hsl(200 55% 48%)"></span> Total
				<span class="ud-swatch" style="background: hsl(220 45% 52%)"></span> Desktop
				<span class="ud-swatch" style="background: hsl(270 40% 55%)"></span> Mobile
				<span class="ud-swatch" style="background: hsl(220 25% 72%)"></span> Desktop / no notif
				<span class="ud-swatch" style="background: hsl(270 20% 72%)"></span> Mobile / no notif
			</div>
		{:else}
			<p class="chart-empty">No device activity in this period.</p>
		{/if}
	</section>

	<section class="members-section">
		<h2>All members <span class="member-count">({data.members.length})</span></h2>
		<div class="members-table-wrap">
		<table class="members-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Email</th>
					<th>Role</th>
					<th>Joined</th>
					<th>Status</th>
					<th>Device</th>
					<th>Notif</th>
					<th>Last seen</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.members as m}
					{@const p = presenceMap[m.id]}
					<tr>
						<td><a class="member-link" href="/app/profile/{m.id}">{m.name || '—'}</a></td>
						<td class="email">{m.email}</td>
						<td><span class="role-pill" class:instructor={m.role === 'instructor'}>{m.role}</span></td>
						<td class="muted">{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
						<td>
							{#if p?.online}
								<span class="status-online">● online</span>
							{:else}
								<span class="status-offline">○ offline</span>
							{/if}
						</td>
						<td class="muted device-cell">
							{#if p?.online}
								{@const dev = deviceLabel(p)}
								{#if dev}
									<span class="device-info" title={p.ua ?? ''}>
										{dev.icon} {dev.label}
									</span>
								{:else}
									—
								{/if}
							{:else}
								—
							{/if}
						</td>
						<td class="muted notif-cell">
							{#if p?.notif === true}
								<span title="Notifications enabled">🔔</span>
							{:else if p?.notif === false}
								<span title="Notifications off">🔕</span>
							{:else}
								<span title="Unknown">—</span>
							{/if}
						</td>
						<td class="muted">{formatLastSeen(p?.lastSeen ?? null)}</td>
						<td>
							{#if m.role !== 'instructor'}
								<form method="POST" action="?/resetStudent" use:enhance>
									<input type="hidden" name="user_id" value={m.id} />
									<button type="submit" class="btn-reset" onclick={(e) => { if (!confirm(`Reset ${m.name || 'this user'}'s onboarding?`)) e.preventDefault(); }}>Reset</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		</div>
	</section>
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

	.activity-chart { margin-top: 0.75rem; position: relative; }
	.chart-svg { width: 100%; height: 80px; display: block; border-radius: 6px; background: #faf7f2; cursor: crosshair; }

	.chart-tooltip {
		position: absolute;
		top: 0; transform: translateX(-50%);
		background: #1a1a1a; color: #f7f2ea;
		border-radius: 7px; padding: 0.45rem 0.65rem;
		font-size: 0.72rem; pointer-events: none;
		white-space: nowrap; z-index: 10;
		box-shadow: 0 2px 12px rgba(0,0,0,0.25);
	}
	.tooltip-date { font-weight: 600; margin-bottom: 0.25rem; color: #c8c1b4; }
	.tooltip-row { display: flex; align-items: center; gap: 0.35rem; }
	.tooltip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
	.tooltip-count { margin-left: auto; padding-left: 0.75rem; opacity: 0.7; }
	.chart-legend {
		display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-top: 0.6rem;
	}
	.legend-item { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: #a09688; }
	.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.legend-count { font-size: 0.68rem; color: #c8c1b4; }
	.chart-empty { font-size: 0.85rem; color: #a09688; margin: 0.5rem 0 0; }
	.chart-labels {
		position: absolute; bottom: 0; left: 0; right: 0;
		font-size: 0.65rem; color: #a09688;
	}
	.chart-labels span { position: absolute; transform: translateX(-50%); }

	.device-chart-wrap { margin-top: 0.75rem; overflow-x: auto; -webkit-overflow-scrolling: touch; }
	.device-chart-svg { display: block; height: 152px; }
	.ud-legend {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 1rem;
		margin-top: 0.6rem; font-size: 0.72rem; color: #a09688;
	}
	.ud-swatch {
		display: inline-block; width: 10px; height: 10px;
		border-radius: 2px; vertical-align: middle; margin-right: 0.2rem;
	}

	.members-section { margin-top: 2.5rem; }
	.members-section h2 { font-family: 'Cambridge', serif; font-size: 1.25rem; font-weight: 400; margin: 0; }

	.chart-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap; }

	.range-tabs { display: flex; gap: 2px; }
	.range-tab {
		padding: 0.2rem 0.6rem;
		background: none;
		border: 1.5px solid #ddd7cc;
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		color: #a09688;
		cursor: pointer;
		transition: all 0.12s;
	}
	.range-tab:hover { border-color: #a09688; color: var(--ink); }
	.range-tab.active { border-color: var(--ink); color: var(--ink); background: #fff; }
	.member-count { font-family: inherit; font-size: 0.9rem; color: #a09688; }

	.members-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
	.members-table th {
		text-align: left; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.06em; color: #a09688; padding: 0.4rem 0.75rem; border-bottom: 1.5px solid #ddd7cc;
	}
	.members-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #f0ebe3; vertical-align: middle; }
	.members-table tr:last-child td { border-bottom: none; }

	.email { font-family: monospace; font-size: 0.82rem; color: #555; }
	.muted { color: #a09688; font-size: 0.8rem; }

	.role-pill {
		font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		background: #f0ebe3; color: #a09688; padding: 0.15rem 0.5rem; border-radius: 99px;
	}
	.role-pill.instructor { background: var(--ink); color: var(--paper); }

	.status-online { font-size: 0.8rem; color: #2e7d32; font-weight: 600; }
	.status-offline { font-size: 0.8rem; color: #bbb; }
	.device-cell { font-size: 0.78rem; white-space: nowrap; }
	.device-info { cursor: default; }
	.member-link { color: var(--ink); text-decoration: none; font-weight: 500; }
	.member-link:hover { text-decoration: underline; text-underline-offset: 2px; }
	.btn-reset {
		font-family: inherit; font-size: 0.75rem; font-weight: 500;
		color: #a09688; background: none; border: 1px solid #ddd7cc;
		border-radius: 5px; padding: 0.15rem 0.5rem; cursor: pointer; transition: all 0.12s;
	}
	.btn-reset:hover { border-color: #c0392b; color: #c0392b; }

	/* ── Pending requests ── */
	.pending-section { border: 1.5px solid #f5c6cb; border-radius: 12px; padding: 1.25rem 1.5rem; background: #fff8f8; margin-top: 2.5rem; }
	.pending-section h2 { margin-bottom: 1rem; }

	.pending-list { display: flex; flex-direction: column; gap: 0.75rem; }

	.pending-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		background: #fff;
		border: 1.5px solid #f0ebe3;
		border-radius: 10px;
		padding: 1rem 1.25rem;
	}

	.pending-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--ink);
		color: var(--paper);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Cambridge', serif;
		font-size: 1.1rem;
		flex-shrink: 0;
	}

	.pending-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }

	.pending-name-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
	.pending-name { font-weight: 600; font-size: 0.95rem; color: var(--ink); text-decoration: none; }
	.pending-name:hover { text-decoration: underline; }
	.pending-pronouns { font-size: 0.78rem; color: #a09688; }
	.pending-email { font-size: 0.78rem; color: #a09688; font-family: monospace; }
	.pending-class { font-size: 0.78rem; color: #a09688; font-weight: 500; }
	.pending-bio { font-size: 0.82rem; color: #555; margin: 0.35rem 0 0; line-height: 1.4; }
	.pending-website { font-size: 0.78rem; color: var(--ink); text-decoration: underline; text-underline-offset: 2px; display: block; margin-top: 0.2rem; }

	.pending-actions { display: flex; flex-direction: column; gap: 0.35rem; flex-shrink: 0; }
	.pending-actions form { flex-direction: row; }

	.btn-approve {
		padding: 0.35rem 0.85rem;
		background: #2e7d32;
		color: #fff;
		border: none;
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
		white-space: nowrap;
	}
	.btn-approve:hover { opacity: 0.85; }

	.btn-deny {
		padding: 0.35rem 0.85rem;
		background: none;
		color: #c0392b;
		border: 1.5px solid #c0392b;
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		white-space: nowrap;
	}
	.btn-deny:hover { background: #c0392b; color: #fff; }

	.members-table-wrap {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		margin: 0 -0.25rem;
	}

	@media (max-width: 640px) {
		header {
			flex-wrap: wrap;
			padding: 0.75rem 1rem;
			gap: 0.4rem 1.5rem;
			align-items: flex-start;
		}
		nav { font-size: 0.8rem; gap: 0.75rem; }

		main { padding: 1.25rem 1rem; padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.25rem); }
		h1 { font-size: 1.4rem; }
		.subtitle { font-size: 0.8rem; }
		.page-header { gap: 0.75rem; }
		.header-actions { flex-wrap: wrap; gap: 0.4rem; }

		.create-card { padding: 1rem; }
		.form-row { flex-wrap: wrap; }
		.checkbox-row { flex-wrap: wrap; gap: 0.5rem 1rem; }

		.members-table { min-width: 560px; }
		.members-table td, .members-table th { padding: 0.5rem 0.6rem; font-size: 0.82rem; }

		.pending-card { flex-direction: column; gap: 0.75rem; }
		.pending-avatar { align-self: flex-start; }
		.pending-actions { flex-direction: row; flex-wrap: wrap; }

		.members-section { padding: 1.25rem 1rem; }
		.week-section { padding: 0; }
	}
</style>
