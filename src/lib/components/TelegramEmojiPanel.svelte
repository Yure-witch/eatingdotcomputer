<script>
	import { onMount } from 'svelte';
	import { loadTelegramEmoji, loadCustomPacks } from '$lib/telegram-emoji-store.js';
	import LottieSticker from './LottieSticker.svelte';

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
	let tabsEl = $state(null);
	// Virtualization — render LottieStickers only for cells in viewport + buffer.
	// Cell layout is preserved via empty <div class="tg-cell"> placeholders so the
	// scrollbar stays accurate without measuring every emoji.
	const CELL_PX = 56;            // 52 cell + ~4 gap
	const BUFFER_ROWS = 3;
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
	const isEffectsTab = $derived(active === 'Effects');
	const activeCat = $derived(
		headCats.find((c) => c.key === active) || packCats.find((c) => c.key === active) || null
	);

	// Reset search + scroll when the user switches tabs
	$effect(() => { active; search = ''; if (gridWrapEl) gridWrapEl.scrollTop = 0; scrollTop = 0; });

	// Virtualization math — works off the live grid container width.
	const cellsPerRow = $derived(Math.max(1, Math.floor(gridW / CELL_PX)));
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

<div class="tg-panel">
	<div class="tg-tabs" bind:this={tabsEl}>
		{#each headCats as cat (cat.key)}
			<button class="tg-tab" class:active={active === cat.key} title={cat.label} onclick={() => (active = cat.key)}>{cat.icon}</button>
		{/each}
		{#if packCats.length}
			<span class="tg-tab-sep" aria-hidden="true">+</span>
		{/if}
		{#each packCats as cat (cat.key)}
			<button class="tg-tab tg-tab-pack" class:active={active === cat.key} title={cat.label} onclick={() => (active = cat.key)}>
				<LottieSticker short={cat.pack.short} id={cat.pack.firstId} size={22} mode="visible"
					root={tabsEl} title={cat.label} />
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
			<div class="tg-grid">
				{#each filteredItems as it, i (it.custom ? `c:${it.id}` : it.cp + ':' + i)}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="tg-cell"
						title={it.custom
							? `${it.name || it.alt}  ${it.alt}  ·  ${it.packTitle}${it.kw?.length ? '\n' + it.kw.slice(0, 6).join(', ') : ''}`
							: it.e}
						onclick={() => onInsert(it.custom ? { ...it, mode: customMode } : it)}>
						{#if i >= visibleStart && i < visibleEnd}
							{#if it.custom}
								<LottieSticker short={it.short} id={it.id} size={44} mode="visible"
									root={gridWrapEl} title={it.alt} />
							{:else}
								<LottieSticker cp={it.cp} flag={it.flag} size={44} mode="visible"
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
		{#if active === 'Custom' || activeCat?.pack}{items.length} items · {customMode === 'animated' ? 'click sends animated Lottie' : 'click sends plain Unicode emoji'}
		{:else}Telegram animated emoji · click in chat to play{/if}
	</div>
</div>

<style>
	.tg-panel {
		width: 340px; height: 420px;
		background: var(--paper, #f7f2ea); color: var(--ink, #1a1a1a);
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		display: flex; flex-direction: column; overflow: hidden;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-size: 0.85rem;
	}
	.tg-tabs { display: flex; gap: 1px; border-bottom: 1.5px solid #e8e0d2; background: #f0ebe0; flex-shrink: 0; overflow-x: auto; }
	.tg-tabs::-webkit-scrollbar { height: 0; }
	.tg-tab { flex: 1 0 auto; min-width: 34px; padding: 0.45rem 0; border: none; background: none; font-size: 1.05rem; line-height: 1; cursor: pointer; opacity: 0.55; transition: opacity 0.13s, background 0.13s; border-bottom: 2px solid transparent; }
	.tg-tab:hover { opacity: 0.85; background: #ece5d8; }
	.tg-tab.active { opacity: 1; border-bottom-color: var(--ink, #1a1a1a); background: var(--paper, #f7f2ea); }
	.tg-tab-pack { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; padding: 0.3rem 0.18rem; }
	.tg-tab-sep { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; padding: 0 0.35rem; color: #b8aea0; font-size: 0.85rem; font-weight: 700; user-select: none; }

	.tg-pack-header { flex-shrink: 0; padding: 0.45rem 0.65rem 0.35rem; border-bottom: 1px solid #e8e0d2; background: #f7f2ea; font-size: 0.82rem; font-weight: 600; color: var(--ink, #1a1a1a); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.tg-pack-title { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tg-pack-count { color: #a09688; font-weight: 400; font-size: 0.72rem; }
	.tg-cldr-toggle { display: flex; align-items: center; gap: 0.3rem; font-weight: 400; font-size: 0.68rem; color: #6b5f54; cursor: pointer; user-select: none; flex-shrink: 0; }
	.tg-cldr-toggle input[type="checkbox"] { margin: 0; accent-color: var(--ink, #1a1a1a); cursor: pointer; }

	.tg-grid-wrap { flex: 1; overflow-y: auto; padding: 0.5rem 0.5rem; min-height: 0; }
	.tg-grid-wrap::-webkit-scrollbar { width: 4px; }
	.tg-grid-wrap::-webkit-scrollbar-thumb { background: #d5cdc0; border-radius: 2px; }
	.tg-grid { display: flex; flex-wrap: wrap; gap: 0.2rem; }
	.tg-cell { width: 52px; height: 52px; border-radius: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.12s, transform 0.1s; }
	.tg-cell:hover { background: #ece5d8; transform: scale(1.08); }

	.tg-loading { display: flex; align-items: center; gap: 0.5rem; color: #a09688; font-size: 0.82rem; justify-content: center; padding: 1.5rem 0; }
	.tg-spinner { width: 14px; height: 14px; border: 2px solid #d5cdc0; border-top-color: var(--ink, #1a1a1a); border-radius: 50%; animation: tgspin 0.8s linear infinite; }
	@keyframes tgspin { to { transform: rotate(360deg); } }

	.tg-foot { flex-shrink: 0; padding: 0.35rem 0.6rem; border-top: 1px solid #e8e0d2; font-size: 0.66rem; color: #a09688; text-align: center; }

	.tg-mode-row { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.55rem; border-bottom: 1px solid #e8e0d2; flex-shrink: 0; background: #f0ebe0; }
	.tg-mode-label { font-size: 0.7rem; color: #8a7f72; font-weight: 600; }
	.tg-mode-btn { flex: 1; padding: 0.25rem 0; border: 1.5px solid #d5cdc0; border-radius: 6px; background: #fff; color: #8a8078; font-family: inherit; font-size: 0.74rem; cursor: pointer; transition: all 0.13s; }
	.tg-mode-btn.active { background: var(--ink, #1a1a1a); color: #fff; border-color: var(--ink, #1a1a1a); }

	.tg-search-row { position: relative; padding: 0.25rem 0.55rem 0.35rem; border-bottom: 1px solid #e8e0d2; background: #f0ebe0; flex-shrink: 0; }
	.tg-search { width: 100%; box-sizing: border-box; padding: 0.3rem 1.6rem 0.3rem 0.55rem; border: 1.5px solid #d5cdc0; border-radius: 6px; background: #fff; font-family: inherit; font-size: 0.78rem; color: var(--ink, #1a1a1a); outline: none; transition: border-color 0.13s; }
	.tg-search:focus { border-color: var(--ink, #1a1a1a); }
	.tg-search::placeholder { color: #b0a898; }
	.tg-search-clear { position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; border: none; border-radius: 50%; background: #d5cdc0; color: #fff; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; }
	.tg-search-clear:hover { background: var(--ink, #1a1a1a); }

	.tg-empty { width: 100%; padding: 1.5rem 0; text-align: center; color: #a09688; font-size: 0.78rem; }
</style>
