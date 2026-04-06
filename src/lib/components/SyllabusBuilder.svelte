<script>
	import { onMount, onDestroy } from 'svelte';
	import { marked } from 'marked';
	import katex from 'katex';

	let { classId, previewOpen = $bindable(false) } = $props();

	// ── Syllabi list ────────────────────────────────────────────────────────────
	let syllabi = $state([]);
	let activeSyllabusId = $state(null);
	let renamingId = $state(null);
	let renameValue = $state('');
	let loadingList = $state(true);

	// ── Active syllabus state ───────────────────────────────────────────────────
	let blocks = $state([]);
	let font = $state('Georgia, serif');
	let customFonts = $state([]); // [{ name, url, weight, style }]
	// weight: CSS font-weight descriptor string e.g. '100 900' or '700'
	// style: CSS font-style descriptor string e.g. 'normal' or 'italic'
	let fontWeightUploading = $state({}); // { [fontName]: boolean }
	let fontWeightAdding = $state({}); // { [fontName]: { weight: string, style: string } | null }
	let margins = $state({ top: 64, right: 64, bottom: 64, left: 64 });
	let fontSizes   = $state({ title: 24, section: 14, text: 12, weekHeader: 12, weekTopic: 11 }); // all in pt
	let spacing     = $state({ title: 0, section: 6, text: 6, week: 8 }); // space below each block type, in pt
	let lineHeights = $state({ title: 1.2, section: 1.3, text: 1.75, weekHeader: 1.3, weekTopic: 1.65 });
	let syllabusName = $state('Untitled');
	let sizesOpen = $state(false);
	let sidebarOpen = $state(true);
	let fontUploading = $state(false);
	// Track which (name, weight, style) combos have been registered so we don't double-add
	const loadedFontKeys = new Set();

	// Derived font list merging built-ins with any uploaded custom fonts (deduplicated by name)
	const allFonts = $derived([
		...FONTS,
		...[...new Set(customFonts.map(cf => cf.name))].map(name => ({ label: name + ' ✦', value: name }))
	]);
	// Unique font family names for the chips UI
	const customFontNames = $derived([...new Set(customFonts.map(cf => cf.name))]);

	// Register custom fonts with the browser FontFace API whenever the list changes.
	// Each entry may specify weight and style; default covers all weights so bold/italic
	// titles don't fall back to a synthesized or system font.
	$effect(() => {
		for (const cf of customFonts) {
			const w = cf.weight ?? '100 900';
			const s = cf.style ?? 'normal';
			const key = `${cf.name}|${w}|${s}|${cf.url}`;
			if (loadedFontKeys.has(key)) continue;
			loadedFontKeys.add(key);
			const src = `/api/syllabus/font?url=${encodeURIComponent(cf.url)}`;
			new FontFace(cf.name, `url(${src})`, { weight: w, style: s }).load()
				.then((f) => {
					document.fonts.add(f);
					// Re-measure after font loads — sizes may change from the fallback
					recomputePages();
				})
				.catch((err) => {
					console.error(`[SyllabusBuilder] Failed to load font "${cf.name}" (${w} ${s}):`, err, cf.url);
				});
		}
	});
	// Inject a <style> into <head> that sets font-family for all syllabus elements.
	// Bypasses Svelte's style: directive timing issues with {#if}-gated elements entirely.
	$effect(() => {
		const f = font;
		// Wrap multi-word font names in quotes; leave font stacks (contain comma) as-is
		const cssFamily = f ? (f.includes(',') ? f : `"${f}"`) : 'inherit';
		let styleEl = document.getElementById('--syl-font-style');
		if (!styleEl) {
			styleEl = document.createElement('style');
			styleEl.id = '--syl-font-style';
			document.head.appendChild(styleEl);
		}
		styleEl.textContent = `.syl-blocks, .syl-measure, .float-page, .print-only { font-family: ${cssFamily} !important; }`;
		// Re-measure after font changes — heights differ between fonts
		requestAnimationFrame(recomputePages);
		return () => document.getElementById('--syl-font-style')?.remove();
	});

let loadingDoc = $state(false);
	let saving = $state(false);
	let lastSaved = $state(null);

	// ── Preview panel ───────────────────────────────────────────────────────────
	let previewBodyWidth = $state(0); // measured via bind:clientWidth

	// US Letter portrait at 300 dpi
	const PAGE_W = 2550; // 8.5in × 300dpi
	const PAGE_H = 3300; // 11in  × 300dpi
	const PREVIEW_PAD = 20;
	// Max zoom = physical page size on a 96dpi screen (8.5in × 96 = 816px)
	const SCREEN_MAX_W = Math.round(8.5 * 96); // 816

	const pageZoom = $derived(
		previewBodyWidth > 0
			? Math.min(SCREEN_MAX_W, previewBodyWidth - PREVIEW_PAD * 2) / PAGE_W
			: SCREEN_MAX_W / PAGE_W
	);

	// 1 point = 1/72 inch; at 300 dpi: 1pt = 300/72 px on the canvas
	function ptToPx(pt) { return Math.round(pt * 300 / 72); }
	function edPx(pt) { return Math.round(pt * 80 / 72); } // screen-resolution pt→px for editor display

	function autosize(node) {
		function resize() { node.style.height = 'auto'; node.style.height = node.scrollHeight + 'px'; }
		node.addEventListener('input', resize);
		resize();
		return { destroy() { node.removeEventListener('input', resize); } };
	}

	// ── Multi-page layout — independent page containers ────────────────────────
	// Each page is a fully independent div containing only its own blocks.
	// A hidden measurement div renders all content at the exact content-area width;
	// we greedily pack blocks into pages so each block lands entirely on one page.
	// Because pages are independent containers, text wraps correctly for that page's
	// width with no shared-div clipping artifacts.

	let measureEl = $state(null);
	// pageBlocks[N] = array of {bidx, pStart?, pEnd?} slots for page N
	let pageBlocks = $state([[]]);

	// Non-hidden blocks in order — index here == data-bidx in the measurement div
	const visibleBlocks = $derived(blocks.filter(b => !b.hidden));

	// Sequential week number for each non-hidden week block (hidden weeks get undefined)
	const weekNums = $derived((() => {
		const map = {};
		let n = 0;
		for (const b of blocks) {
			if (b.type === 'week' && !b.hidden) map[b.id] = ++n;
		}
		return map;
	})());

	// Printable height per page (between top and bottom margins), in 300dpi px
	const contentAreaH = $derived(PAGE_H - margins.top - margins.bottom);
	const numPages = $derived(Math.max(1, pageBlocks.length));

	/**
	 * Line-level split for a text block element.
	 * Uses binary search over character offsets + Range.getClientRects() to find
	 * the last character whose visual line fits before pageEndY (viewport y).
	 * Returns { beforeHtml, afterHtml } as innerHTML strings, or null if unsplittable.
	 *
	 * Works correctly even with measureEl at left:-99999px because only rect.bottom
	 * (vertical) is used — rect.left/right are irrelevant for vertical page breaks.
	 */
	function splitBlockAtY(blockEl, pageEndY) {
		const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, null);
		const textNodes = [];
		let tn;
		while ((tn = walker.nextNode())) textNodes.push(tn);
		if (!textNodes.length) return null;

		const totalLen = textNodes.reduce((s, n) => s + n.length, 0);
		if (totalLen === 0) return null;

		// Map a global char offset → { text node, local offset }
		function nodeAt(g) {
			let rem = g;
			for (const n of textNodes) {
				if (rem <= n.length) return { n, off: rem };
				rem -= n.length;
			}
			const last = textNodes[textNodes.length - 1];
			return { n: last, off: last.length };
		}

		// Binary search: last globalOff where Range[0..globalOff].getClientRects() maxBottom <= pageEndY
		let lo = 0, hi = totalLen, best = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const { n: endN, off: endOff } = nodeAt(mid);
			const r = document.createRange();
			r.setStart(textNodes[0], 0);
			r.setEnd(endN, endOff);
			let maxBot = 0;
			for (const rect of r.getClientRects()) {
				if (rect.bottom > maxBot) maxBot = rect.bottom;
			}
			if (maxBot <= pageEndY) { best = mid; lo = mid + 1; }
			else hi = mid - 1;
		}

		if (best < 0 || best >= totalLen) return null;

		// Snap backwards to a word boundary (last space ≤ best)
		let { n: splitN, off: splitOff } = nodeAt(best);
		const txt = splitN.textContent;
		let snap = splitOff;
		while (snap > 0 && txt[snap - 1] !== ' ') snap--;
		if (snap > 0) splitOff = snap; // use word boundary if found

		// Clone content before/after the split into HTML strings
		const div = document.createElement('div');

		const bR = document.createRange();
		bR.setStart(blockEl, 0);
		bR.setEnd(splitN, splitOff);
		div.appendChild(bR.cloneContents());
		const beforeHtml = div.innerHTML.trim();

		div.innerHTML = '';
		const aR = document.createRange();
		aR.setStart(splitN, splitOff);
		if (blockEl.lastChild) aR.setEndAfter(blockEl.lastChild);
		div.appendChild(aR.cloneContents());
		const afterHtml = div.innerHTML.trim();

		if (!beforeHtml || !afterHtml) return null;
		return { beforeHtml, afterHtml };
	}

	/**
	 * Greedily distribute blocks across pages.
	 * For text blocks that overflow a page boundary:
	 *   1. Try paragraph-level split first (fast, using offsetTop)
	 *   2. Fall back to line-level split via Range API (handles single paragraphs)
	 *   3. Last resort: move the whole block to the next page
	 *
	 * Slot shape: { bidx }  |  { bidx, pStart, pEnd }  |  { bidx, html }
	 *   bidx      — index into visibleBlocks
	 *   pStart/pEnd — paragraph slice for multi-paragraph splits
	 *   html      — raw innerHTML for line-level splits (wrapped in syl-text on render)
	 */
	function packBlocks(el, cAreaH) {
		const blockEls = [...el.querySelectorAll('[data-bidx]')];
		if (!blockEls.length) return [[]];

		const pages = [[]];
		let pageStartY = 0;

		for (const blockEl of blockEls) {
			const bidx     = parseInt(blockEl.dataset.bidx);
			const blockTop = blockEl.offsetTop;
			const blockBot = blockTop + blockEl.offsetHeight;
			const relBot   = blockBot - pageStartY;
			const curPage  = pages[pages.length - 1];

			if (curPage.length > 0 && relBot > cAreaH) {
				let handled = false;

				// ── 1. Paragraph-level split ──────────────────────────────────────
				const paraEls = [...el.querySelectorAll(`[data-para^="${bidx}-"]`)];
				if (paraEls.length > 1) {
					let splitAt = -1;
					for (let pi = 0; pi < paraEls.length; pi++) {
						const pBot = paraEls[pi].offsetTop + paraEls[pi].offsetHeight - pageStartY;
						if (pBot <= cAreaH) splitAt = pi;
						else break;
					}
					if (splitAt >= 0) {
						curPage.push({ bidx, pStart: 0, pEnd: splitAt + 1 });
						pages.push([{ bidx, pStart: splitAt + 1, pEnd: paraEls.length }]);
						pageStartY = paraEls[splitAt + 1].offsetTop;
						handled = true;
					}
				}

				// ── 2. Line-level split (text blocks only) ────────────────────────
				if (!handled && visibleBlocks[bidx]?.type === 'text') {
					const pageEndY = pageStartY + cAreaH;
					const split = splitBlockAtY(blockEl, pageEndY);
					if (split) {
						if (split.beforeHtml) curPage.push({ bidx, html: split.beforeHtml });
						pages.push([{ bidx, html: split.afterHtml }]);
						pageStartY = blockTop;
						handled = true;
					}
				}

				// ── 3. Fallback: move whole block to next page ────────────────────
				if (!handled) {
					pages.push([{ bidx }]);
					pageStartY = blockTop;
				}
			} else {
				curPage.push({ bidx });
			}
		}
		return pages;
	}

	function recomputePages() {
		if (!measureEl) return;
		// Ensure the font is applied to the measure div before reading heights
		if (font) measureEl.style.fontFamily = font;
		pageBlocks = packBlocks(measureEl, contentAreaH);
	}

	$effect(() => {
		if (!measureEl) return;
		const obs = new ResizeObserver(recomputePages);
		obs.observe(measureEl);
		// Use rAF so the browser applies the custom font to the freshly-mounted element before we measure
		requestAnimationFrame(recomputePages);
		return () => obs.disconnect();
	});

	// Re-run when margins or font change (measureEl doesn't resize on font changes)
	let recomputeRafId = 0;
	$effect(() => {
		const _cAreaH = contentAreaH;
		const _font = font;
		cancelAnimationFrame(recomputeRafId);
		recomputeRafId = requestAnimationFrame(recomputePages);
	});


	// ── Float drag ──────────────────────────────────────────────────────────────
	let floatX = $state(0);
	let floatY = $state(0);
	let floatSeeded = false;
	let panelDragging = false;
	let panelDragOffX = 0;
	let panelDragOffY = 0;

	function openPreview() {
		if (!floatSeeded) {
			floatX = Math.max(20, window.innerWidth - 540);
			floatY = 80;
			floatSeeded = true;
		}
		previewOpen = true;
	}

	function onTitlebarMousedown(e) {
		if (e.button !== 0) return;
		panelDragging = true;
		panelDragOffX = e.clientX - floatX;
		panelDragOffY = e.clientY - floatY;
		e.preventDefault();
	}

	function onWindowMousemove(e) {
		if (!panelDragging) return;
		floatX = Math.max(0, e.clientX - panelDragOffX);
		floatY = Math.max(0, e.clientY - panelDragOffY);
	}

	function onWindowMouseup() { panelDragging = false; }

	// ── Block drag state ────────────────────────────────────────────────────────
	let dragSrcIdx = $state(null);
	let dragOverIdx = $state(null);

	const FONTS = [
		{ label: 'Georgia',         value: 'Georgia, serif' },
		{ label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
		{ label: 'Avara',           value: '"Avara", serif' },
		{ label: 'Space Grotesk',   value: '"Space Grotesk", sans-serif' },
		{ label: 'Palatino',        value: '"Palatino Linotype", Palatino, serif' },
		{ label: 'Courier',         value: '"Courier New", monospace' }
	];

	const BLOCK_LABELS = { title: 'Title', section: 'Section', text: 'Text', week: 'Week' };

	marked.use({ breaks: true });

	// ── Lifecycle ───────────────────────────────────────────────────────────────
	onMount(async () => { await loadList(); });
	onDestroy(() => clearTimeout(saveTimer));

	// ── Syllabi CRUD ─────────────────────────────────────────────────────────────
	async function loadList() {
		loadingList = true;
		const res = await fetch(`/api/syllabus?classId=${enc(classId)}`);
		if (res.ok) {
			const data = await res.json();
			syllabi = data.syllabi ?? [];
			if (syllabi.length && !activeSyllabusId) await openSyllabus(syllabi[0].id);
		}
		loadingList = false;
	}

	async function openSyllabus(id) {
		if (activeSyllabusId === id) return;
		clearTimeout(saveTimer);
		activeSyllabusId = id;
		loadingDoc = true;
		const res = await fetch(`/api/syllabus?classId=${enc(classId)}&syllabusId=${enc(id)}`);
		if (res.ok) {
			const data = await res.json();
			blocks = data.blocks.length ? data.blocks : defaultBlocks();
			font = data.font;
			customFonts = Array.isArray(data.customFonts)
				? data.customFonts.map(cf => ({ weight: '100 900', style: 'normal', ...cf }))
				: [];
			const m = data.margins;
			margins = (m && typeof m === 'object')
				? { top: m.top ?? 64, right: m.right ?? 64, bottom: m.bottom ?? 64, left: m.left ?? 64 }
				: { top: 64, right: 64, bottom: 64, left: 64 };
			const fs = data.fontSizes;
			fontSizes = (fs && typeof fs === 'object')
				? { title: fs.title ?? 24, section: fs.section ?? 14, text: fs.text ?? 12, weekHeader: fs.weekHeader ?? 12, weekTopic: fs.weekTopic ?? 11 }
				: { title: 24, section: 14, text: 12, weekHeader: 12, weekTopic: 11 };
			const sp = data.spacing;
			spacing = (sp && typeof sp === 'object')
				? { title: sp.title ?? 0, section: sp.section ?? 6, text: sp.text ?? 6, week: sp.week ?? 8 }
				: { title: 0, section: 6, text: 6, week: 8 };
			const lh = data.lineHeights;
			lineHeights = (lh && typeof lh === 'object')
				? { title: lh.title ?? 1.2, section: lh.section ?? 1.3, text: lh.text ?? 1.75, weekHeader: lh.weekHeader ?? 1.3, weekTopic: lh.weekTopic ?? 1.65 }
				: { title: 1.2, section: 1.3, text: 1.75, weekHeader: 1.3, weekTopic: 1.65 };
			syllabusName = data.name;
			lastSaved = null;
		}
		loadingDoc = false;
	}

	async function newSyllabus() {
		const id = uid();
		const name = `Syllabus ${syllabi.length + 1}`;
		syllabi = [{ id, name, updatedAt: Date.now() }, ...syllabi];
		activeSyllabusId = id;
		blocks = defaultBlocks();
		font = 'Georgia, serif';
		customFonts = [];
		margins = { top: 64, right: 64, bottom: 64, left: 64 };
		fontSizes   = { title: 24, section: 14, text: 12, weekHeader: 12, weekTopic: 11 };
		spacing     = { title: 0, section: 6, text: 6, week: 8 };
		lineHeights = { title: 1.2, section: 1.3, text: 1.75, weekHeader: 1.3, weekTopic: 1.65 };
		syllabusName = name;
		lastSaved = null;
		await saveNow();
	}

	async function deleteSyllabus(id) {
		if (!confirm('Delete this syllabus? This cannot be undone.')) return;
		await fetch(`/api/syllabus?classId=${enc(classId)}&syllabusId=${enc(id)}`, { method: 'DELETE' });
		syllabi = syllabi.filter((s) => s.id !== id);
		if (activeSyllabusId === id) {
			activeSyllabusId = null; blocks = []; syllabusName = '';
			if (syllabi.length) await openSyllabus(syllabi[0].id);
		}
	}

	function startRename(id, currentName) { renamingId = id; renameValue = currentName; }

	async function commitRename(id) {
		const trimmed = renameValue.trim() || 'Untitled';
		syllabi = syllabi.map((s) => s.id === id ? { ...s, name: trimmed } : s);
		if (activeSyllabusId === id) syllabusName = trimmed;
		renamingId = null;
		scheduleSave();
	}

	// ── Save ────────────────────────────────────────────────────────────────────
	let saveTimer;
	function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1000); }

	async function saveNow() {
		if (!activeSyllabusId) return;
		saving = true;
		try {
			await fetch('/api/syllabus', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ classId, syllabusId: activeSyllabusId, name: syllabusName, blocks, font, customFonts, margins, fontSizes, spacing, lineHeights })
			});
			lastSaved = Date.now();
			syllabi = syllabi.map((s) => s.id === activeSyllabusId ? { ...s, name: syllabusName, updatedAt: lastSaved } : s);
		} finally {
			saving = false;
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────────────
	function uid() { return crypto.randomUUID(); }
	function enc(v) { return encodeURIComponent(v); }

	function defaultBlocks() {
		return [
			{ id: uid(), type: 'title',   content: 'Course Syllabus',        position: 0, hidden: false },
			{ id: uid(), type: 'section', content: 'Course Information',      position: 1, hidden: false },
			{ id: uid(), type: 'text',    content: '**Instructor:** \n**Email:** \n**Time:** \n**Location:** ', position: 2, hidden: false },
			{ id: uid(), type: 'section', content: 'Course Description',      position: 3, hidden: false },
			{ id: uid(), type: 'text',    content: '',                        position: 4, hidden: false },
			{ id: uid(), type: 'section', content: 'Weekly Schedule',         position: 5, hidden: false },
			{ id: uid(), type: 'week',    content: JSON.stringify({ weekNum: 1, title: 'Introduction', topics: [{ id: uid(), text: '', hidden: false }] }), position: 6, hidden: false }
		];
	}

	// ── Block mutations ──────────────────────────────────────────────────────────
	function renumber() { blocks = blocks.map((b, i) => ({ ...b, position: i })); }

	function addBlock(type, afterIdx) {
		const defaults = {
			title:   'Course Title',
			section: 'Section Heading',
			text:    '',
			week:    JSON.stringify({ weekNum: nextWeekNum(), title: 'New Week', topics: [{ id: uid(), text: '', hidden: false }] })
		};
		const nb = { id: uid(), type, content: defaults[type], position: 0, hidden: false };
		const ins = afterIdx != null ? afterIdx + 1 : blocks.length;
		blocks = [...blocks.slice(0, ins), nb, ...blocks.slice(ins)];
		renumber(); scheduleSave();
	}

	function deleteBlock(id) { blocks = blocks.filter((b) => b.id !== id); renumber(); scheduleSave(); }
	function updateBlock(id, content) { blocks = blocks.map((b) => b.id === id ? { ...b, content } : b); scheduleSave(); }
	function toggleBlockHidden(id) { blocks = blocks.map((b) => b.id === id ? { ...b, hidden: !b.hidden } : b); scheduleSave(); }

	function nextWeekNum() {
		let max = 0;
		for (const b of blocks.filter((b) => b.type === 'week')) {
			try { const d = JSON.parse(b.content); if ((d.weekNum ?? 0) > max) max = d.weekNum; } catch { /**/ }
		}
		return max + 1;
	}

	// ── Week helpers ─────────────────────────────────────────────────────────────
	function parseWeek(content) {
		try { return JSON.parse(content); } catch { return { weekNum: 1, title: '', topics: [] }; }
	}
	function setWeek(blockId, data) {
		blocks = blocks.map((b) => b.id === blockId ? { ...b, content: JSON.stringify(data) } : b);
		scheduleSave();
	}
	function updateWeekField(blockId, field, value) { const d = parseWeek(blocks.find(b=>b.id===blockId)?.content); setWeek(blockId, { ...d, [field]: value }); }
	function addTopic(blockId) { const d = parseWeek(blocks.find(b=>b.id===blockId)?.content); setWeek(blockId, { ...d, topics: [...(d.topics??[]), { id: uid(), text: '', hidden: false }] }); }
	function updateTopic(blockId, tid, text) { const d = parseWeek(blocks.find(b=>b.id===blockId)?.content); setWeek(blockId, { ...d, topics: d.topics.map(t => t.id===tid ? {...t, text} : t) }); }
	function toggleTopic(blockId, tid) { const d = parseWeek(blocks.find(b=>b.id===blockId)?.content); setWeek(blockId, { ...d, topics: d.topics.map(t => t.id===tid ? {...t, hidden:!t.hidden} : t) }); }
	function deleteTopic(blockId, tid) { const d = parseWeek(blocks.find(b=>b.id===blockId)?.content); setWeek(blockId, { ...d, topics: d.topics.filter(t => t.id!==tid) }); }
	function moveTopic(blockId, ti, dir) {
		const d = parseWeek(blocks.find(b=>b.id===blockId)?.content);
		const t = [...d.topics]; const ni = ti + dir;
		if (ni < 0 || ni >= t.length) return;
		[t[ti], t[ni]] = [t[ni], t[ti]];
		setWeek(blockId, { ...d, topics: t });
	}

	// ── Block drag-and-drop ──────────────────────────────────────────────────────
	function onDragStart(e, idx) { dragSrcIdx = idx; e.dataTransfer.effectAllowed = 'move'; }
	function onDragOver(e, idx) { e.preventDefault(); dragOverIdx = idx; }
	function onDrop(e, idx) {
		e.preventDefault();
		if (dragSrcIdx === null || dragSrcIdx === idx) { dragSrcIdx = dragOverIdx = null; return; }
		const arr = [...blocks]; const [item] = arr.splice(dragSrcIdx, 1); arr.splice(idx, 0, item);
		blocks = arr; renumber(); dragSrcIdx = dragOverIdx = null; scheduleSave();
	}
	function onDragEnd() { dragSrcIdx = dragOverIdx = null; }

	// ── Render ───────────────────────────────────────────────────────────────────
	function renderText(raw) {
		if (!raw) return '';
		const mathPattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g;
		let result = '', last = 0, m;
		while ((m = mathPattern.exec(raw)) !== null) {
			if (m.index > last) result += marked.parse(raw.slice(last, m.index));
			const isDisplay = m[0].startsWith('$$');
			const math = isDisplay ? m[0].slice(2, -2) : m[0].slice(1, -1);
			try { result += katex.renderToString(math.trim(), { displayMode: isDisplay, throwOnError: false }); }
			catch { result += `<code>${math}</code>`; }
			last = m.index + m[0].length;
		}
		if (last < raw.length) result += marked.parse(raw.slice(last));
		return result;
	}

	/** Render one block as HTML. Pass bidx to add data-bidx (for measurement only). */
	function renderBlock(block, bidx = null) {
		const sz = (pt) => `font-size:${ptToPx(pt)}px`;
		const mb = (pt) => `margin-bottom:${ptToPx(pt)}px`;
		const lh = (key) => `line-height:${lineHeights[key]}`;
		const fs = fontSizes;
		const sp = spacing;
		const bAttr = bidx !== null ? ` data-bidx="${bidx}"` : '';
		if (block.type === 'title') {
			return `<h1 class="syl-title"${bAttr} style="${sz(fs.title)};${mb(sp.title)};${lh('title')}">${renderText(block.content)}</h1>`;
		} else if (block.type === 'section') {
			const borderStyle = (block.border ?? true) ? '' : 'border-bottom:none;padding-bottom:0;';
			return `<h2 class="syl-section"${bAttr} style="${sz(fs.section)};${mb(sp.section)};${lh('section')};${borderStyle}">${renderText(block.content)}</h2>`;
		} else if (block.type === 'text') {
			return `<div class="syl-text"${bAttr} style="${sz(fs.text)};${mb(sp.text)};${lh('text')}">${renderText(block.content)}</div>`;
		} else if (block.type === 'week') {
			const d = parseWeek(block.content);
			const vis = (d.topics ?? []).filter(t => !t.hidden);
			return `<div class="syl-week"${bAttr} style="${mb(sp.week)}">
				<div class="syl-week-header" style="${sz(fs.weekHeader)};${lh('weekHeader')}">Week ${weekNums[block.id] ?? ''}: ${d.title ? renderText(d.title) : ''}</div>
				${vis.length ? `<ul class="syl-topics">${vis.map(t => `<li style="${sz(fs.weekTopic)};${lh('weekTopic')}">${renderText(t.text)}</li>`).join('')}</ul>` : ''}
			</div>`;
		}
		return '';
	}

	/** Split rendered HTML into individual <p>...</p> strings. */
	function splitParagraphs(content) {
		const html = renderText(content);
		const paras = [];
		const re = /<p>([\s\S]*?)<\/p>/g;
		let m;
		while ((m = re.exec(html)) !== null) paras.push(m[0]);
		return paras.length > 0 ? paras : [html];
	}

	/** Render only a slice of paragraphs from a text block (for split blocks). */
	function renderTextSlice(block, pStart, pEnd) {
		const sz = (pt) => `font-size:${ptToPx(pt)}px`;
		const mb = (pt) => `margin-bottom:${ptToPx(pt)}px`;
		const paras = splitParagraphs(block.content);
		return `<div class="syl-text" style="${sz(fontSizes.text)};${mb(spacing.text)};line-height:${lineHeights.text}">${paras.slice(pStart, pEnd).join('')}</div>`;
	}

	/**
	 * All visible blocks with data-bidx — used by the measurement div only.
	 * Text blocks also get data-para="{bidx}-{pi}" on each <p> for line splitting.
	 */
	function renderMeasure() {
		return visibleBlocks.map((b, i) => {
			if (b.type === 'text') {
				const sz = (pt) => `font-size:${ptToPx(pt)}px`;
				const mb = (pt) => `margin-bottom:${ptToPx(pt)}px`;
				let pi = 0;
				const inner = renderText(b.content).replace(/<p>/g, () => `<p data-para="${i}-${pi++}">`);
				return `<div class="syl-text" data-bidx="${i}" style="${sz(fontSizes.text)};${mb(spacing.text)};line-height:${lineHeights.text}">${inner}</div>`;
			}
			return renderBlock(b, i);
		}).join('');
	}

	/** Render the slots assigned to one page. Supports three slot forms:
	 *  { bidx }             — full block
	 *  { bidx, pStart, pEnd } — paragraph-range slice of a text block
	 *  { bidx, html }       — raw innerHTML from a line-level split
	 */
	function renderPage(slots) {
		return (slots ?? []).map(slot => {
			const b = visibleBlocks[slot.bidx];
			if (!b) return '';
			if (slot.html !== undefined) {
				// Line-level split: render the stored HTML inside a syl-text wrapper
				const sz = (pt) => `font-size:${ptToPx(pt)}px`;
				const mb = (pt) => `margin-bottom:${ptToPx(pt)}px`;
				return `<div class="syl-text" style="${sz(fontSizes.text)};${mb(spacing.text)};line-height:${lineHeights.text}">${slot.html}</div>`;
			}
			if (slot.pStart !== undefined && b.type === 'text') {
				return renderTextSlice(b, slot.pStart, slot.pEnd);
			}
			return renderBlock(b);
		}).join('');
	}

	/** Full content for print (all pages in sequence, no page containers). */
	function renderPrint() {
		return visibleBlocks.map(b => renderBlock(b)).join('');
	}

	function formatSaved(ts) {
		if (!ts) return '';
		const s = Math.round((Date.now() - ts) / 1000);
		if (s < 5) return 'just saved';
		if (s < 60) return `saved ${s}s ago`;
		return `saved ${Math.round(s/60)}m ago`;
	}

	function printSyllabus() { window.print(); }
</script>

<svelte:window onmousemove={onWindowMousemove} onmouseup={onWindowMouseup} />

<svelte:head>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous" />
</svelte:head>

<!-- When preview is open, left-align the editor so the float panel has room on the right -->
<div class="syl-root" class:preview-open={previewOpen}>

	<aside class="syl-sidebar" class:sidebar-collapsed={!sidebarOpen}>
		<div class="syl-sidebar-header">
			{#if sidebarOpen}
				<span class="syl-sidebar-label">Syllabi</span>
				<div class="syl-sidebar-header-btns">
					<button class="syl-new-btn" onclick={newSyllabus} title="New syllabus">+</button>
					<button class="syl-collapse-btn" onclick={() => sidebarOpen = false} title="Collapse sidebar">‹</button>
				</div>
			{:else}
				<button class="syl-collapse-btn syl-expand-btn" onclick={() => sidebarOpen = true} title="Expand sidebar">›</button>
			{/if}
		</div>

		{#if sidebarOpen}
			{#if loadingList}
				<div class="syl-sidebar-empty">Loading…</div>
			{:else if syllabi.length === 0}
				<div class="syl-sidebar-empty">No syllabi yet.</div>
			{:else}
				<ul class="syl-list">
					{#each syllabi as syl (syl.id)}
						<li class="syl-list-item" class:active={activeSyllabusId === syl.id}>
							{#if renamingId === syl.id}
								<input
									class="syl-rename-input"
									bind:value={renameValue}
									onblur={() => commitRename(syl.id)}
									onkeydown={(e) => { if (e.key === 'Enter') commitRename(syl.id); if (e.key === 'Escape') renamingId = null; }}
									use:focus
								/>
							{:else}
								<button class="syl-list-btn" onclick={() => openSyllabus(syl.id)}>
									<span class="syl-list-name">{syl.name}</span>
									<span class="syl-list-date">{new Date(syl.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
								</button>
								<div class="syl-list-actions">
									<button class="syl-icon-btn" onclick={() => startRename(syl.id, syl.name)} title="Rename">✎</button>
									<button class="syl-icon-btn syl-del-btn" onclick={() => deleteSyllabus(syl.id)} title="Delete">×</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</aside>

	<div class="syl-editor-wrap">
		{#if !activeSyllabusId}
			<div class="syl-placeholder">
				<p>Select a syllabus or <button class="syl-link-btn" onclick={newSyllabus}>create a new one</button>.</p>
			</div>
		{:else if loadingDoc}
			<div class="syl-placeholder">Loading…</div>
		{:else}
			<div class="syl-toolbar">
				<span class="syl-save-status">
					{#if saving}saving…{:else if lastSaved}{formatSaved(lastSaved)}{/if}
				</span>
				<div class="syl-toolbar-right">
				<button class="syl-btn" class:syl-btn-active={sizesOpen} onclick={() => sizesOpen = !sizesOpen}>Sizes</button>
					<div class="margins-group">
						<span class="margins-group-label">Margins</span>
						<div class="margins-fields">
							{#each [['T','top'],['R','right'],['B','bottom'],['L','left']] as [abbr, side]}
								<label class="margins-field-label">
									{abbr}
									<input
										class="margins-input"
										type="number" min="0" max="300"
										value={margins[side]}
										oninput={(e) => { margins = { ...margins, [side]: Math.max(0, parseInt(e.target.value) || 0) }; scheduleSave(); }}
									/>
								</label>
							{/each}
							<span class="margins-unit">px</span>
						</div>
					</div>
					<label class="font-label">
						Font
						<div class="font-select-wrap">
							<select class="font-select" bind:value={font} onchange={scheduleSave}>
								{#each allFonts as f}<option value={f.value}>{f.label}</option>{/each}
							</select>
							<label class="font-upload-btn" title="Upload a font file (.ttf .otf .woff .woff2)">
								{#if fontUploading}…{:else}+{/if}
								<input
									type="file"
									accept=".ttf,.otf,.woff,.woff2"
									style="display:none"
									disabled={fontUploading}
									onchange={async (e) => {
										const file = e.target.files?.[0];
										if (!file) return;
										fontUploading = true;
										try {
											const fd = new FormData();
											fd.append('file', file);
											const res = await fetch('/api/syllabus/font', { method: 'POST', body: fd });
											if (res.ok) {
												const { url, name } = await res.json();
												customFonts = [...customFonts, { name, url, weight: '100 900', style: 'normal' }];
												font = name;
												scheduleSave();
											}
										} finally {
											fontUploading = false;
											e.target.value = '';
										}
									}}
								/>
							</label>
						</div>
					</label>
					{#if customFontNames.length > 0}
						<div class="custom-fonts-list">
							{#each customFontNames as cfName}
								{@const cfEntries = customFonts.filter(f => f.name === cfName)}
								<div class="custom-font-group">
									<div class="custom-font-chip-row">
										<span class="custom-font-chip">
											{cfName}
										</span>
										<button class="custom-font-add-weight" title="Upload additional weight/style for this font"
											onclick={() => {
												fontWeightAdding = { ...fontWeightAdding, [cfName]: fontWeightAdding[cfName] ? null : { weight: '700', style: 'normal' } };
											}}>+wt</button>
										<button class="custom-font-remove" title="Remove font" onclick={() => {
											customFonts = customFonts.filter(f => f.name !== cfName);
											if (font === cfName) font = FONTS[0].value;
											scheduleSave();
										}}>×</button>
									</div>
									<div class="custom-font-weights">
										{#each cfEntries as wf}
											<span class="custom-font-weight-badge">{wf.weight ?? '100–900'}{wf.style === 'italic' ? ' italic' : ''}</span>
										{/each}
									</div>
									{#if fontWeightAdding[cfName]}
										<div class="custom-font-weight-upload">
											<select class="font-weight-select" bind:value={fontWeightAdding[cfName].weight}>
												<option value="100">100 Thin</option>
												<option value="200">200 ExtraLight</option>
												<option value="300">300 Light</option>
												<option value="400">400 Regular</option>
												<option value="500">500 Medium</option>
												<option value="600">600 SemiBold</option>
												<option value="700">700 Bold</option>
												<option value="800">800 ExtraBold</option>
												<option value="900">900 Black</option>
											</select>
											<select class="font-weight-select" bind:value={fontWeightAdding[cfName].style}>
												<option value="normal">Normal</option>
												<option value="italic">Italic</option>
											</select>
											<label class="font-upload-btn" title="Choose font file">
												{#if fontWeightUploading[cfName]}…{:else}↑{/if}
												<input
													type="file"
													accept=".ttf,.otf,.woff,.woff2"
													style="display:none"
													disabled={fontWeightUploading[cfName]}
													onchange={async (e) => {
														const file = e.target.files?.[0];
														if (!file) return;
														// Capture weight/style before await in case the selects change
														const w = fontWeightAdding[cfName]?.weight ?? '700';
														const s = fontWeightAdding[cfName]?.style ?? 'normal';
														fontWeightUploading = { ...fontWeightUploading, [cfName]: true };
														try {
															const fd = new FormData();
															fd.append('file', file);
															const res = await fetch('/api/syllabus/font', { method: 'POST', body: fd });
															if (res.ok) {
																const { url } = await res.json();
																customFonts = [...customFonts, { name: cfName, url, weight: w, style: s }];
																fontWeightAdding = { ...fontWeightAdding, [cfName]: null };
																scheduleSave();
															}
														} finally {
															fontWeightUploading = { ...fontWeightUploading, [cfName]: false };
															e.target.value = '';
														}
													}}
												/>
											</label>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<button class="syl-btn" class:syl-btn-active={previewOpen} onclick={() => previewOpen ? (previewOpen = false) : openPreview()}>
						{previewOpen ? 'Hide Preview' : 'Preview'}
					</button>
					<button class="syl-btn syl-btn-print" onclick={printSyllabus}>Print</button>
				</div>
			</div>

			{#if sizesOpen}
			<div class="syl-sizes-bar">
				<span class="sizes-bar-label">Size</span>
				{#each [['Title','title'],['Section','section'],['Body','text'],['Week','weekHeader'],['Topic','weekTopic']] as [label, key]}
					<label class="sizes-field-label">
						{label}
						<div class="sizes-input-wrap">
							<input
								class="margins-input"
								type="number" min="4" max="144"
								value={fontSizes[key]}
								oninput={(e) => { fontSizes = { ...fontSizes, [key]: Math.max(4, parseInt(e.target.value) || 4) }; scheduleSave(); }}
							/>
							<span class="margins-unit">pt</span>
						</div>
					</label>
				{/each}

				<span class="sizes-bar-divider"></span>
				<span class="sizes-bar-label">Line height</span>
				{#each [['Title','title'],['Section','section'],['Body','text'],['Week','weekHeader'],['Topic','weekTopic']] as [label, key]}
					<label class="sizes-field-label">
						{label}
						<div class="sizes-input-wrap">
							<input
								class="margins-input lh-input"
								type="number" min="0.8" max="4" step="0.05"
								value={lineHeights[key]}
								oninput={(e) => { const v = parseFloat(e.target.value); lineHeights = { ...lineHeights, [key]: isNaN(v) ? 1 : Math.max(0.8, v) }; scheduleSave(); }}
							/>
						</div>
					</label>
				{/each}

				<span class="sizes-bar-divider"></span>
				<span class="sizes-bar-label">Space below</span>
				{#each [['Title','title'],['Section','section'],['Body','text'],['Week','week']] as [label, key]}
					<label class="sizes-field-label">
						{label}
						<div class="sizes-input-wrap">
							<input
								class="margins-input"
								type="number" min="0" max="144"
								value={spacing[key]}
								oninput={(e) => { spacing = { ...spacing, [key]: Math.max(0, parseInt(e.target.value) || 0) }; scheduleSave(); }}
							/>
							<span class="margins-unit">pt</span>
						</div>
					</label>
				{/each}
			</div>
			{/if}

			<div class="syl-blocks">
				{#each blocks as block, idx (block.id)}
					<div
						class="syl-block"
						class:drag-over={dragOverIdx === idx}
						class:dragging={dragSrcIdx === idx}
						class:hidden-block={block.hidden}
						draggable="true"
						ondragstart={(e) => onDragStart(e, idx)}
						ondragover={(e) => onDragOver(e, idx)}
						ondrop={(e) => onDrop(e, idx)}
						ondragend={onDragEnd}
						role="listitem"
					>
						<div class="block-gutter">
							<span class="drag-handle" title="Drag to reorder">⠷</span>
							<span class="block-type-pill">{BLOCK_LABELS[block.type]}</span>
							<div class="block-actions">
								<button class="blk-btn" onclick={() => toggleBlockHidden(block.id)} title={block.hidden ? 'Show in output' : 'Hide from output'}>
									{block.hidden ? '🕶️‍🗨️' : '🕶️'}
								</button>
								<button class="blk-btn blk-btn-del" onclick={() => deleteBlock(block.id)} title="Delete block">×</button>
							</div>
							{#if block.type === 'section'}
								<label class="syl-checkbox-label block-section-opt" title="Toggle underline">
									<input type="checkbox" checked={block.border ?? true} onchange={(e) => { blocks = blocks.map(b => b.id === block.id ? { ...b, border: e.target.checked } : b); scheduleSave(); }} />
									Underline
								</label>
							{/if}
						</div>

						<div class="block-content">
							{#if block.type === 'title'}
								<input
									class="block-input block-title"
									style="font-size:{edPx(fontSizes.title)}px;line-height:{lineHeights.title};font-weight:700"
									value={block.content}
									oninput={(e) => updateBlock(block.id, e.target.value)}
									placeholder="Course title…"
								/>
							{:else if block.type === 'section'}
								<input
									class="block-input block-section"
									class:block-section-underline={block.border ?? true}
									style="font-size:{edPx(fontSizes.section)}px;line-height:{lineHeights.section};font-weight:700;margin-bottom:{edPx(spacing.section)}px"
									value={block.content}
									oninput={(e) => updateBlock(block.id, e.target.value)}
									placeholder="Section heading…"
								/>
							{:else if block.type === 'text'}
								<textarea
									class="block-input block-text"
									style="font-size:{edPx(fontSizes.text)}px;line-height:{lineHeights.text};margin-bottom:{edPx(spacing.text)}px"
									value={block.content}
									oninput={(e) => updateBlock(block.id, e.target.value)}
									placeholder="Text, **markdown**, and $ supported…"
									use:autosize
								></textarea>
							{:else if block.type === 'week'}
								{@const wd = parseWeek(block.content)}
								<div class="week-editor" style="margin-bottom:{edPx(spacing.week)}px">
									<div class="week-header-row">
										<span class="week-prefix" style="font-size:{edPx(fontSizes.weekHeader)}px;font-weight:700;line-height:{lineHeights.weekHeader}">{block.hidden ? 'Week —:' : 'Week ' + (weekNums[block.id] ?? '') + ':'} </span>
										<input class="week-title-input" style="font-size:{edPx(fontSizes.weekHeader)}px;line-height:{lineHeights.weekHeader};font-weight:700" value={wd.title ?? ''} oninput={(e) => updateWeekField(block.id, 'title', e.target.value)} placeholder="Week title…" />
									</div>
									<div class="week-topics">
										{#each (wd.topics ?? []) as topic, ti}
											<div class="topic-row" class:topic-hidden={topic.hidden}>
												<input class="topic-input" style="font-size:{edPx(fontSizes.weekTopic)}px;line-height:{lineHeights.weekTopic}" value={topic.text} oninput={(e) => updateTopic(block.id, topic.id, e.target.value)} placeholder="Topic…" />
												<div class="topic-actions">
													<button class="topic-btn" onclick={() => moveTopic(block.id, ti, -1)} disabled={ti===0} title="Move up">↑</button>
													<button class="topic-btn" onclick={() => moveTopic(block.id, ti, 1)} disabled={ti===wd.topics.length-1} title="Move down">↓</button>
													<button class="topic-btn" onclick={() => toggleTopic(block.id, topic.id)} title={topic.hidden ? 'Show' : 'Hide'}>{topic.hidden ? '○' : '●'}</button>
													<button class="topic-btn topic-btn-del" onclick={() => deleteTopic(block.id, topic.id)} title="Delete">×</button>
												</div>
											</div>
										{/each}
										<button class="add-topic-btn" onclick={() => addTopic(block.id)}>+ Add topic</button>
									</div>
								</div>
							{/if}

							<div class="add-block-row">
								<button class="add-btn" onclick={() => addBlock('text', idx)}>+ Text</button>
								<button class="add-btn" onclick={() => addBlock('section', idx)}>+ Section</button>
								<button class="add-btn" onclick={() => addBlock('week', idx)}>+ Week</button>
								<button class="add-btn" onclick={() => addBlock('title', idx)}>+ Title</button>
							</div>
						</div>
					</div>
				{/each}

				{#if blocks.length === 0}
					<div class="syl-empty">
						<button class="syl-btn" onclick={() => { blocks = defaultBlocks(); scheduleSave(); }}>Start from template</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

</div>

<!-- Hidden measurement div: all blocks at content-area width, used to greedily pack blocks into pages. -->
{#if previewOpen}
	<div
		class="syl-measure"
		bind:this={measureEl}
		style:width="{PAGE_W - margins.left - margins.right}px"
	
	>
		{@html renderMeasure()}
	</div>
{/if}

<!-- ── Floating preview window ────────────────────────────────────── -->
{#if previewOpen}
	<div
		class="float-panel"
		style:left="{floatX}px"
		style:top="{floatY}px"
		role="dialog"
		aria-label="Syllabus preview"
	>
		<div class="float-titlebar" onmousedown={onTitlebarMousedown} role="toolbar">
			<span class="float-title">{syllabusName || 'Preview'}</span>
			<div class="float-actions">
				<button class="syl-btn syl-btn-print float-print-btn" onclick={printSyllabus}>Print</button>
				<button class="float-close-btn" onclick={() => previewOpen = false} title="Close">×</button>
			</div>
		</div>
		<!-- bind:clientWidth drives pageZoom reactively, including when user resizes the panel -->
		<div class="float-body" bind:clientWidth={previewBodyWidth}>
			<div class="float-pages">
				{#each { length: numPages } as _, pageIndex}
					{#if pageIndex > 0}<div class="page-gap"></div>{/if}
					<!--
						Each page is a fully independent container.
						Padding sets the four margins; content inside is laid out fresh
						with its own text-wrapping context — no shared div, no clipping offsets.
					-->
					<div
						class="float-page"
						style:width="{PAGE_W}px"
						style:height="{PAGE_H}px"
						style:padding-top="{margins.top}px"
						style:padding-right="{margins.right}px"
						style:padding-bottom="{margins.bottom}px"
						style:padding-left="{margins.left}px"
					
						style:zoom={pageZoom}
					>
						{@html renderPage(pageBlocks[pageIndex])}
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Print-only output -->
<div class="print-only" style:padding="{margins.top}px {margins.right}px {margins.bottom}px {margins.left}px">
	{@html activeSyllabusId ? renderPrint() : ''}
</div>

<style>
	/* ── Editor shell ── */
	.syl-root {
		display: flex;
		min-height: 600px;
		border: 1.5px solid #e8e2d9;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
		width: 100%;
		margin-left: 0;
		margin-right: 0;
		transition: margin-right 0.2s ease;
	}

	/* When preview is open, left-align so the float window has room on the right */
	.syl-root.preview-open {
		margin-left: 0;
		margin-right: auto;
	}

	/* ── Sidebar ── */
	.syl-sidebar {
		width: 200px; min-width: 200px;
		border-right: 1.5px solid #e8e2d9;
		display: flex; flex-direction: column;
		background: #faf7f2;
		transition: width 0.2s ease, min-width 0.2s ease;
		overflow: hidden;
	}
	.syl-sidebar.sidebar-collapsed {
		width: 36px; min-width: 36px;
	}
	.syl-sidebar-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.75rem 0.85rem 0.5rem;
		border-bottom: 1px solid #e8e2d9;
	}
	.syl-sidebar-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #a09688; }
	.syl-sidebar-header-btns { display: flex; align-items: center; gap: 0.25rem; }
	.syl-collapse-btn {
		width: 22px; height: 22px; border: none; background: none; cursor: pointer;
		border-radius: 5px; font-size: 1rem; line-height: 1; color: #a09688;
		display: flex; align-items: center; justify-content: center;
		transition: background 0.1s, color 0.1s;
	}
	.syl-collapse-btn:hover { background: #ede8e0; color: var(--ink); }
	.sidebar-collapsed .syl-sidebar-header { justify-content: center; padding: 0.75rem 0 0.5rem; border-bottom: 1px solid #e8e2d9; }
	.syl-expand-btn { margin: 0 auto; }
	.syl-new-btn {
		width: 22px; height: 22px; border: 1.5px solid #c8c1b4; border-radius: 5px;
		background: #fff; cursor: pointer; font-size: 1rem; line-height: 1;
		display: flex; align-items: center; justify-content: center;
		color: #666; transition: border-color 0.1s, color 0.1s;
	}
	.syl-new-btn:hover { border-color: var(--ink); color: var(--ink); }
	.syl-sidebar-empty { padding: 1rem 0.85rem; font-size: 0.82rem; color: #a09688; }
	.syl-list { list-style: none; margin: 0; padding: 0.35rem 0; flex: 1; overflow-y: auto; }
	.syl-list-item { display: flex; align-items: center; padding: 0 0.4rem; position: relative; }
	.syl-list-item .syl-list-actions { display: none; gap: 0.1rem; }
	.syl-list-item:hover .syl-list-actions { display: flex; }
	.syl-list-btn {
		flex: 1; display: flex; flex-direction: column; align-items: flex-start;
		padding: 0.45rem 0.5rem; border: none; background: none; cursor: pointer;
		border-radius: 7px; text-align: left; gap: 0.1rem; transition: background 0.1s;
	}
	.syl-list-btn:hover { background: #f0ebe3; }
	.syl-list-item.active .syl-list-btn { background: #e8e2d9; }
	.syl-list-name { font-size: 0.82rem; font-weight: 500; color: var(--ink); line-height: 1.3; }
	.syl-list-date { font-size: 0.68rem; color: #a09688; }
	.syl-icon-btn {
		width: 20px; height: 20px; border: none; background: none; cursor: pointer;
		border-radius: 4px; font-size: 0.8rem; color: #aaa;
		display: flex; align-items: center; justify-content: center;
		transition: background 0.1s, color 0.1s;
	}
	.syl-icon-btn:hover { background: #e8e2d9; color: var(--ink); }
	.syl-del-btn:hover { background: #fee2e2 !important; color: #c0392b !important; }
	.syl-rename-input {
		flex: 1; font-family: inherit; font-size: 0.82rem; padding: 0.3rem 0.5rem;
		border: 1.5px solid var(--ink); border-radius: 6px; outline: none;
		background: #fff; margin: 0.25rem 0;
	}

	/* ── Editor pane ── */
	.syl-editor-wrap { flex: 1; display: flex; flex-direction: column; min-width: 0; }
	.syl-placeholder { display: flex; align-items: center; justify-content: center; flex: 1; color: #a09688; font-size: 0.9rem; }
	.syl-link-btn { background: none; border: none; cursor: pointer; color: var(--ink); text-decoration: underline; font: inherit; }

	/* Toolbar */
	.syl-toolbar {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.55rem 1rem; border-bottom: 1px solid #e8e2d9;
		background: #faf7f2; gap: 0.75rem; flex-wrap: wrap;
	}
	.syl-toolbar-right { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.syl-save-status { font-size: 0.75rem; color: #a09688; }
	.font-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: #666; }
	.font-select {
		font-family: inherit; font-size: 0.82rem; padding: 0.22rem 0.45rem;
		border: 1.5px solid #ddd7cc; border-radius: 6px; background: #fff; cursor: pointer;
	}
	/* Sizes sub-bar */
	.syl-sizes-bar {
		display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
		padding: 0.5rem 1rem; border-bottom: 1px solid #e8e2d9;
		background: #f5f0e8;
	}
	.sizes-bar-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #a09688; white-space: nowrap; }
	.sizes-bar-divider { width: 1px; height: 1.5rem; background: #ddd7cc; flex-shrink: 0; }
	.sizes-field-label {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #555;
	}
	.sizes-input-wrap { display: flex; align-items: center; }

	/* Font upload */
	.font-select-wrap { display: flex; align-items: center; gap: 0; }
	.font-upload-btn {
		display: flex; align-items: center; justify-content: center;
		width: 24px; height: 24px; margin-left: 0.3rem;
		border: 1.5px solid #c8c1b4; border-radius: 5px;
		background: #fff; cursor: pointer; font-size: 1rem; font-weight: 500; color: #666;
		line-height: 1; flex-shrink: 0;
		transition: border-color 0.1s, color 0.1s;
	}
	.font-upload-btn:hover { border-color: var(--ink); color: var(--ink); }
	.custom-fonts-list { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: flex-start; }
	.custom-font-group { display: flex; flex-direction: column; gap: 0.2rem; }
	.custom-font-chip-row { display: flex; align-items: center; gap: 0.2rem; }
	.custom-font-chip {
		display: flex; align-items: center; gap: 0.2rem;
		font-size: 0.72rem; padding: 0.15rem 0.45rem; border-radius: 99px;
		background: #e8e2d9; color: var(--ink);
	}
	.custom-font-weights { display: flex; gap: 0.2rem; flex-wrap: wrap; }
	.custom-font-weight-badge {
		font-size: 0.62rem; padding: 0.05rem 0.35rem; border-radius: 99px;
		background: #f0ece5; color: #a09688; border: 1px solid #d9d3c8;
	}
	.custom-font-add-weight {
		border: 1px solid #c8c0b4; background: none; cursor: pointer; font-size: 0.65rem;
		color: #a09688; border-radius: 99px; padding: 0.1rem 0.35rem; line-height: 1;
	}
	.custom-font-add-weight:hover { border-color: var(--ink); color: var(--ink); }
	.custom-font-remove {
		border: none; background: none; cursor: pointer; font-size: 0.85rem;
		color: #a09688; line-height: 1; padding: 0;
	}
	.custom-font-remove:hover { color: #c0392b; }
	.custom-font-weight-upload {
		display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;
		padding: 0.3rem 0.4rem; background: #f5f1eb; border-radius: 6px;
		border: 1px solid #d9d3c8;
	}
	.font-weight-select {
		font-size: 0.72rem; padding: 0.15rem 0.3rem; border: 1px solid #c8c0b4;
		border-radius: 4px; background: #fff; color: var(--ink); cursor: pointer;
	}

	.margins-group { display: flex; align-items: center; gap: 0.4rem; }
	.margins-group-label { font-size: 0.82rem; color: #666; white-space: nowrap; }
	.margins-fields { display: flex; align-items: center; gap: 0.25rem; }
	.margins-field-label {
		display: flex; flex-direction: column; align-items: center; gap: 0.1rem;
		font-size: 0.62rem; font-weight: 700; color: #a09688; text-transform: uppercase; letter-spacing: 0.05em;
	}
	.margins-input {
		width: 42px; font-family: inherit; font-size: 0.8rem; padding: 0.18rem 0.2rem;
		border: 1.5px solid #ddd7cc; border-radius: 5px; background: #fff; text-align: center;
	}
	.margins-input.lh-input { width: 52px; }
	.margins-input:focus { outline: none; border-color: var(--ink); }
	.margins-unit { font-size: 0.72rem; color: #a09688; }
	.syl-btn {
		padding: 0.3rem 0.8rem; font-family: inherit; font-size: 0.82rem; font-weight: 500;
		border: 1.5px solid #c8c1b4; border-radius: 7px; background: #fff; cursor: pointer;
		color: var(--ink); transition: border-color 0.12s, background 0.12s; white-space: nowrap;
	}
	.syl-btn:hover { border-color: var(--ink); }
	.syl-btn-active { background: var(--ink); color: #fff; border-color: var(--ink); }
	.syl-btn-active:hover { opacity: 0.85; }
	.syl-btn-print { background: var(--ink); color: #fff; border-color: var(--ink); }
	.syl-btn-print:hover { opacity: 0.85; }
	.syl-checkbox-label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: #666; cursor: pointer; white-space: nowrap; }
	/* Blocks */
	.syl-blocks { flex: 1; padding: 2rem 1.5rem 2rem 0.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0; background: #fff; }
	.syl-block {
		display: flex; flex-direction: row; align-items: flex-start;
		position: relative; border-radius: 6px;
		transition: background 0.1s;
	}
	.syl-block:hover { background: #faf7f2; }
	.syl-block.drag-over { outline: 2px solid var(--ink); outline-offset: -2px; border-radius: 6px; }
	.syl-block.dragging { opacity: 0.4; }
	.syl-block.hidden-block { opacity: 0.35; }

	/* Left gutter: drag handle, type label, actions — fades in on hover */
	.block-gutter {
		width: 72px; flex-shrink: 0;
		display: flex; flex-direction: column; align-items: flex-end;
		padding: 0.25rem 0.6rem 0 0;
		gap: 0.2rem;
		opacity: 0; transition: opacity 0.15s;
	}
	.syl-block:hover .block-gutter { opacity: 1; }
	.drag-handle { cursor: grab; color: #bbb; font-size: 1rem; user-select: none; line-height: 1; }
	.drag-handle:active { cursor: grabbing; }
	.block-type-pill {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
		color: #b0a898; white-space: nowrap;
	}
	.block-actions { display: flex; gap: 0.15rem; }
	.blk-btn {
		width: 20px; height: 20px; border: none; background: none; cursor: pointer;
		border-radius: 4px; font-size: 0.78rem; display: flex; align-items: center; justify-content: center;
		color: #aaa; transition: background 0.1s;
	}
	.blk-btn:hover { background: #ede8e0; }
	.blk-btn-del:hover { background: #fee2e2; color: #c0392b; }
	.block-section-opt { margin-top: 0.25rem; font-size: 0.7rem; }

	/* Right content area */
	.block-content { flex: 1; min-width: 0; padding-top: 0.15rem; }
	.block-input {
		width: 100%; box-sizing: border-box; border: none; outline: none;
		font-family: inherit; background: transparent; padding: 0; color: var(--ink);
		display: block;
	}
	.block-title { /* font-size/weight/line-height via inline style */ }
	.block-section { /* font-size/weight/line-height via inline style */ }
	.block-section-underline { border-bottom: 1.5px solid currentColor; padding-bottom: 0.2rem; }
	.block-text { resize: none; overflow: hidden; min-height: 2em; }

	/* Week editor */
	.week-editor { }
	.week-header-row { display: flex; align-items: baseline; gap: 0.2rem; margin-bottom: 0.3rem; }
	.week-prefix { color: var(--ink); }
	.week-title-input {
		flex: 1; font-family: inherit; font-weight: 700;
		border: none; border-bottom: 1px solid #ddd7cc; outline: none;
		background: transparent; color: var(--ink);
	}
	.week-title-input:focus { border-bottom-color: var(--ink); }
	.week-topics { display: flex; flex-direction: column; gap: 0.1rem; padding-left: 1.1em; }
	.topic-row { display: flex; align-items: center; gap: 0.3rem; padding: 0.05rem 0; }
	.topic-row.topic-hidden { opacity: 0.38; }
	.topic-input {
		flex: 1; font-family: inherit; border: none; outline: none;
		border-bottom: 1px solid transparent; padding: 0; background: transparent; color: var(--ink);
	}
	.topic-input:focus { border-bottom-color: #ddd7cc; }
	.topic-actions { display: flex; gap: 0.1rem; opacity: 0; transition: opacity 0.12s; }
	.topic-row:hover .topic-actions { opacity: 1; }
	.topic-btn {
		width: 18px; height: 18px; border: none; background: none; cursor: pointer;
		font-size: 0.72rem; border-radius: 3px; color: #aaa;
		display: flex; align-items: center; justify-content: center;
	}
	.topic-btn:hover:not(:disabled) { background: #f0ebe3; color: var(--ink); }
	.topic-btn:disabled { opacity: 0.28; cursor: default; }
	.topic-btn-del:hover { background: #fee2e2 !important; color: #c0392b !important; }
	.add-topic-btn {
		font-family: inherit; font-size: 0.75rem; color: #a09688; background: none;
		border: 1px dashed #ddd7cc; border-radius: 5px; padding: 0.15rem 0.55rem;
		cursor: pointer; margin: 0.3rem 0 0; transition: border-color 0.12s, color 0.12s;
	}
	.add-topic-btn:hover { border-color: var(--ink); color: var(--ink); }
	.add-block-row {
		display: flex; gap: 0.3rem; padding: 0.4rem 0 0.2rem;
		opacity: 0; transition: opacity 0.12s;
	}
	.syl-block:hover .add-block-row { opacity: 1; }
	.add-btn {
		font-family: inherit; font-size: 0.68rem; color: #a09688; background: none;
		border: 1px dashed #ddd7cc; border-radius: 4px; padding: 0.12rem 0.4rem;
		cursor: pointer; transition: border-color 0.1s, color 0.1s;
	}
	.add-btn:hover { border-color: var(--ink); color: var(--ink); }
	.syl-empty { text-align: center; padding: 3rem 1rem; color: #a09688; }

	/* ── Floating preview window ── */
	.float-panel {
		position: fixed;
		z-index: 400;
		width: 500px;
		height: 680px;
		min-width: 280px;
		min-height: 240px;
		display: flex;
		flex-direction: column;
		background: #fff;
		border: 1.5px solid #c8c1b4;
		border-radius: 10px;
		box-shadow: 0 8px 40px rgba(0,0,0,0.22);
		resize: both;
		overflow: hidden;
	}

	.float-titlebar {
		display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
		padding: 0.45rem 0.6rem 0.45rem 0.85rem;
		background: #faf7f2; border-bottom: 1px solid #e8e2d9;
		cursor: grab; user-select: none; flex-shrink: 0;
	}
	.float-titlebar:active { cursor: grabbing; }
	.float-title {
		font-size: 0.82rem; font-weight: 600; color: var(--ink);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		flex: 1; min-width: 0;
	}
	.float-actions { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
	.float-print-btn { padding: 0.2rem 0.6rem; font-size: 0.75rem; }
	.float-close-btn {
		width: 24px; height: 24px; border: none; background: none; cursor: pointer;
		font-size: 1.1rem; border-radius: 5px; color: #888; line-height: 1;
		display: flex; align-items: center; justify-content: center;
	}
	.float-close-btn:hover { background: #fee2e2; color: #c0392b; }

	/* Invisible off-screen div used only for content-height measurement */
	.syl-measure {
		position: fixed;
		left: -99999px;
		top: 0;
		visibility: hidden;
		pointer-events: none;
	}

	/* float-body scrolls vertically; bind:clientWidth on it drives pageZoom */
	.float-body {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		background: #f0ebe3;
		padding: 20px;
	}

	/* Vertical stack of page sheets */
	.float-pages {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	/* Gray gap rendered between pages (background shows through) */
	.page-gap {
		height: 12px;
		align-self: stretch;
		flex-shrink: 0;
	}

	/* Each page sheet is white, PAGE_W × PAGE_H (300dpi), zoomed down for screen. */
	.float-page {
		overflow: hidden;
		background: #fff;
		box-shadow: 0 2px 16px rgba(0,0,0,0.1);
		flex-shrink: 0;
	}


	/* Document typography — applies to float-page, print-only, AND syl-measure so layout matches */
	:global(.float-page .syl-title, .print-only .syl-title, .syl-measure .syl-title) { font-size: 2rem; font-weight: 700; margin: 0 0 0.15rem; }
	:global(.float-page .syl-section, .print-only .syl-section, .syl-measure .syl-section) { font-size: 1.05rem; font-weight: 700; margin: 1.75rem 0 0.4rem; border-bottom: 1.5px solid currentColor; padding-bottom: 0.2rem; }
	:global(.float-page .syl-section:first-child, .print-only .syl-section:first-child, .syl-measure .syl-section:first-child) { margin-top: 0; }
	:global(.float-page .syl-section p, .print-only .syl-section p, .syl-measure .syl-section p) { margin: 0; }
	:global(.float-page .syl-text, .print-only .syl-text, .syl-measure .syl-text) { font-size: 0.9rem; margin-bottom: 0.4rem; }
	:global(.float-page .syl-text p, .print-only .syl-text p, .syl-measure .syl-text p) { margin: 0 0 0.4em; }
	:global(.float-page .syl-week, .print-only .syl-week, .syl-measure .syl-week) { margin: 0.6rem 0; }
	:global(.float-page .syl-week-header, .print-only .syl-week-header, .syl-measure .syl-week-header) { font-weight: 700; font-size: 0.92rem; margin-bottom: 0.18rem; }
	:global(.float-page .syl-topics, .print-only .syl-topics, .syl-measure .syl-topics) { margin: 0.15rem 0 0 1.25rem; padding: 0; list-style: disc; }
	:global(.float-page .syl-topics li, .print-only .syl-topics li, .syl-measure .syl-topics li) { font-size: 0.86rem; }
	:global(.float-page .katex-display, .print-only .katex-display, .syl-measure .katex-display) { margin: 0.5em 0; }
	:global(.float-page strong, .print-only strong, .syl-measure strong) { font-weight: 700; }
	:global(.float-page em, .print-only em, .syl-measure em) { font-style: italic; }

	/* Print */
	.print-only { display: none; }
	@media print {
		.syl-root, .float-panel { display: none !important; }
		.print-only { display: block !important; }
		:global(.print-only .syl-title) { font-size: 2rem; font-weight: 700; margin: 0 0 0.15rem; }
		:global(.print-only .syl-section) { font-size: 1.05rem; font-weight: 700; margin: 1.5rem 0 0.35rem; border-bottom: 1.5px solid #000; padding-bottom: 0.15rem; }
		:global(.print-only .syl-text) { font-size: 10pt; line-height: 1.6; }
		:global(.print-only .syl-week-header) { font-weight: 700; font-size: 10pt; }
		:global(.print-only .syl-topics) { margin-left: 1.2rem; }
		:global(.print-only .syl-topics li) { font-size: 10pt; line-height: 1.5; }
	}
</style>

<script module>
	function focus(node) { node.focus(); node.select(); }
</script>
