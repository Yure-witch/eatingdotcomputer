<script>
	import { onMount, tick } from 'svelte';
	import {
		TEXT_FXS, FX_TO_CHAR, CHAR_TO_FX, FX_CLOSE_CHAR, FX_OPEN_CHARS,
		TEXT_COLORS, WDTH_FX_MAP, WDTH_STEPS, WGHT_FX_MAP, WGHT_STEPS, SZ_FX_MAP, SZ_STEPS, ekTokenToUrl,
		markupToSegments, segmentsToMarkup, normalizeLegacyMarkup, unicodeToReadable
	} from '$lib/message-render.js';
	import ExpressionPicker from './ExpressionPicker.svelte';
	import {
		tgEntry, tgFlagUrl, loadTelegramEmoji, loadCustomPacks,
		cpToToken, tgcToToken
	} from '$lib/telegram-emoji-store.js';
	import { tgStaticFrame, tgcStaticFrame, TG_PLACEHOLDER } from '$lib/tg-frame.js';
	import { getCustomEmojiMap, getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import { popoverPos } from '$lib/popover-pos.js';

	let {
		value = $bindable(''),
		placeholder = '',
		singleLine = false,
		// Hides the size slider in the typo bar. Bold / italic /
		// underline / strike / colour / emoji / emote / animation /
		// weight / width all stay — only the per-span font-size axis
		// is suppressed, since making one item in a checklist 3× its
		// neighbours rarely makes sense.
		disableSize = false,
		// Extra tools to render at the end of the formatting row. Chat's composer
		// keeps attach/expressions/GIFs in ONE row with the text controls; without
		// this a caller has to add a second row underneath, which stacks two
		// toolbars in a box that should have one.
		tools = null,
		// Collapse the text controls behind a single toggle, the way chat's
		// compose bar does on a phone: at that width a row of eight buttons is
		// most of the bar, and formatting is the part you reach for least.
		// Opt-in, so the assignment and profile fields keep showing everything.
		collapseTools = false,
		// Told whenever the docked expression sheet opens or closes. The sheet is
		// fixed to the bottom of the VIEWPORT, so whatever owns the surrounding
		// layout has to move out from under it — this component can't do that for
		// its caller, but it can say when.
		onExprToggle = null
	} = $props();

	let inputEl = $state(null);
	let showTextFxBar = $state(false);
	let showFormatPanel = $state(false);
	let showTools = $state(false); // only meaningful when collapseTools is set
	$effect(() => { onExprToggle?.(showExprPicker); });
	let showExprPicker = $state(false);
	// Trigger refs for the smart popover positioning action.
	let colorBtnEl = $state(null);
	let exprBtnEl = $state(null);
	// Bumps once `getCustomEmojiMap()` resolves so the edit-mode
	// re-sync $effect re-runs and `[ce:…]` tokens that were rendered
	// without a `src` (because the cache was empty) pick up their
	// URLs. Reading this inside the effect makes Svelte's reactivity
	// pick it up as a dependency.
	let _ceMapVersion = $state(0);

	// ── Inline expression insertion helpers ─────────────────────────
	// Each helper builds the same <img> shape the chat compose box uses
	// so the serializer's data-attribute round-trip already covers the
	// markup back-and-forth. The expression picker calls into these
	// from its callback props (onSelectEmoji, onInsertKitchen, etc.).
	function insertAtCursor(node) {
		if (!inputEl) return;
		inputEl.focus();
		const sel = window.getSelection();
		if (sel?.rangeCount && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(node);
			range.setStartAfter(node);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
		} else {
			inputEl.appendChild(node);
		}
		value = serializeCe(inputEl);
		// Newly inserted TG / TGC spans need a Lottie player. The
		// mounter is idempotent so spans that already animate are
		// skipped — only the freshly inserted one picks up an SVG.
		mountStaticEmotes(inputEl);
	}

	function insertEmojiText(emoji) {
		if (!emoji) return;
		insertAtCursor(document.createTextNode(emoji));
	}

	function makeEkImg(token) {
		const m = token.match(/^\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]$/i);
		const img = document.createElement('img');
		img.dataset.ek = token;
		img.className = 'ek-img ek-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', '');
		if (m) img.src = ekTokenToUrl(m[1], m[2], m[3]);
		return img;
	}

	function makeCeImg(emoji) {
		const token = `[ce:${emoji.shortcode}]`;
		const img = document.createElement('img');
		img.dataset.ce = token;
		img.className = 'ce-img ce-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', ':' + emoji.shortcode + ':');
		if (emoji.url) img.src = emoji.url;
		return img;
	}

	// TG / TGC emotes are Lottie animations, not static rasters. We
	// build them as `<span contenteditable="false">` carrying the
	// same `data-tg-cp` (or `data-tg-pack` + `data-tg-id`) attributes
	// the rendered `.tg-emoji` spans use. The shared `mountStaticEmotes`
	// helper then mounts a lottie-web SVG player into each one, just
	// like it does for non-chat surfaces. contenteditable=false keeps
	// the span atomic for caret + backspace; data-tg holds the
	// `[tg:…]` / `[tgc:…]` token so `serializeCe` round-trips them
	// without caring whether the underlying element is an <img> or
	// a <span>.
	function makeTgImg(cp, token) {
		const span = document.createElement('span');
		span.dataset.tg = token;
		span.dataset.tgCp = cp;
		span.className = 'tg-emoji';
		span.setAttribute('contenteditable', 'false');
		span.setAttribute('role', 'img');
		span.setAttribute('aria-label', token);
		return span;
	}

	function makeTgcImg(short, id, token) {
		const span = document.createElement('span');
		span.dataset.tg = token;
		span.dataset.tgPack = short;
		span.dataset.tgId = id;
		span.className = 'tg-emoji tgc-emoji';
		span.setAttribute('contenteditable', 'false');
		span.setAttribute('role', 'img');
		span.setAttribute('aria-label', token);
		return span;
	}

	// ExpressionPicker callbacks. Closing the popover after each insert
	// matches how chat compose works — users can re-open for the next
	// pick if they want a second one.
	function onPickerSelectEmoji(emoji)   { insertEmojiText(emoji); showExprPicker = false; }
	function onPickerInsertKitchen(token) { insertAtCursor(makeEkImg(token)); showExprPicker = false; }
	function onPickerInsertCustomEmoji(emoji) {
		insertAtCursor(makeCeImg(emoji));
		showExprPicker = false;
	}
	function onPickerInsertTgEmoji(it) {
		const node = it.custom
			? makeTgcImg(it.short, it.id, tgcToToken(it.short, it.id))
			: makeTgImg(it.cp, cpToToken(it.cp));
		insertAtCursor(node);
		showExprPicker = false;
	}
	// Reactions / GIFs aren't meaningful in plain assignment text fields
	// — leave them as no-ops so callers don't have to special-case the
	// callback shape. (Reactions panel is still visible in the picker so
	// instructors can insert reaction *images* as inline emotes.)
	function onPickerInsertReaction(reaction) {
		if (reaction?.url) {
			const img = document.createElement('img');
			img.className = 'ce-img ce-img-ce';
			img.src = reaction.url;
			img.setAttribute('contenteditable', 'false');
			img.setAttribute('alt', reaction.name || 'reaction');
			insertAtCursor(img);
		}
		showExprPicker = false;
	}
	function onPickerSelectGif() { showExprPicker = false; }
	let allowFxNesting = $state(true);
	let allowFxMultiply = $state(false);
	let fxSplitWords = $state(true);
	let messageFontSize = $state(1.0);
	let messageFontWeight = $state(400);
	let messageFontStretch = $state(100);
	let _savedCeSel = null;
	let _lastInlineTypo = {};
	let undoStack = [];
	let redoStack = [];

	const _segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
	const _isEmojiSeg = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);

	onMount(() => {
		if (value && inputEl) {
			inputEl.innerHTML = '';
			for (const node of ceMarkupToNodes(value)) inputEl.appendChild(node);
			mountStaticEmotes(inputEl);
		}
		// Custom-emoji URLs aren't available until /api/custom-emoji
		// resolves. Edit-mode loads of `[ce:…]` tokens depend on the
		// map being populated — kick off the fetch and bump the
		// version so the re-sync effect re-rebuilds the DOM with real
		// src URLs once the cache fills.
		getCustomEmojiMap().then(() => { _ceMapVersion += 1; });
	});

	// Re-sync the contenteditable DOM when `value` changes from the
	// outside (e.g. the parent reassigns it during an "edit existing
	// row" flow). Without this, switching the form into edit mode
	// changes the bound JS state but leaves the visible field showing
	// whatever was there before — the user sees no headline / item
	// labels even though the data was loaded.
	//
	// During normal typing the input handler sets
	//   value = serializeCe(inputEl)
	// so value already matches the DOM. The guard below compares
	// against a fresh serialization and skips the rebuild in that
	// case, which prevents caret jumps mid-keystroke.
	$effect(() => {
		// Track _ceMapVersion so the rebuild re-runs once the
		// custom-emoji cache fills (see onMount). Without this, ce
		// tokens loaded before the cache resolved would keep their
		// empty src.
		void _ceMapVersion;
		if (!inputEl) return;
		const current = serializeCe(inputEl);
		if (current === value) return;
		inputEl.innerHTML = '';
		if (value) {
			for (const node of ceMarkupToNodes(value)) inputEl.appendChild(node);
			mountStaticEmotes(inputEl);
		}
	});

	function makeFxNode(fxStack, content, delay = null) {
		const decorFx = fxStack.filter(fx => fx === 'underline' || fx === 'strike');
		const wdthFx = fxStack.find(fx => fx.startsWith('wdth-'));
		const wghtFx = fxStack.find(fx => fx.startsWith('wght-'));
		const szFx = fxStack.find(fx => fx.startsWith('sz-'));
		const animFx = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike' && !fx.startsWith('wdth-') && !fx.startsWith('wght-') && !fx.startsWith('sz-'));
		// `content` is either a plain string (segment text) or a Node
		// (e.g. an emote <img> we want to wrap in the current fx
		// stack). Edit-mode loading uses the Node branch to keep
		// formatted emotes inside their fx span instead of flattening
		// the markup to literal token text.
		let innerNode = (content instanceof Node) ? content : document.createTextNode(content);
		if (decorFx.length) {
			const span = document.createElement('span');
			span.className = `tfx ${decorFx.map(fx => `tfx-${fx}`).join(' ')}`;
			span.dataset.fx = decorFx.join(' ');
			const tdLine = decorFx.map(fx => fx === 'underline' ? 'underline' : 'line-through').join(' ');
			span.style.textDecorationLine = tdLine;
			span.style.textUnderlineOffset = '2px';
			span.appendChild(innerNode);
			innerNode = span;
		}
		if (szFx) {
			const span = document.createElement('span');
			span.className = `tfx tfx-${szFx}`;
			span.dataset.fx = szFx;
			span.style.fontSize = (parseFloat(szFx.replace('sz-', '')) / 100 * 0.9).toFixed(2) + 'rem';
			span.appendChild(innerNode);
			innerNode = span;
		}
		if (wghtFx) {
			const span = document.createElement('span');
			span.className = `tfx tfx-${wghtFx}`;
			span.dataset.fx = wghtFx;
			span.style.fontWeight = wghtFx.replace('wght-', '');
			span.appendChild(innerNode);
			innerNode = span;
		}
		if (wdthFx) {
			const span = document.createElement('span');
			span.className = `tfx tfx-${wdthFx}`;
			span.dataset.fx = wdthFx;
			span.style.fontStretch = wdthFx.replace('wdth-', '') + '%';
			span.appendChild(innerNode);
			innerNode = span;
		}
		for (let i = animFx.length - 1; i >= 0; i--) {
			const fx = animFx[i];
			const span = document.createElement('span');
			span.className = `tfx tfx-${fx}`;
			span.dataset.fx = fx;
			// flip mirrors the coordinate space — atomic so the caret can't
			// enter (where arrows/selection reverse). scaleX(-1) sits on an
			// inner wrapper so the atomic box keeps a normal caret hit-box.
			if (fx === 'flip') {
				span.setAttribute('contenteditable', 'false');
				const inner = document.createElement('span');
				inner.className = 'tfx-flip-inner';
				inner.appendChild(innerNode);
				innerNode = inner;
			}
			if (delay) span.style.animationDelay = delay;
			span.appendChild(innerNode);
			innerNode = span;
		}
		return innerNode;
	}

	function ceMarkupToNodes(markup) {
		const segs = markupToSegments(normalizeLegacyMarkup(markup));
		const nodes = [];
		let globalWi = 0;

		function pushText(text, fxStack) {
			if (!text) return;
			if (!fxStack.length) { nodes.push(document.createTextNode(text)); return; }
			// `flip` mirrors each EMOJI grapheme in place; letters keep flow.
			if (fxStack.includes('flip') && _segmenter) {
				const noFlip = fxStack.filter(f => f !== 'flip');
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				gs.forEach((g, i) => {
					const isEmoji = !/^\s+$/.test(g) && _isEmojiSeg(g);
					const stack = isEmoji ? fxStack : noFlip;
					if (/^\s+$/.test(g) || !stack.length) { nodes.push(document.createTextNode(g)); return; }
					nodes.push(makeFxNode(stack, g, `${((globalWi + i) * 0.06).toFixed(2)}s`));
				});
				globalWi += gs.filter(g => !/^\s+$/.test(g)).length;
				return;
			}
			// `ripple` renders per-grapheme.
			if (fxStack.includes('ripple') && _segmenter) {
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				gs.forEach((g, i) => {
					if (/^\s+$/.test(g)) nodes.push(document.createTextNode(g));
					else nodes.push(makeFxNode(fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`));
				});
				globalWi += gs.filter(g => !/^\s+$/.test(g)).length;
				return;
			}
			if (fxSplitWords && _segmenter) {
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				if (gs.length > 1 && gs.every(_isEmojiSeg)) {
					gs.forEach((g, i) => nodes.push(makeFxNode(fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`)));
					globalWi += gs.length; return;
				}
				const toks = text.split(/(\s+)/);
				if (toks.length > 1) {
					toks.forEach(tok => {
						if (/^\s+$/.test(tok)) nodes.push(document.createTextNode(tok));
						else nodes.push(makeFxNode(fxStack, tok, `${(globalWi++ * 0.06).toFixed(2)}s`));
					}); return;
				}
				nodes.push(makeFxNode(fxStack, text, `${(globalWi++ * 0.06).toFixed(2)}s`));
				return;
			}
			nodes.push(makeFxNode(fxStack, text));
		}

		// Emote tokens inside segment text. contentHtml (the render
		// path) detects and replaces these with inline images; the
		// editor's loader has to do the same — otherwise switching the
		// form into edit mode shows literal tokens like
		// `[tg:1f600]` instead of the emoji the instructor originally
		// inserted via the picker.
		const EMOTE_RE = /\[ek:[a-z0-9]+:[0-9a-f-]+:[0-9a-f-]+\]|\[ce:[a-zA-Z0-9_-]{1,32}\]|\[tgc:[A-Za-z0-9_]+:\d+\]|\[tg:[0-9a-f-]+\]/gi;

		function makeCeImgFromToken(token) {
			const shortM = token.match(/^\[ce:([a-zA-Z0-9_-]{1,32})\]$/);
			if (!shortM) return null;
			const shortcode = shortM[1];
			const entry = getCachedCustomEmojiMap()[shortcode];
			const img = document.createElement('img');
			img.dataset.ce = token;
			img.className = 'ce-img ce-img-ce';
			img.setAttribute('contenteditable', 'false');
			img.setAttribute('alt', ':' + shortcode + ':');
			if (entry?.url) img.src = entry.url;
			return img;
		}

		function nodeForToken(token) {
			if (token.startsWith('[ek:')) return makeEkImg(token);
			if (token.startsWith('[ce:')) return makeCeImgFromToken(token);
			if (token.startsWith('[tgc:')) {
				const m = token.match(/^\[tgc:([A-Za-z0-9_]+):(\d+)\]$/);
				return m ? makeTgcImg(m[1], m[2], token) : null;
			}
			if (token.startsWith('[tg:')) {
				const m = token.match(/^\[tg:([0-9a-f-]+)\]$/i);
				return m ? makeTgImg(m[1], token) : null;
			}
			return null;
		}

		function pushSegment(text, fxStack) {
			if (!text) return;
			EMOTE_RE.lastIndex = 0;
			let last = 0;
			let any = false;
			let m;
			while ((m = EMOTE_RE.exec(text)) !== null) {
				any = true;
				if (m.index > last) pushText(text.slice(last, m.index), fxStack);
				const node = nodeForToken(m[0]);
				if (node) {
					// Wrap the emote in the current fx stack so bold /
					// rainbow / shake / etc. carry through across the
					// surrounding text. Plain emotes (no fxStack) go in
					// as-is.
					nodes.push(fxStack.length ? makeFxNode(fxStack, node) : node);
				} else {
					// Unknown token shape — fall back to literal text so
					// the data isn't silently dropped on save.
					pushText(m[0], fxStack);
				}
				last = m.index + m[0].length;
			}
			if (!any) { pushText(text, fxStack); return; }
			if (last < text.length) pushText(text.slice(last), fxStack);
		}

		for (const seg of segs) {
			pushSegment(seg.text, seg.fxStack);
		}
		return nodes;
	}

	function serializeCe(el) {
		let result = '';
		for (const node of el.childNodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				result += node.textContent;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				// Inline image tokens written by the ExpressionPicker
				// integration (emoji-kitchen, custom emotes, Telegram
				// stickers). Each <img> stores its canonical token in a
				// data attribute so we can round-trip them back into
				// the markup string the form submits / the renderer
				// re-parses. Without this branch they'd be silently
				// dropped here.
				if (node.tagName === 'IMG' && node.dataset?.ek) { result += node.dataset.ek; continue; }
				if (node.tagName === 'IMG' && node.dataset?.ce) { result += node.dataset.ce; continue; }
				if (node.tagName === 'IMG' && node.dataset?.tg) { result += node.dataset.tg; continue; }
				// TG / TGC emotes are now <span contenteditable="false">
				// wrappers (so a Lottie SVG player can mount inside them).
				// Detect them here too so the [tg:…] / [tgc:…] tokens
				// round-trip back into the serialized markup string.
				if (node.tagName === 'SPAN' && node.dataset?.tg) { result += node.dataset.tg; continue; }

				if (node.dataset?.fx) {
					const fxStack = node.dataset.fx.split(' ').filter(fx => FX_TO_CHAR[fx]);
					result += fxStack.map(fx => FX_TO_CHAR[fx]).join('') + serializeCe(node) + FX_CLOSE_CHAR.repeat(fxStack.length);
				} else if (node.tagName === 'BR') {
					result += '\n';
				} else {
					result += serializeCe(node);
				}
			}
		}
		return result;
	}

	function findDomPos(root, target) {
		let pos = 0;
		function walk(node) {
			if (node.nodeType === Node.TEXT_NODE) {
				const len = node.textContent.length;
				if (pos + len >= target) return { node, offset: target - pos };
				pos += len;
				return null;
			}
			for (const child of node.childNodes) { const r = walk(child); if (r) return r; }
			return null;
		}
		return walk(root) ?? { node: root, offset: root.childNodes.length };
	}

	function cePlainOffset(el, targetNode, targetOffset) {
		let n = 0, done = false;
		function full(node) {
			if (node.nodeType === Node.TEXT_NODE) { n += node.textContent.length; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node.tagName === 'BR') { n += 1; return; }
			for (const c of node.childNodes) full(c);
		}
		function walk(node) {
			if (done) return;
			if (node === targetNode && node.nodeType === Node.TEXT_NODE) { n += targetOffset; done = true; return; }
			if (node.nodeType === Node.TEXT_NODE) { n += node.textContent.length; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node === targetNode) {
				let i = 0; for (const c of node.childNodes) { if (i++ >= targetOffset) break; full(c); }
				done = true; return;
			}
			if (node.tagName === 'BR') { n += 1; return; }
			for (const c of node.childNodes) { if (done) break; walk(c); }
		}
		if (el === targetNode) {
			let i = 0; for (const c of el.childNodes) { if (i++ >= targetOffset) break; full(c); }
			return n;
		}
		for (const c of el.childNodes) { if (done) break; walk(c); }
		return n;
	}

	function onCeSelect() {
		// Cheap scope guard FIRST: this fires on mouseup/keyup anywhere in
		// the field, and cePlainOffset walks the whole tree — don't pay for
		// it when there's no selection in the compose. The bail must still
		// HIDE the bar — the perf rewrite dropped that half, which left the
		// formatting bar stuck open after deselecting.
		const sel0 = window.getSelection();
		if (!sel0 || sel0.isCollapsed || !inputEl?.contains(sel0.anchorNode)) { showTextFxBar = false; return; }
		showTextFxBar = true;
		const range = sel0.getRangeAt(0);
		_savedCeSel = {
			start: cePlainOffset(inputEl, range.startContainer, range.startOffset),
			end: cePlainOffset(inputEl, range.endContainer, range.endOffset)
		};
	}

	function pushUndo() {
		if (undoStack.length >= 50) undoStack.shift();
		undoStack.push(value);
		redoStack.length = 0;
	}

	function applyTextFx(name) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl || !inputEl.contains(sel.anchorNode)) return;
		pushUndo();
		const range = sel.getRangeAt(0);
		const selStart = cePlainOffset(inputEl, range.startContainer, range.startOffset);
		const selEnd = cePlainOffset(inputEl, range.endContainer, range.endOffset);
		if (selStart >= selEnd) return;

		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);

		const isColorFx = name.startsWith('color-') || name === 'rainbow';
		const isFormatFx = name === 'bold' || name === 'italic' || name === 'underline' || name === 'strike' || isColorFx;
		const isFmtFx = (fx) => fx === 'bold' || fx === 'italic' || fx === 'underline' || fx === 'strike' || fx === 'rainbow' || fx.startsWith('color-') || fx.startsWith('wdth-') || fx.startsWith('wght-') || fx.startsWith('sz-');

		let p0 = 0, allHaveIt = true;
		for (const seg of segs) {
			const sEnd = p0 + seg.text.length;
			if (sEnd > selStart && p0 < selEnd && !seg.fxStack.includes(name)) { allHaveIt = false; break; }
			p0 += seg.text.length;
		}

		let plain = 0;
		const newSegs = [];
		for (const seg of segs) {
			const segStart = plain, segEnd = plain + seg.text.length;
			if (segEnd <= selStart || segStart >= selEnd) {
				newSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else {
				const overlapStart = Math.max(segStart, selStart);
				const overlapEnd = Math.min(segEnd, selEnd);
				if (overlapStart > segStart) newSegs.push({ text: seg.text.slice(0, overlapStart - segStart), fxStack: [...seg.fxStack] });
				let newStack;
				if (allHaveIt) {
					newStack = seg.fxStack.filter(fx => fx !== name);
				} else if (allowFxNesting || isFormatFx) {
					newStack = [...seg.fxStack];
					if (isColorFx) newStack = newStack.filter(fx => !fx.startsWith('color-') && fx !== 'rainbow');
					if (allowFxMultiply || !newStack.includes(name)) newStack.push(name);
				} else {
					newStack = seg.fxStack.filter(isFmtFx);
					newStack.push(name);
				}
				newSegs.push({ text: seg.text.slice(overlapStart - segStart, overlapEnd - segStart), fxStack: newStack });
				if (overlapEnd < segEnd) newSegs.push({ text: seg.text.slice(overlapEnd - segStart), fxStack: [...seg.fxStack] });
			}
			plain += seg.text.length;
		}

		const mergedSegs = [];
		for (const seg of newSegs) {
			if (!seg.text) continue;
			const last = mergedSegs[mergedSegs.length - 1];
			if (last && last.fxStack.join(',') === seg.fxStack.join(',')) last.text += seg.text;
			else mergedSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
		}

		const newMarkup = segmentsToMarkup(mergedSegs);
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(newMarkup)) inputEl.appendChild(node);

		const startPos = findDomPos(inputEl, selStart);
		const endPos = findDomPos(inputEl, selEnd);
		const newRange = document.createRange();
		newRange.setStart(startPos.node, startPos.offset);
		newRange.setEnd(endPos.node, endPos.offset);
		sel.removeAllRanges();
		sel.addRange(newRange);

		value = newMarkup;
		inputEl.focus();
	}

	function applyInlineTypo(rawVal, steps, defaultVal, fxMap, prefix) {
		if (!_savedCeSel || !inputEl) return;
		const step = steps.reduce((a, b) => Math.abs(b - rawVal) < Math.abs(a - rawVal) ? b : a);
		if (step === _lastInlineTypo[prefix]) return;
		_lastInlineTypo[prefix] = step;
		const fxName = step !== defaultVal ? (fxMap[step] ?? null) : null;
		const { start: selStart, end: selEnd } = _savedCeSel;
		if (selStart >= selEnd) return;
		pushUndo();
		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);
		let plain = 0;
		const newSegs = [];
		for (const seg of segs) {
			const segStart = plain, segEnd = plain + seg.text.length;
			if (segEnd <= selStart || segStart >= selEnd) {
				newSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else {
				const overlapStart = Math.max(segStart, selStart), overlapEnd = Math.min(segEnd, selEnd);
				if (overlapStart > segStart) newSegs.push({ text: seg.text.slice(0, overlapStart - segStart), fxStack: [...seg.fxStack] });
				const newStack = seg.fxStack.filter(fx => !fx.startsWith(prefix));
				if (fxName) newStack.push(fxName);
				newSegs.push({ text: seg.text.slice(overlapStart - segStart, overlapEnd - segStart), fxStack: newStack });
				if (overlapEnd < segEnd) newSegs.push({ text: seg.text.slice(overlapEnd - segStart), fxStack: [...seg.fxStack] });
			}
			plain += seg.text.length;
		}
		const mergedSegs = [];
		for (const seg of newSegs) {
			if (!seg.text) continue;
			const last = mergedSegs[mergedSegs.length - 1];
			if (last && last.fxStack.join(',') === seg.fxStack.join(',')) last.text += seg.text;
			else mergedSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
		}
		const newMarkup = segmentsToMarkup(mergedSegs);
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(newMarkup)) inputEl.appendChild(node);
		try {
			const startPos = findDomPos(inputEl, selStart);
			const endPos = findDomPos(inputEl, selEnd);
			const newRange = document.createRange();
			newRange.setStart(startPos.node, startPos.offset);
			newRange.setEnd(endPos.node, endPos.offset);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(newRange);
			showTextFxBar = true;
		} catch {}
		value = newMarkup;
	}

	function applyInlineWidth(val) { applyInlineTypo(val, WDTH_STEPS, 100, WDTH_FX_MAP, 'wdth-'); }
	function applyInlineWeight(val) { applyInlineTypo(val, WGHT_STEPS, 400, WGHT_FX_MAP, 'wght-'); }
	function applyInlineSize(val) { applyInlineTypo(val, SZ_STEPS, 1.0, SZ_FX_MAP, 'sz-'); }

	function renderMarkup(markup) {
		if (!inputEl) return;
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(markup)) inputEl.appendChild(node);
		value = markup;
	}

	function onCeInput() {
		if (!inputEl) return;
		const newMarkup = serializeCe(inputEl);
		if (newMarkup !== value) {
			if (undoStack.length >= 50) undoStack.shift();
			undoStack.push(value);
			redoStack.length = 0;
		}
		value = newMarkup;
		if (!newMarkup) {
			messageFontSize = 1.0; messageFontWeight = 400; messageFontStretch = 100;
			_savedCeSel = null; _lastInlineTypo = {};
		}
	}

	function undo() {
		if (!undoStack.length || !inputEl) return;
		redoStack.push(value);
		const prev = undoStack.pop();
		renderMarkup(prev);
	}

	function redo() {
		if (!redoStack.length || !inputEl) return;
		undoStack.push(value);
		const next = redoStack.pop();
		renderMarkup(next);
	}

	function onCeCopy(e) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl) return;
		const range = sel.getRangeAt(0);
		if (!inputEl.contains(range.commonAncestorContainer)) return;
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(range.cloneContents());
		const outerFxStack = [];
		let cur = range.commonAncestorContainer;
		if (cur.nodeType === Node.TEXT_NODE) cur = cur.parentElement;
		while (cur && cur !== inputEl) {
			const fx = cur.dataset?.fx;
			if (fx) fx.split(' ').filter(f => FX_TO_CHAR[f]).forEach(f => outerFxStack.unshift(f));
			cur = cur.parentElement;
		}
		let rawMarkup = serializeCe(tempDiv);
		if (outerFxStack.length) {
			rawMarkup = outerFxStack.map(fx => FX_TO_CHAR[fx]).join('') + rawMarkup + FX_CLOSE_CHAR.repeat(outerFxStack.length);
		}
		const readable = unicodeToReadable(rawMarkup);
		e.preventDefault();
		e.clipboardData.setData('text/plain', readable);
		e.clipboardData.setData('text/x-eating-markup', rawMarkup);
	}

	function onCePaste(e) {
		e.preventDefault();
		// Three-tier paste source resolution. (1) Our own clipboard
		// MIME — set by onCeCopy on any FormattedInput, carries the raw
		// markup with EK / CE / TG / TGC tokens and PUA text-effect
		// chars in order. (2) `text/html` — fallback for content
		// copied from outside a FormattedInput (e.g. a chat message
		// bubble, where the user selects a span that includes inline
		// <img data-ek/data-ce/data-tg> elements). We parse it into a
		// detached DOM and run the same serializer, so the same
		// tokenization rules apply uniformly. (3) `text/plain` — last
		// resort. Lossy by definition; emote IMG/SPAN nodes vanish.
		let markup = e.clipboardData.getData('text/x-eating-markup');
		if (!markup) {
			const html = e.clipboardData.getData('text/html');
			if (html) {
				const parsed = new DOMParser().parseFromString(html, 'text/html');
				const fromHtml = serializeCe(parsed.body);
				// Only treat html as markup if it actually carries a
				// token; otherwise prefer the plain-text path to avoid
				// pulling in stray styling from arbitrary HTML sources.
				if (/\[(ek|ce|tg|tgc):/.test(fromHtml)) markup = fromHtml;
			}
		}
		const plain = markup || e.clipboardData.getData('text/plain') || '';
		if (!plain) return;
		pushUndo();
		const sel = window.getSelection();
		if (sel && sel.rangeCount) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			if (markup) {
				const nodes = ceMarkupToNodes(markup);
				const frag = document.createDocumentFragment();
				let lastNode;
				for (const n of nodes) { frag.appendChild(n); lastNode = n; }
				range.insertNode(frag);
				if (lastNode) {
					const r = document.createRange();
					r.setStartAfter(lastNode);
					r.collapse(true);
					sel.removeAllRanges();
					sel.addRange(r);
				}
			} else {
				const tn = document.createTextNode(plain);
				range.insertNode(tn);
				const r = document.createRange();
				r.setStartAfter(tn);
				r.collapse(true);
				sel.removeAllRanges();
				sel.addRange(r);
			}
		}
		value = serializeCe(inputEl);
	}

	function onKeydown(e) {
		if (singleLine && e.key === 'Enter') { e.preventDefault(); return; }
		if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); applyTextFx('bold'); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); applyTextFx('italic'); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'u') { e.preventDefault(); applyTextFx('underline'); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
	}
</script>

<div class="fi-wrap">
	<div class="fi-editor">
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="fi-ce"
			class:faux-caret={showExprPicker}
			role="textbox"
			aria-multiline={!singleLine}
			contenteditable="true"
			inputmode={showExprPicker ? 'none' : null}
			bind:this={inputEl}
			oninput={onCeInput}
			onkeydown={onKeydown}
			onmouseup={onCeSelect}
			onkeyup={onCeSelect}
			onblur={() => { setTimeout(() => { const ae = document.activeElement; if (!ae?.closest('.fi-wrap')) showTextFxBar = false; }, 120); }}
			oncopy={onCeCopy}
			onpaste={onCePaste}
			data-placeholder={placeholder}
		></div>
		<div class="fi-fmt-row" class:flush={collapseTools}>


				<button bind:this={exprBtnEl} class="fi-btn fi-btn-expr" class:active={showExprPicker}
					onmousedown={(e) => {
						e.preventDefault();
						const opening = !showExprPicker;
						showExprPicker = opening;
						// The sheet takes the keyboard's PLACE rather than sharing the
						// screen with it: blur sends the keyboard away, and inputmode
						// 'none' above stops it returning when focus comes back for
						// insertion. Without both, tapping this with the keyboard up
						// leaves two panels fighting over the bottom of the screen.
						if (opening) inputEl?.blur();
					}}
					title="Insert emoji / emote / sticker">
					<span class="msi msi-18" class:msi-fill={showExprPicker}>mood</span>
				</button>
				{#if showExprPicker}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="fi-backdrop" onclick={() => showExprPicker = false}></div>
					<div class="fi-expr-pop" use:popoverPos={{ anchor: exprBtnEl, side: 'top' }}>
						<ExpressionPicker
							inline
							onSelectEmoji={onPickerSelectEmoji}
							onInsertKitchen={onPickerInsertKitchen}
							onSelectGif={onPickerSelectGif}
							onInsertCustomEmoji={onPickerInsertCustomEmoji}
							onInsertReaction={onPickerInsertReaction}
							onInsertTgEmoji={onPickerInsertTgEmoji}
						/>
					</div>
				{/if}
			{#if tools}{@render tools()}{/if}
			{#if collapseTools}
				<button class="fi-btn fi-btn-more" class:active={showTools}
					onmousedown={(e) => { e.preventDefault(); showTools = !showTools; }}
					title="Formatting" aria-expanded={showTools}><span class="msi msi-18">text_format</span></button>
			{/if}
			<div class="fi-tools" class:collapsible={collapseTools} class:open={showTools}>
			<button class="fi-btn fi-btn-bold" onmousedown={(e) => { e.preventDefault(); applyTextFx('bold'); }} title="Bold (⌘B)"><b>B</b></button>
			<button class="fi-btn fi-btn-italic" onmousedown={(e) => { e.preventDefault(); applyTextFx('italic'); }} title="Italic (⌘I)"><i>I</i></button>
			<button class="fi-btn fi-btn-underline" onmousedown={(e) => { e.preventDefault(); applyTextFx('underline'); }} title="Underline (⌘U)"><u>U</u></button>
			<button class="fi-btn fi-btn-strike" onmousedown={(e) => { e.preventDefault(); applyTextFx('strike'); }} title="Strikethrough"><s>S</s></button>
			<div class="fi-color-wrap">
				<button bind:this={colorBtnEl} class="fi-btn fi-btn-color" class:active={showFormatPanel} onmousedown={(e) => { e.preventDefault(); showFormatPanel = !showFormatPanel; }} title="Text color">A</button>
				{#if showFormatPanel}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="fi-backdrop" onclick={() => showFormatPanel = false}></div>
					<div class="fi-color-pop" use:popoverPos={{ anchor: colorBtnEl, side: 'top' }}>
						<div class="fi-color-grid">
							{#each TEXT_COLORS as c}
								<button class="fi-swatch" style="background:{c.hex}" onmousedown={(e) => { e.preventDefault(); applyTextFx(c.name); showFormatPanel = false; }} title={c.name.replace('color-', '')}></button>
							{/each}
						</div>
						<button class="fi-rainbow-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('rainbow'); showFormatPanel = false; }}>Rainbow</button>
					</div>
				{/if}
			</div>
			<!-- Expression picker (emoji / kitchen / custom emotes /
			     Telegram animated stickers / reaction images). Same
			     ExpressionPicker the chat compose uses, so recents +
			     skin tone + last-tab choice are shared via its
			     localStorage keys. -->
			<div class="fi-expr-wrap">
			</div><!-- /.fi-tools -->
		</div><!-- /.fi-fmt-row -->
		</div>
	</div>

	{#if showTextFxBar}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fi-typo-bar" onfocusin={() => { showTextFxBar = true; }}>
			{#if !disableSize}
				<div class="fi-typo-row">
					<span class="fi-typo-label">Size</span>
					<input class="fi-typo-range" type="range" min="0.55" max="5" step="0.05"
						bind:value={messageFontSize}
						oninput={() => { if (_savedCeSel) { applyInlineSize(messageFontSize); showTextFxBar = true; } }} />
					<button class="fi-typo-reset" class:fi-reset-off={messageFontSize === 1.0} onmousedown={(e) => { e.preventDefault(); messageFontSize = 1.0; _lastInlineTypo['sz-'] = null; if (_savedCeSel) applyInlineSize(1.0); }}>↺</button>
				</div>
			{/if}
			<div class="fi-typo-row">
				<span class="fi-typo-label">Weight</span>
				<input class="fi-typo-range" type="range" min="100" max="700" step="50"
					bind:value={messageFontWeight}
					oninput={() => { if (_savedCeSel) { applyInlineWeight(messageFontWeight); showTextFxBar = true; } }} />
				<button class="fi-typo-reset" class:fi-reset-off={messageFontWeight === 400} onmousedown={(e) => { e.preventDefault(); messageFontWeight = 400; _lastInlineTypo['wght-'] = null; if (_savedCeSel) applyInlineWeight(400); }}>↺</button>
			</div>
			<div class="fi-typo-row">
				<span class="fi-typo-label">Width</span>
				<input class="fi-typo-range" type="range" min="25" max="150" step="1"
					bind:value={messageFontStretch}
					oninput={() => { if (_savedCeSel) { applyInlineWidth(messageFontStretch); showTextFxBar = true; } }} />
				<button class="fi-typo-reset" class:fi-reset-off={messageFontStretch === 100} onmousedown={(e) => { e.preventDefault(); messageFontStretch = 100; _lastInlineTypo['wdth-'] = null; if (_savedCeSel) applyInlineWidth(100); }}>↺</button>
			</div>
			<button class="fi-default-btn" onmousedown={(e) => {
				e.preventDefault();
				messageFontSize = 1.0; messageFontWeight = 400; messageFontStretch = 100;
				_lastInlineTypo = {};
				if (_savedCeSel) { applyInlineSize(1.0); applyInlineWeight(400); applyInlineWidth(100); }
			}}>Default</button>
		</div>
		<div class="fi-fx-bar">
			<div class="fi-fx-toggles">
				<button class="fi-layer-toggle" class:fi-layer-on={allowFxNesting} onmousedown={(e) => { e.preventDefault(); allowFxNesting = !allowFxNesting; }} title="Stack different effects on the same text">
					<span class="fi-toggle-track"><span class="fi-toggle-knob"></span></span>
					Layer
				</button>
				<button class="fi-layer-toggle" class:fi-layer-on={allowFxMultiply} onmousedown={(e) => { e.preventDefault(); allowFxMultiply = !allowFxMultiply; }} title="Apply the same effect multiple times on the same text">
					<span class="fi-toggle-track"><span class="fi-toggle-knob"></span></span>
					Multiply
				</button>
				<button class="fi-layer-toggle" class:fi-layer-on={fxSplitWords} onmousedown={(e) => { e.preventDefault(); fxSplitWords = !fxSplitWords; }} title="Apply effect to each word separately">
					<span class="fi-toggle-track"><span class="fi-toggle-knob"></span></span>
					Per word
				</button>
				<button class="fi-fx-close" onmousedown={(e) => { e.preventDefault(); showTextFxBar = false; }}>✕</button>
			</div>
			<div class="fi-fx-list">
				{#each TEXT_FXS as fx}
					<button class="fi-fx-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx(fx.name); }}>
						{#if fx.name === 'ripple' || fx.name === 'grow' || fx.name === 'shrink'}
							<!-- per-grapheme effects preview their own letter-by-letter stagger -->
							{@html [...fx.label].map((c, i) => `<span class="tfx tfx-${fx.name}" style="animation-delay:${(i * 0.08).toFixed(2)}s;display:inline-block">${c}</span>`).join('')}
						{:else}
							<span class="tfx tfx-{fx.name}">{fx.label}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.fi-wrap { display: flex; flex-direction: column; }
	.fi-editor {
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); transition: border-color 0.15s;
	}
	.fi-editor:focus-within { border-color: var(--ink, var(--ink)); }
	.fi-ce {
		padding: 0.6rem 0.85rem 0.35rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji'; font-optical-sizing: auto;
		font-size: 0.9rem; color: var(--ink, var(--ink));
		outline: none; max-height: 120px; overflow-y: auto;
		line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		min-height: calc(1.45em + 0.95rem); scrollbar-width: none;
	}
	.fi-ce::-webkit-scrollbar { display: none; }
	.fi-ce:empty::before {
		content: attr(data-placeholder);
		color: var(--muted-fg); pointer-events: none;
	}
	.fi-fmt-row { display: flex; align-items: center; gap: 0.1rem; padding: 0.2rem 0.5rem 0.3rem; border-top: 1px solid #ede9e3; }
	/* Chat's composer has no line between the editor and its tools — the box is
	   one control, and a rule across it reads as two stacked bars. Callers that
	   present like chat (collapseTools) get that; a form field keeps its
	   separator. Set here rather than overridden from outside, where it lost on
	   specificity to this very rule. */
	.fi-fmt-row.flush { border-top: none; }
	/* `display: contents` so the buttons remain flex children of the row rather
	   than a nested box — same technique chat's .fmt-tools uses. */
	.fi-tools { display: contents; }
	@media (max-width: 640px) {
		.fi-tools.collapsible { display: none; }
		.fi-tools.collapsible.open { display: contents; }
	}
	/* Suppressing the keyboard also takes iOS's caret, so the editor looks inert
	   while the picker is open. Draw a blinking stand-in at the insertion point —
	   the end, which is where the picker appends — as chat does. */
	.fi-ce.faux-caret::after {
		content: '';
		display: inline-block;
		width: 2px;
		height: 1.15em;
		margin-left: 1px;
		vertical-align: text-bottom;
		background: var(--accent, var(--ink));
		border-radius: 1px;
		animation: fi-faux-caret-blink 1.06s step-end infinite;
	}
	@keyframes fi-faux-caret-blink {
		0%, 50% { opacity: 1; }
		50.01%, 100% { opacity: 0; }
	}
	.fi-btn {
		display: flex; align-items: center; justify-content: center;
		width: 26px; height: 26px; flex-shrink: 0;
		border: none; border-radius: 6px;
		background: none; cursor: pointer; color: var(--ink, var(--ink)); opacity: 0.45;
		font-size: 0.85rem; line-height: 1; font-family: inherit;
		transition: opacity 0.15s, background 0.1s;
	}
	.fi-btn:hover, .fi-btn.active { opacity: 1; background: var(--surface-2); }
	.fi-btn-bold { font-weight: 700; }
	.fi-btn-italic { font-style: italic; font-weight: 600; }
	.fi-btn-underline { text-decoration: underline; text-underline-offset: 2px; }
	.fi-btn-strike { text-decoration: line-through; }
	.fi-btn-color {
		font-weight: 700; font-size: 0.8rem;
		text-decoration: underline; text-decoration-color: #e74c3c;
		text-decoration-thickness: 2px; text-underline-offset: 1px;
	}
	.fi-color-wrap { position: relative; flex-shrink: 0; }

	/* Expression picker popover. Mirrors the chat compose's
	   .compose-picker-pop positioning so the picker drops upward
	   above the toolbar with the same visual chrome (border, shadow,
	   rounded corners). Picker itself supplies its own width/height. */
	.fi-expr-wrap { position: relative; flex-shrink: 0; }
	.fi-btn-expr { color: var(--ink); }
	/* Position is owned by the popoverPos action — it flips above /
	   below and clamps to the viewport. We only declare z-index and
	   visual chrome here. */
	.fi-expr-pop {
		z-index: 50;
		/* Plain box-shadow instead of filter: drop-shadow. `filter`
		   creates a transformed containing block, which would turn
		   any `position: fixed` descendant (e.g. the EmojiPicker's
		   long-press variant popover) into `position: absolute`
		   relative to this wrapper — so a popover anchored at
		   viewport coordinates from getBoundingClientRect() lands
		   in the wrong spot and tracks scroll oddly. box-shadow has
		   the same visual weight for an opaque, rounded container. */
		box-shadow: 0 4px 18px rgba(0,0,0,0.14);
	}

	@media (max-width: 640px) {
		/* popoverPos docks this as a bottom sheet on a phone, but the rule that
		   sizes it lived only in chat's own copy — here it arrived with no height
		   and no background, so it rendered as a transparent, content-sized blob
		   over the compose. Same shape chat uses: open at the height the KEYBOARD
		   occupied (--kb-h-last), so swapping between them doesn't move anything,
		   and own the safe area the bar gives up. */
		/* Grabber drag rides a transform; the height var commits on release —
		   see ExpressionPicker's setDragExtra. */
		:global(html.expr-grow-dragging) .fi-expr-pop {
			transform: translateY(calc(-1 * var(--expr-grow-drag, 0px)));
			will-change: transform;
		}
		.fi-expr-pop {
			/* + var(--expr-grow): the grabber's pull-up gesture, same variable
			   the chat dock consumes. Outer min caps the expanded sheet. */
			height: calc(min(calc(min(var(--kb-h-last, 22rem), 58vh) + var(--expr-grow, 0px)), 86dvh) + env(safe-area-inset-bottom, 0px));
			padding-bottom: env(safe-area-inset-bottom, 0px);
			background: var(--paper);
			border-top: 1.5px solid var(--border);
			border-radius: 0;
			box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.18);
			overflow: hidden;
		}
		/* The picker fills the sheet rather than sitting at its natural height. */
		.fi-expr-pop > :global(*) { height: 100%; }
	}

	.fi-backdrop { position: fixed; inset: 0; z-index: 40; }
	.fi-color-pop {
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 50;
		padding: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; min-width: 152px;
	}
	.fi-color-grid { display: flex; gap: 0.3rem; flex-wrap: wrap; }
	.fi-swatch {
		width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
		border: 2px solid transparent; cursor: pointer;
		transition: transform 0.12s, border-color 0.12s;
	}
	.fi-swatch:hover { transform: scale(1.2); border-color: rgba(0,0,0,0.25); }
	.fi-rainbow-btn {
		background: none; border: 1.5px solid var(--border); border-radius: 6px;
		padding: 0.25rem 0.5rem; font-size: 0.78rem; font-family: inherit;
		cursor: pointer; text-align: left; color: var(--ink, var(--ink)); transition: background 0.1s;
	}
	.fi-rainbow-btn:hover { background: var(--surface-2); }

	/* Typo bar: sliders sit in aligned grid rows (label | slider | reset) —
	   the reset slot is always reserved so a slider doesn't jump sideways
	   when its ↺ appears; Default hangs off the end of the last row. */
	.fi-typo-bar {
		/* One slider per line — Size / Weight / Width stacked vertically so each
		   gets the full width for finer control (was auto-fit columns that put
		   them side by side on a wide composer). */
		display: flex;
		flex-direction: column;
		gap: 0.32rem;
		padding: 0.5rem 0.85rem;
		border-top: 1px solid var(--border); background: var(--surface-2);
	}
	.fi-typo-row {
		display: grid; grid-template-columns: 2.9rem 1fr 1.1rem;
		align-items: center; gap: 0.35rem; min-width: 0;
	}
	.fi-typo-label {
		font-size: 0.65rem; font-weight: 600; color: var(--muted-fg);
		text-transform: uppercase; letter-spacing: 0.03em;
	}
	.fi-typo-range { width: 100%; height: 3px; accent-color: var(--ink, var(--ink)); cursor: pointer; min-width: 0; }
	.fi-typo-reset {
		background: none; border: none; color: var(--muted-fg); font-size: 0.7rem;
		cursor: pointer; padding: 0; line-height: 1; width: 1.1rem;
		transition: color 0.1s;
	}
	.fi-typo-reset:hover { color: var(--ink, var(--ink)); }
	.fi-reset-off { visibility: hidden; }
	.fi-default-btn {
		align-self: flex-end; margin-top: 0.05rem;
		padding: 0.15rem 0.5rem; border: 1px solid var(--border); border-radius: 5px;
		background: none; font-family: inherit; font-size: 0.62rem; font-weight: 600;
		color: var(--muted-fg); cursor: pointer; white-space: nowrap;
		transition: background 0.1s, color 0.1s;
	}
	.fi-default-btn:hover { background: var(--surface-2); color: var(--ink, var(--ink)); }

	/* Fx bar: toggles get their own row (close pinned right), effect pills
	   wrap in a uniform grid below instead of jostling with the switches. */
	.fi-fx-bar {
		display: flex; flex-direction: column; gap: 0.4rem;
		padding: 0.4rem 0.85rem 0.5rem; background: var(--paper, #faf6ef); border-top: 1px solid var(--border);
	}
	.fi-fx-toggles { display: flex; align-items: center; gap: 1rem; }
	.fi-fx-list { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.fi-layer-toggle {
		display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;
		background: none; border: none; padding: 0; cursor: pointer;
		font-size: 0.72rem; font-weight: 600; color: var(--muted-fg); font-family: inherit;
		transition: color 0.15s;
	}
	.fi-layer-toggle:hover { color: var(--ink, var(--ink)); }
	.fi-layer-on { color: var(--ink, var(--ink)) !important; }
	.fi-toggle-track {
		position: relative; width: 2rem; height: 1.1rem; flex-shrink: 0;
		background: var(--border); border-radius: 999px; transition: background 0.2s;
	}
	.fi-layer-on .fi-toggle-track { background: var(--ink, var(--ink)); }
	.fi-toggle-knob {
		position: absolute; top: 0.15rem; left: 0.15rem;
		width: 0.8rem; height: 0.8rem;
		background: white; border-radius: 50%;
		transition: transform 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.18);
	}
	.fi-layer-on .fi-toggle-knob { transform: translateX(0.9rem); }
	.fi-fx-btn {
		padding: 0.18rem 0.5rem; background: var(--surface-2); border: 1.5px solid var(--border);
		border-radius: 5px; font-size: 0.76rem; font-weight: 600; color: var(--ink, var(--ink));
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		cursor: pointer; transition: background 0.1s;
	}
	.fi-fx-btn:hover { background: var(--ink, var(--ink)); color: var(--paper, #faf6ef); border-color: var(--ink, var(--ink)); }
	.fi-fx-bar :global(.tfx) { animation-iteration-count: infinite !important; }
	.fi-fx-close { margin-left: auto; background: none; border: none; font-size: 0.78rem; color: var(--muted-fg); cursor: pointer; padding: 0.1rem 0.25rem; line-height: 1; }
</style>
