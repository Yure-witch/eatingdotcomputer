<script module>
	// The 546 KB dataset is owned by $lib/emoji-data.js and shared with the
	// Kitchen / Telegram / names surfaces — one fetch, one parse per page.
	import { loadEmojiData, getCachedEmojiData } from '$lib/emoji-data.js';

	// cp → name index, memoised for the page (see applyEmojiData below).
	let _cpToName = null;

	// Variant classification is pure per emoji and each call splits every one of
	// the item's variant codepoints, so it's memoised by cp for the page.
	// resolveEmoji asks for it up to twice per item, over ~1700 items.
	const _variantKind = new Map();

	// Fully-resolved group sections, cached across mounts. Resolving every
	// group is the single most expensive thing the picker does (~30ms for 1783
	// items) and it depends only on the dataset plus the user's tone/gender/
	// per-emoji selections — none of which change while the picker is closed.
	// Without this cache every single open paid the full 30ms again.
	let _groupsCache = { key: null, data: null, value: null };
</script>

<script>
	import { onMount, tick } from 'svelte';
	import { initSemanticSearch, searchEmoji, isSemanticReady, onSemanticReady } from '$lib/emoji-semantic.js';
	import PickerStickyBtn from './PickerStickyBtn.svelte';

	let { onSelect, onClose = null } = $props();

	// The search box collapses into a single 🔍 control pinned at the left of
	// the category bar; clicking it swaps the categories for the input.
	let searchOpen = $state(false);
	function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) tick().then(() => searchEl?.focus());
		else query = '';
	}

	const RECENT_KEY         = 'emoji-recent';
	const FONT_KEY           = 'emoji-font';
	const TONE_KEY           = 'emoji-tone';
	const GENDER_KEY         = 'emoji-gender';
	const DUAL_SELECTIONS_KEY = 'emoji-dual-sel'; // { [cp]: { left, right } }
	const DIR_SELECTIONS_KEY  = 'emoji-dir-sel';  // { [cp]: 'left' | 'right' }
	const MAX_RECENT = 40;

	// $state.raw, NOT $state: the dataset is ~1700 items deep and is only ever
	// swapped wholesale, never mutated. A plain $state would wrap the whole
	// thing in a deep Proxy, so every item read while resolving the grid went
	// through a proxy trap — and because each mount got its OWN proxy over the
	// same shared object, identity comparisons against the cached copy could
	// never match (Svelte warns: state_proxy_equality_mismatch).
	let data         = $state.raw(null);
	let loading      = $state(true);
	let query        = $state('');
	let activeGroup  = $state(-1);  // -2 = popular, -1 = recent, 0..N-1 = group index (all flow inline)
	let tabsEl       = $state(null); // category strip — auto-scrolled to keep the active tab in view
	let skinTone     = $state('');  // '' | '1F3FB'–'1F3FF', set by picking a variant
	let gender       = $state('');  // '' | 'female' | 'male', set by picking a variant
	let recent       = $state([]);
	let preview      = $state(null);
	let fontStyle    = $state('noto');   // 'noto' | 'system'
	let showSettings = $state(false);
	let searchEl     = $state(null);
	let gridEl       = $state(null);

	// ── Semantic search state ─────────────────────────────────────────────────
	let semanticScores   = $state(null);  // Map<cp, score> for keyword-hit re-ranking
	let semanticOnlyCps  = $state([]);    // cp[] that scored semantically but missed keywords
	let semanticReady    = $state(false);
	let semanticWorking  = $state(false); // spinner while embedding
	let _semanticDebounce = null;

	// ── Long press / variant picker ───────────────────────────────────────────
	let longPress  = $state(null); // { item, x, y } | null
	let lpTimer    = null;
	let lpFired    = false;  // suppresses the click that follows a long press
	let lpPopEl    = $state(null);
	let pickerEl   = $state(null);
	// Position state: 'above' = popover's bottom edge 5 px above
	// cell's top; 'below' = popover's top edge 5 px below cell's
	// bottom. Default to 'above'; the post-mount effect flips to
	// 'below' if there isn't room above the cell.
	let lpPlacement = $state('above');
	// Horizontal nudge applied AFTER measurement so the popover
	// stays inside the picker even if cellCenterX is near an edge.
	// 0 = no nudge needed; negative pushes left, positive pushes
	// right. Applied as a translateX offset on top of the centering
	// transform.
	let lpNudgeX = $state(0);

	// First-paint positioning is fully synchronous via the inline
	// style + CSS transforms (no measurement needed). This effect
	// runs after the popover mounts to:
	//   - flip vertical to 'below' if the popover would extend
	//     above the viewport or above the picker top,
	//   - nudge horizontal so the popover stays inside the picker's
	//     left / right bounds.
	$effect(() => {
		if (!longPress || !lpPopEl) return;
		// Reset before measuring so the inline transform is the
		// "pristine" centered-on-cell version; otherwise a stale
		// nudge from a previous open would skew the rect.
		lpPlacement = 'above';
		lpNudgeX = 0;
		requestAnimationFrame(() => {
			if (!lpPopEl || !longPress) return;
			const r = lpPopEl.getBoundingClientRect();
			if (!r.width || !r.height) return;
			const pickerRect = pickerEl?.getBoundingClientRect();
			const margin = 6;
			const vh = window.innerHeight;

			// Vertical: prefer above. With placement='above' the
			// popover's bottom edge sits at cellTop - 5, so its top
			// edge is at cellTop - 5 - r.height. Flip below if that
			// would push above the viewport or the picker's top.
			const aboveTopEdge = longPress.cellTop - 5 - r.height;
			const minTop = Math.max(margin, pickerRect ? pickerRect.top + margin : margin);
			if (aboveTopEdge < minTop) {
				lpPlacement = 'below';
				// If 'below' also won't fit, leave it — the popover
				// will hang off the bottom; user can scroll.
			}

			// Horizontal: clamp left edge into the picker.
			if (pickerRect) {
				const leftEdge = r.left;
				const rightEdge = r.right;
				const leftBound = pickerRect.left + margin;
				const rightBound = pickerRect.right - margin;
				if (leftEdge < leftBound) lpNudgeX = leftBound - leftEdge;
				else if (rightEdge > rightBound) lpNudgeX = rightBound - rightEdge;
			}
		});
	});
	let lpX0 = 0, lpY0 = 0;
	let showDir    = $state(false); // directional popover: false=left-facing, true=right-facing
	let dualLeft   = $state(undefined); // undefined=not yet picked, '1F3FB'–'1F3FF'=tone selected
	let dualRight  = $state(undefined);
	let dualSelections = $state({}); // { [cp]: { left, right } } — per-emoji dual tone picks
	let dirSelections  = $state({}); // { [cp]: 'left' | 'right' } — per-emoji direction picks

	const TONE_SET_D    = new Set(['1F3FB','1F3FC','1F3FD','1F3FE','1F3FF']);
	const TONE_IDX_D    = {'1F3FB':1,'1F3FC':2,'1F3FD':3,'1F3FE':4,'1F3FF':5};
	const TONE_SUFFIX_D = {'1F3FB':'tone1','1F3FC':'tone2','1F3FD':'tone3','1F3FE':'tone4','1F3FF':'tone5'};

	function classifyVariants(item) {
		if (!item?.t?.length) return 'simple';
		const memo = _variantKind.get(item.cp);
		if (memo !== undefined) return memo;
		const kind = _classifyVariantsUncached(item);
		_variantKind.set(item.cp, kind);
		return kind;
	}
	function _classifyVariantsUncached(item) {
		if (item.t.some(v => v.cp.includes('27A1'))) return 'directional';
		// Dual-tone: at least one variant carries 2 skin-tone codepoints
		if (item.t.some(v => v.cp.split(' ').filter(p => TONE_SET_D.has(p)).length === 2)) return 'dual';
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

	// Build the /emoji-halves/ SVG src for a variant codepoint.
	// - Gendered ZWJ variants (e.g. '1F93C 1F3FB 200D 2642 FE0F') → strip gender suffix
	// - Couple heart/kiss sequences (1F469…2764…) → fall back to neutral base + first tone
	function dualHalfSrc(cp, side) {
		let safeCp = cp.replace(/ 200D 264[02] FE0F$/, '').trim();
		// Couple with heart (2764) or kiss (1F48B) sequences have no toned Noto SVGs
		if (/\b2764\b/.test(safeCp)) {
			const hasKiss = /\b1F48B\b/.test(safeCp);
			const baseCp = hasKiss ? '1F48F' : '1F491';
			const firstTone = safeCp.split(' ').find(p => TONE_SET_D.has(p));
			safeCp = firstTone ? `${baseCp} ${firstTone}` : baseCp;
		}
		const slug = 'emoji_u' + safeCp.toLowerCase().split(' ').join('_');
		return `/emoji-halves/${slug}-${side}.svg`;
	}

	// Canvas-rendered half images for system (iOS/Apple) font mode.
	// Renders the emoji glyph using the system font, then grays out the inactive half.
	const _sysHalfCache = new Map();
	function systemHalfSrc(emojiChar, side) {
		if (typeof document === 'undefined') return '';
		const key = emojiChar + '\x00' + side;
		if (_sysHalfCache.has(key)) return _sysHalfCache.get(key);
		const SIZE = 80;
		const c = document.createElement('canvas');
		c.width = SIZE; c.height = SIZE;
		const ctx = c.getContext('2d');
		ctx.font = `${SIZE * 0.78}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(emojiChar, SIZE / 2, SIZE / 2 + 3);
		const mid = SIZE / 2;
		const img = ctx.getImageData(0, 0, SIZE, SIZE);
		const d = img.data;
		if (side === 'gray') {
			for (let i = 0; i < d.length; i += 4) {
				if (d[i + 3] > 10) { d[i] = 0xa0; d[i+1] = 0xa0; d[i+2] = 0xa0; }
			}
		} else {
			const [gs, ge] = side === 'left' ? [mid, SIZE] : [0, mid];
			for (let y = 0; y < SIZE; y++) {
				for (let x = gs; x < ge; x++) {
					const i = (y * SIZE + x) * 4;
					if (d[i + 3] > 10) { d[i] = 0xa0; d[i+1] = 0xa0; d[i+2] = 0xa0; }
				}
			}
		}
		ctx.putImageData(img, 0, 0);
		const uri = c.toDataURL();
		_sysHalfCache.set(key, uri);
		return uri;
	}

	// Unified half-image src: canvas for system mode, static SVG for noto mode.
	function halfSrc(emojiChar, cp, side) {
		if (fontStyle === 'system') return systemHalfSrc(emojiChar, side);
		return dualHalfSrc(cp, side);
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
	// cp → name. Built once per page from the shared dataset (see
	// applyEmojiData) rather than re-walking ~3800 items on every mount.
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
		const targetEl = e.currentTarget;
		lpTimer = setTimeout(() => {
			// Anchor on the cell's bounding rect, not the mouse — the
			// popover hangs above the long-pressed cell with its
			// BOTTOM edge sitting 5 px above the cell's TOP. If
			// there's no room above (cellTop near viewport top), the
			// position effect below flips it underneath the cell
			// instead. Horizontal anchor is the cell's center,
			// clamped to the picker bounds so the popover always
			// sits over the picker chrome.
			const r = targetEl.getBoundingClientRect();
			lpFired = true;
			showDir = false;
			longPress = {
				item,
				cellTop: r.top,
				cellBottom: r.bottom,
				cellCenterX: r.left + r.width / 2
			};
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
		// Anchor on the cell's bounding rect for right-clicks too.
		const r = e.currentTarget.getBoundingClientRect();
		longPress = {
			item,
			cellTop: r.top,
			cellBottom: r.bottom,
			cellCenterX: r.left + r.width / 2
		};
	}

	// When a variant popover opens, pre-populate dualLeft/dualRight/showDir from saved per-emoji selections.
	$effect(() => {
		if (!longPress) return;
		const vtype = classifyVariants(longPress.item);
		const cp = longPress.item.cp;
		if (vtype === 'dual') {
			const sel = dualSelections[cp];
			dualLeft  = sel?.left  ?? undefined;
			dualRight = sel?.right ?? undefined;
		} else if (vtype === 'directional') {
			showDir = dirSelections[cp] === 'right';
		}
	});

	// Called when picking from the variant popover.
	// vObj = { e, cp } for a variant, or null for the base emoji.
	// parentItem = the item whose popover is open.
	function pickVariant(vObj, parentItem) {
		const glyph = vObj ? vObj.e : parentItem.e;
		const cp    = vObj ? vObj.cp : parentItem.cp;
		const vtype = classifyVariants(parentItem);

		if (vtype === 'dual') {
			if (vObj === null) {
				// User picked the untoned base — clear any saved selection for this emoji
				const { [parentItem.cp]: _removed, ...rest } = dualSelections;
				dualSelections = rest;
			} else {
				// User picked a toned result — save the left+right tone pair
				dualSelections = { ...dualSelections, [parentItem.cp]: { left: dualLeft, right: dualRight } };
			}
			try { localStorage.setItem(DUAL_SELECTIONS_KEY, JSON.stringify(dualSelections)); } catch {}
		} else if (vtype === 'directional') {
			// Save per-emoji direction selection
			const dir = vObj && vObj.cp.includes('27A1') ? 'right' : 'left';
			dirSelections = { ...dirSelections, [parentItem.cp]: dir };
			try { localStorage.setItem(DIR_SELECTIONS_KEY, JSON.stringify(dirSelections)); } catch {}
			// Also propagate tone/gender globally (direction is the only per-emoji exception)
			const toneInCp = cp.split(' ').find(p => TONE_SET_D.has(p)) ?? '';
			const genderInCp = getGenderFromCp(cp);
			const parentHasTones = (parentItem.t ?? []).some(v =>
				v.cp.split(' ').some(p => TONE_SET_D.has(p))
			);
			const allGenders = new Set([
				getGenderFromCp(parentItem.cp),
				...(parentItem.t ?? []).map(v => getGenderFromCp(v.cp))
			]);
			if (parentHasTones) {
				skinTone = toneInCp;
				try { localStorage.setItem(TONE_KEY, toneInCp); } catch {}
			}
			if (allGenders.size > 1) {
				const g = genderInCp === 'neutral' ? '' : genderInCp;
				gender = g;
				try { localStorage.setItem(GENDER_KEY, g); } catch {}
			}
		} else {
			const toneInCp = cp.split(' ').find(p => TONE_SET_D.has(p)) ?? '';
			const genderInCp = getGenderFromCp(cp);

			// Does this emoji support tone choices?
			const parentHasTones = (parentItem.t ?? []).some(v =>
				v.cp.split(' ').some(p => TONE_SET_D.has(p))
			);

			// Does this emoji support gender choice?
			const allGenders = new Set([
				getGenderFromCp(parentItem.cp),
				...(parentItem.t ?? []).map(v => getGenderFromCp(v.cp))
			]);
			const parentHasGenderChoice = allGenders.size > 1;

			if (parentHasTones) {
				skinTone = toneInCp;
				try { localStorage.setItem(TONE_KEY, toneInCp); } catch {}
			}

			if (parentHasGenderChoice) {
				const g = genderInCp === 'neutral' ? '' : genderInCp;
				gender = g;
				try { localStorage.setItem(GENDER_KEY, g); } catch {}
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

	function applyEmojiData(d) {
		data = d;
		if (!_cpToName) {
			const m = {};
			for (const g of d.groups) for (const item of g.items) m[item.cp] = item.n;
			_cpToName = m;
		}
		cpToName = _cpToName;
		loading = false;
	}

	onMount(async () => {
		try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch {}
		try { fontStyle = localStorage.getItem(FONT_KEY) ?? 'noto'; } catch {}
		try { skinTone  = localStorage.getItem(TONE_KEY) ?? ''; } catch {}
		try { gender    = localStorage.getItem(GENDER_KEY) ?? ''; } catch {}
		try { const raw = localStorage.getItem(DUAL_SELECTIONS_KEY); if (raw) dualSelections = JSON.parse(raw); } catch {}
		try { const raw = localStorage.getItem(DIR_SELECTIONS_KEY);  if (raw) dirSelections  = JSON.parse(raw); } catch {}
		// Warm path: the dataset is already parsed (another surface loaded it,
		// or the page prewarmed it), so bind it synchronously. Awaiting an
		// already-resolved promise still costs a microtask, which is a full
		// frame of "Loading…" every time the picker opens.
		const cached = getCachedEmojiData();
		if (cached) applyEmojiData(cached);
		else {
			const d = await loadEmojiData();
			applyEmojiData(d);
		}
		// Auto-focus the search ONLY on desktop (fine pointer). On touch /
		// native the focus pops the on-screen keyboard the instant the picker
		// opens — search must stay un-activated until the user taps it.
		if (!window.matchMedia?.('(pointer: coarse)')?.matches) {
			requestAnimationFrame(() => searchEl?.focus());
		}
	});

	// Sync Noto Color Emoji font: toggle the html class + inject Google Fonts link when needed
	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.toggle('noto-emoji', fontStyle === 'noto');
		if (fontStyle !== 'noto') return;
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

	// All state params are passed explicitly so Svelte 5 tracks them as reactive
	// dependencies in $derived.by — do not remove the parameters.
	function resolveEmoji(item, tone = skinTone, gend = gender, ds = dualSelections, dirs = dirSelections) {
		if (!item.t?.length) return item.e;

		// Dual-tone emoji — show the per-emoji saved selection if any
		if (classifyVariants(item) === 'dual') {
			const sel = ds[item.cp];
			if (!sel?.left || !sel?.right) return item.e;
			const { left, right } = sel;
			if (left === right) {
				// Diagonal: prefer two-tone same-color variant (e.g. "1F91D 1F3FB 1F3FB"),
				// fall back to single-tone variant (e.g. "1F91D 1F3FB") — different emoji use different forms.
				const v = item.t.find(v => {
					const ts = v.cp.split(' ').filter(p => TONE_SET_D.has(p));
					return ts.length === 2 && ts[0] === left && ts[1] === left;
				}) ?? item.t.find(v => {
					const ts = v.cp.split(' ').filter(p => TONE_SET_D.has(p));
					return ts.length === 1 && ts[0] === left;
				});
				return v?.e ?? item.e;
			}
			// Off-diagonal: two-tone variant
			const v = item.t.find(v => {
				const ts = v.cp.split(' ').filter(p => TONE_SET_D.has(p));
				return ts.length === 2 && ts[0] === left && ts[1] === right;
			});
			return v?.e ?? item.e;
		}

		// Directional emoji — respect per-emoji saved direction, apply global gender + tone
		if (classifyVariants(item) === 'directional') {
			const wantGender = gend || 'neutral';
			const wantDir = dirs[item.cp]; // 'right' | undefined → default left
			const facingPool = wantDir === 'right'
				? item.t.filter(v => v.cp.includes('27A1'))
				: item.t.filter(v => !v.cp.includes('27A1'));
			const pool2 = facingPool.length ? facingPool : item.t.filter(v => !v.cp.includes('27A1'));
			const genderPool = pool2.filter(v => getGenderFromCp(v.cp) === wantGender);
			const pool = genderPool.length ? genderPool : (gend ? pool2 : []);
			if (tone) {
				return pool.find(v => v.cp.includes(tone))?.e
					?? pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e
					?? item.e;
			}
			if (gend) {
				return pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e ?? item.e;
			}
			return pool[0]?.e ?? item.e;
		}

		// G1 / G2 / G3 — apply gender preference then skin tone
		const wantGender = gend || 'neutral';
		const genderPool = item.t.filter(v => getGenderFromCp(v.cp) === wantGender);
		// Only fall back to all variants when the user has an explicit gender preference.
		// When gend='' (neutral) and no neutral variants exist, keep pool empty so we
		// return item.e rather than accidentally picking a random gendered variant.
		const pool = genderPool.length ? genderPool : (gend ? item.t : []);

		if (tone) {
			return pool.find(v => v.cp.includes(tone))?.e
				?? pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e
				?? item.e;
		}
		if (gend) {
			return pool.find(v => !v.cp.split(' ').some(p => TONE_SET_D.has(p)))?.e ?? item.e;
		}
		return item.e;
	}

	// Returns the display name for the resolved variant of an item.
	// e.g. 🧚 resolved to 🧚‍♀️ → "woman fairy"; 🚶 resolved to 🚶‍♂️ → "man walking"
	function resolvedName(item) {
		const resolved = resolveEmoji(item, skinTone, gender);
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
		const resolvedE = resolveEmoji(item, skinTone, gender);
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
		const e = resolveEmoji(item, skinTone, gender, dualSelections, dirSelections);
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
						const kwScore = scoreItem(item, q);
						if (kwScore > 0) {
							// Semantic bonus: within same keyword tier, higher semantic score sorts earlier
							const semBonus = semanticScores?.get(item.cp) ?? 0;
							scored.push({ item, kwScore, semBonus });
						}
					}
				}
				scored.sort((a, b) => {
					if (a.kwScore !== b.kwScore) return a.kwScore - b.kwScore;
					if (Math.abs(a.semBonus - b.semBonus) > 0.01) return b.semBonus - a.semBonus;
					return (a.item.oi ?? 0) - (b.item.oi ?? 0);
				});
				return scored.slice(0, 96).map(s => s.item);
			})()
			: null
	);

	// Semantic-only items (matched semantically but not by keyword)
	let semanticOnlyItems = $derived.by(() => {
		if (!query.trim() || !data || !semanticOnlyCps.length) return [];
		const cpSet = new Set(searchResults?.map(i => i.cp) ?? []);
		const items = [];
		for (const cp of semanticOnlyCps) {
			if (cpSet.has(cp)) continue;
			// Find the item in data
			for (const g of data.groups) {
				const found = g.items.find(i => i.cp === cp);
				if (found) { items.push(found); break; }
			}
			if (items.length >= 24) break;
		}
		return items;
	});

	let groupItems = $derived(
		!data || activeGroup < 0 ? null :
		data.groups[activeGroup]?.items ?? []
	);

	let resolvedGroupItems = $derived.by(() => {
		const t = skinTone, g = gender, ds = dualSelections, dirs = dirSelections;
		return groupItems?.map(item => ({ item, e: resolveEmoji(item, t, g, ds, dirs) })) ?? [];
	});
	let resolvedSearchItems = $derived.by(() => {
		const t = skinTone, g = gender, ds = dualSelections, dirs = dirSelections;
		return searchResults?.map(item => ({ item, e: resolveEmoji(item, t, g, ds, dirs) })) ?? [];
	});
	let resolvedSemanticOnlyItems = $derived.by(() => {
		const t = skinTone, g = gender, ds = dualSelections, dirs = dirSelections;
		return semanticOnlyItems.map(item => ({ item, e: resolveEmoji(item, t, g, ds, dirs) }));
	});
	// (Popular now renders as a flow section — see flowingSections.)

	// ── Inline flow model ──────────────────────────────────────────
	// EVERYTHING flows in one scroll: Recently used first, Popular
	// second, then every Unicode group — text section labels separate
	// them. Clicking a tab snaps to that section's offset, and scroll
	// position updates the highlighted tab to whichever section is
	// currently in view. No auto-advance — the user navigates by
	// scrolling like they would a single long page. (Recent/Popular
	// used to be standalone grid swaps; the user wants one continuum.)

	// Resolve every group's items once (cheap; same memoisation
	// pattern as `resolvedGroupItems`). Each section knows its
	// starting cell index inside the flat `flowingItems` array so
	// virtualization math + scroll-to-tab can index directly.
	let flowingSections = $derived.by(() => {
		if (!data) return [];
		const t = skinTone, g = gender, ds = dualSelections, dirs = dirSelections;
		const sections = [];
		let cellOffset = 0;
		// Recent stores RAW glyphs (already skin-toned); item may be null
		// for variants — cells fall back to pickRaw for those.
		if (recent.length) {
			const items = recent.map((e) => ({ item: findItem(e), e }));
			sections.push({ groupIdx: -1, name: 'Recently used', icon: '🕐', items, cellStart: cellOffset });
			cellOffset += items.length;
		}
		if (data.popular?.length) {
			const items = data.popular.map((raw) => {
				const item = findItem(raw);
				return { item, e: item ? resolveEmoji(item, t, g, ds, dirs) : raw };
			});
			sections.push({ groupIdx: -2, name: 'Popular', icon: '⭐', items, cellStart: cellOffset });
			cellOffset += items.length;
		}
		// Groups come from the cross-mount cache; only their cellStart depends
		// on what Recent/Popular contributed above, so that's the one field
		// recomputed here. The cached `items` arrays are shared, not copied.
		for (const gs of resolvedGroupSections(data, t, g, ds, dirs)) {
			sections.push({ ...gs, cellStart: cellOffset });
			cellOffset += gs.items.length;
		}
		return sections;
	});

	// Resolve every group's items for the current tone/gender/per-emoji
	// selections. This is ~1700 resolveEmoji calls — the picker's single
	// biggest cost — and the inputs only change when the user picks a new
	// skin tone or variant, so the result is cached at module scope and
	// survives the picker being closed and reopened.
	function resolvedGroupSections(d, t, g, ds, dirs) {
		const key = `${t}|${g}|${JSON.stringify(ds)}|${JSON.stringify(dirs)}`;
		if (_groupsCache.data === d && _groupsCache.key === key) return _groupsCache.value;
		const value = d.groups.map((grp, i) => ({
			groupIdx: i,
			name: grp.name,
			icon: grp.icon,
			items: grp.items.map((item) => ({ item, e: resolveEmoji(item, t, g, ds, dirs) }))
		}));
		_groupsCache = { key, data: d, value };
		return value;
	}

	// Grid geometry — must match the CSS layout below (the grid
	// declares `grid-template-columns: repeat(9, 36px)`). The
	// previous values were a guess — they produced section pxStart
	// offsets that didn't line up with the actual rendered rows, so
	// the scroll-derived active tab pointed to the wrong group.
	const CELL_PX = 36;
	const COLS = 9;
	const HEADER_PX = 28;        // height of `.section-label` row
	const BUFFER_ROWS = 4;
	let gridH = $state(280);
	let gridScrollTop = $state(0);

	function measureGrid() {
		if (!gridEl) return;
		gridH = gridEl.clientHeight;
	}

	// Hardcoded — the CSS pins the grid at 9 columns regardless of
	// container width. If we ever switch to auto-fill, derive from
	// `gridEl.clientWidth / CELL_PX` again.
	const cellsPerRow = COLS;

	// Build per-section row geometry: rows in section, the starting
	// pixel offset from the top of the flowing list, and the
	// section's total px height (header + grid). The tab strip
	// scrolls to `pxStart` to land at a section's top.
	const flowingGeometry = $derived.by(() => {
		const out = [];
		let py = 0;
		for (const s of flowingSections) {
			const rows = Math.ceil(s.items.length / cellsPerRow);
			const px = HEADER_PX + rows * CELL_PX;
			out.push({ groupIdx: s.groupIdx, pxStart: py, pxEnd: py + px });
			py += px;
		}
		return out;
	});

	// Scroll-derived active-group sync. Driven from the scroll event
	// directly instead of as a $effect — the effect approach was
	// racy on reverse scroll because the reactive re-run order
	// (activeGroup ↔ gridScrollTop) sometimes left
	// `_suppressActiveSync` true across a tick, so scrolling
	// backwards left the highlighted tab stuck on the section the
	// user was leaving.
	let _suppressActiveSync = false;
	function syncActiveFromScroll() {
		if (query.trim() || !flowingGeometry.length) return;
		if (_suppressActiveSync) return;
		const top = gridScrollTop + 4;
		// Walk forward, remember the LAST section whose pxStart is
		// ≤ top. Handles every direction + past-end + on-boundary
		// in one pass; no `top < pxEnd` strict check to fall through.
		let foundIdx = flowingGeometry[0].groupIdx;
		for (const g of flowingGeometry) {
			if (g.pxStart <= top) foundIdx = g.groupIdx;
			else break;
		}
		if (foundIdx !== activeGroup) {
			_suppressActiveSync = true;
			activeGroup = foundIdx;
			queueMicrotask(() => { _suppressActiveSync = false; });
		}
	}

	function onGridScroll(e) {
		gridScrollTop = e.target.scrollTop;
		syncActiveFromScroll();
	}

	// Keep the active category tab on-screen: when scrolling (or a click)
	// changes `activeGroup`, nudge the horizontal `.tabs` strip just enough
	// to bring the highlighted tab into view. Scrolls only the strip.
	$effect(() => {
		activeGroup;
		if (!tabsEl) return;
		tick().then(() => {
			if (!tabsEl) return;
			const el = tabsEl.querySelector('.tab.active');
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

	// Tab click handler. Standalone tabs (Popular / Recent) just
	// switch the activeGroup so the standalone branch renders.
	// Flowing tabs scroll the unified container to that section's
	// offset; we set `activeGroup` first (suppressing the scroll
	// reset effect) so the tab highlight is instant.
	function pickTab(g) {
		_suppressActiveSync = true;
		activeGroup = g;
		queueMicrotask(() => {
			const target = flowingGeometry.find((x) => x.groupIdx === g);
			// Recent/Popular tabs with no section yet (nothing used) → top
			if (gridEl) gridEl.scrollTo({ top: target ? target.pxStart : 0, behavior: 'instant' });
		});
	}

	$effect(() => {
		void activeGroup; void query;
		// Only reset scroll on tab changes that aren't part of the
		// flow (standalone ↔ flowing transitions, or search toggles).
		// Flowing-to-flowing tab clicks are handled by pickTab().
		if (query.trim()) {
			gridEl?.scrollTo(0, 0);
			gridScrollTop = 0;
		}
	});

	// Window measurement on mount + on resize.
	$effect(() => {
		if (!gridEl) return;
		measureGrid();
		const ro = new ResizeObserver(measureGrid);
		ro.observe(gridEl);
		return () => ro.disconnect();
	});

	// ── Semantic search effect ────────────────────────────────────────────────
	$effect(() => {
		const q = query.trim();
		if (!q) { semanticScores = null; semanticOnlyCps = []; semanticWorking = false; return; }
		clearTimeout(_semanticDebounce);
		_semanticDebounce = setTimeout(async () => {
			if (!isSemanticReady()) return;
			semanticWorking = true;
			try {
				const hits = await searchEmoji(q, 50); // all ML in worker — main thread just receives results
				semanticScores = new Map(hits.map(h => [h.cp, h.score]));
				const THRESHOLD = 0.4;
				semanticOnlyCps = hits[0]?.score >= THRESHOLD ? hits.filter(h => h.score >= THRESHOLD).map(h => h.cp) : [];
			} catch { /* semantic unavailable, keyword-only */ }
			semanticWorking = false;
		}, 300);
	});

	onMount(() => {
		// Start model loading in background
		onSemanticReady(() => { semanticReady = true; });
	});

</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && longPress) { longPress = null; e.stopPropagation(); } }} />

<div class="picker emoji-picker" bind:this={pickerEl}>
	<!-- Top bar: sticky controls (close ✕ + search 🔍) pinned at the left, then
	     either the search input (when expanded) or the scrolling category
	     buttons, with the style-settings gear pinned at the right. The category
	     buttons scroll horizontally UNDER the sticky controls. -->
	<div class="emoji-topbar">
		{#if onClose}
			<PickerStickyBtn square onclick={onClose} title="Close" label="Close picker">
				<span class="msi msi-20">close</span>
			</PickerStickyBtn>
		{/if}
		<PickerStickyBtn active={searchOpen} onclick={toggleSearch} title="Search emoji" label="Search emoji">
			<span class="msi msi-20">search</span>
		</PickerStickyBtn>
		{#if searchOpen}
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
		{:else}
			<!-- Only the category buttons scroll; the controls above stay fixed. -->
			<div class="tabs" role="tablist" bind:this={tabsEl}>
				<!-- Tab order mirrors the flow: Recent, Popular, then groups -->
				<button role="tab" class="tab tab-text" class:active={activeGroup === -1} title="Recently used"
					onclick={() => pickTab(-1)}>🕐</button>
				<button role="tab" class="tab tab-text" class:active={activeGroup === -2} title="Popular"
					onclick={() => pickTab(-2)}>#</button>
				{#if data}
					{#each data.groups as g, i}
						<button role="tab" class="tab" class:active={activeGroup === i} title={g.name}
							onclick={() => pickTab(i)}>{g.icon || '•'}</button>
					{/each}
				{/if}
			</div>
		{/if}
		<button
			class="settings-btn bar-gear"
			class:active={showSettings}
			title="Emoji style"
			onclick={() => showSettings = !showSettings}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

	<!-- Emoji grid -->
	<div bind:this={gridEl} class="grid-wrap" onscroll={onGridScroll}>
		{#if loading}
			<div class="state-msg">Loading…</div>
		{:else if searchResults !== null}
			{#if resolvedSearchItems.length === 0 && resolvedSemanticOnlyItems.length === 0}
				<div class="state-msg">No results for "{query}"</div>
			{:else}
				{#if resolvedSearchItems.length > 0}
					<div class="grid" class:noto={fontStyle === 'noto'}>
						{#each resolvedSearchItems as { item, e } (item.cp)}
							<button class="cell" class:has-variants={item.t?.length} title={item.n}
								onpointerdown={(ev) => startLp(ev, item)}
								onpointermove={moveLp}
								onpointerup={cancelLp}
								onpointerleave={cancelLp}
								oncontextmenu={(ev) => openVariants(ev, item)}
								onmouseenter={() => preview = { e: resolveEmoji(item, skinTone, gender), n: resolvedName(item), sc: resolvedShortcode(item) }}
								onmouseleave={() => preview = null}
								onclick={() => { if (lpFired) { lpFired = false; return; } pickItem(item); }}>
								{e}
							</button>
						{/each}
					</div>
				{/if}
				{#if resolvedSemanticOnlyItems.length > 0}
					<div class="semantic-section-label">{semanticWorking ? '✦ thinking…' : '✦ also'}</div>
					<div class="grid" class:noto={fontStyle === 'noto'}>
						{#each resolvedSemanticOnlyItems as { item, e } (item.cp)}
							<button class="cell" class:has-variants={item.t?.length} title={item.n}
								onpointerdown={(ev) => startLp(ev, item)}
								onpointermove={moveLp}
								onpointerup={cancelLp}
								onpointerleave={cancelLp}
								oncontextmenu={(ev) => openVariants(ev, item)}
								onmouseenter={() => preview = { e: resolveEmoji(item, skinTone, gender), n: resolvedName(item), sc: resolvedShortcode(item) }}
								onmouseleave={() => preview = null}
								onclick={() => { if (lpFired) { lpFired = false; return; } pickItem(item); }}>
								{e}
							</button>
						{/each}
					</div>
				{:else if semanticWorking}
					<div class="semantic-section-label">✦ thinking…</div>
				{/if}
			{/if}
		{:else if flowingSections.length}
			<!-- Flowing list. Every Unicode group is in one scroll
			     container; section headers separate them. Each section
			     mounts fully when its pixel band intersects the
			     viewport (+/- one viewport height of buffer), otherwise
			     it renders as a fixed-height placeholder so the overall
			     scroll geometry matches the un-virtualized layout. -->
			{#each flowingSections as section, sIdx (section.groupIdx)}
				{@const geo = flowingGeometry[sIdx]}
				{@const visTop = gridScrollTop - gridH}
				{@const visBot = gridScrollTop + gridH * 2}
				{@const isVisible = geo.pxEnd >= visTop && geo.pxStart <= visBot}
				{#if isVisible}
					<div class="section-block">
						<div class="section-label">{section.name}</div>
						<div class="grid" class:noto={fontStyle === 'noto'}>
							<!-- item may be null in the Recent section (raw glyphs
							     with baked skin tones) — those insert via pickRaw -->
							{#each section.items as { item, e } (item?.cp ?? e)}
								<button class="cell" class:has-variants={item?.t?.length} title={item?.n}
									onpointerdown={(ev) => { if (item) startLp(ev, item); }}
									onpointermove={moveLp}
									onpointerup={cancelLp}
									onpointerleave={cancelLp}
									oncontextmenu={(ev) => { if (item) openVariants(ev, item); }}
									onmouseenter={() => preview = item ? { e: resolveEmoji(item, skinTone, gender), n: resolvedName(item), sc: resolvedShortcode(item) } : { e, n: '', sc: '' }}
									onmouseleave={() => preview = null}
									onclick={() => { if (lpFired) { lpFired = false; return; } item ? pickItem(item) : pickRaw(e); }}>
									{e}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<!-- Placeholder reserves the same vertical band so
					     the scrollbar tracks the full list height. -->
					<div class="section-block section-placeholder" style:height="{geo.pxEnd - geo.pxStart}px"></div>
				{/if}
			{/each}
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
			bind:this={lpPopEl}
			style:left="{longPress.cellCenterX}px" style:top="{lpPlacement === 'below' ? longPress.cellBottom + 5 : longPress.cellTop - 5}px" style:transform="{lpPlacement === 'below' ? `translate(calc(-50% + ${lpNudgeX}px), 0)` : `translate(calc(-50% + ${lpNudgeX}px), -100%)`}">

			<!-- Left-tone row: each button shows left half colored, right half gray silhouette -->
			<div class="dual-row">
				{#each TONES as tone, ti}
					{@const cell = matrix[ti + 1][ti + 1]}
					<button class="dual-half-btn" class:active={dualLeft === tone}
						onclick={() => dualLeft = tone}
						onmouseenter={() => preview = { e: cell?.e ?? longPress.item.e, n: variantDisplayName(cell, longPress.item), sc: variantShortcode(cell, longPress.item) }}
						onmouseleave={() => preview = null}>
						<img class="dual-half-img" src={halfSrc(cell?.e ?? longPress.item.e, cell?.cp ?? longPress.item.cp, 'left')} alt="" draggable="false">
					</button>
				{/each}
			</div>

			<!-- Right-tone row: each button shows right half colored, left half gray silhouette -->
			<div class="dual-row">
				{#each TONES as tone, ti}
					{@const cell = matrix[ti + 1][ti + 1]}
					<button class="dual-half-btn" class:active={dualRight === tone}
						onclick={() => dualRight = tone}
						onmouseenter={() => preview = { e: cell?.e ?? longPress.item.e, n: variantDisplayName(cell, longPress.item), sc: variantShortcode(cell, longPress.item) }}
						onmouseleave={() => preview = null}>
						<img class="dual-half-img" src={halfSrc(cell?.e ?? longPress.item.e, cell?.cp ?? longPress.item.cp, 'right')} alt="" draggable="false">
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
						<img class="dual-half-img" src={halfSrc(longPress.item.e, longPress.item.cp, 'gray')} alt="" draggable="false">
					</span>
				{/if}
			</div>
		</div>

	{:else if vtype === 'directional'}
		<!-- Direction-split popover: ← tab shows left-facing, → tab shows right-facing -->
		{@const nonDir = longPress.item.t.filter(v => !v.cp.includes('27A1'))}
		{@const dirRight = longPress.item.t.filter(v => v.cp.includes('27A1'))}
		<div class="lp-pop lp-dir" class:noto={fontStyle === 'noto'}
			bind:this={lpPopEl}
			style:left="{longPress.cellCenterX}px" style:top="{lpPlacement === 'below' ? longPress.cellBottom + 5 : longPress.cellTop - 5}px" style:transform="{lpPlacement === 'below' ? `translate(calc(-50% + ${lpNudgeX}px), 0)` : `translate(calc(-50% + ${lpNudgeX}px), -100%)`}">
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
			bind:this={lpPopEl}
			style:left="{longPress.cellCenterX}px" style:top="{lpPlacement === 'below' ? longPress.cellBottom + 5 : longPress.cellTop - 5}px" style:transform="{lpPlacement === 'below' ? `translate(calc(-50% + ${lpNudgeX}px), 0)` : `translate(calc(-50% + ${lpNudgeX}px), -100%)`}">
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
			bind:this={lpPopEl}
			style:left="{longPress.cellCenterX}px"
			style:top="{lpPlacement === 'below' ? longPress.cellBottom + 5 : longPress.cellTop - 5}px"
			style:transform="{lpPlacement === 'below' ? `translate(calc(-50% + ${lpNudgeX}px), 0)` : `translate(calc(-50% + ${lpNudgeX}px), -100%)`}"
			style:grid-template-columns="repeat({variantCols(longPress.item)},36px)">
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
		/* When mounted standalone (legacy direct usage), the picker
		   still carries its own background + size. When mounted
		   INSIDE ExpressionPicker the parent's `:global(.emoji-picker)`
		   reset overrides width / height / radius / shadow so the
		   inner panel blends seamlessly into the ExpressionPicker
		   shell — no double border, no double rounded corners. */
		width: 340px;
		height: 380px;
		background: var(--md-sys-color-surface, var(--paper));
		color: var(--md-sys-color-on-surface, var(--ink));
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-size: 0.82rem;
	}

	/* ── Search ── */
	.search-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.6rem 0.4rem;
		border-bottom: 1px solid var(--surface-2);
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
	.search-input::placeholder { color: var(--muted-fg); }
	.clear-btn {
		background: none;
		border: none;
		color: var(--muted-fg);
		cursor: pointer;
		font-size: 0.7rem;
		padding: 0;
		line-height: 1;
		flex-shrink: 0;
	}
	.clear-btn:hover { color: var(--muted-fg); }
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
	.settings-btn:hover, .settings-btn.active { color: var(--muted-fg); background: var(--surface-2); }

	/* ── Settings panel ── */
	.settings-panel {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.75rem;
		border-bottom: 1px solid var(--surface-2);
		background: var(--surface-2);
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
		border: 1.5px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 8px;
		padding: 0.2rem 0.5rem;
		font-size: 0.72rem;
		color: var(--muted-fg);
		cursor: pointer;
		transition: border-color 0.1s, background 0.1s, color 0.1s;
		white-space: nowrap;
	}
	.style-opt:hover { background: var(--surface-2); border-color: #ccc; }
	.style-opt.active { border-color: var(--muted-fg); color: #222; background: var(--surface-2); }
	.style-swatch { font-size: 1rem; line-height: 1; }

	/* ── Top bar: fixed controls (close + search) + scrolling categories + gear ── */
	.emoji-topbar {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.55rem;
		border-bottom: 1px solid var(--surface-2);
		background: var(--paper);
		flex-shrink: 0;
	}
	.tabs {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		overflow-x: auto;
		/* These strips live inside the ExpressionPicker's horizontal snap
		   track. Contain the axis so dragging past the end of the strip
		   doesn't chain out and page the picker to another category. */
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar { display: none; }
	/* Round category buttons, a touch bigger. */
	.tab {
		background: none;
		border: none;
		font-size: 1.1rem;
		width: 2.4rem;
		height: 2.4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: 50%;
		flex-shrink: 0;
		transition: background 0.12s;
		padding: 0;
	}
	/* No opacity fade on unselected tabs — full-colour glyphs, with the
	   same M3 state-layer hover + secondary-container active treatment
	   as the ExpressionPicker/Kitchen strips, so every bar matches. */
	.tab:hover:not(.active) { background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 7%, transparent); }
	.tab.active {
		background: var(--md-sys-color-secondary-container, var(--surface-2));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
	}
	.tab-text { font-size: 0.85rem; font-weight: 700; letter-spacing: -0.02em; }

	/* Inline search input (shown when the 🔍 control is toggled) grows to fill
	   the bar between the fixed controls and the settings gear. */
	.search-input { flex: 1; min-width: 4rem; }
	.bar-gear { flex: 0 0 auto; }

	@media (max-width: 640px) {
		.tab { width: 2.6rem; height: 2.6rem; font-size: 1.2rem; }
		/* A bit taller top bar to match the roomier controls. */
		.emoji-topbar { padding: 0.55rem 0.6rem; }
		/* No hover on touch, so the "Hover an emoji to preview" bar is dead
		   weight — drop it on mobile to reclaim the vertical space. */
		.preview-bar { display: none; }
	}

	/* ── Grid ── */
	.grid-wrap {
		flex: 1;
		overflow-y: scroll;
		/* A box with overflow-y scroll/auto and overflow-x visible computes
		   overflow-x to `auto`, so sub-pixel track rounding was enough to make
		   this scroll sideways. Nothing here should ever pan horizontally. */
		overflow-x: hidden;
		/* Stops the scroll from chaining to the parent page once the
		   user reaches the top / bottom of the picker (i.e. scrolling
		   past the last emoji category no longer scrolls the chat /
		   profile page behind it). */
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: #ddd transparent;
		padding: 0.3rem 0.25rem;
		min-height: 0;
	}
	.grid {
		display: grid;
		/* Fill the full width — 9 flexible columns (was 9 FIXED 36px ones that
		   clustered in a centred block) with a little gap, so the emoji spread
		   evenly edge to edge. */
		/* minmax(0, 1fr), not plain 1fr: a bare `1fr` track still refuses to
		   shrink below its content's min-content width, so ONE cell with
		   unusually wide content stretches the whole grid past the panel and
		   the picker starts scrolling sideways. Flooring the track at 0 keeps
		   the 9 columns pinned to the panel width no matter what lands in a
		   cell. (The trigger was a dataset entry whose glyph was the literal
		   text "sewing" — fixed in emoji-data.json — but the layout should not
		   depend on every one of ~1700 cells being exactly one glyph wide.) */
		grid-template-columns: repeat(9, minmax(0, 1fr));
		justify-content: stretch;
		gap: 3px;
		padding: 0 2px;
	}
	.grid.noto .cell {
		font-family: 'Noto Color Emoji', sans-serif;
	}
	.cell {
		background: none;
		border: none;
		font-size: 1.55rem;
		width: 100%;
		aspect-ratio: 1 / 1;
		height: auto;
		/* The grid renders all ~1800 emoji at once. content-visibility lets the
		   browser skip style/layout/paint for the off-screen cells, which is
		   what was making opening/switching to this category cost ~600ms of
		   style-recalc + layout (per the Safari timeline). Cells are a fixed
		   36px, so contain-intrinsic-size matches exactly — no scroll jump. */
		content-visibility: auto;
		contain-intrinsic-size: auto 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: 6px;
		line-height: 1;
		transition: background 0.08s;
		padding: 0;
		position: relative;
		/* Belt to the grid's minmax braces: clip anything that doesn't fit a
		   cell instead of letting it push the track wider. */
		overflow: hidden;
		min-width: 0;
	}
	.cell:hover { background: var(--surface-2); }
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
		/* Variant-available dot. Reads as M3 secondary so it picks up
		   the user's theme accent — same family the long-press
		   popover's active tab uses, so the cue and the affordance
		   it announces share a visual language. */
		background: var(--md-sys-color-secondary, var(--muted-fg));
		opacity: 0.6;
	}

	.state-msg {
		color: var(--muted-fg);
		font-size: 0.78rem;
		text-align: center;
		padding: 2rem 1rem;
	}
	.semantic-section-label {
		font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em;
		color: #b8a898; text-transform: uppercase;
		padding: 0.5rem 0.75rem 0.2rem;
	}
	/* Section header for the flowing inline list — one row per
	   Unicode group (Smileys, People, …). Sticky-top would clip the
	   first section's icon as you scroll into the next; not worth
	   the extra layer-cost. */
	.section-block { display: block; }
	.section-label {
		font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em;
		color: var(--md-sys-color-on-surface-variant, #b8a898);
		text-transform: uppercase;
		height: 28px;
		padding: 0.5rem 0.75rem 0.2rem;
		box-sizing: border-box;
	}
	.section-placeholder { background: transparent; }

	/* ── Preview bar ── */
	.preview-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.65rem;
		border-top: 1px solid var(--surface-2);
		min-height: 2rem;
		flex-shrink: 0;
	}
	/* Must come AFTER the base .preview-bar rule above: the @media block earlier
	   in this file has the same specificity, so the later plain `display: flex`
	   was winning and the bar showed on phones regardless. A device that can't
	   hover can never fill this bar, so it goes on capability as well as width. */
	@media (max-width: 640px), (hover: none) {
		.preview-bar { display: none; }
	}

	.preview-glyph { font-size: 1.25rem; line-height: 1; flex-shrink: 0; }
	.preview-glyph.noto { font-family: 'Noto Color Emoji', sans-serif; }
	.preview-name  { font-size: 0.75rem; color: var(--muted-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
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
		/* The `top`/`left` inline styles (set by the position
		   effect) are already the popover's actual top-left corner —
		   no transform needed. The effect computes them from the
		   long-pressed cell's bounding rect: by default the popover's
		   bottom edge sits 5 px above the cell's top edge; if that
		   would push it off-screen / off the picker it flips so the
		   top edge sits 5 px below the cell's bottom. Horizontal is
		   the cell's center, clamped to the picker's left/right
		   bounds so the popover always sits over the picker chrome. */
		/* M3 design tokens — surface-container-high reads as "raised
		   above the picker" against the surrounding surface, and
		   outline-variant gives a subtle stroke that follows the
		   user's chosen theme. */
		background: var(--md-sys-color-surface-container-high, var(--paper));
		color: var(--md-sys-color-on-surface, var(--ink));
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
		padding: 4px;
		z-index: 3000;
		display: grid;
		gap: 0;
		max-height: 300px;
		overflow-y: auto;
		/* A box with overflow-y scroll/auto and overflow-x visible computes
		   overflow-x to `auto`, so sub-pixel track rounding was enough to make
		   this scroll sideways. Nothing here should ever pan horizontally. */
		overflow-x: hidden;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: var(--md-sys-color-outline-variant, var(--border)) transparent;
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
		border-radius: 8px;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 2px;
		transition: background 0.08s, border-color 0.08s;
		flex-shrink: 0;
	}
	.dual-half-btn:hover  { background: var(--surface-2); }
	.dual-half-btn.active { border-color: var(--muted-fg); background: var(--surface-2); }

	.dual-half-img {
		width: 44px;
		height: 44px;
		display: block;
		pointer-events: none;
	}

	/* Footer row: default emoji + composed result */
	.dual-footer {
		display: flex;
		gap: 4px;
		padding-top: 5px;
		border-top: 1px solid var(--surface-2);
		margin-top: 1px;
	}
	.dual-foot-btn {
		flex: 1;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1.5px solid var(--md-sys-color-outline-variant, var(--border));
		background: none;
		cursor: pointer;
		padding: 0;
		transition: background 0.08s;
	}
	.dual-foot-btn:hover { background: var(--surface-2); }
	.dual-foot-btn.dual-result { border-color: var(--muted-fg); }
	.dual-silhouette {
		flex: 1;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1.5px dashed var(--md-sys-color-outline-variant, var(--border));
	}
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
		background: var(--surface-2);
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
		border-bottom: 1px solid var(--surface-2);
		margin-bottom: 2px;
	}

	.lp-dir-tab {
		flex: 1;
		background: none;
		border: 1.5px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 6px;
		font-size: 0.9rem;
		height: 26px;
		cursor: pointer;
		color: var(--muted-fg);
		transition: background 0.1s, color 0.1s, border-color 0.1s;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.lp-dir-tab:hover { background: var(--surface-2); color: var(--md-sys-color-on-surface, var(--ink)); }
	.lp-dir-tab.active {
		/* "Active" reads as M3 secondary-container — the same chip
		   treatment used by tabs across the rest of the picker so
		   the long-press affordance feels native to the system. */
		background: var(--md-sys-color-secondary-container, var(--surface-2));
		border-color: var(--md-sys-color-secondary, var(--muted-fg));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		font-weight: 700;
	}
</style>
