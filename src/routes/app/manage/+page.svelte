<script>
	import { enhance } from '$app/forms';
	import SyllabusBuilder from '$lib/components/SyllabusBuilder.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { createContentRenderer, bubbleFontSize, jumboEmojiCountM, stripMarkup } from '$lib/message-render.js';
	import { getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import { onMount, onDestroy, tick, getContext } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off } from 'firebase/database';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import SpriteSticker from '$lib/components/SpriteSticker.svelte';
	import { hiddenEmoteList, unhideEmote, initHiddenEmotes } from '$lib/hidden-emotes.js';

	// Use the layout's rawPresence directly — same signal that drives the sidebar
	// green dots. No separate Firebase subscription needed for presence here.
	const rawPresenceCtx = getContext('rawPresence');
	const refreshPresence = getContext('refreshPresence');
	const addToast = getContext('addToast');

	let { data, form } = $props();

	// Cooper year — instructor-set per student (onboarding no longer asks it).
	// Thumbnails shown inline per member; the rest collapse into a +N whose
	// title lists their shortcodes, so nothing is silently dropped.
	const EMOTE_PREVIEW = 6;
	const YEARS = ['1st year', '2nd year', '3rd year', '4th year', '5th year', 'Other'];

	let activeTab = $state('assignments');
	let syllabusPreviewOpen = $state(false);

	// ── Gemma daily digest tab ──────────────────────────────────────────
	// Master switch = the instructor's own users.gemma_digest flag (the
	// cron only runs when an instructor has it on); students still opt in
	// individually from their profile-edit page.
	let gemmaMasterOn = $state(data.members.find((m) => m.id === data.currentUser?.id)?.gemmaDigest ?? false);
	// Sync from the server at mount — page-load data can be stale if the
	// setting changed elsewhere (Gemma page opt-out, profile edit).
	onMount(async () => {
		initHiddenEmotes(); // idempotent — seeds the hidden-emote list for this tab
		try {
			const r = await fetch('/api/gemma/settings');
			if (r.ok) gemmaMasterOn = (await r.json()).optIn;
		} catch { /* keep load-time value */ }
	});
	let gemmaTestStatus = $state(null);
	// Live "who's generating right now" — polled every 5s while the Gemma
	// tab is open (reads the per-user in-flight locks). A 1s ticker keeps
	// the elapsed-seconds display counting smoothly between polls.
	let gemmaGenerating = $state([]);
	// Scout worker (kahan web-research poller) health, from the same poll.
	let scoutInfo = $state(null);
	const scoutAgo = (ts) => {
		if (!ts) return 'never';
		const s = Math.round((Date.now() - ts) / 1000);
		if (s < 90) return `${s}s ago`;
		if (s < 5400) return `${Math.round(s / 60)}m ago`;
		return `${Math.round(s / 3600)}h ago`;
	};
	let gemmaGenPolledAt = $state(0);
	let gemmaGenNow = $state(0);
	const gemmaGenSecs = (g) =>
		g.forSecs + Math.max(0, Math.round((gemmaGenNow - gemmaGenPolledAt) / 1000));
	$effect(() => {
		if (activeTab !== 'gemma') return;
		let alive = true;
		const poll = async () => {
			try {
				const r = await fetch('/api/gemma/digest?status=all');
				if (r.ok && alive) {
					const j = await r.json();
					gemmaGenerating = j.generating ?? [];
					scoutInfo = j.scout ?? null;
					gemmaGenPolledAt = Date.now();
					gemmaGenNow = Date.now();
					syncTick();
				}
			} catch { /* keep last */ }
		};
		poll();
		// 5s poll paused while hidden; the 1s clock only runs while
		// something is actually generating (a Date.now() refresh for the
		// elapsed readout — pointless when the list is empty).
		const iv = setInterval(() => { if (!document.hidden) poll(); }, 5000);
		let tick = null;
		const syncTick = () => {
			if (gemmaGenerating.length && !tick) tick = setInterval(() => { if (gemmaGenerating.length) gemmaGenNow = Date.now(); }, 1000);
			else if (!gemmaGenerating.length && tick) { clearInterval(tick); tick = null; }
		};
		syncTick();
		return () => { alive = false; clearInterval(iv); if (tick) clearInterval(tick); };
	});
	let interestsDraft = $state({});
	let interestsStatus = $state({});
	async function toggleGemmaMaster() {
		gemmaMasterOn = !gemmaMasterOn;
		try {
			await fetch('/api/gemma/settings', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ optIn: gemmaMasterOn })
			});
		} catch { gemmaMasterOn = !gemmaMasterOn; }
	}
	async function saveInterests(uid) {
		interestsStatus = { ...interestsStatus, [uid]: 'saving' };
		try {
			const m = data.members.find((x) => x.id === uid);
			const r = await fetch('/api/gemma/settings', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: uid, interests: interestsDraft[uid] ?? m?.interests ?? '' })
			});
			interestsStatus = { ...interestsStatus, [uid]: r.ok ? 'saved' : 'failed' };
		} catch { interestsStatus = { ...interestsStatus, [uid]: 'failed' }; }
		setTimeout(() => { interestsStatus = { ...interestsStatus, [uid]: null }; }, 2000);
	}
	async function sendTestDigest(reset = false) {
		// Guard against double-fires: check the server-side in-flight lock
		// first (generation takes a minute+; the button alone can't protect
		// against reloads or a second tab).
		gemmaTestStatus = 'Checking…';
		try {
			const st = await fetch('/api/gemma/digest?status=1').then((r) => r.json()).catch(() => ({}));
			if (st.inProgress) {
				gemmaTestStatus = 'A digest is already generating — give it a minute';
				setTimeout(() => { gemmaTestStatus = null; }, 5000);
				return;
			}
		} catch { /* proceed */ }
		gemmaTestStatus = reset ? 'Resetting… (takes a minute or two)' : 'Sending… (takes a minute or two)';
		try {
			const r = await fetch('/api/gemma/digest', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(reset ? { reset: true } : {})
			});
			const j = await r.json().catch(() => ({}));
			const first = j.sent?.[0];
			gemmaTestStatus = !r.ok ? 'Failed to send'
				: first?.reason === 'in-progress' ? 'A digest is already generating — give it a minute'
				: first?.delivered ? `Sent ${first.usedLlm ? '(written by Gemma)' : first.reminder ? '(reminder)' : '(template — no LLM key reachable)'} — check your Gemma DM`
				: `Nothing sent (${first?.reason ?? 'no recipients'})`;
		} catch { gemmaTestStatus = 'Failed to send'; }
		setTimeout(() => { gemmaTestStatus = null; }, 8000);
	}

	// Activity chart
	const W = 480, PAD = 4, LABEL_W = 64, ROW_H = 44;
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
		const rp = rawPresenceCtx?.value ?? {};

		// Choose source dataset and optionally filter
		let series;
		if (range.hours) {
			const cutoff = new Date(now - range.hours * 3600_000).toISOString().slice(0, 13) + ':00';
			const currentHour = new Date(Math.floor(now / 3600_000) * 3600_000).toISOString().slice(0, 13) + ':00';

			// Start with server snapshot, then inject currently-online users from live presence
			// so users who came online after page load appear in the chart without a reload.
			const seriesMap = new Map(data.activityByUser.hourly.map((u) => [u.userId, { ...u, points: [...u.points] }]));
			for (const member of data.members) {
				if (member.role === 'instructor') continue;
				const val = rp[member.id];
				if (!val?.online) continue;
				if (!seriesMap.has(member.id)) seriesMap.set(member.id, { userId: member.id, name: member.name, points: [] });
				const u = seriesMap.get(member.id);
				if (!u.points.find((p) => p.bucket === currentHour)) u.points.push({ bucket: currentHour, count: 1 });
			}

			series = [...seriesMap.values()]
				.map((u) => ({ ...u, points: u.points.filter((p) => p.bucket >= cutoff) }))
				.filter((u) => u.points.length);
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

		if (!series.length) return { rows: [], buckets: [], svgH: ROW_H };

		// Collect all buckets (sorted)
		const bucketSet = new Set();
		for (const u of series) for (const p of u.points) bucketSet.add(p.bucket);
		const buckets = [...bucketSet].sort();

		// Each user gets their own swim lane — no overlap
		const chartW = W - LABEL_W;
		const xOf = (b) => LABEL_W + PAD + (buckets.indexOf(b) / Math.max(buckets.length - 1, 1)) * (chartW - PAD * 2);

		const rows = series.map((u, i) => {
			const userMax = Math.max(1, ...u.points.map((p) => p.count));
			const rowTop = i * ROW_H;
			const yOf = (c) => rowTop + PAD + (1 - c / userMax) * (ROW_H - PAD * 2);
			return {
				userId: u.userId,
				name: u.name,
				total: u.total,
				hue: (i * 67) % 360,
				points: u.points.map((p) => `${xOf(p.bucket).toFixed(1)},${yOf(p.count).toFixed(1)}`).join(' '),
				rawPoints: u.points,
				rowY: rowTop,
				labelY: rowTop + ROW_H / 2 + 3.5
			};
		});

		const svgH = series.length * ROW_H;
		return { rows, buckets, svgH };
	});

	// Presence — read directly from the layout's rawPresence via context.
	// The layout owns the Firebase subscription and API poll, so this always
	// matches the sidebar green dots exactly with no race conditions.
	const PRESENCE_TTL = 5 * 60 * 1000;
	let presenceTick = $state(0);
	let now = $state(Date.now());
	let tickTimer;
	let pendingRequestsRef;

	const presenceMap = $derived.by(() => {
		presenceTick; // re-evaluate every minute so TTL expirations render correctly
		const rp = rawPresenceCtx?.value ?? {};
		const cutoff = Date.now() - PRESENCE_TTL;
		const result = {};
		for (const m of data.members) {
			const val = rp[m.id];
			// Current viewer is always online — they're looking at this page right now.
			const isMe = m.id === data.currentUser?.id;
			const online = isMe || !!(val?.online && (val?.lastSeen ?? 0) > cutoff);
			// Build active devices list — filter by TTL too
			// For the current viewer (isMe), skip TTL filter — they're definitionally online now.
		// For others, apply TTL per device to exclude stale/crashed tabs.
		let devices = [];
		if (online) {
			const rawDevices = val?.devices ?? (val?.ua ? [{ ua: val.ua, pwa: val.pwa, mobile: val.mobile, lastSeen: val.lastSeen }] : []);
			devices = isMe ? rawDevices : rawDevices.filter((d) => (d?.lastSeen ?? 0) > cutoff);
		}
			result[m.id] = {
				online,
				lastSeen: val?.lastSeen ?? null,
				ua: online ? (val?.ua ?? null) : null,
				screen: online ? (val?.screen ?? null) : null,
				pwa: online ? (val?.pwa ?? null) : null,
				mobile: online ? (val?.mobile ?? null) : null,
				notif: val?.notif ?? null,
				devices
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

	onMount(async () => {
		// Immediately trigger the layout's presence poll so the manage tab sees
		// accurate online status right away, not on the next scheduled cycle.
		refreshPresence?.();

		// Firebase auth — retry up to 4 times so the pendingRequests subscription
		// doesn't fail with PERMISSION_DENIED due to a timing race with the layout.
		if (data.firebaseToken) {
			for (let i = 1; i <= 4; i++) {
				try { await signInWithCustomToken(auth, data.firebaseToken); break; } catch {
					if (i < 4) await new Promise((r) => setTimeout(r, 500 * i));
				}
			}
		}

		// Subscribe to join-request signals — any write here means a new request came in
		if (data.currentClass?.id) {
			pendingRequestsRef = ref(rtdb, `pendingRequests/${data.currentClass.id}`);
			let firstPending = true;
			onValue(pendingRequestsRef, () => {
				if (firstPending) { firstPending = false; return; } // skip initial fire
				invalidateAll();
				addToast?.('join-request', '', 'New join request', 'Someone wants to join the class');
			}, (err) => {
				console.warn('[manage] pendingRequests subscription denied:', err.code);
			});
		}

		tickTimer = setInterval(() => { presenceTick++; now = Date.now(); }, 60_000);
	});
	onDestroy(() => {
		clearInterval(tickTimer);
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

	// Favicon preview: force the tab icon light or dark so both variants can
	// be checked without changing the OS theme; 'system' restores the
	// media-query favicon that follows the OS setting.
	const FAVICON_MODES = [
		{ key: 'system', label: '🖥️ Favicon: system', href: '/favicon.svg' },
		{ key: 'dark', label: '🌚 Favicon: dark', href: '/favicon-dark.svg' },
		{ key: 'light', label: '🌞 Favicon: light', href: '/favicon-light.svg' }
	];
	let faviconMode = $state(0);

	function toggleFaviconPreview() {
		faviconMode = (faviconMode + 1) % FAVICON_MODES.length;
		const link = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
		if (link) link.href = FAVICON_MODES[faviconMode].href;
	}

	// ── Moderation state ──
	let viewingDmConvId = $state(null);
	let dmMessages = $state([]);
	let dmLoading = $state(false);
	let dmHasMore = $state(false);
	let dmLoadingMore = $state(false);
	let dmListEl = $state(null);

	// ── Reported messages ───────────────────────────────────────────────
	// Status overrides layered over data.messageReports, so a resolve/reopen
	// updates in place without refetching the whole page load.
	let reportStatus = $state({});
	const reportStatusOf = (r) => reportStatus[r.id] ?? r.status;
	const openReportCount = $derived((data.messageReports ?? []).filter((r) => reportStatusOf(r) === 'open').length);

	async function setReportStatus(report, status) {
		const prev = reportStatusOf(report);
		reportStatus = { ...reportStatus, [report.id]: status };
		try {
			const res = await fetch('/api/moderation/report', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: report.id, status })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			reportStatus = { ...reportStatus, [report.id]: prev };
		}
	}

	async function viewDmConversation(convId) {
		if (viewingDmConvId === convId) { closeDmView(); return; }
		viewingDmConvId = convId;
		dmLoading = true;
		dmMessages = [];
		dmHasMore = false;
		try {
			const res = await fetch(`/api/moderation/dm?convId=${encodeURIComponent(convId)}`);
			if (res.ok) {
				const d = await res.json();
				dmMessages = d.messages;
				dmHasMore = d.hasMore;
				requestAnimationFrame(() => {
					if (dmListEl) dmListEl.scrollTop = dmListEl.scrollHeight;
				});
			}
		} catch { /* ignore */ }
		dmLoading = false;
	}

	async function loadMoreDm() {
		if (dmLoadingMore || !dmHasMore || !dmMessages.length || !viewingDmConvId) return;
		dmLoadingMore = true;
		const oldest = dmMessages[0];
		const before = new Date(oldest.createdAt).toISOString();
		try {
			const res = await fetch(`/api/moderation/dm?convId=${encodeURIComponent(viewingDmConvId)}&before=${encodeURIComponent(before)}&limit=50`);
			if (res.ok) {
				const d = await res.json();
				dmHasMore = d.hasMore;
				if (d.messages.length) {
					const prevHeight = dmListEl?.scrollHeight ?? 0;
					const existingIds = new Set(dmMessages.map(m => m.id));
					const newMsgs = d.messages.filter(m => !existingIds.has(m.id));
					dmMessages = [...newMsgs, ...dmMessages];
					requestAnimationFrame(() => {
						if (dmListEl) dmListEl.scrollTop += dmListEl.scrollHeight - prevHeight;
					});
				}
			}
		} catch { /* ignore */ }
		dmLoadingMore = false;
	}

	function onDmScroll() {
		if (dmListEl && dmListEl.scrollTop < 80 && dmHasMore && !dmLoadingMore) loadMoreDm();
	}

	function closeDmView() {
		viewingDmConvId = null;
		dmMessages = [];
		dmHasMore = false;
	}

	function formatRelativeTime(ts) {
		if (!ts) return 'never';
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		const days = Math.floor(diff / 86400_000);
		if (days < 30) return `${days}d ago`;
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatMessageTime(ts) {
		if (!ts) return '';
		const d = new Date(typeof ts === 'number' ? ts : ts);
		return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
	}

	const { contentHtml: renderModContent } = createContentRenderer({ getCeMap: getCachedCustomEmojiMap });

	function formatSize(bytes) {
		if (!bytes) return '0B';
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}

	const TYPE_LABELS = { link: 'Link', image: 'Image', video: 'Video' };
	const ALL_TYPES = ['link', 'image', 'video'];

	// Drop a Lottie player into every `.tg-emoji` span rendered by
	// renderModContent() so animated emote tokens inside week-plan
	// headlines / item labels actually animate on this page. Re-runs
	// whenever the underlying assignments data changes.
	let pageEl = $state(null);
	$effect(() => {
		void data.weeks;
		void activeTab;
		if (!pageEl) return;
		tick().then(() => mountStaticEmotes(pageEl));
	});

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

	// Bar chart hover
	let barHoverIdx = $state(null);
	let barTooltipX = $state(0);
	function handleBarMouseMove(e) {
		barTooltipX = e.clientX - e.currentTarget.getBoundingClientRect().left;
	}

	function handleChartMouseMove(e) {
		const rect = e.currentTarget.getBoundingClientRect();
		const svgX = ((e.clientX - rect.left) / rect.width) * W;
		const buckets = activityChart.buckets;
		if (!buckets?.length) return;
		const raw = (svgX - LABEL_W - PAD) / (W - LABEL_W - PAD * 2) * (buckets.length - 1);
		hoverIdx = Math.max(0, Math.min(buckets.length - 1, Math.round(raw)));
		hoverPct = (e.clientX - rect.left) / rect.width;
	}

	function handleChartMouseLeave() { hoverIdx = null; }

	function formatBucket(bucket) {
		if (!bucket) return '';
		if (bucket.includes('T')) {
			// Bucket is stored as UTC — append Z so Date parses it correctly, then display in local tz
			return new Date(bucket + ':00Z').toLocaleString('en-US', {
				month: 'short', day: 'numeric', hour: 'numeric', hour12: true
			});
		}
		const [y, m, d] = bucket.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>Manage — eating.computer</title>
</svelte:head>

<div class="shell" bind:this={pageEl}>
	<main class:wide={activeTab === 'syllabus'} style:margin-left={syllabusPreviewOpen ? '0px' : null}>
		<div class="page-header">
			<div>
				<h1>Manage</h1>
			</div>
			<div class="header-actions">
				{#if activeTab === 'assignments'}
					<button class="btn-secondary" onclick={toggleFaviconPreview}>
						{FAVICON_MODES[faviconMode].label}
					</button>
					<button class="btn-secondary" onclick={sendTestNotification} disabled={testNotifStatus === 'sending'}>
						{testNotifStatus ?? '🔔 Test notification'}
					</button>
					<a class="btn-primary" href="/app">+ Add on Home</a>
				{/if}
			</div>
		</div>

		<nav class="manage-tabs">
			<button class="manage-tab" class:active={activeTab === 'assignments'} onclick={() => activeTab = 'assignments'}>Assignments</button>
			<button class="manage-tab" class:active={activeTab === 'syllabus'} onclick={() => activeTab = 'syllabus'}>Syllabus</button>
			<button class="manage-tab" class:active={activeTab === 'members'} onclick={() => activeTab = 'members'}>
				Members
				{#if data.pendingRequests.length > 0}<span class="tab-badge">{data.pendingRequests.length}</span>{/if}
			</button>
			<button class="manage-tab" class:active={activeTab === 'activity'} onclick={() => activeTab = 'activity'}>Activity</button>
			<button class="manage-tab" class:active={activeTab === 'moderation'} onclick={() => activeTab = 'moderation'}>
				Moderation
				{#if openReportCount > 0}<span class="tab-badge">{openReportCount}</span>{/if}
			</button>
			<button class="manage-tab" class:active={activeTab === 'gemma'} onclick={() => activeTab = 'gemma'}>Gemma</button>
		</nav>

		{#if activeTab === 'syllabus'}
			<section class="syllabus-section">
				<SyllabusBuilder classId={data.classId} bind:previewOpen={syllabusPreviewOpen} />
			</section>
		{/if}

		{#if activeTab === 'assignments'}
			{#if data.weeks.length === 0}
				<p class="empty">
					No assignments yet.
					<a href="/app">Create one on the Home page</a>
					— the instructor form there is the source of truth.
				</p>
			{/if}

			{#each data.weeks as { week, assignments }}
				{#each assignments as a (a.id)}
					<section class="week-block plan-block" class:important={a.important}>
						<div class="week-header">
							<div class="plan-header-left">
								<h2 class="plan-week">
									Week {week}
									{#if a.important}
										<span class="plan-important-pill" title="Marked important">
											<span class="msi msi-14 msi-fill">star</span> important
										</span>
									{/if}
								</h2>
								{#if a.title}
									<h3 class="plan-headline">{@html renderModContent(a.title, false)}</h3>
								{/if}
								<div class="plan-meta">
									{#if a.dueDate}
										<span class="plan-meta-pill">Due {new Date(a.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
									{/if}
									<span class="plan-meta-pill">{a.itemCount} item{a.itemCount === 1 ? '' : 's'}</span>
									<span class="plan-meta-pill">{a.submissionCount} submission{a.submissionCount === 1 ? '' : 's'}</span>
								</div>
							</div>
							<div class="row-actions">
								<a class="btn-edit" href="/app#edit-{a.id}">Edit on Home</a>
								<form method="POST" action="?/deleteWeekPlan" use:enhance>
									<input type="hidden" name="id" value={a.id} />
									<button type="submit" class="btn-delete" onclick={(e) => { if (!confirm(`Delete Week ${week}? This also removes its items and any student completions.`)) e.preventDefault(); }}>Delete</button>
								</form>
							</div>
						</div>

						{#if a.description}
							<p class="plan-topic-preview">{@html renderModContent(a.description, false)}</p>
						{/if}

						{#if a.items.length > 0}
							<ul class="plan-items">
								{#each a.items as it (it.id)}
									<li class="plan-item-row">
										<span class="plan-item-label">{@html renderModContent(it.label, false)}</span>
										{#if it.requiresSubmission}
											<span class="plan-item-types">{it.acceptedTypes.map((t) => TYPE_LABELS[t] ?? t).join(' / ')}</span>
										{/if}
										<span class="plan-item-count" class:positive={it.completedCount > 0}>
											{it.completedCount}/{a.studentCount} done
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			{/each}
		{/if}

		{#if activeTab === 'members'}
	<!-- Enrollment window. Controls whether the student
	     /onboarding/class picker lists THIS class at all. Toggle off
	     and the class disappears from the picker — old students stay
	     enrolled, but new requests can't come in. Optional date
	     window narrows the open period further. -->
	<section class="members-section enrollment-section">
		<h2>Enrollment window</h2>
		{#if form?.error && form?.action === 'setEnrollment'}
			<p class="error small">{form.error}</p>
		{/if}
		<form method="POST" action="?/setEnrollment" use:enhance class="enrollment-form">
			<label class="enrollment-toggle">
				<input
					type="checkbox"
					name="enrollment_open"
					value="1"
					checked={data.enrollment?.open}
				/>
				<span class="enrollment-toggle-text">
					<span class="enrollment-toggle-title">Accepting new students</span>
					<span class="enrollment-toggle-sub">When off, the class is hidden from the join picker on /onboarding/class. Existing members are unaffected.</span>
				</span>
			</label>
			<div class="enrollment-range">
				<label class="enrollment-date">
					<span>Open from</span>
					<input type="date" name="enrollment_start" value={data.enrollment?.start ?? ''} />
				</label>
				<label class="enrollment-date">
					<span>Open until</span>
					<input type="date" name="enrollment_end" value={data.enrollment?.end ?? ''} />
				</label>
				<span class="enrollment-hint">Leave a date blank for no bound.</span>
			</div>
			<div class="enrollment-actions">
				<button type="submit" class="btn-primary small">Save enrollment window</button>
			</div>
		</form>
	</section>

	{#if data.pendingRequests.length > 0}
	<section class="members-section pending-section">
		<h2>Pending requests <span class="member-count">({data.pendingRequests.length})</span></h2>
		<div class="pending-list">
			{#each data.pendingRequests as req}
				<div class="pending-card">
					<div class="pending-avatar">
						<Avatar
							name={req.userName ?? ''}
							uid={req.userId}
							avatarKind={req.avatarKind ?? 'gen'}
							avatarValue={req.avatarValue ?? null}
							size={44}
						/>
					</div>
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
		{/if}

		{#if activeTab === 'activity'}
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
			{#if activityChart.rows?.length}
				<svg viewBox="0 0 {W} {activityChart.svgH}" width="100%" height={activityChart.svgH}
					class="chart-svg"
					onmousemove={handleChartMouseMove}
					onmouseleave={handleChartMouseLeave}>
					<!-- Swim lane backgrounds and name labels -->
					{#each activityChart.rows as row, i}
						<rect x={0} y={row.rowY} width={W} height={ROW_H} fill={i % 2 === 0 ? 'var(--surface-2)' : '#f5f1eb'} />
						{#if i > 0}
							<line x1={0} y1={row.rowY} x2={W} y2={row.rowY} stroke="var(--border)" stroke-width="0.5" />
						{/if}
						<text x={LABEL_W - 6} y={row.labelY} text-anchor="end" font-size="8" fill="var(--muted-fg)">{row.name.split(' ')[0]}</text>
					{/each}
					<!-- Label column separator -->
					<line x1={LABEL_W} y1={0} x2={LABEL_W} y2={activityChart.svgH} stroke="var(--border)" stroke-width="0.75" />
					<!-- Data lines (each user in their own lane) -->
					{#each activityChart.rows as row}
						{#if row.points}
							<polyline
								points={row.points}
								fill="none"
								stroke="hsl({row.hue} 55% 42%)"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{/if}
					{/each}
					<!-- Hover crosshair -->
					{#if hoverIdx !== null && activityChart.buckets?.length}
						{@const bx = (LABEL_W + PAD + (hoverIdx / Math.max(activityChart.buckets.length - 1, 1)) * (W - LABEL_W - PAD * 2)).toFixed(1)}
						<line x1={bx} y1={0} x2={bx} y2={activityChart.svgH} stroke="rgba(0,0,0,0.2)" stroke-width="0.75" stroke-dasharray="2,2" />
					{/if}
				</svg>
				{#if hoverIdx !== null && activityChart.buckets?.length}
					{@const bucket = activityChart.buckets[hoverIdx]}
					{@const tooltipLeft = Math.min(Math.max(hoverPct * 100, 15), 75)}
					<div class="chart-tooltip" style="left: {tooltipLeft}%">
						<div class="tooltip-date">{formatBucket(bucket)}</div>
						{#each activityChart.rows as row}
							{@const pt = row.rawPoints.find(p => p.bucket === bucket)}
							<div class="tooltip-row">
								<span class="tooltip-dot" style="background: hsl({row.hue} 55% 42%)"></span>
								<span>{row.name.split(' ')[0]}</span>
								<span class="tooltip-count">{pt?.count ?? 0}</span>
							</div>
						{/each}
					</div>
				{/if}
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
			<div class="device-chart-wrap"
				onmousemove={handleBarMouseMove}
				onmouseleave={() => barHoverIdx = null}>
				<svg viewBox="0 0 {SVG_W} {SVG_H}" class="device-chart-svg" style="min-width: {Math.max(260, SVG_W)}px">
					<!-- baseline -->
					<line x1="0" y1={CHART_H} x2={SVG_W} y2={CHART_H} stroke="var(--border)" stroke-width="1"/>
					{#each userBars.users as u, i}
						{@const gx = 12 + i * (groupW + GROUP_GAP)}
						{@const bars = [
							{ val: u.total,          fill: 'hsl(200 55% 48%)' },
							{ val: u.desktop,        fill: 'hsl(220 45% 52%)' },
							{ val: u.mobile,         fill: 'hsl(270 40% 55%)' },
							{ val: u.desktopNoNotif, fill: 'hsl(220 25% 72%)' },
							{ val: u.mobileNoNotif,  fill: 'hsl(270 20% 72%)' }
						]}
						<!-- Hit area for hover -->
						<rect x={gx - BAR_GAP} y={0} width={groupW + BAR_GAP * 2} height={CHART_H}
							fill="transparent" onmouseenter={() => barHoverIdx = i} />
						{#each bars as b, bi}
							{@const bx = gx + bi * (BAR_W + BAR_GAP)}
							{@const h = (b.val / userBars.maxVal) * CHART_H}
							{#if h > 0}
								<rect x={bx} y={CHART_H - h} width={BAR_W} height={h} rx="2" fill={b.fill} opacity="0.9" />
							{/if}
						{/each}
						<!-- name label -->
						{@const firstName = u.name.split(' ')[0]}
						<text x={gx + groupW / 2} y={CHART_H + 14} text-anchor="middle" font-size="7.5" fill="#6b5f54">{firstName}</text>
					{/each}
				</svg>
				{#if barHoverIdx !== null && userBars.users[barHoverIdx]}
					{@const u = userBars.users[barHoverIdx]}
					<div class="bar-tooltip" style="left: {barTooltipX}px">
						<div class="tooltip-date">{u.name}</div>
						<div class="tooltip-row">
							<span class="tooltip-dot" style="background: hsl(200 55% 48%)"></span>
							<span>Total</span>
							<span class="tooltip-count">{u.total}m</span>
						</div>
						{#if u.desktop > 0}
						<div class="tooltip-row">
							<span class="tooltip-dot" style="background: hsl(220 45% 52%)"></span>
							<span>Desktop</span>
							<span class="tooltip-count">{u.desktop}m</span>
						</div>
						{/if}
						{#if u.mobile > 0}
						<div class="tooltip-row">
							<span class="tooltip-dot" style="background: hsl(270 40% 55%)"></span>
							<span>Mobile</span>
							<span class="tooltip-count">{u.mobile}m</span>
						</div>
						{/if}
						{#if u.desktopNoNotif > 0}
						<div class="tooltip-row">
							<span class="tooltip-dot" style="background: hsl(220 25% 72%)"></span>
							<span>Desktop/no notif</span>
							<span class="tooltip-count">{u.desktopNoNotif}m</span>
						</div>
						{/if}
						{#if u.mobileNoNotif > 0}
						<div class="tooltip-row">
							<span class="tooltip-dot" style="background: hsl(270 20% 72%)"></span>
							<span>Mobile/no notif</span>
							<span class="tooltip-count">{u.mobileNoNotif}m</span>
						</div>
						{/if}
					</div>
				{/if}
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
		<h2>Last online</h2>
		<div class="last-online-list">
			{#each data.members.slice().sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0)) as m}
				<div class="last-online-row">
					<span class="last-online-dot" class:online={m.online}></span>
					<span class="last-online-name">{m.name}</span>
					<span class="last-online-time">
						{#if m.online}
							Online now
						{:else if m.lastSeen}
							{(() => {
								const diff = Date.now() - m.lastSeen;
								const mins = Math.floor(diff / 60000);
								if (mins < 1) return 'Just now';
								if (mins < 60) return `${mins}m ago`;
								const hrs = Math.floor(mins / 60);
								if (hrs < 24) return `${hrs}h ago`;
								const days = Math.floor(hrs / 24);
								if (days < 30) return `${days}d ago`;
								return new Date(m.lastSeen).toLocaleDateString();
							})()}
						{:else}
							Never
						{/if}
					</span>
				</div>
			{/each}
		</div>
	</section>

		{/if}

		{#if activeTab === 'members'}
	<section class="members-section">
		<h2>All members <span class="member-count">({data.members.length})</span></h2>
		{#if data.unattributedEmotes?.length}
			<!-- Uploaded before the uploader was recorded, or by a since-deleted
			     user. Shown so the per-member counts above reconcile with the
			     total rather than quietly not adding up. -->
			<p class="unattributed-emotes">
				{data.unattributedEmotes.length} emote{data.unattributedEmotes.length === 1 ? '' : 's'} with no recorded uploader
				<span class="emote-strip">
					{#each data.unattributedEmotes.slice(0, EMOTE_PREVIEW) as e (e.id)}
						<img class="emote-thumb" src={e.url} alt={':' + e.shortcode + ':'} title=":{e.shortcode}:" loading="lazy" />
					{/each}
					{#if data.unattributedEmotes.length > EMOTE_PREVIEW}
						<span class="emote-more">+{data.unattributedEmotes.length - EMOTE_PREVIEW}</span>
					{/if}
				</span>
			</p>
		{/if}

		<div class="onboarding-tools">
			<span class="ot-label">Onboarding</span>
			<a class="btn-reset" href="/onboarding/profile?preview=1">👀 Preview student flow</a>
			<form method="POST" action="?/resetSelf" use:enhance style="display:inline">
				<button type="submit" class="btn-reset" onclick={(e) => { if (!confirm('Send yourself through onboarding now?')) e.preventDefault(); }}>Restart my onboarding</button>
			</form>
			<span class="ot-hint">Reset a student below to send them through it again.</span>
		</div>

		<div class="members-table-wrap">
		<table class="members-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Email</th>
					<th>Role</th>
					<th>Year</th>
					<th>Joined</th>
					<th>Status</th>
					<th>Device</th>
					<th>Notif</th>
					<th>Emotes</th>
					<th>Last seen</th>
					<th title="Telegram emote packs + Emoji Kitchen. Apple sign-ups start with these off.">3rd-party</th>
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
						<td>
							{#if m.role !== 'instructor'}
								<form method="POST" action="?/setYear" use:enhance>
									<input type="hidden" name="user_id" value={m.id} />
									<select name="year" class="year-select" onchange={(e) => e.currentTarget.form.requestSubmit()}>
										<option value="" selected={!m.year}>—</option>
										{#each YEARS as y}<option value={y} selected={m.year === y}>{y}</option>{/each}
									</select>
								</form>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td class="muted">{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
						<td>
							{#if p?.online}
								<span class="status-online">● online</span>
							{:else}
								<span class="status-offline">○ offline</span>
							{/if}
						</td>
						<td class="emote-cell">
							{#if m.emotes?.length}
								<span class="emote-count" title="{m.emotes.length} uploaded">{m.emotes.length}</span>
								<span class="emote-strip">
									{#each m.emotes.slice(0, EMOTE_PREVIEW) as e (e.id)}
										<img class="emote-thumb" src={e.url} alt={':' + e.shortcode + ':'}
											title=":{e.shortcode}:{e.at ? ' · ' + new Date(e.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}"
											loading="lazy" decoding="async" />
									{/each}
									{#if m.emotes.length > EMOTE_PREVIEW}
										<!-- Rest are in the title so nothing is silently dropped. -->
										<span class="emote-more" title={m.emotes.slice(EMOTE_PREVIEW).map((e) => ':' + e.shortcode + ':').join('  ')}
											>+{m.emotes.length - EMOTE_PREVIEW}</span>
									{/if}
								</span>
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td class="muted device-cell">
							{#if p?.online && p.devices?.length}
								<span class="devices-list">
									{#each p.devices as d}
										{@const dev = deviceLabel(d)}
										<span class="device-info" title={d.ua ?? ''}>{dev?.icon ?? '💻'} {dev?.label ?? 'Browser'}</span>
									{/each}
								</span>
							{:else if p?.online}
								{@const dev = deviceLabel(p)}
								<span class="device-info" title={p.ua ?? ''}>{dev?.icon ?? '💻'} {dev?.label ?? 'Browser'}</span>
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
						<td class="muted">{p?.online ? 'just now' : formatLastSeen(p?.lastSeen ?? m.lastSeen ?? null)}</td>
						<td>
							<form method="POST" action="?/setThirdPartyEmotes" use:enhance>
								<input type="hidden" name="user_id" value={m.id} />
								<input
									type="checkbox"
									name="enabled"
									class="tp-toggle"
									checked={m.thirdPartyEmotes}
									title={m.thirdPartyEmotes ? 'Telegram emotes + Emoji Kitchen ON' : 'Telegram emotes + Emoji Kitchen OFF'}
									onchange={(e) => e.currentTarget.form.requestSubmit()}
								/>
							</form>
						</td>
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
		{/if}

		{#if activeTab === 'gemma'}
		<section class="members-section enrollment-section">
			<h2>Gemma digest</h2>
			<label class="enrollment-toggle">
				<input type="checkbox" checked={gemmaMasterOn} onchange={toggleGemmaMaster} />
				<span class="enrollment-toggle-text">
					<span class="enrollment-toggle-title">Enable digests</span>
					<span class="enrollment-toggle-sub">
						Master switch — the daily cron only runs while this is on, and you'll receive the digest too.
						Students must ALSO opt in individually (Profile → Edit). Each morning Gemma DMs a recap of
						yesterday's class chat, gentle reminders for open assignment items, and one inspiration nudge
						built from the interests below. If nothing changed since the last send, Gemma skips the digest
						and sends just a short reminder for un-actioned items (or nothing when all's done). Written
						with your saved Gemma API key (falls back to a plain template if no key is reachable).
						Inspiration comes from the model + interests — Gemma has no web search yet.
					</span>
				</span>
			</label>
			<div class="enrollment-actions">
				<button class="btn-secondary" onclick={() => sendTestDigest(false)} disabled={!!gemmaTestStatus}>
					{gemmaTestStatus ?? '✨ Send me a test digest now'}
				</button>
				<button class="btn-secondary" onclick={() => sendTestDigest(true)} disabled={!!gemmaTestStatus}
					title="Wipes YOUR Gemma conversation, goals and change-detection state, then sends a fresh digest — for testing the first-time experience.">
					🧪 Reset &amp; send first-time digest
				</button>
			</div>
			<p class="gemma-live-status" class:busy={gemmaGenerating.length}>
				{#if gemmaGenerating.length}
					<span class="msi msi-18 gemma-spin">progress_activity</span>
					Generating now: {gemmaGenerating.map((g) => `${g.name ?? g.userId} (${gemmaGenSecs(g)}s)`).join(', ')}
				{:else}
					No digests generating right now.
				{/if}
			</p>
			{#if scoutInfo}
				<p class="gemma-live-status" class:busy={scoutInfo.online}>
					{#if scoutInfo.online}
						● Scout online — kahan is watching for research jobs{scoutInfo.queued ? ` (${scoutInfo.queued} in queue)` : ''}. Digest inspiration uses real are.na / Wikipedia links.
					{:else}
						○ Scout offline (last seen {scoutAgo(scoutInfo.lastSeen)}) — inspiration falls back to cached finds or model knowledge. Start it on kahan: <code>~/scout/run.sh</code>
					{/if}
				</p>
			{/if}
		</section>

		<section class="members-section">
			<h2>Student interests <span class="member-count">(fed to Gemma for inspiration)</span></h2>
			<div class="gemma-interest-list">
				{#each data.members.filter((m) => m.role !== 'instructor') as m (m.id)}
					<div class="gemma-interest-row">
						<div class="gemma-interest-head">
							<Avatar name={m.name} uid={m.id} avatarKind={m.avatarKind ?? 'gen'} avatarValue={m.avatarValue ?? null} size={30} />
							<span class="gemma-interest-name">{m.name || 'Unnamed'}</span>
							<span class="gemma-optin" class:on={m.gemmaDigest}>{m.gemmaDigest ? 'opted in' : 'not opted in'}</span>
						</div>
						<textarea
							class="gemma-interest-input"
							rows="2"
							placeholder="Interests, goals, things they want to make… (e.g. generative type, analog synths, zines)"
							value={interestsDraft[m.id] ?? m.interests}
							oninput={(e) => (interestsDraft = { ...interestsDraft, [m.id]: e.currentTarget.value })}
						></textarea>
						<button class="btn-secondary small" onclick={() => saveInterests(m.id)} disabled={interestsStatus[m.id] === 'saving'}>
							{interestsStatus[m.id] === 'saving' ? 'Saving…' : interestsStatus[m.id] === 'saved' ? 'Saved ✓' : interestsStatus[m.id] === 'failed' ? 'Failed — retry' : 'Save interests'}
						</button>
					</div>
				{/each}
				{#if !data.members.some((m) => m.role !== 'instructor')}
					<p class="empty">No students in the class yet.</p>
				{/if}
			</div>
		</section>
		{/if}

		{#if activeTab === 'moderation'}
	<section class="members-section">
		<h2>Reported messages <span class="member-count">({openReportCount} open)</span></h2>
		<p class="chart-empty" style="margin-bottom:0.75rem">
			Messages members flagged with <strong>Report</strong> in chat. The content shown is a
			snapshot from the moment of the report, so it survives edits and deletions.
		</p>
		{#if (data.messageReports ?? []).length === 0}
			<p class="chart-empty">No reports.</p>
		{:else}
			<div class="report-list">
				{#each data.messageReports as report (report.id)}
					{@const status = reportStatusOf(report)}
					<div class="report-card" class:report-resolved={status === 'resolved'}>
						<div class="report-info">
							<div class="report-head">
								<strong>{report.reporterName || 'Unknown'}</strong> reported
								<strong>{report.authorName || 'Unknown'}</strong>
								<span class="report-conv">in {report.conversationId}</span>
								<span class="report-time">{formatRelativeTime(new Date(report.createdAt.replace(' ', 'T') + 'Z').getTime())}</span>
							</div>
							<div class="report-content">{report.content || '(no text — attachment or emote message)'}</div>
							{#if report.reason}<div class="report-reason">Reason: {report.reason}</div>{/if}
						</div>
						<button class="btn-edit" onclick={() => setReportStatus(report, status === 'open' ? 'resolved' : 'open')}>
							{status === 'open' ? 'Resolve' : 'Reopen'}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>
	<section class="members-section">
		<h2>Hidden emotes <span class="member-count">({$hiddenEmoteList.length})</span></h2>
		<p class="chart-empty" style="margin-bottom:0.75rem">
			Emotes you've hidden from the animated library. Students can't see or send these.
			To hide more, open the emote picker's Animated tab and tap <strong>Hide emotes</strong>.
		</p>
		{#if $hiddenEmoteList.length === 0}
			<p class="chart-empty">Nothing hidden.</p>
		{:else}
			<div class="hidden-emote-grid">
				{#each $hiddenEmoteList as h (h.key)}
					<div class="hidden-emote-card">
						<div class="hidden-emote-art">
							<SpriteSticker
								cp={h.type === 'custom' ? null : h.cp}
								short={h.type === 'custom' ? h.short : null}
								id={h.type === 'custom' ? h.id : null}
								size={40} loop={true} eager={true} ignoreHidden={true} title={h.alt || ''} />
						</div>
						<button class="btn-unhide" onclick={() => unhideEmote(h.key)}>Unhide</button>
					</div>
				{/each}
			</div>
		{/if}
	</section>
	<section class="members-section">
		<h2>DM Conversations <span class="member-count">({data.dmConversations.length})</span></h2>
		{#if data.dmConversations.length === 0}
			<p class="chart-empty">No DM conversations found.</p>
		{:else}
			<div class="dm-list">
				{#each data.dmConversations as conv}
					<div class="dm-card" class:dm-card-active={viewingDmConvId === conv.convId}>
						<div class="dm-card-info">
							<div class="dm-participants">
								{conv.participants.map(p => p.name).join(' ↔ ')}
							</div>
							<div class="dm-preview">{conv.lastMessage ? (conv.lastMessage.length > 80 ? conv.lastMessage.slice(0, 80) + '…' : conv.lastMessage) : 'No messages'}</div>
							<div class="dm-meta">
								<span class="dm-time">{formatRelativeTime(conv.lastAt)}</span>
								<span class="dm-count">{conv.msgCount} archived msg{conv.msgCount === 1 ? '' : 's'}</span>
							</div>
						</div>
						<button class="btn-edit" onclick={() => viewDmConversation(conv.convId)}>
							{viewingDmConvId === conv.convId ? 'Close' : 'View'}
						</button>
					</div>

					{#if viewingDmConvId === conv.convId}
						<div class="dm-chat-panel">
							{#if dmLoading}
								<div class="dm-chat-loading"><span class="sending-spinner"></span></div>
							{:else if dmMessages.length === 0}
								<p class="dm-chat-empty">No archived messages for this conversation.</p>
							{:else}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="dm-chat-scroll" bind:this={dmListEl} onscroll={onDmScroll}>
									{#if dmLoadingMore}
										<div class="dm-load-more"><span class="sending-spinner"></span></div>
									{/if}
									{#if dmHasMore && !dmLoadingMore}
										<button class="dm-load-more-btn" onclick={loadMoreDm}>Load older messages</button>
									{/if}
									{#each dmMessages as msg, i (msg.id)}
										{@const prev = dmMessages[i - 1]}
										{@const isFirst = !prev || prev.userId !== msg.userId || msg.createdAt - prev.createdAt > 300000}
										{@const participantA = conv.participants[0]?.id}
										{@const isRight = msg.userId === participantA}
										<div class="dm-msg-row" class:dm-right={isRight} class:dm-first={isFirst}>
											{#if isFirst}
												<div class="dm-msg-meta">
													<span class="dm-msg-name">{msg.userName}</span>
													<span class="dm-msg-time">{formatMessageTime(msg.createdAt)}</span>
												</div>
											{/if}
											<div class="dm-bubble-row">
												{#if msg.attachment}
													{#if msg.attachment.mimetype?.startsWith('image/')}
														<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="dm-bubble dm-bubble-img">
															<img src={msg.attachment.url} alt={msg.attachment.filename} />
														</a>
													{:else if msg.attachment.mimetype?.startsWith('video/')}
														<div class="dm-bubble dm-bubble-video">
															<!-- svelte-ignore a11y_media_has_caption -->
															<video src={msg.attachment.url} controls preload="metadata"></video>
														</div>
													{:else}
														<div class="dm-bubble dm-bubble-file" class:dm-right-bubble={isRight}>
															<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="dm-file-link">
																{msg.attachment.filename || 'File'} <span class="dm-file-size">({formatSize(msg.attachment.size)})</span>
															</a>
														</div>
													{/if}
												{/if}
												{#if msg.content?.trim()}
													<p class="dm-bubble"
														class:dm-right-bubble={isRight}
														class:fx-shake={msg.fx === 'shake'}
														class:fx-bounce={msg.fx === 'bounce'}
														class:fx-wave={msg.fx === 'wave'}
														class:fx-jitter={msg.fx === 'jitter'}
														class:fx-big={msg.fx === 'big'}
														class:fx-small={msg.fx === 'small'}
														class:fx-rainbow={msg.fx === 'rainbow'}
														class:fx-hearts={msg.fx === 'hearts'}
														style:font-size={bubbleFontSize(msg.content, msg.fontSize)}
														style:font-weight={msg.fontWeight && msg.fontWeight !== 400 ? msg.fontWeight : null}
														style:font-stretch={msg.fontStretch && msg.fontStretch !== 100 ? `${msg.fontStretch}%` : null}
													>{@html renderModContent(msg.content)}{#if msg.edited}<span class="dm-edited-tag"> (edited)</span>{/if}</p>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</section>
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

	main {
		padding: 2rem;
		padding-top: calc(2rem + var(--header-h, 52px));
		max-width: 860px;
		width: 100%;
		margin: 0 auto;
		display: block;
		min-height: unset;
		place-items: unset;
	}
	/* Syllabus: google-docs-style full-bleed workspace — the builder's
	   sidebar / editor / preview panes get the whole viewport width */
	main.wide {
		max-width: none;
		padding-left: 1.25rem;
		padding-right: 1.25rem;
	}

	/* ── Tabs ── */
	.manage-tabs {
		display: flex; gap: 0; margin-bottom: 1.5rem;
		border-bottom: 1.5px solid var(--border);
		/* Six tabs don't fit a phone. Without this the strip just CLIPPED —
		   Moderation (the reports queue) and Gemma were unreachable on
		   mobile. Scrolls horizontally, scrollbar hidden. */
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.manage-tabs::-webkit-scrollbar { display: none; }
	.tp-toggle { accent-color: var(--ink); cursor: pointer; }

	.manage-tab {
		font-family: inherit; font-size: 0.88rem; font-weight: 500;
		padding: 0.5rem 1.1rem; border: none; background: none; cursor: pointer;
		color: var(--muted-fg); border-bottom: 2px solid transparent; margin-bottom: -1.5px;
		transition: color 0.15s, border-color 0.15s;
		display: flex; align-items: center; gap: 0.4rem;
		flex-shrink: 0; white-space: nowrap;
	}
	.manage-tab:hover { color: var(--ink); }
	.manage-tab.active { color: var(--ink); border-bottom-color: var(--ink); }
	.tab-badge {
		background: #e53935; color: #fff; font-size: 0.65rem; font-weight: 700;
		border-radius: 99px; padding: 0.1rem 0.4rem; min-width: 1.1rem; text-align: center;
	}

	.syllabus-section { padding-top: 0.25rem; }

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
		font-family: 'Avara', serif;
		font-size: 2rem;
		font-weight: 400;
		margin: 0 0 0.25rem;
	}

	.subtitle {
		font-size: 0.82rem;
		color: var(--muted-fg);
		margin: 0;
	}
	.subtitle a { color: inherit; }

	/* ── Forms ── */
	.create-card, .inline-form-card {
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
	.inline-form-card {
		margin-bottom: 0.5rem;
		border-color: var(--border);
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
		border: 1.5px solid var(--border);
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
		border: 1.5px solid var(--border);
		border-radius: 8px;
		background: var(--paper);
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
		color: var(--muted-fg);
		cursor: pointer;
	}
	.btn-ghost:hover { color: var(--ink); }

	.btn-add-inline {
		padding: 0.25rem 0.65rem;
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--muted-fg);
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.15s;
	}
	.btn-add-inline:hover { border-color: var(--ink); color: var(--ink); }

	.btn-edit {
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink);
		background: none;
		border: 1.5px solid var(--border);
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
		color: var(--danger);
		background: none;
		border: 1.5px solid transparent;
		border-radius: 6px;
		padding: 0.2rem 0.55rem;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.btn-delete:hover { border-color: var(--danger); }

	.req { color: var(--danger); }

	.error {
		padding: 0.5rem 0.75rem;
		background: #fff0f0;
		border: 1.5px solid #f5c6cb;
		border-radius: 8px;
		color: var(--danger);
		font-size: 0.85rem;
		margin: 0;
	}
	.error.small { font-size: 0.8rem; padding: 0.35rem 0.6rem; }

	/* ── Week blocks ── */
	.week-block { margin-bottom: 2.5rem; }

	/* ── Week-plan blocks (new) ───────────────────
	   The assignments tab now mirrors the home page's data instead
	   of the legacy `assignments` table. Each row collapses one
	   week_plan into a card with its headline, items, and the same
	   N/M completion ratios the instructor sees on the Home overview. */
	.plan-block {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 14px;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
	}
	.plan-block.important {
		border-color: color-mix(in srgb, var(--md-sys-color-secondary, var(--accent)) 55%, var(--border));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-sys-color-secondary, var(--accent)) 18%, transparent);
	}
	.plan-block .week-header { align-items: flex-start; }
	.plan-header-left { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; flex: 1; }
	.plan-week {
		display: inline-flex; align-items: center; gap: 0.5rem;
		font-size: 0.72rem !important; font-weight: 700 !important;
		text-transform: uppercase; letter-spacing: 0.09em;
		color: var(--muted-fg) !important; margin: 0 !important;
	}
	.plan-important-pill {
		display: inline-flex; align-items: center; gap: 0.25rem;
		padding: 0.1rem 0.5rem; border-radius: 999px;
		background: color-mix(in srgb, var(--md-sys-color-secondary, var(--accent)) 18%, transparent);
		color: var(--md-sys-color-secondary, var(--accent));
		font-size: 0.6rem; letter-spacing: 0.06em;
	}
	.plan-headline {
		font-family: 'Avara', serif;
		font-size: 1.05rem; font-weight: 400; line-height: 1.25;
		color: var(--ink); margin: 0;
	}
	.plan-meta { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.plan-meta-pill {
		font-size: 0.7rem; color: var(--muted-fg);
		padding: 0.1rem 0.5rem; border-radius: 999px;
		background: var(--surface-2);
	}
	.plan-topic-preview {
		margin: 0.5rem 0 0;
		font-size: 0.85rem; color: var(--muted-fg); line-height: 1.4;
	}
	.plan-items {
		list-style: none; padding: 0;
		margin: 0.75rem 0 0;
		display: flex; flex-direction: column; gap: 0.3rem;
	}
	.plan-item-row {
		display: flex; align-items: center; gap: 0.6rem;
		padding: 0.4rem 0.6rem;
		background: var(--surface-2); border-radius: 8px;
		font-size: 0.85rem; color: var(--ink);
	}
	.plan-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.plan-item-types {
		font-size: 0.7rem; color: var(--muted-fg);
		padding: 0.1rem 0.45rem; border-radius: 999px;
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		flex-shrink: 0;
	}
	.plan-item-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem; color: var(--muted-fg); flex-shrink: 0;
	}
	.plan-item-count.positive { color: var(--md-sys-color-primary, var(--accent)); font-weight: 600; }

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
		color: var(--muted-fg);
		margin: 0;
	}

	.assignment-table {
		border: 1.5px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
		background: var(--paper);
	}

	.row {
		border-bottom: 1px solid var(--surface-2);
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
		color: var(--muted-fg);
		white-space: nowrap;
	}

	.row-types {
		font-size: 0.75rem;
		color: var(--muted-fg);
		white-space: nowrap;
	}

	.row-subs {
		font-size: 0.75rem;
		color: var(--muted-fg);
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

	.empty { color: var(--muted-fg); font-size: 0.9rem; }

	.activity-chart { margin-top: 0.75rem; position: relative; }
	.chart-svg { width: 100%; display: block; border-radius: 6px; cursor: crosshair; }

	.chart-tooltip {
		position: absolute;
		top: 0; transform: translateX(-50%);
		background: var(--ink); color: var(--paper);
		border-radius: 7px; padding: 0.45rem 0.65rem;
		font-size: 0.72rem; pointer-events: none;
		white-space: nowrap; z-index: 10;
		box-shadow: 0 2px 12px rgba(0,0,0,0.25);
	}
	.tooltip-date { font-weight: 600; margin-bottom: 0.25rem; color: var(--border); }
	.tooltip-row { display: flex; align-items: center; gap: 0.35rem; }
	.tooltip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
	.tooltip-count { margin-left: auto; padding-left: 0.75rem; opacity: 0.7; }
	.chart-legend {
		display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-top: 0.6rem;
	}
	.legend-item { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: var(--muted-fg); }
	.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.legend-count { font-size: 0.68rem; color: var(--border); }
	.chart-empty { font-size: 0.85rem; color: var(--muted-fg); margin: 0.5rem 0 0; }
	.chart-labels {
		position: absolute; bottom: 0; left: 0; right: 0;
		font-size: 0.65rem; color: var(--muted-fg);
	}
	.chart-labels span { position: absolute; transform: translateX(-50%); }

	.device-chart-wrap { margin-top: 0.75rem; overflow-x: auto; -webkit-overflow-scrolling: touch; position: relative; }
	.bar-tooltip {
		position: absolute;
		top: 0; transform: translateX(-50%);
		background: var(--ink); color: var(--paper);
		border-radius: 7px; padding: 0.45rem 0.65rem;
		font-size: 0.72rem; pointer-events: none;
		white-space: nowrap; z-index: 10;
		box-shadow: 0 2px 12px rgba(0,0,0,0.25);
	}
	.device-chart-svg { display: block; height: 152px; }
	.ud-legend {
		display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 1rem;
		margin-top: 0.6rem; font-size: 0.72rem; color: var(--muted-fg);
	}
	.ud-swatch {
		display: inline-block; width: 10px; height: 10px;
		border-radius: 2px; vertical-align: middle; margin-right: 0.2rem;
	}

	.members-section { margin-top: 2.5rem; }
	.members-section h2 { font-family: 'Avara', serif; font-size: 1.25rem; font-weight: 400; margin: 0; }

	.last-online-list { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.75rem; }
	.last-online-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
	.last-online-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; flex-shrink: 0; }
	.last-online-dot.online { background: #27ae60; }
	.last-online-name { font-weight: 500; color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.last-online-time { margin-left: auto; color: var(--muted-fg); font-size: 0.78rem; white-space: nowrap; }

	.chart-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.75rem; flex-wrap: wrap; }

	.range-tabs { display: flex; gap: 2px; }
	.range-tab {
		padding: 0.2rem 0.6rem;
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--muted-fg);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.range-tab:hover { border-color: var(--muted-fg); color: var(--ink); }
	.range-tab.active { border-color: var(--ink); color: var(--ink); background: var(--paper); }
	.member-count { font-family: inherit; font-size: 0.9rem; color: var(--muted-fg); }

	.members-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
	.members-table th {
		text-align: left; font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.06em; color: var(--muted-fg); padding: 0.4rem 0.75rem; border-bottom: 1.5px solid var(--border);
	}
	.members-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--surface-2); vertical-align: middle; }
	.members-table tr:last-child td { border-bottom: none; }

	.email { font-family: monospace; font-size: 0.82rem; color: var(--muted-fg); }
	.muted { color: var(--muted-fg); font-size: 0.8rem; }

	.role-pill {
		font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
		background: var(--surface-2); color: var(--muted-fg); padding: 0.15rem 0.5rem; border-radius: 99px;
	}
	.role-pill.instructor { background: var(--ink); color: var(--paper); }

	.status-online { font-size: 0.8rem; color: #2e7d32; font-weight: 600; }
	.status-offline { font-size: 0.8rem; color: #bbb; }
	.device-cell { font-size: 0.78rem; white-space: nowrap; }
	.device-info { cursor: default; }
	.devices-list { display: flex; flex-direction: column; gap: 2px; }
	.member-link { color: var(--ink); text-decoration: none; font-weight: 500; }
	.member-link:hover { text-decoration: underline; text-underline-offset: 2px; }
	.btn-reset {
		font-family: inherit; font-size: 0.75rem; font-weight: 500;
		color: var(--muted-fg); background: none; border: 1px solid var(--border);
		border-radius: 5px; padding: 0.15rem 0.5rem; cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.btn-reset:hover { border-color: var(--danger); color: var(--danger); }
	.btn-reset[href] { text-decoration: none; display: inline-block; }
	.btn-reset[href]:hover { border-color: var(--accent); color: var(--accent); }

	.onboarding-tools {
		display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem;
		margin: 0 0 1rem; padding: 0.6rem 0.85rem;
		background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
	}
	.ot-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted-fg); }
	.ot-hint { font-size: 0.72rem; color: var(--muted-fg); }
	.year-select {
		font-family: inherit; font-size: 0.78rem; color: var(--ink);
		background: var(--paper); border: 1px solid var(--border); border-radius: 6px;
		padding: 0.15rem 0.35rem; cursor: pointer;
	}
	.year-select:hover { border-color: var(--accent); }

	/* ── Pending requests ── */
	.pending-section { border: 1.5px solid #f5c6cb; border-radius: 12px; padding: 1.25rem 1.5rem; background: #fff8f8; margin-top: 2.5rem; }
	.pending-section h2 { margin-bottom: 1rem; }

	/* Enrollment window card. Sits above the pending-requests block
	   so the instructor sees the gate first, then the queue of
	   incoming requests it produces. */
	.enrollment-section {
		border: 1.5px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		background: var(--md-sys-color-surface-container, var(--surface-2));
		margin-top: 1.5rem;
	}
	.enrollment-section h2 { margin: 0 0 1rem; }
	.enrollment-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.enrollment-toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		cursor: pointer;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: var(--paper);
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		transition: border-color 140ms ease;
	}
	.enrollment-toggle:has(input:checked) {
		border-color: var(--md-sys-color-primary, var(--accent));
	}
	.enrollment-toggle input { margin-top: 0.2rem; flex-shrink: 0; accent-color: var(--md-sys-color-primary, var(--accent)); }
	.enrollment-toggle-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.enrollment-toggle-title { font-size: 0.92rem; font-weight: 600; color: var(--ink); }
	.enrollment-toggle-sub { font-size: 0.78rem; color: var(--md-sys-color-on-surface-variant, var(--muted-fg)); line-height: 1.35; }
	.enrollment-range {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		align-items: flex-end;
	}
	.enrollment-date {
		display: flex; flex-direction: column; gap: 0.25rem;
		font-size: 0.78rem; color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}
	.enrollment-date input {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 8px;
		background: var(--paper);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.85rem;
	}
	.enrollment-hint {
		font-size: 0.72rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		font-style: italic;
		padding-bottom: 0.4rem;
	}
	.enrollment-actions { display: flex; justify-content: flex-end; }

	.pending-list { display: flex; flex-direction: column; gap: 0.75rem; }

	.pending-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		background: var(--paper);
		border: 1.5px solid var(--surface-2);
		border-radius: 10px;
		padding: 1rem 1.25rem;
	}

	/* The Avatar component owns sizing + typography now; the wrapper
	   just provides flex alignment in the pending-card row. */
	.pending-avatar { flex-shrink: 0; display: inline-flex; }

	.pending-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }

	.pending-name-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
	.pending-name { font-weight: 600; font-size: 0.95rem; color: var(--ink); text-decoration: none; }
	.pending-name:hover { text-decoration: underline; }
	.pending-pronouns { font-size: 0.78rem; color: var(--muted-fg); }
	.pending-email { font-size: 0.78rem; color: var(--muted-fg); font-family: monospace; }
	.pending-class { font-size: 0.78rem; color: var(--muted-fg); font-weight: 500; }
	.pending-bio { font-size: 0.82rem; color: var(--muted-fg); margin: 0.35rem 0 0; line-height: 1.4; }
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
		color: var(--danger);
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
		.dm-card { flex-direction: column; gap: 0.75rem; }
		.dm-card-info { gap: 0.25rem; }
	}

	/* ── Moderation: DM list ── */
	.hidden-emote-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 0.6rem; margin-top: 0.5rem; }
	.hidden-emote-card { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; padding: 0.6rem 0.4rem; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
	.hidden-emote-art { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
	.btn-unhide { width: 100%; padding: 0.25rem 0; border: 1.5px solid var(--border); border-radius: 6px; background: var(--paper); color: var(--ink); font-family: inherit; font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: background 0.13s, color 0.13s, border-color 0.13s; }
	.btn-unhide:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }

	/* ── Reported messages ── */
	.report-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
	.report-card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 10px;
		padding: 0.85rem 1.1rem;
	}
	.report-card.report-resolved { opacity: 0.55; }
	.report-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.report-head { font-size: 0.85rem; color: var(--ink); }
	.report-conv { color: var(--muted-fg); margin-left: 0.35rem; }
	.report-time { color: var(--muted-fg); margin-left: 0.35rem; font-size: 0.78rem; }
	.report-content {
		font-size: 0.88rem;
		color: var(--ink);
		background: var(--surface-2, rgba(0,0,0,0.04));
		border-radius: 8px;
		padding: 0.5rem 0.7rem;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 8rem;
		overflow-y: auto;
	}
	.report-reason { font-size: 0.8rem; color: var(--muted-fg); }

	.dm-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }

	.dm-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 10px;
		padding: 0.85rem 1.1rem;
		transition: border-color 0.15s;
	}
	.dm-card:hover { border-color: var(--border); }
	.dm-card-active { border-color: var(--ink); }

	.dm-card-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }

	.dm-participants {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dm-preview {
		font-size: 0.82rem;
		color: var(--muted-fg);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dm-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--muted-fg);
	}

	/* ── Moderation: chat panel ── */
	.dm-chat-panel {
		background: #f7f3ed;
		border: 1.5px solid var(--border);
		border-radius: 10px;
		margin-top: -0.25rem;
		margin-bottom: 0.25rem;
		overflow: hidden;
	}
	.dm-chat-loading, .dm-chat-empty {
		display: flex; justify-content: center; align-items: center;
		padding: 2rem; color: var(--muted-fg); font-size: 0.85rem;
	}
	.dm-chat-scroll {
		display: flex; flex-direction: column; gap: 0.15rem;
		max-height: 600px; overflow-y: auto; padding: 1rem 1.25rem;
		overscroll-behavior: contain;
	}
	.dm-chat-scroll::-webkit-scrollbar { width: 4px; }
	.dm-chat-scroll::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
	.sending-spinner { display: block; width: 10px; height: 10px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: mod-spin 0.7s linear infinite; opacity: 0.35; }
	@keyframes mod-spin { to { transform: rotate(360deg); } }
	.dm-load-more { display: flex; justify-content: center; padding: 0.5rem 0; }
	.dm-load-more-btn {
		font-family: inherit; font-size: 0.75rem; font-weight: 500;
		color: var(--muted-fg); background: none; border: 1px solid var(--border);
		border-radius: 6px; padding: 0.3rem 0.75rem; cursor: pointer;
		margin: 0 auto 0.75rem; display: block;
	}
	.dm-load-more-btn:hover { border-color: var(--ink); color: var(--ink); }

	/* Message rows */
	.dm-msg-row {
		display: flex; flex-direction: column;
		max-width: 75%; gap: 0.1rem;
		align-self: flex-start; align-items: flex-start;
	}
	.dm-msg-row.dm-right {
		align-self: flex-end; align-items: flex-end;
	}
	.dm-msg-row.dm-first { margin-top: 0.6rem; }
	.dm-msg-meta {
		display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem;
	}
	.dm-msg-name { font-size: 0.78rem; font-weight: 600; color: var(--ink); }
	.dm-msg-time { font-size: 0.72rem; color: var(--muted-fg); }

	/* Bubbles */
	.dm-bubble-row { position: relative; display: flex; align-items: flex-end; gap: 0.3rem; max-width: 100%; min-width: 0; }
	.dm-msg-row.dm-right .dm-bubble-row { flex-direction: row-reverse; }

	.dm-bubble {
		margin: 0; padding: 0.55rem 0.85rem; border-radius: 14px;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		background: var(--paper); border: 1.5px solid var(--border);
	}
	.dm-bubble.dm-right-bubble { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.dm-edited-tag { font-size: 0.68rem; color: var(--muted-fg); font-style: italic; }
	.dm-right-bubble .dm-edited-tag { color: rgba(255,255,255,0.5); }

	/* Bubble-level effects */
	.dm-bubble.fx-shake { animation: tfx-shake 0.45s ease infinite; }
	.dm-bubble.fx-bounce { animation: tfx-bounce 0.55s ease infinite; }
	.dm-bubble.fx-wave { animation: tfx-wave 1.1s ease-in-out infinite; }
	.dm-bubble.fx-jitter { animation: tfx-jitter 0.11s linear infinite; }
	.dm-bubble.fx-big { animation: tfx-big 0.75s ease-in-out infinite; }
	.dm-bubble.fx-small { animation: tfx-small 0.75s ease-in-out infinite; }
	.dm-bubble.fx-rainbow {
		background: linear-gradient(135deg, #e74c3c, #e67e22, #d4ac0d, #27ae60, #2980b9, #8e44ad) !important;
		color: #fff !important; border-color: transparent !important;
	}
	.dm-bubble.fx-hearts { background: #ffe0ec !important; border-color: #f5a0c0 !important; }


	:global(.dm-bubble .tfx) { display: inline-block; }

	/* Attachments */
	.dm-bubble-img { display: block; border-radius: 14px; overflow: hidden; border: 1.5px solid var(--border); }
	.dm-bubble-img img { display: block; max-width: 280px; max-height: 240px; object-fit: cover; border-radius: 12px; }
	.dm-bubble-video { border-radius: 14px; overflow: hidden; border: 1.5px solid var(--border); }
	.dm-bubble-video video { display: block; max-width: 320px; max-height: 240px; border-radius: 12px; }
	.dm-bubble-file {
		padding: 0.5rem 0.85rem; border-radius: 14px;
		background: var(--paper); border: 1.5px solid var(--border);
	}
	.dm-bubble-file.dm-right-bubble { background: var(--ink); border-color: var(--ink); }
	.dm-file-link {
		font-size: 0.85rem; font-weight: 500;
		color: var(--ink); text-decoration: underline; text-underline-offset: 2px;
	}
	.dm-right-bubble .dm-file-link { color: var(--paper); }
	.dm-file-size { font-size: 0.75rem; color: var(--muted-fg); }

	@media (max-width: 640px) {
		.dm-msg-row { max-width: 88%; }
		.dm-chat-scroll { padding: 0.75rem 0.875rem; }
	}

	/* ── Gemma digest tab ── */
	.gemma-live-status {
		margin: 0.6rem 0 0; font-size: 0.75rem; color: var(--muted-fg);
		display: flex; align-items: center; gap: 0.35rem;
	}
	.gemma-live-status.busy { color: var(--md-sys-color-primary, var(--accent)); font-weight: 600; }
	.gemma-spin { display: inline-block; animation: gemma-spin 1s linear infinite; }
	@keyframes gemma-spin { to { transform: rotate(360deg); } }
	.gemma-interest-list { display: flex; flex-direction: column; gap: 1rem; }
	.gemma-interest-row {
		display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--border); border-radius: 12px;
		background: var(--md-sys-color-surface-container, var(--surface-2, var(--paper)));
	}
	.gemma-interest-head { display: flex; align-items: center; gap: 0.5rem; }
	.gemma-interest-name { font-weight: 600; font-size: 0.9rem; }
	.gemma-optin {
		font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
		padding: 0.1rem 0.45rem; border-radius: 99px;
		border: 1px solid var(--border); color: var(--muted-fg);
	}
	.gemma-optin.on {
		color: var(--md-sys-color-primary, var(--accent));
		border-color: var(--md-sys-color-primary, var(--accent));
	}
	.gemma-interest-input {
		width: 100%; box-sizing: border-box; resize: vertical;
		font-family: inherit; font-size: 0.85rem; line-height: 1.4;
		padding: 0.5rem 0.65rem; border: 1px solid var(--border); border-radius: 8px;
		background: var(--paper); color: var(--ink);
	}
	/* Uploaded-emote column in the members table. */
	.emote-cell { white-space: nowrap; }
	.emote-count {
		display: inline-block; min-width: 1.4rem;
		padding: 0.05rem 0.3rem; margin-right: 0.35rem;
		border-radius: 999px; text-align: center;
		background: var(--surface-2); color: var(--ink);
		font-size: 0.72rem; font-weight: 700;
	}
	.emote-strip { display: inline-flex; align-items: center; gap: 2px; vertical-align: middle; }
	.emote-thumb { width: 20px; height: 20px; object-fit: contain; border-radius: 4px; }
	.emote-more { font-size: 0.7rem; color: var(--muted-fg); font-weight: 600; margin-left: 2px; }
	.unattributed-emotes { margin-top: 0.5rem; font-size: 0.78rem; color: var(--muted-fg); }
	.unattributed-emotes .emote-strip { margin-left: 0.35rem; }
</style>
