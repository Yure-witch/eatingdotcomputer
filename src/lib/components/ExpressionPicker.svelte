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
		engineMode, setEngineManual, rasterEngineFor, emoteWebgpuOk
	} from '$lib/telegram-emoji-store.js';
	import { getExprRecents, addExprRecent, exprRecentKey } from '$lib/expr-recents.js';
	import { ekTokenToUrl } from '$lib/message-render.js';
	import { holdEmotes } from '$lib/emote-idle.js';

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
		// The class's uploaded emotes resolve [ce:…] tokens. Same story as the
		// packs above: only /app/+layout.svelte loaded this, so a [ce:] avatar
		// picked during onboarding had nothing to render against.
		if (!Object.keys(getCachedCustomEmojiMap()).length) {
			getCustomEmojiMap().then(() => _packVer++).catch(() => {});
		}
		}
		// Emote holds are refcounted globally, so one leaked by a picker that
		// unmounted mid-gesture (swipe down to dismiss, say) would freeze every
		// emote in the app for the rest of the session.
		return () => {
			clearTimeout(_settleT);
			clearTimeout(_scrollThawT);
			thawEmotes();
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
		// Two frames: the first lets the open itself paint, the second starts
		// the (heavier) neighbour work with the picker already on screen.
		_neighbourRaf = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				_neighbourRaf = 0;
				const prev = TABS[tabIndex - 1], next = TABS[tabIndex + 1];
				ensure(next);
				// Split across frames so two heavy panes never land in one.
				if (prev) requestAnimationFrame(() => ensure(prev));
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
	// Freeze every looping emote for the duration of a page gesture. Dozens of
	// Skottie canvases competing for the same frames is what stops the incoming
	// category from sliding in cleanly; frozen, the swipe gets the main thread
	// to itself and the emotes resume the moment it settles.
	let _releaseEmotes = null;
	function freezeEmotes() { _releaseEmotes ??= holdEmotes(); }
	function thawEmotes() { _releaseEmotes?.(); _releaseEmotes = null; }

	function settleSoon() {
		clearTimeout(_settleT);
		_settleT = setTimeout(() => { _touching = false; thawEmotes(); }, 260);
		endPaging();
	}

	function onTrackPointerDown() { _touching = true; freezeEmotes(); setChrome('page'); }
	function onTrackPointerUp() {
		// Don't clear immediately: the fling continues after the finger lifts,
		// and the track is still settling toward a snap point.
		settleSoon();
	}

	// Scroll -> active tab. Read in a rAF so a fling doesn't run layout
	// reads on every scroll event.
	let _rafScroll = 0;
	function onTrackScroll() {
		// A wheel / trackpad page never sends pointerdown, so freeze here too.
		freezeEmotes();
		if (chrome !== 'page') setChrome('page');
		settleSoon();
		if (_rafScroll) return;
		_rafScroll = requestAnimationFrame(() => {
			_rafScroll = 0;
			const el = trackEl;
			if (!el || !el.clientWidth) return;
			const f = el.scrollLeft / el.clientWidth;
			// Straight to the element, NOT through $state: this runs every frame
			// of a swipe and a Svelte flush here would make the block trail the
			// finger. Same trick the bottom nav's --nav-frac uses.
			railEl?.style.setProperty('--expr-frac', String(f));
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
		const i = Math.max(0, TABS.indexOf(untrack(() => tab)));
		el.scrollLeft = i * el.clientWidth;
		// Seed the block too: without this it starts at slot 0 while the track
		// may have opened on a remembered tab further along.
		railEl?.style.setProperty('--expr-frac', String(i));
	});

	$effect(() => { ensure(tab); scheduleNeighbours(); });

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
	function setChrome(next) {
		clearTimeout(_chromeT);
		chrome = next;
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
	// Scrolling freezes the emotes outright. A grid of looping Skottie cells
	// and a scroll are both after the same frames, and the animation is the one
	// nobody is looking at while the list is moving — this is what keeps a
	// scroll through animated packs at full rate. They resume once it settles.
	let _scrollThawT = null;
	function holdForScroll() {
		freezeEmotes();
		clearTimeout(_scrollThawT);
		_scrollThawT = setTimeout(() => thawEmotes(), 220);
	}

	function onAnyWheel(e) {
		holdForScroll();
		if (chrome === 'page') return;         // a swipe owns the chrome
		if (e.deltaY > 0) setChrome('dim');
		else if (e.deltaY < 0) setChrome('rest');
	}
	let _touchY = 0;
	function onAnyTouchStart(e) { _touchY = e.touches?.[0]?.clientY ?? 0; }
	function onAnyTouchMove(e) {
		holdForScroll();
		if (chrome === 'page') return;
		const y = e.touches?.[0]?.clientY ?? 0;
		const dy = _touchY - y;                // finger up = reading downward
		if (Math.abs(dy) < 2) return;
		_touchY = y;
		setChrome(dy > 0 ? 'dim' : 'rest');
	}

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
	// $emoteWebgpuOk is read so this re-resolves if the picker opened before the
	// WebGPU probe landed — otherwise a capable phone would stay on the
	// conservative pre-probe guess for the life of the page.
	const recentEngine = $derived(rasterEngineFor($engineMode, $emoteWebgpuOk));
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
     onwheelcapture={onAnyWheel}
     ontouchstartcapture={onAnyTouchStart} ontouchmovecapture={onAnyTouchMove}
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
		<nav class="expr-tabs" aria-label="Expression categories"
			bind:this={railEl}
			style:--expr-slots={TABS.length}
			class:chrome-dim={chrome === 'dim'}>
			<!-- One block that GLIDES with the live scroll fraction, rather than a
			     per-tab background snapping on and off — so it's visibly halfway
			     between two icons when your swipe is. Copied from the bottom
			     nav's .nav-indicator. No transition: it follows --expr-frac
			     every frame, and a transition would make it lag the finger. -->
			<span class="expr-indicator" aria-hidden="true"></span>
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
												maxFps={24} title={it.v.alt || ''} />
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
		--expr-tab-h: 3.6rem;   /* 1.3x */
		/* Outer height of the rail: the tab row plus its 3px padding and 1px
		   border on each side. The delete key reads the same value so the two
		   are literally the same height rather than two numbers kept in sync
		   by hand. */
		--expr-rail-h: calc(var(--expr-tab-h) + 8px);
		--expr-slot-w: 3.9rem;  /* 1.3x */
		/* Shared bottom offset — these used to differ (6px vs 8px), so the two
		   surfaces sat on different baselines. */
		--expr-rail-bottom: 8px;
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
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		overflow: hidden;
		position: relative;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		font-size: 0.85rem;
	}

	/* Category strip docks to the bottom (native-keyboard layout); the
	   pane track fills the space above it, grabber on top. */
	.expr-grab { order: 0; }
	.expr-track { order: 1; }
	.expr-tabs { order: 2; }

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
			border-radius: 14px 14px 0 0;
			box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
		}
		/* Taller bottom section strip with soft, pill-shaped buttons (no hard
		   bottom-underline highlight). The buttons fill down to ~5px above the
		   sheet's safe-area edge. */
		/* Island on mobile too — it sits just above the home indicator the way
		   the bottom nav does, rather than running its background to the very
		   bottom of the screen as the old full-bleed strip did. */
		.expr-panel { --expr-rail-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); }
		.expr-tabs {
			gap: 0.2rem;
			padding: 3px;
			margin: 4px 0 var(--expr-rail-bottom) var(--nav-inset, 56px);
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
		.expr-tab .msi { font-size: 32px; }
		.expr-del {
		position: absolute;
		bottom: var(--expr-rail-bottom);
		/* Just outside the rail's right edge — the rail is inset --nav-inset,
		   so this sits in that band, aligned with it rather than inside it. */
		right: 6px;
		z-index: 5;
		width: var(--expr-slot-w);
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
		will-change: opacity;
	}
	.expr-del :global(.msi) { font-size: 32px; }
	.expr-del.chrome-dim { opacity: 0.5; }
	.expr-tab.active { border-bottom-color: transparent; }
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
	.expr-tabs {
		position: relative;   /* containing block for .expr-indicator */
		display: flex;
		gap: 1px;
		flex-shrink: 0;
		/* Floats OVER the grid instead of reserving a row, so content scrolls
		   behind it. The panes' scrollers get matching bottom padding (below)
		   so the last row can still be scrolled clear of it. */
		position: absolute;
		/* Content-width: `right: 0` stretched the pill across the whole inset
		   span, and with the icons grouped left that trailing space was just
		   empty pill. Anchored left at the nav inset, it now ends where the
		   icons do. */
		left: 0; bottom: 0;
		width: fit-content;
		z-index: 4;
		/* Same island geometry as the app's bottom nav: inset --nav-inset (56px)
		   from each edge. The delete key lives in the band that inset leaves,
		   so it needs no extra margin carved out of the rail. */
		height: var(--expr-rail-h);
		box-sizing: border-box;
		margin: 4px var(--nav-inset, 56px) var(--expr-rail-bottom);
		padding: 3px;
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
		transition: opacity 0.11s ease;
		/* Own layer: the drop shadow is expensive to rasterise, and without this
		   it was re-rasterised every frame of the scale. Promoted, the shadow is
		   painted once and the layer is merely transformed. */
		will-change: opacity;
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

	/* Close button in the inner panels' bars, sized off the same token as the
	   category icons so the picker's controls share one height. */
	.expr-pane :global(.ctl-btn.square) {
		width: var(--expr-tab-h, 2.4rem);
		height: var(--expr-tab-h, 2.4rem);
	}

	@media (prefers-reduced-motion: reduce) {
		.expr-tabs { transition: none; }
	}
	.expr-tab {
		/* Fixed slots, NOT flex:1 — stretching spread four icons across the
		   whole rail and centred them. Sized slots keep them grouped at the
		   left, with the delete key off at the right. */
		flex: 0 0 var(--expr-slot-w, 3rem);
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
		border-bottom: 2px solid transparent;
	}
	/* Concentric with the island: it pads 3px, so the block's curve runs
	   parallel to the outer one — the same relationship the bottom nav's pill
	   has to its bar. Width is exactly one slot, and it translates by whole
	   multiples of its own width, so no viewport maths is needed. */
	.expr-indicator {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		/* One slot wide. Was a fraction of the container, which is wrong now
		   that the container also holds the delete key. */
		width: var(--expr-slot-w, 3rem);
		border-radius: 999px;
		background: var(--sidebar-active, var(--md-sys-color-secondary-container, var(--paper)));
		transform: translate3d(calc(var(--expr-frac, 0) * 100%), 0, 0);
		will-change: transform;
		pointer-events: none;
		z-index: 0;
	}
	/* Icons ride above the block. */
	.expr-tab { position: relative; z-index: 1; }
	.expr-tab.active {
		color: var(--sidebar-active-fg, var(--md-sys-color-on-secondary-container, var(--ink)));
		border-bottom-color: transparent;
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
