// Shared message rendering logic — used by channel chat, DM chat, and moderation views.
// All text effect constants, PUA mappings, and the contentHtml renderer live here
// so new effects only need to be added in one place.

export const SCREEN_FXS = [
	{ name: 'confetti',  label: 'Confetti', icon: '🎊' },
	{ name: 'fireworks', label: 'Fireworks',icon: '🎆' },
	{ name: 'balloons',  label: 'Balloons', icon: '🎈' },
];

export const EXPRESSIVE_FXS = [
	{ name: 'shake',  label: 'Shake',  icon: '🫨' },
	{ name: 'bounce', label: 'Bounce', icon: '🏀' },
	{ name: 'wave',   label: 'Wave',   icon: '🌊' },
	{ name: 'jitter', label: 'Jitter', icon: '⚡' },
	{ name: 'big',    label: 'Big',    icon: '🔠' },
	{ name: 'small',  label: 'Small',  icon: '🔡' },
];

export const TEXT_FXS = [
	{ name: 'shake',     label: 'Shake'     },
	{ name: 'wave',      label: 'Wave'      },
	{ name: 'ripple',    label: 'Ripple'    },
	{ name: 'jitter',    label: 'Jitter'    },
	{ name: 'big',       label: 'Big'       },
	{ name: 'small',     label: 'Small'     },
	{ name: 'glitch',    label: 'Glitch'    },
];

export const FX_TO_CHAR = {};
[
	[0xE107, 'bold'], [0xE108, 'italic'], [0xE109, 'rainbow'], [0xE10A, 'flip'],
	[0xE110, 'color-red'], [0xE111, 'color-orange'], [0xE112, 'color-yellow'],
	[0xE113, 'color-green'], [0xE114, 'color-teal'], [0xE115, 'color-blue'],
	[0xE116, 'color-purple'], [0xE117, 'color-pink'],
	[0xE118, 'underline'], [0xE119, 'strike'], [0xE11A, 'ripple'], [0xE11B, 'glitch'],
	[0xE100, 'shake'], [0xE101, 'bounce'], [0xE102, 'wave'], [0xE103, 'nod'],
	[0xE104, 'jitter'], [0xE105, 'big'], [0xE106, 'small'],
	[0xE120, 'wdth-25'], [0xE121, 'wdth-50'], [0xE122, 'wdth-75'], [0xE123, 'wdth-125'], [0xE124, 'wdth-150'],
	[0xE130, 'wght-100'], [0xE131, 'wght-200'], [0xE132, 'wght-300'], [0xE133, 'wght-500'], [0xE134, 'wght-600'], [0xE135, 'wght-700'],
	// Inline size: the original 6 chars keep their exact codepoints (so messages
	// already sent stay valid), and finer gradations fill the free E146–E14F slots.
	[0xE140, 'sz-60'], [0xE141, 'sz-80'], [0xE142, 'sz-125'], [0xE143, 'sz-175'], [0xE144, 'sz-300'], [0xE145, 'sz-500'],
	[0xE146, 'sz-50'], [0xE147, 'sz-70'], [0xE148, 'sz-90'], [0xE149, 'sz-110'], [0xE14A, 'sz-140'],
	[0xE14B, 'sz-150'], [0xE14C, 'sz-200'], [0xE14D, 'sz-250'], [0xE14E, 'sz-400'], [0xE14F, 'sz-700']
].forEach(([cp, name]) => FX_TO_CHAR[name] = String.fromCodePoint(cp));

export const WDTH_FX_MAP = { 25: 'wdth-25', 50: 'wdth-50', 75: 'wdth-75', 125: 'wdth-125', 150: 'wdth-150' };
export const WDTH_STEPS = [25, 50, 75, 100, 125, 150];
export const WGHT_FX_MAP = { 100: 'wght-100', 200: 'wght-200', 300: 'wght-300', 500: 'wght-500', 600: 'wght-600', 700: 'wght-700' };
export const WGHT_STEPS = [100, 200, 300, 400, 500, 600, 700];
export const SZ_FX_MAP = {
	0.5: 'sz-50', 0.6: 'sz-60', 0.7: 'sz-70', 0.8: 'sz-80', 0.9: 'sz-90',
	1.1: 'sz-110', 1.25: 'sz-125', 1.4: 'sz-140', 1.5: 'sz-150', 1.75: 'sz-175',
	2.0: 'sz-200', 2.5: 'sz-250', 3.0: 'sz-300', 4.0: 'sz-400', 5.0: 'sz-500', 7.0: 'sz-700'
};
export const SZ_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0];

export const TEXT_COLORS = [
	{ name: 'color-red',    hex: '#e74c3c' },
	{ name: 'color-orange', hex: '#e67e22' },
	{ name: 'color-yellow', hex: '#d4ac0d' },
	{ name: 'color-green',  hex: '#27ae60' },
	{ name: 'color-teal',   hex: '#16a085' },
	{ name: 'color-blue',   hex: '#2980b9' },
	{ name: 'color-purple', hex: '#8e44ad' },
	{ name: 'color-pink',   hex: '#e91e8c' },
];

export const CHAR_TO_FX = Object.fromEntries(Object.entries(FX_TO_CHAR).map(([k, v]) => [v, k]));
export const FX_CLOSE_CHAR = String.fromCodePoint(0xE1FF);
export const FX_OPEN_CHARS = new Set(Object.values(FX_TO_CHAR));
// CONTINUOUS inline size: `SZ_OPEN <percent digits> SZ_VEND … FX_CLOSE_CHAR`.
// Lets size be value-for-value (e.g. sz-137 = 1.37×) instead of fixed steps.
// The old fixed-step PUA chars (E140–E14F) still decode for already-sent msgs.
export const SZ_OPEN = String.fromCodePoint(0xE150);
export const SZ_VEND = String.fromCodePoint(0xE151);

export const JUMBO_SIZES = ['2.8rem', '2.2rem', '1.8rem'];

// ── Pure helpers ─────────────────────────────────────────────────────────

export function escapeHtml(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function nestedFxHtml(fxStack, innerHtml, delay = null) {
	const decorFx = fxStack.filter(fx => fx === 'underline' || fx === 'strike');
	const wdthFx = fxStack.find(fx => fx.startsWith('wdth-'));
	const wghtFx = fxStack.find(fx => fx.startsWith('wght-'));
	const szFx = fxStack.find(fx => fx.startsWith('sz-'));
	const animStack = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike' && !fx.startsWith('wdth-') && !fx.startsWith('wght-') && !fx.startsWith('sz-'));
	let html = innerHtml;
	if (szFx) {
		const rem = (parseFloat(szFx.replace('sz-', '')) / 100 * 0.9).toFixed(2);
		html = `<span class="tfx tfx-${szFx}" data-fx="${szFx}" style="font-size:${rem}rem">${html}</span>`;
	}
	if (wghtFx) {
		const w = wghtFx.replace('wght-', '');
		html = `<span class="tfx tfx-${wghtFx}" data-fx="${wghtFx}" style="font-weight:${w}">${html}</span>`;
	}
	if (wdthFx) {
		const pct = wdthFx.replace('wdth-', '');
		html = `<span class="tfx tfx-${wdthFx}" data-fx="${wdthFx}" style="font-stretch:${pct}%">${html}</span>`;
	}
	if (decorFx.length) {
		const tdLine = decorFx.map(fx => fx === 'underline' ? 'underline' : 'line-through').join(' ');
		html = `<span class="tfx ${decorFx.map(fx => `tfx-${fx}`).join(' ')}" style="text-decoration-line:${tdLine};text-underline-offset:2px">${html}</span>`;
	}
	for (let i = animStack.length - 1; i >= 0; i--) {
		const fx = animStack[i];
		const style = delay ? ` style="animation-delay:${delay}"` : '';
		// flip's scaleX(-1) lives on an inner wrapper (.tfx-flip-inner) so the
		// transform doesn't ride on the same element that selection/caret
		// hit-testing keys off of — keeps parity with the compose box.
		const inner = fx === 'flip' ? `<span class="tfx-flip-inner">${html}</span>` : html;
		html = `<span class="tfx tfx-${fx}" data-fx="${fx}"${style}>${inner}</span>`;
	}
	return html;
}

export function ekTokenToUrl(d36, parentCp, childCp) {
	const date = 20200000 + parseInt(d36, 36);
	const pad = date < 20220500;
	const fmt = cp => 'u' + cp.split('-').map(s => pad ? s.padStart(4, '0') : s).join('-u');
	return `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${fmt(parentCp)}/${fmt(parentCp)}_${fmt(childCp)}.png`;
}

// ── Markup ↔ Segment conversion ──────────────────────────────────────────

export function normalizeLegacyMarkup(text) {
	const names = Object.keys(FX_TO_CHAR).join('|');
	text = text.replace(new RegExp(`\\[(${names})\\]`, 'g'), (_, fx) => FX_TO_CHAR[fx] ?? _);
	text = text.replace(new RegExp(`\\[\\/(${names})\\]`, 'g'), () => FX_CLOSE_CHAR);
	return text;
}

export function unicodeToReadable(markup) {
	let result = '', stack = [];
	for (let i = 0; i < markup.length; i++) {
		const ch = markup[i];
		if (ch === SZ_OPEN) {
			let j = i + 1, num = '';
			while (j < markup.length && markup[j] !== SZ_VEND) { num += markup[j]; j++; }
			result += `[sz:${num}]`; stack.push('sz'); i = j;
		} else if (FX_OPEN_CHARS.has(ch)) { result += `[${CHAR_TO_FX[ch]}]`; stack.push(CHAR_TO_FX[ch]); }
		else if (ch === FX_CLOSE_CHAR) { const fx = stack.pop(); if (fx) result += `[/${fx}]`; }
		else result += ch;
	}
	return result;
}

export function stripMarkup(text) {
	const withoutEk = text.replace(/\[ek:[a-z0-9]+:[0-9a-f-]+:[0-9a-f-]+\]/gi, '').replace(/\[ce:[a-zA-Z0-9_-]{1,32}\]/gi, '').replace(/\[tg:[0-9a-f-]+\]/gi, '').replace(/\[tgc:[A-Za-z0-9_]+:\d+\]/g, '');
	const normalized = normalizeLegacyMarkup(withoutEk);
	let result = '';
	for (let i = 0; i < normalized.length; i++) {
		const ch = normalized[i];
		if (ch === SZ_OPEN) { while (i < normalized.length && normalized[i] !== SZ_VEND) i++; continue; }
		if (!FX_OPEN_CHARS.has(ch) && ch !== FX_CLOSE_CHAR) result += ch;
	}
	return result;
}

/**
 * Strip size + text-effect markup but KEEP emote tokens ([ek:…], [ce:…],
 * [tg:…], [tgc:…]) and plain text. markupToSegments already drops the SZ
 * sentinels + FX PUA chars into structure (fxStack) and leaves everything else
 * — including emote tokens — in `text`, so flattening the segments yields the
 * content with all formatting removed but emotes intact. Used for reply quotes
 * so a reply to a giant/animated/bold message previews as normal-size text.
 */
export function stripFormatting(text) {
	return markupToSegments(text).map((s) => s.text).join('');
}

export function markupToSegments(markup) {
	const segs = [];
	let stack = [], textBuf = '';
	const flush = () => { if (textBuf) { segs.push({ text: textBuf, fxStack: [...stack] }); textBuf = ''; } };
	for (let i = 0; i < markup.length; i++) {
		const ch = markup[i];
		if (ch === SZ_OPEN) {
			flush();
			let j = i + 1, num = '';
			while (j < markup.length && markup[j] !== SZ_VEND) { num += markup[j]; j++; }
			stack.push('sz-' + num);
			i = j; // at SZ_VEND; loop ++ steps past it
		} else if (FX_OPEN_CHARS.has(ch)) {
			flush();
			stack.push(CHAR_TO_FX[ch]);
		} else if (ch === FX_CLOSE_CHAR) {
			flush();
			stack.pop();
		} else {
			textBuf += ch;
		}
	}
	flush();
	return segs;
}

export function segmentsToMarkup(segs) {
	let result = '', prevStack = [];
	for (const seg of segs) {
		let common = 0;
		while (common < prevStack.length && common < seg.fxStack.length && prevStack[common] === seg.fxStack[common]) common++;
		for (let i = prevStack.length; i > common; i--) result += FX_CLOSE_CHAR;
		for (let i = common; i < seg.fxStack.length; i++) {
			const fx = seg.fxStack[i];
			// continuous size → sentinel-encoded value; everything else → PUA char
			if (fx.startsWith('sz-')) result += SZ_OPEN + fx.slice(3) + SZ_VEND;
			else result += FX_TO_CHAR[fx] ?? '';
		}
		result += seg.text;
		prevStack = seg.fxStack;
	}
	for (let i = prevStack.length; i > 0; i--) result += FX_CLOSE_CHAR;
	return result;
}

// ── Jumbo emoji detection ────────────────────────────────────────────────

const _isEmojiSeg = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
const _segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
export const EMOJI_RE_G = /\p{Extended_Pictographic}/u;

export function jumboEmojiCount(content) {
	if (!_segmenter) return 0;
	// Zero-width caret anchors used by the compose box are not real content —
	// strip them so a lone emote still counts as jumbo.
	content = content.replace(/​/g, '');
	let ekCount = 0;
	let ceCount = 0;
	let tgCount = 0;
	let tgcCount = 0;
	const withoutEk = content.replace(/\[ek:[a-z0-9]+:[0-9a-f-]+:[0-9a-f-]+\]/gi, () => { ekCount++; return ''; });
	const withoutCe = withoutEk.replace(/\[ce:[a-zA-Z0-9_-]{1,32}\]/gi, () => { ceCount++; return ''; });
	const withoutTg = withoutCe.replace(/\[tg:[0-9a-f-]+\]/gi, () => { tgCount++; return ''; });
	const withoutTgc = withoutTg.replace(/\[tgc:[A-Za-z0-9_]+:\d+\]/g, () => { tgcCount++; return ''; });
	const plain = stripMarkup(withoutTgc).trim();
	const imgCount = ekCount + ceCount + tgCount + tgcCount;
	if (!plain && imgCount > 0) return imgCount <= 3 ? imgCount : 0;
	if (ekCount > 0 || ceCount > 0 || tgCount > 0 || tgcCount > 0) return 0;
	if (!plain) return 0;
	const segs = [..._segmenter.segment(plain)].map(s => s.segment);
	if (segs.length > 3 || segs.length === 0) return 0;
	if (!segs.every(_isEmojiSeg)) return 0;
	return segs.length;
}

const _jumboCache = new Map();
export function clearJumboCache() { _jumboCache.clear(); }
export function jumboEmojiCountM(content) {
	let v = _jumboCache.get(content);
	if (v === undefined) { v = jumboEmojiCount(content); _jumboCache.set(content, v); }
	return v;
}

export function bubbleFontSize(content, fontSize) {
	if (fontSize && fontSize !== 1) return `${(fontSize * 0.9).toFixed(2)}rem`;
	const jc = jumboEmojiCountM(content);
	if (jc > 0) return JUMBO_SIZES[jc - 1];
	return null;
}

// ── Code block rendering ─────────────────────────────────────────────────

const CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;

export { CODE_BLOCK_RE, INLINE_CODE_RE };

export function processCodeBlocks(text) {
	if (!text.includes('`')) return null;
	CODE_BLOCK_RE.lastIndex = 0;
	const blockMatches = [];
	let m;
	while ((m = CODE_BLOCK_RE.exec(text)) !== null) {
		blockMatches.push({ index: m.index, end: CODE_BLOCK_RE.lastIndex, lang: m[1], code: m[2] });
	}
	if (!blockMatches.length && !INLINE_CODE_RE.test(text)) return null;
	if (blockMatches.length) {
		const parts = [];
		let last = 0;
		for (const bm of blockMatches) {
			if (bm.index > last) parts.push({ type: 'text', content: text.slice(last, bm.index) });
			parts.push({ type: 'codeblock', lang: bm.lang, code: bm.code });
			last = bm.end;
		}
		if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });
		return parts;
	}
	return null;
}

// ── Content HTML renderer factory ────────────────────────────────────────
// Returns a contentHtml(text, split) function. Depends on:
//   - hljs: highlight.js instance (with languages registered)
//   - codeIcons: { lang → dataURI } map for code block headers
//   - getCeMap: () => { id → { shortcode, url } } for custom emoji
//   - wrapEmoji: (text) => html — wraps emoji with tooltips (optional)

export function createContentRenderer({ hljs = null, codeIcons = {}, getCeMap = () => ({}), wrapEmoji = null } = {}) {
	const LANG_ALIAS = {
		javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css',
		json: 'json', bash: 'bash', sh: 'bash', shell: 'bash', sql: 'sql',
		java: 'java', cpp: 'cpp', c: 'cpp', rust: 'rust', go: 'go', swift: 'swift',
		markdown: 'md', md: 'md', csv: 'csv', env: 'env', properties: 'env', 'env.example': 'envex'
	};

	function highlightCode(code, lang) {
		if (!hljs) return escapeHtml(code);
		try {
			if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
			return hljs.highlightAuto(code).value;
		} catch { return escapeHtml(code); }
	}

	function defaultWrapEmoji(text) {
		return EMOJI_RE_G.test(text) ? text.replace(/(\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}️‍]*)/gu, m => escapeHtml(m)) : escapeHtml(text);
	}

	const _wrapEmoji = wrapEmoji || defaultWrapEmoji;
	const EK_RE = /\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/gi;
	const CE_RE = /\[ce:([a-zA-Z0-9_-]{1,32})\]/gi;
	const TG_RE = /\[tg:([0-9a-f-]+)\]/gi;
	const TGC_RE = /\[tgc:([A-Za-z0-9_]+):(\d+)\]/g;

	function contentHtml(text, split = true) {
		if (!text) return '';
		const codeParts = processCodeBlocks(text);
		if (codeParts) {
			return codeParts.map(p => {
				if (p.type === 'codeblock') {
					const rawCode = p.code.replace(/\n$/, '');
					const highlighted = highlightCode(rawCode, p.lang);
					const lineCount = rawCode.split('\n').length;
					const lineNums = Array.from({ length: lineCount }, (_, i) => `<span class="code-ln">${i + 1}</span>`).join('');
					const langIcon = p.lang ? (codeIcons[p.lang] || codeIcons[LANG_ALIAS[p.lang]] || '') : '';
					const langLabel = p.lang ? `<span class="code-lang">${escapeHtml(p.lang)}${langIcon ? ` <img class="code-lang-icon" src="${langIcon}" alt="" />` : ''}</span>` : '';
					const copyBtn = `<button class="code-copy-btn" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="copy-label"> Copy</span></button>`;
					const truncated = lineCount > 20;
					const truncAttr = truncated ? ' data-truncated="1"' : '';
					const showMore = truncated ? `<button class="code-show-more">Show all ${lineCount} lines</button>` : '';
					return `<div class="code-block"${truncAttr}><div class="code-block-header">${copyBtn}${langLabel}</div><div class="code-body"><pre class="code-lines" aria-hidden="true">${lineNums}</pre><pre class="code-content"><code>${highlighted}</code></pre></div>${showMore}</div>`;
				}
				const trimmed = p.content.replace(/^\n+/, '').replace(/\n+$/, '');
				if (!trimmed) return '';
				return contentHtml(trimmed, split);
			}).join('');
		}
		if (text.includes('`')) {
			const inlined = text.replace(INLINE_CODE_RE, (_, code) => `<code class="inline-code">${escapeHtml(code)}</code>`);
			if (inlined !== text) {
				const splitParts = inlined.split(/(<code class="inline-code">.*?<\/code>)/);
				return splitParts.map(part => {
					if (part.startsWith('<code class="inline-code">')) return part;
					const raw = part.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
					return contentHtml(raw, split);
				}).join('');
			}
		}
		const hasEk = text.indexOf('[ek:') !== -1;
		const hasCe = text.indexOf('[ce:') !== -1;
		const hasTg = text.indexOf('[tg:') !== -1;
		const hasTgc = text.indexOf('[tgc:') !== -1;
		const hasFx = /[\uE100-\uE1FF]/.test(text);
		if (!hasEk && !hasCe && !hasTg && !hasTgc && !hasFx) return _wrapEmoji(text);

		const segs = markupToSegments(normalizeLegacyMarkup(text));
		if (!segs.length) return escapeHtml(text);

		let globalWi = 0;

		function renderText(chunk, fxStack) {
			if (!chunk) return '';
			if (!fxStack.length) return _wrapEmoji(chunk);
			// `flip` mirrors each EMOJI grapheme in place (emotes are mirrored
			// in the emote branch). Plain letters keep their normal flow — so
			// we split per-grapheme and only flip the emoji ones.
			if (fxStack.includes('flip') && _segmenter) {
				const noFlip = fxStack.filter(f => f !== 'flip');
				const graphemes = [..._segmenter.segment(chunk)].map(g => g.segment);
				const out = graphemes.map((g, i) => {
					if (/^\s+$/.test(g)) return escapeHtml(g);
					const isEmoji = _isEmojiSeg(g);
					const stack = isEmoji ? fxStack : noFlip;
					const inner = isEmoji ? _wrapEmoji(g) : escapeHtml(g);
					return stack.length ? nestedFxHtml(stack, inner, `${((globalWi + i) * 0.06).toFixed(2)}s`) : inner;
				}).join('');
				globalWi += graphemes.filter(g => !/^\s+$/.test(g)).length;
				return out;
			}
			// `ripple` applies per-grapheme.
			if (_segmenter && fxStack.includes('ripple')) {
				const graphemes = [..._segmenter.segment(chunk)].map(g => g.segment);
				const html = graphemes.map((g, i) =>
					/^\s+$/.test(g) ? escapeHtml(g) : nestedFxHtml(fxStack, escapeHtml(g), `${((globalWi + i) * 0.08).toFixed(2)}s`)
				).join('');
				globalWi += graphemes.filter(g => !/^\s+$/.test(g)).length;
				return html;
			}
			if (split && _segmenter) {
				const graphemes = [..._segmenter.segment(chunk)].map(g => g.segment);
				if (graphemes.length > 1 && graphemes.every(_isEmojiSeg)) {
					const html = graphemes.map((g, i) => nestedFxHtml(fxStack, escapeHtml(g), `${((globalWi + i) * 0.08).toFixed(2)}s`)).join('');
					globalWi += graphemes.length;
					return html;
				}
				const tokens = chunk.split(/(\s+)/);
				if (tokens.length > 1) {
					return tokens.map(tok => /^\s+$/.test(tok) ? escapeHtml(tok) : nestedFxHtml(fxStack, escapeHtml(tok), `${(globalWi++ * 0.06).toFixed(2)}s`)).join('');
				}
				return nestedFxHtml(fxStack, escapeHtml(chunk), `${(globalWi++ * 0.06).toFixed(2)}s`);
			}
			return nestedFxHtml(fxStack, escapeHtml(chunk));
		}

		return segs.map(s => {
			const segHasEk = s.text.includes('[ek:');
			const segHasCe = s.text.includes('[ce:');
			const segHasTg = s.text.includes('[tg:');
			const segHasTgc = s.text.includes('[tgc:');
			if (!segHasEk && !segHasCe && !segHasTg && !segHasTgc) return renderText(s.text, s.fxStack);
			const allMatches = [];
			if (segHasEk) {
				EK_RE.lastIndex = 0;
				let m;
				while ((m = EK_RE.exec(s.text)) !== null) {
					allMatches.push({ index: m.index, end: EK_RE.lastIndex, type: 'ek', match: m });
				}
			}
			if (segHasCe) {
				CE_RE.lastIndex = 0;
				let m;
				while ((m = CE_RE.exec(s.text)) !== null) {
					allMatches.push({ index: m.index, end: CE_RE.lastIndex, type: 'ce', match: m });
				}
			}
			if (segHasTg) {
				TG_RE.lastIndex = 0;
				let m;
				while ((m = TG_RE.exec(s.text)) !== null) {
					allMatches.push({ index: m.index, end: TG_RE.lastIndex, type: 'tg', match: m });
				}
			}
			if (segHasTgc) {
				TGC_RE.lastIndex = 0;
				let m;
				while ((m = TGC_RE.exec(s.text)) !== null) {
					allMatches.push({ index: m.index, end: TGC_RE.lastIndex, type: 'tgc', match: m });
				}
			}
			allMatches.sort((a, b) => a.index - b.index);
			const parts = [];
			let lastIdx = 0;
			for (const item of allMatches) {
				if (item.index > lastIdx) parts.push(renderText(s.text.slice(lastIdx, item.index), s.fxStack));
				if (item.type === 'ek') {
					const m = item.match;
					const url = ekTokenToUrl(m[1], m[2], m[3]);
					const imgHtml = `<img class="ek-img" data-ek="${escapeHtml(m[0])}" src="${url}" loading="lazy" alt="" />`;
					parts.push(s.fxStack.length ? nestedFxHtml(s.fxStack, imgHtml, split ? `${(globalWi++ * 0.06).toFixed(2)}s` : null) : imgHtml);
				} else if (item.type === 'tg') {
					const cp = item.match[1];
					const tgToken = item.match[0];
					const tgHtml = `<span class="tg-emoji" data-tg-cp="${escapeHtml(cp)}" data-tg="${escapeHtml(tgToken)}" role="img" aria-label="emoji"></span>`;
					parts.push(s.fxStack.length ? nestedFxHtml(s.fxStack, tgHtml, split ? `${(globalWi++ * 0.06).toFixed(2)}s` : null) : tgHtml);
				} else if (item.type === 'tgc') {
					const short = item.match[1];
					const id = item.match[2];
					const token = item.match[0];
					const html = `<span class="tg-emoji tgc-emoji" data-tg-pack="${escapeHtml(short)}" data-tg-id="${escapeHtml(id)}" data-tg="${escapeHtml(token)}" role="img" aria-label="custom emoji"></span>`;
					parts.push(s.fxStack.length ? nestedFxHtml(s.fxStack, html, split ? `${(globalWi++ * 0.06).toFixed(2)}s` : null) : html);
				} else {
					const ceId = item.match[1];
					const ceToken = item.match[0];
					const ceData = getCeMap()[ceId];
					let emoteHtml;
					if (ceData?.url) {
						const ceAlt = ':' + ceData.shortcode + ':';
						// `onerror` falls back to the :shortcode: text if the image URL is
						// dead (e.g. an R2 file that got cleaned up), instead of a broken icon.
						emoteHtml = `<img class="ce-img" data-ce="${escapeHtml(ceToken)}" src="${escapeHtml(ceData.url)}" alt="${escapeHtml(ceAlt)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ce-missing',textContent:':${escapeHtml(ceId)}:'}))" />`;
					} else {
						// Custom emote not in the loaded map (renamed / removed / no URL) —
						// show the shortcode as text so it's identifiable, not a blank box.
						emoteHtml = `<span class="ce-missing" data-ce="${escapeHtml(ceToken)}" title="custom emote :${escapeHtml(ceId)}: not found">:${escapeHtml(ceId)}:</span>`;
					}
					parts.push(s.fxStack.length ? nestedFxHtml(s.fxStack, emoteHtml, split ? `${(globalWi++ * 0.06).toFixed(2)}s` : null) : emoteHtml);
				}
				lastIdx = item.end;
			}
			if (lastIdx < s.text.length) parts.push(renderText(s.text.slice(lastIdx), s.fxStack));
			return parts.join('');
		}).join('');
	}

	const _htmlCache = new Map();
	function contentHtmlM(text, split = true) {
		const key = (split ? '1' : '0') + text;
		let v = _htmlCache.get(key);
		if (v === undefined) { v = contentHtml(text, split); _htmlCache.set(key, v); }
		return v;
	}

	function clearCache() { _htmlCache.clear(); }

	return { contentHtml, contentHtmlM, clearCache };
}
