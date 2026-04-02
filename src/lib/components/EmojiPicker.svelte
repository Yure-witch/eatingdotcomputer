<script module>
	let emojiData = null;
	let loadPromise = null;
	async function loadEmojiData() {
		if (emojiData) return emojiData;
		if (!loadPromise) loadPromise = fetch('/emoji-data.json', { cache: 'no-store' }).then(r => r.json()).then(d => { emojiData = d; return d; });
		return loadPromise;
	}
</script>

<script>
	import { onMount } from 'svelte';

	let { onSelect } = $props();

	const RECENT_KEY    = 'emoji-recent';
	const FONT_KEY      = 'emoji-font';
	const TONE_KEY      = 'emoji-tone';
	const GENDER_KEY    = 'emoji-gender';
	const DUAL_LEFT_KEY = 'emoji-dual-left';
	const DUAL_RIGHT_KEY= 'emoji-dual-right';
	const MAX_RECENT = 40;

	let data         = $state(null);
	let loading      = $state(true);
	let query        = $state('');
	let activeGroup  = $state(0);   // -2 = popular, -1 = recent, 0..N-1 = group index
	let skinTone     = $state('');  // '' | '1F3FB'–'1F3FF', set by picking a variant
	let gender       = $state('');  // '' | 'female' | 'male', set by picking a variant
	let recent       = $state([]);
	let preview      = $state(null);
	let fontStyle    = $state('noto');   // 'noto' | 'system'
	let showSettings = $state(false);
	let searchEl     = $state(null);
	let gridEl       = $state(null);

	// ── Long press / variant picker ───────────────────────────────────────────
	let longPress  = $state(null); // { item, x, y } | null
	let lpTimer    = null;
	let lpFired    = false;  // suppresses the click that follows a long press
	let lpX0 = 0, lpY0 = 0;
	let showDir    = $state(false); // directional popover: false=left-facing, true=right-facing
	let dualLeft   = $state(undefined); // undefined=not yet picked, '1F3FB'–'1F3FF'=tone selected
	let dualRight  = $state(undefined);

	const TONE_SET_D    = new Set(['1F3FB','1F3FC','1F3FD','1F3FE','1F3FF']);
	const TONE_IDX_D    = {'1F3FB':1,'1F3FC':2,'1F3FD':3,'1F3FE':4,'1F3FF':5};
	const TONE_SUFFIX_D = {'1F3FB':'tone1','1F3FC':'tone2','1F3FD':'tone3','1F3FE':'tone4','1F3FF':'tone5'};

	function classifyVariants(item) {
		if (!item?.t?.length) return 'simple';
		if (item.t.some(v => v.cp.includes('27A1'))) return 'directional';
		if (item.t.length === 25) return 'dual';
		// Multi-base: variants span >1 distinct primary codepoint
		// e.g. cook (1F9D1 / 1F469 / 1F468), child (1F9D2 / 1F467 / 1F466), Mx Claus (1F9D1 / 1F936 / 1F385)
		const bases = new Set(item.t.map(v => v.cp.split(' ').find(p => !TONE_SET_D.has(p))));
		if (bases.size > 1) return 'multibase';
		return 'simple';
	}

	// Build grouped rows for multi-base popovers.
	// Each group shares the same primary (first non-tone) codepoint.
	// The parent (base) emoji is prepended to the first group.
	function buildMultibaseGroups(item) {
		const groups = new Map();
		for (const v of (item.t ?? [])) {
			const key = v.cp.split(' ').find(p => !TONE_SET_D.has(p)) ?? '';
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(v);
		}
		const parentKey = item.cp.split(' ').find(p => !TONE_SET_D.has(p)) ?? '';
		groups.get(parentKey)?.unshift({ e: item.e, cp: item.cp });
		return [...groups.values()];
	}

	// Return the matrix cell for the currently-selected left+right tones, or null if not both picked.
	function getDualEmoji(matrix, left, right) {
		if (left === undefined || right === undefined) return null;
		return matrix[TONE_IDX_D[left]][TONE_IDX_D[right]] ?? null;
	}

	// Build a 6×6 matrix for dual-tone emoji (handshake, wrestlers, etc.)
	// Row = left/person-A tone index (0=default, 1–5=🏻–🏿)
	// Col = right/person-B tone index
	// (0,1–5) and (1–5,0) are null (no default+toned combos)
	function buildDualMatrix(item) {
		const mat = Array.from({length: 6}, () => Array(6).fill(null));
		mat[0][0] = { e: item.e, cp: item.cp };
		for (const v of (item.t ?? [])) {
			const tones = v.cp.split(' ').filter(p => TONE_SET_D.has(p));
			if (tones.length === 1) {
				const i = TONE_IDX_D[tones[0]];
				if (i) mat[i][i] = v;
			} else if (tones.length === 2) {
				const r = TONE_IDX_D[tones[0]], c = TONE_IDX_D[tones[1]];
				if (r && c) mat[r][c] = v;
			}
		}
		return mat;
	}

	// cp → name lookup built from grid items at load time
	let cpToName = {};

	// Best-effort display name for a variant (used in popover hover preview)
	function variantDisplayName(v, parentItem) {
		if (!v || v.e === parentItem.e) return parentItem.n;
		if (cpToName[v.cp]) return cpToName[v.cp];
		// Try without tone modifier
		const baseCp = v.cp.split(' ').filter(p => !TONE_SET_D.has(p)).join(' ').trim();
		if (cpToName[baseCp]) return cpToName[baseCp];
		// Derive from gender
		const g = getGenderFromCp(v.cp);
		if (g === 'female') {
			const rep = parentItem.n.replace(/^person\b/i, 'woman');
			return rep !== parentItem.n ? rep : parentItem.n;
		}
		if (g === 'male') {
			const rep = parentItem.n.replace(/^person\b/i, 'man');
			return rep !== parentItem.n ? rep : parentItem.n;
		}
		return parentItem.n;
	}

	function startLp(e, item) {
		if (!item?.t?.length) return;
		lpX0 = e.clientX; lpY0 = e.clientY;
		const el = e.currentTarget;
		lpTimer = setTimeout(() => {
			const rect = el.getBoundingClientRect();
			lpFired = true;
			showDir = false;
			longPress = { item, x: rect.left + rect.width / 2, y: rect.top };
			lpTimer = null;
		}, 250);
	}

	function moveLp(e) {
		if (!lpTimer) return;
		if (Math.hypot(e.clientX - lpX0, e.clientY - lpY0) > 8) cancelLp();
	}

	function cancelLp() {
		if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
	}

	function openVariants(e, item) {
		if (!item?.t?.length) return;
		e.preventDefault();
		showDir = false;
		const rect = e.currentTarget.getBoundingClientRect();
		longPress = { item, x: rect.left + rect.width / 2, y: rect.top };
	}

	// Called when picking from the variant popover.
	// vObj = { e, cp } for a variant, or null for the base emoji.
	// parentItem = the item whose popover is open.
	function pickVariant(vObj, parentItem) {
		const glyph = vObj ? vObj.e : parentItem.e;
		const cp    = vObj ? vObj.cp : parentItem.cp;

		if (classifyVariants(parentItem) === 'dual') {
			// Persist the dual tone selection so it restores on next open
			try { localStorage.setItem(DUAL_LEFT_KEY,  dualLeft  ?? ''); } catch {}
			try { localStorage.setItem(DUAL_RIGHT_KEY, dualRight ?? ''); } catch {}
		} else {
			const tone = cp.split(' ').find(p => TONE_SET_D.has(p)) ?? '';
			// Only update global tone when the picked variant carries one —
			// picking a gender-only (toneless) variant should preserve the existing tone.
			if (tone) {
				skinTone = tone;
				try { localStorage.setItem(TONE_KEY, tone); } catch {}
			}
			const g = getGenderFromCp(cp);
			if (g !== 'neutral') {
				gender = g;
				try { localStorage.setItem(GENDER_KEY, g); } catch {}
			} else {
				// Only reset gender if this emoji actually has gendered variants —
				// picking a hand gesture shouldn't clear gender set from a person emoji.
				const hasGenderVariants = (parentItem.t ?? []).some(v => getGenderFromCp(v.cp) !== 'neutral');
				if (hasGenderVariants) {
					gender = '';
					try { localStorage.setItem(GENDER_KEY, ''); } catch {}
				}
			}
		}

		saveRecent(glyph);
		onSelect?.(glyph);
		longPress = null;
	}

	// Cols for simple variant popover grid.
	function variantCols(item) {
		const total = 1 + (item.t?.length ?? 0);
		if (total <= 6) return total;
		return 6;
	}

	// Look up a full item by raw emoji glyph (for popular/recent tabs)
	function findItem(e) {
		if (!data) return null;
		for (const g of data.groups) {
			const f = g.items.find(i => i.e === e);
			if (f) return f;
		}
		return null;
	}

	onMount(async () => {
		try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
		try { fontStyle = localStorage.getItem(FONT_KEY) ?? 'noto'; } catch {}
		try { skinTone  = localStorage.getItem(TONE_KEY) ?? ''; } catch {}
		try { gender    = localStorage.getItem(GENDER_KEY) ?? ''; } catch {}
		try { const dl = localStorage.getItem(DUAL_LEFT_KEY);  dualLeft  = dl  || undefined; } catch {}
		try { const dr = localStorage.getItem(DUAL_RIGHT_KEY); dualRight = dr || undefined; } catch {}
		data = await loadEmojiData();
		for (const g of data.groups) {
			for (const item of g.items) cpToName[item.cp] = item.n;
		}
		loading = false;
		requestAnimationFrame(() => searchEl?.focus());
	});

	// Inject Noto Color Emoji from Google Fonts when needed
	$effect(() => {
		if (fontStyle !== 'noto') return;
		if (typeof document === 'undefined') return;
		if (document.querySelector('#noto-color-emoji-font')) return;
		const link = document.createElement('link');
		link.id   = 'noto-color-emoji-font';
		link.rel  = 'stylesheet';
		link.href = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';
		document.head.appendChild(link);
	});

	function setFont(style) {
		fontStyle = style;
		try { localStorage.setItem(FONT_KEY, style); } catch {}
		showSettings = false;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	// Female codepoints: ZWJ ♀ marker, woman (1F469), girl (1F467),
	// Mrs. Claus (1F936), old woman (1F475), princess (1F478), pregnant woman (1F930)
	const FEMALE_CP = new Set(['2640','1F469','1F936','1F467','1F475','1F478','1F930']);
	// Male codepoints: ZWJ ♂ marker, man (1F468), boy (1F466),
	// Santa (1F385), old man (1F474), prince (1F934), pregnant man (1FAC3)
	const MALE_CP   = new Set(['2642','1F468','1F385','1F466','1F474','1F934','1FAC3']);

	function getGenderFromCp(cp) {
		const parts = cp.split(' ');
		if (parts.some(p => FEMALE_CP.has(p))) return 'female';
		if (parts.some(p => MALE_CP.has(p)))   return 'male';
		// Name-based fallback for any remaining dedicated-codepoint gendered emoji
		// not covered by the sets above (e.g. future additions)
		const baseCp = parts.filter(p => !TONE_SET_D.has(p)).join(' ');
		const name = (cpToName[baseCp] || '').toLowerCase();
		if (name && /\b(woman|girl|mrs\.?|female)\b/.test(name)) return 'female';
		if (name && /\b(man|boy|mr\.?|male|santa)\b/.test(name) && !/\bwoman\b/.test(name)) return 'male';
		return 'neutral';
	}

	function resolveEmoji(item) {
		// Dual-tone emoji (handshake, wrestlers, etc.) — never apply global prefs
		if (classifyVariants(item) === 'dual') return item.e;
		if (!item.t?.length) return item.e;

		// Directional emoji — apply gender + skin tone to left-facing variants for grid display
		if (classifyVariants(item) === 'directional') {
			const wantGender = gender || 'neutral';
			const nonDir = item.t.filter(v => !v.cp.includes('27A1'));
			const genderPool = nonDir.filter(v => getGenderFromCp(v.cp) === wantGender);
			const pool = genderPool.length ? genderPool : nonDir;
			if (skinTone) {
				return pool.find(v => v.cp.includes(skinTone))?.e
					?? pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e
					?? item.e;
			}
			if (gender) {
				return pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e ?? item.e;
			}
			return item.e;
		}

		// G1 / G2 / G3 — apply gender preference then skin tone
		const wantGender = gender || 'neutral';
		const genderPool = item.t.filter(v => getGenderFromCp(v.cp) === wantGender);
		const pool = genderPool.length ? genderPool : item.t;

		if (skinTone) {
			return pool.find(v => v.cp.includes(skinTone))?.e
				?? pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e
				?? item.e;
		}
		if (gender) {
			// No tone — return the no-tone variant of the requested gender
			return pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e ?? item.e;
		}
		return item.e;
	}

	// Returns the display name for the resolved variant of an item.
	// e.g. 🧚 resolved to 🧚‍♀️ → "woman fairy"; 🚶 resolved to 🚶‍♂️ → "man walking"
	function resolvedName(item) {
		const resolved = resolveEmoji(item);
		if (resolved === item.e) return item.n;
		const v = item.t?.find(t => t.e === resolved);
		if (!v) return item.n;
		const g = getGenderFromCp(v.cp);
		if (g === 'female') {
			if (/^(woman|girl)\b/i.test(item.n)) return item.n;
			const replaced = item.n.replace(/^person\b/i, 'woman');
			return replaced !== item.n ? replaced : `woman ${item.n}`;
		}
		if (g === 'male') {
			if (/^(man|boy)\b/i.test(item.n)) return item.n;
			const replaced = item.n.replace(/^person\b/i, 'man');
			return replaced !== item.n ? replaced : `man ${item.n}`;
		}
		return item.n;
	}

	// Build a shortcode string from a base sc, a gender string, and a tone cp.
	// e.g. buildShortcode('fairy', 'female', '1F3FB') → ':fairy_woman_tone1:'
	function buildShortcode(base, g, tone) {
		if (!base) return '';
		let s = base;
		if (g === 'female') s += '_woman';
		else if (g === 'male') s += '_man';
		if (tone) s += '_' + TONE_SUFFIX_D[tone];
		return ':' + s + ':';
	}

	// Shortcode for the currently-resolved state of a grid item (respects global gender + tone).
	function resolvedShortcode(item) {
		const base = item.sc?.[0];
		if (!base) return '';
		if (classifyVariants(item) === 'dual') return ':' + base + ':';
		const resolvedE = resolveEmoji(item);
		if (resolvedE === item.e) return ':' + base + ':';
		const v = item.t?.find(t => t.e === resolvedE);
		if (!v) return ':' + base + ':';
		const g = getGenderFromCp(v.cp);
		const tone = v.cp.split(' ').find(p => TONE_SET_D.has(p)) ?? '';
		return buildShortcode(base, g === 'neutral' ? '' : g, tone);
	}

	// Shortcode for a specific variant inside a popover.
	// vObj = { e, cp } variant or null for the base.
	function variantShortcode(vObj, parentItem) {
		const base = parentItem.sc?.[0];
		if (!base) return '';
		if (!vObj || vObj.e === parentItem.e) return ':' + base + ':';
		const g = getGenderFromCp(vObj.cp);
		const tone = vObj.cp.split(' ').find(p => TONE_SET_D.has(p)) ?? '';
		return buildShortcode(base, g === 'neutral' ? '' : g, tone);
	}

	function saveRecent(e) {
		recent = [e, ...recent.filter(r => r !== e)].slice(0, MAX_RECENT);
		try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {}
	}

	function pickItem(item) {
		const e = resolveEmoji(item);
		saveRecent(e);
		onSelect?.(e);
	}

	function pickRaw(e) {
		saveRecent(e);
		onSelect?.(e);
	}

	// ── Search with ranking ───────────────────────────────────────────────────

	function scoreItem(item, q) {
		const qNoColon = q.replace(/^:+|:+$/g, '');
		if (item.sc.some(s => s === qNoColon)) return 1;
		if (item.scr?.some(s => s === q)) return 1;
		if (item.n === q) return 2;
		if (item.sc.some(s => s.startsWith(qNoColon))) return 3;
		if (item.n.startsWith(q)) return 4;
		if (item.st?.some(t => t.startsWith(q))) return 5;
		if (item.al?.some(a => a.toLowerCase() === q)) return 6;
		if (item.al?.some(a => a.toLowerCase().includes(q))) return 6;
		if (item.st?.some(t => t.includes(q))) return 7;
		return 0;
	}

	let searchResults = $derived(
		query.trim() && data
			? (() => {
				const q = query.toLowerCase().trim();
				const scored = [];
				for (const g of data.groups) {
					for (const item of g.items) {
						const score = scoreItem(item, q);
						if (score > 0) scored.push({ item, score });
					}
				}
				scored.sort((a, b) => a.score !== b.score ? a.score - b.score : (a.item.oi ?? 0) - (b.item.oi ?? 0));
				return scored.slice(0, 96).map(s => s.item);
			})()
			: null
	);

	let groupItems = $derived(
		!data || activeGroup < 0 ? null :
		data.groups[activeGroup]?.items ?? []
	);

	$effect(() => {
		void activeGroup; void query;
		gridEl?.scrollTo(0, 0);
	});
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && longPress) { longPress = null; e.stopPropagation(); } }} />

<div class="picker">
	<!-- Search -->
	<div class="search-row">
		<span class="search-icon">🔍</span>
		<input
			bind:this={searchEl}
			bind:value={query}
			class="search-input"
			type="text"
			placeholder="Search emoji…"
			autocomplete="off"
			spellcheck="false"
		/>
		{#if query}
			<button class="clear-btn" onclick={() => query = ''}>✕</button>
		{/if}
		<button
			class="settings-btn"
			class:active={showSettings}
			title="Emoji style"
			onclick={() => showSettings = !showSettings}
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3"/>
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
			</svg>
		</button>
	</div>

	<!-- Settings panel -->
	{#if showSettings}
		<div class="settings-panel">
			<span class="settings-label">Emoji style</span>
			<div class="style-options">
				<button class="style-opt" class:active={fontStyle === 'noto'} onclick={() => setFont('noto')}>
					<span class="style-swatch" style="font-family:'Noto Color Emoji',sans-serif">😀</span>
					Noto Color Emoji
				</button>
				<button class="style-opt" class:active={fontStyle === 'system'} onclick={() => setFont('system')}>
					<span class="style-swatch">😀</span>
					System (iOS)
				</button>
			</div>
		</div>
	{/if}

	<!-- Category tabs -->
	{#if !query.trim()}
		<div class="tabs" role="tablist">
			<button role="tab" class="tab tab-text" class:active={activeGroup === -2} title="Most used"
				onclick={() => { activeGroup = -2; }}>#</button>
			<button role="tab" class="tab tab-text" class:active={activeGroup === -1} title="Recently used"
				onclick={() => { activeGroup = -1; }}>🕐</button>
			{#if data}
				{#each data.groups as g, i}
					<button role="tab" class="tab" class:active={activeGroup === i} title={g.name}
						onclick={() => { activeGroup = i; }}>{g.icon || '•'}</button>
				{/each}
			{/if}
		</div>
	{/if}

	<!-- Emoji grid -->
	<div bind:this={gridEl} class="grid-wrap">
		{#if loading}
			<div class="state-msg">Loading…</div>
		{:else if searchResults !== null}
			{#if searchResults.length === 0}
				<div class="state-msg">No results for "{query}"</div>
			{:else}
				<div class="grid" class:noto={fontStyle === 'noto'}>
					{#each searchResults as item (item.cp)}
						<button class="cell" class:has-variants={item.t?.length} title={item.n}
							onpointerdown={(e) => startLp(e, item)}
							onpointermove={moveLp}
							onpointerup={cancelLp}
							onpointerleave={cancelLp}
							oncontextmenu={(e) => openVariants(e, item)}
							onmouseenter={() => preview = { e: resolveEmoji(item), n: resolvedName(item), sc: resolvedShortcode(item) }}
							onmouseleave={() => preview = null}
							onclick={() => { if (lpFired) { lpFired = false; return; } pickItem(item); }}>
							{resolveEmoji(item)}
						</button>
					{/each}
				</div>
			{/if}
		{:else if activeGroup === -2}
			<div class="grid" class:noto={fontStyle === 'noto'}>
				{#each (data?.popular ?? []) as e}
					{@const item = findItem(e)}
					{@const re = item ? resolveEmoji(item) : e}
					<button class="cell" class:has-variants={item?.t?.length}
						onpointerdown={(ev) => { if (item) startLp(ev, item); }}
						onpointermove={moveLp}
						onpointerup={cancelLp}
						onpointerleave={cancelLp}
						oncontextmenu={(ev) => { if (item) openVariants(ev, item); }}
						onmouseenter={() => preview = { e: re, n: item ? resolvedName(item) : '', sc: item ? resolvedShortcode(item) : '' }}
						onmouseleave={() => preview = null}
						onclick={() => { if (lpFired) { lpFired = false; return; } item ? pickItem(item) : pickRaw(e); }}>{re}</button>
				{/each}
			</div>
		{:else if activeGroup === -1}
			{#if recent.length === 0}
				<div class="state-msg">No recently used emoji yet.</div>
			{:else}
				<div class="grid" class:noto={fontStyle === 'noto'}>
					{#each recent as e}
						{@const item = findItem(e)}
						<button class="cell" class:has-variants={item?.t?.length}
							onpointerdown={(ev) => { if (item) startLp(ev, item); }}
							onpointermove={moveLp}
							onpointerup={cancelLp}
							onpointerleave={cancelLp}
							oncontextmenu={(ev) => { if (item) openVariants(ev, item); }}
							onmouseenter={() => preview = { e, n: item?.n ?? '', sc: item?.sc?.[0] ? ':' + item.sc[0] + ':' : '' }}
							onmouseleave={() => preview = null}
							onclick={() => { if (lpFired) { lpFired = false; return; } pickRaw(e); }}>{e}</button>
					{/each}
				</div>
			{/if}
		{:else if groupItems}
			<div class="grid" class:noto={fontStyle === 'noto'}>
				{#each groupItems as item (item.cp)}
					<button class="cell" class:has-variants={item.t?.length} title={item.n}
						onpointerdown={(e) => startLp(e, item)}
						onpointermove={moveLp}
						onpointerup={cancelLp}
						onpointerleave={cancelLp}
						oncontextmenu={(e) => openVariants(e, item)}
						onmouseenter={() => preview = { e: resolveEmoji(item), n: resolvedName(item), sc: resolvedShortcode(item) }}
						onmouseleave={() => preview = null}
						onclick={() => { if (lpFired) { lpFired = false; return; } pickItem(item); }}>
						{resolveEmoji(item)}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Preview bar -->
	<div class="preview-bar">
		{#if preview}
			<span class="preview-glyph" class:noto={fontStyle === 'noto'}>{preview.e}</span>
			<span class="preview-name">{preview.n}</span>
			{#if preview.sc}<span class="preview-sc">{preview.sc}</span>{/if}
		{:else}
			<span class="preview-hint">Hover an emoji to preview</span>
		{/if}
	</div>

</div>

<!-- Variant picker popover — rendered outside .picker to escape overflow:hidden -->
{#if longPress}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lp-backdrop" onclick={() => longPress = null}></div>

	{@const vtype = classifyVariants(longPress.item)}

	{#if vtype === 'dual'}
		<!-- Half-selector for dual-tone emoji: pick left tone (top row) + right tone (bottom row) -->
		{@const matrix = buildDualMatrix(longPress.item)}
		{@const TONES = ['1F3FB','1F3FC','1F3FD','1F3FE','1F3FF']}
		{@const dualResult = getDualEmoji(matrix, dualLeft, dualRight)}
		<div class="lp-pop lp-dual" class:noto={fontStyle === 'noto'}
			style="left:{longPress.x}px;top:{longPress.y}px">

			<!-- Left-tone row (shows left halves) -->
			<div class="dual-row">
				{#each TONES as tone, ti}
					{@const cell = matrix[ti + 1][ti + 1]}
					<button class="dual-half-btn" class:active={dualLeft === tone}
						onclick={() => dualLeft = tone}
						onmouseenter={() => preview = { e: cell?.e ?? longPress.item.e, n: variantDisplayName(cell, longPress.item), sc: variantShortcode(cell, longPress.item) }}
						onmouseleave={() => preview = null}>
						<span class="half-wrap half-left"><span class="half-glyph">{cell?.e ?? longPress.item.e}</span></span>
					</button>
				{/each}
			</div>

			<!-- Right-tone row (shows right halves) -->
			<div class="dual-row">
				{#each TONES as tone, ti}
					{@const cell = matrix[ti + 1][ti + 1]}
					<button class="dual-half-btn" class:active={dualRight === tone}
						onclick={() => dualRight = tone}
						onmouseenter={() => preview = { e: cell?.e ?? longPress.item.e, n: variantDisplayName(cell, longPress.item), sc: variantShortcode(cell, longPress.item) }}
						onmouseleave={() => preview = null}>
						<span class="half-wrap half-right"><span class="half-glyph">{cell?.e ?? longPress.item.e}</span></span>
					</button>
				{/each}
			</div>

			<!-- Footer: default emoji (left) + composed result or silhouette (right) -->
			<div class="dual-footer">
				<button class="dual-foot-btn"
					onclick={() => pickVariant(null, longPress.item)}
					onmouseenter={() => preview = { e: longPress.item.e, n: longPress.item.n, sc: longPress.item.sc?.[0] ? ':' + longPress.item.sc[0] + ':' : '' }}
					onmouseleave={() => preview = null}>
					<span class="dual-foot-glyph">{longPress.item.e}</span>
				</button>
				{#if dualResult}
					<button class="dual-foot-btn dual-result"
						onclick={() => pickVariant(dualResult, longPress.item)}
						onmouseenter={() => preview = { e: dualResult.e, n: variantDisplayName(dualResult, longPress.item), sc: variantShortcode(dualResult, longPress.item) }}
						onmouseleave={() => preview = null}>
						<span class="dual-foot-glyph">{dualResult.e}</span>
					</button>
				{:else}
					<span class="dual-foot-btn dual-silhouette">
						<span class="dual-foot-glyph">{longPress.item.e}</span>
					</span>
				{/if}
			</div>
		</div>

	{:else if vtype === 'directional'}
		<!-- Direction-split popover: ← tab shows left-facing, → tab shows right-facing -->
		{@const nonDir = longPress.item.t.filter(v => !v.cp.includes('27A1'))}
		{@const dirRight = longPress.item.t.filter(v => v.cp.includes('27A1'))}
		<div class="lp-pop lp-dir" class:noto={fontStyle === 'noto'}
			style="left:{longPress.x}px;top:{longPress.y}px">
			<div class="lp-dir-header">
				<button class="lp-dir-tab" class:active={!showDir}
					onclick={(e) => { e.stopPropagation(); showDir = false; }}>←</button>
				<button class="lp-dir-tab" class:active={showDir}
					onclick={(e) => { e.stopPropagation(); showDir = true; }}>→</button>
			</div>
			{#if !showDir}
				<button class="cell lp-cell"
					onclick={() => pickVariant(null, longPress.item)}
					onmouseenter={() => preview = { e: longPress.item.e, n: longPress.item.n, sc: variantShortcode(null, longPress.item) }}
					onmouseleave={() => preview = null}>
					{longPress.item.e}
				</button>
				{#each nonDir as v}
					<button class="cell lp-cell"
						onclick={() => pickVariant(v, longPress.item)}
						onmouseenter={() => preview = { e: v.e, n: variantDisplayName(v, longPress.item), sc: variantShortcode(v, longPress.item) }}
						onmouseleave={() => preview = null}>
						{v.e}
					</button>
				{/each}
			{:else}
				{#each dirRight as v}
					<button class="cell lp-cell"
						onclick={() => pickVariant(v, longPress.item)}
						onmouseenter={() => preview = { e: v.e, n: variantDisplayName(v, longPress.item), sc: variantShortcode(v, longPress.item) }}
						onmouseleave={() => preview = null}>
						{v.e}
					</button>
				{/each}
			{/if}
		</div>

	{:else if vtype === 'multibase'}
		<!-- Grouped rows: each row is one base codepoint family (neutral / woman / man, etc.) -->
		{@const groups = buildMultibaseGroups(longPress.item)}
		<div class="lp-pop lp-multibase" class:noto={fontStyle === 'noto'}
			style="left:{longPress.x}px;top:{longPress.y}px">
			{#each groups as group, gi}
				{#if gi > 0}<div class="lp-row-sep"></div>{/if}
				{#each group as entry}
					{@const isBase = entry.e === longPress.item.e}
					<button class="cell lp-cell"
						onclick={() => pickVariant(isBase ? null : entry, longPress.item)}
						onmouseenter={() => preview = { e: entry.e, n: variantDisplayName(entry, longPress.item), sc: variantShortcode(isBase ? null : entry, longPress.item) }}
						onmouseleave={() => preview = null}>
						{entry.e}
					</button>
				{/each}
			{/each}
		</div>

	{:else}
		<!-- Simple variant grid (skin tones only, G1/G3 emoji) -->
		<div class="lp-pop" class:noto={fontStyle === 'noto'}
			style="left:{longPress.x}px;top:{longPress.y}px;grid-template-columns:repeat({variantCols(longPress.item)},36px)">
			<button class="cell lp-cell"
				onclick={() => pickVariant(null, longPress.item)}
				onmouseenter={() => preview = { e: longPress.item.e, n: longPress.item.n, sc: variantShortcode(null, longPress.item) }}
				onmouseleave={() => preview = null}>
				{longPress.item.e}
			</button>
			{#each longPress.item.t as v}
				<button class="cell lp-cell"
					onclick={() => pickVariant(v, longPress.item)}
					onmouseenter={() => preview = { e: v.e, n: variantDisplayName(v, longPress.item), sc: variantShortcode(v, longPress.item) }}
					onmouseleave={() => preview = null}>
					{v.e}
				</button>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.picker {
		width: 340px;
		height: 380px;
		background: #fff;
		border-radius: 12px;
		border: 1px solid #e0dbd4;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-size: 0.82rem;
		color: #333;
	}

	/* ── Search ── */
	.search-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.6rem 0.4rem;
		border-bottom: 1px solid #ede8e2;
		flex-shrink: 0;
	}
	.search-icon { font-size: 0.85rem; flex-shrink: 0; opacity: 0.4; }
	.search-input {
		flex: 1;
		background: none;
		border: none;
		outline: none;
		color: #222;
		font-size: 0.82rem;
		font-family: inherit;
	}
	.search-input::placeholder { color: #aaa; }
	.clear-btn {
		background: none;
		border: none;
		color: #aaa;
		cursor: pointer;
		font-size: 0.7rem;
		padding: 0;
		line-height: 1;
		flex-shrink: 0;
	}
	.clear-btn:hover { color: #555; }
	.settings-btn {
		background: none;
		border: none;
		color: #bbb;
		cursor: pointer;
		padding: 0.2rem;
		line-height: 0;
		border-radius: 5px;
		flex-shrink: 0;
		transition: color 0.1s, background 0.1s;
	}
	.settings-btn:hover, .settings-btn.active { color: #555; background: #f0ebe3; }

	/* ── Settings panel ── */
	.settings-panel {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.75rem;
		border-bottom: 1px solid #ede8e2;
		background: #faf8f5;
		flex-shrink: 0;
	}
	.settings-label {
		font-size: 0.72rem;
		color: #999;
		white-space: nowrap;
	}
	.style-options { display: flex; gap: 0.4rem; }
	.style-opt {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		background: none;
		border: 1.5px solid #e0dbd4;
		border-radius: 8px;
		padding: 0.2rem 0.5rem;
		font-size: 0.72rem;
		color: #666;
		cursor: pointer;
		transition: border-color 0.1s, background 0.1s, color 0.1s;
		white-space: nowrap;
	}
	.style-opt:hover { background: #f0ebe3; border-color: #ccc; }
	.style-opt.active { border-color: #555; color: #222; background: #f0ebe3; }
	.style-swatch { font-size: 1rem; line-height: 1; }

	/* ── Tabs ── */
	.tabs {
		display: flex;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid #ede8e2;
		padding: 0 0.25rem;
		flex-shrink: 0;
	}
	.tabs::-webkit-scrollbar { display: none; }
	.tab {
		background: none;
		border: none;
		font-size: 1.05rem;
		width: 2.1rem;
		height: 2.1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: 6px;
		flex-shrink: 0;
		opacity: 0.35;
		transition: opacity 0.12s, background 0.12s;
		padding: 0;
	}
	.tab:hover { opacity: 0.7; background: #f5f2ee; }
	.tab.active { opacity: 1; background: #ede8e2; }
	.tab-text { font-size: 0.78rem; font-weight: 700; letter-spacing: -0.02em; }

	/* ── Grid ── */
	.grid-wrap {
		flex: 1;
		overflow-y: scroll;
		scrollbar-width: thin;
		scrollbar-color: #ddd transparent;
		padding: 0.3rem 0.25rem;
		min-height: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(9, 36px);
		justify-content: center;
		gap: 0;
	}
	.grid.noto .cell {
		font-family: 'Noto Color Emoji', sans-serif;
	}
	.cell {
		background: none;
		border: none;
		font-size: 1.3rem;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: 6px;
		line-height: 1;
		transition: background 0.08s;
		padding: 0;
		position: relative;
	}
	.cell:hover { background: #f0ebe3; }
	.cell:active { background: #e5dfd7; }

	/* Small dot indicator on emoji with variants */
	.cell.has-variants::after {
		content: '';
		position: absolute;
		bottom: 3px;
		right: 3px;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: #c0bab2;
	}

	.state-msg {
		color: #aaa;
		font-size: 0.78rem;
		text-align: center;
		padding: 2rem 1rem;
	}

	/* ── Preview bar ── */
	.preview-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.65rem;
		border-top: 1px solid #ede8e2;
		min-height: 2rem;
		flex-shrink: 0;
	}
	.preview-glyph { font-size: 1.25rem; line-height: 1; flex-shrink: 0; }
	.preview-glyph.noto { font-family: 'Noto Color Emoji', sans-serif; }
	.preview-name  { font-size: 0.75rem; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
	.preview-sc    { font-size: 0.68rem; color: #bbb; font-family: monospace; white-space: nowrap; flex-shrink: 0; }
	.preview-hint  { font-size: 0.72rem; color: #ccc; }


	/* ── Variant picker popover ── */
	.lp-backdrop {
		position: fixed;
		inset: 0;
		z-index: 2999;
	}

	.lp-pop {
		position: fixed;
		transform: translate(-50%, calc(-100% - 10px));
		background: #fff;
		border: 1px solid #e0dbd4;
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
		padding: 4px;
		z-index: 3000;
		display: grid;
		gap: 0;
		max-height: 300px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: #ddd transparent;
	}

	.lp-pop.noto .lp-cell {
		font-family: 'Noto Color Emoji', sans-serif;
	}

	/* Remove the variant dot from cells inside the popover */
	.lp-cell::after { display: none; }

	/* ── Dual-tone half-selector ── */
	.lp-dual {
		display: flex !important; /* override .lp-pop grid */
		flex-direction: column;
		gap: 3px;
		padding: 6px;
		width: auto;
	}

	.dual-row {
		display: flex;
		gap: 2px;
	}

	/* Each half-button shows one clipped half of the emoji */
	.dual-half-btn {
		background: none;
		border: 1.5px solid transparent;
		border-radius: 6px;
		width: 30px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		overflow: hidden;
		transition: background 0.08s, border-color 0.08s;
		flex-shrink: 0;
	}
	.dual-half-btn:hover  { background: #f0ebe3; }
	.dual-half-btn.active { border-color: #666; background: #ede8e2; }
	.lp-dual.noto .dual-half-btn .half-glyph { font-family: 'Noto Color Emoji', sans-serif; }

	/* Clip wrappers: show left or right half of the emoji glyph */
	.half-wrap {
		display: block;
		width: 18px;
		height: 30px;
		overflow: hidden;
		flex-shrink: 0;
	}
	.half-glyph {
		display: block;
		font-size: 1.75rem;
		line-height: 30px;
		width: 36px; /* full glyph width so both halves are available */
	}
	.half-right .half-glyph {
		margin-left: -18px; /* shift left so right half is visible */
	}

	/* Footer row: default emoji + composed result */
	.dual-footer {
		display: flex;
		gap: 4px;
		padding-top: 5px;
		border-top: 1px solid #ede8e2;
		margin-top: 1px;
	}
	.dual-foot-btn {
		flex: 1;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1.5px solid #e0dbd4;
		background: none;
		cursor: pointer;
		padding: 0;
		transition: background 0.08s;
	}
	.dual-foot-btn:hover { background: #f0ebe3; }
	.dual-foot-btn.dual-result { border-color: #aaa; }
	.dual-silhouette {
		flex: 1;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1.5px dashed #ddd;
	}
	.dual-silhouette .dual-foot-glyph { filter: grayscale(1) opacity(0.3); }
	.dual-foot-glyph {
		font-size: 1.75rem;
		line-height: 1;
	}
	.lp-dual.noto .dual-foot-glyph { font-family: 'Noto Color Emoji', sans-serif; }

	/* Multi-base grouped rows (profession, child/girl/boy, Mx/Mrs/Mr Claus, etc.) */
	.lp-multibase {
		grid-template-columns: repeat(6, 36px);
	}

	.lp-row-sep {
		grid-column: 1 / -1;
		height: 1px;
		background: #ede8e2;
		margin: 2px 0;
	}

	/* Directional variant popover */
	.lp-dir {
		grid-template-columns: repeat(6, 36px);
	}

	.lp-dir-header {
		grid-column: 1 / -1;
		display: flex;
		gap: 0.25rem;
		padding-bottom: 4px;
		border-bottom: 1px solid #ede8e2;
		margin-bottom: 2px;
	}

	.lp-dir-tab {
		flex: 1;
		background: none;
		border: 1.5px solid #e0dbd4;
		border-radius: 6px;
		font-size: 0.9rem;
		height: 26px;
		cursor: pointer;
		color: #888;
		transition: background 0.1s, color 0.1s, border-color 0.1s;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.lp-dir-tab:hover { background: #f0ebe3; color: #444; }
	.lp-dir-tab.active { background: #ede8e2; border-color: #999; color: #222; font-weight: 700; }
</style>
