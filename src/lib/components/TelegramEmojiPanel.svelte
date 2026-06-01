<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import {
		loadTelegramEmoji,
		loadCustomPacks,
		loadSpriteSheet,
		engineMode
	} from '$lib/telegram-emoji-store.js';
	// Picker uses a pre-rasterised sprite renderer: each emoji is rendered
	// once via rlottie (the worker WASM renderer Telegram itself uses for
	// TGS) into an ImageBitmap array, then cells blit frames[i] per tick.
	// Pixel-perfect, scales to hundreds of concurrent cells. Chat bubbles
	// still use lottie-web SVG directly.
	import LottieSticker from './SpriteSticker.svelte';
	import { prewarm as prewarmSprites } from '$lib/lottie-spritesheet.js';
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

	let { onInsert } = $props();

	// display order + tab icon for each Telegram-category present in the manifest
	const CAT_ORDER = [
		{ key: 'Smileys', icon: '😀' }, { key: 'People', icon: '🧑' },
		{ key: 'Animals and Nature', icon: '🐻' }, { key: 'Food and Drink', icon: '🍔' },
		{ key: 'Activity', icon: '⚽' }, { key: 'Travel and Places', icon: '✈️' },
		{ key: 'Objects', icon: '💡' }, { key: 'Symbols', icon: '❤️' },
		{ key: 'Flags', icon: '🏁' }, { key: 'Other', icon: '➕' }
	];

	let loading = $state(true);
	let byCat = $state({});
	let headCats = $state([]); // [{key, label, icon}] — Effects, Custom, Smileys, …, Other
	let packCats = $state([]); // [{key, label, pack: {short, firstId}}] — one per custom pack
	let active = $state('Effects');
	// Scrollable containers, passed to each LottieSticker as IntersectionObserver root
	// so off-screen cells/tabs actually pause instead of always being "visible".
	let gridWrapEl = $state(null);
	let gridEl = $state(null);  // .tg-grid — Skottie stage canvas mounts inside this so it scrolls with content
	let tabsEl = $state(null);
	let panelEl = $state(null);
	// Virtualization — render LottieStickers only for cells in viewport + buffer.
	// Cell layout is preserved via empty <div class="tg-cell"> placeholders so the
	// scrollbar stays accurate without measuring every emoji.
	const CELL_PX = 36;            // matches the regular EmojiPicker's 36×36 cell pitch (gap: 0)
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
	const BUFFER_ROWS = 20;
	let scrollTop = $state(0);
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
		const orderMap = {};
		const metaByCp = {};
		try {
			const d = await fetch('/emoji-data.json', { cache: 'force-cache' }).then(r => r.json());
			let i = 0;
			for (const g of d.groups || []) for (const it of g.items || []) {
				const key = cpKey(it.cp);
				orderMap[key] = i++;
				metaByCp[key] = { name: it.n || '', kw: it.kw || [] };
			}
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

		// Aggregate all custom emoji into one "Custom" category, preserving pack-then-pack order
		if (custom?.flatAll?.length) {
			sorted['Custom'] = custom.flatAll.map((it) => toCustomItem(it, null));
		}

		// Per-pack tabs: each pack gets its own tab (icon = first emoji animated)
		const packTabsLocal = [];
		for (const p of (custom?.packs || [])) {
			const key = 'pack:' + p.short_name;
			sorted[key] = p.emoji.map((e) => toCustomItem(e, p));
			if (p.emoji[0]?.id) packTabsLocal.push({ key, label: p.title, pack: { short: p.short_name, firstId: p.emoji[0].id } });
		}

		byCat = sorted;
		const head = [];
		if (fx.length) head.push({ key: 'Effects', label: 'Effects', icon: '✨' });
		if (sorted['Custom']?.length) head.push({ key: 'Custom', label: 'Custom', icon: '🎨' });
		for (const c of CAT_ORDER) {
			if (sorted[c.key]?.length) head.push({ key: c.key, label: c.key, icon: c.icon });
		}
		headCats = head;
		packCats = packTabsLocal;
		if (!byCat[active]) active = head[0]?.key ?? packTabsLocal[0]?.key ?? '';
		loading = false;
	});

	const items = $derived(byCat[active] ?? []);

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

	// Wire the Skottie stage canvas into the grid the moment .tg-grid
	// is bound. We can't do this in onMount because `loading` is still
	// true at that point and the .tg-grid element doesn't exist yet.
	$effect(() => {
		if (gridEl && gridWrapEl) setSkottieHosts(gridEl, gridWrapEl);
	});

	// Tab change side-effects. We still listen reactively to `active` so
	// programmatic tab changes (e.g. the fallback in onMount that picks
	// the first available category) trigger them too, but the actual
	// canvas clear is fired SYNCHRONOUSLY inside `goToTab` below — see
	// the comment there for why timing matters.
	$effect(() => {
		active;
		search = '';
		if (gridWrapEl) gridWrapEl.scrollTop = 0;
		scrollTop = 0;
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
		if (key === active) return;
		clearSkottieCanvases();
		active = key;
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
	function onGridScroll(e) { scrollTop = e.target.scrollTop; }
	onMount(() => { measureGrid(); });
	$effect(() => { active; queueMicrotask(measureGrid); });
	const visibleStart = $derived(
		Math.max(0, (Math.floor(scrollTop / CELL_PX) - BUFFER_ROWS) * cellsPerRow)
	);
	const visibleEnd = $derived(
		visibleStart + (Math.ceil(gridH / CELL_PX) + BUFFER_ROWS * 2) * cellsPerRow
	);

	// Filter custom items — CLDR name + keywords only count for packs where the
	// user has explicitly opted in via the per-pack toggle (default OFF).
	const filteredItems = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return items;
		return items.filter((it) => {
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

	{#if activeCat?.pack}
		<div class="tg-pack-header">
			<span class="tg-pack-title">{activeCat.label} <span class="tg-pack-count">· {items.length}</span></span>
			<label class="tg-cldr-toggle" title="Include the underlying emoji's CLDR name + keywords in search (e.g. 😀 → 'grinning, happy, smile').">
				<input type="checkbox" checked={!!cldrEnabled[activeCat.pack.short]}
					onchange={() => togglePackCldr(activeCat.pack.short)} />
				<span>emoji-name search</span>
			</label>
		</div>
	{/if}
	{#if active === 'Custom' || activeCat?.pack}
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
	{/if}
	<div class="tg-grid-wrap" bind:this={gridWrapEl} onscroll={onGridScroll}>
		{#if loading}
			<div class="tg-loading"><span class="tg-spinner"></span>Loading…</div>
		{:else}
			<div class="tg-grid" bind:this={gridEl}>
				{#each filteredItems as it, i (it.custom ? `c:${it.id}` : it.cp + ':' + i)}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="tg-cell"
						title={it.custom
							? `${it.name || it.alt}  ${it.alt}  ·  ${it.packTitle}${it.kw?.length ? '\n' + it.kw.slice(0, 6).join(', ') : ''}`
							: it.e}
						onclick={() => onInsert(it.custom ? { ...it, mode: customMode } : it)}>
						{#if i >= visibleStart && i < visibleEnd}
							{#if it.custom}
								<LottieSticker short={it.short} id={it.id} size={24} mode="visible"
									root={gridWrapEl} title={it.alt} />
							{:else}
								<LottieSticker cp={it.cp} flag={it.flag} size={24} mode="visible"
									root={gridWrapEl} title={it.e} />
							{/if}
						{/if}
					</div>
				{/each}
				{#if filteredItems.length === 0 && search}
					<div class="tg-empty">no matches for "{search}"</div>
				{/if}
			</div>
		{/if}
	</div>
	<div class="tg-foot">
		<button class="tg-engine-toggle"
			title="Toggle render engine. CPU = rlottie WASM (pixel-perfect). GPU = Skia/Skottie on main thread (fast). WorkerGPU = Skia/Skottie in a Web Worker (fastest, frees the main thread)."
			onclick={() => engineMode.update(e =>
				e === 'rlottie' ? 'skottie'
				: e === 'skottie' ? 'skottie-worker'
				: 'rlottie'
			)}>
			Engine: <strong>{
				$engineMode === 'skottie-worker' ? 'WorkerGPU'
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
	.tg-tabs { display: flex; gap: 1px; border-bottom: 1.5px solid var(--border); background: var(--surface-2); flex-shrink: 0; overflow-x: auto; }
	.tg-tabs::-webkit-scrollbar { height: 0; }
	.tg-tab { flex: 1 0 auto; min-width: 34px; padding: 0.45rem 0; border: none; background: none; font-size: 1.05rem; line-height: 1; cursor: pointer; opacity: 0.55; transition: opacity 0.13s, background 0.13s; border-bottom: 2px solid transparent; }
	.tg-tab:hover { opacity: 0.85; background: var(--surface-2); }
	.tg-tab.active { opacity: 1; border-bottom-color: var(--ink, var(--ink)); background: var(--paper, var(--paper)); }
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
	.tg-grid-wrap { flex: 1; overflow-y: auto; overflow-x: clip; padding: 0.3rem 0.25rem; min-height: 0; contain: paint; isolation: isolate; }
	.tg-grid-wrap::-webkit-scrollbar { width: 4px; }
	.tg-grid-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
	/* Match the regular EmojiPicker: 36×36 cells, no gap, light hover. */
	.tg-grid { display: flex; flex-wrap: wrap; gap: 0; }
	.tg-cell { width: 36px; height: 36px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.12s; }
	.tg-cell:hover { background: var(--surface-2); }

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
	.tg-mode-label { font-size: 0.7rem; color: #8a7f72; font-weight: 600; }
	.tg-mode-btn { flex: 1; padding: 0.25rem 0; border: 1.5px solid var(--border); border-radius: 6px; background: var(--paper); color: #8a8078; font-family: inherit; font-size: 0.74rem; cursor: pointer; transition: all 0.13s; }
	.tg-mode-btn.active { background: var(--ink, var(--ink)); color: #fff; border-color: var(--ink, var(--ink)); }

	.tg-search-row { position: relative; padding: 0.25rem 0.55rem 0.35rem; border-bottom: 1px solid var(--border); background: var(--surface-2); flex-shrink: 0; }
	.tg-search { width: 100%; box-sizing: border-box; padding: 0.3rem 1.6rem 0.3rem 0.55rem; border: 1.5px solid var(--border); border-radius: 6px; background: var(--paper); font-family: inherit; font-size: 0.78rem; color: var(--ink, var(--ink)); outline: none; transition: border-color 0.13s; }
	.tg-search:focus { border-color: var(--ink, var(--ink)); }
	.tg-search::placeholder { color: var(--muted-fg); }
	.tg-search-clear { position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; border: none; border-radius: 50%; background: var(--border); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; }
	.tg-search-clear:hover { background: var(--ink, var(--ink)); }

	.tg-empty { width: 100%; padding: 1.5rem 0; text-align: center; color: var(--muted-fg); font-size: 0.78rem; }
</style>
