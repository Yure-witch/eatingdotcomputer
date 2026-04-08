<script>
	import { onMount, onDestroy, tick, getContext } from 'svelte';
	import { db } from '$lib/firebase.js';
	import { ref, onChildAdded, onValue, off, query, limitToLast, set, remove } from 'firebase/database';
	import { normaliseMessage, buildUserMap, formatTime } from '$lib/chat.js';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import EmojiKitchen from '$lib/components/EmojiKitchen.svelte';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import { loadEmojiNames } from '$lib/emoji-names.js';
	import { initSemanticSearch, searchEmoji, cpToChar, onSemanticReady } from '$lib/emoji-semantic.js';

	let { data } = $props();

	const openSidebar = getContext('openSidebar');
	const userMap = buildUserMap(data.currentUser, data.users);
	const convId = data.channelId;

	let messages = $state([...data.history]);
	let input = $state('');
	let emojiNames = $state({});
	let sending = $state(false);
	let uploading = $state(false);
	let listEl = $state(null);
	let inputEl = $state(null);
	let fileInputEl = $state(null);
	let typingUsers = $state([]);
	let keyboardOpen = $state(false);
	let inputAreaHeight = $state(0);

	// Replies
	let replyingTo = $state(null); // { id, userId, userName, content }

	// Pending attachment (uploaded but not yet sent)
	let pendingAttachment = $state(null); // { url, filename, mimetype, size }

	// Reactions: { [msgId]: { [emoji]: { [userId]: true } } }
	// Seeded from Turso (archived messages) on page load; Firebase onValue merges live reactions on top
	let reactions = $state({ ...(data.initialReactions ?? {}) });

	// Emoji picker
	let pickerMsgId = $state(null);
	let pickerPos = $state({ x: 0, y: 0 });
	let showComposePicker = $state(false);
	let showKitchen = $state(false);

	// Message effects
	let messageEffect = $state(null); // null | 'rainbow' | 'hearts'
	let showEffectPanel = $state(false);

	// Font size (multiplier; 1.0 = default 0.9rem)
	let messageFontSize = $state(1.0);
	const jumboInput = $derived(jumboEmojiCount(input));
	let sizeSliderActive = $state(false);
	let thumbY = $state(0);
	let panelFixedLeft = $state(0);
	let panelFixedRight = $state(0);
	let panelFixedTop = $state(8);
	let panelHeight = $state(200);
	let downRange = $state(80);
	let sendWrapEl = $state(null);
	// non-reactive drag tracking:
	let _szArmed = false, _szTimer = null, _szInitY = 0, _panelTopY = 8, _szUpPx = 62;
	// Plain vars — updated every pointer event, never trigger Svelte re-renders
	let _szPendingFont = 1.0;
	let _szPillEl = null; // DOM ref to the pill (bound in template)
	let _szRafId = 0; // rAF handle for throttled font-size writes

	const SZ_MIN = 0.55, SZ_MAX = 20.0; // Small → Massive
	const SZ_PILL_H = 36;
	// Piecewise log scale: frac 0→SZ_MAX, 0.5→Normal(1.0), 1→SZ_MIN
	const fracToSz = (f) => {
		const c = Math.max(0, Math.min(1, f));
		return c <= 0.5 ? Math.pow(SZ_MAX, 1 - 2 * c) : Math.pow(SZ_MIN, (c - 0.5) * 2);
	};

	function getSizeLabel(sz) {
		if (sz < 0.85) return 'Small';
		if (sz < 1.15) return 'Normal';
		if (sz < 1.8)  return 'Large';
		if (sz < 3.5)  return 'XL';
		if (sz < 7.0)  return 'XXL';
		if (sz < 13.0) return 'Huge';
		return 'Massive';
	}

	// Message + text span effects
	const BUBBLE_FXS = [
		{ name: 'slam',      label: 'Slam',     icon: '💥' },
		{ name: 'loud',      label: 'Loud',     icon: '📢' },
		{ name: 'gentle',    label: 'Gentle',   icon: '🌸' },
		{ name: 'invisible', label: 'Invisible',icon: '🫥' },
		{ name: 'rainbow',   label: 'Rainbow',  icon: '🌈' },
		{ name: 'hearts',    label: 'Hearts',   icon: '💗' },
	];
	const SCREEN_FXS = [
		{ name: 'confetti',  label: 'Confetti', icon: '🎊' },
		{ name: 'fireworks', label: 'Fireworks',icon: '🎆' },
		{ name: 'balloons',  label: 'Balloons', icon: '🎈' },
	];
	const EXPRESSIVE_FXS = [
		{ name: 'shake',  label: 'Shake',  icon: '🫨' },
		{ name: 'bounce', label: 'Bounce', icon: '🏀' },
		{ name: 'wave',   label: 'Wave',   icon: '🌊' },
		{ name: 'jitter', label: 'Jitter', icon: '⚡' },
		{ name: 'big',    label: 'Big',    icon: '🔠' },
		{ name: 'small',  label: 'Small',  icon: '🔡' },
	];
	const TEXT_FXS = [
		{ name: 'shake',     label: 'Shake'     },
		{ name: 'wave',      label: 'Wave'      },
		{ name: 'ripple',    label: 'Ripple'    },
		{ name: 'jitter',    label: 'Jitter'    },
		{ name: 'big',       label: 'Big'       },
		{ name: 'small',     label: 'Small'     },
	];

	// Unicode PUA markers — invisible, won't conflict with typed text
	const FX_TO_CHAR = {
		bold: '\uE107', italic: '\uE108', rainbow: '\uE109',
		'color-red': '\uE110', 'color-orange': '\uE111', 'color-yellow': '\uE112',
		'color-green': '\uE113', 'color-teal': '\uE114', 'color-blue': '\uE115',
		'color-purple': '\uE116', 'color-pink': '\uE117',
		underline: '\uE118', strike: '\uE119', ripple: '\uE11A', shake: '\uE100', bounce: '\uE101', wave: '\uE102', nod: '\uE103', jitter: '\uE104', big: '\uE105', small: '\uE106'
	};
	const TEXT_COLORS = [
		{ name: 'color-red',    hex: '#e74c3c' },
		{ name: 'color-orange', hex: '#e67e22' },
		{ name: 'color-yellow', hex: '#d4ac0d' },
		{ name: 'color-green',  hex: '#27ae60' },
		{ name: 'color-teal',   hex: '#16a085' },
		{ name: 'color-blue',   hex: '#2980b9' },
		{ name: 'color-purple', hex: '#8e44ad' },
		{ name: 'color-pink',   hex: '#e91e8c' },
	];
	function escapeHtml(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	// Generate nested <span> HTML for layered effects.
	// Underline and strike are collapsed onto a single span with combined text-decoration-line
	// to guarantee both decorations render — nested text-decoration spans are unreliable cross-browser.
	function nestedFxHtml(fxStack, innerHtml, delay = null) {
		const decorFx = fxStack.filter(fx => fx === 'underline' || fx === 'strike');
		const animStack = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike');
		let html = innerHtml;
		if (decorFx.length) {
			const tdLine = decorFx.map(fx => fx === 'underline' ? 'underline' : 'line-through').join(' ');
			html = `<span class="tfx ${decorFx.map(fx => `tfx-${fx}`).join(' ')}" style="text-decoration-line:${tdLine};text-underline-offset:2px">${html}</span>`;
		}
		for (let i = animStack.length - 1; i >= 0; i--) {
			const fx = animStack[i];
			const style = delay ? ` style="animation-delay:${delay}"` : '';
			html = `<span class="tfx tfx-${fx}" data-fx="${fx}"${style}>${html}</span>`;
		}
		return html;
	}
	const CHAR_TO_FX = Object.fromEntries(Object.entries(FX_TO_CHAR).map(([k,v]) => [v,k]));
	const FX_CLOSE_CHAR = '\uE1FF';
	const FX_OPEN_CHARS = new Set(Object.values(FX_TO_CHAR));

	// Decode compact EK token [ek:DATE36:PARENT:CHILD] → gstatic URL
	function ekTokenToUrl(d36, parentCp, childCp) {
		const date = 20200000 + parseInt(d36, 36);
		const pad = date < 20220500;
		const fmt = cp => 'u' + cp.split('-').map(s => pad ? s.padStart(4, '0') : s).join('-u');
		return `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${fmt(parentCp)}/${fmt(parentCp)}_${fmt(childCp)}.png`;
	}

	// Convert legacy [fx]...[/fx] bracket markup → Unicode PUA
	function normalizeLegacyMarkup(text) {
		const names = Object.keys(FX_TO_CHAR).join('|');
		text = text.replace(new RegExp(`\\[(${names})\\]`, 'g'), (_, fx) => FX_TO_CHAR[fx] ?? _);
		text = text.replace(new RegExp(`\\[\\/(${names})\\]`, 'g'), () => FX_CLOSE_CHAR);
		return text;
	}

	// Convert Unicode PUA markers → readable [fx]...[/fx] (for clipboard)
	function unicodeToReadable(markup) {
		let result = '', stack = [];
		for (const ch of markup) {
			if (FX_OPEN_CHARS.has(ch)) { result += `[${CHAR_TO_FX[ch]}]`; stack.push(CHAR_TO_FX[ch]); }
			else if (ch === FX_CLOSE_CHAR) { const fx = stack.pop(); if (fx) result += `[/${fx}]`; }
			else result += ch;
		}
		return result;
	}

	// Strip all effect markers and EK tokens from text (for preview/reply bars)
	function stripMarkup(text) {
		const withoutEk = text.replace(/\[ek:[a-z0-9]+:[0-9a-f-]+:[0-9a-f-]+\]/gi, '');
		const normalized = normalizeLegacyMarkup(withoutEk);
		let result = '';
		for (const ch of normalized) {
			if (!FX_OPEN_CHARS.has(ch) && ch !== FX_CLOSE_CHAR) result += ch;
		}
		return result;
	}

	// Returns 1-3 if content is purely 1-3 emoji (no other text), 0 otherwise.
	// Strips effect markers first so emoji with text effects still qualify.
	// EK tokens count as emoji for sizing purposes.
	const _isEmojiSeg = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
	const _segmenter = new Intl.Segmenter();
	function jumboEmojiCount(content) {
		let ekCount = 0;
		const withoutEk = content.replace(/\[ek:[a-z0-9]+:[0-9a-f-]+:[0-9a-f-]+\]/gi, () => { ekCount++; return ''; });
		const plain = stripMarkup(withoutEk).trim();
		// Pure EK images only → treat each as an emoji
		if (!plain && ekCount > 0) return ekCount <= 3 ? ekCount : 0;
		// Mixed EK + text/emoji → not jumbo
		if (ekCount > 0) return 0;
		// Original logic for pure regular emoji
		if (!plain) return 0;
		const segs = [..._segmenter.segment(plain)].map(s => s.segment);
		if (segs.length > 3 || segs.length === 0) return 0;
		if (!segs.every(_isEmojiSeg)) return 0;
		return segs.length;
	}
	// Memoized wrappers — message content rarely changes so these avoid
	// re-running Intl.Segmenter and HTML generation on every render cycle.
	const _jumboCache = new Map();
	function jumboEmojiCountM(content) {
		let v = _jumboCache.get(content);
		if (v === undefined) { v = jumboEmojiCount(content); _jumboCache.set(content, v); }
		return v;
	}
	const _htmlCache = new Map();
	function contentHtmlM(text, split = true) {
		const key = (split ? '1' : '0') + text;
		let v = _htmlCache.get(key);
		if (v === undefined) { v = contentHtml(text, split); _htmlCache.set(key, v); }
		return v;
	}
	const JUMBO_SIZES = ['2.8rem', '2.2rem', '1.8rem'];
	function bubbleFontSize(content, fontSize) {
		if (fontSize && fontSize !== 1) return `${(fontSize * 0.9).toFixed(2)}rem`;
		const jc = jumboEmojiCountM(content);
		if (jc > 0) return JUMBO_SIZES[jc - 1];
		return null;
	}

	// Unicode markup → flat segments: [{ text: string, fxStack: string[] }, ...]
	function markupToSegments(markup) {
		const segs = [];
		let stack = [], textBuf = '';
		for (const ch of markup) {
			if (FX_OPEN_CHARS.has(ch)) {
				if (textBuf) { segs.push({ text: textBuf, fxStack: [...stack] }); textBuf = ''; }
				stack.push(CHAR_TO_FX[ch]);
			} else if (ch === FX_CLOSE_CHAR) {
				if (textBuf) { segs.push({ text: textBuf, fxStack: [...stack] }); textBuf = ''; }
				stack.pop();
			} else {
				textBuf += ch;
			}
		}
		if (textBuf) segs.push({ text: textBuf, fxStack: [...stack] });
		return segs;
	}

	// Flat segments → Unicode markup (closes/reopens efficiently)
	function segmentsToMarkup(segs) {
		let result = '', prevStack = [];
		for (const seg of segs) {
			let common = 0;
			while (common < prevStack.length && common < seg.fxStack.length && prevStack[common] === seg.fxStack[common]) common++;
			for (let i = prevStack.length; i > common; i--) result += FX_CLOSE_CHAR;
			for (let i = common; i < seg.fxStack.length; i++) result += FX_TO_CHAR[seg.fxStack[i]];
			result += seg.text;
			prevStack = seg.fxStack;
		}
		for (let i = prevStack.length; i > 0; i--) result += FX_CLOSE_CHAR;
		return result;
	}

	// Render content markup → HTML string in one pass, avoiding inter-segment DOM nodes
	// that cause newlines under white-space: pre-wrap when using {#each}.
	function contentHtmlText(text, split = true) {
		const segs = markupToSegments(normalizeLegacyMarkup(text));
		if (!segs.length) return escapeHtml(text);
		let globalWi = 0; // cross-segment word counter for stagger
		return segs.map(s => {
			if (!s.fxStack.length) return escapeHtml(s.text);
			// Ripple: always split per grapheme with 80ms stagger
			if (s.fxStack.includes('ripple')) {
				const graphemes = [..._segmenter.segment(s.text)].map(g => g.segment);
				const html = graphemes.map((g, i) =>
					/^\s+$/.test(g) ? escapeHtml(g) : nestedFxHtml(s.fxStack, escapeHtml(g), `${((globalWi + i) * 0.08).toFixed(2)}s`)
				).join('');
				globalWi += graphemes.filter(g => !/^\s+$/.test(g)).length;
				return html;
			}
			if (split) {
				// Pure-emoji segment: one span per grapheme, 80ms stagger
				const graphemes = [..._segmenter.segment(s.text)].map(g => g.segment);
				if (graphemes.length > 1 && graphemes.every(_isEmojiSeg)) {
					const html = graphemes.map((g, i) => nestedFxHtml(s.fxStack, escapeHtml(g), `${((globalWi + i) * 0.08).toFixed(2)}s`)).join('');
					globalWi += graphemes.length;
					return html;
				}
				// Multi-word segment: one span per word, spaces left unwrapped, 60ms stagger
				const tokens = s.text.split(/(\s+)/);
				if (tokens.length > 1) {
					return tokens.map(tok => /^\s+$/.test(tok) ? escapeHtml(tok) : nestedFxHtml(s.fxStack, escapeHtml(tok), `${(globalWi++ * 0.06).toFixed(2)}s`)).join('');
				}
				// Single word — still use globalWi so cross-segment stagger works
				return nestedFxHtml(s.fxStack, escapeHtml(s.text), `${(globalWi++ * 0.06).toFixed(2)}s`);
			}
			return nestedFxHtml(s.fxStack, escapeHtml(s.text));
		}).join('');
	}

	// Wrapper: splits on EK tokens, renders each as <img>, delegates text to contentHtmlText
	function contentHtml(text, split = true) {
		if (text.indexOf('[ek:') === -1) return contentHtmlText(text, split);
		const EK_RE = /\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/gi;
		const parts = [];
		let lastIdx = 0, m;
		while ((m = EK_RE.exec(text)) !== null) {
			if (m.index > lastIdx) parts.push(contentHtmlText(text.slice(lastIdx, m.index), split));
			const url = ekTokenToUrl(m[1], m[2], m[3]);
			parts.push(`<img class="ek-img" data-ek="${m[0]}" src="${url}" loading="lazy" alt="" />`);
			lastIdx = EK_RE.lastIndex;
		}
		if (lastIdx < text.length) parts.push(contentHtmlText(text.slice(lastIdx), split));
		return parts.join('');
	}

	let revealedInvisible = $state(new Set());
	function revealInvisible(id) { revealedInvisible = new Set([...revealedInvisible, id]); }
	let replayCounts = $state({});
	function replayEffect(id) { replayCounts = { ...replayCounts, [id]: (replayCounts[id] ?? 0) + 1 }; }
	let slamShockSet = $state(new Set());
	const _seenSlams = new Set();

	let showTextFxBar = $state(false);
	let allowFxNesting = $state(false);
	let allowFxMultiply = $state(false);
	let fxSplitWords = $state(true);
	let showFormatPanel = $state(false);
	let undoStack = [];
	let redoStack = [];

	// ── Emoji suggestions (semantic) ─────────────────────────────────────────
	let emojiSuggestions = $state([]); // [{ e, n }]
	let _suggDebounce = null;
	let _semanticPausedUntil = 0; // cooldown: skip embedding after a no-match result

	$effect(() => {
		const raw = input;
		clearTimeout(_suggDebounce);
		// Extract last word (strip PUA markup chars)
		const plain = raw.replace(/[\uE100-\uE1FF]/g, '');
		const word = plain.split(/\s+/).filter(Boolean).at(-1) ?? '';
		if (word.length < 2) { emojiSuggestions = []; return; }
		_suggDebounce = setTimeout(async () => {
			if (Date.now() < _semanticPausedUntil) return; // in cooldown, skip
			try {
				const hits = await searchEmoji(word, 6); // all ML in worker — main thread just receives results
				if (hits[0]?.score >= 0.4) {
					emojiSuggestions = hits.map(h => ({ e: cpToChar(h.cp), cp: h.cp }));
				} else {
					emojiSuggestions = [];
					_semanticPausedUntil = Date.now() + 1500;
				}
			} catch { emojiSuggestions = []; }
		}, 250);
	});

	// Walk the DOM tree and find the node+offset for a given plain-text character position
	function findDomPos(root, target) {
		let pos = 0;
		function walk(node) {
			if (node.nodeType === Node.TEXT_NODE) {
				const len = node.textContent.length;
				if (pos + len >= target) return { node, offset: target - pos };
				pos += len;
				return null;
			}
			if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG' && node.dataset.ek) {
				pos += 1;
				if (pos >= target) {
					const idx = Array.from(node.parentNode.childNodes).indexOf(node);
					return { node: node.parentNode, offset: idx + 1 };
				}
				return null;
			}
			for (const child of node.childNodes) { const r = walk(child); if (r) return r; }
			return null;
		}
		return walk(root) ?? { node: root, offset: root.childNodes.length };
	}

	// Serialize contenteditable DOM → Unicode markup string
	function serializeCe(el) {
		let result = '';
		for (const node of el.childNodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				result += node.textContent;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				if (node.tagName === 'IMG' && node.dataset.ek) {
					result += node.dataset.ek;
				} else if (node.dataset?.fx) {
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

	// Build a nested fx DOM node (innermost text → outermost span)
	function makeFxNode(fxStack, text, delay = null) {
		const decorFx = fxStack.filter(fx => fx === 'underline' || fx === 'strike');
		const animFx = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike');
		let innerNode = document.createTextNode(text);
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
		for (let i = animFx.length - 1; i >= 0; i--) {
			const fx = animFx[i];
			const span = document.createElement('span');
			span.className = `tfx tfx-${fx}`;
			span.dataset.fx = fx;
			if (delay) span.style.animationDelay = delay;
			span.appendChild(innerNode);
			innerNode = span;
		}
		return innerNode;
	}

	// Unicode markup → DOM nodes (nested spans — one per effect for composable CSS animations)
	function ceMarkupToNodesText(markup) {
		const segs = markupToSegments(normalizeLegacyMarkup(markup));
		const nodes = [];
		let globalWi = 0;
		for (const seg of segs) {
			if (seg.fxStack.length === 0) {
				nodes.push(document.createTextNode(seg.text));
			} else if (seg.fxStack.includes('ripple')) {
				// Ripple: always per-grapheme with 80ms stagger
				const graphemes = [..._segmenter.segment(seg.text)].map(g => g.segment);
				graphemes.forEach((g, i) => {
					if (/^\s+$/.test(g)) nodes.push(document.createTextNode(g));
					else nodes.push(makeFxNode(seg.fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`));
				});
				globalWi += graphemes.filter(g => !/^\s+$/.test(g)).length;
			} else if (fxSplitWords) {
				const graphemes = [..._segmenter.segment(seg.text)].map(g => g.segment);
				if (graphemes.length > 1 && graphemes.every(_isEmojiSeg)) {
					graphemes.forEach((g, i) => nodes.push(makeFxNode(seg.fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`)));
					globalWi += graphemes.length;
				} else {
					const tokens = seg.text.split(/(\s+)/);
					if (tokens.length > 1) {
						tokens.forEach(tok => {
							if (/^\s+$/.test(tok)) nodes.push(document.createTextNode(tok));
							else nodes.push(makeFxNode(seg.fxStack, tok, `${(globalWi++ * 0.06).toFixed(2)}s`));
						});
					} else {
						nodes.push(makeFxNode(seg.fxStack, seg.text, `${(globalWi++ * 0.06).toFixed(2)}s`));
					}
				}
			} else {
				nodes.push(makeFxNode(seg.fxStack, seg.text));
			}
		}
		return nodes;
	}

	// Unicode markup → DOM nodes, with EK token support
	function ceMarkupToNodes(markup) {
		if (markup.indexOf('[ek:') === -1) return ceMarkupToNodesText(markup);
		const EK_RE = /\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/gi;
		const nodes = [];
		let lastIdx = 0, m;
		while ((m = EK_RE.exec(markup)) !== null) {
			if (m.index > lastIdx) {
				for (const n of ceMarkupToNodesText(markup.slice(lastIdx, m.index))) nodes.push(n);
			}
			const img = document.createElement('img');
			img.src = ekTokenToUrl(m[1], m[2], m[3]);
			img.dataset.ek = m[0];
			img.className = 'ek-img ek-img-ce';
			img.setAttribute('contenteditable', 'false');
			img.setAttribute('alt', '');
			nodes.push(img);
			lastIdx = EK_RE.lastIndex;
		}
		if (lastIdx < markup.length) {
			for (const n of ceMarkupToNodesText(markup.slice(lastIdx))) nodes.push(n);
		}
		return nodes;
	}

	// Set CE content from markup
	function setCeInput(markup) {
		input = markup;
		if (!inputEl) return;
		inputEl.innerHTML = '';
		if (!markup) return;
		for (const node of ceMarkupToNodes(markup)) inputEl.appendChild(node);
		const range = document.createRange();
		range.selectNodeContents(inputEl);
		range.collapse(false);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	function onCeInput() {
		if (!inputEl) return;
		const newMarkup = serializeCe(inputEl);
		if (newMarkup !== input) {
			if (undoStack.length >= 50) undoStack.shift();
			undoStack.push(input);
			redoStack.length = 0;
		}
		input = newMarkup;
		onInput();
	}

	function onCeSelect() {
		const sel = window.getSelection();
		showTextFxBar = !!(sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode));
	}

	function applyTextFx(name) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl || !inputEl.contains(sel.anchorNode)) return;
		if (undoStack.length >= 50) undoStack.shift();
		undoStack.push(input);
		redoStack.length = 0;
		const selectedText = sel.toString();
		if (!selectedText) return;

		const preRange = document.createRange();
		preRange.setStart(inputEl, 0);
		preRange.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
		const selStart = preRange.toString().length;
		const selEnd = selStart + selectedText.length;

		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);

		const isColorFx = name.startsWith('color-') || name === 'rainbow';
		const isFormatFx = name === 'bold' || name === 'italic' || name === 'underline' || name === 'strike' || isColorFx;
		const isFmtFx = (fx) => fx === 'bold' || fx === 'italic' || fx === 'underline' || fx === 'strike' || fx === 'rainbow' || fx.startsWith('color-');

		// Check if every selected segment already has this effect → toggle off
		let p0 = 0, allHaveIt = true;
		for (const seg of segs) {
			const sEnd = p0 + seg.text.length;
			if (sEnd > selStart && p0 < selEnd && !seg.fxStack.includes(name)) { allHaveIt = false; break; }
			p0 += seg.text.length;
		}

		let plain = 0;
		const newSegs = [];
		for (const seg of segs) {
			const segStart = plain;
			const segEnd = plain + seg.text.length;

			if (segEnd <= selStart || segStart >= selEnd) {
				newSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else {
				const overlapStart = Math.max(segStart, selStart);
				const overlapEnd = Math.min(segEnd, selEnd);
				if (overlapStart > segStart) {
					newSegs.push({ text: seg.text.slice(0, overlapStart - segStart), fxStack: [...seg.fxStack] });
				}
				let newStack;
				if (allHaveIt) {
					// Toggle off: remove this effect from the selection
					newStack = seg.fxStack.filter(fx => fx !== name);
				} else if (allowFxNesting || isFormatFx) {
					newStack = [...seg.fxStack];
					// For color/rainbow, replace any existing color first
					if (isColorFx) newStack = newStack.filter(fx => !fx.startsWith('color-') && fx !== 'rainbow');
					if (allowFxMultiply || !newStack.includes(name)) newStack.push(name);
				} else {
					// Keep formatting effects, replace any existing animation effect
					newStack = seg.fxStack.filter(isFmtFx);
					newStack.push(name);
				}
				newSegs.push({ text: seg.text.slice(overlapStart - segStart, overlapEnd - segStart), fxStack: newStack });
				if (overlapEnd < segEnd) {
					newSegs.push({ text: seg.text.slice(overlapEnd - segStart), fxStack: [...seg.fxStack] });
				}
			}
			plain += seg.text.length;
		}

		// Merge adjacent segments with same fxStack, remove empties
		const mergedSegs = [];
		for (const seg of newSegs) {
			if (!seg.text) continue;
			const last = mergedSegs[mergedSegs.length - 1];
			if (last && last.fxStack.join(',') === seg.fxStack.join(',')) {
				last.text += seg.text;
			} else {
				mergedSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			}
		}

		const newMarkup = segmentsToMarkup(mergedSegs);
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(newMarkup)) inputEl.appendChild(node);

		// Restore selection over the same plain-text range so the bar stays visible
		const startPos = findDomPos(inputEl, selStart);
		const endPos = findDomPos(inputEl, selEnd);
		const newRange = document.createRange();
		newRange.setStart(startPos.node, startPos.offset);
		newRange.setEnd(endPos.node, endPos.offset);
		sel.removeAllRanges();
		sel.addRange(newRange);

		input = newMarkup;
		inputEl.focus();
	}

	function onCeCopy(e) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl) return;
		const range = sel.getRangeAt(0);
		if (!inputEl.contains(range.commonAncestorContainer)) return;
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(range.cloneContents());
		const readable = unicodeToReadable(serializeCe(tempDiv));
		if (readable !== sel.toString()) {
			e.clipboardData.setData('text/plain', readable);
			e.preventDefault();
		}
	}

	function onCePaste(e) {
		e.preventDefault();
		const pastedText = e.clipboardData.getData('text/plain');
		if (!pastedText || !inputEl) return;

		// Get caret offset and selection length as plain-text positions
		let caretOffset = 0;
		let selLength = 0;
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0 && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			const preRange = document.createRange();
			preRange.setStart(inputEl, 0);
			preRange.setEnd(range.startContainer, range.startOffset);
			caretOffset = preRange.toString().length;
			selLength = range.toString().length;
		}

		// Operate entirely at markup level — avoids inserting DOM nodes inside existing tfx spans
		// which would double/triple-nest effects on repeated paste
		const currentMarkup = serializeCe(inputEl);
		const pastedMarkup = normalizeLegacyMarkup(pastedText);
		const pastedSegs = markupToSegments(pastedMarkup);
		const pastedPlainLen = pastedSegs.reduce((sum, s) => sum + s.text.length, 0);

		const currentSegs = markupToSegments(currentMarkup);
		const deleteEnd = caretOffset + selLength;
		const beforeSegs = [], afterSegs = [];
		let pos = 0;
		for (const seg of currentSegs) {
			const segStart = pos, segEnd = pos + seg.text.length;
			if (segEnd <= caretOffset) {
				beforeSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else if (segStart >= deleteEnd) {
				afterSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else {
				if (segStart < caretOffset)
					beforeSegs.push({ text: seg.text.slice(0, caretOffset - segStart), fxStack: [...seg.fxStack] });
				if (segEnd > deleteEnd)
					afterSegs.push({ text: seg.text.slice(deleteEnd - segStart), fxStack: [...seg.fxStack] });
			}
			pos = segEnd;
		}

		const newMarkup = segmentsToMarkup([...beforeSegs, ...pastedSegs, ...afterSegs]);
		input = newMarkup;
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(newMarkup)) inputEl.appendChild(node);

		// Place cursor after pasted content
		const newCaret = caretOffset + pastedPlainLen;
		const domPos = findDomPos(inputEl, newCaret);
		const newRange = document.createRange();
		newRange.setStart(domPos.node, domPos.offset);
		newRange.collapse(true);
		const newSel = window.getSelection();
		newSel?.removeAllRanges();
		newSel?.addRange(newRange);
	}

	// Copy from message bubbles: cloneContents preserves partial spans with data-fx, serialize them.
	// When the selection is entirely within one tfx span, that span is the commonAncestorContainer
	// and is NOT included in cloneContents — walk up from it to collect any wrapping fx spans.
	function onMsgListCopy(e) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed) return;
		const range = sel.getRangeAt(0);

		// Collect ancestor tfx spans that wrap the entire selection
		const outerFxStack = [];
		let cur = range.commonAncestorContainer;
		if (cur.nodeType === Node.TEXT_NODE) cur = cur.parentElement;
		while (cur && cur !== listEl && cur !== document.body) {
			if (cur.dataset?.fx) outerFxStack.unshift(cur.dataset.fx);
			cur = cur.parentElement;
		}

		const tempDiv = document.createElement('div');
		tempDiv.appendChild(range.cloneContents());
		let markup = serializeCe(tempDiv);

		// Wrap with outer effects (those whose span was the ancestor container, not in the clone)
		if (outerFxStack.length > 0) {
			markup = outerFxStack.map(fx => FX_TO_CHAR[fx] ?? '').join('') + markup + FX_CLOSE_CHAR.repeat(outerFxStack.length);
		}

		const readable = unicodeToReadable(markup);
		if (readable !== sel.toString()) {
			e.clipboardData.setData('text/plain', readable);
			e.preventDefault();
		}
	}

	function onSendDown(e) {
		_szInitY = e.clientY;
		_szTimer = setTimeout(() => {
			_szArmed = true;
			sizeSliderActive = true;
			if (sendWrapEl) {
				const rect = sendWrapEl.getBoundingClientRect();
				_szUpPx = Math.min(200, Math.max(20, _szInitY - 8));
				_panelTopY = _szInitY - _szUpPx;
				panelFixedTop = _panelTopY;
				panelFixedLeft = rect.left;
				panelFixedRight = window.innerWidth - rect.right;
				panelHeight = window.innerHeight - 3 - _panelTopY;
				downRange = Math.max(20, window.innerHeight - 3 - _szInitY);
			}
			_szPendingFont = 1.0;
			messageFontSize = 1.0;
			// Contain layout during drag: font-size changes stay local, don't reflow ancestors
			if (inputEl) inputEl.style.contain = 'layout';
		}, 380);
	}

	// Quick release before timer fires — just send normally
	function onSendQuickUp() {
		if (_szArmed) { onSendUpArmed(); return; }
		clearTimeout(_szTimer);
		if (!sending && !uploading && (input.trim() || pendingAttachment)) send();
	}

	// Called from send-wrap + sz-capture overlay
	function onSendMove(e) {
		if (!sizeSliderActive) return;
		const dy = e.clientY - _szInitY;
		const cursorInPanel = e.clientY - _panelTopY;
		const newThumb = Math.max(0, Math.min(panelHeight - SZ_PILL_H, cursorInPanel - SZ_PILL_H / 2));
		if (dy >= 0) {
			const t = Math.min(1, dy / downRange);
			_szPendingFont = Math.max(SZ_MIN, fracToSz(0.5 + 0.5 * t));
		} else {
			const t = Math.max(-1, dy / _szUpPx);
			_szPendingFont = Math.min(SZ_MAX, fracToSz(0.5 + 0.5 * t));
		}
		// Pill: synchronous, no layout
		if (_szPillEl) {
			_szPillEl.style.top = newThumb + 'px';
			_szPillEl.textContent = getSizeLabel(_szPendingFont);
		}
		// font-size: throttled to rAF rate; contained so reflow stays local (no ancestor cascade)
		cancelAnimationFrame(_szRafId);
		_szRafId = requestAnimationFrame(() => {
			if (!sizeSliderActive || !inputEl) return;
			inputEl.style.fontSize = _szPendingFont !== 1.0 ? `${(_szPendingFont * 0.9).toFixed(2)}rem` : '';
		});
	}

	function onSendUpArmed() {
		cancelAnimationFrame(_szRafId);
		_szArmed = false;
		sizeSliderActive = false;
		// Remove containment before committing final size so the bar can properly resize
		if (inputEl) { inputEl.style.contain = ''; inputEl.style.fontSize = ''; }
		messageFontSize = (_szPendingFont > 0.92 && _szPendingFont < 1.08) ? 1.0 : _szPendingFont;
	}

	function onSendCancel() {
		cancelAnimationFrame(_szRafId);
		clearTimeout(_szTimer);
		_szArmed = false;
		sizeSliderActive = false;
		if (inputEl) { inputEl.style.contain = ''; inputEl.style.fontSize = ''; }
		messageFontSize = 1.0;
	}

	let _cancelFpsLoop = () => {};

	// Hearts canvas particle system
	let heartsCanvas = $state(null);
	let heartsCtx = null;
	let heartParticles = [];
	let heartsAnimId = null;
	let _heartBubbles = [];
	let _heartBubbleTs = 0;

	function startHeartsLoop() {
		if (heartsAnimId || !heartsCtx) return;
		heartsAnimId = requestAnimationFrame(heartsLoop);
	}

	function heartsLoop() {
		const _t0 = performance.now();
		const canvas = heartsCanvas;
		const ctx = heartsCtx;
		if (!canvas || !ctx) { heartsAnimId = null; return; }

		if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
		if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Cache bubble rects — refresh at most once per second to avoid
		// querySelectorAll + getBoundingClientRect on every 60 FPS frame.
		const now = performance.now();
		if (now - _heartBubbleTs > 1000) {
			_heartBubbles = [...document.querySelectorAll('.bubble.fx-hearts')].map(b => b.getBoundingClientRect());
			_heartBubbleTs = now;
		}
		const bubbles = _heartBubbles;

		for (const r of bubbles) {
			if (Math.random() < 0.05) {
				heartParticles.push({
					x: r.left + r.width * 0.1 + Math.random() * r.width * 0.8,
					y: r.top + r.height * 0.3 + Math.random() * r.height * 0.5,
					vx: (Math.random() - 0.5) * 1.5,
					vy: -(0.3 + Math.random() * 1.6),
					alpha: 0.7 + Math.random() * 0.3,
					size: 9 + Math.random() * 14
				});
			}
		}

		ctx.fillStyle = '#e8566e';
		heartParticles = heartParticles.filter(p => p.alpha > 0.03);
		for (const p of heartParticles) {
			p.x += p.vx;
			p.y += p.vy;
			p.vx *= 0.995;
			p.vy *= 0.992;
			p.alpha *= 0.982;
			ctx.globalAlpha = p.alpha;
			ctx.font = `${p.size}px serif`;
			ctx.fillText('♥', p.x, p.y);
		}
		ctx.globalAlpha = 1;

		const _dur = performance.now() - _t0;
		if (_dur > 8) console.warn('[perf:hearts]', _dur.toFixed(1) + 'ms');

		if (bubbles.length > 0 || heartParticles.length > 0) {
			heartsAnimId = requestAnimationFrame(heartsLoop);
		} else {
			heartsAnimId = null;
		}
	}

	$effect(() => {
		if (messages.some(m => m.fx === 'hearts') || messageEffect === 'hearts') startHeartsLoop();
	});

	// Screen effects
	const _seenScreenFx = new Set();
	$effect(() => {
		for (const m of messages) {
			if (SCREEN_FXS.some(f => f.name === m.fx) && !_seenScreenFx.has(m.id) && !m.pending) {
				_seenScreenFx.add(m.id);
				if (Date.now() - m.createdAt < 10000) setTimeout(() => playScreenEffect(m.fx), 80);
			}
		}
	});
	$effect(() => {
		for (const m of messages) {
			if (m.fx === 'slam' && !m.pending && !_seenSlams.has(m.id)) {
				_seenSlams.add(m.id);
				const idx = messages.findIndex(x => x.id === m.id);
				const shockIds = new Set(messages.slice(Math.max(0, idx - 8), idx).map(x => x.id));
				slamShockSet = new Set([...slamShockSet, ...shockIds]);
				setTimeout(() => { slamShockSet = new Set([...slamShockSet].filter(id => !shockIds.has(id))); }, 750);
			}
		}
	});

	function playScreenEffect(type) {
		if (!heartsCanvas || !heartsCtx) return;
		if (heartsCanvas.width !== window.innerWidth) heartsCanvas.width = window.innerWidth;
		if (heartsCanvas.height !== window.innerHeight) heartsCanvas.height = window.innerHeight;
		if (type === 'confetti') _playConfetti();
		else if (type === 'fireworks') _playFireworks();
		else if (type === 'balloons') _playBalloons();
	}

	function _playConfetti() {
		const ctx = heartsCtx, W = heartsCanvas.width, H = heartsCanvas.height;
		const COLS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9a3c'];
		const ps = Array.from({length: 140}, () => ({
			x: Math.random() * W, y: -20 - Math.random() * 80,
			vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4,
			color: COLS[Math.floor(Math.random() * COLS.length)],
			w: 7 + Math.random() * 7, h: 4 + Math.random() * 4,
			angle: Math.random() * Math.PI * 2, va: (Math.random() - 0.5) * 0.14,
		}));
		function tick() {
			ctx.clearRect(0, 0, W, H);
			let alive = false;
			for (const p of ps) {
				p.x += p.vx; p.y += p.vy; p.vy += 0.07; p.angle += p.va;
				if (p.y < H + 20) alive = true;
				ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
				ctx.fillStyle = p.color; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
				ctx.restore();
			}
			if (alive) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
		}
		requestAnimationFrame(tick);
	}

	function _playFireworks() {
		const ctx = heartsCtx, W = heartsCanvas.width, H = heartsCanvas.height;
		const COLS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9a3c','#fff'];
		let ps = [];
		const launches = Array.from({length: 6}, (_, i) => ({ delay: i * 380, done: false }));
		const t0 = Date.now();
		function tick() {
			const elapsed = Date.now() - t0;
			ctx.clearRect(0, 0, W, H);
			for (const l of launches) {
				if (!l.done && elapsed >= l.delay) {
					l.done = true;
					const cx = 0.15*W + Math.random()*0.7*W, cy = 0.1*H + Math.random()*0.45*H;
					const col = COLS[Math.floor(Math.random()*COLS.length)];
					for (let j = 0; j < 50; j++) {
						const a = (j/50)*Math.PI*2, spd = 2 + Math.random()*5;
						ps.push({ x: cx, y: cy, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, alpha: 1, color: col });
					}
				}
			}
			ps = ps.filter(p => p.alpha > 0.02);
			for (const p of ps) {
				p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.96; p.vy *= 0.96; p.alpha -= 0.015;
				ctx.globalAlpha = p.alpha; ctx.fillStyle = p.color;
				ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2); ctx.fill();
			}
			ctx.globalAlpha = 1;
			if (ps.length > 0 || launches.some(l => !l.done)) requestAnimationFrame(tick);
			else ctx.clearRect(0, 0, W, H);
		}
		requestAnimationFrame(tick);
	}

	function _playBalloons() {
		const ctx = heartsCtx, W = heartsCanvas.width, H = heartsCanvas.height;
		const COLS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9a3c','#ff6eb4'];
		const bs = Array.from({length: 22}, (_, i) => ({
			x: 0.05*W + Math.random()*0.9*W, y: H + 30 + i * 18,
			vy: -(1.5 + Math.random()*2), vx: (Math.random()-0.5)*0.4,
			color: COLS[Math.floor(Math.random()*COLS.length)],
			r: 18 + Math.random()*14, sway: Math.random()*Math.PI*2, sw: 0.018 + Math.random()*0.02,
		}));
		function tick() {
			ctx.clearRect(0, 0, W, H);
			let alive = false;
			for (const b of bs) {
				b.y += b.vy; b.sway += b.sw; b.x += Math.sin(b.sway)*0.6;
				if (b.y > -b.r * 2) alive = true;
				ctx.fillStyle = b.color;
				ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r*0.72, b.r, 0, 0, Math.PI*2); ctx.fill();
				ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
				ctx.beginPath(); ctx.moveTo(b.x, b.y + b.r); ctx.lineTo(b.x + Math.sin(b.sway)*6, b.y + b.r + 28); ctx.stroke();
			}
			if (alive) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
		}
		requestAnimationFrame(tick);
	}

	function insertEmoji(emoji) {
		if (!inputEl) { input += emoji; return; }
		inputEl.focus();
		const sel = window.getSelection();
		const textNode = document.createTextNode(emoji);
		if (sel && sel.rangeCount > 0 && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(textNode);
			range.setStartAfter(textNode);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
		} else {
			inputEl.appendChild(textNode);
			const range = document.createRange();
			range.setStartAfter(textNode);
			range.collapse(true);
			sel?.removeAllRanges();
			sel?.addRange(range);
		}
		input = serializeCe(inputEl);
	}

	function insertEkToken(token) {
		const m = token.match(/^\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]$/i);
		if (!m) return;
		if (!inputEl) { input += token; return; }
		inputEl.focus();
		const img = document.createElement('img');
		img.src = ekTokenToUrl(m[1], m[2], m[3]);
		img.dataset.ek = token;
		img.className = 'ek-img ek-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', '');
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0 && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(img);
			range.setStartAfter(img);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
		} else {
			inputEl.appendChild(img);
			const range = document.createRange();
			range.setStartAfter(img);
			range.collapse(true);
			sel?.removeAllRanges();
			sel?.addRange(range);
		}
		input = serializeCe(inputEl);
	}


	let firebaseRef, typingRef, reactionsRef;
	let typingTimer;

	let userScrolledUp = false;

	function scrollToBottom() {
		tick().then(() => {
			if (!listEl) return;
			listEl.scrollTop = listEl.scrollHeight;
			userScrolledUp = false;
		});
	}

	// Called from image onload — scrolls only if user hasn't manually scrolled up
	function scrollIfNearBottom() {
		if (!userScrolledUp && listEl) listEl.scrollTop = listEl.scrollHeight;
	}

	function onListScroll() {
		if (!listEl) return;
		const dist = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
		userScrolledUp = dist > 80;
	}

	function scrollToMessage(id) {
		const el = listEl?.querySelector(`[data-msg-id="${id}"]`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function markRead() {
		const uid = data.currentUser.id;
		set(ref(db, `lastRead/${uid}/${convId}`), Date.now());
		set(ref(db, `unreadCounts/${uid}/${convId}`), 0);
	}

	function clearTyping() {
		clearTimeout(typingTimer);
		remove(ref(db, `typing/${convId}/${data.currentUser.id}`));
	}

	function startReply(msg) {
		replyingTo = { id: msg.id, userId: msg.userId, userName: msg.userName, content: msg.content };
		inputEl?.focus();
	}

	function openPicker(msgId, e) {
		if (pickerMsgId === msgId) { pickerMsgId = null; return; }
		const rect = e.currentTarget.getBoundingClientRect();
		const pw = 264, ph = 192;
		let x = rect.left;
		let y = rect.top - ph - 8;
		if (x + pw > window.innerWidth - 8) x = window.innerWidth - pw - 8;
		if (y < 8) y = rect.bottom + 8;
		pickerPos = { x, y };
		pickerMsgId = msgId;
	}

	let kebabOpenId = $state(null);
	let editingMsgId = $state(null);
	let editContent = $state('');
	let starredIds = $state(new Set(data.starredMessageIds ?? []));

	function startEdit(msg) {
		editingMsgId = msg.id;
		editContent = unicodeToReadable(normalizeLegacyMarkup(msg.content));
	}

	async function saveEdit() {
		const msgId = editingMsgId;
		const content = editContent.trim();
		if (!content || !msgId) { editingMsgId = null; return; }
		editingMsgId = null;
		messages = messages.map((m) => m.id === msgId ? { ...m, content, edited: true } : m);
		await fetch('/api/chat/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, conversationId: convId, content })
		}).catch(() => {});
	}

	async function toggleStar(msg) {
		const wasStarred = starredIds.has(msg.id);
		starredIds = new Set(wasStarred
			? [...starredIds].filter((id) => id !== msg.id)
			: [...starredIds, msg.id]);
		await fetch('/api/chat/star', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				messageId: msg.id,
				conversationId: convId,
				snapshot: { content: msg.content, authorName: msg.userName, authorId: msg.userId, attachment: msg.attachment ?? null, convName: convId }
			})
		}).catch(() => {});
	}

	async function deleteMessage(msg) {
		messages = messages.filter((m) => m.id !== msg.id);
		await fetch('/api/chat/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msg.id, conversationId: convId, authorId: msg.userId })
		}).catch(() => {});
	}

	async function toggleReaction(msgId, emoji) {
		const uid = data.currentUser.id;
		const alreadyReacted = !!reactions[msgId]?.[emoji]?.[uid];

		// Snapshot scroll position before the optimistic update adds/removes DOM height
		const scrollHeightBefore = listEl?.scrollHeight ?? 0;
		const scrollTopBefore = listEl?.scrollTop ?? 0;

		// Optimistic local update so chips appear immediately
		const curMsg = reactions[msgId] ?? {};
		const curEmoji = curMsg[emoji] ?? {};
		const newEmoji = alreadyReacted
			? Object.fromEntries(Object.entries(curEmoji).filter(([k]) => k !== uid))
			: { ...curEmoji, [uid]: true };
		reactions = { ...reactions, [msgId]: { ...curMsg, [emoji]: newEmoji } };

		// After Svelte renders, compensate scrollTop by the height change so the
		// visible content doesn't jump when a new reaction row appears
		await tick();
		if (listEl) {
			const delta = listEl.scrollHeight - scrollHeightBefore;
			if (delta !== 0) listEl.scrollTop = scrollTopBefore + delta;
		}

		// Always route through the server API — uses firebase-admin which bypasses security rules
		await fetch('/api/chat/react', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, emoji, conversationId: convId, type: 'channel' })
		});
	}


	// Clamp reaction tooltip within viewport, accounting for the sidebar
	function positionReactionTooltip(e) {
		const chip = e.currentTarget;
		const tooltip = chip.querySelector('.reaction-tooltip');
		if (!tooltip) return;
		// Reset so CSS default is active before measuring
		tooltip.style.left = '';
		tooltip.style.transform = '';
		// CSS :hover is already active — tooltip is display:flex — measure it
		const chipRect = chip.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const tooltipW = tooltipRect.width;
		// Left bound: sidebar right edge + 10px margin
		const sidebar = document.querySelector('.global-sidebar');
		const sidebarW = sidebar ? sidebar.getBoundingClientRect().width : 0;
		const leftBound = sidebarW + 10;
		const rightBound = window.innerWidth - 10;
		// Centered position in viewport coordinates
		const centeredLeft = chipRect.left + chipRect.width / 2 - tooltipW / 2;
		// Clamp
		const clampedLeft = Math.max(leftBound, Math.min(centeredLeft, rightBound - tooltipW));
		// Convert viewport-left → offset relative to chip (positioned parent)
		tooltip.style.left = (clampedLeft - chipRect.left) + 'px';
		tooltip.style.transform = 'none';
	}

	onMount(() => {
		// ── Performance monitoring ─────────────────────────────────────────────
		// Long task observer — fires when any main-thread task takes >50 ms
		if (typeof PerformanceObserver !== 'undefined') {
			try {
				new PerformanceObserver(list => {
					for (const e of list.getEntries()) {
						console.warn('[perf:longtask]', Math.round(e.duration) + 'ms', e.attribution?.[0]?.name ?? '');
					}
				}).observe({ type: 'longtask', buffered: true });
			} catch {}
		}
		// FPS counter — logs whenever FPS drops below 55
		let _fpsCnt = 0, _fpsLast = performance.now(), _fpsRafId = 0;
		const _fpsLoop = (ts) => {
			_fpsCnt++;
			if (ts - _fpsLast >= 1000) {
				const fps = Math.round(_fpsCnt * 1000 / (ts - _fpsLast));
				if (fps < 55) console.warn('[perf:fps]', fps + 'fps');
				_fpsCnt = 0; _fpsLast = ts;
			}
			_fpsRafId = requestAnimationFrame(_fpsLoop);
		};
		_fpsRafId = requestAnimationFrame(_fpsLoop);
		// Store cleanup fn so onDestroy can cancel the loop
		_cancelFpsLoop = () => cancelAnimationFrame(_fpsRafId);
		// ──────────────────────────────────────────────────────────────────────

		markRead();
		scrollToBottom();
		loadEmojiNames().then(m => { emojiNames = m; });
		initSemanticSearch();
		document.addEventListener('selectionchange', onCeSelect);
		if (heartsCanvas) {
			heartsCanvas.width = window.innerWidth;
			heartsCanvas.height = window.innerHeight;
			heartsCtx = heartsCanvas.getContext('2d');
			if (messages.some(m => m.fx === 'hearts')) startHeartsLoop();
		}

		firebaseRef = query(ref(db, `channels/${convId}/messages`), limitToLast(200));
		onChildAdded(firebaseRef, (snap) => {
			const _t0 = performance.now();
			const msg = normaliseMessage(snap.key, snap.val(), userMap);
			if (!messages.find((m) => m.id === msg.id)) {
				messages = [...messages, msg];
				scrollToBottom();
				markRead();
			}
			const _dur = performance.now() - _t0;
			if (_dur > 4) console.warn('[perf:msg]', _dur.toFixed(1) + 'ms');
		});

		typingRef = ref(db, `typing/${convId}`);
		onValue(typingRef, (snap) => {
			if (!snap.exists()) { typingUsers = []; return; }
			const now = Date.now();
			typingUsers = Object.entries(snap.val())
				.filter(([uid, v]) => uid !== data.currentUser.id && (now - (v.ts ?? 0)) < 5000)
				.map(([, v]) => v.name);
		});

		reactionsRef = ref(db, `channels/${convId}/reactions`);
		onValue(reactionsRef, (snap) => {
			const _t0 = performance.now();
			const fbReactions = snap.exists() ? snap.val() : {};
			const base = data.initialReactions ?? {};
			// Deep merge per message + per emoji: Turso base → optimistic state → Firebase.
			const merged = {};
			const allMsgIds = new Set([...Object.keys(base), ...Object.keys(reactions), ...Object.keys(fbReactions)]);
			for (const msgId of allMsgIds) {
				const allEmojis = new Set([
					...Object.keys(base[msgId] ?? {}),
					...Object.keys(reactions[msgId] ?? {}),
					...Object.keys(fbReactions[msgId] ?? {})
				]);
				merged[msgId] = {};
				for (const em of allEmojis) {
					const users = {
						...(base[msgId]?.[em] ?? {}),
						...(reactions[msgId]?.[em] ?? {}),
						...(fbReactions[msgId]?.[em] ?? {})
					};
					if (Object.keys(users).length > 0) merged[msgId][em] = users;
				}
			}
			reactions = merged;
			const _dur = performance.now() - _t0;
			if (_dur > 4) console.warn('[perf:reactions]', _dur.toFixed(1) + 'ms', Object.keys(fbReactions).length + ' msgs');
		});
	});

	function onKitchenInsert(token) {
		showKitchen = false;
		insertEkToken(token);
	}

	function cancelAttachment() {
		const att = pendingAttachment;
		if (!att) return;
		pendingAttachment = null;
		fetch(`/api/upload/${att.id}`, { method: 'DELETE' }).catch(() => {});
	}

	onDestroy(() => {
		_cancelFpsLoop();
		if (firebaseRef) off(firebaseRef);
		if (typingRef) off(typingRef);
		if (reactionsRef) off(reactionsRef);
		clearTyping();
		cancelAttachment();
		if (heartsAnimId) cancelAnimationFrame(heartsAnimId);
		document.removeEventListener('selectionchange', onCeSelect);
	});

	async function send() {
		const content = input.trim();
		const attSnap = pendingAttachment ? { ...pendingAttachment } : null;
		if (!content && !attSnap) return;
		if (sending) return;
		clearTyping();
		const replySnap = replyingTo ? { ...replyingTo } : null;
		const fxSnap = messageEffect;
		const szSnap = messageFontSize !== 1.0 ? messageFontSize : undefined;
		const noSplit = !fxSplitWords;
		const optimistic = {
			id: `opt-${Date.now()}`, userId: data.currentUser.id,
			userName: data.currentUser.name, userRole: data.currentUser.role,
			content: content || attSnap?.filename || '', createdAt: Date.now(),
			pending: true, replyTo: replySnap, attachment: attSnap, fx: fxSnap,
			fontSize: szSnap ?? 1, noSplit
		};
		messages = [...messages, optimistic];
		setCeInput('');
		undoStack = []; redoStack = [];
		replyingTo = null;
		pendingAttachment = null;
		messageEffect = null;
		showEffectPanel = false;
		messageFontSize = 1.0;
		scrollToBottom();
		if (fxSnap && SCREEN_FXS.some(f => f.name === fxSnap)) setTimeout(() => playScreenEffect(fxSnap), 50);
		sending = true;
		try {
			await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: content || attSnap?.filename || '', channelId: convId, reply_to: replySnap, attachment: attSnap, effect: fxSnap || undefined, fontSize: szSnap, noSplit: noSplit || undefined })
			});
			messages = messages.filter((m) => m.id !== optimistic.id);
		} catch {
			messages = messages.filter((m) => m.id !== optimistic.id);
			setCeInput(content);
			replyingTo = replySnap;
			pendingAttachment = attSnap;
			messageEffect = fxSnap;
			messageFontSize = szSnap ?? 1.0;
		}
		sending = false;
		inputEl?.focus();
	}

	async function handleFileSelect(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = '';
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('contextType', 'channel');
			fd.append('contextId', convId);
			fd.append('classId', data.currentClass?.id ?? '');
			const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
			if (!uploadRes.ok) throw new Error(await uploadRes.text());
			pendingAttachment = await uploadRes.json();
			inputEl?.focus();
		} catch (err) {
			console.error('Upload failed', err);
		} finally {
			uploading = false;
		}
	}

	function formatSize(bytes) {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function onKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); inputEl?.focus(); send(); return; }
		const mod = e.metaKey || e.ctrlKey;
		if (!mod) return;
		if (e.key === 'b') { e.preventDefault(); applyTextFx('bold'); return; }
		if (e.key === 'i') { e.preventDefault(); applyTextFx('italic'); return; }
		if (e.key === 'u') { e.preventDefault(); applyTextFx('underline'); return; }
		if (e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			if (undoStack.length) {
				redoStack.push(input);
				const prev = undoStack[undoStack.length - 1];
				undoStack.pop();
				setCeInput(prev);
			}
			return;
		}
		if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
			e.preventDefault();
			if (redoStack.length) {
				undoStack.push(input);
				const next = redoStack[redoStack.length - 1];
				redoStack.pop();
				setCeInput(next);
			}
			return;
		}
	}

	function onInput() {
		if (!input.trim()) { clearTyping(); return; }
		set(ref(db, `typing/${convId}/${data.currentUser.id}`), { name: data.currentUser.name, ts: Date.now() });
		clearTimeout(typingTimer);
		typingTimer = setTimeout(clearTyping, 4000);
	}
</script>

<svelte:head><title>#{data.channelId} — eating.computer</title></svelte:head>
<canvas bind:this={heartsCanvas} class="hearts-canvas"></canvas>

<div class="chat-header">
	<button class="sidebar-toggle" onclick={openSidebar} aria-label="Open menu">
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
	</button>
	<h1># {data.channelId}</h1>
</div>

<div class="message-list" bind:this={listEl} style:padding-bottom="{inputAreaHeight}px" onscroll={onListScroll} oncopy={onMsgListCopy}>
	{#if messages.length === 0}
		<p class="empty">No messages yet. Say something!</p>
	{/if}
	{#each messages as msg, i (msg.id)}
		{@const prev = messages[i - 1]}
		{@const isFirst = !prev || prev.userId !== msg.userId || msg.createdAt - prev.createdAt > 300000}
		{@const isMine = msg.userId === data.currentUser.id}
		{@const msgReactions = reactions[msg.id] ?? {}}
		{@const hasReactions = Object.values(msgReactions).some(u => Object.keys(u).length > 0)}
		<div class="message" class:mine={isMine} class:first={isFirst} class:starred={starredIds.has(msg.id)} class:slam-shock={slamShockSet.has(msg.id)} data-msg-id={msg.id}>
			{#if isFirst}
				<div class="meta">
					<ProfileHover userId={msg.userId}>
						<span class="name">{msg.userName}</span>
					</ProfileHover>
					{#if msg.userRole === 'instructor'}<span class="badge">instructor</span>{/if}
					<span class="time">{formatTime(msg.createdAt)}</span>
				</div>
			{/if}
			<div class="bubble-row">
				{#if msg.attachment}
					{#if msg.attachment.mimetype?.startsWith('image/')}
						<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-img" class:pending={msg.pending}>
							<img src={msg.attachment.url} alt={msg.attachment.filename} onload={scrollIfNearBottom} />
						</a>
					{:else if msg.attachment.mimetype?.startsWith('video/')}
						<div class="bubble bubble-video" class:pending={msg.pending}>
							<video src={msg.attachment.url} controls preload="metadata" class="att-video" onloadedmetadata={scrollIfNearBottom}></video>
							<div class="att-info att-info-video">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{formatSize(msg.attachment.size)}</span>
							</div>
						</div>
					{:else}
						<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-file" class:pending={msg.pending} class:mine={isMine}>
							<FileTypeIcon filename={msg.attachment.filename} mimetype={msg.attachment.mimetype} iconSize={36} />
							<div class="att-info">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{formatSize(msg.attachment.size)}</span>
							</div>
						</a>
					{/if}
				{:else if editingMsgId === msg.id}
					<div class="bubble edit-bubble" class:mine={isMine}>
						<textarea class="edit-textarea" bind:value={editContent} rows="2"
							onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') editingMsgId = null; }}
						></textarea>
						<div class="edit-controls">
							<button class="edit-cancel" onclick={() => editingMsgId = null}>Cancel</button>
							<button class="edit-save" onclick={saveEdit}>Save</button>
						</div>
					</div>
				{:else}
					{#key replayCounts[msg.id]}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<p class="bubble" class:pending={msg.pending} class:fx-rainbow={msg.fx === 'rainbow'} class:fx-hearts={msg.fx === 'hearts'} class:fx-slam={msg.fx === 'slam'} class:fx-loud={msg.fx === 'loud'} class:fx-gentle={msg.fx === 'gentle'} class:fx-invisible={msg.fx === 'invisible'} class:fx-shake={msg.fx === 'shake'} class:fx-bounce={msg.fx === 'bounce'} class:fx-wave={msg.fx === 'wave'} class:fx-jitter={msg.fx === 'jitter'} class:fx-big={msg.fx === 'big'} class:fx-small={msg.fx === 'small'} class:revealed={revealedInvisible.has(msg.id)} class:jumbo-emoji={jumboEmojiCountM(msg.content) > 0 && !msg.replyTo} class:has-reply={!!msg.replyTo} style:font-size={bubbleFontSize(msg.content, msg.fontSize)} onclick={msg.fx === 'invisible' && !revealedInvisible.has(msg.id) ? () => revealInvisible(msg.id) : undefined}>{#if msg.replyTo}{@const _rp = stripMarkup(msg.replyTo.content)}{@const _rj = jumboEmojiCountM(_rp)}<button class="reply-quote" onclick={(e) => { e.stopPropagation(); scrollToMessage(msg.replyTo.id); }}><span class="reply-author">{msg.replyTo.userName}</span><span class="reply-text" class:jumbo-reply={_rj > 0} style:font-size={_rj > 0 ? JUMBO_SIZES[_rj - 1] : null}>{@html contentHtmlM(msg.replyTo.content)}</span></button>{/if}{@html contentHtmlM(msg.content, !msg.noSplit)}{#if msg.edited}<span class="edited-tag"> (edited)</span>{/if}</p>
					{/key}
				{/if}
				{#if !msg.pending}
				<div class="msg-actions-bar">
					<button class="action-btn" onclick={(e) => { e.stopPropagation(); openPicker(msg.id, e); }} title="Add reaction">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
					</button>
					<button class="action-btn" onclick={(e) => { e.stopPropagation(); startReply(msg); }} title="Reply">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
					</button>
					<button class="action-btn" title="Reply in thread">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
					</button>
					<button class="action-btn" class:action-btn-starred={starredIds.has(msg.id)} onclick={(e) => { e.stopPropagation(); toggleStar(msg); }} title={starredIds.has(msg.id) ? 'Unstar' : 'Star message'}>
						{#if starredIds.has(msg.id)}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
						{/if}
					</button>

					{#if isMine}
						<button class="action-btn" onclick={(e) => { e.stopPropagation(); startEdit(msg); }} title="Edit message">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
						</button>
						<button class="action-btn action-btn-delete" onclick={(e) => { e.stopPropagation(); if (confirm('Delete this message?')) deleteMessage(msg); }} title="Delete">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
						</button>
					{:else if data.currentUser.role === 'instructor'}
						<div class="kebab-wrap">
							<button class="action-btn" onclick={(e) => { e.stopPropagation(); kebabOpenId = kebabOpenId === msg.id ? null : msg.id; }} title="More">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
							</button>
							{#if kebabOpenId === msg.id}
								<div class="kebab-menu">
									<button class="kebab-item kebab-item-delete" onclick={(e) => { e.stopPropagation(); kebabOpenId = null; if (confirm('Delete this message?')) deleteMessage(msg); }}>Delete</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>
				{/if}
			</div>
			{#if ['slam', 'loud', 'gentle'].includes(msg.fx) && !msg.pending}
				<button class="fx-replay" class:mine={isMine} onclick={() => replayEffect(msg.id)}>↺ Replay</button>
			{/if}
			{#if starredIds.has(msg.id)}
				<div class="saved-label">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
					Saved
				</div>
			{/if}
			{#if hasReactions}
				<div class="reactions">
					{#each Object.entries(msgReactions) as [emoji, users]}
						{@const count = Object.keys(users).length}
						{#if count > 0}
							<button class="reaction-chip" class:reacted={data.currentUser.id in users} onclick={() => toggleReaction(msg.id, emoji)} onmouseenter={positionReactionTooltip}>
								<span class="reaction-emoji">{emoji}</span> <span class="reaction-count">{count}</span>
								<div class="reaction-tooltip">
									<span class="reaction-tooltip-emoji">{emoji}</span>
									<div class="reaction-tooltip-text">
										<span class="reaction-tooltip-names">{Object.keys(users).map(uid => userMap[uid]?.name ?? 'Someone').join(', ')}</span>
										<span class="reaction-tooltip-label">reacted with {emojiNames[emoji] ?? emoji}</span>
									</div>
								</div>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

{#if pickerMsgId}
	<div class="picker-overlay" onclick={() => pickerMsgId = null} onkeydown={(e) => e.key === 'Escape' && (pickerMsgId = null)} role="presentation"></div>
	<div class="picker-popover" style:left="{pickerPos.x}px" style:top="{pickerPos.y}px">
		<EmojiPicker onSelect={(emoji) => { toggleReaction(pickerMsgId, emoji); pickerMsgId = null; }} />
	</div>
{/if}


<div class="input-area" class:kb-open={keyboardOpen} bind:clientHeight={inputAreaHeight}>
	{#if replyingTo}
		<div class="reply-bar">
			<div class="reply-bar-content">
				<span class="reply-bar-to">Replying to <strong>{replyingTo.userName}</strong></span>
				<span class="reply-bar-text">{stripMarkup(replyingTo.content).slice(0, 80)}</span>
			</div>
			<button class="reply-bar-close" onclick={() => replyingTo = null}>×</button>
		</div>
	{/if}
	{#if pendingAttachment}
		<div class="reply-bar att-bar">
			{#if pendingAttachment.mimetype?.startsWith('image/')}
				<img class="att-bar-thumb" src={pendingAttachment.url} alt={pendingAttachment.filename} />
			{:else}
				<FileTypeIcon filename={pendingAttachment.filename} mimetype={pendingAttachment.mimetype} iconSize={32} />
			{/if}
			<div class="reply-bar-content">
				<span class="reply-bar-to">{pendingAttachment.filename}</span>
				<span class="reply-bar-text">{formatSize(pendingAttachment.size)}</span>
			</div>
			<button class="reply-bar-close" onclick={cancelAttachment}>×</button>
		</div>
	{/if}
	{#if typingUsers.length}
		<p class="typing-indicator">
			{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
		</p>
	{/if}
	{#if messageEffect && input.trim()}
		<div class="effect-preview">
			<span class="preview-label">Preview</span>
			{#if SCREEN_FXS.some(f => f.name === messageEffect)}
				<span class="preview-screen-label">{SCREEN_FXS.find(f => f.name === messageEffect).icon} {SCREEN_FXS.find(f => f.name === messageEffect).label} effect</span>
			{:else}
				<p class="bubble" class:fx-rainbow={messageEffect === 'rainbow'} class:fx-hearts={messageEffect === 'hearts'} class:fx-slam={messageEffect === 'slam'} class:fx-loud={messageEffect === 'loud'} class:fx-gentle={messageEffect === 'gentle'} class:fx-invisible={messageEffect === 'invisible'}>{@html contentHtml(input, fxSplitWords)}</p>
			{/if}
		</div>
	{/if}
	{#if emojiSuggestions.length > 0}
		<div class="emoji-suggestions">
			{#each emojiSuggestions as s (s.cp)}
				<button class="emoji-sugg-btn" onmousedown={(e) => { e.preventDefault(); insertEmoji(s.e); }} title={s.cp}>{s.e}</button>
			{/each}
		</div>
	{/if}
	{#if showTextFxBar}
		<div class="text-fx-bar">
			<button class="text-fx-layer-toggle" class:text-fx-layer-on={allowFxNesting} onmousedown={(e) => { e.preventDefault(); allowFxNesting = !allowFxNesting; }} title="Stack different effects on the same text">
				<span class="layer-toggle-track"><span class="layer-toggle-knob"></span></span>
				Layer
			</button>
			<button class="text-fx-layer-toggle" class:text-fx-layer-on={allowFxMultiply} onmousedown={(e) => { e.preventDefault(); allowFxMultiply = !allowFxMultiply; }} title="Apply the same effect multiple times on the same text">
				<span class="layer-toggle-track"><span class="layer-toggle-knob"></span></span>
				Multiply
			</button>
			<button class="text-fx-layer-toggle" class:text-fx-layer-on={fxSplitWords} onmousedown={(e) => { e.preventDefault(); fxSplitWords = !fxSplitWords; }} title="Apply effect to each word/emoji separately">
				<span class="layer-toggle-track"><span class="layer-toggle-knob"></span></span>
				Per word
			</button>
			<span class="text-fx-divider"></span>
			{#each TEXT_FXS as fx}
				<button class="text-fx-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx(fx.name); }}>
					{#if fx.name === 'ripple'}
						{@html [...fx.label].map((c, i) => `<span class="tfx tfx-ripple" style="animation-delay:${(i * 0.08).toFixed(2)}s;display:inline-block">${c}</span>`).join('')}
					{:else}
						<span class="tfx tfx-{fx.name}">{fx.label}</span>
					{/if}
				</button>
			{/each}
			<button class="text-fx-close" onmousedown={(e) => { e.preventDefault(); showTextFxBar = false; }}>✕</button>
		</div>
	{/if}
	<div class="input-bar">
		<label class="btn-attach" class:disabled={uploading || sending} title="Attach file">
			{#if uploading}
				<svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
			{:else}
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
			{/if}
			<input bind:this={fileInputEl} type="file" style="display:none" onchange={handleFileSelect} disabled={uploading || sending} />
		</label>
		<div class="compose-picker-wrap">
			<button class="btn-emoji" class:active={showComposePicker} title="Emoji" onclick={() => showComposePicker = !showComposePicker}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
			</button>
			{#if showComposePicker}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="compose-picker-backdrop" onclick={() => showComposePicker = false}></div>
				<div class="compose-picker-pop">
					<EmojiPicker onSelect={insertEmoji} />
				</div>
			{/if}
		</div>
		<div class="compose-kitchen-wrap">
			<button class="btn-kitchen" class:active={showKitchen} title="Emoji Kitchen" onclick={() => showKitchen = !showKitchen}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<ellipse cx="12" cy="10" rx="8" ry="7"/>
					<ellipse cx="6" cy="12" rx="4" ry="5"/>
					<ellipse cx="18" cy="12" rx="4" ry="5"/>
					<rect x="4" y="16" width="16" height="3.5" rx="1.5"/>
				</svg>
			</button>
			{#if showKitchen}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="compose-picker-backdrop" onclick={() => showKitchen = false}></div>
				<div class="compose-kitchen-pop">
					<EmojiKitchen onInsert={onKitchenInsert} />
				</div>
			{/if}
		</div>
		<div class="compose-wrap">
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div
				class="compose-ce"
				role="textbox"
				aria-multiline="true"
				aria-label="Message #{data.channelId}"
				contenteditable={!sending && !uploading}
				bind:this={inputEl}
				oninput={onCeInput}
				onkeydown={onKeydown}
				onmouseup={onCeSelect}
				onkeyup={onCeSelect}
				onfocus={() => keyboardOpen = true}
				onblur={() => { keyboardOpen = false; setTimeout(() => { const ae = document.activeElement; if (!ae?.closest('.text-fx-bar') && !ae?.closest('.compose-format-wrap')) showTextFxBar = false; }, 120); }}
				oncopy={onCeCopy}
				onpaste={onCePaste}
				data-placeholder="Message #{data.channelId}"
				style:font-size={messageFontSize !== 1.0 ? `${(messageFontSize * 0.9).toFixed(2)}rem` : (jumboInput > 0 ? JUMBO_SIZES[jumboInput - 1] : null)}
			></div>
			<div class="compose-fmt-row">
				<button class="btn-fmt btn-fmt-bold" onmousedown={(e) => { e.preventDefault(); applyTextFx('bold'); }} title="Bold (⌘B)"><b>B</b></button>
				<button class="btn-fmt btn-fmt-italic" onmousedown={(e) => { e.preventDefault(); applyTextFx('italic'); }} title="Italic (⌘I)"><i>I</i></button>
				<button class="btn-fmt btn-fmt-underline" onmousedown={(e) => { e.preventDefault(); applyTextFx('underline'); }} title="Underline (⌘U)"><u>U</u></button>
				<button class="btn-fmt btn-fmt-strike" onmousedown={(e) => { e.preventDefault(); applyTextFx('strike'); }} title="Strikethrough"><s>S</s></button>
				<div class="compose-format-wrap">
					<button class="btn-fmt btn-fmt-color" class:active={showFormatPanel} onmousedown={(e) => { e.preventDefault(); showFormatPanel = !showFormatPanel; }} title="Text color">A</button>
					{#if showFormatPanel}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="compose-picker-backdrop" onclick={() => showFormatPanel = false}></div>
						<div class="format-pop">
							<div class="format-pop-colors">
								{#each TEXT_COLORS as c}
									<button class="color-swatch" style="background:{c.hex}" onmousedown={(e) => { e.preventDefault(); applyTextFx(c.name); showFormatPanel = false; }} title={c.name.replace('color-', '')}></button>
								{/each}
							</div>
							<button class="format-rainbow-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('rainbow'); showFormatPanel = false; }}>🌈 Rainbow</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
		<div class="compose-effect-wrap">
			<button class="btn-effect" class:active={messageEffect !== null || showEffectPanel}
					title="Message effects" onclick={() => showEffectPanel = !showEffectPanel}>✨</button>
			{#if showEffectPanel}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="compose-picker-backdrop" onclick={() => showEffectPanel = false}></div>
				<div class="effect-pop">
					<div class="effect-pop-title">Bubble</div>
					<div class="effect-grid">
						{#each BUBBLE_FXS as fx}
							<button class="effect-tile" class:active={messageEffect === fx.name}
									onclick={() => { messageEffect = messageEffect === fx.name ? null : fx.name; showEffectPanel = false; }}>
								<span class="effect-tile-icon">{fx.icon}</span>
								<span class="effect-tile-label">{fx.label}</span>
							</button>
						{/each}
					</div>
					<div class="effect-pop-title">Screen</div>
					<div class="effect-grid">
						{#each SCREEN_FXS as fx}
							<button class="effect-tile" class:active={messageEffect === fx.name}
									onclick={() => { messageEffect = messageEffect === fx.name ? null : fx.name; showEffectPanel = false; }}>
								<span class="effect-tile-icon">{fx.icon}</span>
								<span class="effect-tile-label">{fx.label}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		<div class="send-wrap" bind:this={sendWrapEl} onpointerdown={onSendDown} onpointerup={onSendQuickUp} onpointermove={sizeSliderActive ? onSendMove : null} onpointercancel={sizeSliderActive ? onSendCancel : null}>
			{#if sizeSliderActive}
				<div class="sz-panel" style:top="{panelFixedTop}px" style:left="{panelFixedLeft}px" style:right="{panelFixedRight}px" style:height="{panelHeight}px">
					<div class="sz-track-line"></div>
					<div class="sz-pill" bind:this={_szPillEl}>Normal</div>
				</div>
			{/if}
			<button class="btn-send" class:btn-send-off={sending || uploading || (!input.trim() && !pendingAttachment)} class:sz-active={sizeSliderActive}>
				{#if !sizeSliderActive}Send{/if}
			</button>
		</div>
	</div>
	{#if sizeSliderActive}
		<!-- Full-screen capture overlay so moves anywhere on screen are tracked -->
		<div class="sz-capture" onpointermove={onSendMove} onpointerup={onSendUpArmed} onpointercancel={onSendCancel}></div>
	{/if}
</div>

<style>
	.chat-header {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 1rem 1.5rem 0.75rem;
		border-bottom: 1.5px solid #ddd7cc;
		flex-shrink: 0;
	}
	.chat-header h1 { font-family: 'Avara', serif; font-size: 1.25rem; font-weight: 400; margin: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.sidebar-toggle {
		display: none;
		background: none; border: none; color: var(--ink);
		cursor: pointer; padding: 0.3rem; border-radius: 6px;
		flex-shrink: 0; align-items: center; justify-content: center;
		-webkit-tap-highlight-color: transparent;
	}
	.sidebar-toggle:active { background: rgba(0,0,0,0.06); }
	.message-list {
		flex: 1; overflow-y: auto; padding: 1rem 1.5rem;
		display: flex; flex-direction: column; gap: 0.15rem;
		scrollbar-width: none;
	}
	.message-list::-webkit-scrollbar { display: none; }
	.empty { color: #a09688; font-size: 0.9rem; text-align: center; margin: auto; }
	.message { display: flex; flex-direction: column; max-width: 75%; gap: 0.15rem; position: relative; }
	.message.mine { align-self: flex-end; align-items: flex-end; }
	.message:not(.mine) { align-self: flex-start; align-items: flex-start; }
	.message.first { margin-top: 0.75rem; }
	.meta { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem; }
	.name { font-size: 0.78rem; font-weight: 600; color: var(--ink); cursor: pointer; }
	.name:hover { text-decoration: underline; text-underline-offset: 2px; }
	.badge {
		font-size: 0.65rem; font-weight: 600; background: var(--ink); color: var(--paper);
		padding: 0.1rem 0.4rem; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.04em;
	}
	.time { font-size: 0.72rem; color: #a09688; }

	/* Reply quote — inner bubble inside the message bubble */
	.bubble.has-reply { display: flex; flex-direction: column; gap: 0.35rem; }
	.reply-quote {
		display: block; width: 100%; text-align: left;
		background: rgba(0,0,0,0.07); border-radius: 8px;
		padding: 0.3rem 0.6rem;
		cursor: pointer; overflow: hidden;
		border: none; font-family: inherit; white-space: normal;
		transition: background 0.1s;
	}
	.reply-quote:hover { background: rgba(0,0,0,0.13); }
	.reply-author { display: block; font-size: 0.7rem; font-weight: 700; color: #5a4e44; }
	.reply-text { display: block; font-size: 0.78rem; color: #6b5f54; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.reply-text.jumbo-reply { white-space: normal; text-overflow: clip; line-height: 1.15; }
	.message.mine .bubble .reply-quote { background: rgba(255,255,255,0.15); }
	.message.mine .bubble .reply-quote:hover { background: rgba(255,255,255,0.24); }
	.message.mine .bubble .reply-author { color: rgba(255,255,255,0.75); }
	.message.mine .bubble .reply-text { color: rgba(255,255,255,0.92); }

	/* Bubble row */
	.bubble-row { position: relative; display: flex; align-items: flex-end; gap: 0.3rem; }
	.message.mine .bubble-row { flex-direction: row-reverse; }

	.msg-actions-bar {
		position: absolute;
		top: 9px;
		transform: translateY(-100%);
		display: flex;
		flex-direction: row;
		gap: 0;
		background: #fff;
		border: 1.5px solid #ddd7cc;
		border-radius: 10px;
		padding: 1px;
		overflow: visible;
		box-shadow: 0 2px 10px rgba(0,0,0,0.12);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.1s;
		z-index: 50;
		white-space: nowrap;
	}

	/* For others' messages: left-anchor when short, right-anchor when long */
	.message:not(.mine) .msg-actions-bar {
		left: max(5px, calc(100% - 178px));
	}

	/* For mine messages: left-anchor when bubble is wide, right-anchor when narrow */
	.message.mine .msg-actions-bar {
		left: min(-5px, calc(100% - 218px));
	}

	/* Show bar on bubble-row hover or when bar itself is hovered */
	.bubble-row:hover .msg-actions-bar,
	.msg-actions-bar:hover {
		opacity: 1;
		pointer-events: auto;
	}

	.action-btn {
		background: transparent; border: none; border-radius: 6px;
		width: 30px; height: 30px; padding: 5px; cursor: pointer; color: #a09688;
		display: flex; align-items: center; justify-content: center;
		transition: color 0.1s, background 0.1s;
		flex-shrink: 0;
	}
	.action-btn:hover { color: var(--ink); background: rgba(0,0,0,0.06); }
	.action-btn-delete:hover { color: #c0392b; background: rgba(192,57,43,0.08); }
	.action-btn-starred { color: #e6a817; }
	.action-btn-starred:hover { color: #c8900f; background: rgba(230,168,23,0.1); }

	/* Edit mode */
	.edit-bubble { padding: 0.4rem !important; min-width: 220px; background: #fff !important; border: 1.5px solid var(--ink) !important; }
	.edit-textarea {
		width: 100%; min-height: 56px; padding: 0.4rem 0.5rem;
		border: none; background: transparent; font-family: inherit;
		font-size: 0.9rem; color: var(--ink); resize: vertical;
		outline: none; display: block; field-sizing: content;
	}
	.edit-controls { display: flex; gap: 0.25rem; justify-content: flex-end; margin-top: 0.25rem; }
	.edit-cancel {
		padding: 0.25rem 0.65rem; background: none; border: none;
		font-family: inherit; font-size: 0.78rem; color: #a09688; cursor: pointer; border-radius: 5px;
	}
	.edit-cancel:hover { background: #f0ece4; color: var(--ink); }
	.edit-save {
		padding: 0.25rem 0.65rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 5px; font-family: inherit; font-size: 0.78rem;
		font-weight: 600; cursor: pointer;
	}
	.edit-save:hover { opacity: 0.8; }
	.edited-tag { font-size: 0.68rem; opacity: 0.5; font-style: italic; }

	.kebab-wrap { position: relative; }
	.kebab-overlay { position: fixed; inset: 0; z-index: 20; }
	.kebab-menu {
		position: absolute; top: calc(100% + 4px); right: 0; z-index: 21;
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 110px; overflow: hidden;
	}
	.kebab-item {
		display: block; width: 100%; text-align: left;
		padding: 0.5rem 0.85rem; font-family: inherit; font-size: 0.82rem;
		background: none; border: none; cursor: pointer; color: var(--ink);
		transition: background 0.1s;
	}
	.kebab-item:hover { background: #f5f0e8; }
	.kebab-item-delete { color: #c0392b; }
	.kebab-item-delete:hover { background: #fff0f0; }

	.saved-label {
		display: flex; align-items: center; gap: 0.2rem;
		font-size: 0.62rem; font-weight: 600; color: #c8900f;
		padding: 0.1rem 0.5rem; letter-spacing: 0.02em;
	}
	.message.mine .saved-label { justify-content: flex-end; }

	.bubble {
		margin: 0; padding: 0.55rem 0.85rem; border-radius: 14px;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		background: #fff; border: 1.5px solid #ddd7cc;
	}
	.message.mine .bubble { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.message.starred:not(.mine) .bubble { background: #fff8e6; border-color: #e6cc70; }
	.message.starred.mine .bubble { border-color: #c8900f; }
	.bubble.pending { opacity: 0.6; }
	.bubble.jumbo-emoji { background: transparent !important; border-color: transparent !important; box-shadow: none !important; padding: 0.1rem 0.4rem; line-height: 1.15; }

	/* Attachment bubbles */
	.bubble-img {
		padding: 0; overflow: hidden; display: block; max-width: 260px; border-radius: 14px;
		text-decoration: none; background: transparent !important; border-color: transparent !important;
	}
	.bubble-img img {
		display: block; max-width: 260px; max-height: 320px;
		width: 100%; height: auto; object-fit: cover;
	}
	.bubble-video {
		padding: 0.5rem; max-width: 320px; display: block;
	}
	.att-video {
		display: block; width: 100%; max-height: 400px;
		border-radius: 8px; background: #000;
	}
	.att-info-video { padding: 0.1rem 0.35rem 0; }
	.bubble-file {
		display: flex; align-items: center; gap: 0.65rem;
		padding: 0.6rem 0.85rem; text-decoration: none; color: var(--ink);
		min-width: 0;
	}
	.bubble-file.mine { color: var(--paper); }
	.att-info { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
	.att-name { font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.att-size { font-size: 0.7rem; opacity: 0.6; }

	/* Reactions */
	.reactions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.2rem; }
	.reaction-chip {
		position: relative;
		display: flex; align-items: center; gap: 0.22rem;
		background: #f5f0e8; border: 1.5px solid #ddd7cc; border-radius: 99px;
		padding: 0.12rem 0.5rem; font-size: 0.85rem; cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
	}
	.reaction-chip:hover { background: #ede8df; border-color: #c8c1b4; }
	.reaction-chip.reacted { background: #e8f0fe; border-color: #a0b8f0; }
	.reaction-count { font-size: 0.72rem; color: #555; font-weight: 600; }
	.reaction-tooltip {
		display: none;
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%; transform: translateX(-50%);
		min-width: max-content;
		background: #1a1a1a; color: #f7f2ea;
		border-radius: 10px; padding: 0.5rem 0.75rem;
		font-size: 0.78rem; white-space: nowrap;
		z-index: 30; pointer-events: none;
		flex-direction: row; align-items: center; gap: 0.55rem;
		box-shadow: 0 4px 14px rgba(0,0,0,0.3);
	}
	.reaction-chip:hover .reaction-tooltip { display: flex; }
	.reaction-tooltip-emoji { font-size: 2rem; line-height: 1; flex-shrink: 0; }
	.reaction-tooltip-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.reaction-tooltip-names { font-weight: 600; font-size: 0.78rem; }
	.reaction-tooltip-label { font-size: 0.7rem; opacity: 0.7; }

	/* Emoji picker */
	.picker-overlay { position: fixed; inset: 0; z-index: 40; }
	.picker-popover { position: fixed; z-index: 41; }

	/* Reply bar above input */
	.reply-bar {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.4rem 1.5rem; border-top: 1px solid #ddd7cc; background: #faf8f5;
	}
	.reply-bar-content { flex: 1; display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
	.reply-bar-to { font-size: 0.72rem; color: #888; }
	.reply-bar-to strong { color: var(--ink); }
	.reply-bar-text { font-size: 0.78rem; color: #a09688; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.reply-bar-close {
		background: none; border: none; color: #a09688; font-size: 1.2rem;
		cursor: pointer; line-height: 1; padding: 0.1rem 0.35rem; border-radius: 4px; flex-shrink: 0;
	}
	.reply-bar-close:hover { color: var(--ink); background: #ede8df; }
	.att-bar { align-items: center; }
	.att-bar-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 5px; flex-shrink: 0; }

	.input-area { flex-shrink: 0; }
	.typing-indicator {
		font-size: 0.75rem; color: #a09688; padding: 0 1.5rem 0.25rem;
		margin: 0; min-height: 1.2rem;
	}
	.input-bar {
		display: flex; align-items: flex-end; gap: 0.5rem;
		padding: 0.75rem 1.5rem 1.5rem; border-top: 1.5px solid #ddd7cc;
	}
	textarea {
		flex: 1; padding: 0.6rem 0.85rem; border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; resize: none; field-sizing: content; max-height: 140px; transition: border-color 0.15s;
	}
	textarea:focus { border-color: var(--ink); }
	.compose-wrap {
		flex: 1; display: flex; flex-direction: column;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; transition: border-color 0.15s; min-width: 0;
	}
	.compose-wrap:focus-within { border-color: var(--ink); }
	.compose-ce {
		padding: 0.6rem 0.85rem 0.35rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji'; font-optical-sizing: auto; font-size: 0.9rem; color: var(--ink);
		outline: none; max-height: 120px; overflow-y: auto;
		line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		min-height: calc(1.45em + 0.95rem); scrollbar-width: none;
	}
	.compose-ce::-webkit-scrollbar { display: none; }
	.compose-ce:empty::before {
		content: attr(data-placeholder);
		color: #a09688; pointer-events: none;
	}
	.compose-ce[contenteditable="false"] { opacity: 0.5; cursor: default; }
	.compose-fmt-row {
		display: flex; align-items: center; gap: 0.1rem;
		padding: 0.2rem 0.5rem 0.3rem; border-top: 1px solid #ede9e3;
	}
	.btn-attach {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; flex-shrink: 0;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; color: #a09688; cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.btn-attach:hover { color: var(--ink); border-color: #b0a898; }
	.btn-attach.disabled { opacity: 0.4; pointer-events: none; }
	.spin { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.compose-picker-wrap { position: relative; flex-shrink: 0; }
	.btn-emoji {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; color: #a09688; cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.btn-emoji:hover, .btn-emoji.active { color: var(--ink); border-color: #b0a898; background: #f5f2ee; }
	.compose-picker-backdrop { position: fixed; inset: 0; z-index: 49; }
	.compose-picker-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 50; }

	/* Inline Emoji Kitchen images */
	:global(.ek-img) {
		height: 1em;
		width: 1em;
		vertical-align: -0.2em;
		object-fit: contain;
		display: inline;
	}
	:global(.ek-img-ce) {
		height: 1em;
		width: 1em;
		vertical-align: -0.2em;
		object-fit: contain;
		cursor: default;
		user-select: none;
	}

	.compose-kitchen-wrap { position: relative; flex-shrink: 0; }
	.btn-kitchen {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; color: #a09688; cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.btn-kitchen:hover, .btn-kitchen.active { color: var(--ink); border-color: #b0a898; background: #f5f2ee; }
	.compose-kitchen-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 50; }

	.send-wrap {
		position: relative; flex-shrink: 0; touch-action: none; user-select: none; z-index: 299;
	}
	.btn-send {
		padding: 0.6rem 1.1rem; background: var(--ink); color: var(--paper); border: none;
		border-radius: 10px; font-family: inherit; font-size: 0.875rem; font-weight: 600;
		cursor: pointer; transition: opacity 0.15s; pointer-events: none;
		position: relative; z-index: 1; min-width: 4rem;
	}
	.btn-send:hover { opacity: 0.8; }
	.btn-send.btn-send-off { opacity: 0.4; cursor: default; }
	.btn-send.sz-active { opacity: 0; }
	/* Slider panel — floats above + below send button */
	.sz-panel {
		position: fixed;
		background: var(--ink); border-radius: 10px;
		pointer-events: none; z-index: 300;
	}
	.sz-track-line {
		position: absolute; left: 50%; top: 8px; bottom: 8px;
		width: 2px; transform: translateX(-50%);
		background: linear-gradient(to bottom,
			rgba(247,242,234,0.08),
			rgba(247,242,234,0.35) 25%,
			rgba(247,242,234,0.55) 50%,
			rgba(247,242,234,0.35) 75%,
			rgba(247,242,234,0.08));
		border-radius: 1px; pointer-events: none;
	}
	.sz-pill {
		position: absolute; left: 5px; right: 5px; height: 36px;
		background: rgba(247,242,234,0.18);
		border: 1.5px solid rgba(247,242,234,0.35);
		border-radius: 99px;
		display: flex; align-items: center; justify-content: center;
		color: var(--paper); font-size: 0.72rem; font-weight: 600;
		letter-spacing: 0.04em; text-transform: uppercase;
		pointer-events: none; white-space: nowrap;
	}

	/* Full-screen pointer capture overlay */
	:global(.sz-capture) {
		position: fixed; inset: 0; z-index: 298; cursor: ns-resize; touch-action: none;
	}

	/* Always-visible format buttons (B, I, color) */
	.btn-fmt {
		display: flex; align-items: center; justify-content: center;
		width: 26px; height: 26px; flex-shrink: 0;
		border: none; border-radius: 6px;
		background: none; cursor: pointer; color: var(--ink); opacity: 0.45;
		font-size: 0.85rem; line-height: 1; font-family: inherit;
		transition: opacity 0.15s, background 0.1s;
	}
	.btn-fmt:hover, .btn-fmt.active { opacity: 1; background: #f0ece6; }
	.btn-fmt-bold { font-weight: 700; }
	.btn-fmt-italic { font-style: italic; font-weight: 600; }
	.btn-fmt-underline { text-decoration: underline; text-underline-offset: 2px; }
	.btn-fmt-strike { text-decoration: line-through; }
	.btn-fmt-color {
		font-weight: 700; font-size: 0.8rem;
		text-decoration: underline; text-decoration-color: #e74c3c;
		text-decoration-thickness: 2px; text-underline-offset: 1px;
	}
	.compose-format-wrap { position: relative; flex-shrink: 0; }
	.format-pop {
		position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 50;
		padding: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; min-width: 152px;
	}
	.format-pop-colors { display: flex; gap: 0.3rem; flex-wrap: wrap; }
	.color-swatch {
		width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
		border: 2px solid transparent; cursor: pointer;
		transition: transform 0.12s, border-color 0.12s;
	}
	.color-swatch:hover { transform: scale(1.2); border-color: rgba(0,0,0,0.25); }
	.format-rainbow-btn {
		background: none; border: 1.5px solid #ddd7cc; border-radius: 6px;
		padding: 0.25rem 0.5rem; font-size: 0.78rem; font-family: inherit;
		cursor: pointer; text-align: left; color: var(--ink); transition: background 0.1s;
	}
	.format-rainbow-btn:hover { background: #f5f2ee; }

	/* Effects button */
	.compose-effect-wrap { position: relative; flex-shrink: 0; }
	.btn-effect {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; font-size: 1rem; line-height: 1;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.btn-effect:hover, .btn-effect.active { border-color: #b0a898; background: #f5f2ee; }
	.effect-pop {
		position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 50;
		background: #fff; border: 1.5px solid #ddd7cc; border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 216px; overflow: hidden;
	}
	.effect-pop-title {
		padding: 0.5rem 0.85rem 0.3rem;
		font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em;
		text-transform: uppercase; color: #a09688;
	}
	.effect-grid {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.25rem;
		padding: 0.25rem 0.5rem 0.5rem;
	}
	.effect-tile {
		display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
		padding: 0.4rem 0.25rem; background: none; border: 1.5px solid transparent;
		border-radius: 8px; cursor: pointer; transition: background 0.1s, border-color 0.1s;
	}
	.effect-tile:hover { background: #f5f0e8; border-color: #ddd7cc; }
	.effect-tile.active { background: #fff8e6; border-color: #d4aa30; }
	.effect-tile-icon { font-size: 1.25rem; line-height: 1; pointer-events: none; }
	.effect-tile-label { font-size: 0.67rem; font-weight: 600; color: var(--ink); white-space: nowrap; pointer-events: none; }

	/* Effect preview strip above input-bar */
	.effect-preview {
		padding: 0.5rem 1.5rem 0;
		display: flex; align-items: center; gap: 0.75rem;
		border-top: 1px solid #ddd7cc; background: #faf8f5;
	}
	.preview-label {
		font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em;
		text-transform: uppercase; color: #a09688; flex-shrink: 0;
	}
	.effect-preview .bubble { font-size: 0.85rem; padding: 0.4rem 0.7rem; color: var(--ink); }

	/* Hearts canvas overlay */
	:global(.hearts-canvas) {
		position: fixed; inset: 0;
		width: 100%; height: 100%;
		pointer-events: none;
		z-index: 200;
	}

	/* Hearts effect — red bubble */
	.bubble.fx-hearts {
		border: 2px solid #e8566e !important;
		background: #fff0f3 !important;
		color: #8b1a2e !important;
	}
	.message.mine .bubble.fx-hearts {
		background: #c0243c !important;
		border-color: #c0243c !important;
		color: #fff !important;
	}

	/* Rainbow border effect */
	.bubble.fx-rainbow {
		border: 2.5px solid transparent !important;
		background: linear-gradient(#fff, #fff) padding-box,
		            conic-gradient(from var(--rwb), #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #c77dff, #ff6b6b) border-box !important;
		animation: rwb-spin 3s linear infinite;
	}
	.message.mine .bubble.fx-rainbow {
		background: linear-gradient(var(--ink), var(--ink)) padding-box,
		            conic-gradient(from var(--rwb), #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #c77dff, #ff6b6b) border-box !important;
	}

	/* Replay button */
	.fx-replay {
		background: none; border: none; font-size: 0.72rem; color: #a09688;
		cursor: pointer; padding: 0.1rem 0.35rem; line-height: 1;
		transition: color 0.15s; font-family: inherit;
	}
	.fx-replay:hover { color: var(--ink); }
	.fx-replay.mine { align-self: flex-end; }

	/* Slam shockwave — other bubbles react when slam arrives */
	.message.slam-shock .bubble {
		animation: slam-shock-wave 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	@keyframes slam-shock-wave {
		0%   { transform: scale(1); }
		18%  { transform: scaleY(0.91) scaleX(1.04); filter: brightness(1.08); }
		40%  { transform: scaleY(1.05) scaleX(0.97); }
		62%  { transform: scaleY(0.98) scaleX(1.01); }
		100% { transform: scale(1); filter: brightness(1); }
	}

	/* Expressive whole-bubble effects */
	.bubble.fx-shake { animation: tfx-shake 0.45s ease infinite; }
	.bubble.fx-bounce { animation: tfx-bounce 0.55s ease infinite; }
	.bubble.fx-wave { animation: tfx-wave 1.1s ease-in-out infinite; }
	.bubble.fx-jitter { animation: tfx-jitter 0.11s linear infinite; }
	.bubble.fx-big { font-size: 1.35em !important; }
	.bubble.fx-small { font-size: 0.6em !important; }

	/* Text fx bar */
	.emoji-suggestions {
		display: flex; align-items: center; gap: 0.25rem;
		padding: 0.3rem 1rem; background: var(--paper); border-top: 1px solid #ede9e3;
	}
	.emoji-sugg-btn {
		font-size: 1.35rem; line-height: 1; padding: 0.15rem 0.25rem;
		background: none; border: none; border-radius: 6px; cursor: pointer;
		transition: background 0.1s; flex-shrink: 0;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji';
	}
	.emoji-sugg-btn:hover { background: #f0ece6; }
	.text-fx-bar {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.35rem 1.5rem; background: var(--paper); border-top: 1px solid #ddd7cc;
		flex-wrap: wrap;
	}
	.text-fx-layer-toggle {
		display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;
		background: none; border: none; padding: 0; cursor: pointer;
		font-size: 0.72rem; font-weight: 600; color: #a09688; font-family: inherit;
		transition: color 0.15s;
	}
	.text-fx-layer-toggle:hover { color: var(--ink); }
	.text-fx-layer-on { color: var(--ink) !important; }
	.layer-toggle-track {
		position: relative; width: 2rem; height: 1.1rem; flex-shrink: 0;
		background: #ddd7cc; border-radius: 999px;
		transition: background 0.2s;
	}
	.text-fx-layer-on .layer-toggle-track { background: var(--ink); }
	.layer-toggle-knob {
		position: absolute; top: 0.15rem; left: 0.15rem;
		width: 0.8rem; height: 0.8rem;
		background: white; border-radius: 50%;
		transition: transform 0.2s;
		box-shadow: 0 1px 2px rgba(0,0,0,0.18);
	}
	.text-fx-layer-on .layer-toggle-knob { transform: translateX(0.9rem); }
	.text-fx-divider { width: 1px; height: 1.1rem; background: #ddd7cc; flex-shrink: 0; margin: 0 0.1rem; }
	.text-fx-btn {
		padding: 0.18rem 0.5rem; background: #f5f0e8; border: 1.5px solid #ddd7cc;
		border-radius: 5px; font-size: 0.76rem; font-weight: 600; color: var(--ink); font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		cursor: pointer; transition: background 0.1s;
	}
	.text-fx-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.text-fx-bar :global(.tfx) { animation-iteration-count: infinite !important; }
	.text-fx-close { margin-left: auto; background: none; border: none; font-size: 0.78rem; color: #a09688; cursor: pointer; padding: 0.1rem 0.25rem; line-height: 1; }
	.preview-screen-label { font-size: 0.9rem; color: var(--ink); }

	/* Bubble entry animations */
	.bubble.fx-slam { animation: fx-slam 0.38s cubic-bezier(0.2, 1.3, 0.4, 1) both; }
	@keyframes fx-slam { from { transform: scale(1.85); opacity: 0.15; } 65% { transform: scale(0.94); } to { transform: scale(1); opacity: 1; } }

	.bubble.fx-loud { animation: fx-loud 0.65s ease both; }
	@keyframes fx-loud { 0% { transform: scale(1); } 14% { transform: scale(1.3); } 32% { transform: scale(0.88); } 52% { transform: scale(1.18); } 72% { transform: scale(0.96); } 100% { transform: scale(1); } }

	.bubble.fx-gentle { animation: fx-gentle 1s ease both; }
	@keyframes fx-gentle { from { opacity: 0; transform: scale(0.88) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }

	.bubble.fx-invisible { filter: blur(7px) !important; cursor: pointer; transition: filter 0.65s; user-select: none; }
	.bubble.fx-invisible.revealed { filter: none !important; cursor: default; user-select: auto; }

	/* Text span effects — :global so they apply to dynamically created spans in compose-ce */
	:global(.tfx-shake) { display: inline-block; animation: tfx-shake 0.45s ease infinite; }
	@keyframes tfx-shake { 0%,100% { transform: translateX(0) rotate(0deg); } 20% { transform: translateX(-3px) rotate(-3deg); } 40% { transform: translateX(3px) rotate(3deg); } 60% { transform: translateX(-2px) rotate(-2deg); } 80% { transform: translateX(2px) rotate(2deg); } }

	:global(.tfx-bounce) { display: inline-block; animation: tfx-bounce 0.55s ease infinite; }
	@keyframes tfx-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

	:global(.tfx-wave) { display: inline-block; animation: tfx-wave 1.1s ease-in-out infinite; }
	@keyframes tfx-wave { 0%,100% { transform: skewX(0deg) translateY(0); } 25% { transform: skewX(-6deg) translateY(-3px); } 75% { transform: skewX(6deg) translateY(3px); } }

	:global(.tfx-nod) { display: inline-block; animation: tfx-nod 0.55s ease 2; }
	@keyframes tfx-nod { 0%,100% { transform: translateY(0); } 25% { transform: translateY(-4px); } 75% { transform: translateY(4px); } }

	:global(.tfx-jitter) { display: inline-block; animation: tfx-jitter 0.11s linear infinite; }
	@keyframes tfx-jitter { 0% { transform: translate(0,0) rotate(0deg); } 25% { transform: translate(1px,-1px) rotate(1deg); } 50% { transform: translate(-1px,1px) rotate(-1deg); } 75% { transform: translate(1px,1px); } }

	@keyframes tfx-big { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.5); } }
	:global(.tfx-big) { display: inline-block; animation: tfx-big 0.75s ease-in-out infinite; vertical-align: middle; }
	@keyframes tfx-small { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.5); } }
	:global(.tfx-small) { display: inline-block; animation: tfx-small 0.75s ease-in-out infinite; vertical-align: middle; }
	@keyframes tfx-ripple { 0%, 100% { transform: translateY(0); } 25% { transform: translateY(-7px); } 60% { transform: translateY(2px); } }
	:global(.tfx-ripple) { display: inline-block; animation: tfx-ripple 1s ease-in-out infinite; }
	:global(.tfx-underline) { text-decoration: underline; text-underline-offset: 2px; }
	:global(.tfx-strike) { text-decoration: line-through; }
	:global(.tfx-bold) { font-weight: 700; }
	:global(.tfx-italic) { font-style: italic; }
	:global(.tfx-color-red)    { color: #e74c3c; }
	:global(.tfx-color-orange) { color: #e67e22; }
	:global(.tfx-color-yellow) { color: #d4ac0d; }
	:global(.tfx-color-green)  { color: #27ae60; }
	:global(.tfx-color-teal)   { color: #16a085; }
	:global(.tfx-color-blue)   { color: #2980b9; }
	:global(.tfx-color-purple) { color: #8e44ad; }
	:global(.tfx-color-pink)   { color: #e91e8c; }
	@keyframes tfx-rainbow-text { 0% { color: #e74c3c; } 14% { color: #e67e22; } 28% { color: #d4ac0d; } 42% { color: #27ae60; } 57% { color: #2980b9; } 71% { color: #8e44ad; } 85% { color: #e91e8c; } 100% { color: #e74c3c; } }
	:global(.tfx-rainbow) { animation: tfx-rainbow-text 1.5s linear infinite; }

	@media (max-width: 640px) {
		.sidebar-toggle { display: flex; }
		.chat-header {
			padding: 0.6rem 0.75rem 0.5rem;
			background: var(--paper);
		}
		.chat-header h1 { font-size: 1.1rem; }
		.message-list { padding: 0.75rem 0.875rem; }
		.message { max-width: 88%; }
		.reply-bar { padding: 0.4rem 0.75rem; }
		.input-area {
			background: var(--paper);
		}
		.input-bar {
			padding: 0.5rem 0.75rem;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0.5rem));
			gap: 0.4rem;
		}
		.typing-indicator { padding: 0.2rem 0.875rem 0; }
		textarea { font-size: 1rem; }
		.compose-ce { font-size: 1rem; }
	}

	/* Noto Color Emoji: bubble needs an explicit override since it has its own font-family */
	:global(html.noto-emoji) .bubble {
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji';
	}
	/* Effect spans inside bubbles — ensure they inherit the Noto-aware stack */
	:global(html.noto-emoji) .bubble :global(.tfx) {
		font-family: inherit;
	}
	/* System emoji mode: strip Noto from compose/suggestions */
	:global(html:not(.noto-emoji)) .compose-ce,
	:global(html:not(.noto-emoji)) .emoji-sugg-btn {
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
	}
</style>
