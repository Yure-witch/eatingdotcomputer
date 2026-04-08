<script>
	import { onMount } from 'svelte';
	import { loadEmojiNames } from '$lib/emoji-names.js';

	let { onInsert } = $props();

	// Kitchen data (lazy loaded)
	let kitchen = $state(null);
	let loading = $state(false);
	let loadError = $state(null);

	// Emoji names map (plain object: char -> name)
	let namesObj = $state(null);

	// Mode: 'mix' | 'browse' | 'search'
	let mode = $state('mix');

	// Mix mode state
	let slotA = $state(null); // codepoint string e.g. '1f42d'
	let slotB = $state(null);
	let activeSlot = $state('A'); // 'A' or 'B'

	// Browse mode state
	let browseEmoji = $state(null); // codepoint string

	// Search mode state
	let searchQuery = $state('');

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

	// Derived: search results (for search mode)
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

	async function loadKitchen() {
		if (kitchen || loading) return;
		loading = true;
		loadError = null;
		try {
			const res = await fetch('/emoji-kitchen.json');
			if (!res.ok) throw new Error('Failed to load emoji kitchen data');
			kitchen = await res.json();
		} catch (e) {
			loadError = e.message;
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		loadKitchen();
		namesObj = await loadEmojiNames();
	});

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

	function setMode(m) {
		mode = m;
		keyFilter = '';
		if (m === 'search') searchQuery = '';
	}

	function emojiName(cp) {
		if (!namesObj) return cp;
		const ch = cpToEmoji(cp);
		return namesObj[ch] ?? ch;
	}
</script>

<div class="kitchen-panel">
	<!-- Tab strip -->
	<div class="kitchen-tabs">
		<button class="kitchen-tab" class:active={mode === 'mix'} onclick={() => setMode('mix')}>Mix</button>
		<button class="kitchen-tab" class:active={mode === 'browse'} onclick={() => setMode('browse')}>Browse</button>
		<button class="kitchen-tab" class:active={mode === 'search'} onclick={() => setMode('search')}>Search</button>
	</div>

	<!-- Content area -->
	<div class="kitchen-content">
		{#if loading}
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
						<div class="mix-result-item" onclick={() => onInsert(mix.token)} title={mix.label}>
							<img src={mix.url} alt={mix.label} loading="lazy" class="mix-img" />
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
						<div class="browse-item" onclick={() => onInsert(item.token)} title={item.childEmoji}>
							<img src={item.url} alt={item.childEmoji} loading="lazy" class="mix-img" />
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
					placeholder="Search emoji by name…"
					bind:value={searchQuery}
					autofocus
				/>
			</div>
			<div class="search-results-grid">
				{#each searchResults as cp}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<button class="key-btn" onclick={() => handleSearchClick(cp)} title={emojiName(cp)}>
						{cpToEmoji(cp)}
					</button>
				{/each}
				{#if searchResults.length === 0}
					<div class="mix-empty" style="grid-column:1/-1">No matches.</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Mini emoji keyboard (shown in mix + browse modes) -->
	{#if mode !== 'search'}
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
		max-height: 460px;
		background: #f7f2ea;
		color: #1a1a1a;
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
	}

	/* Tabs */
	.kitchen-tabs {
		display: flex;
		border-bottom: 1.5px solid #e8e0d2;
		background: #f0ebe0;
		flex-shrink: 0;
	}
	.kitchen-tab {
		flex: 1;
		padding: 0.55rem 0;
		border: none;
		background: none;
		color: #a09688;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
		letter-spacing: 0.02em;
	}
	.kitchen-tab:hover { color: #1a1a1a; background: #ece5d8; }
	.kitchen-tab.active { color: #1a1a1a; background: #f7f2ea; border-bottom: 2px solid #1a1a1a; margin-bottom: -1.5px; }

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
	.kitchen-content::-webkit-scrollbar-thumb { background: #d5cdc0; border-radius: 2px; }

	/* Loading / error */
	.kitchen-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #a09688;
		font-size: 0.85rem;
		justify-content: center;
		padding: 1.5rem 0;
	}
	.kitchen-spinner {
		width: 16px; height: 16px;
		border: 2px solid #d5cdc0;
		border-top-color: #1a1a1a;
		border-radius: 50%;
		animation: kspin 0.8s linear infinite;
		flex-shrink: 0;
	}
	@keyframes kspin { to { transform: rotate(360deg); } }
	.kitchen-error { color: #c0392b; font-size: 0.82rem; padding: 1rem; text-align: center; }

	/* Mix slots */
	.mix-slots {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.25rem 0 0.5rem;
	}
	.mix-plus { font-size: 1.2rem; color: #a09688; font-weight: 600; }

	.slot-btn {
		width: 56px; height: 56px;
		border: 2px solid #d5cdc0;
		border-radius: 12px;
		background: #fff;
		cursor: pointer;
		display: flex; align-items: center; justify-content: center;
		transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
		padding: 0;
	}
	.slot-btn:hover { border-color: #b0a898; background: #f5f2ee; }
	.slot-btn.slot-active { border-color: #1a1a1a; box-shadow: 0 0 0 2px rgba(26,26,26,0.1); }
	.slot-emoji { font-size: 1.9rem; line-height: 1; }
	.slot-placeholder { font-size: 1.4rem; color: #c8c1b4; }

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
		background: #fff;
		cursor: pointer;
		padding: 4px;
		transition: border-color 0.15s, background 0.15s, transform 0.1s;
		display: flex; align-items: center; justify-content: center;
	}
	.mix-result-item:hover { border-color: #1a1a1a; background: #f5f2ee; transform: scale(1.06); }
	.mix-img { width: 56px; height: 56px; object-fit: contain; display: block; }

	.mix-empty, .mix-hint {
		font-size: 0.8rem;
		color: #a09688;
		text-align: center;
		padding: 0.5rem 0;
		width: 100%;
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
	.browse-hint-text { font-size: 0.8rem; color: #a09688; }

	.browse-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
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
		background: #fff;
		padding: 4px 2px;
		transition: border-color 0.13s, background 0.13s, transform 0.1s;
	}
	.browse-item:hover { border-color: #1a1a1a; background: #f5f2ee; transform: scale(1.06); }
	.browse-item .mix-img { width: 44px; height: 44px; }
	.browse-item-child { font-size: 0.9rem; line-height: 1; }

	/* Search */
	.search-input-wrap { flex-shrink: 0; }
	.search-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.75rem;
		border: 1.5px solid #d5cdc0;
		border-radius: 9px;
		background: #fff;
		font-family: inherit;
		font-size: 0.875rem;
		color: #1a1a1a;
		outline: none;
		transition: border-color 0.15s;
	}
	.search-input:focus { border-color: #1a1a1a; }
	.search-input::placeholder { color: #b0a898; }

	.search-results-grid {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 2px;
		overflow-y: auto;
		max-height: 180px;
	}
	.search-results-grid::-webkit-scrollbar { width: 4px; }
	.search-results-grid::-webkit-scrollbar-thumb { background: #d5cdc0; border-radius: 2px; }

	/* Keyboard */
	.kitchen-keyboard {
		border-top: 1.5px solid #e8e0d2;
		background: #ede8de;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		max-height: 168px;
	}
	.key-filter-input {
		margin: 0.4rem 0.5rem 0.3rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid #d5cdc0;
		border-radius: 7px;
		background: #fff;
		font-family: inherit;
		font-size: 0.78rem;
		color: #1a1a1a;
		outline: none;
		transition: border-color 0.15s;
		flex-shrink: 0;
	}
	.key-filter-input:focus { border-color: #1a1a1a; }
	.key-filter-input::placeholder { color: #b0a898; }

	.key-grid {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		gap: 1px;
		overflow-y: auto;
		padding: 0 0.35rem 0.4rem;
		flex: 1;
	}
	.key-grid::-webkit-scrollbar { width: 4px; }
	.key-grid::-webkit-scrollbar-thumb { background: #d5cdc0; border-radius: 2px; }

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
</style>
