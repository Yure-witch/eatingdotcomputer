<script>
	/**
	 * Unified expression picker — single popover with one tab per
	 * inserter: Emoji, Kitchen, GIFs, Emotes, Animated, Reactions.
	 *
	 * Replaces the row of 5 separate buttons + popovers in chat compose.
	 * The chat page mounts one `<ExpressionPicker>` and passes every
	 * insertion callback through.
	 */
	import EmojiPicker from './EmojiPicker.svelte';
	import EmojiKitchen from './EmojiKitchen.svelte';
	import CustomEmojiPanel from './CustomEmojiPanel.svelte';
	import TelegramEmojiPanel from './TelegramEmojiPanel.svelte';
	import PickerStickyBtn from './PickerStickyBtn.svelte';
	import SpriteSticker from './SpriteSticker.svelte';
	import { onMount, untrack } from 'svelte';
	import { isTgHidden } from '$lib/tg-visibility.js';
	import {
		loadTelegramEmoji, loadCustomPacks, getCachedTgEmoji, getCachedCustomPacks,
		engineMode, setEngineManual, rasterEngineFor
	} from '$lib/telegram-emoji-store.js';
	import { getExprRecents, addExprRecent, exprRecentKey } from '$lib/expr-recents.js';
	import { getCustomEmojiMap, getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import { ekTokenToUrl } from '$lib/message-render.js';
	import { onScrollGesture } from '$lib/scroll-bus.js';

	// Per-user switch (users.hide_tg_emoji): drop the Telegram surfaces —
	// the Animated tab and the Emotes Library sub-tab.
	const tgHidden = isTgHidden();

	// Load the Telegram / custom packs HERE rather than relying on the caller.
	// /app/+layout.svelte kicks these off, so the picker worked in chat — but the
	// avatar picker also mounts under /onboarding, which has its own layout and
	// never loaded them, so the Animated and Library surfaces rendered empty. A
	// shared component shouldn't depend on which layout happens to host it.
	// Both are cached and no-op on a second call.
	let _packVer = $state(0);
	onMount(() => {
		loadUploads();
		if (!tgHidden) {
			if (!getCachedTgEmoji()) loadTelegramEmoji().then(() => _packVer++).catch(() => {});
			if (!getCachedCustomPacks()) loadCustomPacks().then(() => _packVer++).catch(() => {});
		}
		// The class's uploaded emotes resolve [ce:…] tokens. Same story as the
		// packs above: only /app/+layout.svelte loaded this, so a [ce:] avatar
		// picked during onboarding had nothing to render against.
		// NOT gated on tgHidden — class uploads have nothing to do with whether
		// the Telegram surfaces are shown.
		if (!Object.keys(getCachedCustomEmojiMap()).length) {
			getCustomEmojiMap().then(() => _packVer++).catch(() => {});
		}
		return () => {
			clearTimeout(_settleT);
			// The picker is the heaviest consumer of the emote renderer: it's
			// the only surface that puts hundreds of distinct stickers on
			// screen. Closing it is the best moment to give the atlases for
			// its pixel sizes back. Only sizes with NO live cell anywhere are
			// dropped, so emotes still on screen in the chat keep theirs.
			import('$lib/skottie-stage-worker.js')
				.then((m) => m.reclaimMemory?.())
				.catch(() => {});
		};
	});

	let {
		onSelectEmoji,        // (emoji: string) → from EmojiPicker
		onInsertKitchen,      // (svgUrl: string) → from EmojiKitchen
		onSelectGif,          // (gif: object) → from GifPicker
		onInsertCustomEmoji,  // (emoji: object) → from CustomEmojiPanel
		onInsertReaction,     // (reaction: object) → from CustomEmojiPanel
		onInsertTgEmoji,      // (sticker: object) → from TelegramEmojiPanel
		isInstructor = false,
		// `mode` controls which surface the picker renders:
		//   'compose' (default) — full 6-tab picker for chat compose and
		//                         assignment-form text fields. Every
		//                         callback fires; consumer wires what
		//                         it cares about.
		//   'react'             — compact emoji-only view for message
		//                         reactions. No tab strip; the picker
		//                         is just the bare EmojiPicker so the
		//                         reaction-pick UX stays focused while
		//                         still sharing the same `emoji-recent`
		//                         localStorage that compose mode uses.
		mode = 'compose',
		// `inline` hides surfaces that don't make sense outside of a
		// real chat compose: Giphy GIFs (always full-size attachment-
		// style) and reaction images (the big "react sticker" gallery).
		// Used by FormattedInput when the picker is embedded inside a
		// formatted text field — assignments, notes, etc. — where you
		// just want emoji + emotes + animated stickers, not GIF
		// uploads or reaction-image attachments. Default `false` so
		// chat usage is unchanged.
		inline = false,
		// Optional close handler — when provided, a ✕ button is pinned to the
		// top-left corner of the panel (visible in every category).
		onClose = null,
		// Optional backspace handler — when provided, a ⌫ button sits at the
		// bottom-right of the (bottom) category strip and deletes the last
		// character / emote in the compose. Used by the docked mobile picker.
		onBackspace = null,
		// Avatar picker opts out: the saved tab is shared with the chat picker.
		rememberTab = true
	} = $props();

	// Top-level tab. Persisted so reopening the picker lands on the
	// last category the user was using. In inline mode the GIFs and
	// Reactions tabs are hidden — if the persisted choice was one of
	// those, fall back to emoji so the picker doesn't open on an
	// invisible tab.
	const TAB_KEY = 'exprTab';
	// GIFs + reaction images now live in their own MediaPicker, so this picker
	// only has emoji / kitchen / emotes / animated. A stale saved 'gifs' or
	// 'reactions' falls back to emoji.
	// The App Store review account (users.hide_tg_emoji) drops the third-party
	// surfaces — Telegram animated emotes AND Emoji Kitchen (Google mashups).
	// 'animated' and 'emotes' used to be separate tabs — animated Telegram packs
	// in one, uploads + static packs in the other. They're one 'emotes' tab now
	// (every pack, animated and static, plus the class's uploads, in a single
	// ordered flow), so a saved 'animated' migrates onto it.
	const VALID_TABS = new Set(['recent', 'emoji', 'emotes', ...(tgHidden ? [] : ['kitchen'])]);
	// `rememberTab` false (the avatar picker) always opens on plain emoji: the
	// saved tab is shared with the chat picker, so picking an avatar would drop
	// you into whatever surface you last used mid-conversation — usually the
	// animated emotes — which is a strange place to start choosing a face.
	const _saved = rememberTab && typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
	let tab = $state(_saved === 'animated' ? 'emotes' : (VALID_TABS.has(_saved) ? _saved : 'emoji'));
	// Debounced: a swipe walks `tab` through every category it crosses, and a
	// synchronous localStorage write per crossing is main-thread work landing
	// squarely inside the gesture.
	let _tabSaveT = null;
	$effect(() => {
		if (!rememberTab) return;
		const t = tab;
		clearTimeout(_tabSaveT);
		_tabSaveT = setTimeout(() => {
			try { localStorage.setItem(TAB_KEY, t); } catch {}
		}, 250);
	});

	// The Recent tab is meaningless until something has been picked — an empty
	// tab as the first thing in the row reads as broken.
	let hasRecents = $state(false);
	$effect(() => {
		try { hasRecents = getExprRecents().filter((it) => it.t !== 'tg' || !tgHidden).length > 0; }
		catch { hasRecents = false; }
	});

	// ── Horizontal pager ─────────────────────────────────────────────
	// The categories are panes in ONE native scroll-snap track, the same
	// mechanism the app shell uses for its bottom-nav sections. The
	// compositor drives the swipe, so paging between Emoji and Animated
	// stays smooth even while a pane is busy decoding sticker frames —
	// which a JS-driven transition never manages on a slow phone.
	const TABS = $derived([
		...(hasRecents ? ['recent'] : []),
		'emoji',
		'emotes',
		...(tgHidden ? [] : ['kitchen'])
	]);
	const tabIndex = $derived(Math.max(0, TABS.indexOf(tab)));

	let trackEl = $state(null);
	let railEl = $state(null);
	let indEl = $state(null);
	// Slot pitch in px, measured once per layout. The indicator's transform is
	// written in px rather than through a custom property (see setFrac).
	let _slotPx = 0;
	let _slotW = 48;
	function setFrac(f) {
		if (!indEl) return;
		if (!_slotPx) {
			// PITCH, not slot width: the row is a flex box with a gap, so the nth
			// icon sits at n * (width + gap). Stepping by offsetWidth alone drifts
			// one gap per tab — nothing at the first icon, 9.6px by the fourth on
			// mobile, where the gap is 0.2rem — which puts the circle visibly left
			// of the last icon.
			const first = railEl?.querySelector('.expr-tab');
			const gap = parseFloat(getComputedStyle(railEl).columnGap) || 0;
			_slotW = first?.offsetWidth || 48;
			_slotPx = _slotW + gap;
		}
		// Written DIRECTLY as a transform, not via a --expr-frac custom property.
		// An unregistered custom property is inherited, so setting it on the rail
		// invalidated style for the rail and every descendant — four buttons and
		// their icon spans — on every frame of a swipe. And a transform built
		// from calc(var(…)) can never be a compositor animation; it re-resolves
		// on the main thread each frame. A plain px transform on one element is
		// neither.
		// -50% on Y is not decoration: the CSS parks this at `top: 50%` and relies
		// on the transform to pull it back half its own height. Writing 0 here
		// dropped the circle a full 24px below the icons.
		// The X correction centres the fixed-width circle on a slot that may
		// have SHRUNK below it (narrow containers squeeze the slots; the circle
		// keeps its 48px so it can keep hugging the pill's height). Zero when
		// the slot is full-size.
		const centre = (_slotW - (indEl.offsetWidth || _slotW)) / 2;
		indEl.style.transform = `translate3d(${f * _slotPx + centre}px,-50%,0)`;
	}

	// Panes mount lazily and then STAY mounted. Tearing a pane down on
	// every tab change is what made switching categories feel slow: each
	// return trip re-ran the panel's onMount, re-read its localStorage and
	// rebuilt its grid from scratch. Keeping them alive trades a little
	// memory for tab switches that cost nothing.
	let mounted = $state({ [tab]: true });
	function ensure(id) {
		if (id && !mounted[id]) mounted = { ...mounted, [id]: true };
	}

	// Neighbours mount just AFTER the open has painted, one per frame — not
	// up front (which would put their cost on the open you're waiting for)
	// and not on requestIdleCallback either, which was the earlier approach
	// and the reason swiping felt broken: on a busy main thread idle may not
	// run before you swipe, so the incoming category was still empty and had
	// to mount mid-gesture. Paying for it a couple of frames after open means
	// the pane next door is already there when the gesture starts.
	let _neighbourRaf = 0;
	function scheduleNeighbours() {
		if (_neighbourRaf) return;
		// EVERY pane, not just the two either side. Pre-mounting only the
		// neighbours meant a fast swipe across two panes mounted a whole
		// TelegramEmojiPanel synchronously mid-drag — and with
		// `content-visibility: auto` on the panes, entering a skipped one makes
		// the browser render that entire subtree in a single frame. There are
		// only three or four, they're kept alive once mounted, and one per frame
		// starting after the open has painted keeps any single frame small.
		_neighbourRaf = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				_neighbourRaf = 0;
				// Nearest-first, so the ones a swipe reaches soonest are ready
				// soonest.
				const order = [...TABS].sort(
					(a, b) => Math.abs(TABS.indexOf(a) - tabIndex) - Math.abs(TABS.indexOf(b) - tabIndex)
				);
				const step = (i) => {
					if (i >= order.length) return;
					ensure(order[i]);
					requestAnimationFrame(() => step(i + 1));
				};
				step(0);
			});
		});
	}

	// Guard so our own scrollTo() doesn't feed back through onscroll and
	// fight the user's tab choice mid-animation.
	let _progScroll = false;
	let _progT = null;
	function goTo(id, smooth = true) {
		tab = id;
		ensure(id);
		const el = trackEl;
		if (!el) return;
		// A tab tap can't land mid-swipe, but a stray programmatic call could;
		// writing scrollLeft while the compositor is animating is a visible jerk.
		if (_touching) return;
		const i = TABS.indexOf(id);
		if (i < 0) return;
		const left = i * el.clientWidth;
		if (Math.abs(el.scrollLeft - left) < 1) return;
		_progScroll = true;
		clearTimeout(_progT);
		// `smooth` only when the user tapped a tab; a silent re-align (after
		// the tab list changes shape) must not animate.
		el.scrollTo({ left, behavior: smooth ? 'smooth' : 'instant' });
		_progT = setTimeout(() => { _progScroll = false; }, smooth ? 420 : 0);
	}

	// True from touchstart until the scroll settles. Anything that would
	// move the track has to check this first — the compositor owns the
	// scroll position during a gesture and any write to it is a visible jerk.
	let _touching = $state(false);
	let _settleT = null;
	// True while a scroll is in flight from ANY input — touch, wheel or
	// trackpad. `_touching` only ever covered touch, so on a trackpad the
	// scroll handler wrote the live fraction every frame while the tab effect
	// wrote the snapped integer, and the indicator jumped between the two.
	let _scrolling = false;
	function settleSoon() {
		clearTimeout(_settleT);
		_settleT = setTimeout(() => { _touching = false; _scrolling = false; }, 260);
		endPaging();
	}

	// Marks the touch, but does NOT enter the paging state: this fires on any
	// pointerdown inside the picker — a vertical grid scroll, a tap to insert an
	// emoji — and paging used to flip on all of them. Paging is entered from the
	// scroll handler instead, so it only happens when the track actually moves.
	function onTrackPointerDown() { _touching = true; }
	function onTrackPointerUp() {
		// Don't clear immediately: the fling continues after the finger lifts,
		// and the track is still settling toward a snap point.
		settleSoon();
	}

	// Scroll -> active tab. Read in a rAF so a fling doesn't run layout
	// reads on every scroll event.
	let _rafScroll = 0;
	function onTrackScroll() {
		// Everything here is per-FRAME, not per-event. This handler fires
		// ~100-200 times a second during a fling, and settleSoon() alone is two
		// clearTimeout/setTimeout pairs each time.
		if (_rafScroll) return;
		_rafScroll = requestAnimationFrame(() => {
			_rafScroll = 0;
			_scrolling = true;
			if (chrome !== 'page') setChrome('page');
			settleSoon();
			const el = trackEl;
			if (!el || !el.clientWidth) return;
			const f = el.scrollLeft / el.clientWidth;
			// Straight to the element, NOT through $state: this runs every frame
			// of a swipe and a Svelte flush here would make the block trail the
			// finger. Same trick the bottom nav's --nav-frac uses.
			setFrac(f);
			// Mount whatever the gesture is heading toward before it lands, so
			// the incoming category slides in with content rather than as a
			// blank panel that pops once the swipe finishes.
			ensure(TABS[Math.floor(f)]);
			ensure(TABS[Math.ceil(f)]);
			if (_progScroll) return;
			const id = TABS[Math.round(f)];
			if (id && id !== tab) tab = id;
		});
	}

	// Re-align the track when the pane LIST CHANGES SHAPE — picking the
	// first-ever recent inserts a pane at index 0, which would otherwise
	// silently shift every pane one slot to the right.
	//
	// It must key off the shape and nothing else. An earlier version also
	// depended on `tabIndex`, which the scroll handler updates *mid-swipe*:
	// the moment a drag crossed the halfway point the effect re-ran, found
	// scrollLeft mid-gesture, and issued an instant scrollTo that yanked the
	// track out from under the finger. That single line is why paging never
	// felt like the app shell's pager.
	// Put the track (and the indicator) on `tab`, without animating.
	function alignToTab() {
		const el = trackEl;
		if (!el || !el.clientWidth) return false;
		const i = Math.max(0, TABS.indexOf(untrack(() => tab)));
		el.scrollLeft = i * el.clientWidth;
		setFrac(i);
		return true;
	}

	// Retried across frames rather than done once in an effect. The effect
	// version read clientWidth while the sheet was still animating in, got 0,
	// bailed — and because nothing it depended on changed afterwards, it never
	// ran again. Opening on a remembered tab therefore left the strip
	// highlighting that tab while the track still showed pane 0, with the
	// indicator parked on the wrong icon.
	onMount(() => {
		// Re-aligned a few times over the first half-second, not just once. The
		// panes mount their contents lazily and the sheet animates in, so the
		// track's layout keeps changing underneath us; a single early write got
		// undone and left the strip highlighting a tab the track wasn't on.
		const timers = [];
		let raf = requestAnimationFrame(() => { alignToTab(); });
		for (const d of [80, 200, 450]) timers.push(setTimeout(alignToTab, d));
		return () => { cancelAnimationFrame(raf); for (const t of timers) clearTimeout(t); };
	});

	let _shape = null;
	$effect(() => {
		const shape = TABS.join('|');
		const el = trackEl;
		if (!el || !el.clientWidth) return;
		if (shape === _shape) return;
		const first = _shape === null;
		_shape = shape;
		// Never fight an in-flight gesture; the shape can only change from a
		// pick, and picking is not something you do mid-swipe.
		if (!first && _touching) return;
		alignToTab();
	});

	$effect(() => { ensure(tab); scheduleNeighbours(); });

	// Park the indicator on the active tab whenever a gesture ISN'T driving it.
	// Seeding it once during the initial align wasn't enough: that runs before
	// `railEl` is necessarily bound, so opening on a remembered tab left the
	// block on slot 0 while the content showed slot 2. During a swipe the
	// scroll handler owns --expr-frac and this stays out of the way.
	$effect(() => {
		const i = tabIndex;
		if (_touching || _scrolling || _progScroll) return;
		setFrac(i);
	});

	// (The Emotes tab used to keep an Uploaded/Library sub-tab here. Both
	// sources now render in one scroll — see the merged TelegramEmojiPanel
	// below — so there is no sub-selection left to remember.)

	// Reactions tab only handles reactions; pass a no-op for emoji
	// insertion. CustomEmojiPanel hides the unused side via `mode`.
	const _noop = () => {};

	// ── Chrome state ─────────────────────────────────────────────────
	// The category strip and the close button react to what you're doing:
	//   'rest' — default, and what an insert returns you to. Full opacity.
	//   'dim'  — you're scrolling DOWN through a category's contents, so the
	//            chrome gets out of the way: 30% and smaller.
	//   'page' — you're swiping BETWEEN categories, which is when the strip is
	//            the thing you're actually using: full opacity and larger.
	// Scrolling back up returns to 'rest'. An insert also returns to 'rest',
	// and because 'dim' is only ever entered by a downward scroll, the chrome
	// then stays opaque until you scroll down again — which is the "if I've
	// just input something it should stay opaque" behaviour.
	let chrome = $state('rest');
	let _chromeT = null;
	// Accumulated gesture travel — see the scroll subscription below for why
	// the chrome commits at a threshold instead of on every sample.
	const UP_PX = 20;    // scroll back up this far and the chrome returns
	const DOWN_PX = 12;  // and this far down before it gets out of the way
	let _accUp = 0;
	let _accDown = 0;
	function setChrome(next) {
		clearTimeout(_chromeT);
		chrome = next;
		// Whoever set the state wins outright; any part-accumulated travel
		// toward the other one is stale now.
		_accUp = 0;
		_accDown = 0;
	}
	// Paging is transient: once the swipe settles, fall back to rest.
	function endPaging() {
		clearTimeout(_chromeT);
		_chromeT = setTimeout(() => { if (chrome === 'page') chrome = 'rest'; }, 260);
	}

	// Direction comes from the INPUT, not from scrollTop.
	//
	// Reading scrollTop deltas looked obvious and was wrong: the grid's
	// virtualization nudges the position as rows mount, so the last event of a
	// gesture is a small correction the OTHER way — a downward flick settled
	// 400 -> 393, an upward one 93 -> 99. Reacting to that inverted the state
	// every time. Wheel and touch deltas are what the user actually did, and no
	// programmatic scroll can forge them.
	// Scrolling used to freeze every emote outright and thaw 220ms after it
	// settled. The theory was that a scroll and a grid of looping cells are
	// after the same frames — but that was written when the cells were
	// main-thread rAF loops. They render in a worker now, so they aren't
	// competing for the frames the scroll needs, and all the freeze bought was
	// the animations visibly stopping and restarting every time the list moved.
	// Scrolling leaves the emotes alone.

	// Direction arrives from the shared scroll bus rather than this component
	// attaching its own wheel + touchstart + touchmove. Three listeners became
	// one subscription — see $lib/scroll-bus.js.
	// Hysteresis, because a drag is never monotonic.
	//
	// The bus samples every 2px, and this used to flip state on each sample:
	// one 'down' dimmed, one 'up' restored. Dimming that way is fine — you only
	// ever get there by deliberately scrolling down. Restoring is not, because
	// an upward drag still emits the occasional downward sample as the finger
	// wavers, and each one slammed the chrome back to 50% mid-gesture. The
	// chrome therefore looked reluctant to come back precisely when it was
	// being asked to.
	//
	// So accumulate in the current direction and commit at a threshold, keeping
	// the two sides asymmetric: dimming needs a deliberate push, and coming
	// back is the cheaper move because it is the one the user is waiting on.
	onMount(() => onScrollGesture((dir, dy = 0) => {
		if (chrome === 'page') return;         // a swipe owns the chrome
		const px = Math.abs(dy) || 2;
		if (dir === 'up') {
			// A sample the other way doesn't cancel progress outright, it just
			// bleeds it — otherwise a single jittery frame resets the count and
			// the threshold is never reached during a genuine drag.
			_accDown = Math.max(0, _accDown - px);
			_accUp += px;
			if (_accUp >= UP_PX && chrome !== 'rest') { setChrome('rest'); _accUp = 0; }
		} else {
			_accUp = Math.max(0, _accUp - px);
			_accDown += px;
			if (_accDown >= DOWN_PX && chrome !== 'dim') { setChrome('dim'); _accDown = 0; }
		}
	}));

	// ── Drag-to-dismiss ──────────────────────────────────────────────
	// On mobile the picker is a docked sheet, so it should dismiss the way
	// every other sheet on the phone does: grab the top and throw it down.
	// The gesture lives on the grabber strip rather than the whole panel —
	// the surface right below it is the emoji search / category row, and a
	// drag that started there would eat those taps.
	//
	// The panel translates directly (no reactive layout), so the drag stays
	// on the compositor and tracks the finger even while a pane is busy.
	let panelEl = $state(null);
	let dragY = $state(0);
	let dragging = $state(false);
	let _dragId = null, _y0 = 0, _t0 = 0, _lastY = 0, _lastT = 0;
	// Commit if the sheet was pulled far enough OR flicked hard enough — a
	// short fast flick reads as "dismiss" even though it barely moved.
	const DISMISS_PX = 64;
	const DISMISS_VELOCITY = 0.45; // px/ms

	function dragStart(e) {
		if (!onClose) return;
		_dragId = e.pointerId;
		_y0 = _lastY = e.clientY;
		_t0 = _lastT = e.timeStamp;
		dragging = true;
		try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
	}
	function dragMove(e) {
		if (!dragging || e.pointerId !== _dragId) return;
		_lastY = e.clientY;
		_lastT = e.timeStamp;
		// Downward only; dragging up shouldn't lift the sheet off its dock.
		dragY = Math.max(0, e.clientY - _y0);
	}
	function dragEnd(e) {
		if (!dragging || e.pointerId !== _dragId) return;
		dragging = false;
		_dragId = null;
		const dy = Math.max(0, _lastY - _y0);
		const v = dy / Math.max(1, _lastT - _t0);
		if (dy > DISMISS_PX || v > DISMISS_VELOCITY) {
			// Throw it the rest of the way out, THEN tell the parent — closing
			// on the spot would make the sheet vanish mid-gesture.
			dragY = panelEl?.offsetHeight || 480;
			setTimeout(() => { onClose?.(); dragY = 0; }, 170);
		} else {
			dragY = 0; // transition springs it back to the dock
		}
	}

	// ── Class uploads (merged into the Emotes flow) ──────────────────
	// Uploaded emotes and the static library used to be two views behind an
	// Uploaded/Library switch. They're one scroll now — uploads first, then the
	// packs — so the switch is gone and TelegramEmojiPanel renders both.
	let uploads = $state([]);
	let showUpload = $state(false);
	async function loadUploads() {
		try {
			const r = await fetch('/api/custom-emoji', { cache: 'no-store' });
			if (!r.ok) return;
			// The endpoint returns a bare array of { id, shortcode, url, tags } —
			// same shape CustomEmojiPanel reads.
			const d = await r.json();
			uploads = Array.isArray(d) ? d.filter((e) => e && e.url) : [];
		} catch { /* leave the section empty */ }
	}
	async function deleteUpload(id) {
		const prev = uploads;
		uploads = uploads.filter((u) => u.id !== id); // optimistic
		try {
			const r = await fetch('/api/custom-emoji', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!r.ok) uploads = prev;
		} catch { uploads = prev; }
	}

	// ── Shared recents ───────────────────────────────────────────────
	// Every insert routes through these wrappers so the Recent tab sees
	// all expression types from all surfaces. Recents replay through the
	// same wrappers, which also bumps them back to the front.
	function fireEmoji(e) {
		setChrome('rest');
		// stamp the font mode the emoji is being sent in, so the Recent tab
		// renders it the same way (re-sending refreshes the stamp)
		let f = 'noto';
		try { f = localStorage.getItem('emoji-font') || 'noto'; } catch { /* default */ }
		addExprRecent({ t: 'emoji', v: e, f });
		onSelectEmoji?.(e);
	}
	function fireKitchen(tok) {
		setChrome('rest'); addExprRecent({ t: 'ek', v: tok }); onInsertKitchen?.(tok); }
	function fireCe(em) {
		setChrome('rest');
		if (em?.shortcode) addExprRecent({ t: 'ce', v: { shortcode: em.shortcode, url: em.url } });
		onInsertCustomEmoji?.(em);
	}
	function fireTg(it) {
		setChrome('rest');
		addExprRecent({ t: 'tg', v: { custom: !!it.custom, mode: it.mode, alt: it.alt, short: it.short, id: it.id, cp: it.cp } });
		onInsertTgEmoji?.(it);
	}
	function fireRecent(it) {
		if (it.t === 'emoji') fireEmoji(it.v);
		else if (it.t === 'ek') fireKitchen(it.v);
		else if (it.t === 'ce') fireCe(it.v);
		else if (it.t === 'tg') fireTg(it.v);
	}
	// Kitchen recents may be [ek:] tokens (chat) — render via the sprite URL.
	function ekThumb(tok) {
		const m = /\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/i.exec(tok);
		return m ? ekTokenToUrl(m[1], m[2], m[3]) : tok;
	}
	let recents = $state([]);
	let recentGridEl = $state(null);
	$effect(() => {
		if (tab === 'recent') recents = getExprRecents().filter((it) => it.t !== 'tg' || !tgHidden);
	});
	// Recent is a mixed grid of up to 40 cells that you drop into for a second
	// and leave — the worst possible shape for a LIVE engine, which would spin
	// up a render context per emote on arrival. It always renders on a
	// RASTERIZED engine (baked atlas, still moving): the selected one if that's
	// already rasterized, otherwise this device's rasterized default.
	const recentEngine = $derived(rasterEngineFor($engineMode));
	// Same control as the Emotes tab's, but it only offers the two rasterized
	// engines — so what the bar reports is always what Recent is actually
	// rendering on, and cycling from here can't drop the app onto a live
	// engine it would then ignore.
	function cycleRecentEngine() {
		setEngineManual(recentEngine === 'webgpu-rasterized' ? 'cpu-rasterized' : 'webgpu-rasterized');
	}
	// A saved 'recent' tab with nothing in it would leave no tab highlighted.
	$effect(() => {
		if (tab === 'recent' && !hasRecents) tab = 'emoji';
	});
</script>

<div class="expr-panel"
     class:expr-panel-react={mode === 'react'} class:expr-dragging={dragging}
     bind:this={panelEl} style:transform={dragY ? `translate3d(0,${dragY}px,0)` : null}>
	{#if mode === 'react'}
		<!-- Reaction mode: just the EmojiPicker, no chrome. The chat
		     pages used to mount a bare EmojiPicker for this; routing
		     through ExpressionPicker means recents + skin-tone +
		     popular-tab state are shared with the compose picker (via
		     EmojiPicker's own localStorage keys). -->
		<EmojiPicker onSelect={fireEmoji} {onClose} />
	{:else}
		{#if onClose}
			<!-- Drag handle. Mobile-only (the desktop popover isn't a sheet);
			     `touch-action: none` so the browser hands us the vertical
			     gesture instead of trying to scroll something with it. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="expr-grab" onpointerdown={dragStart} onpointermove={dragMove}
			     onpointerup={dragEnd} onpointercancel={dragEnd}>
				<span class="expr-grab-pill"></span>
			</div>
		{/if}
		<!-- One row owns the bottom chrome. The rail and the delete key used to be
		     independently absolutely-positioned at opposite edges, which is a
		     collision course: in any container narrower than ~300px (thread
		     panel, popovers) the opaque key slid OVER the rail's last slot and
		     cut the kitchen icon in half. As flex siblings they can never
		     overlap — the rail shrinks its slots instead (min-width below), and
		     the indicator's pitch is measured from the real laid-out slot, so it
		     stays centred at any width. -->
		<div class="expr-chrome-row">
		<nav class="expr-tabs" aria-label="Expression categories"
			bind:this={railEl}
			style:--expr-slots={TABS.length}
			class:chrome-dim={chrome === 'dim'}>
			<!-- One block that GLIDES with the live scroll fraction, rather than a
			     per-tab background snapping on and off — so it's visibly halfway
			     between two icons when your swipe is. Copied from the bottom
			     nav's .nav-indicator. No transition: it follows --expr-frac
			     every frame, and a transition would make it lag the finger. -->
			<span class="expr-indicator" bind:this={indEl} aria-hidden="true"></span>
		{#if hasRecents}
		<button class="expr-tab" class:active={tab === 'recent'} onclick={() => goTo('recent')} title="Recently used">
			<span class="msi msi-20" class:msi-fill={tab === 'recent'}>history</span>
		</button>
		{/if}
		<!-- Order: emoji, telegram (animated), emoji kitchen, custom emotes -->
		<button class="expr-tab" class:active={tab === 'emoji'} onclick={() => goTo('emoji')} title="Emoji">
			<span class="msi msi-20" class:msi-fill={tab === 'emoji'}>mood</span>
		</button>
		<button class="expr-tab" class:active={tab === 'emotes'} onclick={() => goTo('emotes')} title="Custom emotes">
			<span class="msi msi-20" class:msi-fill={tab === 'emotes'}>animated_images</span>
		</button>
		{#if !tgHidden}
			<button class="expr-tab" class:active={tab === 'kitchen'} onclick={() => goTo('kitchen')} title="Emoji Kitchen">
				<span class="msi msi-20" class:msi-fill={tab === 'kitchen'}>blender</span>
			</button>
		{/if}
	</nav>

	{#if onBackspace}
		<!-- Its own surface, but lined up with the rail: same bottom edge, same
		     height, immediately to its right — grouped with the icons
		     positionally without sharing their container. Squarer corners than
		     the fully-rounded rail so it reads as a distinct control rather than
		     a tab that escaped the pill. -->
		<button type="button" class="expr-del"
			class:chrome-dim={chrome === 'dim'}
			title="Delete" aria-label="Delete"
			onmousedown={(e) => { e.preventDefault(); onBackspace(); }}>
			<span class="msi msi-20">backspace</span>
		</button>
	{/if}
	</div>
	<!-- One pane per category in a native horizontal scroll-snap track:
	     swiping sideways pages between expression types exactly like the
	     app shell's section pager. Every pane is always present so the
	     track geometry is stable; only its CONTENTS mount lazily. -->
	<div class="expr-track" bind:this={trackEl} onscroll={onTrackScroll}
	     onpointerdown={onTrackPointerDown} onpointerup={onTrackPointerUp}
	     onpointercancel={onTrackPointerUp}>
		{#each TABS as t (t)}
			<section class="expr-pane" aria-hidden={t !== tab}>
				{#if mounted[t]}
					{#if t === 'recent'}
						<!-- Recent's own top bar, matching the Emoji / Emotes tabs':
						     close on the left, then the render-engine readout so the
						     engine this grid is on is visible (and switchable) from
						     the tab it matters most on. -->
						<div class="expr-recent-bar">
							{#if onClose}
								<PickerStickyBtn square onclick={onClose} title="Close" label="Close picker">
									<span class="msi msi-20">close</span>
								</PickerStickyBtn>
							{/if}
							<span class="expr-recent-title">Recently used</span>
							{#if !tgHidden}
								<PickerStickyBtn square onclick={cycleRecentEngine}
									title="Render engine: {recentEngine} — tap to cycle"
									label="Cycle render engine">
									<span class="expr-engine-abbr">{recentEngine === 'cpu-rasterized' ? 'RC' : 'R'}</span>
								</PickerStickyBtn>
							{/if}
						</div>
						{#if !recents.length}
							<p class="expr-recent-empty">Emoji, emotes, mixes and stickers you use will show up here.</p>
						{:else}
							<div class="expr-recent-grid" bind:this={recentGridEl}>
								{#each recents as it (exprRecentKey(it))}
									<button class="expr-recent-cell" onclick={() => fireRecent(it)}>
										{#if it.t === 'emoji'}
											<span class="expr-recent-emoji" class:er-noto={it.f === 'noto'} class:er-sys={it.f === 'system'}>{it.v}</span>
										{:else if it.t === 'ek'}
											<img src={ekThumb(it.v)} alt="" loading="lazy" />
										{:else if it.t === 'ce'}
											<img src={it.v.url} alt={it.v.shortcode} loading="lazy" />
										{:else if it.t === 'tg'}
											<!-- Inline-canvas cell on the RASTERIZED pipeline (each
											     cell owns its own canvas — no stage host needed, so
											     it animates here just like in the TG panel; static
											     packs auto-rest on their thumb frame). Scroll-gated
											     off the grid like the Emotes grid's cells rather than
											     `eager`: eager loaded all 40 at once the instant the
											     tab was opened, which is what made landing on Recent
											     stutter. -->
											<SpriteSticker
												cp={it.v.custom ? null : it.v.cp}
												short={it.v.custom ? it.v.short : null}
												id={it.v.custom ? it.v.id : null}
												size={34} loop={true} mode="visible"
												root={recentGridEl} forceEngine={recentEngine}
												title={it.v.alt || ''} />
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					{:else if t === 'emoji'}
						<EmojiPicker onSelect={fireEmoji} {onClose} />
					{:else if t === 'kitchen'}
						<EmojiKitchen onInsert={fireKitchen} {onClose} />
					{:else if t === 'emotes'}
						<!-- Every Telegram pack (animated AND static) plus the
						     class's uploads, in one ordered flow — see
						     TelegramEmojiPanel's flowingCats for the order. -->
						<TelegramEmojiPanel
							onInsert={fireTg}
							packFilter="all"
							canModerate={isInstructor}
							{onClose}
							{uploads}
							onInsertUpload={(u) => fireCe({ shortcode: u.shortcode, url: u.url })}
							onDeleteUpload={isInstructor ? deleteUpload : null}
							onUpload={() => (showUpload = true)} />
						{#if showUpload}
							<div class="expr-upload">
								<div class="expr-upload-bar">
									<button class="expr-upload-close"
										onclick={() => { showUpload = false; loadUploads(); }}>Done</button>
									<span class="expr-upload-title">Upload a custom emote</span>
								</div>
								<CustomEmojiPanel mode="upload" onInsertEmoji={_noop} onInsertReaction={_noop} {isInstructor} />
							</div>
						{/if}
					{/if}
				{/if}
			</section>
		{/each}
	</div>
	{/if}
</div>

<style>
	.expr-panel {
		/* Matches the bottom nav's inset so the two islands line up. */
		--nav-inset: 56px;
		--expr-tab-h: 3rem;    /* 48px row */
		/* Outer height of the rail: the tab row plus its 3px padding and 1px
		   border on each side. The delete key reads the same value so the two
		   are literally the same height rather than two numbers kept in sync
		   by hand. */
		--expr-rail-h: calc(var(--expr-tab-h) + 8px);
		--expr-slot-w: 3rem;   /* 48px slot */
		/* Delete key width. Wider than a slot — it's a key, not an icon, and it
		   reads as one at this size. Bounded by what's left beside the rail on a
		   narrow phone; see the 360px block. */
		--expr-del-w: 4rem;    /* 64px */
		/* Gap between icon slots. The indicator steps by slot + gap, so this
		   has to be ONE number both consumers read — see .expr-indicator. */
		--expr-gap: 1px;
		/* SAME inset as the top and bottom, so the selected circle is concentric
		   with the rail's own cap — the relationship the home bottom nav has
		   (60px bar, 52px pill, a 4px gap all round, curves running parallel;
		   see .nav-indicator in BottomNav.svelte).
		   The rail is 56px tall with a 28px cap radius; 3px padding + the 1px
		   border puts the 48px circle's centre exactly 28px in from the end, so
		   its 24px radius sits concentric inside that 28px cap with an even 4px
		   ring — top, bottom AND ends.
		   This was 18px, on the theory that an icon flush to a rounded end
		   "sits in the curve and reads as falling out of the container". True of
		   a bare glyph; not true of a circle that nests inside the cap. All 18px
		   bought was a wide dead margin the selected state never reached, which
		   is what made it look like it was floating rather than hugging. */
		--expr-pad: 3px;
		/* Shared bottom offset — these used to differ (6px vs 8px), so the two
		   surfaces sat on different baselines. */
		--expr-rail-bottom: 8px;
		/* Shared side margin, so the rail and the delete key sit on matching
		   edges instead of each picking its own. */
		--expr-edge: 10px;
		display: flex;
		flex-direction: column;
		width: 340px;
		/* Never exceed the viewport, whatever the inner panels ask for —
		   the Kitchen shell is 380px on its own and used to widen the whole
		   popover past the right edge of a narrow screen. */
		max-width: 100vw;
		height: 440px;
		background: var(--paper);
		color: var(--ink);
		/* The sheet's corner radius. A token because the panel CANNOT clip (see
		   below), so every surface that reaches the panel's top edge has to
		   round itself to the same value or it squares the corner off. */
		--expr-radius: 12px;
		border-radius: var(--expr-radius);
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		/* Deliberately NOT `overflow: hidden`.
		   This element is an ancestor of the horizontal pager, and a rounded
		   CLIPPING ancestor makes the compositor mask the scrolling layer —
		   which on iOS WebKit takes the scroller off the fast path and
		   re-rasterises it every frame. That matched the symptom exactly: the
		   swipe was slow in every tab, with emote animation paused, on the
		   rasterized engine — i.e. independent of content. The app shell's
		   pager, which IS smooth on device, has no such ancestor.
		   Nothing needs the clip: the track clips its own overflow
		   rectangularly (cheap), each pane clips its own, and the rounded top
		   corners sit under the grabber strip. */
		position: relative;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		font-size: 0.85rem;
	}

	/* Category strip docks to the bottom (native-keyboard layout); the
	   pane track fills the space above it, grabber on top. The rail itself is
	   inside .expr-chrome-row now, so the row is what takes the strip's slot in
	   the column — an `order` on .expr-tabs here would instead reorder it
	   WITHIN the row, which is exactly what put the delete key on the left and
	   handed the rail the key's share of the width. */
	.expr-grab { order: 0; }
	.expr-track { order: 1; }
	.expr-chrome-row { order: 2; }

	/* ── Drag handle ──────────────────────────────────────────────────
	   Desktop shows the picker as a floating popover, not a sheet, so
	   there is nothing to drag down — the strip only exists on mobile. */
	.expr-grab { display: none; }
	@media (max-width: 640px) {
		.expr-grab {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			height: 20px;
			/* Claim the vertical gesture from the browser; without this the
			   drag competes with the pane's own scrolling. */
			touch-action: none;
			cursor: grab;
		}
		.expr-grab:active { cursor: grabbing; }
		.expr-grab-pill {
			width: 36px;
			height: 4px;
			border-radius: 999px;
			background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 26%, transparent);
		}
	}

	/* Springs back to the dock on release. Suppressed mid-drag so the
	   sheet sits exactly under the finger instead of lagging behind it. */
	.expr-panel { transition: transform 0.17s cubic-bezier(0.32, 0.72, 0, 1); }
	.expr-panel.expr-dragging { transition: none; }
	@media (prefers-reduced-motion: reduce) {
		.expr-panel { transition: none; }
	}

	@media (max-width: 640px) {
		.expr-panel {
			width: 100%;
			/* Fill the docked sheet exactly — its height is driven by the
			   chat page's --picker-h so the bar above stays flush. */
			height: 100%;
			--expr-radius: 14px;
			border-radius: var(--expr-radius) var(--expr-radius) 0 0;
			box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
		}
		/* Taller bottom section strip with soft, pill-shaped buttons (no hard
		   bottom-underline highlight). The buttons fill down to ~5px above the
		   sheet's safe-area edge. */
		/* Island on mobile too — it sits just above the home indicator the way
		   the bottom nav does, rather than running its background to the very
		   bottom of the screen as the old full-bleed strip did. */
		.expr-panel {
			--expr-rail-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
			--expr-gap: 0.2rem;
		}
		.expr-tabs {
			gap: var(--expr-gap);
			padding: 3px var(--expr-pad);
			/* Offsets belong to .expr-chrome-row now — a margin here would
			   stack on top of the row's and double-inset the rail. */
			margin: 0;
			align-items: stretch;
		}
		/* --expr-tab-h is the single source for this height: the close button
		   in each panel's bar reads it too, so the two stay the same size
		   without either guessing at the other's dimensions. */
		.expr-tab {
			padding: 0;
			min-height: var(--expr-tab-h, 2.4rem);
			border-radius: 999px;
			border-bottom: none;
		}
		/* Same glyph size as the bottom nav (25px) — the icons match, there's
		   just no label under them here. */
		.expr-tab .msi { font-size: 25px; }
		.expr-del {
		/* In-flow at the row's right. Shrinkable with a floor, same deal as
		   the tab slots — a key is still a key at 48px. */
		flex: 0 1 var(--expr-del-w);
		min-width: 3rem;
		width: var(--expr-del-w);
		height: var(--expr-rail-h);
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		/* Squarer than the rail's fully-rounded pill. */
		border-radius: 14px;
		background: var(--sidebar-bg, var(--paper));
		border: 1px solid var(--sidebar-border, var(--border));
		box-shadow:
			0 6px 16px rgba(0, 0, 0, 0.13),
			0 1px 4px rgba(0, 0, 0, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.4);
		color: var(--ink);
		cursor: pointer;
		transition: opacity 0.11s ease;
	}
	.expr-del :global(.msi) { font-size: 25px; }
	.expr-del.chrome-dim { opacity: 0.5; }
		.expr-tab-back { padding: 0 0.6rem; min-height: 3.7rem; border-radius: 16px; }
	}

	/* Picker chrome — neutral `surface-container` background to match
	   the sidebar/bottom-nav family. The active tab still uses the
	   secondary pair so the chosen tab pops in the seed's colour. */
	/* Floating island, copied from the app's bottom nav (BottomNav.svelte):
	   inset from the edges, fully rounded, OPAQUE — depth there comes from
	   elevation and a light top edge, never from blur or translucency, so this
	   matches rather than inventing a glassy variant. It keeps its row in the
	   flex column (so the last row of emotes is never hidden behind it) and
	   floats within that row via margins. */
	/* The one owner of the bottom chrome's geometry. Absolutely positioned so
	   it floats over the grid (as the rail did alone), with the rail at its
	   left and the delete key at its right as FLEX SIBLINGS — two boxes in one
	   row cannot overlap, at any container width, which is the bug this
	   replaces: both were independently pinned to opposite edges, and under
	   ~300px (thread panel, popovers) the key slid over the rail's last slot
	   and cut the kitchen icon in half. pointer-events pass through the empty
	   middle so the grid stays scrollable there. */
	.expr-chrome-row {
		position: absolute;
		left: 0; right: 0; bottom: 0;
		z-index: 4;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 8px;
		margin: 4px var(--expr-edge) var(--expr-rail-bottom);
		pointer-events: none;
	}
	.expr-chrome-row > :global(*) { pointer-events: auto; }

	.expr-tabs {
		position: relative;   /* containing block for .expr-indicator */
		display: flex;
		gap: var(--expr-gap);
		/* In-flow child of .expr-chrome-row — the row floats over the grid, this
		   just sits at its left. NOT width:fit-content: fit-content refuses to
		   shrink below content, which is exactly the overflow the row exists to
		   prevent. Flex-auto with min-width:0 sizes to content when there's
		   room and squeezes the slots (they carry their own min-width) when
		   there isn't. */
		flex: 0 1 auto;
		min-width: 0;
		height: var(--expr-rail-h);
		box-sizing: border-box;
		padding: 3px var(--expr-pad);
		border-radius: 999px;
		background: var(--sidebar-bg, var(--md-sys-color-surface-container, var(--surface-2)));
		border: 1px solid var(--sidebar-border, var(--border));
		box-shadow:
			0 10px 30px rgba(0, 0, 0, 0.14),
			0 2px 8px rgba(0, 0, 0, 0.07),
			inset 0 1px 0 rgba(255, 255, 255, 0.45);
		/* Scale about the bottom edge so shrinking pulls it toward the screen
		   edge rather than floating it into the content. */
		transform-origin: bottom center;
		/* No will-change. It was added when this element SCALED; it only fades
		   now, and holding a permanent layer for a surface carrying a 30px-blur
		   drop shadow means that shadow is re-rasterised whenever any descendant
		   restyles — which is exactly what the indicator used to trigger every
		   frame. */
		transition: opacity 0.11s ease;
	}

	/* Scrolling DOWN through a category's contents — the chrome gets out of
	   the way. Pointer-events stay on: it's dimmed, not disabled. */
	/* Opacity ONLY — no scaling. Resizing the chrome mid-scroll drew the eye
	   to the thing that was supposed to be getting out of the way, and the
	   icons are the right size as they are. Down = translucent; up or sideways
	   = fully visible (there is no `chrome-page` rule, so paging simply falls
	   through to the opaque default). */
	.expr-tabs.chrome-dim { opacity: 0.5; }
	/* Swiping BETWEEN categories — the strip is what you're using. */

	/* NOTE: the top bars' controls are deliberately NOT sized from
	   --expr-tab-h. They used to be, and resizing the bottom rail dragged the
	   close button up with it — two unrelated rows moving together because they
	   shared one token. PickerStickyBtn owns its own size. */

	@media (prefers-reduced-motion: reduce) {
		.expr-tabs { transition: none; }
	}
	.expr-tab {
		/* Sized slots, NOT flex:1 — stretching spread four icons across the
		   whole rail and centred them. Basis is the full slot; shrink is
		   allowed (with a floor) so a narrow container squeezes the slots
		   instead of pushing the last one out of the pill. The indicator's
		   pitch is measured from the laid-out slot, so it follows. */
		flex: 0 1 var(--expr-slot-w, 3rem);
		/* An explicit width, not just a basis. Under flex-shrink an item's
		   intrinsic contribution clamps to its CONTENT size — a 25px glyph plus
		   padding — so without this the rail's max-content came out at 41px a
		   slot and the whole pill rendered squeezed even with room to spare. */
		width: var(--expr-slot-w, 3rem);
		min-width: 2.1rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		border: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		/* No underline border. It was transparent in EVERY state (`.expr-tab.active`
		   only ever set border-bottom-color: transparent), a leftover from when
		   these were underline tabs — but 2px of it still came out of the box, so
		   the glyph sat 1px above centre and the selected square could never be
		   concentric with the icon. The mobile block does say `border-bottom:
		   none`, except it's declared BEFORE this rule, so at equal specificity
		   this one won and the override never applied. Removing it here fixes both
		   breakpoints at once. */
	}
	/* Concentric with the island: it pads 3px, so the block's curve runs
	   parallel to the outer one — the same relationship the bottom nav's pill
	   has to its bar. Width is exactly one slot, and it translates by whole
	   multiples of its own width, so no viewport maths is needed. */
	.expr-indicator {
		position: absolute;
		/* A CIRCLE that hugs the pill: one slot across, one slot tall, which is
		   exactly the rail's content box (56px rail − 3px padding − 1px border
		   each side = 48px). So it meets the pill's inner edge top and bottom,
		   concentric with the rail's own cap radius, and — being square before
		   it's rounded — concentric with the icon too. It was 44×48 stretched
		   between top:3px/bottom:3px: a vertical oval around a 25px glyph, which
		   reads as off-centre no matter how precisely it's positioned. */
		top: 50%;
		height: var(--expr-slot-w, 3rem);
		/* Flush with the slot — no inset. The old 2px inset existed to keep the
		   block's corner off the rail's cap, but a circle that fills the rail's
		   inner height IS concentric with that cap, so they nest rather than
		   collide. --expr-pad (18px) still keeps the first and last circles well
		   clear of the pill's ends. */
		left: var(--expr-pad);
		width: var(--expr-slot-w, 3rem);
		border-radius: 50%;
		background: var(--sidebar-active, var(--md-sys-color-secondary-container, var(--paper)));
		/* Resting state only — the FIRST slot, before any JS runs. From then on
		   setFrac() writes this transform directly in px (a calc(var(…)) can't be
		   a compositor animation). The -50% is the half-height pull-back for
		   `top: 50%`; setFrac has to keep writing it, or the circle drops half
		   its height below the icons. */
		transform: translate3d(0, -50%, 0);
		will-change: transform;
		pointer-events: none;
		z-index: 0;
	}
	/* The canvas -> thumb swap that used to live here is GONE.
	   Hiding ~70 .tg-canvas elements tore down that many composited layers and
	   showing them again re-uploaded every texture — a hitch at the start of
	   the gesture and another when it settled. Worse, it ran on every touch
	   rather than every swipe, because paging was entered from pointerdown.
	   Compositing the canvases where they are is cheaper than destroying and
	   rebuilding their layers. */

	/* Icons ride above the block. */
	.expr-tab { position: relative; z-index: 1; }
	/* NO font-variation-settings transition on these icons.
	   app.css gives every .msi a 450ms FILL transition so icons morph
	   outlined -> filled. Here the fill flips when `tab` changes, and `tab`
	   changes as a swipe crosses the halfway point — so two glyphs would start
	   animating a variable-font axis in the middle of the gesture. Interpolating
	   a font axis re-shapes and re-rasterises the outline every frame with no
	   compositor path, landing on exactly the frames the indicator needs, and
	   running on past the settle. The fill still flips; it just doesn't
	   animate. */
	.expr-tab :global(.msi) { transition: none; }
	.expr-tab.active {
		color: var(--sidebar-active-fg, var(--md-sys-color-on-secondary-container, var(--ink)));
	}
	.expr-tab:hover:not(.active) {
		background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 7%, transparent);
	}
	/* Neutral darkening overlay — same M3 state-layer pattern the
	   sidebar uses, so chromatic active never gets out-competed. */
	.expr-tab:hover:not(.active) {
		background: color-mix(in srgb,
			var(--md-sys-color-on-surface, var(--ink)) 7%,
			transparent);
	}

	/* `gif` glyph fills ~60% of its em box (letters only, no icon body),
	   so it reads small next to `mood`, `blender`, etc. at the same px
	   size. Bumping font-size compensates without affecting any other
	   icon. Variation axes (wght/FILL/etc.) inherit from .msi. */
	.gif-glyph { font-size: 30px; line-height: 1; }

	/* ── Pane track ───────────────────────────────────────────────────
	   Horizontal scroll-snap pager, one pane per category. The browser
	   drives the swipe on the compositor, so paging stays at 60fps even
	   while a pane is decoding sticker frames. */
	.expr-track {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		/* Don't let a swipe that runs off the last pane chain out to the
		   app shell's own section pager underneath. */
		overscroll-behavior: contain;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		/* A pane mounting mid-scroll must not make the browser "helpfully"
		   re-anchor the track onto a different pane. */
		overflow-anchor: none;
	}
	.expr-track::-webkit-scrollbar { display: none; }
	.expr-pane {
		position: relative;   /* containing block for .expr-upload */
		/* The track is three viewport-wide panes holding ~80 canvases between
		   them, and it had NO containment: a horizontal swipe made the browser
		   lay out, paint and composite the whole 1125px surface every frame.
		   `content-visibility: auto` lets it skip panes that aren't on screen
		   outright, and `contain-intrinsic-size` keeps a skipped pane's box the
		   right size so the track geometry (and therefore every scroll
		   position) is unchanged. */
		content-visibility: auto;
		contain-intrinsic-size: auto 100%;
		flex: 0 0 100%;
		width: 100%;
		/* Without min-width:0 a wide child (the Kitchen's 380px shell, a long
		   sticker row) stretches its flex item instead of scrolling inside it,
		   which is what pushed the panel wider than the screen. */
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		scroll-snap-align: start;
		scroll-snap-stop: always;
	}

	/* Upload form, over the grid. Covers the pane rather than displacing it,
	   so dismissing puts you back exactly where you were in the list. */
	.expr-upload {
		position: absolute;
		inset: 0;
		z-index: 6;
		display: flex;
		flex-direction: column;
		background: var(--paper);
	}
	.expr-upload-bar {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1.5px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.expr-upload-title { font-size: 0.78rem; font-weight: 600; color: var(--ink); }
	.expr-upload-close {
		border: none; border-radius: 999px;
		padding: 0.3rem 0.7rem;
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		font: inherit; font-size: 0.74rem; font-weight: 600; cursor: pointer;
	}

	/* Source switch (Uploaded / Library) rendered INTO the inner panel's own
	   bar via the `leading` snippet, so it has to read as part of that bar
	   rather than as the old standalone nav row. */
	.expr-srctab {
		flex: 0 0 auto;
		padding: 0.3rem 0.65rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.74rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.expr-srctab.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: var(--md-sys-color-secondary, var(--border));
	}
	.expr-srctab:hover:not(.active) {
		background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 7%, transparent);
	}

	.expr-subtabs {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.expr-subtab {
		padding: 0.25rem 0.7rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.expr-subtab.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: var(--md-sys-color-secondary, var(--border));
	}
	.expr-subtab:hover:not(.active) {
		background: color-mix(in srgb,
			var(--md-sys-color-on-surface, var(--ink)) 7%,
			transparent);
	}

	/* The inner pickers each manage their own width/height inside the
	   expr-body container. Reset their default panel chrome so they
	   blend into the unified shell instead of double-styling. The
	   Emoji Kitchen component uses `.kitchen-panel` (not
	   `.emoji-kitchen`) on its root, so it was sitting at its own
	   hard-coded 380px width inside the 340px picker shell and
	   overflowing the right edge — adding `.kitchen-panel` to the
	   reset list snaps it to the container. */
	.expr-pane :global(.tg-panel),
	.expr-pane :global(.emoji-picker),
	.expr-pane :global(.emoji-kitchen),
	.expr-pane :global(.kitchen-panel),
	.expr-pane :global(.gif-picker),
	.expr-pane :global(.custom-emoji-panel) {
		/* Reset each inner picker's standalone chrome so it reads as
		   the body of the ExpressionPicker shell, not a card-within-
		   a-card. width/height let the picker fill the body; the
		   visual chrome (border, radius, shadow, background) is
		   owned by the outer .expr-panel. */
		width: 100% !important;
		height: 100% !important;
		border: none !important;
		border-radius: 0 !important;
		box-shadow: none !important;
		background: transparent !important;
	}

	/* Each pane's top bar is a solid, full-width surface that reaches the
	   panel's top edge, and the panel deliberately does NOT clip (a rounded
	   clipping ancestor takes the horizontal pager off iOS WebKit's compositor
	   fast path — see .expr-panel). So an unrounded bar paints its own square
	   corners straight over the sheet's rounded ones, which is what made the
	   picker read as square-cornered no matter what radius the panel carried.
	   Each bar rounds itself to the same token instead. */
	.expr-recent-bar,
	.expr-pane :global(.tg-tabs-bar),
	.expr-pane :global(.emoji-topbar),
	.expr-pane :global(.kitchen-tabs-bar) {
		border-radius: var(--expr-radius) var(--expr-radius) 0 0;
	}

	/* Clearance for the floating island. Each inner panel owns its own
	   scroller, so the padding has to reach into them — without it the last row
	   of every grid sits permanently under the strip. */
	.expr-pane :global(.grid-wrap),
	.expr-pane :global(.tg-grid-wrap),
	.expr-pane :global(.ce-grid-wrap),
	.expr-pane :global(.kitchen-content) {
		padding-bottom: 68px;
	}
	.expr-recent-grid { padding-bottom: 68px; }

	/* Recent's top bar — same recipe as the Emoji / Emotes tabs' so the three
	   read as one picker, not three panels with different heads. */
	.expr-recent-bar {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1.5px solid var(--border);
		background: var(--surface-2);
		flex-shrink: 0;
	}
	.expr-recent-title {
		flex: 1; min-width: 0;
		font-size: 0.78rem; font-weight: 600; color: var(--muted-fg);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.expr-engine-abbr { font-size: 0.62rem; font-weight: 800; letter-spacing: 0.02em; line-height: 1; }

	/* Recently used — one flat grid mixing every expression type */
	.expr-recent-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
		gap: 0.2rem;
		padding: 0.5rem;
		overflow-y: auto;
		/* Shares the pane's column with the bar above it, so it takes the
		   remaining height rather than a full 100% that would overflow. */
		flex: 1 1 auto;
		min-height: 0;
		align-content: start;
	}
	.expr-recent-cell {
		aspect-ratio: 1;
		display: flex; align-items: center; justify-content: center;
		background: none; border: none; border-radius: 8px;
		cursor: pointer; padding: 0.2rem; min-width: 0;
		transition: background 0.1s;
	}
	.expr-recent-cell:hover { background: var(--surface-2); }
	.expr-recent-cell img { width: 100%; height: 100%; object-fit: contain; }
	.expr-recent-emoji { font-size: 1.6rem; line-height: 1; }
	/* each emoji renders in the font it was SENT in, regardless of the
	   current global emoji-font setting */
	.expr-recent-emoji.er-noto { font-family: 'Noto Color Emoji', sans-serif; }
	.expr-recent-emoji.er-sys { font-family: 'Apple Color Emoji', 'Segoe UI Emoji', system-ui, sans-serif; }
	.expr-recent-empty {
		margin: 0; padding: 1.5rem 1rem; text-align: center;
		color: var(--muted-fg); font-size: 0.85rem;
	}
</style>
