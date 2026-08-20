<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import {
		loadTelegramEmoji,
		loadCustomPacks,
		loadSpriteSheet,
		engineMode,
		setEngineManual,
		isStaticPack,
		TG_CAT_ICONS
	} from '$lib/telegram-emoji-store.js';
	// Picker uses a pre-rasterised sprite renderer: each emoji is rendered
	// once via rlottie (the worker WASM renderer Telegram itself uses for
	// TGS) into an ImageBitmap array, then cells blit frames[i] per tick.
	// Pixel-perfect, scales to hundreds of concurrent cells. Chat bubbles
	// still use lottie-web SVG directly.
	import LottieSticker from './SpriteSticker.svelte';
	import PickerStickyBtn from './PickerStickyBtn.svelte';
	import { prewarm as prewarmSprites } from '$lib/lottie-spritesheet.js';
	import { loadEmojiData, buildByCp } from '$lib/emoji-data.js';
	import { hiddenEmoteKeys, emoteKey, hideEmote, unhideEmote } from '$lib/hidden-emotes.js';
	import {
		setHost as setSkottieHostMain,
		clearCanvas as clearSkottieMain
	} from '$lib/skottie-stage.js';
	import {
		setHost as setSkottieHostWorker,
		clearCanvas as clearSkottieWorker
	} from '$lib/skottie-stage-worker.js';
	// Wire BOTH Skottie hosts at once so engine swaps don't leave either
	// stage pointing at a stale (potentially unmounted) element. The
	// inactive stage's canvas is parked off-DOM when its setHost(null)
	// is called, and otherwise it just sits idle (no cells, no work).
	function setSkottieHosts(content, wrapper) {
		setSkottieHostMain(content, wrapper);
		setSkottieHostWorker(content, wrapper);
	}
	// Wipe BOTH stage canvases. Needed on tab switches because pixels
	// from the previous tab linger anywhere the new tab has no cell at
	// that grid position. Cells re-paint thumb/anim on the next frame.
	function clearSkottieCanvases() {
		clearSkottieMain();
		clearSkottieWorker();
	}

	let { onInsert, packFilter = 'all', onClose = null, canModerate = false } = $props();
	// Instructor moderation: when `moderating` is on (instructor only), the
	// library shows hidden emotes (dimmed) and clicking one toggles its hidden
	// state instead of inserting it. When off, hidden emotes are filtered out
	// entirely — the same view a student gets.
	let moderating = $state(false);
	const _hiddenSet = $derived($hiddenEmoteKeys);
	const _showHidden = $derived(canModerate && moderating);
	const _cellKey = (it) => emoteKey({ cp: it.cp, short: it.short, id: it.id, custom: it.custom });
	const _keep = (it) => _showHidden || !_hiddenSet.has(_cellKey(it));
	const _isCellHidden = (it) => _hiddenSet.has(_cellKey(it));
	function cellAction(it) {
		if (_showHidden) {
			if (_isCellHidden(it)) unhideEmote(it); else hideEmote(it);
			return;
		}
		onInsert(it.custom ? { ...it, mode: customMode } : it);
	}
	// `packFilter` decides which custom packs the panel will surface and
	// whether the standard Telegram categories (Effects, Custom aggregate,
	// Smileys, …) are shown at all. Used by ExpressionPicker so the
	// Animated tab can hide static packs and the Emotes tab's library
	// section can show ONLY static packs.
	//   'all'      — current behavior (every pack + every category)
	//   'animated' — drop static packs from the pack rail
	//   'static'   — show only static packs; hide head categories entirely
	const _isAnimatedOnly = packFilter === 'animated';
	const _isStaticOnly = packFilter === 'static';

	// display order + tab icon for each Telegram-category present in the manifest
	const CAT_ORDER = ['Smileys', 'People', 'Animals and Nature', 'Food and Drink',
		'Activity', 'Travel and Places', 'Objects', 'Symbols', 'Flags', 'Other']
		.map((key) => ({ key, icon: TG_CAT_ICONS[key] }));

	let loading = $state(true);
	let byCat = $state({});
	let headCats = $state([]); // [{key, label, icon}] — Effects, Custom, Smileys, …, Other
	let packCats = $state([]); // [{key, label, pack: {short, firstId}}] — one per custom pack
	let active = $state('Effects');
	// Scrollable containers, passed to each LottieSticker as IntersectionObserver root
	// so off-screen cells/tabs actually pause instead of always being "visible".
	let gridOuterEl = $state(null);  // .tg-grid-outer — non-scrolling, viewport-sized; Skottie canvas mounts here so it stays pinned to the visible area
	let gridWrapEl = $state(null);
	let gridEl = $state(null);  // .tg-grid — scroll content
	let tabsEl = $state(null);
	let panelEl = $state(null);
	// Virtualization — render LottieStickers only for cells in viewport + buffer.
	// Cell layout is preserved via empty <div class="tg-cell"> placeholders so the
	// scrollbar stays accurate without measuring every emoji.
	// Coarse-pointer / touch device test for mobile perf tuning.
	const _IS_COARSE = typeof window !== 'undefined'
		&& window.matchMedia?.('(pointer: coarse)').matches;
	// Cell pitch — desktop is 36 (matches the regular EmojiPicker).
	// Mobile uses 44 so phones get 8 cells per row at typical widths
	// (360 px content / 44 ≈ 8), giving a clean 3×8 = 24-cell viewport
	// with no buffer. Keeps Skottie active animations bounded to 24,
	// which is well within iOS WebGPU's per-page GPU budget.
	const CELL_PX = _IS_COARSE ? 44 : 36;
	const GRID_PAD_X = 4;          // 0.25rem padding on .tg-grid-wrap each side (matches regular picker)
	// Buffer ≈ 3 rows each side. Smaller cells mean more cells/row, so a
	// large buffer can balloon active spritesheet memory. 3 is enough to
	// hide rapid scroll given the new tiny per-frame raster (9 KB/frame).
	// Keep 20 rows worth of cells mounted above and below the visible
	// area as static sprites so a quick scroll never reveals an
	// un-mounted gap (cells that aren't mounted have no canvas tile at
	// all — they're literally absent from the grid until they enter the
	// virtualization window). 20 rows × 36 px = 720 px of buffer each
	// side, which covers any plausible single-fling scroll distance.
	// Off-screen-but-recently-visible cells stay registered with the
	// Skottie stage too, so the buffer cells also have their last
	// animation frame held on the canvas (see PAINT_BUFFER_PX in
	// skottie-stage.js — note that's about painting, not mounting).
	// Desktop with WebGPU absorbs the cost of pre-mounting 20 rows
	// above + below for jank-free flings. Mobile pays the cost in
	// GPU memory — each mounted animated cell pins a Skottie surface
	// in the worker, and iOS WebGPU kills the renderer once the
	// per-page budget is exceeded. Zero buffer means only the cells
	// strictly in the viewport are mounted; scrolling pulls in a new
	// row and the row that scrolls out unmounts (releasing its anim
	// via SpriteSticker's teardown → worker refcount drop → free).
	const BUFFER_ROWS = _IS_COARSE ? 0 : 20;
	let scrollTop = $state(0);
	// First-open mount stagger: the live-cell band starts at a fraction of the
	// viewport and ramps to full over a few animation frames, so the initial
	// burst of ~140 SpriteSticker instantiations (+ their canvas transfers) is
	// spread across frames instead of freezing the main thread on tab open. Any
	// scroll jumps straight to the full band so nothing is ever missing in view.
	let _fillFrac = $state(_IS_COARSE ? 1 : 0.34);
	let gridH = $state(420);
	let gridW = $state(340);
	// "Animated" inserts the Lottie token; "Emoji" inserts the underlying Unicode char
	let customMode = $state('animated'); // 'animated' | 'emoji'
	let search = $state('');
	// Per-pack opt-in: do alt-emoji CLDR names + keywords count for search in this pack?
	// Default OFF since most packs' artwork has nothing to do with the underlying emoji.
	let cldrEnabled = $state({}); // { [short_name]: true }
	const CLDR_LS_KEY = 'tgCldrEnabled';

	function togglePackCldr(short) {
		cldrEnabled = { ...cldrEnabled, [short]: !cldrEnabled[short] };
		try { localStorage.setItem(CLDR_LS_KEY, JSON.stringify(cldrEnabled)); } catch {}
	}

	// Normalize a codepoint string (lowercase, strip VS16) for matching across
	// emoji-data ("1F600" or "1F468-200D-1F4BB") and our alt-derived cps.
	const cpKey = (s) => String(s).toLowerCase().replace(/(?:^|-)fe0f(?=-|$)/g, '');
	const cpFromChar = (ch) =>
		Array.from(String(ch).replace(/️/g, ''))
			.map((c) => c.codePointAt(0).toString(16))
			.join('-');

	onMount(async () => {
		// Spawn rlottie workers + warm the rasterise pool while the
		// manifest loads — pays the WASM-spawn cost before the first
		// emoji's first frame is requested.
		prewarmSprites();
		// Sprite sheet is already preloaded by the root layout; this is a
		// no-op cache hit but ensures the writable is wired up in case the
		// panel is opened before the layout's onMount has fired.
		loadSpriteSheet();
		// Scope the Skottie GPU stage to the grid wrapper so it's
		// occluded by the picker's chrome (tabs, search, foot) via
		// natural DOM stacking, and tracks the scroll container's
		// bounds. Falls back to fullscreen overlay if the picker is
		// closed.
		// `.tg-grid` doesn't exist while `loading` is true (it's gated
		// by an `{#if loading}` block), so we can't bind it yet. The
		// $effect below picks up `gridEl` the moment it lands and
		// wires the Skottie stage host then.
		try { const raw = localStorage.getItem(CLDR_LS_KEY); if (raw) cldrEnabled = JSON.parse(raw); } catch {}
		const [m, custom] = await Promise.all([loadTelegramEmoji(), loadCustomPacks()]);

		// Walk emoji-data.json once: build canonical order AND a cp -> {name, kw}
		// lookup so custom emoji inherit the underlying emoji's name + keywords.
		let orderMap = {};
		let metaByCp = {};
		try {
			// Shared, memoised index — see $lib/emoji-data.js. Previously this
			// walked all ~3800 items itself, on top of its own 546 KB parse.
			({ orderMap, metaByCp } = buildByCp(await loadEmojiData()));
		} catch { /* fall back to manifest order, empty meta */ }
		const ord = (it) => orderMap[cpKey(it.cp)] ?? 1e9;
		const metaForAlt = (alt) => metaByCp[cpKey(cpFromChar(alt))] || null;

		const sorted = {};
		for (const [c, list] of Object.entries(m.byCat)) sorted[c] = [...list].sort((a, b) => ord(a) - ord(b));

		// Effects = every entry with av > 0 (duplicates only — they stay in their home cats)
		const fx = m.emoji.filter((e) => (e.av || 0) > 0).sort((a, b) => ord(a) - ord(b));
		sorted['Effects'] = fx;

		// Helper — turn one Telegram-API custom-emoji entry into a panel item with
		// inherited name + keywords from the underlying Unicode emoji's CLDR data.
		const toCustomItem = (e, pack) => {
			const meta = metaForAlt(e.alt) || {};
			return {
				e: e.alt, cp: e.id, cat: pack ? ('pack:' + pack.short_name) : 'Custom',
				av: 0, flag: false, custom: true,
				id: e.id, alt: e.alt, short: pack ? pack.short_name : e.short,
				packTitle: pack ? pack.title : e.packTitle,
				name: meta.name || '',
				kw: meta.kw || []
			};
		};

		// Apply packFilter BEFORE building any of the aggregate categories
		// so 'static'/'animated' modes never even index packs they shouldn't
		// surface. The unfiltered Custom aggregate would pull in the other
		// kind otherwise.
		const visiblePacks = (custom?.packs || []).filter((p) => {
			if (_isAnimatedOnly && isStaticPack(p.short_name)) return false;
			if (_isStaticOnly && !isStaticPack(p.short_name)) return false;
			return true;
		});

		// Aggregate all custom emoji into one "Custom" category, preserving pack-then-pack order
		if (!_isStaticOnly && visiblePacks.length) {
			const flat = [];
			for (const p of visiblePacks) for (const e of p.emoji) flat.push(toCustomItem(e, p));
			sorted['Custom'] = flat;
		}

		// Per-pack tabs: each pack gets its own tab (icon = first emoji animated)
		const packTabsLocal = [];
		for (const p of visiblePacks) {
			const key = 'pack:' + p.short_name;
			sorted[key] = p.emoji.map((e) => toCustomItem(e, p));
			if (p.emoji[0]?.id) packTabsLocal.push({ key, label: p.title, pack: { short: p.short_name, firstId: p.emoji[0].id } });
		}

		byCat = sorted;
		const head = [];
		// In static-only mode the standard categories (Effects, Custom
		// aggregate, Smileys, etc.) are intentionally hidden — the user
		// reached this panel via the Emotes tab specifically to browse the
		// static TG packs, so showing animated FX or unicode categories
		// would defeat the point.
		if (!_isStaticOnly) {
			// The ✨ entries (av > 0) are the curated, specially-animated set —
			// surfaced as "Special effects", flowing ABOVE the regular
			// categories rather than as an isolated grid.
			if (fx.length) head.push({ key: 'Effects', label: 'Special effects', icon: TG_CAT_ICONS.Effects });
			// The 🎨 "Custom" aggregate tab is gone — in flow/scroll mode
			// every custom pack already renders as its own labelled section
			// in the continuous scroller, so the aggregate was duplicate
			// navigation. (sorted['Custom'] is still built above in case
			// other code references it, just no longer surfaced as a tab.)
			for (const c of CAT_ORDER) {
				if (sorted[c.key]?.length) head.push({ key: c.key, label: c.key, icon: c.icon });
			}
		}
		headCats = head;
		packCats = packTabsLocal;
		// Reset `active` if it isn't a tab that exists in THIS mode — not just
		// if its data is missing. `byCat['Effects']` is always built, so the
		// old `!byCat[active]` check left the default active='Effects' in
		// place even in static-only (Library) mode where Effects is hidden,
		// making the Library open on the animated Effects grid. Validate
		// against the actual visible tab keys instead.
		const _validTabs = new Set([...head.map((c) => c.key), ...packTabsLocal.map((c) => c.key)]);
		if (!_validTabs.has(active)) active = head[0]?.key ?? packTabsLocal[0]?.key ?? '';
		loading = false;
	});

	const items = $derived((byCat[active] ?? []).filter(_keep));

	// Categories that render as a SINGLE grid even in flow mode.
	// `Custom` is an aggregate of every per-pack section underneath it, so
	// showing it both as its own block AND repeated in each pack's block
	// would be duplicate noise. (`Effects` used to live here too — it now
	// flows as the leading "Special effects" section instead.)
	const STANDALONE_TG_CATS = new Set(['Custom']);
	const isStandalone = (key) => STANDALONE_TG_CATS.has(key);

	// Flow mode = every non-standalone head category + every pack tab,
	// rendered as labelled sections inside one continuous scroller.
	// Click on a head/pack tab snaps the scroller to that section's
	// top; user scroll inside the scroller updates the highlighted tab
	// to whichever section is currently nearest the top edge.
	const flowingCats = $derived([
		...headCats.filter((c) => !isStandalone(c.key)),
		...packCats.map((c) => ({ key: c.key, label: c.label, icon: null, pack: c.pack }))
	]);
	const flowingSections = $derived(
		flowingCats.map((c) => ({
			key: c.key,
			label: c.label ?? c.key,
			items: (byCat[c.key] ?? []).filter(_keep)
		}))
	);

	// Per-section pixel geometry — used by (1) the scroll → active-tab
	// sync (walk-forward "last pxStart ≤ scrollTop" lookup) and (2)
	// the tab → scroll snap (scrollTo target.pxStart). HEADER_PX must
	// match the rendered `.tg-section-label` height in CSS or the
	// scrollbar geometry drifts from where the labels actually land.
	const HEADER_PX = 26;
	const flowingGeometry = $derived.by(() => {
		const out = [];
		let py = 0;
		const cpr = Math.max(1, cellsPerRow);
		for (const s of flowingSections) {
			const rows = Math.ceil(s.items.length / cpr);
			const h = HEADER_PX + rows * CELL_PX;
			out.push({ key: s.key, pxStart: py, pxEnd: py + h });
			py += h;
		}
		return out;
	});

	// Suppress the scroll-derived active sync while a programmatic
	// scroll is in flight (goToTab → scrollTo). Released on the next
	// microtask so the user's next genuine scroll is observed.
	let _programmaticActive = false;

	onDestroy(() => {
		// Release the picker's grid wrapper as the Skottie host so the
		// stage canvas detaches cleanly on close. Both stages.
		setSkottieHosts(null);
	});
	// Resting-frame thumbnails are baked offline at /telegram-emoji/thumbs
	// (see examples/render_thumbs.mjs) and loaded by SpriteSticker as
	// <img> on cell mount — browser-cached, ~3 KB each. No runtime thumb
	// pre-warm needed.
	const isEffectsTab = $derived(active === 'Effects');
	const activeCat = $derived(
		headCats.find((c) => c.key === active) || packCats.find((c) => c.key === active) || null
	);

	// Wire the Skottie stage canvas to a NON-SCROLLING, viewport-sized
	// host (gridOuterEl), with gridWrapEl as the scroll viewport whose
	// scroll events drive cell repositioning.
	//
	// Why a separate outer host and not gridWrapEl itself: the worker
	// appends the canvas as `position:absolute; top:0` inside the host.
	// If the host IS the scroller (gridWrapEl, overflow:auto), that
	// abspos canvas is positioned from the scroll-content origin, so it
	// scrolls UP and out of view the moment you scroll down — and
	// nothing renders. gridOuterEl wraps the scroller but does NOT
	// scroll, so an abspos canvas inside it stays pinned to the visible
	// viewport; cells scroll underneath it, and the worker's
	// `cell.getBoundingClientRect() − canvas.getBoundingClientRect()`
	// math keeps every sprite at the right on-screen position.
	//
	// gridOuterEl is viewport-sized (~360 px), so the WebGL backbuffer
	// is ~3 MB total across shards instead of the ~70 MB it would be if
	// sized to the ~8000 px flow content (gridEl) — that giant
	// backbuffer is what browsers tile for compositing, and the tile
	// boundaries are where the flicker came from.
	$effect(() => {
		if (gridOuterEl && gridWrapEl) setSkottieHosts(gridOuterEl, gridWrapEl);
	});

	// Reset search on tab change. Standalone tabs (Effects / Custom)
	// and active search both reset scroll to top — they switch the
	// render branch entirely, so previous scroll position is
	// meaningless. Programmatic tab changes from `goToTab` to a
	// flowing section own the scroll themselves (they scrollTo the
	// section's pxStart), so they skip both branches here.
	$effect(() => {
		active;
		search = '';
	});
	$effect(() => {
		void active; void search;
		if (_programmaticActive) return;
		if (isStandalone(active) || search.trim()) {
			if (gridWrapEl) gridWrapEl.scrollTop = 0;
			scrollTop = 0;
		}
	});

	// Switch tabs. We clear the Skottie canvases BEFORE updating
	// `active` so the 'clear' message lands in each worker's queue
	// ahead of the unregister/register cascade triggered by Svelte's
	// {#each items} diff. Otherwise the queue ends up as:
	//   [render(old cells, pre-click), unreg…, reg…, clear, render(new cells)]
	// and the worker briefly paints the previous tab's content after we
	// thought we'd wiped it. With the clear posted first the surface is
	// blank before any new cells get a chance to register on it.
	function goToTab(key) {
		if (key === active && isStandalone(key)) return;
		const wasStandalone = isStandalone(active);
		const toStandalone = isStandalone(key);
		// Standalone destination: clear the canvases (we're swapping
		// render branches) and just set active.
		if (toStandalone) {
			clearSkottieCanvases();
			active = key;
			return;
		}
		// Flowing destination. Suppress the scroll-derived active sync
		// while we move scrollTop, otherwise the snap reads its own
		// transient position back out as a user gesture.
		_programmaticActive = true;
		if (wasStandalone) {
			// Coming from standalone (Effects/Custom): need to clear
			// the previous-branch canvas first, then mount the flow
			// branch via `active`, then scrollTo on the next tick
			// once the flow's {#each} has produced real geometry.
			clearSkottieCanvases();
			active = key;
			queueMicrotask(() => {
				const target = flowingGeometry.find((g) => g.key === key);
				if (target && gridWrapEl) {
					gridWrapEl.scrollTo({ top: target.pxStart, behavior: 'instant' });
					scrollTop = target.pxStart;
				}
				queueMicrotask(() => { _programmaticActive = false; });
			});
			return;
		}
		// Flow → flow: section is already mounted, just glide there.
		active = key;
		const target = flowingGeometry.find((g) => g.key === key);
		if (target && gridWrapEl) {
			gridWrapEl.scrollTo({ top: target.pxStart, behavior: 'smooth' });
		}
		queueMicrotask(() => { _programmaticActive = false; });
	}

	// Scroll-derived active-tab sync. Runs only when the flow render
	// is the active branch (not standalone, not in a search). Walks
	// the geometry forward and remembers the LAST section whose
	// pxStart ≤ scrollTop; that's the section currently nearest the
	// top edge, regardless of scroll direction.
	function syncActiveFromScroll() {
		if (isStandalone(active) || search.trim()) return;
		if (_programmaticActive) return;
		if (!flowingGeometry.length) return;
		const top = scrollTop + 4;
		let foundKey = flowingGeometry[0].key;
		for (const g of flowingGeometry) {
			if (g.pxStart <= top) foundKey = g.key;
			else break;
		}
		if (foundKey !== active) {
			_programmaticActive = true;
			active = foundKey;
			queueMicrotask(() => { _programmaticActive = false; });
		}
	}

	// Virtualization math — `gridWrapEl.clientWidth` includes the wrap's
	// horizontal padding, but the grid inside lays out against the
	// padding-deducted inner width. Subtract it or we overcount cells per
	// row and unmount the leading edge of the viewport.
	const cellsPerRow = $derived(
		Math.max(1, Math.floor((gridW - GRID_PAD_X * 2) / CELL_PX))
	);
	function measureGrid() {
		if (!gridWrapEl) return;
		gridH = gridWrapEl.clientHeight;
		gridW = gridWrapEl.clientWidth;
	}
	function onGridScroll(e) {
		scrollTop = e.target.scrollTop;
		if (_fillFrac < 1) _fillFrac = 1; // scrolling needs the whole band now
		syncActiveFromScroll();
	}
	onMount(() => {
		measureGrid();
		// Grow the live band to full over successive frames (see _fillFrac). Each
		// frame mounts ~a row or two more, keeping every frame under budget.
		if (_fillFrac < 1) {
			let raf = 0;
			const grow = () => {
				_fillFrac = Math.min(1, _fillFrac + 0.16);
				if (_fillFrac < 1) raf = requestAnimationFrame(grow);
			};
			raf = requestAnimationFrame(grow);
			return () => cancelAnimationFrame(raf);
		}
	});
	$effect(() => { active; queueMicrotask(measureGrid); });

	// Keep the active tab on-screen in the horizontal strip. When vertical
	// scrolling (or a click) changes `active`, nudge `.tg-tabs` just enough
	// to bring the highlighted tab fully into view — important once there
	// are many custom-pack tabs that overflow the strip. Scrolls ONLY the
	// strip horizontally (rect math), never the page or the grid.
	$effect(() => {
		active;
		if (!tabsEl) return;
		tick().then(() => {
			if (!tabsEl) return;
			const el = tabsEl.querySelector('.tg-tab.active');
			if (!el) return;
			const barRect = tabsEl.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();
			const left = elRect.left - barRect.left + tabsEl.scrollLeft;
			const right = left + elRect.width;
			const PAD = 16;
			if (left < tabsEl.scrollLeft + PAD) {
				tabsEl.scrollTo({ left: Math.max(0, left - PAD), behavior: 'smooth' });
			} else if (right > tabsEl.scrollLeft + tabsEl.clientWidth - PAD) {
				tabsEl.scrollTo({ left: right - tabsEl.clientWidth + PAD, behavior: 'smooth' });
			}
		});
	});
	const visibleStart = $derived(
		Math.max(0, (Math.floor(scrollTop / CELL_PX) - BUFFER_ROWS) * cellsPerRow)
	);
	const visibleEnd = $derived(
		visibleStart + Math.ceil((Math.ceil(gridH / CELL_PX) + BUFFER_ROWS * 2) * cellsPerRow * _fillFrac)
	);

	// Filter custom items — CLDR name + keywords only count for packs where the
	// user has explicitly opted in via the per-pack toggle (default OFF).
	// In flow mode, an active search spans EVERY flowing category's items
	// (Smileys + People + Animals + every pack) collapsed into one flat
	// result list. Standalone tabs (Effects, Custom) and a non-search
	// active tab keep their existing single-category scope.
	const _searchPool = $derived.by(() => {
		const q = search.trim();
		if (!q || isStandalone(active)) return items;
		const seen = new Set();
		const out = [];
		for (const s of flowingSections) {
			for (const it of s.items) {
				const key = it.custom ? `c:${it.id}` : `u:${it.cp}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(it);
			}
		}
		return out;
	});
	const filteredItems = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return items;
		return _searchPool.filter((it) => {
			if (it.custom) {
				const useCldr = cldrEnabled[it.short] === true;
				if (useCldr && (it.name || '').toLowerCase().includes(q)) return true;
				if (useCldr && it.kw?.some((k) => k.toLowerCase().includes(q))) return true;
				if ((it.alt || '').includes(q)) return true;
				if ((it.packTitle || '').toLowerCase().includes(q)) return true;
				return false;
			}
			return (it.e || '').includes(q);
		});
	});
</script>

<div class="tg-panel" bind:this={panelEl}>
	<div class="tg-tabs-bar">
		{#if onClose}
			<PickerStickyBtn square onclick={onClose} title="Close" label="Close picker">
				<span class="msi msi-20">close</span>
			</PickerStickyBtn>
		{/if}
		<div class="tg-tabs" bind:this={tabsEl}>
			{#each headCats as cat (cat.key)}
				<button class="tg-tab" class:active={active === cat.key} title={cat.label} onclick={() => goToTab(cat.key)}>{cat.icon}</button>
			{/each}
			{#if packCats.length}
				<span class="tg-tab-sep" aria-hidden="true">+</span>
			{/if}
			{#each packCats as cat (cat.key)}
				<button class="tg-tab tg-tab-pack" class:active={active === cat.key} title={cat.label} onclick={() => goToTab(cat.key)}>
					<!-- Tab icons live outside the grid's scroll content (the
					     Skottie stage host), so force them onto the rlottie
					     engine so they animate in both engine modes. `eager`
					     skips the 150 ms scroll-settle delay so they spring
					     to life the moment the picker opens. -->
					<LottieSticker short={cat.pack.short} id={cat.pack.firstId} size={22} mode="visible"
						loop={true} root={tabsEl} title={cat.label}
						forceEngine="rlottie" eager={true} />
				</button>
			{/each}
		</div>
	</div>

	{#if activeCat?.pack && isStandalone(active)}
		<!-- Pack header (with its emoji-name-search opt-in toggle) is
		     only meaningful when the picker is parked on one specific
		     pack tab as its own standalone view. In flow mode the
		     section labels already name each pack inline and the user
		     can search across everything via the search row below. -->
		<div class="tg-pack-header">
			<span class="tg-pack-title">{activeCat.label} <span class="tg-pack-count">· {items.length}</span></span>
			<label class="tg-cldr-toggle" title="Include the underlying emoji's CLDR name + keywords in search (e.g. 😀 → 'grinning, happy, smile').">
				<input type="checkbox" checked={!!cldrEnabled[activeCat.pack.short]}
					onchange={() => togglePackCldr(activeCat.pack.short)} />
				<span>emoji-name search</span>
			</label>
		</div>
	{/if}
	{#if active !== 'Effects'}
		<div class="tg-mode-row">
			<span class="tg-mode-label">Send as:</span>
			<button class="tg-mode-btn" class:active={customMode === 'animated'} onclick={() => (customMode = 'animated')}>Animated</button>
			<button class="tg-mode-btn" class:active={customMode === 'emoji'} onclick={() => (customMode = 'emoji')}>Emoji</button>
		</div>
		<div class="tg-search-row">
			<input class="tg-search" type="search" placeholder="search by name, keyword, emoji…"
				bind:value={search} />
			{#if search}<button class="tg-search-clear" onclick={() => (search = '')} title="Clear">×</button>{/if}
		</div>
		{#if canModerate}
			<div class="tg-mod-row">
				<button class="tg-mod-btn" class:active={moderating}
					onclick={() => (moderating = !moderating)}
					title={moderating ? 'Done hiding — tap emotes to insert again' : 'Hide emotes: tap any to hide it from students'}>
					<span class="msi msi-18">{moderating ? 'check' : 'visibility_off'}</span>
					{moderating ? 'Done hiding' : 'Hide emotes'}
				</button>
				{#if _showHidden}
					<span class="tg-mod-hint-inline">Tap to hide · tap a dimmed one to unhide</span>
				{/if}
			</div>
		{/if}
	{/if}
	<!-- Non-scrolling host for the Skottie canvas (see setSkottieHosts
	     $effect). The canvas mounts here as position:absolute and stays
	     pinned to the viewport while .tg-grid-wrap scrolls inside it. -->
	<div class="tg-grid-outer" bind:this={gridOuterEl}>
	<div class="tg-grid-wrap" bind:this={gridWrapEl} onscroll={onGridScroll}>
		{#if loading}
			<div class="tg-loading"><span class="tg-spinner"></span>Loading…</div>
		{:else if isStandalone(active) || search.trim()}
			<!-- Standalone view: Effects, Custom, or active search.
			     Single flat grid, index-virtualized against scrollTop. -->
			<div class="tg-grid" bind:this={gridEl}>
				{#each filteredItems as it, i (it.custom ? `c:${it.id}` : it.cp + ':' + i)}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="tg-cell" class:tg-cell-hidden={_showHidden && _isCellHidden(it)}
						title={it.custom
							? `${it.name || it.alt}  ${it.alt}  ·  ${it.packTitle}${it.kw?.length ? '\n' + it.kw.slice(0, 6).join(', ') : ''}`
							: it.e}
						onclick={() => cellAction(it)}>
						{#if i >= visibleStart && i < visibleEnd}
							{#if it.custom}
								<LottieSticker short={it.short} id={it.id} size={24} mode="visible"
									ignoreHidden={_showHidden} root={gridWrapEl} title={it.alt} />
							{:else}
								<LottieSticker cp={it.cp} flag={it.flag} size={24} mode="visible"
									ignoreHidden={_showHidden} root={gridWrapEl} title={it.e} />
							{/if}
						{/if}
					</div>
				{/each}
				{#if filteredItems.length === 0 && search}
					<div class="tg-empty">no matches for "{search}"</div>
				{/if}
			</div>
		{:else}
			<!-- Flow view: a fixed-height container with sections pinned
			     at their pxStart via `position: absolute`. The grid's
			     total height is locked at the last section's pxEnd, so
			     virtualization (mount / unmount of individual sections)
			     never changes the grid's clientHeight. That's the only
			     reliable way to stop the `ResizeObserver` on `gridEl`
			     from firing during scroll — every observer fire posts
			     a `resize` to the Skottie worker, which destroys and
			     recreates the WebGL surface, which forces every cell
			     into a 15-paint CSS-thumb warmup. With sections pinned
			     absolutely, the container height is a stable function
			     of `flowingGeometry` (which only changes when the
			     section list or cells-per-row changes, not when
			     visibility flips). -->
			{@const totalHeight = flowingGeometry.length ? flowingGeometry[flowingGeometry.length - 1].pxEnd : 0}
			{@const _cpr = Math.max(1, cellsPerRow)}
			{@const _cellVisTop = scrollTop - CELL_PX * 2}
			{@const _cellVisBot = scrollTop + (gridH + CELL_PX * 2) * _fillFrac}
			<div class="tg-grid tg-grid-flow" bind:this={gridEl} style:height="{totalHeight}px">
				{#each flowingSections as section, sIdx (section.key)}
					{@const geo = flowingGeometry[sIdx]}
					{@const sectionVisible = geo
						&& geo.pxEnd >= scrollTop - 100
						&& geo.pxStart <= scrollTop + gridH + 100}
					{#if sectionVisible}
						<div class="tg-section" style:top="{geo.pxStart}px" style:height="{geo.pxEnd - geo.pxStart}px">
							<div class="tg-section-label">{section.label}</div>
							<div class="tg-section-grid">
								{#each section.items as it, i (it.custom ? `${section.key}:c:${it.id}` : `${section.key}:${it.cp}:${i}`)}
									<!-- Cell-level virtualization. Compute each
									     cell's absolute pixel band from
									     `geo.pxStart + HEADER_PX + row * CELL_PX`,
									     mount the LottieSticker only if that band
									     intersects the visible viewport (± two
									     rows of buffer for pre-fetch). Off-viewport
									     cells render as bare 36×36 div slots so
									     the flex-wrap layout inside the section
									     still lays them out at their correct row /
									     column, but the Skottie worker only sees
									     the ~visible-row × cellsPerRow cells, not
									     every cell in every in-band section. -->
									{@const _cellAbsY = geo.pxStart + HEADER_PX + Math.floor(i / _cpr) * CELL_PX}
									{@const _cellLive = _cellAbsY + CELL_PX > _cellVisTop && _cellAbsY < _cellVisBot}
									<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
									<div class="tg-cell" class:tg-cell-hidden={_showHidden && _isCellHidden(it)}
										title={it.custom
											? `${it.name || it.alt}  ${it.alt}  ·  ${it.packTitle}${it.kw?.length ? '\n' + it.kw.slice(0, 6).join(', ') : ''}`
											: it.e}
										onclick={() => cellAction(it)}>
										{#if _cellLive}
											{#if it.custom}
												<LottieSticker short={it.short} id={it.id} size={24} mode="visible"
													ignoreHidden={_showHidden} root={gridWrapEl} title={it.alt} />
											{:else}
												<LottieSticker cp={it.cp} flag={it.flag} size={24} mode="visible"
													ignoreHidden={_showHidden} root={gridWrapEl} title={it.e} />
											{/if}
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
	</div>
	<div class="tg-foot">
		<button class="tg-engine-toggle"
			title="Toggle render engine. CPU = rlottie WASM (pixel-perfect). GPU = Skia/Skottie main thread. WorkerGPU = Skia/Skottie in a worker (default on desktop). WebGPU = experimental, requires WebGPU-capable browser."
			onclick={() => setEngineManual((e =>
				e === 'rlottie' ? 'skottie'
				: e === 'skottie' ? 'skottie-worker'
				: e === 'skottie-worker' ? 'skottie-webgpu'
				: e === 'skottie-webgpu' ? 'webgpu-rasterized'
				: e === 'webgpu-rasterized' ? 'cpu-rasterized'
				: 'rlottie'
			)($engineMode))}>
			Engine: <strong>{
				$engineMode === 'cpu-rasterized' ? 'Rasterized (CPU)'
				: $engineMode === 'webgpu-rasterized' ? 'Rasterized'
				: $engineMode === 'skottie-webgpu' ? 'WebGPU'
				: $engineMode === 'skottie-worker' ? 'WorkerGPU'
				: $engineMode === 'skottie' ? 'GPU'
				: 'CPU'
			}</strong>
		</button>
		<span class="tg-foot-status">
			{#if active === 'Custom' || activeCat?.pack}{items.length} items · {customMode === 'animated' ? 'animated' : 'unicode'}
			{:else}click in chat to replay{/if}
		</span>
	</div>
</div>

<style>
	.tg-panel {
		width: 340px; height: 420px;
		background: var(--paper, var(--paper)); color: var(--ink, var(--ink));
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		display: flex; flex-direction: column; overflow: hidden;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-size: 0.85rem;
	}
	/* Mobile: full-width docked sheet above the input bar. Height
	   accommodates the full chrome stack (tabs + mode-row + search
	   on custom packs) so the grid always shows ≥3 rows × 8 cells
	   = 24 emoji. The footer (engine toggle / status) is hidden —
	   touch devices force rlottie anyway, so the toggle is moot, and
	   the status string doesn't fit at this width. */
	@media (max-width: 640px) {
		.tg-panel {
			width: 100%;
			height: 268px;
			border-radius: 14px 14px 0 0;
			box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
		}
		/* Bigger cell pitch on mobile (44 px) — keep the rendered
		   sprite/canvas sized to match so emoji don't look squished. */
		:global(.tg-cell) {
			width: 44px !important;
			height: 44px !important;
		}
		/* Keep the footer on mobile so the render-engine toggle is
		   reachable in the iOS PWA (no hover/devtools there) — but compact
		   it: drop the status text and make the toggle a tappable chip so
		   it costs only one slim row. */
		.tg-foot { padding: 0.25rem 0.5rem; }
		.tg-foot-status { display: none; }
		.tg-engine-toggle {
			padding: 0.35rem 0.6rem !important;
			font-size: 0.72rem !important;
			min-height: 1.9rem;
		}
		/* Compact the tab strip + mode row a touch so the grid gets
		   more of the panel. */
		.tg-tab, .tg-tab-pack { padding: 0.3rem 0.5rem !important; }
		.tg-mode-row { padding: 0.2rem 0.5rem !important; }
		.tg-search-row { padding: 0.2rem 0.5rem 0.25rem !important; }
	}
	.tg-tabs-bar { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.5rem; border-bottom: 1.5px solid var(--border); background: var(--surface-2); flex-shrink: 0; }
	/* overscroll-behavior-x keeps a drag past the end of the pack strip from
	   chaining out to the ExpressionPicker's category pager. */
	.tg-tabs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 1px; overflow-x: auto; overscroll-behavior-x: contain; }
	.tg-tabs::-webkit-scrollbar { height: 0; }
	/* No opacity fade on unselected tabs; hover/active mirror the
	   ExpressionPicker strip (M3 state layer + secondary container) so
	   all the category bars read as one family. */
	.tg-tab { flex: 1 0 auto; min-width: 34px; padding: 0.45rem 0; border: none; background: none; font-size: 1.05rem; line-height: 1; cursor: pointer; border-radius: 10px; transition: background 0.13s; }
	.tg-tab:hover:not(.active) { background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 7%, transparent); }
	.tg-tab.active {
		background: var(--md-sys-color-secondary-container, var(--surface-2));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
	}
	.tg-tab-pack { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; padding: 0.3rem 0.18rem; }
	.tg-tab-sep { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; padding: 0 0.35rem; color: #b8aea0; font-size: 0.85rem; font-weight: 700; user-select: none; }

	.tg-pack-header { flex-shrink: 0; padding: 0.45rem 0.65rem 0.35rem; border-bottom: 1px solid var(--border); background: var(--paper); font-size: 0.82rem; font-weight: 600; color: var(--ink, var(--ink)); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.tg-pack-title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tg-pack-count { color: var(--muted-fg); font-weight: 400; font-size: 0.72rem; }
	.tg-cldr-toggle { display: flex; align-items: center; gap: 0.3rem; font-weight: 400; font-size: 0.68rem; color: var(--muted-fg); cursor: pointer; user-select: none; flex-shrink: 0; }
	.tg-cldr-toggle input[type="checkbox"] { margin: 0; accent-color: var(--ink, var(--ink)); cursor: pointer; }

	/* `overflow: clip` on both axes enforces a hard clipping region for
	   the WebGL stage canvas inside — `overflow-y: auto` alone lets a
	   GPU-composited child leak outside the wrap's visible bounds in
	   some browsers. `overflow-y: clip` is the same scroll behaviour
	   as `auto` for clipping purposes; we still scroll via the inner
	   grid's scrollable content. */
	/* Non-scrolling, viewport-sized host for the Skottie canvas. It
	   takes the flex slot in the panel column; the scroller (.tg-grid-wrap)
	   fills it. position:relative anchors the absolutely-positioned
	   canvas the worker mounts here so it stays pinned to the viewport
	   instead of scrolling away with the content. */
	.tg-grid-outer {
		flex: 1; min-height: 0;
		position: relative;
		display: flex; flex-direction: column;
	}
	.tg-grid-wrap {
		flex: 1; min-height: 0;
		overflow-y: auto; overflow-x: clip;
		/* Reserve gutter so clientWidth doesn't drop when the
		   scrollbar appears — otherwise cellsPerRow recomputes
		   (e.g. 9 → 8) the first time content overflows, which
		   re-runs `flowingGeometry`, changes section pxStarts,
		   shifts the absolute-positioned sections, and looks like
		   a layout pop on first scroll. */
		scrollbar-gutter: stable;
		padding: 0.3rem 0.25rem;
		contain: paint; isolation: isolate;
	}
	.tg-grid-wrap::-webkit-scrollbar { width: 4px; }
	.tg-grid-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
	/* Match the regular EmojiPicker: 36×36 cells, no gap, light hover. */
	.tg-grid { display: flex; flex-wrap: wrap; gap: 0; }
	/* Flow variant: explicit-height container, sections pinned at
	   their precomputed pxStart. Container height is locked at
	   `flowingGeometry`'s last pxEnd, so the ResizeObserver on
	   `gridEl` never fires from section virtualization. The Skottie
	   stage's surface stays alive across the entire scroll. */
	.tg-grid-flow {
		display: block;
		position: relative;
		flex-wrap: initial;
	}
	.tg-grid-flow .tg-section {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
	}
	.tg-grid-flow .tg-section-label {
		flex: 0 0 26px;
		height: 26px;
		padding: 0.45rem 0.35rem 0.1rem;
		box-sizing: border-box;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}
	.tg-grid-flow .tg-section-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
	}
	.tg-cell { width: 36px; height: 36px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.12s; }
	.tg-cell:hover { background: var(--surface-2); }
	/* Moderation: a hidden emote shown to the instructor is dimmed + struck. */
	.tg-cell-hidden { position: relative; opacity: 0.4; }
	.tg-cell-hidden::after {
		content: ''; position: absolute; inset: 6px;
		background: repeating-linear-gradient(-45deg, transparent 0 3px, color-mix(in srgb, var(--ink) 30%, transparent) 3px 4px);
		border-radius: 4px; pointer-events: none;
	}
	.tg-cell-hidden:hover { opacity: 0.7; }

	.tg-mod-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.15rem 0.6rem 0.35rem; background: var(--surface-2); border-bottom: 1px solid var(--border); flex-shrink: 0; }
	.tg-mod-btn { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.2rem 0.55rem; border: 1.5px solid var(--border); border-radius: 6px; background: var(--paper); color: var(--muted-fg); font-family: inherit; font-size: 0.74rem; cursor: pointer; transition: all 0.13s; }
	.tg-mod-btn .msi-18 { font-size: 16px; }
	.tg-mod-btn.active { background: #b42318; border-color: #b42318; color: #fff; }
	.tg-mod-hint-inline { font-size: 0.7rem; color: var(--muted-fg); }

	.tg-loading { display: flex; align-items: center; gap: 0.5rem; color: var(--muted-fg); font-size: 0.82rem; justify-content: center; padding: 1.5rem 0; }
	.tg-spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--ink, var(--ink)); border-radius: 50%; animation: tgspin 0.8s linear infinite; }
	@keyframes tgspin { to { transform: rotate(360deg); } }

	.tg-foot {
		flex-shrink: 0; padding: 0.3rem 0.55rem;
		border-top: 1px solid var(--border);
		font-size: 0.66rem; color: var(--muted-fg);
		display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
	}
	.tg-engine-toggle {
		background: var(--surface-2); border: 1px solid var(--border); color: #5a5147;
		border-radius: 5px; padding: 0.15rem 0.45rem;
		font: inherit; font-size: 0.65rem; cursor: pointer;
		transition: background 0.1s;
	}
	.tg-engine-toggle:hover { background: #e0d8c5; }
	.tg-engine-toggle strong { color: var(--ink); font-weight: 600; }
	.tg-foot-status { flex: 1; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.tg-mode-row { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.55rem; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--surface-2); }
	.tg-mode-label { font-size: 0.7rem; color: var(--muted-fg); font-weight: 600; }
	.tg-mode-btn { flex: 1; padding: 0.25rem 0; border: 1.5px solid var(--border); border-radius: 6px; background: var(--paper); color: var(--muted-fg); font-family: inherit; font-size: 0.74rem; cursor: pointer; transition: all 0.13s; }
	/* active = ink tile with paper text — flips correctly with the theme
	   (the old hardcoded #fff was white-on-white in dark mode) */
	.tg-mode-btn.active { background: var(--ink, var(--ink)); color: var(--paper, #fff); border-color: var(--ink, var(--ink)); }

	.tg-search-row { position: relative; padding: 0.25rem 0.55rem 0.35rem; border-bottom: 1px solid var(--border); background: var(--surface-2); flex-shrink: 0; }
	.tg-search { width: 100%; box-sizing: border-box; padding: 0.3rem 1.6rem 0.3rem 0.55rem; border: 1.5px solid var(--border); border-radius: 6px; background: var(--paper); font-family: inherit; font-size: 0.78rem; color: var(--ink, var(--ink)); outline: none; transition: border-color 0.13s; }
	.tg-search:focus { border-color: var(--ink, var(--ink)); }
	.tg-search::placeholder { color: var(--muted-fg); }
	.tg-search-clear { position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; border: none; border-radius: 50%; background: var(--border); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; }
	.tg-search-clear:hover { background: var(--ink, var(--ink)); }

	.tg-empty { width: 100%; padding: 1.5rem 0; text-align: center; color: var(--muted-fg); font-size: 0.78rem; }
</style>
