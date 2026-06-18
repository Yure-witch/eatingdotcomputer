<script>
	import '$lib/text-effects.css';
	import { browser } from '$app/environment';
	import { onMount, onDestroy, setContext, untrack } from 'svelte';
	import { page, navigating } from '$app/stores';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, onChildAdded, off, set, update, onDisconnect, query, limitToLast } from 'firebase/database';
	import { getConvId } from '$lib/convId.js';
	import { pageTitle, pageTitleHref } from '$lib/page-title-store.js';
	import { invalidateAll, afterNavigate, goto, preloadData } from '$app/navigation';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import ConvSkeleton from '$lib/components/ConvSkeleton.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	// Tab sections mounted as live panels in the mobile scroll-snap pager.
	import HomePanel from './+page.svelte';
	import OrbitPanel from './orbit/+page.svelte';
	import LabPanel from './playground/+page.svelte';
	import ManagePanel from './manage/+page.svelte';

	let { data, children } = $props();

	// ── Nav items (Chat omitted — sidebar always shows channels/DMs) ──
	// Icons are Material Symbols ligature names; the template renders
	// them via <span class="msi"> + adds `msi-fill` when the row is
	// active, so the icon switches from outlined to filled on select
	// (M3 nav-bar pattern).
	const navItems = [
		{
			href: '/app',
			label: 'Home',
			active: (p) => p === '/app',
			iconName: 'home'
		},
		{
			href: '/app/orbit',
			label: 'Orbit',
			// Old aliases (/app/atlas, /app/assignments, /app/files,
			// /app/collection) still mark the row active so anyone
			// hitting a bookmark or deep-link to those keeps seeing
			// the right nav highlight while the redirect lands them
			// on /app/orbit.
			active: (p) => p.startsWith('/app/orbit') || p.startsWith('/app/atlas') || p.startsWith('/app/collection') || p.startsWith('/app/assignments') || p.startsWith('/app/files'),
			iconName: 'planet'
		},
		{
			href: '/app/playground',
			label: 'Lab',
			active: (p) => p.startsWith('/app/playground'),
			iconName: 'experiment'
		},
		{
			href: '/app/manage',
			label: 'Manage',
			active: (p) => p.startsWith('/app/manage'),
			instructorOnly: true,
			iconName: 'tune'
		}
	];

	// ── Sidebar state ──
	let sidebarOpen = $state(false);

	// ── Section pager (mobile): the tab sections live in ONE native scroll-snap
	// track, so swiping between them is compositor-smooth and the REAL pages are
	// under your finger. Panels lazy-mount (current ± 1) and stay alive once
	// seen (cached); far panels show a skeleton until reached. Desktop and
	// non-pager routes (e.g. chat) render normally via {@render children()}.
	let _isMobile = $state(false);
	const _isConvRoute = (p) => /^\/app\/chat\/(channel|dm)\//.test(p);

	// On mobile, the CURRENT conversation joins the pager as a full-screen panel
	// at index 0 (left of the chat menu), so conversation → menu → home → orbit
	// is ONE native scroll-snap pipeline — same compositor-driven smoothness as
	// the section swipes. The conv panel is dynamic: present only while the route
	// is a conversation (it renders the live page via {@render children()}; we
	// don't preload conversations as section Comps).
	const _onConvMobile = $derived(_isMobile && _isConvRoute($page.url.pathname));
	// The conversation is ALWAYS panel 0 (just inactive/empty when you're not in a
	// chat). Keeping the slot permanent means leaving a chat never removes a panel
	// or shifts every other panel's index — which is what forced the late "settle"
	// hard-snap that fought your swipe (snap-back to Orbit, lagging nav highlight,
	// nav bar re-staggering). Now conv → menu → home → orbit is one fixed index set.
	const PANELS = $derived([
		{ conv: true },
		{ route: '/app/chat', chatMenu: true },
		{ route: '/app', Comp: HomePanel },
		{ route: '/app/orbit', Comp: OrbitPanel },
		{ route: '/app/playground', Comp: LabPanel },
		...(data.currentUser?.role === 'instructor' ? [{ route: '/app/manage', Comp: ManagePanel }] : [])
	]);
	// The conv panel is only reachable/active while you're in a conversation OR
	// navigating into one (so the entry slide to panel 0 isn't clamped back).
	const _convActiveOrEntering = $derived(
		_onConvMobile || (_isMobile && !!$navigating && _isConvRoute($navigating.to?.url?.pathname ?? ''))
	);
	function _panelIndexFor(path) {
		if (_isConvRoute(path)) return 0; // conversation is always panel 0
		for (let i = 1; i < PANELS.length; i++) {
			const r = PANELS[i].route;
			if (!r) continue;
			// '/app' and the chat MENU are EXACT matches — so Home doesn't catch
			// every /app/* route. Section routes match themselves + sub-routes.
			if (r === '/app' || r === '/app/chat') { if (path === r) return i; }
			else if (path === r || path.startsWith(r + '/')) return i;
		}
		return -1;
	}
	const pagerIndex = $derived(_panelIndexFor($page.url.pathname));
	const isPagerActive = $derived(_isMobile && pagerIndex >= 0);

	// Instant feedback: the moment a tap navigates to a conversation, paint a
	// skeleton message window (so it appears immediately). It stays up until the
	// nav lands AND the slide/snap onto the conv panel + header reflow have settled
	// (_convEntering, cleared in onPagerScrollEnd) — so the chat is never revealed
	// mid-reflow / mid-snap. Mobile only.
	let _convEntering = $state(false);
	let _convEnterT;
	const _showConvSkeleton = $derived(
		_isMobile && (
			_convEntering ||
			(!!$navigating && _isConvRoute($navigating.to?.url?.pathname ?? ''))
		)
	);
	// Arm the overlay whenever a navigation INTO a conversation begins, with a
	// safety timeout so it can never get stuck up.
	$effect(() => {
		const enteringNav = _isMobile && !!$navigating && _isConvRoute($navigating.to?.url?.pathname ?? '');
		if (!enteringNav) return;
		untrack(() => {
			_convEntering = true;
			clearTimeout(_convEnterT);
			_convEnterT = setTimeout(() => { _convEntering = false; }, 900);
		});
	});

	// Keep the swipe-in menu MOUNTED (off-screen) the whole time you're in a
	// conversation, so the right→left swipe just animates an already-rendered
	// list (avatars/presence/previews) instead of building it on-demand mid-drag.
	// The conversation → menu swipe is now a native pager transition (the conv is
	// a real panel), so the finger-tracked slide-in overlay only ever mounts if a
	// legacy drag is genuinely in flight — which it no longer is. Kept gated on
	// _menuSliding alone so the markup/CSS can stay until fully removed.
	const _menuOverlayMounted = $derived(_isMobile && _menuSliding);

	// Bottom-nav visibility now follows the LIVE pager position, not just the
	// route. The conversation is a pager panel, so while it covers most of the
	// screen the nav is hidden; the instant you swipe past halfway toward the menu
	// it reveals and rises up — riding WITH the gesture instead of popping in
	// ~80ms after the route commits (which felt glitchy). The `conv-covering`
	// class (consumed by BottomNav) replaces the old route-based `in-conversation`
	// hide for nav purposes.
	let _navHidden = false;
	let _navRiseT;
	$effect(() => {
		if (typeof document === 'undefined') return;
		const covering = _onConvMobile && _pagerFraction < 0.5;
		const root = document.documentElement;
		untrack(() => {
			if (covering === _navHidden) return;
			// Hidden → shown: animate up from the bottom.
			if (!covering && _navHidden && _isMobile) {
				root.classList.add('nav-rising');
				clearTimeout(_navRiseT);
				_navRiseT = setTimeout(() => root.classList.remove('nav-rising'), 340);
			}
			_navHidden = covering;
			root.classList.toggle('conv-covering', covering);
		});
	});

	let panelData = $state({});        // route -> data
	let panelSeen = $state(new Set()); // routes ever mounted (keep-alive cache)
	let pagerEl = $state(null);
	let _pagerProg = false;            // suppress the scroll handler during a programmatic scroll
	let _pagerSnapT;
	let _lastScrollAt = 0;             // timestamp of the last user scroll (plain let: not reactive)
	let _mqHandler;                    // matchMedia listener for the mobile breakpoint
	let _pagerVisibleRoute = $state(null); // route of the panel currently in view (live, for nav highlight)
	let _pagerFraction = $state(0);        // live fractional scroll position (for the sliding highlight)
	let _gestureStartIdx = 0;          // panel index when the current touch gesture began (one-swipe-per-panel clamp)
	let _suppressCommitUntil = 0;      // performance.now() until which scroll-settle nav-commits are ignored
	let _goSecGen = 0;                 // generation token for nav-icon jumps (latest tap wins)
	// Extend (never shorten) the window during which a stray momentum/anchoring
	// scroll event must NOT trigger a navigation — set by taps and programmatic
	// snaps that are already driving their own navigation.
	function _suppressCommits(ms) { _suppressCommitUntil = Math.max(_suppressCommitUntil, performance.now() + ms); }
	// Abort any in-flight programmatic scroll (the eased _fastScrollTo or the
	// hard-snap correction). Both run a rAF loop that keeps writing scrollLeft; if
	// the user starts swiping while one is running it FIGHTS their finger — yanking
	// the track back to the chat/home it was heading to and holding it there until
	// the animation ends. Cancelling on finger-down hands control straight back.
	function _cancelProgrammaticScroll() {
		if (!_pagerProg) return;
		cancelAnimationFrame(_fastScrollRAF);
		cancelAnimationFrame(_hardSnapRAF);
		if (pagerEl) pagerEl.style.scrollSnapType = '';
		_pagerProg = false;
	}
	let _pagerTouching = false;        // a finger is currently down on the pager
	let _pgVelX = 0, _pgPrevX = 0, _pgPrevT = 0, _pgStX = 0, _pgStY = 0, _pgHoriz = false;
	// Anchor each swipe so a fast flick can't skip past the adjacent panel, and
	// abort any in-flight programmatic scroll / pending commit so the new gesture
	// starts from a clean, consistent state. Also begin tracking finger velocity
	// for flick detection.
	function onPagerTouchStart(e) {
		if (!pagerEl) return;
		_pagerTouching = true;
		_repinGen++;               // cancel any lingering re-pin so it can't fight this gesture/tap
		_goSecGen++;               // a swipe supersedes a nav-icon jump's re-assert (so tap-then-swipe doesn't snap back to the tapped tab)
		_cancelProgrammaticScroll();
		clearTimeout(_pagerSnapT); // don't let a previous gesture's commit fire mid-swipe
		_gestureStartIdx = Math.round(pagerEl.scrollLeft / (pagerEl.clientWidth || 1));
		const t = e.touches?.[0];
		if (t) { _pgStX = _pgPrevX = t.clientX; _pgStY = t.clientY; _pgPrevT = e.timeStamp; _pgVelX = 0; _pgHoriz = false; }
	}
	function onPagerTouchMove(e) {
		const t = e.touches?.[0]; if (!t) return;
		const dt = e.timeStamp - _pgPrevT;
		if (dt > 0) _pgVelX = (t.clientX - _pgPrevX) / dt; // px/ms (last segment)
		_pgPrevX = t.clientX; _pgPrevT = e.timeStamp;
		if (!_pgHoriz) {
			const adx = Math.abs(t.clientX - _pgStX), ady = Math.abs(t.clientY - _pgStY);
			if (adx > 8 && adx > ady) _pgHoriz = true;
		}
	}
	function onPagerTouchEnd() {
		_pagerTouching = false;
		// Pure native momentum — no programmatic scroll. iOS's own scroll-snap
		// physics carry the slide (the smooth feel the conv↔menu flow already had),
		// and the route commits on `scrollend` once the snap actually settles (see
		// onPagerScrollEnd). No JS animation to go framy, no custom easing to feel
		// off. (`_pgVelX`/`_pgHoriz` are still tracked above for future use.)
	}
	// Fires when ALL scrolling (drag + momentum + snap) has fully settled — the
	// precise moment to commit the route. Committing earlier (the 80ms debounce)
	// could fire mid-snap and, with the heavy conversation tearing down, freeze the
	// track in a half-snapped "in-between" position. scrollend guarantees we're
	// parked on a real panel first.
	function onPagerScrollEnd() {
		if (!pagerEl) return;
		// Entering a conversation: the slide/snap onto the conv panel (and the header
		// reflow) is now complete, so drop the loading overlay — one rAF lets the
		// reflow paint first. Checked even during the programmatic entry slide.
		if (_convEntering && _onConvMobile && pagerEl.scrollLeft < (pagerEl.clientWidth || 1) * 0.5) {
			clearTimeout(_convEnterT);
			requestAnimationFrame(() => { _convEntering = false; });
		}
		if (_pagerProg || _pagerTouching) return;
		clearTimeout(_pagerSnapT);
		commitPagerRoute();
	}
	// Commit the navigation for whatever panel the track has settled on. Called by
	// scrollend (primary) or the idle debounce (fallback).
	function commitPagerRoute() {
		if (!pagerEl) return;
		// Don't hijack a navigation a tap / programmatic snap just started, and never
		// commit while a finger is down (committing can tear down the conversation,
		// which we want to happen between gestures, not mid-swipe). If we're inside
		// that window, re-check once it passes.
		const now = performance.now();
		if (_pagerTouching || now < _suppressCommitUntil) {
			clearTimeout(_pagerSnapT);
			_pagerSnapT = setTimeout(commitPagerRoute, _pagerTouching ? 60 : (_suppressCommitUntil - now + 20));
			return;
		}
		const cw = pagerEl.clientWidth || 1;
		const raw = Math.round(pagerEl.scrollLeft / cw);
		// Commit whatever panel the track actually SETTLED on. Native
		// scroll-snap-stop already limits a flick to one panel, so we don't need a
		// gesture-anchored ±1 clamp — and that clamp caused the random jumps: when a
		// touch landed mid-momentum, its anchor rounded to the wrong panel and the
		// clamp yanked the settled position back to a neighbour. Just floor at the
		// menu when no chat is active (the conv slot is off-limits then).
		const minIdx = _convActiveOrEntering ? 0 : 1;
		const i = Math.max(minIdx, Math.min(PANELS.length - 1, raw));
		// Use the panel's ACTUAL offset (its exact scroll-snap position) rather than
		// i*width, so a pin can never fight the native snap point.
		const lockLeft = pagerEl.children?.[i]?.offsetLeft ?? i * cw;
		// Pin EXACTLY onto the target panel right now — instant, not a smooth
		// animation that the conversation teardown could interrupt and freeze
		// half-way. Covers both a rare over-flick (clamped i) and a few-px-short snap.
		if (!_pagerTouching && Math.abs(pagerEl.scrollLeft - lockLeft) > 1) {
			_pagerProg = true;
			pagerEl.scrollLeft = lockLeft;
			_suppressCommits(200);
			requestAnimationFrame(() => { _pagerProg = false; });
		}
		// The conv panel has no route — you're already on it; never goto(undefined).
		if (i !== pagerIndex && i >= 0 && i < PANELS.length && PANELS[i].route) {
			// Single clean correction once the nav + teardown settle (no retry loop —
			// repeated pins read as a stagger). overflow-anchor:none on the track
			// should keep the teardown from nudging the scroll in the first place.
			goto(PANELS[i].route, { noScroll: true, keepFocus: true }).then(() => _repinPager(i, 0));
		}
	}
	// Pin the track exactly onto panel `idx` (reading its live offset, so a teardown
	// layout shift can't make the target stale). `tries` extra retries are optional;
	// default is a single check (no stagger). A fresh touch bumps `_repinGen` and
	// cancels it, so a lingering pin can't fight a tap opening a chat.
	let _repinGen = 0;
	function _repinPager(idx, tries, gen) {
		if (gen === undefined) gen = ++_repinGen; // a new invocation supersedes any prior
		if (gen !== _repinGen || !pagerEl || _pagerTouching) return;
		const lockLeft = pagerEl.children?.[idx]?.offsetLeft ?? idx * (pagerEl.clientWidth || 1);
		if (Math.abs(pagerEl.scrollLeft - lockLeft) > 1) {
			_pagerProg = true;
			pagerEl.scrollLeft = lockLeft;
			requestAnimationFrame(() => { _pagerProg = false; });
		}
		if (tries > 0) setTimeout(() => _repinPager(idx, tries - 1, gen), 60);
	}
	// Keep the visible route synced to the URL after a navigation / on load.
	$effect(() => { if (pagerIndex >= 0) { _pagerVisibleRoute = PANELS[pagerIndex].route; _pagerFraction = pagerIndex; } });


	// Fast (~110ms) programmatic scroll for nav-icon taps — native 'smooth' is
	// too slow. Snap is suspended during the animation so it doesn't fight it.
	let _fastScrollRAF = 0;
	function _fastScrollTo(to, dur = 110) {
		const el = pagerEl; if (!el) return;
		const from = el.scrollLeft;
		if (Math.abs(to - from) < 2) return;
		// Programmatic: flag _pagerProg so the live per-gesture clamp and the
		// settle-commit both stand down (a nav-icon tap may jump several panels).
		_pagerProg = true;
		el.style.scrollSnapType = 'none';
		const start = performance.now();
		cancelAnimationFrame(_fastScrollRAF);
		function step(now) {
			const t = Math.min(1, (now - start) / dur);
			const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
			el.scrollLeft = from + (to - from) * e;
			if (t < 1) _fastScrollRAF = requestAnimationFrame(step);
			else { el.style.scrollSnapType = ''; _suppressCommits(120); requestAnimationFrame(() => { _pagerProg = false; }); }
		}
		_fastScrollRAF = requestAnimationFrame(step);
	}

	// Current panel gets the live page data; neighbours get preloaded so they
	// render real content the moment you peek toward them. This effect only
	// depends on pagerIndex + $page.data (the triggers); the panelData/panelSeen
	// reads & writes are untracked so writing them doesn't re-trigger the effect
	// (that was an infinite update loop).
	$effect(() => {
		const idx = pagerIndex;
		const pdata = $page.data;
		const panels = PANELS;
		if (idx < 0) return;
		untrack(() => {
			// The conv panel has no route and renders children() directly (not a
			// keep-alive Comp), so skip its panelData/panelSeen bookkeeping — but
			// still preload its neighbour (the menu) below.
			if (panels[idx].route) {
				panelData = { ...panelData, [panels[idx].route]: pdata };
				if (!panelSeen.has(panels[idx].route)) { const s = new Set(panelSeen); s.add(panels[idx].route); panelSeen = s; }
			}
			for (const j of [idx - 1, idx + 1]) {
				if (j < 0 || j >= panels.length) continue;
				const route = panels[j].route;
				if (!route) continue; // conv neighbour — nothing to preload
				if (!panelData[route]) {
					preloadData(route).then(r => {
						if (r?.type === 'loaded') untrack(() => { panelData = { ...panelData, [route]: r.data }; });
					}).catch(() => {});
				}
			}
		});
	});
	function panelShouldMount(i) {
		// Mount panels adjacent to the COMMITTED route AND to the LIVE scroll
		// position — during a deferred-commit multi-swipe the route lags, so without
		// the live check a panel you're swiping toward could still be a skeleton.
		const liveIdx = Math.round(_pagerFraction);
		return Math.abs(i - pagerIndex) <= 1 || Math.abs(i - liveIdx) <= 1 || panelSeen.has(PANELS[i].route);
	}

	// Sync the track to the current section ONLY for a real mismatch — an
	// external navigation (a link elsewhere) or the initial load — and never
	// while the user is mid-scroll. The old version corrected any >4px drift,
	// which during the swipe→navigation-commit window would yank the track back
	// to the previous panel (the "snaps back to the previous tab" glitch).
	$effect(() => {
		const idx = pagerIndex;
		const navving = !!$navigating; // track: re-run when a navigation starts/ends
		if (idx < 0 || !pagerEl) return;
		const w = pagerEl.clientWidth;
		if (!w) return;
		// NEVER correct while a navigation is in flight. `pagerIndex` reflects the
		// COMMITTED route, which lags behind our flick/swipe until the goto resolves
		// — and on prod that server load takes long enough that this would yank the
		// track back to the old panel (you'd see it scroll to the new one, then snap
		// back). The gesture already put the track where it belongs; once the nav
		// commits, idx matches and there's nothing to correct. Also stand down during
		// the brief suppression window after a flick / programmatic snap.
		if (navving || performance.now() < _suppressCommitUntil) return;
		const target = idx * w;
		const userScrolledRecently = performance.now() - _lastScrollAt < 250;
		if (!userScrolledRecently && Math.abs(pagerEl.scrollLeft - target) > w * 0.5) {
			_pagerProg = true;
			pagerEl.scrollTo({ left: target, behavior: 'auto' });
			requestAnimationFrame(() => { _pagerProg = false; });
		}
	});

	// (The conv panel is permanent now, so there's no add/remove index shift to
	// compensate for — the old hard-snap that did so is gone. `_hardSnapRAF` is
	// kept only so _cancelProgrammaticScroll's cancel call stays valid.)
	let _hardSnapRAF = 0;
	function onPagerScroll() {
		if (!pagerEl) return;
		_lastScrollAt = performance.now();
		const w = pagerEl.clientWidth || 1;
		// Reachability edges (edge-only, never fight a forward swipe; skipped during
		// programmatic scrolls):
		//  • Exiting a conversation (gesture STARTED on the conv panel) → cap the
		//    RIGHT edge at the menu so a hard exit flick can't overshoot toward Home.
		//    Gating on the gesture START is critical: after a quick conv→menu the
		//    route is still committing, so a follow-on menu→Home swipe is still
		//    "_onConvMobile" — without the gate the cap would clamp it back to the
		//    menu (the "can't reach Home, glitches back" bug).
		//  • Not in a chat → the menu (index 1) is the leftmost panel; floor the LEFT
		//    edge there so you can't scroll into the empty conv slot.
		if (!_pagerProg) {
			if (_onConvMobile && _gestureStartIdx === 0) {
				if (pagerEl.scrollLeft > w) pagerEl.scrollLeft = w;
			} else if (!_convActiveOrEntering && pagerEl.scrollLeft < w) {
				pagerEl.scrollLeft = w;
			}
		}
		// (No live scrollLeft clamp — it fought deliberate multi-panel drags and
		// yanked you back on release. Panel skipping is prevented instead by native
		// scroll-snap-stop + deferring nav commits until the gesture ends, so panel
		// indices never shift mid-swipe.)
		// Live fraction (drives the sliding highlight) + which panel is centred
		// RIGHT NOW (drives the discrete selected tab), before navigation
		// commits, so the bottom bar follows your finger.
		_pagerFraction = pagerEl.scrollLeft / w;
		// Drive the bottom-nav pill IMPERATIVELY (write the CSS var straight to the
		// DOM, bypassing Svelte's per-frame reactivity flush) so it tracks the swipe
		// at 60fps. The pill's transform reads --nav-frac. (A settle/nav effect sets
		// it for non-scroll route changes.)
		_writeNavFrac(_pagerFraction);
		const vi = Math.round(_pagerFraction);
		if (PANELS[vi]) _pagerVisibleRoute = PANELS[vi].route;
		if (_pagerProg) return;
		// scrollend (when supported) is the precise commit trigger — it fires only
		// after the snap fully settles, so we never commit mid-snap. Keep an idle
		// debounce as a backstop: short when scrollend is absent, long (just a safety
		// net) when present so scrollend wins but we never get stuck if it misfires.
		clearTimeout(_pagerSnapT);
		_pagerSnapT = setTimeout(commitPagerRoute, _scrollEndSupported ? 350 : 80);
	}
	const _scrollEndSupported = typeof window !== 'undefined' && 'onscrollend' in window;

	// ── Bottom-nav pill position (driven via a CSS var, not Svelte, for 60fps) ──
	// Expressed as a fractional nav slot: 0 = Chat, 1 = Home, 2 = Orbit, … The
	// conversation + menu panels both collapse onto the Chat slot (0).
	function _writeNavFrac(frac) {
		if (typeof document === 'undefined') return;
		const homeIdx = PANELS.findIndex((p) => p.route === '/app');
		if (homeIdx < 0) return;
		document.documentElement.style.setProperty('--nav-frac', String(Math.max(0, frac - homeIdx + 1)));
	}
	// Discrete slot for a committed route — for settle, nav-icon taps, and off-pager
	// routes (where the live scroll handler isn't running).
	function _navSlotForPath(path) {
		if (path.startsWith('/app/chat')) return 0;
		if (path === '/app' || path.startsWith('/app/weeks')) return 1;
		if (path.startsWith('/app/orbit') || path.startsWith('/app/atlas') || path.startsWith('/app/collection') || path.startsWith('/app/assignments') || path.startsWith('/app/files')) return 2;
		if (path.startsWith('/app/playground')) return 3;
		if (path.startsWith('/app/manage')) return 4;
		return 0;
	}
	$effect(() => {
		const path = $page.url.pathname; // fires on navigation (settle), not per scroll frame
		if (typeof document === 'undefined') return;
		document.documentElement.style.setProperty('--nav-frac', String(_navSlotForPath(path)));
	});

	// Conversation → menu swipe. A conversation (channel/DM) is a full-screen,
	// non-pager view; a clear right-to-left swipe navigates to the chat menu
	// (the pager's left panel), from which you can keep swiping to Home etc.
	// (_swDragX/_swDragging kept only so the desktop sidebar's drag bindings
	// stay defined — unused on mobile now.)
	let _swStartX = 0, _swStartY = 0, _swArmed = false, _swDecided = false;
	let _swDragX = $state(0);
	let _swDragging = $state(false);
	// Menu overlay drag: 0 = off-screen right (conversation), 1 = fully covering.
	let _menuSliding = $state(false);   // overlay present (dragging or settling)
	let _menuDragging = $state(false);  // finger is actively dragging (no transition)
	// Plain (non-reactive) — the visual transform is driven imperatively via the
	// `--md` custom property on the overlay element, so dragging doesn't run a
	// Svelte reactivity flush per touch-move (that's what kept it from feeling as
	// smooth as the compositor-driven pager). This var only feeds the threshold
	// logic in onSwipeEnd.
	let _menuDrag = 0;
	let _menuSlideEl = $state(null);
	function _setMenuDrag(v) {
		_menuDrag = v;
		_menuSlideEl?.style.setProperty('--md', String(v));
	}
	let _menuGen = 0;                   // bumps each gesture so a stale settle never drops a newer overlay
	let _menuNavPending = false;        // true between the conv→menu commit and the menu actually landing
	let _menuJustLanded = false;        // ~400ms window right after landing on the menu (pager may not yet handle a fast flick)
	let _menuLandedT;
	let _swMode = 'menu';               // 'menu' (conversation → chat menu) | 'home' (fast follow-on → Home)
	function onSwipeStart(e) {
		if (window.innerWidth > 640) { _swArmed = false; return; }
		// The conversation is now a real pager panel, so conv→menu is handled by
		// the native scroll-snap track (compositor-smooth). The old finger-tracked
		// overlay is fully redundant whenever the pager is live — never arm it.
		if (isPagerActive) { _swArmed = false; return; }
		const t = e.touches?.[0];
		if (!t) { _swArmed = false; return; }
		// Don't hijack the compose / sliders / horizontal scrollers / pickers.
		if (e.target?.closest?.('.input-area, .send-wrap, .sz-capture, input[type="range"], .text-typo-bar, .expr-panel, .picker-popover, .compose-picker-pop')) { _swArmed = false; return; }
		if ((_isConvRoute($page.url.pathname) || _showConvSkeleton) && !_menuNavPending) {
			// In a conversation OR its loading skeleton → a left-swipe opens the
			// chat menu (so you can bail back out of a still-loading chat too).
			_swMode = 'menu';
		} else if (_menuNavPending || _menuJustLanded) {
			// Just opened the menu and the pager isn't reliably catching a FAST
			// follow-on flick yet → treat a left-swipe as "carry on to Home".
			_swMode = 'home';
		} else {
			_swArmed = false; return;
		}
		_swStartX = t.clientX; _swStartY = t.clientY;
		_swPrevX = t.clientX; _swPrevT = e.timeStamp; _swVelX = 0;
		_swArmed = true; _swDecided = false;
	}
	let _swLastDx = 0, _swVelX = 0, _swPrevX = 0, _swPrevT = 0;
	function onSwipeMove(e) {
		if (!_swArmed) return;
		const t = e.touches?.[0]; if (!t) return;
		const dx = t.clientX - _swStartX, dy = t.clientY - _swStartY, W = window.innerWidth;
		_swLastDx = dx;
		// Instantaneous horizontal velocity (px/ms) — lets a quick FLICK commit
		// even at low drag distance, matching the native pager's momentum snap.
		const _dt = e.timeStamp - _swPrevT;
		if (_dt > 0) _swVelX = (t.clientX - _swPrevX) / _dt;
		_swPrevX = t.clientX; _swPrevT = e.timeStamp;
		if (!_swDecided) {
			if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
			if (Math.abs(dy) >= Math.abs(dx)) { _swArmed = false; return; } // vertical → scroll
			if (dx > 0) { _swArmed = false; return; }                       // leftward only
			_swDecided = true;
			if (_swMode === 'menu') { _menuSliding = true; _menuDragging = true; }
		}
		// 'home' mode just waits for release (no overlay) — the pager will snap.
		if (_swMode === 'menu') {
			_setMenuDrag(Math.max(0, Math.min(1, -dx / W)));
		}
	}
	function onSwipeEnd() {
		if (!_swArmed) return;
		_swArmed = false;
		// Fast follow-on swipe right after opening the menu → go on to Home,
		// without waiting for the pager's native scroll-snap to engage. Require a
		// clear swipe (≥30px left) so it can never collide with a tap (≤16px,
		// handled by onMenuTouchEnd → opens that conversation).
		if (_swMode === 'home') {
			if (_swDecided && (_swLastDx <= -30 || _swVelX < -0.4)) { clearTimeout(_pagerSnapT); pageTitle.set(null); pageTitleHref.set(null); goto('/app', { noScroll: true }); }
			return;
		}
		if (!_menuSliding) return;
		_menuDragging = false; // re-enable the transition so it animates to the snap
		// Commit on a clear drag (past 30%) OR a quick leftward flick (velocity),
		// like the native pager's momentum snap.
		if (_menuDrag > 0.3 || _swVelX < -0.4) {
			const gen = ++_menuGen;
			_setMenuDrag(1); // settle fully in (fast transition)
			// Commit the navigation IMMEDIATELY (no settle delay) so the real
			// pager menu is live underneath the overlay right away — the overlay
			// is pointer-events:none, so a quick SECOND left-swipe passes straight
			// through and scrolls the pager to Home. Drop the overlay ONLY once
			// BOTH (a) the pager menu has actually painted underneath and (b) the
			// slide-in has finished — dropping before the paint is what made the
			// old chat flash back for a few frames.
			let painted = false, slid = false;
			const drop = () => {
				if (painted && slid && gen === _menuGen) { _menuSliding = false; _setMenuDrag(0); }
			};
			_menuNavPending = true; // block re-arming until the menu route actually lands
			// A fast follow-on left-swipe within this window is routed to Home by
			// onSwipeEnd ('home' mode), since the pager's native snap may not catch
			// a quick flick this soon after mounting.
			_menuJustLanded = true;
			clearTimeout(_menuLandedT);
			_menuLandedT = setTimeout(() => { _menuJustLanded = false; }, 450);
			// Clear any eager chat title so the menu header isn't left showing it
			// (covers the case where we bail before the conversation ever mounts).
			pageTitle.set(null); pageTitleHref.set(null);
			goto('/app/chat', { noScroll: true }).then(() => {
				_menuNavPending = false; // pager is now live → further swipes go to it
				requestAnimationFrame(() => requestAnimationFrame(() => { painted = true; drop(); }));
			});
			// Safety net: never leave it stuck pending if the nav promise stalls.
			setTimeout(() => { _menuNavPending = false; }, 400);
			setTimeout(() => { slid = true; drop(); }, 120);
		} else {
			_menuGen++;
			_setMenuDrag(0); // cancel — slide back out
			setTimeout(() => { _menuSliding = false; }, 130);
		}
	}

	// Tap-to-navigate for the chat-menu panel. When you swipe Home → Chat and
	// tap a conversation while the pager is still momentum-scrolling, iOS eats
	// the synthetic click (it spends the tap stopping the scroll) so the link
	// never fires. We detect the tap from the raw touch and navigate ourselves.
	let _menuTap = null;
	// Publish the tapped chat's title/subtitle to the header BEFORE navigating,
	// so the header shows the right name immediately during the loading skeleton
	// (it matches what the conversation re-publishes on mount → no flicker).
	function _setEagerChatTitle(href) {
		let m = href.match(/^\/app\/chat\/channel\/([^/?#]+)/);
		if (m) { pageTitle.set('# ' + decodeURIComponent(m[1])); pageTitleHref.set(null); return; }
		m = href.match(/^\/app\/chat\/dm\/([^/?#]+)/);
		if (m) {
			const cid = m[1];
			const u = data.users?.find((x) => getConvId(data.currentUser.id, x.id) === cid);
			pageTitle.set(u?.name ?? '');
			pageTitleHref.set(u ? `/app/profile/${u.id}` : null);
		}
	}

	function onMenuTouchStart(e) {
		const t = e.touches?.[0];
		// Capture the link under the finger AT touchstart — more reliable than the
		// touchend target while the panel is scrolling.
		const href = e.target?.closest?.('a[href]')?.getAttribute('href') ?? null;
		_menuTap = t ? { x: t.clientX, y: t.clientY, t: e.timeStamp, href } : null;
		// Kick the conversation's data load NOW, while the finger is still down, so
		// it's (often) already cached by the time the tap lands → instant swap.
		if (href && _isConvRoute(href)) preloadData(href).catch(() => {});
	}
	function onMenuTouchEnd(e) {
		const start = _menuTap;
		_menuTap = null;
		if (!start) return;
		const t = e.changedTouches?.[0];
		if (!t) return;
		// Tap, not a scroll/hold — generous thresholds so a fast flick-then-release
		// on a chat (the "moving fast" case) still counts as a tap.
		if (Math.abs(t.clientX - start.x) > 16 || Math.abs(t.clientY - start.y) > 16) return;
		if (e.timeStamp - start.t > 700) return;
		const href = start.href || e.target?.closest?.('a[href]')?.getAttribute('href');
		if (!href || href === '#') return;
		// The pager schedules goto(currentPanel) ~80ms after any scroll; if that
		// fires after ours it yanks us back to the menu and the tap "does nothing".
		// Cancel the pending one and suppress scroll-commits briefly so a stray
		// momentum / anchoring scroll can't bounce us back out.
		clearTimeout(_pagerSnapT);
		_suppressCommits(400);
		e.preventDefault();
		const goingToConv = _isConvRoute(href);
		if (goingToConv) {
			_setEagerChatTitle(href);
			goto(href);
			// The conversation panel is the permanent index 0 — just slide the track
			// to it (eased, like the rest of the pager). Activates as soon as the
			// route commits; the loading overlay covers the gap. Works the same
			// whether we came from the menu or are re-opening from a stale conv route,
			// with no index shift to fight.
			_fastScrollTo(0, 260);
		} else {
			goto(href);
		}
	}

	let sidebarCollapsed = $state(false);
	let sidebarWidth = $state(220);
	let resizing = $state(false);

	function startResize(e) {
		e.preventDefault();
		resizing = true;
		const onMove = (ev) => {
			const w = Math.max(160, Math.min(400, ev.clientX));
			sidebarWidth = w;
			document.documentElement.style.setProperty('--sidebar-width', w + 'px');
		};
		const onUp = () => {
			resizing = false;
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
			localStorage.setItem('sidebar_width', String(sidebarWidth));
		};
		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
	}

	setContext('openSidebar', () => { sidebarOpen = !sidebarOpen; });
	// Live nav state for the bottom bar: which section panel is in view RIGHT
	// NOW (so the selected tab follows the swipe instead of waiting for the
	// navigation to commit), and whether the chat drawer is open (so the Chat
	// icon stays selected even with no conversation chosen).
	setContext('pagerNav', {
		get activeRoute() { return isPagerActive ? _pagerVisibleRoute : null; },
		get sidebarOpen() { return sidebarOpen; },
		// True while the conversation panel covers most of the screen. Goes false
		// the instant you swipe past halfway toward the menu — so the header can
		// switch from the chat name back to the standard wordmark live with the
		// scroll, instead of waiting for the deferred route commit to settle.
		get convCovering() { return _onConvMobile && _pagerFraction < 0.5; },
		// Fractional BOTTOM-NAV slot (0 = Chat, 1 = Home, …). The chat panels
		// (conversation + menu, which both sit left of Home) collapse onto the
		// single Chat slot, so the pill rides correctly across the 4 nav icons
		// regardless of whether the conversation panel is present.
		get navFraction() {
			const homeIdx = PANELS.findIndex((p) => p.route === '/app');
			return homeIdx < 0 ? 0 : Math.max(0, _pagerFraction - homeIdx + 1);
		},
		// Tapping a nav icon: go STRAIGHT to the target — no eased scroll. Kill any
		// in-flight programmatic scroll / pending settle / snap so nothing fights the
		// jump, hard-set scrollLeft to the panel, and commit the route. (An eased
		// scroll here could collide with a swipe animation still settling, which
		// caused the transform fighting.) Returns true so the <a> can preventDefault.
		goToSection(route) {
			if (!isPagerActive || !pagerEl) return false;
			const idx = PANELS.findIndex((p) => p.route === route);
			if (idx < 0) return false;
			// Kill everything that could fight or revert the jump: any eased scroll /
			// hard-snap, pending settle-commit, AND any lingering re-pin (a pin queued
			// after a recent chat exit was snapping us back). Clear the entry overlay.
			_cancelProgrammaticScroll();
			_repinGen++;
			clearTimeout(_pagerSnapT);
			_convEntering = false;
			// Suppress scroll-commits during the nav so none reverts us. No post-nav
			// re-assert: that "finish" step fought a follow-on swipe (tap-then-swipe
			// snapped back to the tapped tab). The jump + suppression + re-pin cancel
			// are enough to land cleanly without anything to fight a later gesture.
			_suppressCommits(600);
			_pagerProg = true;
			const prevSnap = pagerEl.style.scrollSnapType;
			pagerEl.style.scrollSnapType = 'none';
			const t = pagerEl.children?.[idx]?.offsetLeft ?? idx * (pagerEl.clientWidth || 1);
			pagerEl.scrollLeft = t;        // instant — straight to the target
			_pagerFraction = idx;          // jump the highlight too (no lag)
			_pagerVisibleRoute = route;
			requestAnimationFrame(() => { if (pagerEl) pagerEl.style.scrollSnapType = prevSnap; _pagerProg = false; });
			goto(route, { noScroll: true, keepFocus: true });
			return true;
		},
		// Live fractional scroll position (0 = first section … N-1 = last), so
		// the bottom-bar highlight can slide continuously with the swipe.
		get fraction() { return _pagerFraction; }
	});
	// Expose rawPresence to child pages (e.g. manage) via a getter so the manage
	// tab uses the exact same signal as the sidebar — no separate Firebase subscription.
	setContext('rawPresence', { get value() { return rawPresence; } });
	// `presenceStatus` is the 3-state derivation { uid → 'active' |
	// 'idle' | 'offline' } that drives dot colour. Children that
	// already read rawPresence can opt-in to the richer signal
	// without rewriting their own derivation logic.
	setContext('presenceStatus', { get value() { return presenceStatus; } });
	setContext('refreshPresence', () => pollPresence());
	setContext('addToast', (convId, convPath, title, body) => addToast(convId, convPath, title, body));
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

	// ── Member reordering (drag & drop) ──────────────────────────────────────
	// A user-defined order of member uids, persisted per-class in localStorage.
	// Members not in the list (new joins) sort to the end in server order.
	const MEMBER_ORDER_KEY = `mem-order:${data.currentClass?.id ?? 'x'}`;
	// Seed from the server (synced across every device); localStorage is just an
	// offline fallback restored in onMount when the server has nothing yet.
	let memberOrder = $state(
		Array.isArray(data.currentUser?.memberOrder) ? data.currentUser.memberOrder : []
	);
	let dragUid = $state(null);
	const orderedUsers = $derived.by(() => {
		const users = data.users ?? [];
		if (!memberOrder.length) return users;
		const rank = new Map(memberOrder.map((id, i) => [id, i]));
		return [...users].sort((a, b) =>
			(rank.has(a.id) ? rank.get(a.id) : Infinity) - (rank.has(b.id) ? rank.get(b.id) : Infinity)
		);
	});
	function persistMemberOrder() {
		// localStorage = instant local cache; the POST makes it identical on
		// every device (desktop + mobile) via users.member_order.
		try { localStorage.setItem(MEMBER_ORDER_KEY, JSON.stringify(memberOrder)); } catch {}
		fetch('/api/member-order', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ order: memberOrder })
		}).catch(() => {});
	}
	function onMemberDragStart(e, uid) {
		dragUid = uid;
		try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', uid); } catch {}
	}
	function onMemberDragOver(e, overUid) {
		if (!dragUid || dragUid === overUid) return;
		e.preventDefault();
		try { e.dataTransfer.dropEffect = 'move'; } catch {}
		// Live reorder: splice the dragged uid in just before the row it's over.
		const cur = orderedUsers.map((u) => u.id);
		const from = cur.indexOf(dragUid);
		const to = cur.indexOf(overUid);
		if (from < 0 || to < 0 || from === to) return;
		cur.splice(to, 0, cur.splice(from, 1)[0]);
		memberOrder = cur;
	}
	function onMemberDragEnd() {
		if (dragUid) persistMemberOrder();
		dragUid = null;
	}

	// Clean a raw message into a one-line preview: drop emote tokens
	// ([ek|ce|tg|tgc:…]) and the PUA size/effect sentinels so the list shows
	// readable text instead of markup noise.
	function previewText(s) {
		return (s || '')
			.replace(/\[(?:ek|ce|tg|tgc):[^\]]*\]/gi, ' ')
			.replace(/[\uE000-\uF8FF]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

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
	const IDLE_THRESHOLD = 4 * 60 * 1000;    // 4 min — no input → status flips from active (green) to idle (yellow)
	const HEARTBEAT_INTERVAL = 2.5 * 60 * 1000; // 2.5 min — keeps lastSeen fresh within TTL with 2.5min margin
	const POLL_INTERVAL = 5 * 60 * 1000;     // 5 min — fallback only; allPresenceRef subscription handles real-time
	const PING_DEBOUNCE = 90 * 1000;         // navigation pings skipped if we pinged within this window
	const INPUT_WRITE_DEBOUNCE = 30 * 1000;  // throttle RTDB lastInputAt writes so mousemove doesn't hammer Firebase
	let rawPresence = $state({});
	let presenceTick = $state(0);
	// Local timestamp of the most recent real input (mouse / key /
	// touch / scroll / wheel) on this tab. Bumped by the listeners
	// installed in onMount and reflected to RTDB on heartbeats + on
	// wake-from-idle so other clients see the green dot return
	// immediately when the user moves their mouse again.
	let _lastInputAt = $state(Date.now());
	let _lastInputWriteAt = 0;
	let _myStatusIsIdle = false;

	// Per-user activity status. Three levels:
	//   'active'  — online && most recent input within IDLE_THRESHOLD
	//   'idle'    — online but no input for ≥ IDLE_THRESHOLD
	//   'offline' — tab closed or heartbeat stale beyond PRESENCE_TTL
	// presenceTick re-evaluates this every minute so a user who walked
	// away mid-session slides from active → idle without a fresh
	// presence event from their side.
	let presenceStatus = $derived.by(() => {
		presenceTick;
		const now = Date.now();
		const map = {};
		for (const [uid, v] of Object.entries(rawPresence)) {
			if (!v.online || (now - (v.lastSeen ?? 0)) > PRESENCE_TTL) {
				map[uid] = 'offline';
				continue;
			}
			// Other devices may report the same uid; if any device shows
			// fresh input we treat the user as active. devices is a flat
			// array populated by /api/presence/me + the live RTDB merge.
			let mostRecentInput = v.lastInputAt ?? 0;
			if (Array.isArray(v.devices)) {
				for (const d of v.devices) {
					mostRecentInput = Math.max(mostRecentInput, d.lastInputAt ?? 0);
				}
			}
			// Fall back to lastSeen if the client never wrote lastInputAt
			// (e.g. older sessions before this rollout). lastSeen + tab
			// open is the best signal we have.
			if (!mostRecentInput) mostRecentInput = v.lastSeen ?? 0;
			map[uid] = (now - mostRecentInput) > IDLE_THRESHOLD ? 'idle' : 'active';
		}
		return map;
	});

	// Backward-compat: anything still asking "is this user's tab open
	// at all" gets a Set of every uid whose status isn't offline.
	let onlineIds = $derived(new Set(
		Object.entries(presenceStatus)
			.filter(([, s]) => s !== 'offline')
			.map(([uid]) => uid)
	));

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

	let _audioCtx = null;
	function playSound() {
		try {
			if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext();
			const ctx = _audioCtx;
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
	let heartbeatTimer, tickTimer, presencePollTimer, idleTickTimer;
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
					sessionStart: _pingSessionStart,
					lastInputAt: _lastInputAt
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

		// Restore a locally-cached member ordering ONLY if the server hasn't
		// supplied one yet (first drag before it round-trips, or offline).
		try {
			if (!memberOrder.length) {
				const saved = JSON.parse(localStorage.getItem(MEMBER_ORDER_KEY) || '[]');
				if (Array.isArray(saved) && saved.length) memberOrder = saved;
			}
		} catch {}

		// BroadcastChannel: service worker relays push data here, but we no longer show
		// toasts from it — Firebase subscriptions (onChildAdded / userChats) handle
		// in-app toasts with better attribution while the app is open. The OS notification
		// covers the background case. Keeping the channel open just in case we need it
		// for future non-toast purposes (e.g. count sync when Firebase is briefly down).
		try {
			pushBroadcast = new BroadcastChannel('ec-push');
		} catch { /* BroadcastChannel not available */ }

		// Track mobile breakpoint for the section pager.
		const _mq = window.matchMedia('(max-width: 640px)');
		_isMobile = _mq.matches;
		_mqHandler = (e) => { _isMobile = e.matches; };
		_mq.addEventListener('change', _mqHandler);

		// Swipe-to-close the mobile sidebar drawer (open via the Chat button).
		// Passive — we never preventDefault, so native scrolling stays smooth.
		window.addEventListener('touchstart', onSwipeStart, { passive: true });
		window.addEventListener('touchmove', onSwipeMove, { passive: true });
		window.addEventListener('touchend', onSwipeEnd, { passive: true });

		sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === '1';
		const savedWidth = parseInt(localStorage.getItem('sidebar_width') ?? '220');
		if (savedWidth >= 160 && savedWidth <= 400) {
			sidebarWidth = savedWidth;
			document.documentElement.style.setProperty('--sidebar-width', savedWidth + 'px');
		}
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
			// lastInputAt — most recent real input on this device.
			// Drives the active vs idle distinction; other clients
			// compare it to IDLE_THRESHOLD when colouring the dot.
			lastInputAt: _lastInputAt,
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
			// The socket coming back up IS an activity signal — closing
			// a laptop tears the WebSocket down; opening it triggers
			// this reconnect. Bumping _lastInputAt here gives the user
			// a brief green window when they wake the device even if
			// they haven't moved the mouse yet. If they then walk
			// away, the 4-minute idle timer will flip them to yellow
			// as expected.
			_lastInputAt = Date.now();
			_lastInputWriteAt = _lastInputAt;
			_myStatusIsIdle = false;
			rawPresence = {
				...rawPresence,
				[data.currentUser.id]: {
					...(rawPresence[data.currentUser.id] ?? {}),
					online: true,
					lastSeen: _lastInputAt,
					lastInputAt: _lastInputAt
				}
			};
			// Disconnect handler. When the WebSocket dies (tab close,
			// network drop, crash) Firebase server fires this write on
			// our behalf. We mark `online: false` AND `lastInputAt: 0`
			// so the read-side derivation has TWO independent signals
			// to fall back on:
			//   - `online: false` immediately drops this device from the
			//     aggregated fresh-device list → uid status flips to
			//     'offline' as soon as the last live device dies.
			//   - `lastInputAt: 0` separately drives the active/idle
			//     check, so even if the snapshot still reads `online: true`
			//     for a beat (network jitter, stale cache), the user
			//     reads as at-minimum 'idle' (yellow) right away
			//     instead of lingering as 'active' (green) while
			//     they're clearly gone.
			// `lastSeen` is intentionally left at its last heartbeat
			// so observers can show "last seen N ago" accurately.
			onDisconnect(presenceRef).update({ online: false, lastInputAt: 0 });
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

		// Input tracking. `onAnyInput` is the ONLY function in this
		// file that bumps `_lastInputAt`. Heartbeats, presencePing,
		// reconnect writes, the rawPresence mirror inside the
		// heartbeat — none of them touch `_lastInputAt`; they only
		// refresh `lastSeen` (tab-is-open proof) so RTDB writes keep
		// the user marked online without lying about their activity.
		// That separation is what makes the yellow/idle state stable
		// even though Firebase is being pinged in the background.
		//
		// Two RTDB write paths on real input:
		//   - immediate, full `set()` when waking from idle so other
		//     clients flip yellow → green within one round-trip;
		//   - throttled `update({ lastInputAt, lastSeen })` otherwise
		//     so an active user moving the mouse continuously doesn't
		//     hammer Firebase. Heartbeats still ride the regular
		//     interval and carry the (possibly stale) `_lastInputAt`
		//     verbatim — that's the whole point.
		//
		// `scroll` is deliberately NOT in the listener list. Chat
		// auto-scrolls to the bottom on new messages, and a browser-
		// dispatched scroll from `element.scrollTop = …` is `isTrusted`
		// even though no human moved a finger. The events below cover
		// every real human-initiated scroll path: keydown (arrows /
		// page up / home), mousedown (scrollbar drag), wheel
		// (trackpad / mouse wheel), touchstart (touch swipe). If you
		// can scroll without one of those firing first, it wasn't you.
		const onAnyInput = (e) => {
			// `isTrusted` filters out anything synthesised by
			// `dispatchEvent` — the few code paths that do this for
			// keyboard simulation, etc., shouldn't masquerade as
			// real human activity.
			if (e && e.isTrusted === false) return;
			const now = Date.now();
			_lastInputAt = now;
			// Also reflect locally so my own dot updates instantly,
			// not waiting for the RTDB round-trip.
			rawPresence = {
				...rawPresence,
				[data.currentUser.id]: {
					...(rawPresence[data.currentUser.id] ?? {}),
					online: true,
					lastSeen: now,
					lastInputAt: now
				}
			};
			if (_myStatusIsIdle) {
				_myStatusIsIdle = false;
				_lastInputWriteAt = now;
				if (presenceRef) set(presenceRef, presencePayload())
					.catch((err) => console.error('[ec:presence] wake-from-idle write FAILED:', err.code, err.message));
				return;
			}
			if (now - _lastInputWriteAt > INPUT_WRITE_DEBOUNCE) {
				_lastInputWriteAt = now;
				if (presenceRef) update(presenceRef, { lastInputAt: now, lastSeen: now })
					.catch(() => { /* best-effort */ });
			}
		};
		const INPUT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
		for (const ev of INPUT_EVENTS) {
			document.addEventListener(ev, onAnyInput, { passive: true, capture: true });
		}
		// Idle-flag tick. Runs alongside presenceTick so my own
		// _myStatusIsIdle stays in sync — the boolean drives the
		// wake-from-idle transition above. We also force a presence
		// re-derivation here (presenceTick++) so my OWN dot flips to
		// yellow within 30s of crossing IDLE_THRESHOLD instead of
		// waiting up to a full minute for the slower presenceTick.
		// The 30s cadence means the green→yellow flip lands at ~4:00–4:30
		// of inactivity rather than 4:00–5:00.
		idleTickTimer = setInterval(() => {
			const wasIdle = _myStatusIsIdle;
			_myStatusIsIdle = (Date.now() - _lastInputAt) > IDLE_THRESHOLD;
			// Re-evaluate on every tick (cheap counter bump) so the dot
			// tracks the threshold promptly; the transition itself is the
			// moment that visually matters, but a steady re-check also
			// keeps other users' idle/offline states fresh between the
			// 60s presenceTick beats.
			presenceTick++;
			if (_myStatusIsIdle !== wasIdle) {
				console.info('[ec:presence] self status →', _myStatusIsIdle ? 'idle (yellow)' : 'active (green)');
			}
		}, 30_000);

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
						// lastInputAt threads up to the uid-level so the
						// `presenceStatus` derivation can compare it
						// against IDLE_THRESHOLD without falling back to
						// lastSeen (which heartbeats refresh on its own
						// schedule and would mask the idle state).
						lastInputAt: v.lastInputAt ?? 0,
						ua: v.ua ?? null, pwa: v.pwa ?? null, mobile: v.mobile ?? null, notif: v.notif ?? null,
						devices: fresh ? [{ ua: v.ua ?? null, pwa: !!v.pwa, mobile: !!v.mobile, lastSeen: v.lastSeen ?? 0, lastInputAt: v.lastInputAt ?? 0 }] : []
					};
				} else {
					// Per-device format (or mixed — only read the object children)
					let online = false, lastSeen = 0, lastInputAt = 0, ua = null, pwa = null, mobile = null, notif = null;
					const devices = [];
					for (const d of deviceObjects) {
						const fresh = d.online && (d.lastSeen ?? 0) > fbNow - PRESENCE_TTL;
						if (fresh) {
							online = true;
							devices.push({ ua: d.ua ?? null, pwa: !!d.pwa, mobile: !!d.mobile, lastSeen: d.lastSeen ?? 0, lastInputAt: d.lastInputAt ?? 0 });
						}
						if ((d.lastSeen ?? 0) > lastSeen) {
							lastSeen = d.lastSeen;
							ua = d.ua ?? null;
							pwa = d.pwa ?? null;
							mobile = d.mobile ?? null;
						}
						// Take the freshest input across all devices —
						// even a stale device shouldn't suppress activity
						// from a live one, but a non-fresh device's old
						// `lastInputAt` shouldn't keep someone "active"
						// after they walked away either. Only count
						// `lastInputAt` from devices that are themselves
						// online, so a phone closed an hour ago doesn't
						// contradict the desktop going idle.
						if (fresh && (d.lastInputAt ?? 0) > lastInputAt) {
							lastInputAt = d.lastInputAt;
						}
						if (d.notif != null) notif = d.notif;
					}
					normalized[uid] = { online, lastSeen, lastInputAt, ua, pwa, mobile, notif, devices };
				}
			}
			// Never let Firebase override the current user as offline — they're online
			// since this code is running. Firebase may have a stale onDisconnect value.
			// Also correct device metadata to match the current session (not a stale mobile entry).
			if (data?.currentUser?.id) {
				const existing = normalized[data.currentUser.id] ?? rawPresence[data.currentUser.id] ?? {};
				const currentDevice = { ua: navigator.userAgent, pwa: isPwa, mobile: isMobile, lastSeen: Date.now(), lastInputAt: _lastInputAt };
				// Replace or add this session's device in the devices array
				const otherDevices = (existing.devices ?? []).filter(
					(d) => d.ua !== navigator.userAgent
				);
				normalized[data.currentUser.id] = {
					...existing,
					online: true,
					lastSeen: Date.now(),
					// Use the local `_lastInputAt` (not whatever the
					// snapshot saw) so my own dot reflects my actual
					// activity instantly — heartbeats might still be
					// pushing stale values to RTDB.
					lastInputAt: _lastInputAt,
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

		// Per-user unread counts — replace directly from Firebase so clears from
		// other tabs/devices propagate instantly. Local optimistic increments
		// (e.g. new message arrival) are quickly corrected by the Firebase echo.
		unreadCountsRef = ref(rtdb, `unreadCounts/${data.currentUser.id}`);
		onValue(unreadCountsRef, (snap) => {
			unreadCounts = snap.exists() ? snap.val() : {};
		});
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('touchstart', onSwipeStart);
			window.removeEventListener('touchmove', onSwipeMove);
			window.removeEventListener('touchend', onSwipeEnd);
		}
		pushBroadcast?.close();
		clearInterval(heartbeatTimer);
		clearInterval(tickTimer);
		clearInterval(presencePollTimer);
		clearInterval(idleTickTimer);
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
		const w = sidebarCollapsed ? 52 : sidebarWidth;
		document.documentElement.style.setProperty('--sidebar-width', w + 'px');
	});

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

<!-- Conversation list — shared by the desktop sidebar AND the mobile chat
     panel (pager index 0). Defined once at the top level so both can render it. -->
{#snippet chatListContent()}
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
				{@const meta = channelMeta[ch.id]}
				<a href={path} class="conv-item" class:active={$page.url.pathname === path}>
					<span class="avatar-wrap">
						<span class="conv-avatar channel-avatar">#</span>
					</span>
					<div class="member-text">
						<span class="member-name" class:bold={unreadCount > 0 || hasDot}>{ch.name}</span>
						<span class="conv-last">
							{#if meta?.lastMessage}{#if meta.lastUser}<span class="last-sender">{meta.lastUser}:</span> {/if}{previewText(meta.lastMessage)}{:else}<span class="conv-last-empty">No messages yet</span>{/if}
						</span>
					</div>
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
					<a class="conv-item" href="/app/profile/{data.currentUser.id}">
						<span class="avatar-wrap">
							<Avatar
								name={data.currentUser.name}
								uid={data.currentUser.id}
								avatarKind={data.currentUser.avatarKind ?? 'gen'}
								avatarValue={data.currentUser.avatarValue ?? null}
								size={40}
							/>
							<span class="presence-dot" class:idle={presenceStatus[data.currentUser.id] === 'idle'}></span>
						</span>
						<div class="member-text">
							<span class="member-name">{data.currentUser.name} <span class="you-tag">you</span></span>
							<span class="conv-last conv-last-empty">View your profile</span>
						</div>
						{#if data.currentUser.role === 'instructor'}<span class="role-badge">instr.</span>{/if}
					</a>
				</div>
			{/if}

			{#each orderedUsers as u (u.id)}
				{@const isOnline = onlineIds.has(u.id)}
				{@const convId = getConvId(data.currentUser.id, u.id)}
				{@const dmPath = `/app/chat/dm/${convId}`}
				{@const dmUnreadCount = unreadCounts[convId] ?? 0}
				{@const dmUnreadDot = dmUnreadCount === 0 && isUnread(convId, dmList.find((d) => d.convId === convId)?.lastAt)}
				{@const lastMsg = dmList.find((d) => d.convId === convId)?.lastMessage ?? null}
				<div class="member-row"
					class:drag-target={dragUid && dragUid !== u.id}
					class:dragging={dragUid === u.id}
					draggable="true"
					ondragstart={(e) => onMemberDragStart(e, u.id)}
					ondragover={(e) => onMemberDragOver(e, u.id)}
					ondragend={onMemberDragEnd}
					ondrop={(e) => e.preventDefault()}
					onmouseenter={(e) => showHover(e, u.id)} onmouseleave={hideHover}>
					<a class="conv-item" href={dmPath} class:active={$page.url.pathname === dmPath} draggable="false">
						<span class="avatar-wrap">
							<Avatar
								name={u.name}
								uid={u.id}
								avatarKind={u.avatarKind ?? 'gen'}
								avatarValue={u.avatarValue ?? null}
								size={40}
							/>
							{#if isOnline}<span class="presence-dot" class:idle={presenceStatus[u.id] === 'idle'}></span>{/if}
						</span>
						<div class="member-text">
							<span class="member-name" class:bold={dmUnreadCount > 0 || dmUnreadDot}>{u.name}</span>
							{#if lastMsg}<span class="conv-last">{previewText(lastMsg)}</span>{:else}<span class="conv-last conv-last-empty">Tap to message</span>{/if}
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
{/snippet}

{#if sidebarOpen}
	<div class="sidebar-backdrop" onclick={() => sidebarOpen = false}></div>
{/if}

<!-- Global sidebar -->
<nav class="global-sidebar" class:open={sidebarOpen} class:collapsed={sidebarCollapsed} class:sw-dragging={_swDragging} style:width={sidebarCollapsed ? null : `${sidebarWidth}px`} style:transform={_swDragging ? `translateX(calc(-100% + ${_swDragX}px))` : null} style:transition={resizing ? 'none' : null}>
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
					<span class="msi msi-18" class:msi-fill={isActive}>{item.iconName}</span>
					<span class="nav-label">{item.label}</span>
				</a>
			{/if}
		{/each}
	</div>

	<div class="sidebar-divider"></div>

	<div class="sidebar-scroll">
		{#if !_isMobile}{@render chatListContent()}{/if}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sidebar-resize-handle" onpointerdown={startResize} class:active={resizing}></div>
</nav>

<!-- Mobile hamburger -->
<button class="mobile-menu-btn" onclick={() => sidebarOpen = true} aria-label="Menu">
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>

<BottomNav isInstructor={data.currentUser?.role === 'instructor'} {totalUnread} />

<div class="app-shell" style:margin-left={sidebarCollapsed ? '52px' : `${sidebarWidth}px`} style:transition={resizing ? 'none' : null}>
	{#if isPagerActive}
		<!-- Native scroll-snap pager: one panel per tab section, swiping
		     between them is compositor-smooth and the real pages are live
		     under your finger. Panels lazy-mount (current ± 1, then cached);
		     far panels show a skeleton until reached. -->
		<div class="pager-track" bind:this={pagerEl} onscroll={onPagerScroll} onscrollend={onPagerScrollEnd} ontouchstart={onPagerTouchStart} ontouchmove={onPagerTouchMove} ontouchend={onPagerTouchEnd} ontouchcancel={onPagerTouchEnd}>
			{#each PANELS as panel, i (panel.route ?? 'conv')}
				<section class="pager-panel" class:current={i === pagerIndex} class:conv={panel.conv}>
					{#if panel.conv}
						<!-- Permanent panel 0. Renders the live conversation only while in
						     one; otherwise empty (you can't reach it — see the left-edge
						     clamp in onPagerScroll). -->
						{#if _onConvMobile}{@render children()}{/if}
					{:else if panel.chatMenu}
						<div class="chat-menu-panel" ontouchstart={onMenuTouchStart} ontouchend={onMenuTouchEnd}>
							<div class="chat-menu-title">{data.currentClass?.name ?? 'Chat'}</div>
							{@render chatListContent()}
						</div>
					{:else if panelShouldMount(i) && panelData[panel.route]}
						{@const C = panel.Comp}
						<C data={panelData[panel.route]} form={i === pagerIndex ? $page.form : undefined} />
					{:else}
						<div class="pager-skel">
							<div class="pk pk-title"></div>
							<div class="pk pk-line"></div>
							<div class="pk pk-line short"></div>
							<div class="pk pk-card"></div>
							<div class="pk pk-card"></div>
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{:else}
		{@render children()}
	{/if}
</div>

<!-- Slide-in chat menu — animates the conversation → menu swipe (the live
     pager menu takes over once the navigation lands underneath it). -->
{#if _menuOverlayMounted}
	<div class="menu-slide" class:dragging={_menuDragging} class:idle={!_menuSliding} bind:this={_menuSlideEl}>
		<!-- The standard (wordmark) header rides in with the menu, covering the
		     chat header, so the whole screen slides as one. -->
		<div class="ms-header">
			<span class="ms-wordmark">eating.computer</span>
			{#if data.currentClass?.name}<span class="ms-class">{data.currentClass.name}</span>{/if}
		</div>
		<div class="ms-scroll">
			<div class="chat-menu-panel">
				<div class="chat-menu-title">{data.currentClass?.name ?? 'Chat'}</div>
				{@render chatListContent()}
			</div>
		</div>
	</div>
{/if}

<!-- Instant placeholder while a tapped conversation loads. Covers the menu the
     moment you tap so the message window appears immediately; the real page
     paints over it the instant its data resolves. -->
{#if _showConvSkeleton}
	<ConvSkeleton slide />
{/if}

<!-- Global app header. Lives in the layout so it's identical on every
     /app/* page (Home, Atlas, Lab, Manage, Files, Chat, Theme, Profile)
     — wordmark + class switcher + theme switcher + user menu. Per-page
     AppHeader mounts were removed so this is the single source of
     truth; before this consolidation, some pages forgot to mount it
     and the theme picker / user menu silently disappeared on those
     routes. -->
<AppHeader currentClass={data.currentClass} allClasses={data.allClasses} user={data.currentUser ?? null} />

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
			background: var(--sidebar-bg);
			color: var(--sidebar-fg);
			overflow: hidden;
			z-index: 200;
			transition: width 0.2s ease;
		}
		.sidebar-resize-handle {
			position: absolute; top: 0; right: 0; bottom: 0; width: 4px;
			cursor: col-resize; z-index: 201;
			transition: background 0.15s;
		}
		.sidebar-resize-handle:hover, .sidebar-resize-handle.active {
			background: var(--sidebar-hover);
		}
		.global-sidebar.collapsed .sidebar-resize-handle { display: none; }
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
		font-family: 'Avara', serif;
		font-size: 0.9rem;
		color: var(--sidebar-fg);
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
		font-family: 'Avara', serif;
		font-size: 0.9rem;
		color: var(--sidebar-fg);
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
		color: var(--sidebar-fg-muted);
		cursor: pointer;
		padding: 0.3rem;
		border-radius: 5px;
		transition: color 0.1s, background 0.1s;
		flex-shrink: 0;
	}
	.collapse-btn:hover { color: var(--sidebar-fg); background: var(--sidebar-hover); }
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
		color: var(--sidebar-fg-muted);
		text-decoration: none;
		font-size: 0.55rem;
		font-weight: 500;
		transition: background 0.12s, color 0.12s;
		text-align: center;
	}
	.nav-item:hover { background: var(--sidebar-hover); color: var(--sidebar-fg); }
	.nav-item.active { background: var(--sidebar-active); color: var(--sidebar-active-fg); font-weight: 600; }

	.nav-label { text-transform: uppercase; letter-spacing: 0.04em; }

	/* ── Divider ── */
	.sidebar-divider {
		height: 1px;
		background: var(--sidebar-border);
		margin: 0.25rem 0.75rem;
		flex-shrink: 0;
	}

	/* ── Scroll area ── */
	.sidebar-scroll {
		flex: 1; overflow-y: auto; overflow-x: hidden;
		overscroll-behavior: none; scrollbar-width: none;
	}
	.sidebar-scroll::-webkit-scrollbar { display: none; }

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
		color: var(--sidebar-fg-muted);
	}

	.btn-icon {
		background: none; border: none; color: var(--sidebar-fg-muted);
		font-size: 1rem; cursor: pointer; line-height: 1; padding: 0;
		transition: color 0.1s;
	}
	.btn-icon:hover { color: var(--sidebar-fg); }

	.inline-input {
		display: flex; align-items: center; gap: 0.25rem;
		padding: 0.25rem 0.5rem; margin-bottom: 0.25rem;
	}
	.inline-input input {
		flex: 1; background: var(--sidebar-hover); border: 1px solid var(--sidebar-border); border-radius: 5px;
		color: var(--sidebar-fg); font-family: inherit; font-size: 0.82rem;
		padding: 0.3rem 0.4rem; outline: none;
	}
	.inline-input input:focus { border-color: var(--sidebar-fg-muted); }
	.inline-error { font-size: 0.7rem; color: #e57373; }

	.hash { opacity: 0.5; font-size: 0.95rem; flex-shrink: 0; }

	.sidebar-item {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.28rem 0.6rem; border-radius: 5px;
		font-size: 0.875rem; color: var(--sidebar-fg-muted); text-decoration: none;
		transition: all 0.1s;
	}
	.sidebar-item:hover { background: var(--sidebar-hover); color: var(--sidebar-fg); }
	.sidebar-item.active { background: var(--sidebar-active); color: var(--sidebar-active-fg); }

	.item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* color: inherit so an active row's --sidebar-active-fg flows
	   through to bolded labels too, instead of getting overridden
	   back to the un-active sidebar-fg. */
	.item-name.bold { color: inherit; font-weight: 600; }

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

	/* ── Conversation rows (channels + members share one taller layout) ──
	   ~1.5× the old height: a 40px avatar + two lines (name + last message),
	   so every channel and DM is the same size with a bigger photo and a
	   preview of the most recent message. Same markup on desktop + mobile. */
	.conv-item {
		display: flex; align-items: center; gap: 0.6rem;
		padding: 0.4rem 0.55rem; border-radius: 9px; width: 100%;
		color: var(--sidebar-fg-muted); text-decoration: none;
		transition: background 0.1s; box-sizing: border-box;
	}
	.conv-item:hover { background: var(--sidebar-hover); color: var(--sidebar-fg); }
	.conv-item.active { background: var(--sidebar-active); color: var(--sidebar-active-fg); }
	/* On the selected row, let the active-fg flow through the name + preview
	   instead of their own explicit colours. */
	.conv-item.active .member-name,
	.conv-item.active .conv-last,
	.conv-item.active .last-sender,
	.conv-item.active .you-tag { color: inherit; }

	/* Channel "photo": a rounded-square tile with the # glyph, sized to match
	   the member avatars so channel rows are exactly as tall as DM rows. */
	.conv-avatar {
		width: 40px; height: 40px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		border-radius: 11px;
	}
	.channel-avatar {
		background: var(--sidebar-hover);
		color: var(--sidebar-fg-muted);
		font-size: 1.35rem; font-weight: 600; line-height: 1;
	}
	.conv-item.active .channel-avatar { color: var(--sidebar-active-fg); }

	/* ── Members ── */
	.member-row { border-radius: 9px; }
	.member-row.self { opacity: 0.8; }
	.member-row.self:hover { opacity: 1; }
	/* Drag-to-reorder affordance + feedback. */
	.member-row[draggable='true'] { cursor: grab; }
	.member-row[draggable='true']:active { cursor: grabbing; }
	.member-row.dragging { opacity: 0.4; }
	.member-row.dragging .conv-item { background: var(--sidebar-hover); }

	.avatar-wrap { position: relative; flex-shrink: 0; }
	.avatar {
		width: 40px; height: 40px; border-radius: 11px; background: #444; color: var(--sidebar-fg);
		font-size: 1rem; font-weight: 700; display: flex; align-items: center; justify-content: center;
	}
	.presence-dot {
		position: absolute; bottom: -1px; right: -1px;
		width: 11px; height: 11px; border-radius: 50%;
		background: #4caf50; border: 2px solid var(--sidebar-bg);
	}
	/* Idle = tab open, no input for ≥4 min. Amber is the standard
	   away signal across iMessage / Slack / Discord so the colour
	   reads as "they're around but not at the keyboard". */
	.presence-dot.idle { background: #ffc107; }

	.member-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
	.member-name { font-size: 0.9rem; font-weight: 500; color: var(--sidebar-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.member-name.bold { font-weight: 700; color: var(--sidebar-fg); }
	.you-tag { font-size: 0.68rem; color: var(--sidebar-fg-muted); font-weight: 400; margin-left: 0.2rem; }
	/* Last-message preview line (and the channel sender prefix). */
	.conv-last, .dm-last { font-size: 0.74rem; color: var(--sidebar-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.last-sender { font-weight: 600; color: var(--sidebar-fg); opacity: 0.85; }
	.conv-last-empty { opacity: 0.55; font-style: italic; }

	.role-badge {
		font-size: 0.6rem; font-weight: 600; background: #333; color: var(--sidebar-fg-muted);
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
			/* Full-screen drawer on mobile. !important beats the inline
			   `style:width={sidebarWidth}px` (the desktop resize width),
			   which would otherwise leak in and pin the drawer to ~220px. */
			width: 100vw !important;
			background: var(--sidebar-bg);
			color: var(--border);
			overflow-y: auto;
			overflow-x: hidden;
			overscroll-behavior: contain;
			z-index: 500;
			scrollbar-width: none;
			transform: translateX(-100%);
			transition: transform 0.22s ease;
		}
		.global-sidebar.open { transform: translateX(0); }
		/* While the finger is dragging the drawer, kill the transition so it
		   tracks 1:1 (the inline transform drives it). On release the class
		   removes and the transition animates the snap to open/closed. */
		.global-sidebar.sw-dragging { transition: none; }
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

	/* ── Global notification bell ── (now folded into AppHeader so
	   this class is unused; placeholder kept for clean diff history) */
	.global-bell {
		display: none;
	}
	@media (max-width: 640px) {
		.global-bell { display: none; }
	}

	/* ── App shell ── */
	/* `100dvh` tracks the visual viewport so app-shell never extends
	   past the bottom of what the user can see. With `100vh` (static
	   layout viewport) the shell is taller than the visible area
	   whenever the mobile URL bar is up — body grows to match, and
	   the chat layout inside (header + input bar) scrolls with the
	   page instead of staying anchored. */
	.app-shell { min-height: 100dvh; }
	/* Native scroll-snap pager — one panel per tab section. The browser's
	   compositor drives the swipe, so it's smooth regardless of page weight. */
	.pager-track {
		display: flex;
		width: 100%;
		/* Sit exactly below the (measured) fixed header and stop above the
		   bottom nav. --header-h is the real header height incl. its notch
		   padding; the app-shell already pads the notch inset, so the margin
		   only adds the rest. */
		margin-top: calc(var(--header-h, 52px) - var(--native-top-inset, 0px));
		/* FULL height (to the screen bottom). Section panels reserve the bottom
		   nav via their own padding; the conversation panel uses the whole thing
		   (its nav is hidden). This lets the conversation be a real pager panel. */
		height: calc(100dvh - var(--header-h, 52px));
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		/* Don't let the browser adjust the horizontal scroll position when a panel's
		   content changes (e.g. a conversation tearing down) — that anchoring is what
		   nudged the menu off its snap when leaving a DM. */
		overflow-anchor: none;
	}
	.pager-track::-webkit-scrollbar { display: none; }
	.pager-panel {
		flex: 0 0 100%;
		width: 100%;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-snap-align: start;
		scroll-snap-stop: always;
		scrollbar-width: none;
		overflow-anchor: none;
		/* Reserve the bottom nav strip (the section content stops above it). */
		padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
		box-sizing: border-box;
	}
	.pager-panel::-webkit-scrollbar { display: none; }
	/* The conversation panel uses the FULL height (nav hidden) and doesn't
	   scroll itself — the conversation's own .message-list scrolls internally. */
	.pager-panel.conv { padding-bottom: 0; overflow: hidden; }
	:global(.pager-panel.conv .chat-wrap) {
		height: 100% !important;
		margin-top: 0 !important;
	}
	/* Chat-menu panel (pager index 0) — wraps the shared conversation list. */
	.chat-menu-panel { padding: 0 0.25rem 1.5rem; }
	.chat-menu-title {
		font-family: 'Avara', serif;
		font-size: 1.15rem;
		color: var(--ink);
		padding: 0.75rem 0.75rem 0.4rem;
	}
	/* Slide-in menu overlay for the conversation → menu swipe. Covers the
	   content area (below header, above bottom nav) and slides in from the
	   right; the live pager menu is identical underneath, so the swap is
	   invisible once it lands. */
	.menu-slide {
		position: fixed;
		/* Covers the whole screen (incl. the header) so the standard header rides
		   in with the menu over the chat header. */
		top: 0;
		left: 0; right: 0;
		bottom: 0;
		background: var(--paper);
		/* Above the loading skeleton (z 1100) so swiping back is visible while a
		   conversation is still loading. */
		z-index: 1200;
		display: flex;
		flex-direction: column;
		/* Touches pass THROUGH the settling overlay to the live pager menu
		   underneath, so a quick second swipe scrolls the pager immediately. */
		pointer-events: none;
		/* Promote to its own GPU layer so dragging it (a heavy full-screen list)
		   is a composited transform, not a per-frame repaint. The drag position is
		   the `--md` custom property (0 = off-screen right … 1 = fully covering),
		   set imperatively during the drag so there's NO Svelte reactivity per
		   frame — the transform recalc + composite is all that runs, like the
		   native pager. */
		transform: translateX(calc((1 - var(--md, 0)) * 100%));
		will-change: transform;
		/* Transition only kicks in on release to animate to the snapped position.
		   Snappy so the hand-off to the pager is quick. */
		/* Match the pager's programmatic scroll exactly: 110ms ease-out cubic
		   (cubic-bezier(0.33,1,0.68,1)), so the conv→menu settle feels identical
		   to a menu→home tap/snap. */
		transition: transform 0.11s cubic-bezier(0.33, 1, 0.68, 1);
		box-shadow: -10px 0 28px rgba(0,0,0,0.16);
	}
	.menu-slide.dragging { transition: none; }
	/* Mounted but parked off-screen (ready for the swipe): no transition flash on
	   first paint, and hide the edge shadow that would otherwise peek in. */
	.menu-slide.idle { transition: none; box-shadow: none; }
	/* Header strip — matches the real header's measured height + padding so the
	   hand-off to the global header on land is seamless. */
	.ms-header {
		flex-shrink: 0;
		height: var(--header-h, 52px);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.1rem;
		padding: 0 1rem;
		padding-top: var(--native-top-inset, 0px);
		border-bottom: 1.5px solid var(--border);
		background: var(--paper);
	}
	.ms-wordmark { font-family: 'Avara', serif; font-size: 1.25rem; color: var(--ink); line-height: 1.1; }
	.ms-class { font-size: 0.72rem; color: var(--md-sys-color-on-surface-variant, var(--muted-fg)); }
	.ms-scroll { flex: 1; min-height: 0; overflow-y: auto; }
	/* Keep the list clear of the bottom strip the nav will rise into. */
	.menu-slide .chat-menu-panel { padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 0.5rem); }

	/* Skeleton shown for a panel until its section mounts. */
	.pager-skel {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.pager-skel .pk {
		border-radius: 10px;
		background: linear-gradient(90deg,
			color-mix(in srgb, var(--ink) 6%, transparent) 25%,
			color-mix(in srgb, var(--ink) 12%, transparent) 37%,
			color-mix(in srgb, var(--ink) 6%, transparent) 63%);
		background-size: 400% 100%;
		animation: pk-shimmer 1.3s ease-in-out infinite;
	}
	.pager-skel .pk-title { height: 2rem; width: 55%; }
	.pager-skel .pk-line { height: 1rem; width: 100%; }
	.pager-skel .pk-line.short { width: 70%; }
	.pager-skel .pk-card { height: 5.5rem; width: 100%; }
	@keyframes pk-shimmer {
		0% { background-position: 100% 0; }
		100% { background-position: 0 0; }
	}

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
		background: var(--sidebar-bg); color: var(--sidebar-fg);
		border: 1px solid var(--sidebar-border); border-radius: 10px;
		padding: 0.75rem 1rem; width: 260px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.35);
		pointer-events: all; cursor: pointer; text-decoration: none;
		display: block; animation: slide-in 0.2s ease;
	}
	.toast:hover { border-color: var(--sidebar-fg-muted); }
	.toast-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem; }
	.toast-title { font-size: 0.82rem; font-weight: 700; color: var(--sidebar-fg); }
	.toast-close {
		background: none; border: none; color: var(--sidebar-fg-muted); font-size: 1rem;
		cursor: pointer; line-height: 1; padding: 0; margin-left: 0.5rem;
	}
	.toast-close:hover { color: var(--sidebar-fg); }
	.toast-body { margin: 0; font-size: 0.78rem; color: var(--sidebar-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	@keyframes slide-in {
		from { opacity: 0; transform: translateY(8px); }
		to   { opacity: 1; transform: translateY(0); }
	}

	/* ── Install banner ── */
	.install-banner {
		position: fixed; bottom: 1.25rem; left: 50%;
		transform: translateX(-50%);
		width: calc(100% - 2.5rem); max-width: 480px;
		background: var(--sidebar-bg); color: var(--sidebar-fg);
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
		background: none; border: none; color: var(--sidebar-fg);
		opacity: 0.6; font-size: 1.2rem; cursor: pointer; padding: 0 0.2rem; line-height: 1;
	}
	.btn-dismiss:hover { opacity: 1; }

	@media (max-width: 640px) {
		.app-shell { margin-left: 0 !important; }
		.install-banner { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 0.75rem); }

		/* Mobile in-app notifications: a single full-width bar across the
		   screen, dropped just below the app header (so the fixed top bar
		   never covers it), with centered, slightly larger, higher-emphasis
		   text. Stacks downward if more than one arrives. */
		.toast-stack {
			top: calc(var(--header-h, 52px) + 0.4rem);
			left: 0; right: 0;
			align-items: stretch;
			gap: 0.4rem;
			padding: 0 0.5rem;
		}
		.toast {
			width: auto;
			padding: 0.85rem 1rem;
			border-radius: 14px;
			text-align: center;
			box-shadow: 0 6px 24px rgba(0,0,0,0.28);
		}
		.toast-header { justify-content: center; margin-bottom: 0.2rem; position: relative; }
		.toast-title { font-size: 0.98rem; font-weight: 800; letter-spacing: 0.01em; }
		.toast-close {
			position: absolute; right: 0; top: 50%; transform: translateY(-50%);
			font-size: 1.15rem;
		}
		.toast-body { font-size: 0.9rem; white-space: normal; }
	}
</style>
