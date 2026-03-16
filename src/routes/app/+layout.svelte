<script>
	import { browser } from '$app/environment';
	import { onMount, onDestroy, setContext } from 'svelte';
	import { page } from '$app/stores';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, onChildAdded, off, set, update, onDisconnect, query, limitToLast } from 'firebase/database';
	import { getConvId } from '$lib/convId.js';
	import { invalidateAll, afterNavigate } from '$app/navigation';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { data, children } = $props();

	// ── Nav items (Chat omitted — sidebar always shows channels/DMs) ──
	const navItems = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
		},
		{
			href: '/app/assignments',
			label: 'Roadmap',
			active: (p) => p.startsWith('/app/assignments'),
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`
		},
		{
			href: '/app/files',
			label: 'Files',
			active: (p) => p.startsWith('/app/files'),
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
		},
		{
			href: '/app/manage',
			label: 'Manage',
			active: (p) => p.startsWith('/app/manage'),
			instructorOnly: true,
			icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`
		}
	];

	// ── Sidebar state ──
	let sidebarOpen = $state(false);
	let sidebarCollapsed = $state(false);

	setContext('openSidebar', () => { sidebarOpen = !sidebarOpen; });
	// Expose rawPresence to child pages (e.g. manage) via a getter so the manage
	// tab uses the exact same signal as the sidebar — no separate Firebase subscription.
	setContext('rawPresence', { get value() { return rawPresence; } });
	setContext('refreshPresence', () => pollPresence());
	let showNewChannel = $state(false);
	let newChannelName = $state('');
	let creatingChannel = $state(false);
	let channelError = $state(null);

	// ── Unread / DMs ──
	// Seeded from server (Firebase Admin read) so unread indicators are correct immediately,
	// before any Firebase client subscription fires. Client subscriptions update these live.
	let lastRead = $state({ ...(data.initialLastRead ?? {}) });
	let unreadCounts = $state({ ...(data.initialUnreadCounts ?? {}) });
	// channelMeta seeded from channel.lastAt values returned by the server
	let channelMeta = $state(
		Object.fromEntries((data.channels ?? []).filter((ch) => ch.lastAt).map((ch) => [ch.id, { lastAt: ch.lastAt }]))
	);
	let dmList = $state([]);

	function isUnread(convId, lastAt) {
		return (lastAt ?? 0) > (lastRead[convId] ?? 0);
	}

	// ── App badge (iOS PWA / desktop PWA) ──
	const totalUnread = $derived.by(() => {
		let count = 0;
		for (const ch of (data.channels ?? [])) {
			const cnt = unreadCounts[ch.id];
			if (cnt !== undefined) count += cnt;
			else if (isUnread(ch.id, channelMeta[ch.id]?.lastAt)) count++;
		}
		for (const dm of dmList) {
			const cnt = unreadCounts[dm.convId];
			if (cnt !== undefined) count += cnt;
			else if (isUnread(dm.convId, dm.lastAt)) count++;
		}
		return count;
	});

	$effect(() => {
		if (!('setAppBadge' in navigator)) return;
		if (totalUnread > 0) {
			navigator.setAppBadge(totalUnread).catch(() => {});
		} else {
			navigator.clearAppBadge().catch(() => {});
		}
	});

	// ── Presence ──
	const PRESENCE_TTL = 5 * 60 * 1000;      // 5 min — how stale a lastSeen can be before considered offline
	const HEARTBEAT_INTERVAL = 2.5 * 60 * 1000; // 2.5 min — keeps lastSeen fresh within TTL with 2.5min margin
	const POLL_INTERVAL = 5 * 60 * 1000;     // 5 min — fallback only; allPresenceRef subscription handles real-time
	const PING_DEBOUNCE = 90 * 1000;         // navigation pings skipped if we pinged within this window
	let rawPresence = $state({});
	let presenceTick = $state(0);

	let onlineIds = $derived.by(() => {
		presenceTick;
		const cutoff = Date.now() - PRESENCE_TTL;
		return new Set(
			Object.entries(rawPresence)
				.filter(([, v]) => v.online && (v.lastSeen ?? 0) > cutoff)
				.map(([uid]) => uid)
		);
	});

	// ── Profile hover card ──
	let hoverUserId = $state(null);
	let hoverX = $state(0);
	let hoverY = $state(0);
	let hoverTimer;

	function showHover(e, userId) {
		clearTimeout(hoverTimer);
		const rect = e.currentTarget.getBoundingClientRect();
		hoverX = rect.right + 8;
		hoverY = Math.min(rect.top, window.innerHeight - 280);
		hoverUserId = userId;
	}
	function hideHover() {
		hoverTimer = setTimeout(() => { hoverUserId = null; }, 150);
	}

	// ── Toasts ──
	let toasts = $state([]);
	let toastId = 0;

	function addToast(convId, convPath, title, body) {
		const currentPath = $page.url.pathname;
		if (currentPath === convPath) return;
		const id = ++toastId;
		toasts = [...toasts, { id, convId, convPath, title, body }];
		if (soundEnabled) playSound();
		setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, 5000);
	}
	function dismissToast(id) { toasts = toasts.filter((t) => t.id !== id); }

	// ── PWA / sound ──
	let installPrompt = $state(null);
	let installed = $state(false);
	let dismissed = $state(false);
	let soundEnabled = $state(true);

	function playSound() {
		try {
			const ctx = new AudioContext();
			const frequencies = [880, 1100];
			let t = ctx.currentTime;
			for (const freq of frequencies) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = 'sine';
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0, t);
				gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
				gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
				osc.start(t);
				osc.stop(t + 0.35);
				t += 0.1;
			}
		} catch { /* AudioContext not available */ }
	}

	// ── Firebase refs ──
	let userChatsRef, lastReadRef, presenceRef, connectedRef, allPresenceRef;
	let channelMetaRef, unreadCountsRef;
	let pushBroadcast; // BroadcastChannel for push-notification relay from service worker
	let heartbeatTimer, tickTimer, presencePollTimer;
	const channelRefs = {}; // per-channel lastAt subscriptions

	async function pollPresence() {
		try {
			const res = await fetch('/api/presence');
			if (!res.ok) {
				console.error('[ec:presence] poll failed', res.status, res.statusText);
				return;
			}
			const apiData = await res.json();
			console.info('[ec:presence] poll returned', Object.keys(apiData).length, 'users:', Object.entries(apiData).map(([id, v]) => `${id.slice(0,8)} online=${v.online}`));
			const now = Date.now();
			// Merge API data into rawPresence. The API returns online/lastSeen/ua/screen
			// but NOT pwa/mobile/notif (those come from Firebase). Preserve existing
			// device metadata so the manage tab always has the full picture.
			const merged = { ...rawPresence };
			for (const [uid, v] of Object.entries(apiData)) {
				const existing = merged[uid] ?? {};
				// API returns a devices array (TTL-filtered server-side). Prefer it when
				// it has data; fall back to what Firebase already told us client-side.
				const devices = v.devices?.length ? v.devices : (existing.devices ?? []);
				merged[uid] = {
					...existing,
					online: v.online,
					// Refresh lastSeen to now for confirmed-online users so the 3-min
					// TTL check doesn't conflict with the API's 8-min activity window.
					lastSeen: v.online ? now : (v.lastSeen ?? existing.lastSeen ?? null),
					devices,
					...(v.ua != null ? { ua: v.ua } : {}),
					...(v.screen != null ? { screen: v.screen } : {})
				};
			}
			// Current user is always online while this code is running — never let the
			// API override that (API may lag behind Firebase or Turso window).
			if (data?.currentUser?.id) {
				merged[data.currentUser.id] = {
					...(merged[data.currentUser.id] ?? {}),
					online: true,
					lastSeen: Date.now()
				};
			}
			rawPresence = merged;
		} catch { /* ignore */ }
	}

	// Server-side presence ping — writes via Firebase Admin SDK, bypassing client auth.
	// Falls back to direct client Firebase write when presenceRef is available (belt-and-suspenders).
	let _pingDeviceId = null;
	let _pingSessionStart = null;
	let _lastPingedAt = 0;
	let presencePing = async (force = false) => {
		// Debounce: skip if we pinged recently (navigation fires this on every route change)
		const now = Date.now();
		if (!force && now - _lastPingedAt < PING_DEBOUNCE) return;
		_lastPingedAt = now;
		// Client-side Firebase write (fast, best-effort)
		if (presenceRef) {
			update(presenceRef, { online: true, lastSeen: Date.now() })
				.then(() => console.info('[ec:presence] client RTDB write ok'))
				.catch((e) => console.error('[ec:presence] client RTDB write FAILED:', e.code, e.message));
		}
		// Server-side write via Admin SDK (always succeeds regardless of client auth)
		if (_pingDeviceId) {
			const isPwa = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
			const isMob = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
			console.info('[ec:presence] pinging server-side', { deviceId: _pingDeviceId, pwa: isPwa, mobile: isMob });
			fetch('/api/presence/ping', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					deviceId: _pingDeviceId,
					ua: navigator.userAgent,
					pwa: isPwa,
					mobile: isMob,
					notif: typeof Notification !== 'undefined' && Notification.permission === 'granted',
					sessionStart: _pingSessionStart
				})
			})
				.then(async (r) => {
					if (r.ok) {
						const body = await r.json().catch(() => ({}));
						console.info('[ec:presence] server ping ok — RTDB written, lastSeen:', body.lastSeen);
					} else {
						const body = await r.text().catch(() => '');
						console.error('[ec:presence] server ping FAILED', r.status, body);
					}
				})
				.catch((e) => console.error('[ec:presence] server ping fetch error:', e.message));
		} else {
			console.warn('[ec:presence] presencePing called before deviceId was set — skipping server write');
		}
	};

	function startDm(user) {
		const convId = getConvId(data.currentUser.id, user.id);
		window.location.href = `/app/chat/dm/${convId}`;
	}

	async function createChannel() {
		const name = newChannelName.trim();
		if (!name) return;
		creatingChannel = true;
		channelError = null;
		try {
			const res = await fetch('/api/channels', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, class_id: data.classId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				channelError = err.message ?? 'Failed to create channel';
			} else {
				newChannelName = '';
				showNewChannel = false;
				await invalidateAll();
				const { id } = await res.json().catch(() => ({}));
				if (id) window.location.href = `/app/chat/channel/${id}`;
			}
		} catch { channelError = 'Something went wrong'; }
		creatingChannel = false;
	}

	function onChannelKeydown(e) {
		if (e.key === 'Enter') createChannel();
		if (e.key === 'Escape') { showNewChannel = false; newChannelName = ''; }
	}

	async function install() {
		if (!installPrompt) return;
		installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') installed = true;
		installPrompt = null;
	}

	afterNavigate(() => { presencePing(); });

	onMount(async () => {

		// BroadcastChannel: service worker relays push data here, but we no longer show
		// toasts from it — Firebase subscriptions (onChildAdded / userChats) handle
		// in-app toasts with better attribution while the app is open. The OS notification
		// covers the background case. Keeping the channel open just in case we need it
		// for future non-toast purposes (e.g. count sync when Firebase is briefly down).
		try {
			pushBroadcast = new BroadcastChannel('ec-push');
		} catch { /* BroadcastChannel not available */ }

		sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === '1';
		soundEnabled = localStorage.getItem('notif_sound') !== 'false';

		if (window.matchMedia('(display-mode: standalone)').matches) installed = true;
		window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
		window.addEventListener('appinstalled', () => { installed = true; installPrompt = null; });

		// Immediately mark the current user as online — we know they are since this
		// code is executing. Do this BEFORE the firebaseToken guard so it always runs.
		if (data?.currentUser?.id) {
			rawPresence = {
				...rawPresence,
				[data.currentUser.id]: {
					...(rawPresence[data.currentUser.id] ?? {}),
					online: true,
					lastSeen: Date.now()
				}
			};
		}

		// Stable device ID + session start — set before the Firebase guard so
		// server-side pings (via /api/presence/ping) work even if client auth fails.
		let deviceId = sessionStorage.getItem('ec_device_id');
		if (!deviceId) {
			deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
			sessionStorage.setItem('ec_device_id', deviceId);
		}
		_pingDeviceId = deviceId;
		_pingSessionStart = Date.now();
		console.info('[ec:presence] device ready — id:', deviceId, '| user:', data.currentUser?.id, '| firebaseToken:', !!data.firebaseToken);

		// Instant offline signal on clean tab/window close via sendBeacon.
		// onDisconnect() handles crashes/network drops; this makes clean closes immediate.
		const sendOfflineBeacon = () => {
			if (!_pingDeviceId) return;
			const blob = new Blob([JSON.stringify({ deviceId: _pingDeviceId })], { type: 'application/json' });
			navigator.sendBeacon('/api/presence/offline', blob);
		};
		window.addEventListener('pagehide', sendOfflineBeacon);

		// Immediately fire a server-side ping so the instructor (or any user) shows as
		// online right away — even before signInWithCustomToken completes.
		presencePing(true); // force=true: always ping on initial mount regardless of debounce

		if (!data?.firebaseToken || !data?.currentUser) return;

		// Retry Firebase auth so presence and subscriptions work on non-chat pages too.
		// Chat layout has its own retry, but presence is set up here for all routes.
		let fbAuthed = false;
		for (let i = 1; i <= 4; i++) {
			try {
				await signInWithCustomToken(auth, data.firebaseToken);
				fbAuthed = true;
				console.info('[ec:presence] Firebase client auth OK (attempt', i, ')');
				break;
			} catch (e) {
				console.warn(`[ec:presence] Firebase auth attempt ${i}/4 failed:`, e.code, e.message);
				if (i < 4) await new Promise((r) => setTimeout(r, 800 * i));
			}
		}
		if (!fbAuthed) {
			console.error('[ec:presence] Firebase client auth FAILED after 4 attempts — allPresenceRef subscription will not work; relying on 30s server poll only');
		}

		// Presence write — per-device so two simultaneous logins don't clobber each other
		presenceRef = ref(rtdb, `presence/${data.currentUser.id}/${deviceId}`);
		connectedRef = ref(rtdb, '.info/connected');
		const isPwa = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
		const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

		// Check notification permission + active push subscription
		let hasNotif = typeof Notification !== 'undefined' && Notification.permission === 'granted';
		if (hasNotif && 'serviceWorker' in navigator) {
			try {
				const reg = await navigator.serviceWorker.ready;
				const sub = await reg.pushManager.getSubscription();
				hasNotif = !!sub;
			} catch { hasNotif = false; }
		}

		// sessionStart captured once per browser session — used by archive cron to build Turso session ranges
		const sessionStart = _pingSessionStart;
		const presencePayload = () => ({
			name: data.currentUser.name,
			online: true,
			lastSeen: Date.now(),
			sessionStart,
			ua: navigator.userAgent,
			screen: `${screen.width}x${screen.height}`,
			pwa: isPwa,
			mobile: isMobile,
			notif: hasNotif
		});

		// Immediately mark ourselves online in rawPresence — don't wait for the Firebase
		// round-trip. We know with certainty the user is online since this code is running.
		rawPresence = {
			...rawPresence,
			[data.currentUser.id]: {
				online: true,
				lastSeen: Date.now(),
				ua: navigator.userAgent,
				pwa: isPwa,
				mobile: isMobile,
				notif: hasNotif,
				devices: [{ ua: navigator.userAgent, pwa: isPwa, mobile: isMobile, lastSeen: Date.now() }]
			}
		};

		// Write presence immediately after auth — don't wait for connectedRef.
		// connectedRef fires before signInWithCustomToken completes, so the write
		// inside the callback fails silently (no auth). By the time we get here,
		// auth has succeeded so this write lands right away.
		console.info('[ec:presence] writing initial presence to RTDB path:', `presence/${data.currentUser.id}/${deviceId}`);
		set(presenceRef, presencePayload())
			.then(() => console.info('[ec:presence] initial RTDB presence write ok'))
			.catch((e) => console.error('[ec:presence] initial RTDB presence write FAILED:', e.code, e.message));
		onValue(connectedRef, (snap) => {
			const connected = !!snap.val();
			console.info('[ec:presence] Firebase connection state:', connected ? 'CONNECTED' : 'DISCONNECTED');
			if (!connected) return;
			// Set up disconnect handler and re-write on reconnect
			onDisconnect(presenceRef).update({ online: false }); // lastSeen stays at last heartbeat
			set(presenceRef, presencePayload())
				.catch((e) => console.error('[ec:presence] reconnect RTDB write FAILED:', e.code, e.message));
		});
		heartbeatTimer = setInterval(() => {
			if (presenceRef) set(presenceRef, presencePayload());
			// Server-side ping as backup (belt-and-suspenders with client write above)
			presencePing(true); // force=true: heartbeat always writes, never skipped by debounce
			// Also refresh rawPresence directly so TTL never expires for the current user
			rawPresence = {
				...rawPresence,
				[data.currentUser.id]: {
					...(rawPresence[data.currentUser.id] ?? {}),
					online: true,
					lastSeen: Date.now()
				}
			};
		}, HEARTBEAT_INTERVAL);
		tickTimer = setInterval(() => { presenceTick++; }, 60_000); // 1 min tick — re-evaluates TTL in onlineIds

		// All presence — normalize both old (flat) and new (per-device) formats.
		// Store full device metadata so the manage tab can use this same signal.
		allPresenceRef = ref(rtdb, 'presence');
		console.info('[ec:presence] subscribing to allPresenceRef');
		onValue(allPresenceRef, (snap) => {
			if (!snap.exists()) { console.info('[ec:presence] allPresenceRef: empty snapshot'); return; }
			console.info('[ec:presence] allPresenceRef snapshot — uids:', Object.keys(snap.val()));
			const fb = snap.val();
			const normalized = {};
			const fbNow = Date.now();
			for (const [uid, v] of Object.entries(fb)) {
				if (!v || typeof v !== 'object') continue;
				// Per-device format: any child that is an object is a device node.
				// Mixed format (stale flat fields + live device objects) → treat as per-device
				// so orphaned flat `online: false` from old sessions never masks fresh data.
				const deviceObjects = Object.values(v).filter(d => d && typeof d === 'object');
				if (deviceObjects.length === 0) {
					// Pure flat single-device format
					const fresh = !!v.online && (v.lastSeen ?? 0) > fbNow - PRESENCE_TTL;
					normalized[uid] = {
						online: fresh, lastSeen: v.lastSeen ?? 0,
						ua: v.ua ?? null, pwa: v.pwa ?? null, mobile: v.mobile ?? null, notif: v.notif ?? null,
						devices: fresh ? [{ ua: v.ua ?? null, pwa: !!v.pwa, mobile: !!v.mobile, lastSeen: v.lastSeen ?? 0 }] : []
					};
				} else {
					// Per-device format (or mixed — only read the object children)
					let online = false, lastSeen = 0, ua = null, pwa = null, mobile = null, notif = null;
					const devices = [];
					for (const d of deviceObjects) {
						const fresh = d.online && (d.lastSeen ?? 0) > fbNow - PRESENCE_TTL;
						if (fresh) {
							online = true;
							devices.push({ ua: d.ua ?? null, pwa: !!d.pwa, mobile: !!d.mobile, lastSeen: d.lastSeen ?? 0 });
						}
						if ((d.lastSeen ?? 0) > lastSeen) {
							lastSeen = d.lastSeen;
							ua = d.ua ?? null;
							pwa = d.pwa ?? null;
							mobile = d.mobile ?? null;
						}
						if (d.notif != null) notif = d.notif;
					}
					normalized[uid] = { online, lastSeen, ua, pwa, mobile, notif, devices };
				}
			}
			// Never let Firebase override the current user as offline — they're online
			// since this code is running. Firebase may have a stale onDisconnect value.
			// Also correct device metadata to match the current session (not a stale mobile entry).
			if (data?.currentUser?.id) {
				const existing = normalized[data.currentUser.id] ?? rawPresence[data.currentUser.id] ?? {};
				const currentDevice = { ua: navigator.userAgent, pwa: isPwa, mobile: isMobile, lastSeen: Date.now() };
				// Replace or add this session's device in the devices array
				const otherDevices = (existing.devices ?? []).filter(
					(d) => d.ua !== navigator.userAgent
				);
				normalized[data.currentUser.id] = {
					...existing,
					online: true,
					lastSeen: Date.now(),
					ua: navigator.userAgent,
					pwa: isPwa,
					mobile: isMobile,
					devices: [currentDevice, ...otherDevices]
				};
			}
			rawPresence = { ...rawPresence, ...normalized };
		}, (err) => {
			// PERMISSION_DENIED — Firebase RTDB rules denied the read (client auth failed).
			// The 30s poll via /api/presence (Admin SDK) compensates — users will still appear
			// online, just with up to 30s latency instead of real-time.
			console.warn('[presence] allPresenceRef denied:', err.code, err.message);
		});

		await pollPresence();
		presencePollTimer = setInterval(pollPresence, POLL_INTERVAL); // 30s near-real-time; allPresenceRef handles instant updates

		// Timestamp when this session mounted — used to ignore pre-existing Firebase values
		// and only toast for messages that arrive after the user opened the app.
		const mountedAt = Date.now();

		// DMs — track lastAt per conversation so re-fires of the whole userChats snapshot
		// (which happens whenever ANY dm updates) don't double-count old unread messages.
		const knownDmLastAt = {};
		let firstUserChatsFire = true;
		userChatsRef = ref(rtdb, `userChats/${data.currentUser.id}`);
		onValue(userChatsRef, (snap) => {
			if (!snap.exists()) { dmList = []; firstUserChatsFire = false; return; }
			const entries = Object.entries(snap.val())
				.map(([convId, meta]) => ({ convId, ...meta }))
				.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
			for (const dm of entries) {
				const prevLastAt = knownDmLastAt[dm.convId] ?? mountedAt;
				// dm.otherUserName is only set by the API on the RECIPIENT's userChats entry,
				// so checking it prevents self-toasts when we send (sender entry has no otherUserName).
				// Only toast/increment when lastAt genuinely increased (avoids double-counting
				// on re-fires triggered by other DMs updating).
				if ((dm.lastAt ?? 0) > prevLastAt && dm.otherUserName) {
					const dmConvPath = `/app/chat/dm/${dm.convId}`;
					addToast(dm.convId, dmConvPath, dm.otherUserName, dm.lastMessage ?? '');
					// Skip increment when actively reading this DM.
					if (window.location.pathname !== dmConvPath) {
						unreadCounts = { ...unreadCounts, [dm.convId]: (unreadCounts[dm.convId] ?? 0) + 1 };
					}
				}
				// On the initial snapshot: if there's an unread DM but count is still 0 (race
				// window between SSR fetch and client mount), show at least 1 so the badge
				// appears instead of a plain dot.
				if (firstUserChatsFire && isUnread(dm.convId, dm.lastAt) && !(unreadCounts[dm.convId] > 0)) {
					unreadCounts = { ...unreadCounts, [dm.convId]: 1 };
				}
				knownDmLastAt[dm.convId] = dm.lastAt ?? 0;
			}
			firstUserChatsFire = false;
			dmList = entries;
		});

		// Last-read timestamps
		lastReadRef = ref(rtdb, `lastRead/${data.currentUser.id}`);
		onValue(lastReadRef, (snap) => { lastRead = snap.exists() ? snap.val() : {}; });

		// Channel new-message detection via onChildAdded on the messages path.
		// Firebase rules always allow channels/${id}/messages (it's the main chat path),
		// whereas channels/${id}/lastAt may be blocked if rules only cover the messages subtree.
		// limitToLast(1) keeps the initial download minimal — we only need the latest key
		// to establish a baseline, and onChildAdded fires for every subsequent new message.
		//
		// Push key decoding: Firebase push IDs embed the creation timestamp in their first
		// 8 characters (base-64 encoded ms). We use this to filter out pre-existing messages.
		const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
		function pushKeyTime(key) {
			let t = 0;
			for (let i = 0; i < 8; i++) t = t * 64 + PUSH_CHARS.indexOf(key[i]);
			return t;
		}
		for (const ch of (data.channels ?? [])) {
			const r = query(ref(rtdb, `channels/${ch.id}/messages`), limitToLast(1));
			channelRefs[ch.id] = r;
			onChildAdded(r, (snap) => {
				// Ignore the initial "existing message" fire — only act on new arrivals.
				if (pushKeyTime(snap.key) <= mountedAt) return;
				const msg = snap.val();
				// Ignore messages sent by the current user (no self-notification).
				if (msg?.u === data.currentUser.id) return;
				const convPath = `/app/chat/channel/${ch.id}`;
				const senderName = data.users.find((u) => u.id === msg?.u)?.name ?? '';
				const msgText = msg?.c ? String(msg.c).slice(0, 80) : (msg?.att ? '📎 attachment' : '');
				const body = senderName ? `${senderName}: ${msgText}` : msgText;
				addToast(ch.id, convPath, `#${ch.name}`, body);
				if (window.location.pathname !== convPath) {
					unreadCounts = { ...unreadCounts, [ch.id]: (unreadCounts[ch.id] ?? 0) + 1 };
				}
			});
		}

		// channelMeta for toast body content — best-effort; may fail if RTDB rules don't
		// cover this path yet, which is fine since we fall back to empty body above.
		channelMetaRef = ref(rtdb, 'channelMeta');
		onValue(channelMetaRef, (snap) => {
			if (!snap.exists()) return;
			const merged = { ...channelMeta };
			for (const [chId, raw] of Object.entries(snap.val())) {
				if (raw && typeof raw === 'object') {
					merged[chId] = { ...(channelMeta[chId] ?? {}), lastMessage: raw.lastMessage ?? '', lastUser: raw.lastUser ?? '' };
				}
			}
			channelMeta = merged;
		}, () => { /* permission denied — channelMeta not in rules yet, ignore */ });

		// Per-user unread counts — max-merge with local state so live increments
		// are never overwritten by a stale Firebase snapshot. The $effect on pathname
		// handles explicit clearing when the user navigates into a conversation.
		unreadCountsRef = ref(rtdb, `unreadCounts/${data.currentUser.id}`);
		onValue(unreadCountsRef, (snap) => {
			if (!snap.exists()) return;
			const remote = snap.val();
			const merged = { ...unreadCounts };
			for (const [k, v] of Object.entries(remote)) {
				merged[k] = Math.max(merged[k] ?? 0, v ?? 0);
			}
			unreadCounts = merged;
		});
	});

	onDestroy(() => {
		pushBroadcast?.close();
		clearInterval(heartbeatTimer);
		clearInterval(tickTimer);
		clearInterval(presencePollTimer);
		if (userChatsRef) off(userChatsRef);
		if (lastReadRef) off(lastReadRef);
		if (allPresenceRef) off(allPresenceRef);
		if (connectedRef) off(connectedRef);
		if (channelMetaRef) off(channelMetaRef);
		if (unreadCountsRef) off(unreadCountsRef);
		for (const r of Object.values(channelRefs)) off(r);
	});

	function toggleCollapse() {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem('sidebar_collapsed', sidebarCollapsed ? '1' : '0');
	}

	$effect(() => {
		$page.url.pathname;
		sidebarOpen = false;
	});

	// Clear unread state locally the moment the user navigates to a conversation —
	// don't wait for Firebase subscription round-trips to clear the badge/dot.
	$effect(() => {
		const path = $page.url.pathname;
		const channelMatch = path.match(/\/app\/chat\/channel\/([^/]+)/);
		if (channelMatch) {
			const chId = channelMatch[1];
			if ((unreadCounts[chId] ?? 0) !== 0 || isUnread(chId, channelMeta[chId]?.lastAt)) {
				unreadCounts = { ...unreadCounts, [chId]: 0 };
				lastRead = { ...lastRead, [chId]: Date.now() };
			}
		}
		const dmMatch = path.match(/\/app\/chat\/dm\/([^/]+)/);
		if (dmMatch) {
			const cId = dmMatch[1];
			if ((unreadCounts[cId] ?? 0) !== 0 || isUnread(cId, dmList.find((d) => d.convId === cId)?.lastAt)) {
				unreadCounts = { ...unreadCounts, [cId]: 0 };
				lastRead = { ...lastRead, [cId]: Date.now() };
			}
		}
	});
</script>

<!-- Profile hover card (desktop) -->
<ProfileHover userId={hoverUserId} x={hoverX} y={hoverY} {onlineIds} />

{#if sidebarOpen}
	<div class="sidebar-backdrop" onclick={() => sidebarOpen = false}></div>
{/if}

<!-- Global sidebar -->
<nav class="global-sidebar" class:open={sidebarOpen} class:collapsed={sidebarCollapsed}>
	<!-- Header: logo + collapse toggle in one row -->
	<div class="sidebar-header">
		<a class="sidebar-logo" href="/app" title="eating.computer">eating.computer</a>
		<span class="sidebar-class-name">{data.currentClass?.name ?? 'Class'}</span>
		<button class="collapse-btn" onclick={toggleCollapse} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
			{#if sidebarCollapsed}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
			{:else}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
			{/if}
		</button>
		<button class="collapse-btn mobile-close-btn" onclick={() => sidebarOpen = false} title="Close">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</button>
	</div>

	<!-- Main nav -->
	<div class="sidebar-nav">
		{#each navItems as item}
			{#if !item.instructorOnly || data.currentUser?.role === 'instructor'}
				{@const isActive = item.active($page.url.pathname)}
				<a href={item.href} class="nav-item" class:active={isActive} title={item.label}>
					{@html item.icon}
					<span class="nav-label">{item.label}</span>
				</a>
			{/if}
		{/each}
	</div>

	<div class="sidebar-divider"></div>

	{#if data.channels?.length}
		<!-- Channels -->
		<div class="sidebar-section">
			<div class="section-header">
				<span>Channels</span>
				{#if data.currentUser?.role === 'instructor'}
					<button class="btn-icon" onclick={() => { showNewChannel = !showNewChannel; channelError = null; }} title="New channel">+</button>
				{/if}
			</div>

			{#if showNewChannel}
				<div class="inline-input">
					<span class="hash">#</span>
					<input type="text" bind:value={newChannelName} onkeydown={onChannelKeydown} placeholder="channel-name" autofocus disabled={creatingChannel} />
					{#if channelError}<span class="inline-error">{channelError}</span>{/if}
				</div>
			{/if}

			{#each data.channels as ch}
				{@const path = `/app/chat/channel/${ch.id}`}
				{@const unreadCount = unreadCounts[ch.id] ?? 0}
				{@const hasDot = unreadCount === 0 && isUnread(ch.id, channelMeta[ch.id]?.lastAt)}
				<a href={path} class="sidebar-item" class:active={$page.url.pathname === path}>
					<span class="hash">#</span>
					<span class="item-name" class:bold={unreadCount > 0 || hasDot}>{ch.name}</span>
					{#if unreadCount > 0}
						<span class="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
					{:else if hasDot}
						<span class="unread-dot"></span>
					{/if}
				</a>
			{/each}
		</div>
	{/if}

	{#if data.users?.length}
		<!-- Members (DMs) -->
		<div class="sidebar-section">
			<div class="section-header">
				<span>Members</span>
				{#if onlineIds.size > 0}<span class="online-count">{onlineIds.size} online</span>{/if}
			</div>

			{#if data.currentUser}
				<div class="member-row self" onmouseenter={(e) => showHover(e, data.currentUser.id)} onmouseleave={hideHover}>
					<a class="member-inner" href="/app/profile/{data.currentUser.id}">
						<span class="avatar-wrap">
							<span class="avatar">{data.currentUser.name[0].toUpperCase()}</span>
							<span class="presence-dot"></span>
						</span>
						<div class="member-text">
							<span class="member-name">{data.currentUser.name} <span class="you-tag">you</span></span>
						</div>
						{#if data.currentUser.role === 'instructor'}<span class="role-badge">instr.</span>{/if}
					</a>
				</div>
			{/if}

			{#each data.users as u}
				{@const isOnline = onlineIds.has(u.id)}
				{@const convId = getConvId(data.currentUser.id, u.id)}
				{@const dmPath = `/app/chat/dm/${convId}`}
				{@const dmUnreadCount = unreadCounts[convId] ?? 0}
				{@const dmUnreadDot = dmUnreadCount === 0 && isUnread(convId, dmList.find((d) => d.convId === convId)?.lastAt)}
				{@const lastMsg = dmList.find((d) => d.convId === convId)?.lastMessage ?? null}
				<div class="member-row" onmouseenter={(e) => showHover(e, u.id)} onmouseleave={hideHover}>
					<a class="member-inner" href={dmPath} class:active={$page.url.pathname === dmPath}>
						<span class="avatar-wrap">
							<span class="avatar">{u.name[0].toUpperCase()}</span>
							{#if isOnline}<span class="presence-dot"></span>{/if}
						</span>
						<div class="member-text">
							<span class="member-name" class:bold={dmUnreadCount > 0 || dmUnreadDot}>{u.name}</span>
							{#if lastMsg}<span class="dm-last">{lastMsg}</span>{/if}
						</div>
						{#if u.role === 'instructor'}<span class="role-badge">instr.</span>{/if}
						{#if dmUnreadCount > 0}
							<span class="unread-badge">{dmUnreadCount > 99 ? '99+' : dmUnreadCount}</span>
						{:else if dmUnreadDot}
							<span class="unread-dot"></span>
						{/if}
					</a>
				</div>
			{/each}
		</div>
	{/if}
</nav>

<!-- Mobile hamburger -->
<button class="mobile-menu-btn" onclick={() => sidebarOpen = true} aria-label="Menu">
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>

<BottomNav isInstructor={data.currentUser?.role === 'instructor'} {totalUnread} />

<div class="app-shell" style:margin-left={sidebarCollapsed ? '52px' : null}>
	{@render children()}
</div>

<!-- Toasts -->
{#if toasts.length}
	<div class="toast-stack">
		{#each toasts as t (t.id)}
			<a href={t.convPath || '#'} class="toast" onclick={() => dismissToast(t.id)}>
				<div class="toast-header">
					<span class="toast-title">{t.title}</span>
					<button class="toast-close" onclick={(e) => { e.preventDefault(); e.stopPropagation(); dismissToast(t.id); }}>×</button>
				</div>
				<p class="toast-body">{t.body}</p>
			</a>
		{/each}
	</div>
{/if}

<!-- Install banner -->
{#if browser && installPrompt && !installed && !dismissed}
	<div class="install-banner">
		<div class="install-text">
			<strong>Install eating.computer</strong>
			<span>Get the full app experience with notifications</span>
		</div>
		<div class="install-actions">
			<button class="btn-install" onclick={install}>Install</button>
			<button class="btn-dismiss" onclick={() => (dismissed = true)} aria-label="Dismiss">×</button>
		</div>
	</div>
{/if}

<style>
	/* ── Global sidebar ── */
	.global-sidebar {
		display: none;
	}

	@media (min-width: 641px) {
		.global-sidebar {
			display: flex;
			flex-direction: column;
			position: fixed;
			top: 0; left: 0; bottom: 0;
			width: var(--sidebar-width);
			background: #1a1a1a;
			color: #c8c1b4;
			overflow-y: auto;
			overflow-x: hidden;
			z-index: 200;
			scrollbar-width: none;
			transition: width 0.2s ease;
		}
		.global-sidebar::-webkit-scrollbar { display: none; }
		.global-sidebar.collapsed { width: 52px; }
		.global-sidebar.collapsed .sidebar-logo,
		.global-sidebar.collapsed .nav-label,
		.global-sidebar.collapsed .sidebar-section,
		.global-sidebar.collapsed .sidebar-divider { display: none; }
		.global-sidebar.collapsed .sidebar-header { justify-content: center; padding: 0.5rem 0; }
		.global-sidebar.collapsed .sidebar-nav { flex-direction: column; padding: 0.25rem 0.3rem; }
		.global-sidebar.collapsed .nav-item { flex: none; width: 100%; }
	}

	/* ── Sidebar header ── */
	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 0.6rem 0.25rem 1rem;
		flex-shrink: 0;
		gap: 0.5rem;
	}

	/* ── Logo ── */
	.sidebar-logo {
		font-family: 'Cambridge', serif;
		font-size: 0.9rem;
		color: #f7f2ea;
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		flex: 1;
		min-width: 0;
	}
	.sidebar-logo:hover { opacity: 0.75; }

	/* ── Class name (mobile sidebar header only) ── */
	.sidebar-class-name {
		display: none;
		font-family: 'Cambridge', serif;
		font-size: 0.9rem;
		color: #f7f2ea;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	/* ── Mobile close button (hidden on desktop) ── */
	.mobile-close-btn { display: none; }

	/* ── Collapse button ── */
	.collapse-btn {
		display: none;
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 5px;
		transition: color 0.1s, background 0.1s;
		flex-shrink: 0;
	}
	.collapse-btn:hover { color: #f7f2ea; background: #2a2a2a; }
	@media (min-width: 641px) {
		.collapse-btn { display: flex; align-items: center; justify-content: center; }
		.mobile-close-btn { display: none !important; }
	}

	/* ── Nav items ── */
	.sidebar-nav {
		display: flex;
		flex-direction: row;
		padding: 0.25rem 0.5rem 0.5rem;
		gap: 0.15rem;
		flex-shrink: 0;
	}

	.nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		flex: 1;
		padding: 0.45rem 0.2rem;
		border-radius: 7px;
		color: #666;
		text-decoration: none;
		font-size: 0.55rem;
		font-weight: 500;
		transition: background 0.12s, color 0.12s;
		text-align: center;
	}
	.nav-item:hover { background: #2a2a2a; color: #f7f2ea; }
	.nav-item.active { background: #2a2a2a; color: #f7f2ea; font-weight: 600; }

	.nav-label { text-transform: uppercase; letter-spacing: 0.04em; }

	/* ── Divider ── */
	.sidebar-divider {
		height: 1px;
		background: #2a2a2a;
		margin: 0.25rem 0.75rem;
		flex-shrink: 0;
	}

	/* ── Sections ── */
	.sidebar-section { padding: 0.5rem 0.5rem 0; flex-shrink: 0; }

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.6rem;
		margin-bottom: 0.25rem;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #555;
	}

	.btn-icon {
		background: none; border: none; color: #666;
		font-size: 1rem; cursor: pointer; line-height: 1; padding: 0;
		transition: color 0.1s;
	}
	.btn-icon:hover { color: #f7f2ea; }

	.inline-input {
		display: flex; align-items: center; gap: 0.25rem;
		padding: 0.25rem 0.5rem; margin-bottom: 0.25rem;
	}
	.inline-input input {
		flex: 1; background: #2a2a2a; border: 1px solid #444; border-radius: 5px;
		color: #f7f2ea; font-family: inherit; font-size: 0.82rem;
		padding: 0.3rem 0.4rem; outline: none;
	}
	.inline-input input:focus { border-color: #888; }
	.inline-error { font-size: 0.7rem; color: #e57373; }

	.hash { opacity: 0.5; font-size: 0.95rem; flex-shrink: 0; }

	.sidebar-item {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.28rem 0.6rem; border-radius: 5px;
		font-size: 0.875rem; color: #a09688; text-decoration: none;
		transition: all 0.1s;
	}
	.sidebar-item:hover, .sidebar-item.active { background: #2a2a2a; color: #f7f2ea; }

	.item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-name.bold { color: #f7f2ea; font-weight: 600; }

	.unread-badge {
		font-size: 0.6rem;
		font-weight: 700;
		background: #e53935;
		color: #fff;
		border-radius: 99px;
		padding: 0.1rem 0.35rem;
		min-width: 16px;
		text-align: center;
		flex-shrink: 0;
		margin-left: auto;
		line-height: 1.4;
	}
	.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: #e53935; flex-shrink: 0; margin-left: auto; }
	.online-count { font-size: 0.65rem; color: #4caf50; font-weight: 600; margin-right: auto; margin-left: 0.3rem; }

	/* ── Members ── */
	.member-row { /* wrapper */ }
	.member-row.self { opacity: 0.75; }
	.member-row.self:hover { opacity: 1; }

	.member-inner {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.22rem 0.6rem; border-radius: 5px; width: 100%;
		font-size: 0.82rem; color: #a09688; text-decoration: none;
		transition: background 0.1s; box-sizing: border-box;
	}
	.member-inner:hover, .member-inner.active { background: #2a2a2a; color: #f7f2ea; }

	.avatar-wrap { position: relative; flex-shrink: 0; }
	.avatar {
		width: 20px; height: 20px; border-radius: 4px; background: #444; color: #f7f2ea;
		font-size: 0.68rem; font-weight: 700; display: flex; align-items: center; justify-content: center;
	}
	.presence-dot {
		position: absolute; bottom: -1px; right: -1px;
		width: 7px; height: 7px; border-radius: 50%;
		background: #4caf50; border: 1.5px solid #1a1a1a;
	}

	.member-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.05rem; }
	.member-name { font-size: 0.82rem; color: #a09688; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.member-name.bold { font-weight: 600; color: #f7f2ea; }
	.you-tag { font-size: 0.65rem; color: #555; font-weight: 400; margin-left: 0.2rem; }
	.dm-last { font-size: 0.68rem; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.role-badge {
		font-size: 0.6rem; font-weight: 600; background: #333; color: #888;
		padding: 0.08rem 0.3rem; border-radius: 99px; text-transform: uppercase; margin-left: auto; flex-shrink: 0;
	}

	/* Mobile hamburger — hidden by default (chat layout shows its own) */
	.mobile-menu-btn { display: none; }

	/* Mobile sidebar — full-screen overlay */
	@media (max-width: 640px) {
		.global-sidebar {
			display: flex;
			flex-direction: column;
			position: fixed;
			top: 0; left: 0; bottom: 0;
			width: 100%;
			background: #1a1a1a;
			color: #c8c1b4;
			overflow-y: auto;
			overflow-x: hidden;
			z-index: 500;
			scrollbar-width: none;
			transform: translateX(-100%);
			transition: transform 0.22s ease;
		}
		.global-sidebar.open { transform: translateX(0); }
		/* Hide nav items on mobile — bottom bar handles navigation */
		.global-sidebar .sidebar-nav,
		.global-sidebar .sidebar-divider { display: none; }
		/* Show header on mobile but swap logo → class name, and collapse btn → close btn */
		.global-sidebar .sidebar-logo { display: none; }
		.global-sidebar .collapse-btn { display: none; }
		.global-sidebar .mobile-close-btn { display: flex; }
		.global-sidebar .sidebar-class-name { display: block; }
		/* No backdrop needed — sidebar is full-screen */
		.sidebar-backdrop { display: none; }
	}

	/* ── App shell ── */
	.app-shell { min-height: 100vh; }

	@media (min-width: 641px) {
		/* Default margin matches sidebar width; overridden by inline style when collapsed */
		.app-shell { margin-left: var(--sidebar-width); transition: margin-left 0.2s ease; }
	}

	/* ── Toasts ── */
	.toast-stack {
		position: fixed; top: 1.5rem; right: 1.5rem;
		display: flex; flex-direction: column; gap: 0.5rem;
		z-index: 300; pointer-events: none;
	}
	.toast {
		background: #1a1a1a; color: #f7f2ea;
		border: 1px solid #333; border-radius: 10px;
		padding: 0.75rem 1rem; width: 260px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.35);
		pointer-events: all; cursor: pointer; text-decoration: none;
		display: block; animation: slide-in 0.2s ease;
	}
	.toast:hover { border-color: #555; }
	.toast-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem; }
	.toast-title { font-size: 0.82rem; font-weight: 700; color: #f7f2ea; }
	.toast-close {
		background: none; border: none; color: #666; font-size: 1rem;
		cursor: pointer; line-height: 1; padding: 0; margin-left: 0.5rem;
	}
	.toast-close:hover { color: #f7f2ea; }
	.toast-body { margin: 0; font-size: 0.78rem; color: #a09688; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	@keyframes slide-in {
		from { opacity: 0; transform: translateY(8px); }
		to   { opacity: 1; transform: translateY(0); }
	}

	/* ── Install banner ── */
	.install-banner {
		position: fixed; bottom: 1.25rem; left: 50%;
		transform: translateX(-50%);
		width: calc(100% - 2.5rem); max-width: 480px;
		background: var(--ink); color: var(--paper);
		border-radius: 12px; padding: 0.85rem 1rem;
		display: flex; align-items: center; justify-content: space-between; gap: 1rem;
		box-shadow: 0 4px 24px rgba(0,0,0,0.18); z-index: 100;
	}
	.install-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.install-text strong { font-size: 0.9rem; }
	.install-text span { font-size: 0.78rem; opacity: 0.7; }
	.install-actions { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
	.btn-install {
		padding: 0.4rem 0.9rem; background: var(--paper); color: var(--ink);
		border: none; border-radius: 8px; font-family: inherit;
		font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
	}
	.btn-install:hover { opacity: 0.85; }
	.btn-dismiss {
		background: none; border: none; color: var(--paper);
		opacity: 0.6; font-size: 1.2rem; cursor: pointer; padding: 0 0.2rem; line-height: 1;
	}
	.btn-dismiss:hover { opacity: 1; }

	@media (max-width: 640px) {
		.install-banner { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 0.75rem); }
	}
</style>
