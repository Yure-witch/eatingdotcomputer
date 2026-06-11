<script module>
	import { loadEmojiNames } from '$lib/emoji-names.js';

	// Module-level cache — shared across all instances, survives unmount/remount
	let _kitchen = null;
	let _namesObj = null;
	let _popularTokens = null;
	let _kitchenP = null;
	let _namesP = null;
	let _popularP = null;

	export function preload() {
		if (!_kitchenP) _kitchenP = fetch('/emoji-kitchen.json')
			.then(r => r.ok ? r.json() : Promise.reject('Failed to load kitchen'))
			.then(d => { _kitchen = d; return d; })
			.catch(() => null);
		if (!_namesP) _namesP = loadEmojiNames()
			.then(d => { _namesObj = d; return d; });
		if (!_popularP) _popularP = fetch('/ek-popular-combined.json')
			.then(r => r.ok ? r.json() : Promise.reject('Failed'))
			.then(d => { _popularTokens = d; return d; })
			.catch(() => null);
	}
</script>

<script>
	import { onMount, onDestroy } from 'svelte';

	let { onInsert } = $props();

	// Scrollable content container — bound so the IntersectionObserver can
	// use it as its root (each tab renders inside this element).
	let kitchenContentEl = $state(null);

	// Single IO shared across every <img use:lazyImg> in the panel. Created
	// lazily after kitchenContentEl is bound. Without this, every popular
	// token (~11k+) would issue a network fetch + decode pass as soon as
	// it mounted, even with native loading="lazy" — Chrome's pre-fetch
	// margin under a tall flex container is generous enough to fire
	// hundreds of requests at once.
	let _kitchenIO = null;
	function ensureIO() {
		if (_kitchenIO || !kitchenContentEl) return _kitchenIO;
		_kitchenIO = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const url = e.target.dataset.lazyUrl;
				if (url && e.target.getAttribute('src') !== url) {
					e.target.src = url;
				}
				// One-shot: stop observing once the src is bound so the
				// browser's own decode/cache takes over. Re-observing on
				// scroll-out would cause flicker without saving anything
				// meaningful (the PNG is now in the HTTP cache).
				_kitchenIO.unobserve(e.target);
			}
		}, {
			root: kitchenContentEl,
			// Pre-load images ~one screen above/below the viewport so they
			// fade in just before the user scrolls to them.
			rootMargin: '300px 0px'
		});
		return _kitchenIO;
	}

	// use:lazyImg={url} — registers the <img> with the panel's IO. The
	// element renders without an `src` attribute until it scrolls into
	// (or near) the viewport, at which point the IO sets `src` and
	// unobserves. If the URL changes while still pending, the dataset
	// hint updates so the next intersect uses the new URL.
	function lazyImg(node, url) {
		node.dataset.lazyUrl = url;
		const start = () => {
			const io = ensureIO();
			if (io) io.observe(node);
		};
		start();
		// If kitchenContentEl wasn't bound yet (action ran before {#if}
		// chain attached the container), retry on the next frame.
		if (!_kitchenIO) requestAnimationFrame(start);
		return {
			update(newUrl) {
				node.dataset.lazyUrl = newUrl;
				if (node.src && node.src !== newUrl) node.src = newUrl;
			},
			destroy() {
				_kitchenIO?.unobserve(node);
			}
		};
	}

	onDestroy(() => {
		_kitchenIO?.disconnect();
		_kitchenIO = null;
		_virtRO?.disconnect();
		_virtRO = null;
	});

	// ── Rank-tab virtualization ──────────────────────────────────────
	// Popular alone has ~11k entries. Even rendering 11k empty <div>s on
	// tab open is enough to lock the main thread for ~half a second on
	// mobile. Mount only the rows visible in the viewport (+ a small
	// buffer), and slide them inside a tall spacer that preserves the
	// real scroll height so the scrollbar still tracks correctly.
	const VIRT_GAP = 6.4;            // 0.4rem in px; matches .popular-grid gap
	const VIRT_MIN_CELL = 56;        // grid-template-columns minmax(56px, 1fr)
	const VIRT_BUFFER_ROWS = 4;      // rows kept mounted above/below viewport
	const VIRT_THRESHOLD = 80;       // tokens below this — skip virtualization

	let virtScrollTop = $state(0);
	let virtContainerH = $state(440);
	let virtCols = $state(5);
	let virtRowH = $state(72);
	let virtGridEl = $state(null);
	let _virtRO = null;

	function measureVirt() {
		if (!virtGridEl || !kitchenContentEl) return;
		const w = virtGridEl.clientWidth;
		if (w > 0) {
			virtCols = Math.max(1, Math.floor((w + VIRT_GAP) / (VIRT_MIN_CELL + VIRT_GAP)));
		}
		const firstCell = virtGridEl.querySelector('.mix-result-item');
		if (firstCell) {
			const r = firstCell.getBoundingClientRect();
			if (r.height > 0) virtRowH = r.height + VIRT_GAP;
		}
		virtContainerH = kitchenContentEl.clientHeight || virtContainerH;
	}

	// Re-measure on container resize (window resize, picker open/close).
	$effect(() => {
		if (!kitchenContentEl) return;
		_virtRO?.disconnect();
		_virtRO = new ResizeObserver(() => measureVirt());
		_virtRO.observe(kitchenContentEl);
		measureVirt();
	});

	// Re-measure the moment a grid mounts (mode swap → new bind).
	$effect(() => {
		if (virtGridEl) requestAnimationFrame(measureVirt);
	});

	// Reset scroll position whenever the active tab/mode changes —
	// otherwise a deep scroll on Popular carries over to Gboard etc.
	$effect(() => {
		mode;
		virtScrollTop = 0;
		if (kitchenContentEl) kitchenContentEl.scrollTop = 0;
	});

	function onKitchenScroll(e) {
		virtScrollTop = e.currentTarget.scrollTop;
	}

	// Resolve { startIdx, endIdx, padTop, totalH } for a token list. When
	// the list is short we bail out and tell the caller to render the
	// whole array directly (no spacer, no slice).
	function virtRange(len) {
		if (len < VIRT_THRESHOLD || virtCols < 1 || virtRowH <= 0) {
			return { skip: true, startIdx: 0, endIdx: len };
		}
		const totalRows = Math.ceil(len / virtCols);
		const totalH = totalRows * virtRowH;
		const firstRow = Math.max(0, Math.floor(virtScrollTop / virtRowH) - VIRT_BUFFER_ROWS);
		const lastRow = Math.min(
			totalRows,
			Math.ceil((virtScrollTop + virtContainerH) / virtRowH) + VIRT_BUFFER_ROWS
		);
		return {
			skip: false,
			startIdx: firstRow * virtCols,
			endIdx: Math.min(len, lastRow * virtCols),
			padTop: firstRow * virtRowH,
			totalH
		};
	}

	// Recent tab state (persisted in localStorage)
	let recents = $state([]);

	// Kitchen data (lazy loaded)
	let kitchen = $state(null);
	let loading = $state(false);
	let loadError = $state(null);

	// Emoji names map (plain object: char -> name)
	let namesObj = $state(null);

	// Mode: 'popular' | 'recent' | 'mix' | 'browse' | 'search' | 'gboard' | 'emojimix' | 'funbox' | 'settings'
	let mode = $state('popular');

	// Settings: which optional tabs are visible (persisted)
	let showGboard   = $state(false);
	let showEmojimix = $state(false);
	let showFunbox   = $state(false);

	// Mix mode state
	let slotA = $state(null); // codepoint string e.g. '1f42d'
	let slotB = $state(null);
	let activeSlot = $state('A'); // 'A' or 'B'

	// Browse mode state
	let browseEmoji = $state(null); // codepoint string

	// Search mode state
	let searchQuery = $state('');

	// Popular tab state (combined/normalized — shown by default)
	let popularTokens = $state(null);
	let popularLoading = $state(false);
	let popularError = $state(null);

	// Gboard tab state (optional)
	let gboardTokens = $state(null);
	let gboardLoading = $state(false);
	let gboardError = $state(null);

	// Emojimix tab state (optional)
	let emojimixTokens = $state(null);
	let emojimixLoading = $state(false);
	let emojimixError = $state(null);

	// Funbox tab state (optional)
	let funboxTokens = $state(null);
	let funboxLoading = $state(false);
	let funboxError = $state(null);

	// Keyboard filter
	let keyFilter = $state('');

	// Derived: all codepoint strings from kitchen
	let allCps = $derived(kitchen ? kitchen.cps : []);

	// Derived: filtered keyboard codepoints
	let filteredCps = $derived.by(() => {
		if (!kitchen) return [];
		const q = keyFilter.trim().toLowerCase();
		if (!q) return allCps;
		if (!namesObj) return allCps;
		return allCps.filter(cp => {
			const ch = cpToEmoji(cp);
			const name = namesObj[ch] ?? '';
			return name.toLowerCase().includes(q);
		});
	});

	// Derived: emoji search results (for search mode — the clickable emoji buttons)
	let searchResults = $derived.by(() => {
		if (!kitchen || !namesObj) return [];
		const q = searchQuery.trim().toLowerCase();
		if (!q) return allCps.slice(0, 60);
		return allCps.filter(cp => {
			const ch = cpToEmoji(cp);
			const name = namesObj[ch] ?? '';
			return name.toLowerCase().includes(q);
		});
	});

	// TODO: improve EK search using a richer dataset — ideally a precomputed index
	// mapping tags/keywords → (parentCp, childCp) pairs so we can match "crying laugh"
	// or semantic concepts directly to mixes without going through individual emoji names.
	// For now we derive from kitchen data + emoji names only.
	let ekSearchResults = $derived.by(() => {
		if (!kitchen || !namesObj || !searchQuery.trim()) return [];
		const q = searchQuery.trim().toLowerCase();
		const seen = new Set();
		const results = [];

		// Parse optional A + B query (e.g. "cat + dog" or "cat+dog")
		const plusIdx = q.search(/\s*\+\s*/);
		const parts = plusIdx >= 0
			? [q.slice(0, plusIdx).replace(/\s*\+\s*$/, '').trim(), q.slice(plusIdx).replace(/^\s*\+\s*/, '').trim()]
			: [q];

		const matchCps = (term) => term
			? allCps.filter(cp => (namesObj[cpToEmoji(cp)] ?? '').toLowerCase().includes(term))
			: [];

		if (parts.length === 2 && parts[0] && parts[1]) {
			// A + B search: find mixes where both sides match
			const asSet = new Set(matchCps(parts[0]));
			const bsSet = new Set(matchCps(parts[1]));
			for (const cpA of asSet) {
				for (const cpB of bsSet) {
					for (const mix of getMixes(cpA, cpB)) {
						if (!seen.has(mix.token)) { seen.add(mix.token); results.push(mix); }
					}
					if (results.length >= 60) break;
				}
				if (results.length >= 60) break;
			}
		} else {
			// Single term: all mixes involving any matched emoji (cap per emoji to avoid explosion)
			const matched = matchCps(parts[0]).slice(0, 8);
			for (const cp of matched) {
				for (const mix of getAllMixes(cp)) {
					if (!seen.has(mix.token)) { seen.add(mix.token); results.push(mix); }
					if (results.length >= 80) break;
				}
				if (results.length >= 80) break;
			}
		}
		return results;
	});

	// Derived: mix results for Mix mode
	let mixResults = $derived.by(() => {
		if (!kitchen || !slotA || !slotB) return [];
		return getMixes(slotA, slotB);
	});

	// Derived: browse results for Browse mode
	let browseResults = $derived.by(() => {
		if (!kitchen || !browseEmoji) return [];
		return getAllMixes(browseEmoji);
	});

	function cpToEmoji(cp) {
		try {
			return String.fromCodePoint(...cp.split('-').map(p => parseInt(p, 16)));
		} catch {
			return '';
		}
	}

	function makeUrl(date, parentCp, childCp) {
		const d = parseInt(date);
		const pad = d < 20220500;
		const fmt = cp => 'u' + cp.split('-').map(s => pad ? s.padStart(4, '0') : s).join('-u');
		return `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${fmt(parentCp)}/${fmt(parentCp)}_${fmt(childCp)}.png`;
	}

	function makeToken(date, parentCp, childCp) {
		return `[ek:${(parseInt(date) - 20200000).toString(36)}:${parentCp}:${childCp}]`;
	}

	function getMixes(cpA, cpB) {
		if (!kitchen) return [];
		const results = [];
		const idxA = kitchen.cps.indexOf(cpA);
		const idxB = kitchen.cps.indexOf(cpB);

		// A+B
		const entriesA = kitchen.data[String(idxA)];
		if (entriesA) {
			for (const [dateIdx, childIdx] of entriesA) {
				if (childIdx === idxB) {
					results.push({
						token: makeToken(kitchen.dates[dateIdx], cpA, cpB),
						url: makeUrl(kitchen.dates[dateIdx], cpA, cpB),
						label: `${cpToEmoji(cpA)}+${cpToEmoji(cpB)}`
					});
				}
			}
		}

		// B+A (if different from A+B)
		if (cpA !== cpB) {
			const entriesB = kitchen.data[String(idxB)];
			if (entriesB) {
				for (const [dateIdx, childIdx] of entriesB) {
					if (childIdx === idxA) {
						results.push({
							token: makeToken(kitchen.dates[dateIdx], cpB, cpA),
							url: makeUrl(kitchen.dates[dateIdx], cpB, cpA),
							label: `${cpToEmoji(cpB)}+${cpToEmoji(cpA)}`
						});
					}
				}
			}
		}

		return results;
	}

	function getAllMixes(cp) {
		if (!kitchen) return [];
		const idx = kitchen.cps.indexOf(cp);
		if (idx < 0) return [];
		const entries = kitchen.data[String(idx)] ?? [];
		return entries.map(([dateIdx, childIdx]) => ({
			token: makeToken(kitchen.dates[dateIdx], cp, kitchen.cps[childIdx]),
			url: makeUrl(kitchen.dates[dateIdx], cp, kitchen.cps[childIdx]),
			childCp: kitchen.cps[childIdx],
			childEmoji: cpToEmoji(kitchen.cps[childIdx])
		}));
	}

	onMount(async () => {
		// Kick off preloading if not already started (no-op if parent already called preload())
		preload();

		// Load localStorage first (synchronous)
		try {
			const stored = localStorage.getItem('ek-recents');
			if (stored) recents = JSON.parse(stored);
		} catch {}
		try {
			const s = JSON.parse(localStorage.getItem('ek-tab-settings') ?? '{}');
			if (s.showGboard   != null) showGboard   = s.showGboard;
			if (s.showEmojimix != null) showEmojimix = s.showEmojimix;
			if (s.showFunbox   != null) showFunbox   = s.showFunbox;
		} catch {}

		// Use cached values if already resolved, otherwise await (shows spinner only if not preloaded yet)
		if (_kitchen) {
			kitchen = _kitchen;
		} else {
			loading = true;
			const result = await _kitchenP;
			if (result) kitchen = result;
			else loadError = 'Failed to load kitchen data';
			loading = false;
		}

		if (_namesObj) {
			namesObj = _namesObj;
		} else {
			try { namesObj = await _namesP; } catch {}
		}

		if (_popularTokens) {
			popularTokens = _popularTokens;
		} else {
			popularLoading = true;
			const result = await _popularP;
			if (result) popularTokens = result;
			else popularError = 'Failed to load';
			popularLoading = false;
		}
	});

	function saveTabSettings() {
		try { localStorage.setItem('ek-tab-settings', JSON.stringify({ showGboard, showEmojimix, showFunbox })); } catch {}
	}

	function insertToken(token) {
		recents = [token, ...recents.filter(t => t !== token)].slice(0, 60);
		try { localStorage.setItem('ek-recents', JSON.stringify(recents)); } catch {}
		onInsert(token);
	}

	function selectKeyboardEmoji(cp) {
		if (mode === 'mix') {
			if (activeSlot === 'A') {
				slotA = cp;
				activeSlot = 'B';
			} else {
				slotB = cp;
				activeSlot = 'A';
			}
		} else if (mode === 'browse') {
			browseEmoji = cp;
		} else if (mode === 'search') {
			// Switch to browse for clicked emoji
			browseEmoji = cp;
			mode = 'browse';
		}
	}

	function handleSearchClick(cp) {
		browseEmoji = cp;
		mode = 'browse';
	}

	function tokenToUrl(token) {
		const m = token.match(/^\[ek:([^:]+):([^:]+):([^\]]+)\]$/);
		if (!m) return '';
		const date = 20200000 + parseInt(m[1], 36);
		return makeUrl(String(date), m[2], m[3]);
	}

	function tokenToEmoji(token) {
		const m = token.match(/^\[ek:[^:]+:([^:]+):([^\]]+)\]$/);
		if (!m) return '';
		try {
			const a = String.fromCodePoint(...m[1].split('-').map(p => parseInt(p, 16)));
			const b = String.fromCodePoint(...m[2].split('-').map(p => parseInt(p, 16)));
			return a + b;
		} catch { return ''; }
	}

	function tokenLabel(token) {
		const m = token.match(/^\[ek:[^:]+:([^:]+):([^\]]+)\]$/);
		if (!m) return '';
		try {
			const a = String.fromCodePoint(...m[1].split('-').map(p => parseInt(p, 16)));
			const b = String.fromCodePoint(...m[2].split('-').map(p => parseInt(p, 16)));
			return `${a} + ${b}`;
		} catch { return ''; }
	}

	async function loadGboard() {
		if (gboardTokens || gboardLoading) return;
		gboardLoading = true; gboardError = null;
		try {
			const res = await fetch('/ek-popular.json');
			if (!res.ok) throw new Error('Failed');
			gboardTokens = await res.json();
		} catch (e) { gboardError = e.message; }
		finally { gboardLoading = false; }
	}

	async function loadEmojimix() {
		if (emojimixTokens || emojimixLoading) return;
		emojimixLoading = true; emojimixError = null;
		try {
			const res = await fetch('/ek-popular-emojimix.json');
			if (!res.ok) throw new Error('Failed');
			emojimixTokens = await res.json();
		} catch (e) { emojimixError = e.message; }
		finally { emojimixLoading = false; }
	}

	async function loadFunbox() {
		if (funboxTokens || funboxLoading) return;
		funboxLoading = true; funboxError = null;
		try {
			const res = await fetch('/ek-funbox.json');
			if (!res.ok) throw new Error('Failed');
			funboxTokens = await res.json();
		} catch (e) { funboxError = e.message; }
		finally { funboxLoading = false; }
	}

	function setMode(m) {
		mode = m;
		keyFilter = '';
		if (m === 'search') searchQuery = '';
		if (m === 'gboard')   loadGboard();
		if (m === 'emojimix') loadEmojimix();
		if (m === 'funbox')   loadFunbox();
	}

	function emojiName(cp) {
		if (!namesObj) return cp;
		const ch = cpToEmoji(cp);
		return namesObj[ch] ?? ch;
	}
</script>

<div class="kitchen-panel">
	<!-- Tab strip. Search lives in the leftmost slot — it's the most
	     common entry point once people know what they're looking for,
	     so giving it the primary position cuts a tap on every fresh
	     open. The chip is icon-only (Material Symbols magnifying
	     glass) to keep it visually distinct from the word-labeled
	     ranking tabs that follow. -->
	<div class="kitchen-tabs">
		<button class="kitchen-tab icon-tab" class:active={mode === 'search'}  onclick={() => setMode('search')}  title="Search mixes &amp; emoji" aria-label="Search">
			<span class="msi msi-18" class:msi-fill={mode === 'search'}>search</span>
		</button>
		<button class="kitchen-tab" class:active={mode === 'recent'}   onclick={() => setMode('recent')}   title="Recently used">🕐</button>
		<button class="kitchen-tab" class:active={mode === 'popular'}  onclick={() => setMode('popular')}>Popular</button>
		{#if showGboard}
		<button class="kitchen-tab" class:active={mode === 'gboard'}   onclick={() => setMode('gboard')}>Gboard</button>
		{/if}
		{#if showEmojimix}
		<button class="kitchen-tab" class:active={mode === 'emojimix'} onclick={() => setMode('emojimix')}>Emojimix</button>
		{/if}
		{#if showFunbox}
		<button class="kitchen-tab" class:active={mode === 'funbox'}   onclick={() => setMode('funbox')}>Funbox</button>
		{/if}
		<button class="kitchen-tab" class:active={mode === 'mix'}      onclick={() => setMode('mix')}>Mix</button>
		<button class="kitchen-tab" class:active={mode === 'browse'}   onclick={() => setMode('browse')}>Browse</button>
		<button class="kitchen-tab settings-tab" class:active={mode === 'settings'} onclick={() => setMode('settings')} title="Tab settings">⚙️</button>
	</div>

	<!-- Content area -->
	<div class="kitchen-content" bind:this={kitchenContentEl} onscroll={onKitchenScroll}>
		{#snippet rankTab(tokens, loadingState, errorState)}
			{#if loadingState}
				<div class="kitchen-loading"><span class="kitchen-spinner"></span>Loading…</div>
			{:else if errorState}
				<div class="kitchen-error">{errorState}</div>
			{:else if tokens?.length}
				{@const r = virtRange(tokens.length)}
				{#if r.skip}
					<!-- Small list — render the whole array, no spacer needed. -->
					<div class="popular-grid" bind:this={virtGridEl}>
						{#each tokens as token}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
							<div class="mix-result-item" onclick={() => insertToken(token)} data-tip={tokenLabel(token)}>
								<img use:lazyImg={tokenToUrl(token)} alt={tokenToEmoji(token)} class="mix-img" />
							</div>
						{/each}
					</div>
				{:else}
					<!-- Virtualized: tall spacer holds the real scroll height;
					     only the visible window of rows is mounted. -->
					<div class="popular-grid-virt" style:height="{r.totalH}px" bind:this={virtGridEl}>
						<div class="popular-grid popular-grid-window" style:transform="translateY({r.padTop}px)">
							{#each tokens.slice(r.startIdx, r.endIdx) as token, i (r.startIdx + i)}
								<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
								<div class="mix-result-item" onclick={() => insertToken(token)} data-tip={tokenLabel(token)}>
									<img use:lazyImg={tokenToUrl(token)} alt={tokenToEmoji(token)} class="mix-img" />
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		{/snippet}

		{#if mode === 'recent'}
			{#if recents.length}
				{@render rankTab(recents, false, null)}
			{:else}
				<div class="mix-hint">No recently used mixes yet.</div>
			{/if}
		{:else if mode === 'popular'}
			{@render rankTab(popularTokens, popularLoading, popularError)}
		{:else if mode === 'gboard'}
			{@render rankTab(gboardTokens, gboardLoading, gboardError)}
		{:else if mode === 'emojimix'}
			{@render rankTab(emojimixTokens, emojimixLoading, emojimixError)}
		{:else if mode === 'funbox'}
			{@render rankTab(funboxTokens, funboxLoading, funboxError)}
		{:else if mode === 'settings'}
			<div class="settings-panel">
				<p class="settings-title">Extra popularity tabs</p>
				<label class="settings-row">
					<input type="checkbox" bind:checked={showGboard}
						onchange={() => { if (!showGboard && mode === 'gboard') setMode('popular'); saveTabSettings(); }} />
					<span class="settings-label">Gboard <span class="settings-desc">2025 Google Gboard share data</span></span>
				</label>
				<label class="settings-row">
					<input type="checkbox" bind:checked={showEmojimix}
						onchange={() => { if (!showEmojimix && mode === 'emojimix') setMode('popular'); saveTabSettings(); }} />
					<span class="settings-label">Emojimix <span class="settings-desc">aggregated favourite counts</span></span>
				</label>
				<label class="settings-row">
					<input type="checkbox" bind:checked={showFunbox}
						onchange={() => { if (!showFunbox && mode === 'funbox') setMode('popular'); saveTabSettings(); }} />
					<span class="settings-label">Funbox <span class="settings-desc">funbox.wtf ranking data</span></span>
				</label>
			</div>
		{:else if loading}
			<div class="kitchen-loading">
				<span class="kitchen-spinner"></span>
				Loading kitchen…
			</div>
		{:else if loadError}
			<div class="kitchen-error">{loadError}</div>
		{:else if mode === 'mix'}
			<!-- Mix mode -->
			<div class="mix-slots">
				<button
					class="slot-btn"
					class:slot-active={activeSlot === 'A'}
					onclick={() => activeSlot = 'A'}
					title="Slot A — click to activate"
				>
					{#if slotA}
						<span class="slot-emoji">{cpToEmoji(slotA)}</span>
					{:else}
						<span class="slot-placeholder">?</span>
					{/if}
				</button>
				<span class="mix-plus">+</span>
				<button
					class="slot-btn"
					class:slot-active={activeSlot === 'B'}
					onclick={() => activeSlot = 'B'}
					title="Slot B — click to activate"
				>
					{#if slotB}
						<span class="slot-emoji">{cpToEmoji(slotB)}</span>
					{:else}
						<span class="slot-placeholder">?</span>
					{/if}
				</button>
			</div>
			<div class="mix-results">
				{#if mixResults.length > 0}
					{#each mixResults as mix}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="mix-result-item" onclick={() => insertToken(mix.token)} data-tip={tokenLabel(mix.token)}>
							<img use:lazyImg={mix.url} alt={mix.label} class="mix-img" />
						</div>
					{/each}
				{:else if slotA && slotB}
					<div class="mix-empty">No mix found for these two.</div>
				{:else}
					<div class="mix-hint">Pick two emoji below to mix them.</div>
				{/if}
			</div>

		{:else if mode === 'browse'}
			<!-- Browse mode -->
			<div class="browse-selector-row">
				<button
					class="slot-btn browse-selector"
					onclick={() => {}}
					title="Selected emoji"
				>
					{#if browseEmoji}
						<span class="slot-emoji">{cpToEmoji(browseEmoji)}</span>
					{:else}
						<span class="slot-placeholder">?</span>
					{/if}
				</button>
				{#if browseEmoji}
					<span class="browse-emoji-name">{emojiName(browseEmoji)}</span>
				{:else}
					<span class="browse-hint-text">Pick an emoji below</span>
				{/if}
			</div>
			{#if browseEmoji && browseResults.length > 0}
				<div class="browse-grid">
					{#each browseResults as item}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="browse-item" onclick={() => insertToken(item.token)} title={item.childEmoji}>
							<img use:lazyImg={item.url} alt={item.childEmoji} class="mix-img" />
							<span class="browse-item-child">{item.childEmoji}</span>
						</div>
					{/each}
				</div>
			{:else if browseEmoji}
				<div class="mix-empty">No mixes found for this emoji.</div>
			{/if}

		{:else if mode === 'search'}
			<!-- Search mode -->
			<div class="search-input-wrap">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="search-input"
					type="text"
					placeholder="Search emoji or try &quot;cat + dog&quot;…"
					bind:value={searchQuery}
					autofocus
				/>
			</div>

			<!-- EK mix results -->
			{#if ekSearchResults.length > 0}
				<div class="search-section-label">Mixes</div>
				<div class="search-ek-grid">
					{#each ekSearchResults as mix}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="mix-result-item" onclick={() => insertToken(mix.token)} data-tip={tokenLabel(mix.token)}>
							<img use:lazyImg={mix.url} alt={tokenToEmoji(mix.token)} class="mix-img" />
						</div>
					{/each}
				</div>
			{/if}

			<!-- Individual emoji results -->
			{#if searchResults.length > 0}
				{#if ekSearchResults.length > 0}
					<div class="search-section-label">Emoji</div>
				{/if}
				<div class="search-results-grid">
					{#each searchResults as cp}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<button class="key-btn" onclick={() => handleSearchClick(cp)} title={emojiName(cp)}>
							{cpToEmoji(cp)}
						</button>
					{/each}
				</div>
			{/if}

			{#if searchQuery.trim() && searchResults.length === 0 && ekSearchResults.length === 0}
				<div class="mix-empty">No matches.</div>
			{/if}
		{/if}
	</div>

	<!-- Mini emoji keyboard (shown in mix + browse modes) -->
	{#if mode === 'mix' || mode === 'browse'}
		<div class="kitchen-keyboard">
			<input
				class="key-filter-input"
				type="text"
				placeholder="Filter emoji…"
				bind:value={keyFilter}
			/>
			<div class="key-grid">
				{#each filteredCps as cp}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<button class="key-btn" onclick={() => selectKeyboardEmoji(cp)} title={emojiName(cp)}>
						{cpToEmoji(cp)}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.kitchen-panel {
		width: 380px;
		height: 560px;
		background: var(--paper);
		color: var(--ink);
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
	}

	/* Tabs — pill-chip toggle row, matching the Emotes tab's
	   Uploaded / Library sub-tabs. Horizontally scrollable so the
	   Mix / Browse / Search / Settings chips don't get cramped when
	   optional ranking tabs (Gboard / Emojimix / Funbox) are enabled. */
	.kitchen-tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.kitchen-tabs::-webkit-scrollbar { display: none; }
	.kitchen-tab {
		padding: 0.25rem 0.7rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.kitchen-tab.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: var(--md-sys-color-secondary, var(--border));
	}
	.kitchen-tab:hover:not(.active) {
		background: color-mix(in srgb,
			var(--md-sys-color-on-surface, var(--ink)) 7%,
			transparent);
	}

	/* Content */
	.kitchen-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.75rem;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.kitchen-content::-webkit-scrollbar { width: 4px; }
	.kitchen-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

	/* Loading / error */
	.kitchen-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--muted-fg);
		font-size: 0.85rem;
		justify-content: center;
		padding: 1.5rem 0;
	}
	.kitchen-spinner {
		width: 16px; height: 16px;
		border: 2px solid var(--border);
		border-top-color: var(--ink);
		border-radius: 50%;
		animation: kspin 0.8s linear infinite;
		flex-shrink: 0;
	}
	@keyframes kspin { to { transform: rotate(360deg); } }
	.kitchen-error { color: var(--danger); font-size: 0.82rem; padding: 1rem; text-align: center; }

	/* Mix slots */
	.mix-slots {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.25rem 0 0.5rem;
	}
	.mix-plus { font-size: 1.2rem; color: var(--muted-fg); font-weight: 600; }

	.slot-btn {
		width: 56px; height: 56px;
		border: 2px solid var(--border);
		border-radius: 12px;
		background: var(--paper);
		cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
		padding: 0;
	}
	.slot-btn:hover { border-color: var(--muted-fg); background: var(--surface-2); }
	.slot-btn.slot-active { border-color: var(--ink); box-shadow: 0 0 0 2px rgba(26,26,26,0.1); }
	.slot-emoji { font-size: 1.9rem; line-height: 1; }
	.slot-placeholder { font-size: 1.4rem; color: var(--border); }

	/* Mix results */
	.mix-results {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		min-height: 64px;
		align-items: center;
	}
	.mix-result-item {
		border-radius: 10px;
		border: 1.5px solid #e0d9cc;
		background: var(--paper);
		cursor: pointer;
		padding: 4px;
		transition: border-color 0.15s, background 0.15s, transform 0.1s;
		display: flex; align-items: center; justify-content: center;
		position: relative;
	}
	.mix-result-item:hover { border-color: var(--ink); background: var(--surface-2); transform: scale(1.06); }

	/* Floating emoji label on hover */
	.mix-result-item[data-tip]:hover::before {
		content: attr(data-tip);
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(26, 26, 26, 0.88);
		color: #fff;
		padding: 3px 8px;
		border-radius: 7px;
		font-size: 1.15rem;
		line-height: 1.4;
		white-space: nowrap;
		pointer-events: none;
		z-index: 200;
		font-family: inherit;
	}
	/* Fill the grid cell rather than being a fixed 56px square — fixed
	   width was making the last column of `repeat(5, 1fr)` overflow on
	   narrow panels. Aspect-ratio + max-size caps how big a single mix
	   ever gets on very wide grids. */
	.mix-img {
		width: 100%;
		max-width: 56px;
		aspect-ratio: 1;
		height: auto;
		object-fit: contain;
		display: block;
		margin: 0 auto;
		/* Reserve space before src lands so lazy-loaded cells don't
		   collapse to 0×0 and trigger a reflow cascade on intersect. */
		min-height: 32px;
	}

	.mix-empty, .mix-hint {
		font-size: 0.8rem;
		color: var(--muted-fg);
		text-align: center;
		padding: 0.5rem 0;
		width: 100%;
	}

	/* Popular */
	.popular-grid {
		display: grid;
		/* auto-fill so narrow panels (mobile, 100% width) wrap to fewer
		   columns instead of clipping the last one. minmax floor of 56
		   keeps cells touch-target sized. */
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 0.4rem;
	}
	/* Virtualized rank tab: the wrapper reserves the full scrollable
	   height (totalRows * rowHeight) so the scroll bar still tracks the
	   real list size. The inner grid is the "sliding window" — only the
	   rows in view are mounted and it's pushed down with translateY so
	   they land at the correct scroll offset. */
	.popular-grid-virt {
		position: relative;
		width: 100%;
	}
	.popular-grid-window {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		/* Stable transforms keep scrolling buttery on mobile by
		   promoting the layer to its own compositor texture. */
		will-change: transform;
	}

	/* Browse */
	.browse-selector-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.1rem 0 0.4rem;
	}
	.browse-selector { flex-shrink: 0; }
	.browse-emoji-name {
		font-size: 0.82rem;
		color: #5a5248;
		text-transform: capitalize;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.browse-hint-text { font-size: 0.8rem; color: var(--muted-fg); }

	.browse-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 0.4rem;
	}
	.browse-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		cursor: pointer;
		border-radius: 8px;
		border: 1.5px solid transparent;
		background: var(--paper);
		padding: 4px 2px;
		transition: border-color 0.13s, background 0.13s, transform 0.1s;
	}
	.browse-item:hover { border-color: var(--ink); background: var(--surface-2); transform: scale(1.06); }
	.browse-item .mix-img { width: 44px; height: 44px; }
	.browse-item-child { font-size: 0.9rem; line-height: 1; }

	/* Search */
	.search-input-wrap { flex-shrink: 0; }
	.search-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.75rem;
		border: 1.5px solid var(--border);
		border-radius: 9px;
		background: var(--paper);
		font-family: inherit;
		font-size: 0.875rem;
		color: var(--ink);
		outline: none;
		transition: border-color 0.15s;
	}
	.search-input:focus { border-color: var(--ink); }
	.search-input::placeholder { color: var(--muted-fg); }

	.search-section-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted-fg);
		padding: 0.1rem 0;
		flex-shrink: 0;
	}
	.search-ek-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 0.4rem;
	}
	.search-results-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
	}
	.search-results-grid::-webkit-scrollbar { width: 4px; }
	.search-results-grid::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

	/* Keyboard */
	.kitchen-keyboard {
		border-top: 1.5px solid var(--border);
		background: var(--surface-2);
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		max-height: 268px;
	}
	.key-filter-input {
		margin: 0.4rem 0.5rem 0.3rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--paper);
		font-family: inherit;
		font-size: 0.78rem;
		color: var(--ink);
		outline: none;
		transition: border-color 0.15s;
		flex-shrink: 0;
	}
	.key-filter-input:focus { border-color: var(--ink); }
	.key-filter-input::placeholder { color: var(--muted-fg); }

	.key-grid {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		gap: 1px;
		overflow-y: auto;
		padding: 0 0.35rem 0.4rem;
		flex: 1;
	}
	.key-grid::-webkit-scrollbar { width: 4px; }
	.key-grid::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

	.key-btn {
		font-size: 1.3rem;
		line-height: 1;
		border: none;
		background: none;
		border-radius: 6px;
		cursor: pointer;
		padding: 3px 2px;
		transition: background 0.1s;
		display: flex; align-items: center; justify-content: center;
		width: 100%;
		aspect-ratio: 1;
	}
	.key-btn:hover { background: #d8d0c4; }

	/* Icon-only tabs (Search, Settings) — same pill chrome as the
	   word-tabs but with a tight square padding so the glyph sits in
	   a round chip instead of getting the wider word-tab treatment. */
	.icon-tab { padding: 0.2rem 0.45rem; display: inline-flex; align-items: center; justify-content: center; }
	.settings-tab { padding: 0.2rem 0.5rem; font-size: 0.9rem; }

	.settings-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.25rem 0;
	}
	.settings-title {
		margin: 0 0 0.25rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted-fg);
	}
	.settings-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		cursor: pointer;
		padding: 0.4rem 0.5rem;
		border-radius: 8px;
		transition: background 0.12s;
	}
	.settings-row:hover { background: var(--surface-2); }
	.settings-row input[type="checkbox"] {
		width: 16px; height: 16px;
		accent-color: var(--ink);
		cursor: pointer;
		flex-shrink: 0;
	}
	.settings-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.settings-desc {
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--muted-fg);
	}

	/* ── Emoji font: Noto Color Emoji when user has it selected ── */
	/* Slot emoji in mix mode */
	:global(html.noto-emoji) .slot-emoji {
		font-family: 'Noto Color Emoji', sans-serif;
	}
	/* Keyboard grid buttons */
	:global(html.noto-emoji) .key-btn {
		font-family: 'Noto Color Emoji', sans-serif;
	}
	/* Child emoji label in browse grid */
	:global(html.noto-emoji) .browse-item-child {
		font-family: 'Noto Color Emoji', sans-serif;
	}
	/* Hover tooltip (::before inherits from parent; set font-family here) */
	:global(html.noto-emoji) .mix-result-item {
		font-family: 'Noto Color Emoji', sans-serif;
	}
	/* Default (system emoji): ensure non-text UI font for non-emoji text in panel */
	:global(html:not(.noto-emoji)) .slot-emoji,
	:global(html:not(.noto-emoji)) .key-btn,
	:global(html:not(.noto-emoji)) .browse-item-child {
		font-family: system-ui, sans-serif;
	}
</style>
