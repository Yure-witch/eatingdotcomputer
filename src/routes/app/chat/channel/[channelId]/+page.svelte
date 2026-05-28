<script>
	import { onMount, onDestroy, tick, getContext } from 'svelte';
	import { db } from '$lib/firebase.js';
	import { ref, onChildAdded, onValue, off, query, limitToLast, set, remove, get } from 'firebase/database';
	import { normaliseMessage, buildUserMap, formatTime } from '$lib/chat.js';
	import { scallopedClip, starburstClip } from '$lib/scalloped.js';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import EmojiKitchen from '$lib/components/EmojiKitchen.svelte';
	import CustomEmojiPanel from '$lib/components/CustomEmojiPanel.svelte';
	import TelegramEmojiPanel from '$lib/components/TelegramEmojiPanel.svelte';
	import GifPicker from '$lib/components/GifPicker.svelte';
	import lottie from 'lottie-web';
	import { loadTelegramEmoji, getCachedTgEmoji, tgEntry, tgAnimatedUrl, tgFlagUrl, tgAnimationUrl, fetchLottie, cpToToken,
		loadCustomPacks, getCachedCustomPacks, tgcUrl, tgcToToken, tgcEntry, isStaticPack, STATIC_FRAME_INDEX } from '$lib/telegram-emoji-store.js';
	import { tryPlay as _tgTryPlay, yieldPlay as _tgYieldPlay } from '$lib/lottie-throttle.js';
	import { tgStaticFrame, tgcStaticFrame, TG_PLACEHOLDER } from '$lib/tg-frame.js';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import { loadEmojiNames, getEmojiName } from '$lib/emoji-names.js';
	import { initSemanticSearch, searchEmoji, cpToChar, onSemanticReady } from '$lib/emoji-semantic.js';
	import { getCustomEmojiMap, getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import {
		SCREEN_FXS, EXPRESSIVE_FXS, TEXT_FXS, FX_TO_CHAR, CHAR_TO_FX, FX_CLOSE_CHAR, FX_OPEN_CHARS,
		TEXT_COLORS, WDTH_FX_MAP, WDTH_STEPS, WGHT_FX_MAP, WGHT_STEPS, SZ_FX_MAP, SZ_STEPS,
		JUMBO_SIZES, EMOJI_RE_G,
		escapeHtml, nestedFxHtml, ekTokenToUrl, normalizeLegacyMarkup, unicodeToReadable, stripMarkup,
		markupToSegments, segmentsToMarkup, jumboEmojiCount, jumboEmojiCountM, bubbleFontSize,
		createContentRenderer, clearJumboCache
	} from '$lib/message-render.js';
	import hljs from 'highlight.js/lib/core';
	import hljsJavascript from 'highlight.js/lib/languages/javascript';
	import hljsPython from 'highlight.js/lib/languages/python';
	import hljsHtml from 'highlight.js/lib/languages/xml';
	import hljsCss from 'highlight.js/lib/languages/css';
	import hljsJson from 'highlight.js/lib/languages/json';
	import hljsTypescript from 'highlight.js/lib/languages/typescript';
	import hljsBash from 'highlight.js/lib/languages/bash';
	import hljsMarkdown from 'highlight.js/lib/languages/markdown';
	import hljsSql from 'highlight.js/lib/languages/sql';
	import hljsJava from 'highlight.js/lib/languages/java';
	import hljsCpp from 'highlight.js/lib/languages/cpp';
	import hljsRust from 'highlight.js/lib/languages/rust';
	import hljsGo from 'highlight.js/lib/languages/go';
	import hljsSwift from 'highlight.js/lib/languages/swift';
	import hljsIni from 'highlight.js/lib/languages/ini';
	hljs.registerLanguage('javascript', hljsJavascript);
	hljs.registerLanguage('js', hljsJavascript);
	hljs.registerLanguage('python', hljsPython);
	hljs.registerLanguage('py', hljsPython);
	hljs.registerLanguage('html', hljsHtml);
	hljs.registerLanguage('xml', hljsHtml);
	hljs.registerLanguage('svg', hljsHtml);
	hljs.registerLanguage('css', hljsCss);
	hljs.registerLanguage('json', hljsJson);
	hljs.registerLanguage('typescript', hljsTypescript);
	hljs.registerLanguage('ts', hljsTypescript);
	hljs.registerLanguage('bash', hljsBash);
	hljs.registerLanguage('sh', hljsBash);
	hljs.registerLanguage('shell', hljsBash);
	hljs.registerLanguage('markdown', hljsMarkdown);
	hljs.registerLanguage('md', hljsMarkdown);
	hljs.registerLanguage('sql', hljsSql);
	hljs.registerLanguage('java', hljsJava);
	hljs.registerLanguage('cpp', hljsCpp);
	hljs.registerLanguage('c', hljsCpp);
	hljs.registerLanguage('rust', hljsRust);
	hljs.registerLanguage('go', hljsGo);
	hljs.registerLanguage('swift', hljsSwift);
	hljs.registerLanguage('ini', hljsIni);
	hljs.registerLanguage('env', hljsIni);
	hljs.registerLanguage('properties', hljsIni);
	hljs.registerLanguage('csv', () => ({ name: 'CSV', contains: [{ className: 'string', begin: '"', end: '"' }] }));

	let { data } = $props();

	const openSidebar = getContext('openSidebar');
	const userMap = buildUserMap(data.currentUser, data.users);
	const convId = data.channelId;

	let messages = $state([...data.history]);
	let hasMoreHistory = $state(data.hasMoreHistory ?? false);
	let loadingMore = $state(false);
	let input = $state('');
	let emojiNames = $state({});
	let emojiTooltip = $state(null); // { type, anchorX, anchorY, ...data }
	let sending = $state(false);
	let slowPendingIds = $state(new Set());
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
	let showCustomEmoji = $state(false);
	let showTgEmoji = $state(false);
	let showGifPicker = $state(false);
	let _ceMap = $state({}); // custom emoji map { [id]: {shortcode, url} }

	// Message effects
	let messageEffect = $state(null); // null | 'rainbow' | 'hearts'
	let showEffectPanel = $state(false);

	// Font size (multiplier; 1.0 = default 0.9rem)
	let messageFontSize = $state(1.0);
	let messageFontWeight = $state(400);
	let messageFontStretch = $state(100);
	let wiggleSize = $state(6);
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
		{ name: 'rainbow',      label: 'Rainbow',      icon: '🌈' },
		{ name: 'rainbow-fill', label: 'Rainbow Fill', icon: '🫧' },
		{ name: 'hearts',       label: 'Hearts',       icon: '💗' },
		{ name: 'wiggly',       label: 'Wiggly',       icon: '〰️' },
		{ name: 'cursed',       label: 'Cursed',       icon: '🌀' },
		{ name: 'scalloped',    label: 'Scalloped',    icon: '🫧' },
		{ name: 'starburst',    label: 'Starburst',    icon: '✴️' },
	];

	// ── Emoji tooltip ────────────────────────────────────────────────────────
	function ekCpToChar(cp) {
		return String.fromCodePoint(...cp.split('-').map(p => parseInt(p, 16)));
	}

	const TIP_W = 160, TIP_MARGIN = 8;
	function tipLeft(centerX) {
		return Math.max(TIP_MARGIN, Math.min(centerX - TIP_W / 2, window.innerWidth - TIP_W - TIP_MARGIN));
	}

	function onMsgListMouseover(e) {
		const eTip = e.target.closest?.('.e-tip');
		if (!eTip) return;
		const pop = eTip.querySelector('.e-tip-pop');
		if (!pop) return;
		const rect = eTip.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		pop.style.left = Math.max(TIP_MARGIN, Math.min(cx - TIP_W / 2, window.innerWidth - TIP_W - TIP_MARGIN)) + 'px';
		pop.style.top = (rect.bottom + 10) + 'px';
		pop.style.transform = 'none';
	}

	function onMsgListMousemove(e) {
		const target = e.target;
		// EK image
		if (target.dataset?.ek) {
			const m = target.dataset.ek.match(/\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/i);
			if (m) {
				const parentChar = ekCpToChar(m[2]), childChar = ekCpToChar(m[3]);
				const rect = target.getBoundingClientRect();
				const isJumbo = !!target.closest('.jumbo-emoji');
				emojiTooltip = { type: 'ek', left: tipLeft(rect.left + rect.width / 2), anchorY: rect.bottom,
					url: isJumbo ? null : ekTokenToUrl(m[1], m[2], m[3]), parentChar, childChar };
				return;
			}
		}
		// CE image
		if (target.dataset?.ce) {
			const m = target.dataset.ce.match(/\[ce:([a-zA-Z0-9_-]+)\]/);
			if (m) {
				const shortcode = m[1];
				const rect = target.getBoundingClientRect();
				emojiTooltip = { type: 'ce', left: tipLeft(rect.left + rect.width / 2), anchorY: rect.bottom,
					url: getCachedCustomEmojiMap()[shortcode]?.url, shortcode };
				return;
			}
		}
		emojiTooltip = null;
	}

	function onMsgListMouseleave() { emojiTooltip = null; }

	const _isEmojiSeg = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
	const _segmenter = new Intl.Segmenter();
	// Strip skin-tone modifiers, ZWJ, and variation selectors to get base emoji
	const MODIFIER_STRIP_RE = /[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu;
	const SKIN_TONE_NAMES = {
		'\u{1F3FB}': 'light skin tone', '\u{1F3FC}': 'medium-light skin tone',
		'\u{1F3FD}': 'medium skin tone', '\u{1F3FE}': 'medium-dark skin tone', '\u{1F3FF}': 'dark skin tone'
	};
	const SKIN_STRIP_RE = /[\u{1F3FB}-\u{1F3FF}]/gu;
	function emojiDisplayName(g) {
		const direct = getEmojiName(g);
		if (direct) return direct;
		// Collect all skin tones in order
		const skinTones = [...g.matchAll(SKIN_STRIP_RE)].map(m => SKIN_TONE_NAMES[m[0]]);
		// 1. Strip only skin tones, keep ZWJ/VS16 → try as single concept
		const noSkin = g.replace(SKIN_STRIP_RE, '');
		let baseName = getEmojiName(noSkin) || getEmojiName(noSkin.replace(/\uFE0F/g, ''));
		if (baseName) return skinTones.length ? `${baseName}: ${skinTones.join(', ')}` : baseName;
		// 2. Strip everything → try as single concept
		const fullyStripped = g.replace(MODIFIER_STRIP_RE, '');
		baseName = fullyStripped ? getEmojiName(fullyStripped) : null;
		if (baseName) return skinTones.length ? `${baseName}: ${skinTones.join(', ')}` : baseName;
		// 3. Try first pictographic base
		if (fullyStripped) {
			const parts = [..._segmenter.segment(fullyStripped)].filter(s => EMOJI_RE_G.test(s.segment));
			if (parts.length === 1) {
				baseName = getEmojiName(parts[0].segment);
				if (baseName) {
					const qualifiers = [...skinTones];
					if (g.includes('\u2640')) qualifiers.unshift('woman');
					else if (g.includes('\u2642')) qualifiers.unshift('man');
					if (g.includes('\u27A1')) qualifiers.push('facing right');
					else if (g.includes('\u2B05')) qualifiers.push('facing left');
					return qualifiers.length ? `${baseName}: ${qualifiers.join(', ')}` : baseName;
				}
			}
			// 4. Multiple base pictographics — name each ZWJ component
			if (parts.length > 1) {
				const componentNames = [];
				const zwjParts = g.split('\u200D').filter(p => p.length > 0);
				for (const part of zwjParts) {
					const clean = part.replace(/\uFE0F/g, '');
					if (clean === '\u2640' || clean === '\u2642' || clean === '\u27A1' || clean === '\u2B05') continue;
					const skin = clean.match(SKIN_STRIP_RE)?.[0];
					const base = clean.replace(SKIN_STRIP_RE, '');
					const bName = base ? getEmojiName(base) : null;
					const sName = skin ? SKIN_TONE_NAMES[skin] : null;
					if (bName && sName) componentNames.push(`${bName}: ${sName}`);
					else if (bName) componentNames.push(bName);
				}
				if (componentNames.length > 1) return componentNames.join(' + ');
				if (componentNames.length === 1) return componentNames[0];
			}
		}
		return null;
	}
	function wrapEmojiInText(text) {
		const segs = [..._segmenter.segment(text)];
		return segs.map(seg => {
			const g = seg.segment;
			if (EMOJI_RE_G.test(g)) {
				const esc = escapeHtml(g);
				const name = emojiDisplayName(g);
				const nameHtml = name ? `<span class="e-tip-name">${escapeHtml(name)}</span>` : '';
				return `<span class="e-tip">${esc}<span class="e-tip-pop"><span class="e-tip-char">${esc}</span>${nameHtml}</span></span>`;
			}
			return escapeHtml(g);
		}).join('');
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
	let showCodePanel = $state(false);
	let ceCodeLangPicker = $state(null); // { el, x, y } — code block element being changed
	function _codeIcon(svg) { return `data:image/svg+xml,${encodeURIComponent(svg)}`; }
	const _ci = {
		js: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" font-size="11" font-weight="700" font-family="sans-serif" fill="#CBCB41">JS</text></svg>`),
		ts: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" font-size="11" font-weight="700" font-family="sans-serif" fill="#3178C6">TS</text></svg>`),
		py: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1C5.5 1 4 2 4 3.5V5h4v1H3C1.5 6 0 7.5 0 9.5S1.5 13 3 13h1.5v-2c0-1 1-2 2-2h3c1 0 2-1 2-2V3.5C11.5 2 10.5 1 8 1zm-2 1.5a.75.75 0 110 1.5.75.75 0 010-1.5z" fill="#3776AB"/><path d="M8 15c2.5 0 4-1 4-2.5V11H8v-1h5c1.5 0 3-1.5 3-3.5S14.5 3 13 3h-1.5v2c0 1-1 2-2 2h-3c-1 0-2 1-2 2v3.5C4.5 14 5.5 15 8 15zm2-1.5a.75.75 0 110-1.5.75.75 0 010 1.5z" fill="#FFD43B"/></svg>`),
		html: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M5 2.5L1.5 8L5 13.5" fill="none" stroke="#E44D26" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 2.5L14.5 8L11 13.5" fill="none" stroke="#E44D26" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
		css: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" font-size="14" font-weight="700" font-family="sans-serif" fill="#519aba">#</text></svg>`),
		json: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" font-size="12" font-weight="700" font-family="sans-serif" fill="#CBCB41">{ }</text></svg>`),
		bash: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#333"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="monospace" fill="#0f0">&gt;_</text></svg>`),
		sql: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><ellipse cx="8" cy="4" rx="6" ry="2.5" fill="#e8c33a"/><path d="M2 4v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4" fill="none" stroke="#e8c33a" stroke-width="1.5"/><ellipse cx="8" cy="12" rx="6" ry="2.5" fill="none" stroke="#e8c33a" stroke-width="0"/></svg>`),
		java: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" font-size="11" font-weight="700" font-family="serif" fill="#E76F00">☕</text></svg>`),
		cpp: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#659AD2"/><text x="8" y="12" text-anchor="middle" font-size="7" font-weight="700" font-family="sans-serif" fill="#fff">C++</text></svg>`),
		rust: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#a72145" stroke-width="1.5"/><text x="8" y="11.5" text-anchor="middle" font-size="8" font-weight="700" font-family="sans-serif" fill="#a72145">R</text></svg>`),
		go: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="sans-serif" fill="#00ADD8">Go</text></svg>`),
		swift: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#F05138"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="sans-serif" fill="#fff">S</text></svg>`),
		md: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#555"/><text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="sans-serif" fill="#fff">M↓</text></svg>`),
		csv: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="1.5" fill="none" stroke="#89d185" stroke-width="1.3"/><line x1="1" y1="6" x2="15" y2="6" stroke="#89d185" stroke-width="1"/><line x1="1" y1="10" x2="15" y2="10" stroke="#89d185" stroke-width="1"/><line x1="6" y1="2" x2="6" y2="14" stroke="#89d185" stroke-width="1"/><line x1="11" y1="2" x2="11" y2="14" stroke="#89d185" stroke-width="1"/></svg>`),
		env: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="none" stroke="#9b9b9b" stroke-width="1.5"/><g stroke="#9b9b9b" stroke-width="1.3" stroke-linecap="round"><line x1="8" y1="1.5" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="14.5" y2="8"/><line x1="3.4" y1="3.4" x2="4.8" y2="4.8"/><line x1="11.2" y1="11.2" x2="12.6" y2="12.6"/><line x1="3.4" y1="12.6" x2="4.8" y2="11.2"/><line x1="11.2" y1="4.8" x2="12.6" y2="3.4"/></g></svg>`),
		envex: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" text-anchor="middle" font-size="14" font-weight="700" font-family="monospace" fill="#89d185">$</text></svg>`),
		plain: _codeIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="1" width="12" height="14" rx="1.5" fill="none" stroke="#9399b2" stroke-width="1.3"/><line x1="5" y1="5" x2="11" y2="5" stroke="#9399b2" stroke-width="1"/><line x1="5" y1="8" x2="11" y2="8" stroke="#9399b2" stroke-width="1"/><line x1="5" y1="11" x2="9" y2="11" stroke="#9399b2" stroke-width="1"/></svg>`),
	};
	const { contentHtml, contentHtmlM, clearCache: _clearHtmlCache } = createContentRenderer({ hljs, codeIcons: _ci, getCeMap: getCachedCustomEmojiMap, wrapEmoji: wrapEmojiInText });
	const CODE_LANGUAGES = [
		{ id: 'javascript', label: 'JavaScript', icon: _ci.js },
		{ id: 'typescript', label: 'TypeScript', icon: _ci.ts },
		{ id: 'python', label: 'Python', icon: _ci.py },
		{ id: 'html', label: 'HTML', icon: _ci.html },
		{ id: 'css', label: 'CSS', icon: _ci.css },
		{ id: 'json', label: 'JSON', icon: _ci.json },
		{ id: 'bash', label: 'Bash', icon: _ci.bash },
		{ id: 'sql', label: 'SQL', icon: _ci.sql },
		{ id: 'java', label: 'Java', icon: _ci.java },
		{ id: 'cpp', label: 'C/C++', icon: _ci.cpp },
		{ id: 'rust', label: 'Rust', icon: _ci.rust },
		{ id: 'go', label: 'Go', icon: _ci.go },
		{ id: 'swift', label: 'Swift', icon: _ci.swift },
		{ id: 'markdown', label: 'Markdown', icon: _ci.md },
		{ id: 'csv', label: 'CSV', icon: _ci.csv },
		{ id: 'env', label: '.env', icon: _ci.env },
		{ id: 'env', label: '.env.example', icon: _ci.envex },
		{ id: '', label: 'Plain / Generic', icon: _ci.plain },
	];
	function toggleCodeBlock() {
		if (!inputEl) return;
		if (undoStack.length >= 50) undoStack.shift();
		undoStack.push(input);
		redoStack.length = 0;
		const markup = serializeCe(inputEl);
		const trimmed = markup.trim();
		if (/^```\w*\n[\s\S]*\n```$/.test(trimmed)) {
			const unwrapped = trimmed.replace(/^```\w*\n/, '').replace(/\n```$/, '');
			setCeInput(unwrapped);
			detectedCodeLang = detectCode(unwrapped);
			return;
		}
		insertCodeBlock('');
	}
	function insertCodeBlock(lang) {
		if (!inputEl) return;
		// Get selected text and selection offsets
		const sel = window.getSelection();
		let selStart = 0, selEnd = 0, hasSelection = false;
		if (sel && !sel.isCollapsed && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			selStart = cePlainOffset(inputEl, range.startContainer, range.startOffset);
			selEnd = cePlainOffset(inputEl, range.endContainer, range.endOffset);
			hasSelection = selEnd > selStart;
		}
		// Operate on the markup string directly
		const currentMarkup = serializeCe(inputEl);
		let before, selected, after;
		if (hasSelection) {
			// Extract text at the segment level (strip PUA to get plain offsets right)
			const segs = markupToSegments(currentMarkup);
			let pos = 0; before = ''; selected = ''; after = '';
			for (const seg of segs) {
				const segStart = pos, segEnd = pos + seg.text.length;
				if (segEnd <= selStart) { before += segmentsToMarkup([seg]); }
				else if (segStart >= selEnd) { after += segmentsToMarkup([seg]); }
				else {
					const oStart = Math.max(segStart, selStart) - segStart;
					const oEnd = Math.min(segEnd, selEnd) - segStart;
					if (oStart > 0) before += segmentsToMarkup([{ text: seg.text.slice(0, oStart), fxStack: seg.fxStack }]);
					selected += seg.text.slice(oStart, oEnd); // plain text only for code
					if (oEnd < seg.text.length) after += segmentsToMarkup([{ text: seg.text.slice(oEnd), fxStack: seg.fxStack }]);
				}
				pos += seg.text.length;
			}
		} else {
			before = currentMarkup;
			selected = '';
			after = '';
		}
		const block = '```' + lang + '\n' + selected + '\n```';
		const newMarkup = before + block + after;
		setCeInput(newMarkup);
		showCodePanel = false;
	}
	let undoStack = [];
	let redoStack = [];

	// ── Emoji suggestions (semantic) ─────────────────────────────────────────
	let emojiSuggestions = $state([]); // [{ e, n }]
	let _suggDebounce = null;
	let _semanticPausedUntil = 0; // cooldown: skip embedding after a no-match result

	// ── Custom emoji colon-shortcode autocomplete ─────────────────────────────
	let ceSuggestions = $state([]); // [{ shortcode, url }]
	const CE_COLON_RE = /:([a-zA-Z0-9_-]*)$/;

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
			if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'IMG' && (node.dataset.ek || node.dataset.ce || node.dataset.tg)) {
				const tokenLen = (node.dataset.ek || node.dataset.ce || node.dataset.tg).length;
				if (pos + tokenLen >= target) {
					const idx = Array.from(node.parentNode.childNodes).indexOf(node);
					return { node: node.parentNode, offset: target === pos ? idx : idx + 1 };
				}
				pos += tokenLen;
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
				} else if (node.tagName === 'IMG' && node.dataset.ce) {
					result += node.dataset.ce;
				} else if (node.tagName === 'IMG' && node.dataset.tg) {
					result += node.dataset.tg;
				} else if (node.dataset?.fx) {
					const fxStack = node.dataset.fx.split(' ').filter(fx => FX_TO_CHAR[fx]);
					result += fxStack.map(fx => FX_TO_CHAR[fx]).join('') + serializeCe(node) + FX_CLOSE_CHAR.repeat(fxStack.length);
				} else if (node.tagName === 'BR') {
					result += '\n';
				} else if (node.classList?.contains('e-tip-pop')) {
					// Skip tooltip popups — not content
				} else if (node.classList?.contains('code-block') || node.classList?.contains('code-block-ce')) {
					const lang = node.dataset?.lang ?? (node.querySelector('.code-lang')?.textContent ?? '').trim();
					const cePre = node.querySelector('.code-block-ce-code');
					const code = cePre ? cePre.textContent : (node.querySelector('code')?.textContent ?? '');
					result += '```' + lang + '\n' + code + '\n```';
				} else if (node.classList?.contains('inline-code')) {
					result += '`' + node.textContent + '`';
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
		const wdthFx = fxStack.find(fx => fx.startsWith('wdth-'));
		const wghtFx = fxStack.find(fx => fx.startsWith('wght-'));
		const szFx = fxStack.find(fx => fx.startsWith('sz-'));
		const animFx = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike' && !fx.startsWith('wdth-') && !fx.startsWith('wght-') && !fx.startsWith('sz-'));
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
			if (delay) span.style.animationDelay = delay;
			span.appendChild(innerNode);
			innerNode = span;
		}
		return innerNode;
	}

	// Unicode markup → DOM nodes (nested spans — one per effect for composable CSS animations)
	// Unicode markup → DOM nodes, with EK token support and correct FX wrapping on EK images
	let _ceCodeRehighlightTimer = null;
	function rehighlightCodeBlock(pre, lang) {
		// Get cursor offset as plain text position
		const sel = window.getSelection();
		let cursorOff = 0;
		if (sel?.rangeCount && pre.contains(sel.anchorNode)) {
			const r = document.createRange();
			r.setStart(pre, 0);
			r.setEnd(sel.anchorNode, sel.anchorOffset);
			cursorOff = r.toString().length;
		}
		const raw = pre.textContent;
		const highlighted = highlightCode(raw.replace(/\n$/, ''), lang);
		pre.innerHTML = `<code>${highlighted}</code>`;
		// Restore cursor
		try {
			let pos = 0, done = false;
			function walk(node) {
				if (done) return;
				if (node.nodeType === Node.TEXT_NODE) {
					if (pos + node.length >= cursorOff) {
						const r = document.createRange();
						r.setStart(node, cursorOff - pos);
						r.collapse(true);
						sel.removeAllRanges();
						sel.addRange(r);
						done = true;
						return;
					}
					pos += node.length;
				} else {
					for (const c of node.childNodes) { if (done) break; walk(c); }
				}
			}
			walk(pre);
		} catch {}
	}

	function makeCodeBlockNode(lang, code) {
		const div = document.createElement('div');
		div.className = 'code-block-ce';
		div.dataset.lang = lang;
		div.dataset.code = code;
		const header = document.createElement('div');
		header.className = 'code-block-ce-header';
		header.setAttribute('contenteditable', 'false');
		const langIcon = lang ? (_ci[lang] || _ci[{javascript:'js',typescript:'ts',python:'py',html:'html',css:'css',json:'json',bash:'bash',sh:'bash',sql:'sql',java:'java',cpp:'cpp',c:'cpp',rust:'rust',go:'go',swift:'swift',markdown:'md',md:'md',csv:'csv',env:'env'}[lang]] || '') : '';
		header.innerHTML = `<span class="code-block-ce-lang">${lang ? escapeHtml(lang) : 'code'}${langIcon ? ` <img class="ce-code-icon" src="${langIcon}" alt="" />` : ''}</span><button class="ce-code-lang-btn" title="Change language">▾</button>`;
		div.appendChild(header);
		const pre = document.createElement('pre');
		pre.className = 'code-block-ce-code';
		const highlighted = highlightCode(code.replace(/\n$/, ''), lang);
		pre.innerHTML = `<code>${highlighted}</code>`;
		pre.addEventListener('input', () => {
			clearTimeout(_ceCodeRehighlightTimer);
			_ceCodeRehighlightTimer = setTimeout(() => rehighlightCodeBlock(pre, div.dataset.lang), 300);
		});
		div.appendChild(pre);
		return div;
	}

	function ceMarkupToNodes(markup) {
		// Pre-pass: extract code blocks and split markup into parts
		const CB_RE = /```(\w*)\n([\s\S]*?)\n```/g;
		const parts = [];
		let last = 0, m;
		while ((m = CB_RE.exec(markup)) !== null) {
			if (m.index > last) parts.push({ type: 'text', content: markup.slice(last, m.index) });
			parts.push({ type: 'codeblock', lang: m[1], code: m[2] });
			last = CB_RE.lastIndex;
		}
		if (last < markup.length) parts.push({ type: 'text', content: markup.slice(last) });
		if (parts.some(p => p.type === 'codeblock')) {
			const allNodes = [];
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				if (part.type === 'codeblock') {
					allNodes.push(makeCodeBlockNode(part.lang, part.code));
					// Only add trailing text node if there's more content after this code block
					const hasMore = parts.slice(i + 1).some(p => p.type !== 'codeblock' ? p.content?.trim() : true);
					if (hasMore) allNodes.push(document.createTextNode('\u200B'));
				} else if (part.content) {
					allNodes.push(...ceMarkupToNodes(part.content));
				}
			}
			return allNodes;
		}

		const EK_RE = /\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/gi;
		const CE_RE = /\[ce:([a-zA-Z0-9_-]{1,32})\]/gi;
		const TG_RE = /\[tg:([0-9a-f-]+)\]/gi;
		const TGC_RE = /\[tgc:([A-Za-z0-9_]+):(\d+)\]/g;
		const segs = markupToSegments(normalizeLegacyMarkup(markup));
		const nodes = [];
		let globalWi = 0;

		function makeEkImg(token, d36, parentCp, childCp) {
			const img = document.createElement('img');
			img.src = ekTokenToUrl(d36, parentCp, childCp);
			img.dataset.ek = token;
			img.className = 'ek-img ek-img-ce';
			img.setAttribute('contenteditable', 'false');
			img.setAttribute('alt', '');
			return img;
		}

		function wrapInFx(el, fxStack, delay) {
			if (!fxStack.length) return el;
			const decorFx = fxStack.filter(fx => fx === 'underline' || fx === 'strike');
			const animFx  = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike');
			let node = el;
			if (decorFx.length) {
				const span = document.createElement('span');
				span.className = `tfx ${decorFx.map(fx => `tfx-${fx}`).join(' ')}`;
				span.dataset.fx = decorFx.join(' ');
				span.style.textDecorationLine = decorFx.map(fx => fx === 'underline' ? 'underline' : 'line-through').join(' ');
				span.style.textUnderlineOffset = '2px';
				span.appendChild(node); node = span;
			}
			for (let i = animFx.length - 1; i >= 0; i--) {
				const span = document.createElement('span');
				span.className = `tfx tfx-${animFx[i]}`;
				span.dataset.fx = animFx[i];
				if (delay) span.style.animationDelay = delay;
				span.appendChild(node); node = span;
			}
			return node;
		}

		function pushText(text, fxStack) {
			if (!text) return;
			if (!fxStack.length) { nodes.push(document.createTextNode(text)); return; }
			if (fxStack.includes('ripple')) {
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				gs.forEach((g, i) => {
					if (/^\s+$/.test(g)) nodes.push(document.createTextNode(g));
					else nodes.push(makeFxNode(fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`));
				});
				globalWi += gs.filter(g => !/^\s+$/.test(g)).length;
				return;
			}
			if (fxSplitWords) {
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

		for (const seg of segs) {
			const hasEk = seg.text.includes('[ek:');
			const hasCe = seg.text.includes('[ce:');
			const hasTg = seg.text.includes('[tg:');
			const hasTgc = seg.text.includes('[tgc:');
			if (!hasEk && !hasCe && !hasTg && !hasTgc) { pushText(seg.text, seg.fxStack); continue; }
			// Segment contains EK/CE tokens — split and wrap each in the segment's fxStack
			// Build a combined regex for both token types and sort matches by position
			let lastIdx = 0;
			const allMatches = [];
			if (hasEk) {
				EK_RE.lastIndex = 0;
				let m;
				while ((m = EK_RE.exec(seg.text)) !== null) {
					allMatches.push({ index: m.index, end: EK_RE.lastIndex, type: 'ek', match: m });
				}
			}
			if (hasCe) {
				CE_RE.lastIndex = 0;
				let m;
				while ((m = CE_RE.exec(seg.text)) !== null) {
					allMatches.push({ index: m.index, end: CE_RE.lastIndex, type: 'ce', match: m });
				}
			}
			if (hasTg) {
				TG_RE.lastIndex = 0;
				let m;
				while ((m = TG_RE.exec(seg.text)) !== null) {
					allMatches.push({ index: m.index, end: TG_RE.lastIndex, type: 'tg', match: m });
				}
			}
			if (hasTgc) {
				TGC_RE.lastIndex = 0;
				let m;
				while ((m = TGC_RE.exec(seg.text)) !== null) {
					allMatches.push({ index: m.index, end: TGC_RE.lastIndex, type: 'tgc', match: m });
				}
			}
			allMatches.sort((a, b) => a.index - b.index);
			for (const item of allMatches) {
				if (item.index > lastIdx) pushText(seg.text.slice(lastIdx, item.index), seg.fxStack);
				if (item.type === 'ek') {
					const m = item.match;
					const img = makeEkImg(m[0], m[1], m[2], m[3]);
					nodes.push(wrapInFx(img, seg.fxStack, fxSplitWords ? `${(globalWi++ * 0.06).toFixed(2)}s` : undefined));
				} else if (item.type === 'tg') {
					const img = makeTgImg(item.match[1], item.match[0]);
					nodes.push(wrapInFx(img, seg.fxStack, fxSplitWords ? `${(globalWi++ * 0.06).toFixed(2)}s` : undefined));
				} else if (item.type === 'tgc') {
					const img = makeTgcImg(item.match[1], item.match[2], item.match[0]);
					nodes.push(wrapInFx(img, seg.fxStack, fxSplitWords ? `${(globalWi++ * 0.06).toFixed(2)}s` : undefined));
				} else {
					// CE token
					const ceId = item.match[1];
					const ceToken = item.match[0];
					const ceData = getCachedCustomEmojiMap()[ceId];
					const img = document.createElement('img');
					img.dataset.ce = ceToken;
					img.className = 'ce-img ce-img-ce';
					img.setAttribute('contenteditable', 'false');
					if (ceData) {
						img.src = ceData.url;
						img.setAttribute('alt', ':' + ceData.shortcode + ':');
					} else {
						img.src = '';
						img.setAttribute('alt', ceToken);
					}
					nodes.push(wrapInFx(img, seg.fxStack, fxSplitWords ? `${(globalWi++ * 0.06).toFixed(2)}s` : undefined));
				}
				lastIdx = item.end;
			}
			if (lastIdx < seg.text.length) pushText(seg.text.slice(lastIdx), seg.fxStack);
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

	function getSerializedBeforeCursor() {
		if (!inputEl) return input;
		const sel = window.getSelection();
		if (!sel || !sel.isCollapsed || !inputEl.contains(sel.anchorNode)) return input;
		const r = document.createRange();
		r.setStart(inputEl, 0);
		try { r.setEnd(sel.anchorNode, sel.anchorOffset); } catch { return input; }
		const frag = r.cloneContents();
		const tmp = document.createElement('div');
		tmp.appendChild(frag);
		return serializeCe(tmp);
	}

	function updateCeSuggestions() {
		const before = getSerializedBeforeCursor().replace(/[\uE100-\uE1FF]/g, '').replace(/\[[^\]]+\]/g, '');
		const m = CE_COLON_RE.exec(before);
		if (!m || m[1].length < 1) { ceSuggestions = []; return; }
		const query = m[1].toLowerCase();
		const map = getCachedCustomEmojiMap();
		ceSuggestions = Object.entries(map)
			.filter(([sc]) => sc.toLowerCase().startsWith(query))
			.slice(0, 8)
			.map(([shortcode, data]) => ({ shortcode, url: data.url }));
	}

	// Code language detection for proactive formatting suggestion
	let detectedCodeLang = $state(null);
	const CODE_PATTERNS = [
		{ lang: 'python', re: /\b(def |class |import |from .+ import|print\(|if __name__|elif |lambda )/m },
		{ lang: 'javascript', re: /\b(const |let |var |function |=>|console\.|document\.|window\.|export |import .+ from)/m },
		{ lang: 'typescript', re: /\b(interface |type |enum |readonly |as |implements |\?: )/m },
		{ lang: 'html', re: /(<\/?[a-z][\w-]*[\s>]|<!DOCTYPE|<html|<div|<span|<head|<body)/im },
		{ lang: 'css', re: /(\{[\s\S]*?:[\s\S]*?;[\s\S]*?\}|@media |@keyframes |\.[\w-]+\s*\{|#[\w-]+\s*\{)/m },
		{ lang: 'json', re: /^\s*[\[{]\s*"[\w-]+"\s*:/m },
		{ lang: 'sql', re: /\b(SELECT |INSERT |UPDATE |DELETE |CREATE TABLE|ALTER TABLE|DROP |FROM .+ WHERE)/im },
		{ lang: 'bash', re: /(^#!\/bin\/(ba)?sh|^\$ |\b(echo |cd |mkdir |npm |yarn |git |curl |chmod |sudo ))/m },
		{ lang: 'java', re: /\b(public class |private |protected |void |System\.out|@Override|new [\w]+\()/m },
		{ lang: 'rust', re: /\b(fn |let mut |impl |struct |enum |pub fn |use |mod |match |\bprintln!)/m },
		{ lang: 'go', re: /\b(func |package |import |fmt\.|go |chan |defer |:= )/m },
		{ lang: 'swift', re: /\b(func |var |let |guard |struct |protocol |@objc|print\(|import (UIKit|SwiftUI))/m },
		{ lang: 'cpp', re: /\b(#include |std::|cout|cin|nullptr|template|namespace |class .+\{)/m },
	];
	function detectCode(text) {
		if (!text || text.length < 10) return null;
		// Don't suggest if already wrapped in backticks
		if (/^```/.test(text.trim())) return null;
		const plain = text.replace(/[\uE100-\uE1FF]/g, '').replace(/\[ek:[^\]]+\]/g, '').replace(/\[ce:[^\]]+\]/g, '');
		// Need at least 2 lines or a semicolon/brace pattern to look like code
		const lines = plain.split('\n').filter(l => l.trim());
		if (lines.length < 2 && !/[{};]/.test(plain)) return null;
		for (const p of CODE_PATTERNS) {
			if (p.re.test(plain)) return p.lang;
		}
		return null;
	}
	function wrapAsCode(lang) {
		if (!inputEl) return;
		const text = serializeCe(inputEl);
		const wrapped = '```' + lang + '\n' + text + '\n```';
		setCeInput(wrapped);
		detectedCodeLang = null;
	}

	function resolveColonShortcode(shortcode) {
		if (!inputEl) return;
		const data = getCachedCustomEmojiMap()[shortcode];
		if (!data) return;
		const sel = window.getSelection();
		if (!sel || !sel.isCollapsed || !inputEl.contains(sel.anchorNode)) return;
		const range = sel.getRangeAt(0).cloneRange();
		const query = ':' + shortcode;
		// Delete ':shortcode' before cursor via text node manipulation
		if (range.startContainer.nodeType === Node.TEXT_NODE) {
			const txt = range.startContainer.textContent;
			const off = range.startOffset;
			if (txt.slice(0, off).endsWith(query)) {
				range.setStart(range.startContainer, off - query.length);
				range.deleteContents();
			}
		}
		// Insert the ce img
		const img = document.createElement('img');
		img.src = data.url;
		img.dataset.ce = '[ce:' + shortcode + ']';
		img.className = 'ce-img ce-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', ':' + shortcode + ':');
		range.insertNode(img);
		range.setStartAfter(img);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
		input = serializeCe(inputEl);
		ceSuggestions = [];
		onInput();
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
		// Reset all formatting when input is fully cleared
		if (!input.trim()) {
			messageFontSize = 1.0;
			messageFontWeight = 400;
			messageFontStretch = 100;
			messageEffect = null;
			_savedCeSel = null;
			_lastInlineTypo = {};
		}
		updateCeSuggestions();
		detectedCodeLang = detectCode(input);
		onInput();
	}

	// Plain-text character offset — no PUA chars, matches markupToSegments + findDomPos coordinate space.
	// Use this in applyTextFx so selection bounds align with segment positions.
	function cePlainOffset(el, targetNode, targetOffset) {
		let n = 0, done = false;
		function full(node) {
			if (node.nodeType === Node.TEXT_NODE) { n += node.textContent.length; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node.tagName === 'IMG' && node.dataset.ek) { n += node.dataset.ek.length; return; }
			if (node.tagName === 'IMG' && node.dataset.ce) { n += node.dataset.ce.length; return; }
			if (node.tagName === 'IMG' && node.dataset.tg) { n += node.dataset.tg.length; return; }
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
			if (node.tagName === 'IMG' && node.dataset.ek) { n += node.dataset.ek.length; return; }
			if (node.tagName === 'IMG' && node.dataset.ce) { n += node.dataset.ce.length; return; }
			if (node.tagName === 'IMG' && node.dataset.tg) { n += node.dataset.tg.length; return; }
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

	// Compute markup-string character offset for a given DOM position (accounts for EK tokens + FX PUA chars)
	function ceMarkupOffset(el, targetNode, targetOffset) {
		let buf = '';
		let done = false;
		function walkFull(node) {
			if (node.nodeType === Node.TEXT_NODE) { buf += node.textContent; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node.tagName === 'IMG' && node.dataset.ek) { buf += node.dataset.ek; return; }
			if (node.tagName === 'IMG' && node.dataset.ce) { buf += node.dataset.ce; return; }
			if (node.tagName === 'IMG' && node.dataset.tg) { buf += node.dataset.tg; return; }
			if (node.tagName === 'BR') { buf += '\n'; return; }
			const fx = node.dataset?.fx ? node.dataset.fx.split(' ').filter(f => FX_TO_CHAR[f]) : [];
			if (fx.length) buf += fx.map(f => FX_TO_CHAR[f]).join('');
			for (const c of node.childNodes) walkFull(c);
			if (fx.length) buf += FX_CLOSE_CHAR.repeat(fx.length);
		}
		function walk(node) {
			if (done) return;
			if (node === targetNode && node.nodeType === Node.TEXT_NODE) {
				buf += node.textContent.slice(0, targetOffset); done = true; return;
			}
			if (node.nodeType === Node.TEXT_NODE) { buf += node.textContent; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node === targetNode) {
				let i = 0;
				for (const c of node.childNodes) { if (i >= targetOffset) break; walkFull(c); i++; }
				done = true; return;
			}
			if (node.tagName === 'IMG' && node.dataset.ek) { buf += node.dataset.ek; return; }
			if (node.tagName === 'IMG' && node.dataset.ce) { buf += node.dataset.ce; return; }
			if (node.tagName === 'IMG' && node.dataset.tg) { buf += node.dataset.tg; return; }
			if (node.tagName === 'BR') { buf += '\n'; return; }
			const fx = node.dataset?.fx ? node.dataset.fx.split(' ').filter(f => FX_TO_CHAR[f]) : [];
			if (fx.length) buf += fx.map(f => FX_TO_CHAR[f]).join('');
			for (const c of node.childNodes) { if (done) break; walk(c); }
			if (!done && fx.length) buf += FX_CLOSE_CHAR.repeat(fx.length);
		}
		if (el === targetNode) {
			let i = 0;
			for (const c of el.childNodes) { if (i >= targetOffset) break; walkFull(c); i++; }
			return buf.length;
		}
		for (const c of el.childNodes) { if (done) break; walk(c); }
		return buf.length;
	}

	let _savedCeSel = null; // { start, end } plain-text offsets
	function onCeSelect() {
		const sel = window.getSelection();
		showTextFxBar = !!(sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode));
		if (sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			_savedCeSel = {
				start: cePlainOffset(inputEl, range.startContainer, range.startOffset),
				end: cePlainOffset(inputEl, range.endContainer, range.endOffset)
			};
		}
		// Update visual highlight on EK/CE images within the selection
		if (!inputEl) return;
		for (const img of inputEl.querySelectorAll('.ek-img-ce, .ce-img-ce')) img.classList.remove('ek-selected');
		if (!sel || sel.isCollapsed || !sel.rangeCount) return;
		const range = sel.getRangeAt(0);
		if (!inputEl.contains(range.commonAncestorContainer)) return;
		for (const img of inputEl.querySelectorAll('.ek-img-ce, .ce-img-ce')) {
			const r = document.createRange();
			r.selectNode(img);
			if (range.compareBoundaryPoints(Range.START_TO_END, r) > 0 &&
				range.compareBoundaryPoints(Range.END_TO_START, r) < 0) {
				img.classList.add('ek-selected');
			}
		}
	}

	function applyTextFx(name) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl || !inputEl.contains(sel.anchorNode)) return;
		if (undoStack.length >= 50) undoStack.shift();
		undoStack.push(input);
		redoStack.length = 0;
		const range = sel.getRangeAt(0);
		const selStart = cePlainOffset(inputEl, range.startContainer, range.startOffset);
		const selEnd = cePlainOffset(inputEl, range.endContainer, range.endOffset);
		if (selStart >= selEnd) return;

		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);

		const isColorFx = name.startsWith('color-') || name === 'rainbow';
		const isFormatFx = name === 'bold' || name === 'italic' || name === 'underline' || name === 'strike' || isColorFx;
		const isFmtFx = (fx) => fx === 'bold' || fx === 'italic' || fx === 'underline' || fx === 'strike' || fx === 'rainbow' || fx.startsWith('color-') || fx.startsWith('wdth-') || fx.startsWith('wght-') || fx.startsWith('sz-');

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

	let _lastInlineTypo = {};
	function applyInlineTypo(rawVal, steps, defaultVal, fxMap, prefix) {
		if (!_savedCeSel || !inputEl) return;
		const step = steps.reduce((a, b) => Math.abs(b - rawVal) < Math.abs(a - rawVal) ? b : a);
		if (step === _lastInlineTypo[prefix]) return;
		_lastInlineTypo[prefix] = step;
		const fxName = step !== defaultVal ? (fxMap[step] ?? null) : null;
		const { start: selStart, end: selEnd } = _savedCeSel;
		if (selStart >= selEnd) return;
		if (undoStack.length >= 50) undoStack.shift();
		undoStack.push(input);
		redoStack.length = 0;
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
		// Restore selection highlight
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
		input = newMarkup;
	}
	function applyInlineWidth(val) { applyInlineTypo(val, WDTH_STEPS, 100, WDTH_FX_MAP, 'wdth-'); }
	function applyInlineWeight(val) { applyInlineTypo(val, WGHT_STEPS, 400, WGHT_FX_MAP, 'wght-'); }
	function applyInlineSize(val) { applyInlineTypo(val, SZ_STEPS, 1.0, SZ_FX_MAP, 'sz-'); }

	function onCeCopy(e) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl) return;
		const range = sel.getRangeAt(0);
		if (!inputEl.contains(range.commonAncestorContainer)) return;
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(range.cloneContents());

		// Walk up from the selection's common ancestor to collect any wrapping
		// fx spans that aren't included in cloneContents (same as onMsgListCopy)
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
		let fontPrefix = '';
		if (messageFontSize !== 1.0 && !_savedCeSel) fontPrefix += `[sz:${messageFontSize.toFixed(3)}]`;
		if (messageFontWeight !== 400 && !_savedCeSel) fontPrefix += `[wght:${messageFontWeight}]`;
		if (messageFontStretch !== 100 && !_savedCeSel) fontPrefix += `[wdth:${messageFontStretch}]`;
		const finalReadable = fontPrefix + readable;

		e.preventDefault();
		e.clipboardData.setData('text/plain', finalReadable);
		e.clipboardData.setData('text/x-eating-markup', rawMarkup);
	}

	function matchPastedImage(clipboardData) {
		const html = clipboardData.getData('text/html');
		if (!html) return null;
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const img = doc.querySelector('img');
		if (!img) return null;
		// Check data-ce / data-ek attributes (from internal app copy)
		if (img.dataset?.ce) return { type: 'ce', token: img.dataset.ce };
		if (img.dataset?.ek) return { type: 'ek', token: img.dataset.ek };
		// Match src URL against known custom emotes
		const src = img.getAttribute('src');
		if (src) {
			const ceMap = getCachedCustomEmojiMap();
			for (const [sc, d] of Object.entries(ceMap)) {
				if (d.url === src) return { type: 'ce', token: `[ce:${sc}]` };
			}
			// Match against reaction image URLs (already hosted, no need to re-upload)
			if (src.includes('/reaction-images/')) {
				return { type: 'reaction', url: src, name: img.alt || 'reaction' };
			}
		}
		return null;
	}

	function onCePaste(e) {
		e.preventDefault();
		// If clipboard has internal markup (from selecting + copying in chat), prefer that over file items
		const internalMarkup = e.clipboardData.getData('text/x-eating-markup');
		const plainText = e.clipboardData.getData('text/plain');
		const hasMarkupTokens = internalMarkup || (plainText && (/\[ce:|^\[sz:|^\[wght:|^\[wdth:|\[ek:|\[bold\]|\[italic\]/i.test(plainText)));
		const items = Array.from(e.clipboardData?.items ?? []);
		const fileItem = items.find(i => i.kind === 'file' && (i.type.startsWith('image/') || i.type.startsWith('video/')));
		if (fileItem && !hasMarkupTokens) {
			// Check if this is a known app image before uploading
			const match = matchPastedImage(e.clipboardData);
			if (match) {
				if (match.type === 'ce' || match.type === 'ek') {
					// Insert token into compose box
					const nodes = ceMarkupToNodes(match.token);
					const sel = window.getSelection();
					if (sel?.rangeCount && inputEl?.contains(sel.anchorNode)) {
						const range = sel.getRangeAt(0);
						range.deleteContents();
						for (const node of nodes) { range.insertNode(node); range.setStartAfter(node); range.collapse(true); }
						sel.removeAllRanges(); sel.addRange(range);
					} else {
						for (const node of nodes) inputEl.appendChild(node);
					}
					input = serializeCe(inputEl);
					detectedCodeLang = detectCode(input);
					return;
				}
				if (match.type === 'reaction') {
					pendingAttachment = { url: match.url, filename: match.name, mimetype: 'image/webp', size: 0, isReaction: true };
					return;
				}
			}
			const file = fileItem.getAsFile();
			if (file) {
				uploading = true;
				const fd = new FormData();
				fd.append('file', file, file.name || `paste.${file.type.split('/')[1] || 'bin'}`);
				fd.append('contextType', 'channel');
				fd.append('contextId', convId);
				fd.append('classId', data.currentClass?.id ?? '');
				fetch('/api/upload', { method: 'POST', body: fd })
					.then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
					.then(att => { pendingAttachment = att; })
					.catch(err => console.error('Paste upload failed', err))
					.finally(() => { uploading = false; });
			}
			return;
		}
		// Prefer internal markup format (preserves all formatting exactly)
		const rawMarkup = e.clipboardData.getData('text/x-eating-markup');
		let pastedText = rawMarkup || e.clipboardData.getData('text/plain');
		if (!pastedText || !inputEl) return;

		if (!rawMarkup) {
			// Parse and strip font setting tokens from start of externally pasted text
			const szM = pastedText.match(/^\[sz:([\d.]+)\]/);
			if (szM) { messageFontSize = Math.min(20, Math.max(0.55, parseFloat(szM[1]))); pastedText = pastedText.slice(szM[0].length); }
			const wghtM = pastedText.match(/^\[wght:(\d+)\]/);
			if (wghtM) { messageFontWeight = Math.min(700, Math.max(100, parseInt(wghtM[1]))); pastedText = pastedText.slice(wghtM[0].length); }
			const wdthM = pastedText.match(/^\[wdth:(\d+)\]/);
			if (wdthM) { messageFontStretch = Math.min(150, Math.max(25, parseInt(wdthM[1]))); pastedText = pastedText.slice(wdthM[0].length); }
			if (!pastedText) return;
		}

		// When pasted text contains EK tokens, use direct DOM insertion to avoid
		// markup-based cursor arithmetic breaking on img nodes.
		if (pastedText.indexOf('[ek:') !== -1 || pastedText.indexOf('[ce:') !== -1) {
			const nodes = ceMarkupToNodes(rawMarkup ? pastedText : normalizeLegacyMarkup(pastedText));
			const sel = window.getSelection();
			if (sel && sel.rangeCount > 0 && inputEl.contains(sel.anchorNode)) {
				const range = sel.getRangeAt(0);
				range.deleteContents();
				for (const node of nodes) {
					range.insertNode(node);
					range.setStartAfter(node);
					range.collapse(true);
				}
				sel.removeAllRanges();
				sel.addRange(range);
			} else {
				for (const node of nodes) inputEl.appendChild(node);
				const r = document.createRange();
				r.selectNodeContents(inputEl);
				r.collapse(false);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(r);
			}
			input = serializeCe(inputEl);
			detectedCodeLang = detectCode(input);
			return;
		}

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
		const pastedMarkup = rawMarkup ? pastedText : normalizeLegacyMarkup(pastedText);
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
		detectedCodeLang = detectCode(input);
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
		// Remove tooltip popups from cloned content (hidden but cloned by cloneContents)
		for (const pop of tempDiv.querySelectorAll('.e-tip-pop')) pop.remove();
		let markup = serializeCe(tempDiv);

		// Wrap with outer effects (those whose span was the ancestor container, not in the clone)
		if (outerFxStack.length > 0) {
			markup = outerFxStack.map(fx => FX_TO_CHAR[fx] ?? '').join('') + markup + FX_CLOSE_CHAR.repeat(outerFxStack.length);
		}

		let readable = unicodeToReadable(markup);

		// If selection is inside a code block, wrap in triple backticks
		let codeAncestor = range.commonAncestorContainer;
		if (codeAncestor.nodeType === Node.TEXT_NODE) codeAncestor = codeAncestor.parentElement;
		const codeBlock = codeAncestor?.closest?.('.code-block');
		if (codeBlock && !readable.startsWith('```')) {
			const lang = (codeBlock.querySelector('.code-lang')?.textContent ?? '').trim();
			readable = '```' + lang + '\n' + readable + '\n```';
		}

		// Find parent bubble for font settings
		let fontPrefix = '';
		let ancestor = range.commonAncestorContainer;
		if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;
		while (ancestor && !ancestor.classList?.contains('bubble')) ancestor = ancestor.parentElement;
		if (ancestor) {
			const fs = ancestor.dataset.fontSize;
			const fw = ancestor.dataset.fontWeight;
			const fd = ancestor.dataset.fontStretch;
			if (fs) fontPrefix += `[sz:${parseFloat(fs).toFixed(3)}]`;
			if (fw) fontPrefix += `[wght:${fw}]`;
			if (fd) fontPrefix += `[wdth:${fd}]`;
		}

		const finalText = fontPrefix + readable;
		if (finalText !== sel.toString()) {
			e.clipboardData.setData('text/plain', finalText);
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
		if (emojiTooltip) emojiTooltip = null;
		// Load more history when scrolled near top
		if (listEl.scrollTop < 200 && hasMoreHistory && !loadingMore) loadMoreHistory();
	}

	async function loadMoreHistory() {
		if (loadingMore || !hasMoreHistory || !messages.length) return;
		loadingMore = true;
		const oldest = messages[0];
		const before = new Date(oldest.createdAt).toISOString();
		try {
			const r = await fetch(`/api/chat/history?channelId=${encodeURIComponent(convId)}&before=${encodeURIComponent(before)}&limit=40`);
			if (!r.ok) throw new Error('Failed');
			const { messages: older, hasMore } = await r.json();
			hasMoreHistory = hasMore;
			if (older.length) {
				const prevHeight = listEl.scrollHeight;
				const existingIds = new Set(messages.map(m => m.id));
				const newMsgs = older.filter(m => !existingIds.has(m.id));
				messages = [...newMsgs, ...messages];
				// Preserve scroll position after prepending
				requestAnimationFrame(() => {
					if (listEl) listEl.scrollTop += listEl.scrollHeight - prevHeight;
				});
			}
		} catch (e) { console.error('Load more failed', e); }
		finally { loadingMore = false; }
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

	onMount(async () => {
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

		// Snapshot lastRead BEFORE markRead writes Date.now() over it, so we can
		// distinguish "already seen" messages from "still unread" ones for FX auto-play.
		try {
			const snap = await get(ref(db, `lastRead/${data.currentUser.id}/${convId}`));
			_lastReadAtMount = snap.exists() ? Number(snap.val()) || 0 : 0;
		} catch { _lastReadAtMount = 0; }
		markRead();
		scrollToBottom();
		// Replace broken inline images (CE/EK) with a "removed" placeholder
		if (listEl) listEl.addEventListener('error', (e) => {
			const img = e.target;
			if (img.tagName === 'IMG' && (img.classList.contains('ce-img') || img.classList.contains('ek-img'))) {
				const retries = parseInt(img.dataset.retries ?? '0');
				if (retries < 3) {
					img.dataset.retries = retries + 1;
					setTimeout(() => { img.src = img.src; }, 1000 * (retries + 1));
				} else {
					const span = document.createElement('span');
					span.className = 'img-removed-inline';
					span.textContent = '[removed]';
					img.replaceWith(span);
				}
			}
		}, true);
		if (listEl) listEl.addEventListener('click', (e) => {
			const tgEl = e.target.closest?.('.tg-emoji.tg-fx');
			if (tgEl) { playTgInteraction(tgEl); return; }
			const copyBtn = e.target.closest?.('.code-copy-btn');
			if (copyBtn) {
				const block = copyBtn.closest('.code-block');
				const code = block?.querySelector('code')?.textContent ?? '';
				navigator.clipboard.writeText(code).then(() => {
					copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a6e3a1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span class="copy-label"> Copied</span>`;
					copyBtn.title = 'Copied!';
					setTimeout(() => { copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="copy-label"> Copy</span>`; copyBtn.title = 'Copy'; }, 1500);
				});
				return;
			}
			const showMore = e.target.closest?.('.code-show-more');
			if (showMore) {
				const block = showMore.closest('.code-block');
				if (block) { block.removeAttribute('data-truncated'); showMore.remove(); }
			}
		});
		loadEmojiNames().then(m => { emojiNames = m; _clearHtmlCache(); clearJumboCache(); messages = [...messages]; });
		initSemanticSearch();
		getCustomEmojiMap().then(m => { _ceMap = m; _clearHtmlCache(); messages = [...messages]; });
		Promise.all([loadTelegramEmoji(), loadCustomPacks()]).then(() => { mountTgStickers(); });
		document.addEventListener('selectionchange', onCeSelect);
		if (heartsCanvas) {
			heartsCanvas.width = window.innerWidth;
			heartsCanvas.height = window.innerHeight;
			heartsCtx = heartsCanvas.getContext('2d');
			if (messages.some(m => m.fx === 'hearts')) startHeartsLoop();
		}

		firebaseRef = query(ref(db, `channels/${convId}/messages`), limitToLast(50));
		onChildAdded(firebaseRef, (snap) => {
			const _t0 = performance.now();
			const msg = normaliseMessage(snap.key, snap.val(), userMap);
			if (messages.find((m) => m.id === msg.id)) return;
			// Replace a matching pending optimistic rather than appending (prevents duplicate flash)
			const optIdx = messages.findIndex(m => m.pending && m.userId === msg.userId && m.content === msg.content);
			if (optIdx !== -1) {
				messages = [...messages.slice(0, optIdx), msg, ...messages.slice(optIdx + 1)];
			} else {
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

	function insertCeImgAtCursor(shortcode, data) {
		if (!inputEl) return;
		const img = document.createElement('img');
		img.src = data.url;
		img.dataset.ce = '[ce:' + shortcode + ']';
		img.className = 'ce-img ce-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', ':' + shortcode + ':');
		const sel = window.getSelection();
		if (sel && sel.rangeCount && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(img);
			range.setStartAfter(img);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
		} else {
			inputEl.appendChild(img);
		}
		input = serializeCe(inputEl);
		onInput();
	}

	function onCustomEmojiInsert(emojiOrToken) {
		let shortcode, ceData;
		if (typeof emojiOrToken === 'object') {
			shortcode = emojiOrToken.shortcode;
			ceData = emojiOrToken;
		} else {
			shortcode = emojiOrToken.slice(4, -1);
			ceData = getCachedCustomEmojiMap()[shortcode];
		}
		if (!shortcode || !ceData?.url) return;
		insertCeImgAtCursor(shortcode, ceData);
		_clearHtmlCache();
		showCustomEmoji = false;
	}

	// ── Telegram animated emoji ──────────────────────────────────────────────
	const _tgAnims = new WeakMap();
	const _tgPlayedFx = new Set();   // "msgId:cp" — auto-played click overlays
	let _tgObserver = null;
	// Snapshot of lastRead at page open — anything sent AFTER this is "unseen" for
	// auto-play purposes. Default to now so we don't replay anything if the snapshot
	// hasn't resolved yet (the 5-min freshness check still covers very recent msgs).
	let _lastReadAtMount = Date.now();

	// Build the atomic compose-box <img> (static frame preview; flags use their webp)
	function makeTgImg(cp, token) {
		const img = document.createElement('img');
		img.dataset.tg = token;
		img.className = 'tg-img tg-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', token);
		img.src = TG_PLACEHOLDER;
		loadTelegramEmoji().then(() => {
			const entry = tgEntry(cp);
			if (entry?.flag) { img.src = tgFlagUrl(cp); return; }
			tgStaticFrame(cp, false).then((src) => { if (src) img.src = src; });
		});
		return img;
	}
	function makeTgcImg(short, id, token) {
		const img = document.createElement('img');
		img.dataset.tg = token;
		img.className = 'tg-img tg-img-ce';
		img.setAttribute('contenteditable', 'false');
		img.setAttribute('alt', token);
		img.src = TG_PLACEHOLDER;
		loadCustomPacks().then(() => {
			tgcStaticFrame(short, id).then((src) => { if (src) img.src = src; });
		});
		return img;
	}

	function onTgEmojiInsert(it) {
		showTgEmoji = false;
		let node;
		if (it.custom) {
			if (it.mode === 'emoji') {
				node = document.createTextNode(it.alt || '');
			} else {
				node = makeTgcImg(it.short, it.id, tgcToToken(it.short, it.id));
			}
		} else {
			node = makeTgImg(it.cp, cpToToken(it.cp));
		}
		const sel = window.getSelection();
		if (sel && sel.rangeCount && inputEl?.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(node);
			range.setStartAfter(node); range.collapse(true);
			sel.removeAllRanges(); sel.addRange(range);
		} else if (inputEl) {
			inputEl.appendChild(node);
		}
		input = serializeCe(inputEl);
		onInput();
		_clearHtmlCache();
		inputEl?.focus();
	}

	// Mount live Lottie players into rendered .tg-emoji spans — SAME setup as the
	// picker's LottieSticker: lottie-web SVG, autoplay:false, and the IO observer
	// gates each play() through the shared PLAY_CAP=24 throttle so the main thread
	// never has more than 24 SVG engines ticking. That cap is what alleviates the
	// frame-render artifacts certain emoji show when too many compete for CPU.
	const _tgPlayingSet = new WeakSet();
	let _tgHeldSlots = 0;
	function tgTryStart(span, anim) {
		if (_tgPlayingSet.has(span)) return;
		if (_tgTryPlay()) { _tgPlayingSet.add(span); _tgHeldSlots++; anim.play(); }
	}
	function tgPause(span, anim) {
		if (!_tgPlayingSet.has(span)) return;
		_tgPlayingSet.delete(span);
		_tgYieldPlay(); _tgHeldSlots--;
		anim.pause();
	}
	function ensureTgObserver() {
		if (_tgObserver) return;
		_tgObserver = new IntersectionObserver((entries) => {
			for (const e of entries) {
				const span = e.target;
				const frozen = !!(span.dataset.tgPack && isStaticPack(span.dataset.tgPack));
				const anim = _tgAnims.get(span);
				if (e.isIntersecting) {
					ensureTgAnim(span);
					if (!frozen && anim) tgTryStart(span, anim);
				} else if (!frozen && anim) {
					tgPause(span, anim);
				}
			}
		}, { rootMargin: '150px' });
	}
	async function ensureTgAnim(span) {
		if (_tgAnims.has(span)) return;
		_tgAnims.set(span, null);
		let url = '';
		if (span.dataset.tgCp) url = tgAnimatedUrl(span.dataset.tgCp);
		else if (span.dataset.tgPack && span.dataset.tgId) url = tgcUrl(span.dataset.tgPack, span.dataset.tgId);
		if (!url) return;
		const data = await fetchLottie(url);
		if (!data || !span.isConnected) return;
		const frozen = !!(span.dataset.tgPack && isStaticPack(span.dataset.tgPack));
		const anim = lottie.loadAnimation({
			container: span, renderer: 'svg', loop: !frozen, autoplay: false,
			animationData: data, rendererSettings: { progressiveLoad: true }
		});
		// Same as picker — disable subframe interpolation to suppress lottie-web's
		// transient mid-frame layer state that causes the one-frame flicker.
		try { anim.setSubframe(false); } catch {}
		if (frozen) {
			const t = Math.min(STATIC_FRAME_INDEX, Math.max(0, (anim.totalFrames || 1) - 1));
			anim.goToAndStop(t, true);
		}
		_tgAnims.set(span, anim);
		// IO may have already marked us intersecting before this async load resolved.
		if (!frozen) {
			const r = span.getBoundingClientRect();
			const inView = r.bottom > -150 && r.top < window.innerHeight + 150;
			if (inView) tgTryStart(span, anim);
		}
	}
	function mountTgStickers() {
		if (!listEl) return;
		// Bail until manifests are loaded — otherwise we'd mark spans as "processed"
		// while tgEntry returns null, and they'd never get .tg-fx or a lottie player.
		if (!getCachedTgEmoji() || !getCachedCustomPacks()) return;
		ensureTgObserver();
		for (const span of listEl.querySelectorAll('.tg-emoji:not([data-tgm])')) {
			span.dataset.tgm = '1';
			// ── Standard Telegram emoji (cp-based) ───────────────────────────
			if (span.dataset.tgCp) {
				const cp = span.dataset.tgCp;
				const entry = tgEntry(cp);
				if (entry?.flag) {
					const img = document.createElement('img');
					img.src = tgFlagUrl(cp); img.className = 'tg-emoji-img'; img.alt = entry.e;
					span.appendChild(img);
					continue;
				}
				_tgObserver.observe(span);
				if ((entry?.av || 0) > 0) span.classList.add('tg-fx');
				const msgId = span.closest('.message[data-msg-id]')?.dataset.msgId;
				const isJumbo = !!span.closest('.bubble')?.classList.contains('jumbo-emoji');
				if (msgId && isJumbo && (entry?.av || 0) > 0) {
					// Auto-play if either: sent in the last 5 minutes, OR not yet seen
					// by this user (createdAt > the lastRead value at page open).
					const msg = messages.find((m) => m.id === msgId);
					const FRESH_MS = 5 * 60 * 1000;
					const isFresh = msg && (Date.now() - (msg.createdAt || 0)) < FRESH_MS;
					const isUnseen = msg && (msg.createdAt || 0) > _lastReadAtMount;
					const key = msgId + ':' + cp;
					if ((isFresh || isUnseen) && !_tgPlayedFx.has(key)) {
						_tgPlayedFx.add(key);
						setTimeout(() => {
							if (!span.isConnected) return;
							const r = span.getBoundingClientRect();
							if (r.top < window.innerHeight && r.bottom > 0) playTgInteraction(span);
						}, 250);
					}
				}
			}
			// ── Custom-pack emoji (short_name + doc_id) ──────────────────────
			else if (span.dataset.tgPack && span.dataset.tgId) {
				_tgObserver.observe(span);
				// no FX overlay / click-to-play for custom emoji (none have variants)
			}
		}
	}
	// Click an animated emoji → overlay a big play (dedicated variant if any, else enlarge)
	async function playTgInteraction(el) {
		const cp = el.dataset.tgCp;
		const entry = tgEntry(cp);
		if (!entry || entry.flag) return;
		const rect = el.getBoundingClientRect();
		const url = entry.av > 0 ? tgAnimationUrl(cp, 1 + Math.floor(Math.random() * entry.av)) : tgAnimatedUrl(cp);
		const data = await fetchLottie(url);
		if (!data) return;
		// Anchor to the CHAT container's edges, not the viewport's, so the directional
		// emanation flows inside the chat area and never spills into the sidebar/gutter.
		const chatRect = listEl?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth };
		const chatWidth = chatRect.right - chatRect.left;
		const big = Math.min(320, chatWidth * 0.7);
		const isMine = !!el.closest('.message')?.classList.contains('mine');
		const left = isMine ? chatRect.right - big : chatRect.left;
		const cy = rect.top + rect.height / 2;
		const top = Math.max(0, Math.min(cy - big / 2, window.innerHeight - big));
		const host = document.createElement('div');
		host.className = isMine ? 'tg-interaction' : 'tg-interaction tg-flip-theirs';
		host.style.cssText = `position:fixed;left:${Math.round(left)}px;top:${Math.round(top)}px;width:${big}px;height:${big}px;pointer-events:none;z-index:9998;`;
		document.body.appendChild(host);
		const anim = lottie.loadAnimation({
			container: host, renderer: 'svg', loop: false, autoplay: true,
			animationData: data, rendererSettings: { progressiveLoad: true }
		});
		try { anim.setSubframe(false); } catch {}
		const cleanup = () => { try { anim.destroy(); } catch {} host.remove(); };
		anim.addEventListener('complete', cleanup);
		setTimeout(() => { if (host.isConnected) cleanup(); }, 6000);
	}

	$effect(() => { messages; tick().then(mountTgStickers); });

	function onReactionInsert(reaction) {
		pendingAttachment = { url: reaction.url, filename: reaction.name, mimetype: 'image/webp', size: 0, isReaction: true };
		showCustomEmoji = false;
	}

	function onGifSelect(gif) {
		pendingAttachment = { url: gif.gif, filename: gif.title || 'GIF', mimetype: 'image/gif', size: 0 };
		showGifPicker = false;
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
		_tgObserver?.disconnect();
		while (_tgHeldSlots > 0) { _tgYieldPlay(); _tgHeldSlots--; }
	});

	async function send() {
		const content = input.trim();
		const attSnap = pendingAttachment ? { ...pendingAttachment } : null;
		if (!content && !attSnap) return;
		clearTyping();
		const replySnap = replyingTo ? { ...replyingTo } : null;
		const fxSnap = messageEffect;
		const hasInlineSz = /[\uE140-\uE145]/.test(content);
		const hasInlineWght = /[\uE130-\uE135]/.test(content);
		const hasInlineWdth = /[\uE120-\uE124]/.test(content);
		const szSnap = (messageFontSize !== 1.0 && !hasInlineSz) ? messageFontSize : undefined;
		const wghtSnap = (messageFontWeight !== 400 && !hasInlineWght) ? messageFontWeight : undefined;
		const wdthSnap = (messageFontStretch !== 100 && !hasInlineWdth) ? messageFontStretch : undefined;
		const noSplit = !fxSplitWords;
		const wigSnap = (fxSnap === 'wiggly' || fxSnap === 'cursed' || fxSnap === 'scalloped' || fxSnap === 'starburst') && wiggleSize !== 6 ? wiggleSize : undefined;
		const optimistic = {
			id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: data.currentUser.id,
			userName: data.currentUser.name, userRole: data.currentUser.role,
			content: content || attSnap?.filename || '', createdAt: Date.now(),
			pending: true, replyTo: replySnap, attachment: attSnap, fx: fxSnap,
			fontSize: szSnap ?? 1, fontWeight: wghtSnap ?? 400, fontStretch: wdthSnap ?? 100, noSplit,
			wiggleSize: wigSnap
		};
		messages = [...messages, optimistic];
		setTimeout(() => { if (messages.some(m => m.id === optimistic.id && m.pending)) slowPendingIds = new Set([...slowPendingIds, optimistic.id]); }, 400);
		setCeInput('');
		undoStack = []; redoStack = [];
		_savedCeSel = null; _lastInlineTypo = {};
		replyingTo = null;
		pendingAttachment = null;
		messageEffect = null;
		showEffectPanel = false;
		messageFontSize = 1.0;
		messageFontWeight = 400;
		messageFontStretch = 100;
		wiggleSize = 6;
		scrollToBottom();
		if (fxSnap && SCREEN_FXS.some(f => f.name === fxSnap)) setTimeout(() => playScreenEffect(fxSnap), 50);
		// Fire-and-forget — don't block the input
		fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: content || attSnap?.filename || '', channelId: convId, reply_to: replySnap, attachment: attSnap, effect: fxSnap || undefined, fontSize: szSnap, fontWeight: wghtSnap, fontStretch: wdthSnap, noSplit: noSplit || undefined, wiggleSize: wigSnap })
		}).then(() => {
			// Only remove if still pending (onChildAdded may have already replaced it)
			if (messages.some((m) => m.id === optimistic.id && m.pending)) {
				messages = messages.filter((m) => m.id !== optimistic.id);
			}
		}).catch(() => {
			messages = messages.filter((m) => m.id !== optimistic.id);
			// Only restore if input is still empty (user hasn't started typing something new)
			if (!input.trim() && !pendingAttachment) {
				setCeInput(content);
				replyingTo = replySnap;
				pendingAttachment = attSnap;
				messageEffect = fxSnap;
				messageFontSize = szSnap ?? 1.0;
			}
		});
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

	const VIEWABLE_EXTS = new Set(['js','mjs','cjs','ts','tsx','jsx','py','html','htm','css','json','md','txt','csv','sql','sh','bash','env','yml','yaml','xml','svg','toml','ini','cfg','conf','log','c','h','cpp','hpp','rs','go','java','swift','svelte','vue','rb','php','pl','r','lua','kt','scala','ex','exs','hs','ml','clj','dockerfile','makefile','gitignore','env.example','env.local']);
	const MAX_VIEW_SIZE = 500 * 1024; // 500 KB
	function isViewableFile(filename, mimetype, size) {
		if (size > MAX_VIEW_SIZE) return false;
		if (mimetype?.startsWith('text/')) return true;
		if (mimetype === 'application/json' || mimetype === 'application/xml') return true;
		const ext = (filename ?? '').split('.').pop()?.toLowerCase();
		return VIEWABLE_EXTS.has(ext) || VIEWABLE_EXTS.has(filename?.toLowerCase());
	}
	function langFromFilename(filename) {
		const ext = (filename ?? '').split('.').pop()?.toLowerCase();
		const map = { js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', html:'html', htm:'html', css:'css', json:'json', md:'markdown', txt:'plaintext', csv:'csv', sql:'sql', sh:'bash', bash:'bash', env:'env', yml:'yaml', yaml:'yaml', xml:'xml', svg:'xml', toml:'ini', ini:'ini', cfg:'ini', conf:'ini', log:'plaintext', c:'cpp', h:'cpp', cpp:'cpp', hpp:'cpp', rs:'rust', go:'go', java:'java', swift:'swift', svelte:'html', vue:'html', rb:'ruby', php:'php', r:'r', lua:'lua' };
		return map[ext] ?? 'plaintext';
	}

	const _extToIcon = { js:_ci.js, mjs:_ci.js, cjs:_ci.js, jsx:_ci.js, ts:_ci.ts, tsx:_ci.ts, py:_ci.py, html:_ci.html, htm:_ci.html, css:_ci.css, json:_ci.json, md:_ci.md, csv:_ci.csv, sql:_ci.sql, sh:_ci.bash, bash:_ci.bash, env:_ci.env, java:_ci.java, cpp:_ci.cpp, c:_ci.cpp, h:_ci.cpp, hpp:_ci.cpp, rs:_ci.rust, go:_ci.go, swift:_ci.swift, svelte:_ci.html, vue:_ci.html };
	function fileCodeIcon(filename) {
		const ext = (filename ?? '').split('.').pop()?.toLowerCase();
		return _extToIcon[ext] ?? null;
	}
	const FILE_TYPE_NAMES = { js:'JavaScript file', mjs:'JavaScript file', cjs:'JavaScript file', jsx:'JSX file', ts:'TypeScript file', tsx:'TSX file', py:'Python file', html:'HTML file', htm:'HTML file', css:'CSS file', json:'JSON file', md:'Markdown file', txt:'Text file', csv:'CSV file', sql:'SQL file', sh:'Shell script', bash:'Shell script', env:'Environment file', yml:'YAML file', yaml:'YAML file', xml:'XML file', svg:'SVG file', toml:'TOML file', ini:'Config file', cfg:'Config file', conf:'Config file', log:'Log file', c:'C file', h:'C header', cpp:'C++ file', hpp:'C++ header', rs:'Rust file', go:'Go file', java:'Java file', swift:'Swift file', svelte:'Svelte file', vue:'Vue file', rb:'Ruby file', php:'PHP file', lua:'Lua file', kt:'Kotlin file', pdf:'PDF document', zip:'ZIP archive', gz:'GZIP archive', tar:'TAR archive', png:'PNG image', jpg:'JPEG image', jpeg:'JPEG image', gif:'GIF image', webp:'WebP image', mp4:'MP4 video', mov:'MOV video', mp3:'MP3 audio', wav:'WAV audio' };
	function fileTypeName(filename) {
		const ext = (filename ?? '').split('.').pop()?.toLowerCase();
		return FILE_TYPE_NAMES[ext] ?? null;
	}
	let fileViewer = $state(null); // { filename, content, lang }
	async function downloadFile(url, filename) {
		try {
			const r = await fetch(`/api/file-proxy?url=${encodeURIComponent(url)}`);
			const blob = await r.blob();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = filename;
			a.click();
			URL.revokeObjectURL(a.href);
		} catch { window.open(url, '_blank'); }
	}
	async function viewFile(url, filename) {
		try {
			const r = await fetch(`/api/file-proxy?url=${encodeURIComponent(url)}`);
			if (!r.ok) throw new Error('Failed to fetch');
			const text = await r.text();
			const lang = langFromFilename(filename);
			fileViewer = { filename, url, content: text, lang };
		} catch { fileViewer = { filename, url, content: 'Failed to load file.', lang: 'plaintext' }; }
	}

	// Returns the outermost node to jump past for atomic EK/CE navigation.
	// If node is an EK/CE img, climbs up through single-child FX span parents.
	// If node is an FX span wrapping only an EK/CE, dives in and returns node itself.
	function getEkOutermost(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		if (node.tagName === 'IMG' && (node.dataset.ek || node.dataset.ce || node.dataset.tg)) {
			// Climb up through single-child FX spans that contain only this img
			let outer = node;
			while (outer.parentNode && outer.parentNode !== inputEl &&
			       outer.parentNode.nodeType === Node.ELEMENT_NODE &&
			       outer.parentNode.dataset?.fx &&
			       outer.parentNode.childNodes.length === 1) {
				outer = outer.parentNode;
			}
			return outer;
		}
		if (node.dataset?.fx) {
			// Dive into single-child FX span chain to find an EK/CE img
			let child = node;
			while (child.childNodes.length === 1 && child.firstChild?.nodeType === Node.ELEMENT_NODE) {
				child = child.firstChild;
				if (child.tagName === 'IMG' && (child.dataset.ek || child.dataset.ce)) return node; // node is the outermost
				if (!child.dataset?.fx) break;
			}
		}
		return null;
	}

	// Move cursor out of FX span if it's sitting at the trailing boundary.
	// Called before typing so new text doesn't inherit the effect.
	function normalizeCursorOutsideFx() {
		if (!inputEl) return;
		const sel = window.getSelection();
		if (!sel?.isCollapsed || !inputEl.contains(sel.anchorNode)) return;
		const { anchorNode, anchorOffset } = sel;
		// Only applies when cursor is at the end of a text node inside an FX span
		if (anchorNode.nodeType !== Node.TEXT_NODE) return;
		if (anchorOffset !== anchorNode.textContent.length) return;
		// Climb up through FX span parents, checking we're always the last child
		let node = anchorNode;
		let inFx = false;
		while (node.parentNode && node.parentNode !== inputEl) {
			const parent = node.parentNode;
			if (!parent.dataset?.fx) break; // not an FX span, stop
			const siblings = parent.childNodes;
			if (siblings[siblings.length - 1] !== node) { inFx = false; break; } // not last child
			inFx = true;
			node = parent;
		}
		if (!inFx || node === anchorNode) return;
		// node is now the outermost FX span as a direct child of inputEl
		const idx = Array.from(inputEl.childNodes).indexOf(node);
		const r = document.createRange();
		r.setStart(inputEl, idx + 1);
		r.collapse(true);
		sel.removeAllRanges();
		sel.addRange(r);
	}

	function onKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); inputEl?.focus(); send(); return; }

		// Colon autocomplete: typing ':' closes the shortcode query
		if (e.key === ':' && ceSuggestions.length > 0 && !e.metaKey && !e.ctrlKey) {
			const before = getSerializedBeforeCursor().replace(/[\uE100-\uE1FF]/g, '').replace(/\[[^\]]+\]/g, '');
			const m = CE_COLON_RE.exec(before);
			if (m) {
				const query = m[1].toLowerCase();
				const map = getCachedCustomEmojiMap();
				const exact = map[query] ? query : (ceSuggestions.length === 1 ? ceSuggestions[0].shortcode : null);
				if (exact) { e.preventDefault(); resolveColonShortcode(exact); return; }
			}
		}

		// Normalize cursor outside FX span before any printable character is inserted
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) normalizeCursorOutsideFx();

		// Backspace/Delete with selection that includes code blocks
		if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey) {
			const sel = window.getSelection();
			if (sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode)) {
				const hasCodeBlock = inputEl.querySelector('.code-block-ce');
				if (hasCodeBlock) {
					e.preventDefault();
					if (undoStack.length >= 50) undoStack.shift();
					undoStack.push(input);
					redoStack.length = 0;
					sel.deleteFromDocument();
					// Clean up any empty code block remnants
					for (const cb of inputEl.querySelectorAll('.code-block-ce')) {
						if (!cb.querySelector('.code-block-ce-code')?.textContent?.trim()) cb.remove();
					}
					input = serializeCe(inputEl);
					detectedCodeLang = detectCode(input);
					if (!input.trim()) {
						messageFontSize = 1.0; messageFontWeight = 400; messageFontStretch = 100;
						messageEffect = null; _savedCeSel = null; _lastInlineTypo = {};
					}
					return;
				}
			}
		}

		// Backspace: delete EK image (including EK wrapped in FX span) in one keystroke
		if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
			const sel = window.getSelection();
			if (sel?.isCollapsed && inputEl?.contains(sel.anchorNode)) {
				// Check if cursor is at position 0 inside a code block → unwrap
				const codeBlock = sel.anchorNode.closest?.('.code-block-ce') ?? sel.anchorNode.parentElement?.closest?.('.code-block-ce');
				if (codeBlock && inputEl.contains(codeBlock)) {
					const pre = codeBlock.querySelector('.code-block-ce-code');
					if (pre) {
						const rr = document.createRange();
						rr.setStart(pre, 0);
						rr.setEnd(sel.anchorNode, sel.anchorOffset);
						if (rr.toString().length === 0) {
							e.preventDefault();
							if (undoStack.length >= 50) undoStack.shift();
							undoStack.push(input);
							redoStack.length = 0;
							const code = pre.textContent ?? '';
							codeBlock.replaceWith(document.createTextNode(code));
							input = serializeCe(inputEl);
							detectedCodeLang = detectCode(input);
							return;
						}
					}
				}
				// Check if backspace would delete a code block element
				const r = sel.getRangeAt(0);
				const prevNode = r.startContainer.nodeType === Node.TEXT_NODE
					? (r.startOffset === 0 ? r.startContainer.previousSibling : null)
					: (r.startOffset > 0 ? r.startContainer.childNodes[r.startOffset - 1] : null);
				if (prevNode?.classList?.contains('code-block-ce')) {
					e.preventDefault();
					if (undoStack.length >= 50) undoStack.shift();
					undoStack.push(input);
					redoStack.length = 0;
					const code = prevNode.dataset.code ?? '';
					prevNode.replaceWith(document.createTextNode(code));
					input = serializeCe(inputEl);
					detectedCodeLang = detectCode(input);
					return;
				}
				const prev = r.startContainer.nodeType === Node.TEXT_NODE
					? (r.startOffset === 0 ? r.startContainer.previousSibling : null)
					: (r.startOffset > 0 ? r.startContainer.childNodes[r.startOffset - 1] : null);
				const ekOuter = getEkOutermost(prev);
				if (ekOuter) { e.preventDefault(); ekOuter.remove(); input = serializeCe(inputEl); return; }
			}
		}

		// Arrow keys: skip atomically over EK images (including EK inside FX spans)
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
			const sel = window.getSelection();
			if (sel?.isCollapsed && inputEl?.contains(sel.anchorNode)) {
				const r = sel.getRangeAt(0);
				const cn = r.startContainer, co = r.startOffset;
				const goRight = e.key === 'ArrowRight';
				const adj = cn.nodeType === Node.TEXT_NODE
					? (goRight
						? (co === cn.textContent.length ? cn.nextSibling : null)
						: (co === 0 ? cn.previousSibling : null))
					: (goRight
						? (cn.childNodes[co] ?? null)
						: (co > 0 ? cn.childNodes[co - 1] : null));
				const outer = getEkOutermost(adj);
				if (outer) {
					e.preventDefault();
					const nr = document.createRange();
					if (goRight) nr.setStartAfter(outer); else nr.setStartBefore(outer);
					nr.collapse(true);
					sel.removeAllRanges(); sel.addRange(nr); return;
				}
			}
		}

		// Arrow keys: escape code block when at start/end
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey) {
			const sel = window.getSelection();
			if (sel?.isCollapsed && inputEl?.contains(sel.anchorNode)) {
				const codeBlock = sel.anchorNode.closest?.('.code-block-ce') ?? sel.anchorNode.parentElement?.closest?.('.code-block-ce');
				if (codeBlock) {
					const pre = codeBlock.querySelector('.code-block-ce-code');
					if (pre) {
						const r = document.createRange();
						r.setStart(pre, 0);
						r.setEnd(sel.anchorNode, sel.anchorOffset);
						const fullText = pre.textContent;
						const fullLen = fullText.length;
						// Get cursor offset by measuring text before cursor
						let curOff = 0;
						try { const tr = new Range(); tr.setStart(pre, 0); tr.setEnd(sel.anchorNode, sel.anchorOffset); curOff = tr.cloneContents().textContent.length; } catch { curOff = r.toString().length; }
						const atStart = curOff === 0;
						const isAtEnd = curOff >= fullLen;
						const onLastLine = fullText.indexOf('\n', curOff) === -1;
						const onFirstLine = fullText.lastIndexOf('\n', curOff - 1) === -1;
						if ((e.key === 'ArrowLeft' && atStart) || (e.key === 'ArrowUp' && onFirstLine)) {
							e.preventDefault();
							// Ensure there's a text node before the code block
							let before = codeBlock.previousSibling;
							if (!before || before.nodeType !== Node.TEXT_NODE) {
								before = document.createTextNode('\u200B');
								codeBlock.before(before);
							}
							const nr = document.createRange();
							nr.setStart(before, before.length);
							nr.collapse(true);
							sel.removeAllRanges(); sel.addRange(nr);
							return;
						}
						if ((e.key === 'ArrowRight' && isAtEnd) || (e.key === 'ArrowDown' && onLastLine)) {
							e.preventDefault();
							let after = codeBlock.nextSibling;
							if (!after || after.nodeType !== Node.TEXT_NODE) {
								after = document.createTextNode('\u200B');
								codeBlock.after(after);
							}
							const nr = document.createRange();
							nr.setStart(after, 0);
							nr.collapse(true);
							sel.removeAllRanges(); sel.addRange(nr);
							return;
						}
					}
				}
			}
		}

		const mod = e.metaKey || e.ctrlKey;
		// Cmd/Ctrl+A: select all input content including EK images
		if (e.key === 'a' && mod && !e.shiftKey && inputEl) {
			e.preventDefault();
			const sel = window.getSelection();
			const r = document.createRange(); r.selectNodeContents(inputEl);
			sel?.removeAllRanges(); sel?.addRange(r); return;
		}
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
<svg width="0" height="0" style="position:absolute">
	<filter id="wavy-border-filter">
		<feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="4" result="turb" seed="2" />
		<feDisplacementMap in="SourceGraphic" in2="turb" scale={wiggleSize} xChannelSelector="R" yChannelSelector="G" />
	</filter>
</svg>
<canvas bind:this={heartsCanvas} class="hearts-canvas"></canvas>

{#if emojiTooltip}
	<div class="emoji-tooltip" style="--tip-x: {emojiTooltip.left}px; --tip-y: {emojiTooltip.anchorY}px">
		{#if emojiTooltip.type === 'ek'}
			{#if emojiTooltip.url}<img class="et-img" src={emojiTooltip.url} alt="" />{/if}
			<div class="et-ek-mix">
				<span class="et-mix-char">{emojiTooltip.parentChar}</span>
				<span class="et-mix-plus">+</span>
				<span class="et-mix-char">{emojiTooltip.childChar}</span>
			</div>
		{:else if emojiTooltip.type === 'ce'}
			<img class="et-img" src={emojiTooltip.url} alt={emojiTooltip.shortcode} />
			<span class="et-shortcode">:{emojiTooltip.shortcode}:</span>
		{/if}
	</div>
{/if}

<div class="chat-header">
	<button class="sidebar-toggle" onclick={openSidebar} aria-label="Open menu">
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
	</button>
	<h1># {data.channelId}</h1>
	<UserMenu user={data.currentUser} />
</div>

<div class="message-list" bind:this={listEl} style:padding-bottom="{inputAreaHeight}px" onscroll={onListScroll} oncopy={onMsgListCopy} onmouseover={onMsgListMouseover} onmousemove={onMsgListMousemove} onmouseleave={onMsgListMouseleave}>
	{#if loadingMore}
		<div class="load-more-spinner"><span class="sending-spinner"></span></div>
	{/if}
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
						{#if msg.attachment.isReaction}
							<div class="bubble bubble-img bubble-reaction-img">
								<img src={msg.attachment.url} alt={msg.attachment.filename} onload={scrollIfNearBottom} onerror={(e) => { const img = e.target; const r = parseInt(img.dataset.retries ?? '0'); if (r < 3) { img.dataset.retries = r + 1; setTimeout(() => { img.src = img.src; }, 1000 * (r + 1)); } else { img.replaceWith(Object.assign(document.createElement('div'), { className: 'img-removed', textContent: 'Image removed' })); } }} />
							</div>
						{:else}
							<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-img">
								<img src={msg.attachment.url} alt={msg.attachment.filename} onload={scrollIfNearBottom} onerror={(e) => { const img = e.target; const r = parseInt(img.dataset.retries ?? '0'); if (r < 3) { img.dataset.retries = r + 1; setTimeout(() => { img.src = img.src; }, 1000 * (r + 1)); } else { img.replaceWith(Object.assign(document.createElement('div'), { className: 'img-removed', textContent: 'Image removed' })); } }} />
							</a>
						{/if}
					{:else if msg.attachment.mimetype?.startsWith('video/')}
						<div class="bubble bubble-video" >
							<video src={msg.attachment.url} controls preload="metadata" class="att-video" onloadedmetadata={scrollIfNearBottom}></video>
							<div class="att-info att-info-video">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{formatSize(msg.attachment.size)}</span>
							</div>
						</div>
					{:else}
						{@const viewable = isViewableFile(msg.attachment.filename, msg.attachment.mimetype, msg.attachment.size)}
						{@const codeIcon = fileCodeIcon(msg.attachment.filename)}
						<div class="bubble bubble-file" class:mine={isMine}>
							{#if codeIcon}
								<img class="att-code-icon" src={codeIcon} alt="" />
							{:else}
								<FileTypeIcon filename={msg.attachment.filename} mimetype={msg.attachment.mimetype} iconSize={36} />
							{/if}
							<div class="att-file-body">
								<span class="att-name">{msg.attachment.filename}</span>
								<span class="att-size">{fileTypeName(msg.attachment.filename) ? `${fileTypeName(msg.attachment.filename)} · ` : ''}{formatSize(msg.attachment.size)}</span>
								<div class="att-btns">
									{#if viewable}
										<button class="att-btn" onclick={() => viewFile(msg.attachment.url, msg.attachment.filename)}>
											<svg class="att-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
											View
										</button>
									{/if}
									<a class="att-btn" href={msg.attachment.url} target="_blank" rel="noopener noreferrer">
										<svg class="att-btn-icon" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></svg>
										Source
									</a>
									<button class="att-btn" onclick={() => downloadFile(msg.attachment.url, msg.attachment.filename)}>
										<svg class="att-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
										Download
									</button>
								</div>
							</div>
						</div>
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
					<p class="bubble" use:scallopedClip={{ active: msg.fx === 'scalloped', ws: msg.wiggleSize || 6 }} use:starburstClip={{ active: msg.fx === 'starburst', ws: msg.wiggleSize || 6 }} class:fx-rainbow={msg.fx === 'rainbow'} class:fx-rainbow-fill={msg.fx === 'rainbow-fill'} class:fx-hearts={msg.fx === 'hearts'} class:fx-slam={msg.fx === 'slam'} class:fx-loud={msg.fx === 'loud'} class:fx-gentle={msg.fx === 'gentle'} class:fx-invisible={msg.fx === 'invisible'} class:fx-shake={msg.fx === 'shake'} class:fx-bounce={msg.fx === 'bounce'} class:fx-wave={msg.fx === 'wave'} class:fx-jitter={msg.fx === 'jitter'} class:fx-big={msg.fx === 'big'} class:fx-small={msg.fx === 'small'} class:fx-wiggly={msg.fx === 'wiggly'} class:fx-cursed={msg.fx === 'cursed'} class:fx-scalloped={msg.fx === 'scalloped'} class:fx-starburst={msg.fx === 'starburst'} class:revealed={revealedInvisible.has(msg.id)} class:jumbo-emoji={jumboEmojiCountM(msg.content) > 0 && !msg.replyTo} class:has-reply={!!msg.replyTo} style:font-size={bubbleFontSize(msg.content, msg.fontSize)} style:font-weight={msg.fontWeight && msg.fontWeight !== 400 ? msg.fontWeight : null} style:font-stretch={msg.fontStretch && msg.fontStretch !== 100 ? `${msg.fontStretch}%` : null} style:--ws={msg.fx === 'wiggly' && msg.wiggleSize ? `${msg.wiggleSize}px` : msg.fx === 'cursed' && msg.wiggleSize ? msg.wiggleSize : null} data-font-size={msg.fontSize && msg.fontSize !== 1 ? msg.fontSize : null} data-font-weight={msg.fontWeight && msg.fontWeight !== 400 ? msg.fontWeight : null} data-font-stretch={msg.fontStretch && msg.fontStretch !== 100 ? msg.fontStretch : null} onclick={msg.fx === 'invisible' && !revealedInvisible.has(msg.id) ? () => revealInvisible(msg.id) : undefined}>{#if msg.replyTo}{@const _rp = stripMarkup(msg.replyTo.content)}{@const _rj = jumboEmojiCountM(_rp)}<button class="reply-quote" onclick={(e) => { e.stopPropagation(); scrollToMessage(msg.replyTo.id); }}><span class="reply-author">{msg.replyTo.userName}</span><span class="reply-text" class:jumbo-reply={_rj > 0} style:font-size={_rj > 0 ? JUMBO_SIZES[_rj - 1] : null}>{@html contentHtmlM(msg.replyTo.content)}</span></button>{/if}{@html contentHtmlM(msg.content, !msg.noSplit)}{#if msg.edited}<span class="edited-tag"> (edited)</span>{/if}</p>
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
			{#if msg.pending && slowPendingIds.has(msg.id)}
				<div class="msg-sending-indicator" class:mine={isMine}><span class="sending-spinner"></span></div>
			{/if}
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

{#if ceCodeLangPicker}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="compose-picker-backdrop" style="z-index:9999" onclick={() => ceCodeLangPicker = null}></div>
	<div class="format-pop code-lang-pop" style="position:fixed; left:{ceCodeLangPicker.x}px; top:{ceCodeLangPicker.y}px; z-index:10000">
		{#each CODE_LANGUAGES as lang}
			<button class="code-lang-btn" onmousedown={(e) => { e.preventDefault(); const block = ceCodeLangPicker.el; const code = block.dataset.code ?? ''; const newBlock = makeCodeBlockNode(lang.id, code); block.replaceWith(newBlock); newBlock.after(document.createTextNode('\u200B')); input = serializeCe(inputEl); ceCodeLangPicker = null; }}><img class="code-lang-icon" src={lang.icon} alt="" /> {lang.label}</button>
		{/each}
	</div>
{/if}

{#if fileViewer}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="file-viewer-overlay" onclick={() => fileViewer = null}>
		<div class="file-viewer" onclick={(e) => e.stopPropagation()}>
			<div class="file-viewer-header">
				{#if fileCodeIcon(fileViewer.filename)}
					<img class="file-viewer-icon" src={fileCodeIcon(fileViewer.filename)} alt="" />
				{/if}
				<span class="file-viewer-name">{fileViewer.filename}</span>
				<button class="file-viewer-dl" onclick={(e) => { const btn = e.currentTarget; navigator.clipboard.writeText(fileViewer.content).then(() => { btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a6e3a1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`; setTimeout(() => { btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`; }, 1500); }); }}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
					Copy
				</button>
				<a class="file-viewer-dl" href={fileViewer.url} target="_blank" rel="noopener noreferrer">
					<svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z"/></svg>
					Source
				</a>
				<button class="file-viewer-dl" onclick={() => downloadFile(fileViewer.url, fileViewer.filename)}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
					Download
				</button>
				<button class="file-viewer-close" onclick={() => fileViewer = null}>×</button>
			</div>
			<pre class="file-viewer-code"><code>{@html highlightCode(fileViewer.content, fileViewer.lang)}</code></pre>
		</div>
	</div>
{/if}

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
		{#if pendingAttachment.mimetype?.startsWith('image/')}
			<div class="att-img-preview">
				<img class="att-img-large" src={pendingAttachment.url} alt={pendingAttachment.filename} />
				<button class="att-img-close" onclick={cancelAttachment}>×</button>
			</div>
		{:else}
			<div class="reply-bar att-bar">
				<FileTypeIcon filename={pendingAttachment.filename} mimetype={pendingAttachment.mimetype} iconSize={32} />
				<div class="reply-bar-content">
					<span class="reply-bar-to">{pendingAttachment.filename}</span>
					<span class="reply-bar-text">{formatSize(pendingAttachment.size)}</span>
				</div>
				<button class="reply-bar-close" onclick={cancelAttachment}>×</button>
			</div>
		{/if}
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
				<p class="bubble" use:scallopedClip={{ active: messageEffect === 'scalloped', ws: wiggleSize }} use:starburstClip={{ active: messageEffect === 'starburst', ws: wiggleSize }} class:fx-rainbow={messageEffect === 'rainbow'} class:fx-rainbow-fill={messageEffect === 'rainbow-fill'} class:fx-hearts={messageEffect === 'hearts'} class:fx-slam={messageEffect === 'slam'} class:fx-loud={messageEffect === 'loud'} class:fx-gentle={messageEffect === 'gentle'} class:fx-invisible={messageEffect === 'invisible'} class:fx-wiggly={messageEffect === 'wiggly'} class:fx-cursed={messageEffect === 'cursed'} class:fx-scalloped={messageEffect === 'scalloped'} class:fx-starburst={messageEffect === 'starburst'} style:--ws={messageEffect === 'wiggly' ? `${wiggleSize}px` : messageEffect === 'cursed' ? wiggleSize : null}>{@html contentHtml(input, fxSplitWords)}</p>
			{/if}
		</div>
	{/if}
	{#if ceSuggestions.length > 0}
		<div class="emoji-suggestions ce-shortcode-suggestions">
			{#each ceSuggestions as s (s.shortcode)}
				<button class="emoji-sugg-btn ce-sugg-btn" onmousedown={(e) => { e.preventDefault(); resolveColonShortcode(s.shortcode); }} title={':' + s.shortcode + ':'}>
					<img src={s.url} alt={':' + s.shortcode + ':'} class="ce-sugg-img" />
					<span class="ce-sugg-sc">{s.shortcode}</span>
				</button>
			{/each}
		</div>
	{:else if emojiSuggestions.length > 0}
		<div class="emoji-suggestions">
			{#each emojiSuggestions as s (s.cp)}
				<button class="emoji-sugg-btn" onmousedown={(e) => { e.preventDefault(); insertEmoji(s.e); }} title={s.cp}>{s.e}</button>
			{/each}
		</div>
	{/if}
	{#if detectedCodeLang && ceSuggestions.length === 0}
		<div class="emoji-suggestions code-suggest-bar">
			<button class="code-suggest-pill" onmousedown={(e) => { e.preventDefault(); wrapAsCode(detectedCodeLang); }}>
				Format as <strong>{detectedCodeLang}</strong>
			</button>
		</div>
	{/if}
	{#if showTextFxBar}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="text-typo-bar" onfocusin={() => { showTextFxBar = true; }}>
			<div class="typo-inline-row">
				<span class="typo-inline-label">Size</span>
				<input class="typo-inline-range" type="range" min="0.55" max="5" step="0.05"
					bind:value={messageFontSize}
					oninput={() => { if (_savedCeSel) { applyInlineSize(messageFontSize); showTextFxBar = true; } }} />
				{#if messageFontSize !== 1.0}<button class="typo-inline-reset" onmousedown={(e) => { e.preventDefault(); messageFontSize = 1.0; _lastInlineTypo['sz-'] = null; if (_savedCeSel) applyInlineSize(1.0); }}>↺</button>{/if}
			</div>
			<div class="typo-inline-row">
				<span class="typo-inline-label">Weight</span>
				<input class="typo-inline-range" type="range" min="100" max="700" step="50"
					bind:value={messageFontWeight}
					oninput={() => { if (_savedCeSel) { applyInlineWeight(messageFontWeight); showTextFxBar = true; } }} />
				{#if messageFontWeight !== 400}<button class="typo-inline-reset" onmousedown={(e) => { e.preventDefault(); messageFontWeight = 400; _lastInlineTypo['wght-'] = null; if (_savedCeSel) applyInlineWeight(400); }}>↺</button>{/if}
			</div>
			<div class="typo-inline-row">
				<span class="typo-inline-label">Width</span>
				<input class="typo-inline-range" type="range" min="25" max="150" step="1"
					bind:value={messageFontStretch}
					oninput={() => { if (_savedCeSel) { applyInlineWidth(messageFontStretch); showTextFxBar = true; } }} />
				{#if messageFontStretch !== 100}<button class="typo-inline-reset" onmousedown={(e) => { e.preventDefault(); messageFontStretch = 100; _lastInlineTypo['wdth-'] = null; if (_savedCeSel) applyInlineWidth(100); }}>↺</button>{/if}
			</div>
			<button class="typo-default-btn" onmousedown={(e) => {
				e.preventDefault();
				messageFontSize = 1.0; messageFontWeight = 400; messageFontStretch = 100;
				_lastInlineTypo = {};
				if (_savedCeSel) { applyInlineSize(1.0); applyInlineWeight(400); applyInlineWidth(100); }
			}}>Default</button>
		</div>
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
		<div class="compose-custom-emoji-wrap">
			<button class="btn-kitchen btn-gif" class:active={showGifPicker} title="GIF" onclick={() => showGifPicker = !showGifPicker}>GIF</button>
			{#if showGifPicker}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="compose-picker-backdrop" onclick={() => showGifPicker = false}></div>
				<div class="compose-kitchen-pop">
					<GifPicker onSelect={onGifSelect} />
				</div>
			{/if}
		</div>
		<div class="compose-custom-emoji-wrap">
			<button class="btn-kitchen btn-custom-emoji" class:active={showCustomEmoji} title="Custom Emoji & Reactions" onclick={() => showCustomEmoji = !showCustomEmoji}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"/>
					<path d="M8 14s1.5 2 4 2 4-2 4-2"/>
					<line x1="9" y1="9" x2="9.01" y2="9" stroke-width="3"/>
					<line x1="15" y1="9" x2="15.01" y2="9" stroke-width="3"/>
					<path d="M16 3.5C16 3.5 20 5 20 8" stroke-width="1.5"/>
					<circle cx="20" cy="4" r="2" fill="currentColor" stroke="none"/>
				</svg>
			</button>
			{#if showCustomEmoji}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="compose-picker-backdrop" onclick={() => { showCustomEmoji = false; _clearHtmlCache(); }}></div>
				<div class="compose-kitchen-pop">
					<CustomEmojiPanel onInsertEmoji={onCustomEmojiInsert} onInsertReaction={onReactionInsert} isInstructor={data.currentUser.role === 'instructor'} />
				</div>
			{/if}
		</div>
		<div class="compose-picker-wrap">
			<button class="btn-kitchen btn-tg-emoji" class:active={showTgEmoji} title="Telegram animated emoji" onclick={() => showTgEmoji = !showTgEmoji}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21.5 4.5 2.5 12l6 2 2 6 3-4 5 4 3-15.5z" fill="currentColor" stroke="none"/>
					<path d="M8.5 14 18 7l-7 9" stroke="var(--paper,#f7f2ea)" stroke-width="1.2"/>
				</svg>
			</button>
			{#if showTgEmoji}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="compose-picker-backdrop" onclick={() => { showTgEmoji = false; _clearHtmlCache(); }}></div>
				<div class="compose-kitchen-pop">
					<TelegramEmojiPanel onInsert={onTgEmojiInsert} />
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
				contenteditable={!uploading}
				bind:this={inputEl}
				oninput={onCeInput}
				onkeydown={onKeydown}
				onclick={(e) => {
					const langBtn = e.target.closest?.('.ce-code-lang-btn');
					if (langBtn) {
						e.preventDefault();
						const block = langBtn.closest('.code-block-ce');
						if (block) {
							const rect = langBtn.getBoundingClientRect();
							ceCodeLangPicker = { el: block, x: rect.left, y: rect.bottom + 4 };
						}
						return;
					}
					if (e.target === inputEl) {
						const last = inputEl.lastChild;
						if (last?.classList?.contains('code-block-ce')) {
							const tn = document.createTextNode('\u200B');
							inputEl.appendChild(tn);
							const sel = window.getSelection();
							const r = document.createRange();
							r.setStart(tn, 0); r.collapse(true);
							sel.removeAllRanges(); sel.addRange(r);
						}
					}
				}}
				onmouseup={onCeSelect}
				onkeyup={onCeSelect}
				onfocus={() => keyboardOpen = true}
				onblur={() => { keyboardOpen = false; setTimeout(() => { const ae = document.activeElement; if (!ae?.closest('.text-fx-bar') && !ae?.closest('.text-typo-bar') && !ae?.closest('.compose-format-wrap')) showTextFxBar = false; }, 120); }}
				oncopy={onCeCopy}
				onpaste={onCePaste}
				data-placeholder="Message #{data.channelId}"
				style:font-size={(messageFontSize !== 1.0 && !_savedCeSel) ? `${(messageFontSize * 0.9).toFixed(2)}rem` : (jumboInput > 0 ? JUMBO_SIZES[jumboInput - 1] : null)}
				style:font-weight={(messageFontWeight !== 400 && !_savedCeSel) ? messageFontWeight : null}
				style:font-stretch={(messageFontStretch !== 100 && !_savedCeSel) ? `${messageFontStretch}%` : null}
			></div>
			<div class="compose-fmt-row">
				<button class="btn-fmt btn-fmt-bold" onmousedown={(e) => { e.preventDefault(); applyTextFx('bold'); }} title="Bold (⌘B)"><b>B</b></button>
				<button class="btn-fmt btn-fmt-italic" onmousedown={(e) => { e.preventDefault(); applyTextFx('italic'); }} title="Italic (⌘I)"><i>I</i></button>
				<button class="btn-fmt btn-fmt-underline" onmousedown={(e) => { e.preventDefault(); applyTextFx('underline'); }} title="Underline (⌘U)"><u>U</u></button>
				<button class="btn-fmt btn-fmt-strike" onmousedown={(e) => { e.preventDefault(); applyTextFx('strike'); }} title="Strikethrough"><s>S</s></button>
				<div class="compose-format-wrap">
					<button class="btn-fmt btn-fmt-color" class:active={showFormatPanel} onmousedown={(e) => { e.preventDefault(); showFormatPanel = !showFormatPanel; showCodePanel = false; }} title="Text color">A</button>
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
				<div class="compose-format-wrap code-btn-group">
					<button class="btn-fmt btn-fmt-code" onmousedown={(e) => { e.preventDefault(); toggleCodeBlock(); }} title="Toggle code block">&lt;/&gt;</button>
					<button class="btn-fmt btn-fmt-code-arrow" class:active={showCodePanel} onmousedown={(e) => { e.preventDefault(); showCodePanel = !showCodePanel; showFormatPanel = false; }} title="Choose language">▾</button>
					{#if showCodePanel}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="compose-picker-backdrop" onclick={() => showCodePanel = false}></div>
						<div class="format-pop code-lang-pop">
							{#each CODE_LANGUAGES as lang}
								<button class="code-lang-btn" onmousedown={(e) => { e.preventDefault(); insertCodeBlock(lang.id); }}><img class="code-lang-icon" src={lang.icon} alt="" /> {lang.label}</button>
							{/each}
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
				<div class="compose-picker-backdrop" onclick={() => { showEffectPanel = false; _savedCeSel = null; _lastInlineTypo = {}; }}></div>
				<div class="effect-pop">
					<div class="effect-pop-title">Bubble</div>
					<div class="effect-grid">
						{#each BUBBLE_FXS as fx}
							<button class="effect-tile" class:active={messageEffect === fx.name}
									onclick={() => {
										const wasActive = messageEffect === fx.name;
										messageEffect = wasActive ? null : fx.name;
										if (wasActive || (fx.name !== 'wiggly' && fx.name !== 'cursed' && fx.name !== 'scalloped' && fx.name !== 'starburst')) {
											showEffectPanel = false;
										}
										if (wasActive) { wiggleSize = 6; }
										_savedCeSel = null; _lastInlineTypo = {};
									}}>
								<span class="effect-tile-icon">{fx.icon}</span>
								<span class="effect-tile-label">{fx.label}</span>
							</button>
						{/each}
					</div>
					{#if messageEffect === 'wiggly' || messageEffect === 'cursed' || messageEffect === 'scalloped' || messageEffect === 'starburst'}
						<div class="wiggle-slider-row">
							<span class="wiggle-slider-label">Rippliness</span>
							<input class="wiggle-slider" type="range"
								min={messageEffect === 'cursed' ? 2 : 3}
								max={messageEffect === 'cursed' ? 25 : 18}
								step="1"
								bind:value={wiggleSize} />
							<span class="wiggle-slider-val">{wiggleSize}</span>
						</div>
					{/if}
					<div class="effect-pop-title">Screen</div>
					<div class="effect-grid">
						{#each SCREEN_FXS as fx}
							<button class="effect-tile" class:active={messageEffect === fx.name}
									onclick={() => { messageEffect = messageEffect === fx.name ? null : fx.name; showEffectPanel = false; _savedCeSel = null; _lastInlineTypo = {}; }}>
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
		flex: 1; overflow-y: auto; overflow-x: clip; padding: 1rem 1.5rem;
		display: flex; flex-direction: column; gap: 0.15rem;
		scrollbar-width: none;
		overscroll-behavior: contain;
	}
	.message-list::-webkit-scrollbar { display: none; }
	.empty { color: #a09688; font-size: 0.9rem; text-align: center; margin: auto; }
	.load-more-spinner { display: flex; justify-content: center; padding: 0.75rem 0; }
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
	.bubble-row { position: relative; display: flex; align-items: flex-end; gap: 0.3rem; max-width: 100%; min-width: 0; }
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
	.msg-sending-indicator { position: absolute; bottom: -14px; left: 4px; }
	.msg-sending-indicator.mine { left: auto; right: 4px; }
	.sending-spinner { display: block; width: 10px; height: 10px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; opacity: 0.35; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.bubble.jumbo-emoji { background: transparent !important; border-color: transparent !important; box-shadow: none !important; padding: 0.1rem 0.4rem; line-height: 1.15; }

	/* Code blocks */
	/* Code block in compose input */
	:global(.code-block-ce) {
		margin: 0.3rem 0; border-radius: 8px;
		background: #1e1e2e; color: #cdd6f4; overflow: hidden;
		white-space: normal; word-break: normal;
	}
	:global(.code-block-ce-header) {
		padding: 0.2rem 0.5rem; background: #181825;
		font-size: 0.6rem; color: #6c7086; text-transform: uppercase; letter-spacing: 0.04em;
		display: flex; align-items: center;
	}
	:global(.code-block-ce-lang) { display: inline-flex; align-items: center; gap: 0.2rem; }
	:global(.ce-code-icon) { width: 11px; height: 11px; display: block; margin-top: -1px; }
	:global(.ce-code-lang-btn) {
		background: none; border: none; color: #6c7086; font-size: 0.5rem;
		cursor: pointer; padding: 0 0.2rem; margin-left: 0.15rem; border-radius: 3px;
		transition: color 0.1s, background 0.1s;
	}
	:global(.ce-code-lang-btn:hover) { color: #cdd6f4; background: #313244; }
	:global(.code-block-ce-code) {
		margin: 0; padding: 0.45rem 0.6rem; font-size: 0.75rem; line-height: 1.5;
		overflow-x: auto; max-height: 200px; overflow-y: auto;
		font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; white-space: pre;
		outline: none; caret-color: #cdd6f4;
	}
	:global(.code-block-ce-code code) { font-family: inherit; white-space: pre; }
	:global(.code-block-ce-code .hljs-keyword) { color: #cba6f7; }
	:global(.code-block-ce-code .hljs-string) { color: #a6e3a1; }
	:global(.code-block-ce-code .hljs-number) { color: #fab387; }
	:global(.code-block-ce-code .hljs-comment) { color: #6c7086; font-style: italic; }
	:global(.code-block-ce-code .hljs-function),
	:global(.code-block-ce-code .hljs-title) { color: #89b4fa; }
	:global(.code-block-ce-code .hljs-params) { color: #f2cdcd; }
	:global(.code-block-ce-code .hljs-built_in),
	:global(.code-block-ce-code .hljs-type) { color: #f9e2af; }
	:global(.code-block-ce-code .hljs-attr),
	:global(.code-block-ce-code .hljs-tag) { color: #89b4fa; }
	:global(.code-block-ce-code .hljs-name) { color: #cba6f7; }
	:global(.code-block-ce-code .hljs-variable) { color: #f5c2e7; }
	:global(.code-block-ce-code .hljs-operator) { color: #94e2d5; }
	:global(.code-block-ce-code .hljs-literal) { color: #fab387; }
	:global(.code-block-ce-code .hljs-attribute) { color: #a6e3a1; }
	:global(.code-block-ce-code .hljs-meta) { color: #f9e2af; }
	:global(.code-block-ce-code .hljs-punctuation) { color: #9399b2; }
	:global(.code-block-ce-code .hljs-selector-class) { color: #a6e3a1; }
	:global(.code-block-ce-code .hljs-subst) { color: #cdd6f4; }
	:global(.code-block) {
		margin: 0.3rem 0; border-radius: 8px;
		background: #1e1e2e; color: #cdd6f4; overflow: hidden;
		white-space: normal; word-break: normal;
		width: 100%;
	}
	:global(.code-block-header) {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.25rem 0.65rem 0.25rem 4px;
		background: #181825;
		container-type: inline-size;
		user-select: none;
	}
	@container (max-width: 120px) {
		:global(.copy-label) { display: none; }
	}
	:global(.code-lang) {
		font-size: 0.62rem; color: #6c7086; font-family: inherit;
		text-transform: uppercase; letter-spacing: 0.04em;
		display: inline-flex; align-items: center; gap: 0.25rem;
		line-height: 1;
	}
	:global(.code-copy-btn) {
		display: inline-flex; align-items: center; gap: 0.25rem;
		background: none; border: none; color: #6c7086; font-size: 0.62rem;
		font-family: inherit; cursor: pointer; padding: 0.15rem 0.4rem;
		border-radius: 4px; transition: color 0.1s, background 0.1s;
	}
	:global(.code-copy-btn:hover) { color: #cdd6f4; background: #313244; }
	:global(.code-body) { display: grid; grid-template-columns: auto 1fr; overflow: auto; }
	:global(.code-lines) {
		margin: 0; padding: 0.65rem 0; padding-left: 0.65rem; padding-right: 0.5rem;
		font-size: 0.78rem; line-height: 1.55; text-align: right;
		color: #45475a; user-select: none; flex-shrink: 0;
		border-right: 1px solid #313244;
		font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
		position: sticky; left: 0; background: #1e1e2e; z-index: 2;
	}
	:global(.code-ln) { display: block; }
	:global(.code-content) { margin: 0; padding: 0.65rem 0.85rem; font-size: 0.78rem; line-height: 1.55; flex: 1; min-width: 0; position: relative; z-index: 0; }
	:global(.code-block code) { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; white-space: pre; }
	:global(.code-block[data-truncated="1"] .code-body) { max-height: calc(20 * 1.55 * 0.78rem); overflow: auto; }
	:global(.code-show-more) {
		display: block; width: 100%; padding: 0.4rem; border: none;
		background: #181825; color: #89b4fa; font-size: 0.72rem; font-weight: 600;
		font-family: inherit; cursor: pointer; text-align: center;
		transition: background 0.1s;
	}
	:global(.code-show-more:hover) { background: #313244; }
	:global(.inline-code) {
		background: rgba(0,0,0,0.07); padding: 0.1em 0.35em; border-radius: 4px;
		font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.88em;
	}
	:global(.message.mine .inline-code) { background: rgba(255,255,255,0.15); }
	/* highlight.js token colors (Catppuccin Mocha) */
	:global(.code-block .hljs-keyword), :global(.file-viewer-code .hljs-keyword) { color: #cba6f7; }
	:global(.code-block .hljs-string), :global(.file-viewer-code .hljs-string) { color: #a6e3a1; }
	:global(.code-block .hljs-number), :global(.file-viewer-code .hljs-number) { color: #fab387; }
	:global(.code-block .hljs-comment), :global(.file-viewer-code .hljs-comment) { color: #6c7086; font-style: italic; }
	:global(.code-block .hljs-function), :global(.file-viewer-code .hljs-function) { color: #89b4fa; }
	:global(.code-block .hljs-title), :global(.file-viewer-code .hljs-title) { color: #89b4fa; }
	:global(.code-block .hljs-params), :global(.file-viewer-code .hljs-params) { color: #f2cdcd; }
	:global(.code-block .hljs-built_in), :global(.file-viewer-code .hljs-built_in) { color: #f9e2af; }
	:global(.code-block .hljs-literal), :global(.file-viewer-code .hljs-literal) { color: #fab387; }
	:global(.code-block .hljs-type), :global(.file-viewer-code .hljs-type) { color: #f9e2af; }
	:global(.code-block .hljs-attr), :global(.file-viewer-code .hljs-attr) { color: #89b4fa; }
	:global(.code-block .hljs-attribute), :global(.file-viewer-code .hljs-attribute) { color: #a6e3a1; }
	:global(.code-block .hljs-tag), :global(.file-viewer-code .hljs-tag) { color: #89b4fa; }
	:global(.code-block .hljs-name), :global(.file-viewer-code .hljs-name) { color: #cba6f7; }
	:global(.code-block .hljs-selector-class), :global(.file-viewer-code .hljs-selector-class) { color: #a6e3a1; }
	:global(.code-block .hljs-selector-id), :global(.file-viewer-code .hljs-selector-id) { color: #fab387; }
	:global(.code-block .hljs-variable), :global(.file-viewer-code .hljs-variable) { color: #f5c2e7; }
	:global(.code-block .hljs-meta), :global(.file-viewer-code .hljs-meta) { color: #f9e2af; }
	:global(.code-block .hljs-operator), :global(.file-viewer-code .hljs-operator) { color: #94e2d5; }
	:global(.code-block .hljs-punctuation), :global(.file-viewer-code .hljs-punctuation) { color: #9399b2; }
	:global(.code-block .hljs-subst), :global(.file-viewer-code .hljs-subst) { color: #cdd6f4; }
	:global(.code-block .hljs-doctag), :global(.file-viewer-code .hljs-doctag) { color: #cba6f7; }
	:global(.code-block .hljs-regexp), :global(.file-viewer-code .hljs-regexp) { color: #f5c2e7; }
	:global(.code-block .hljs-symbol), :global(.file-viewer-code .hljs-symbol) { color: #f2cdcd; }
	:global(.code-block .hljs-section), :global(.file-viewer-code .hljs-section) { color: #89b4fa; }

	/* Attachment bubbles */
	.bubble-img {
		padding: 0; overflow: hidden; display: block; max-width: 260px; border-radius: 14px;
		text-decoration: none; background: transparent !important; border-color: transparent !important;
	}
	.bubble-reaction-img { border-radius: 0 !important; }
	.img-removed {
		display: flex; align-items: center; justify-content: center;
		width: 200px; height: 120px; background: #eae5dc; color: #a09688;
		font-size: 0.78rem; font-family: inherit; border-radius: 8px;
	}
	:global(.img-removed-inline) {
		display: inline-block; padding: 0.1em 0.4em;
		background: #eae5dc; color: #a09688; border-radius: 4px;
		font-size: 0.72em; vertical-align: middle;
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
		display: flex; align-items: flex-start; gap: 0.65rem;
		padding: 0.6rem 0.85rem; text-decoration: none; color: var(--ink);
		min-width: 0;
	}
	.bubble-file.mine { color: var(--paper); }
	.att-code-icon { width: 32px; height: 32px; flex-shrink: 0; margin-top: 0.1rem; }
	.att-file-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1; }
	.att-info { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
	.att-name { font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.att-size { font-size: 0.7rem; opacity: 0.6; }
	.att-btns { display: flex; gap: 0.3rem; margin-top: 0.25rem; }
	.att-btn {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.22rem 0.55rem; border-radius: 5px; font-family: inherit; font-size: 0.7rem;
		font-weight: 600; cursor: pointer; text-decoration: none; transition: background 0.1s;
		border: 1px solid #c8c1b4; background: transparent; color: inherit;
	}
	.att-btn:hover { background: rgba(0,0,0,0.06); }
	.att-btn-icon { width: 13px; height: 13px; flex-shrink: 0; }
	.message.mine .att-btn { border-color: rgba(255,255,255,0.3); }
	.message.mine .att-btn:hover { background: rgba(255,255,255,0.12); }

	/* File viewer modal */
	.file-viewer-overlay {
		position: fixed; inset: 0; z-index: 10000;
		background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
		padding: 2rem;
	}
	.file-viewer {
		background: #1e1e2e; border-radius: 12px; overflow: hidden;
		max-width: 700px; width: 100%; max-height: 80vh; display: flex; flex-direction: column;
		box-shadow: 0 8px 40px rgba(0,0,0,0.4);
	}
	.file-viewer-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.6rem 1rem; background: #181825; border-bottom: 1px solid #313244;
		font-size: 0.78rem; color: #cdd6f4; font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
	}
	.file-viewer-icon { width: 16px; height: 16px; flex-shrink: 0; margin-right: 0.35rem; }
	.file-viewer-name { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-viewer-dl {
		display: inline-flex; align-items: center; gap: 0.3rem;
		color: #cdd6f4; padding: 0.2rem 0.6rem; border-radius: 5px;
		background: #313244; font-size: 0.72rem; font-weight: 600;
		text-decoration: none; flex-shrink: 0; margin-right: 0.5rem;
		transition: background 0.12s;
		border: none; cursor: pointer; font-family: inherit;
	}
	.file-viewer-dl:hover { background: #45475a; }
	.file-viewer-close {
		background: none; border: none; color: #6c7086; font-size: 1.2rem;
		cursor: pointer; padding: 0 0.3rem; line-height: 1; border-radius: 4px;
	}
	.file-viewer-close:hover { color: #cdd6f4; background: #313244; }
	.file-viewer-code {
		margin: 0; padding: 1rem; overflow: auto; flex: 1;
		font-size: 0.78rem; line-height: 1.6; color: #cdd6f4;
	}
	.file-viewer-code code {
		font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; white-space: pre;
	}

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
		top: calc(100% + 6px);
		left: 50%; transform: translateX(-50%);
		min-width: max-content;
		background: var(--paper, #f7f2ea); color: var(--ink);
		border: 1.5px solid #ddd7cc;
		border-radius: 10px; padding: 0.5rem 0.75rem;
		font-size: 0.78rem; white-space: nowrap;
		z-index: 30; pointer-events: none;
		flex-direction: row; align-items: center; gap: 0.55rem;
		box-shadow: 0 4px 18px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
	}
	.reaction-chip:hover .reaction-tooltip { display: flex; }
	.reaction-tooltip-emoji { font-size: 2rem; line-height: 1; flex-shrink: 0; }
	.reaction-tooltip-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.reaction-tooltip-names { font-weight: 600; font-size: 0.78rem; }
	.reaction-tooltip-label { font-size: 0.7rem; opacity: 0.6; }

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
	.att-img-preview {
		position: relative; padding: 0.5rem 1.5rem; border-top: 1px solid #ddd7cc; background: #faf8f5;
	}
	.att-img-large {
		display: block; max-width: 240px; max-height: 200px; object-fit: contain;
		border-radius: 10px; border: 1.5px solid #e0d9cc;
	}
	.att-img-close {
		position: absolute; top: 0.6rem; right: 1.6rem;
		width: 24px; height: 24px; border-radius: 50%;
		background: rgba(0,0,0,0.5); color: #fff; border: none;
		font-size: 1rem; line-height: 1; cursor: pointer;
		display: flex; align-items: center; justify-content: center;
	}
	.att-img-close:hover { background: rgba(0,0,0,0.7); }

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
	.code-suggest-bar { justify-content: flex-start; }
	.code-suggest-pill {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.3rem 0.75rem;
		background: #1e1e2e; color: #cdd6f4; border: none; border-radius: 8px;
		font-family: inherit; font-size: 0.75rem; cursor: pointer;
		transition: background 0.12s;
	}
	.code-suggest-pill:hover { background: #313244; }
	.code-suggest-pill strong { color: #89b4fa; }
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
		height: 1.2em;
		width: 1.2em;
		vertical-align: -0.25em;
		object-fit: contain;
		display: inline;
	}
	:global(.ek-img-ce) {
		height: 1.2em;
		width: 1.2em;
		vertical-align: -0.25em;
		object-fit: contain;
		cursor: default;
		border-radius: 2px;
	}
	:global(.ek-img-ce.ek-selected) {
		outline: 2px solid #4a9eff;
		border-radius: 3px;
		box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.25);
	}
	:global(.ce-img) { height: 1.2em; width: 1.2em; vertical-align: -0.25em; object-fit: contain; }
	:global(.ce-img-ce) { cursor: default; }
	:global(.ce-img-ce.ek-selected) { outline: 2px solid #4a9eff; border-radius: 3px; box-shadow: 0 0 0 3px rgba(74,158,255,0.25); }
	/* Telegram animated emoji */
	:global(.tg-img) { height: 1.3em; width: 1.3em; vertical-align: -0.3em; object-fit: contain; }
	:global(.tg-img-ce) { cursor: default; }
	:global(.tg-emoji) { display: inline-block; width: 1.4em; height: 1.4em; vertical-align: -0.3em; cursor: default; line-height: 0; }
	:global(.tg-emoji.tg-fx) { cursor: pointer; }
	/* Let the parent span catch the click — SVG/canvas inside default to capturing
	   pointer events only on painted pixels, so transparent corners would miss. */
	:global(.tg-emoji svg), :global(.tg-emoji canvas) { pointer-events: none; }
	:global(.tg-emoji svg), :global(.tg-emoji canvas) { width: 100%; height: 100%; display: block; }
	:global(.tg-emoji-img) { width: 100%; height: 100%; object-fit: contain; display: block; }
	:global(.tg-interaction) { animation: tgFadeOut 0.6s ease-out 5.0s both; }
	/* Mirror directional click-animations on RECEIVED messages so the emanation
	   flows correctly toward the recipient's bubble side (Telegram convention) */
	:global(.tg-flip-theirs) { transform: scaleX(-1); }
	:global(.tg-interaction.tg-flip-theirs) { transform: scaleX(-1); }
	@keyframes tgFadeOut { to { opacity: 0; } }

	.compose-kitchen-wrap { position: relative; flex-shrink: 0; }
	.compose-custom-emoji-wrap { position: relative; flex-shrink: 0; }
	.btn-kitchen {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px;
		border: 1.5px solid #c8c1b4; border-radius: 10px;
		background: #fff; color: #a09688; cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.btn-kitchen:hover, .btn-kitchen.active { color: var(--ink); border-color: #b0a898; background: #f5f2ee; }
	.btn-gif { font-size: 0.65rem; font-weight: 700; font-family: inherit; letter-spacing: -0.02em; }
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

	.btn-fmt-code { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.65rem !important; letter-spacing: -0.02em; border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; }
	.btn-fmt-code-arrow { font-size: 0.55rem !important; padding: 0 0.15rem !important; border-top-left-radius: 0 !important; border-bottom-left-radius: 0 !important; margin-left: -1px; min-width: 0; }
	.code-btn-group { display: flex; align-items: center; }
	.code-lang-pop {
		display: flex; flex-wrap: wrap; gap: 0.2rem; padding: 0.45rem; width: 200px;
	}
	.code-lang-btn {
		padding: 0.22rem 0.5rem; border: 1px solid #e0d9cc; border-radius: 5px;
		background: #fff; font-family: inherit; font-size: 0.7rem; cursor: pointer;
		color: var(--ink); transition: background 0.1s, border-color 0.1s;
	}
	.code-lang-btn:hover { background: #1e1e2e; color: #cdd6f4; border-color: #1e1e2e; }
	.code-lang-icon { width: 14px; height: 14px; vertical-align: -2px; flex-shrink: 0; }
	:global(.code-lang .code-lang-icon) { width: 15px; height: 15px; display: block; margin-top: -2.5px; }

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
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 240px; overflow: hidden;
	}
	.typo-sliders { padding: 0.25rem 0.75rem 0.5rem; display: flex; flex-direction: column; gap: 0.45rem; }
	.typo-row { display: flex; align-items: center; gap: 0.4rem; }
	.typo-label { font-size: 0.68rem; font-weight: 600; color: #a09688; width: 2.8rem; flex-shrink: 0; }
	.typo-range { flex: 1; height: 3px; cursor: pointer; accent-color: var(--ink); }
	.typo-val { font-size: 0.68rem; color: var(--ink); width: 4.2rem; text-align: right; flex-shrink: 0; }
	.typo-reset { background: none; border: none; font-size: 0.85rem; color: #a09688; cursor: pointer; padding: 0 0 0 0.15rem; line-height: 1; flex-shrink: 0; }
	.typo-reset:hover { color: var(--ink); }
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
	.wiggle-slider-row {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.15rem 0.85rem 0.45rem;
	}
	.wiggle-slider-label {
		font-size: 0.68rem; font-weight: 600; color: #a09688; flex-shrink: 0;
	}
	.wiggle-slider {
		flex: 1; height: 3px; cursor: pointer; accent-color: var(--ink);
	}
	.wiggle-slider-val {
		font-size: 0.68rem; color: var(--ink); width: 1.5rem; text-align: right; flex-shrink: 0;
	}

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

	/* Rainbow fill effect */
	.bubble.fx-rainbow-fill {
		background: linear-gradient(var(--rwb), #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #c77dff, #ff6b6b) !important;
		border-color: transparent !important;
		color: #fff !important;
		font-weight: 700 !important;
		text-shadow: 0 1px 3px rgba(0,0,0,0.28);
		animation: rwb-spin 4s linear infinite;
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
	.ce-shortcode-suggestions { gap: 0.3rem; }
	.ce-sugg-btn { display: flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.45rem; font-size: 0.78rem; }
	.ce-sugg-img { width: 22px; height: 22px; object-fit: contain; flex-shrink: 0; }
	.ce-sugg-sc { color: var(--ink); font-family: inherit; font-size: 0.78rem; white-space: nowrap; }
	.text-typo-bar {
		display: flex; gap: 0.5rem; padding: 0.35rem 1.5rem;
		border-top: 1px solid #e8e0d2; background: #faf8f5;
		flex-wrap: wrap;
	}
	.typo-inline-row {
		display: flex; align-items: center; gap: 0.35rem; flex: 1; min-width: 100px;
	}
	.typo-inline-label {
		font-size: 0.65rem; font-weight: 600; color: #a09688;
		text-transform: uppercase; letter-spacing: 0.03em; width: 2.5rem; flex-shrink: 0;
	}
	.typo-inline-range {
		flex: 1; height: 3px; accent-color: var(--ink, #1a1a1a); cursor: pointer;
	}
	.typo-inline-reset {
		background: none; border: none; color: #a09688; font-size: 0.7rem;
		cursor: pointer; padding: 0 0.15rem; line-height: 1; flex-shrink: 0;
		transition: color 0.1s;
	}
	.typo-inline-reset:hover { color: var(--ink); }
	.typo-default-btn {
		padding: 0.15rem 0.5rem; border: 1px solid #d5cdc0; border-radius: 5px;
		background: none; font-family: inherit; font-size: 0.62rem; font-weight: 600;
		color: #a09688; cursor: pointer; white-space: nowrap; flex-shrink: 0;
		transition: background 0.1s, color 0.1s;
	}
	.typo-default-btn:hover { background: #ede8df; color: var(--ink); }
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

	/* Emoji/EK/CE hover tooltip */
	.emoji-tooltip {
		position: fixed;
		z-index: 9999;
		pointer-events: none;
		width: 160px;
		left: var(--tip-x, 8px);
		top: var(--tip-y, 0px);
		transform: translateY(10px);
		border-radius: 10px;
		background: var(--paper, #f7f2ea);
		border: 1.5px solid #ddd7cc;
		box-shadow: 0 4px 18px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		padding: 0.55rem 0.75rem 0.45rem;
		display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		animation: et-pop 0.12s cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	@keyframes et-pop { from { opacity: 0; transform: translateY(4px) scale(0.88); } to { opacity: 1; transform: translateY(10px) scale(1); } }
	.et-img { width: 64px; height: 64px; object-fit: contain; }
	.et-ek-mix { display: flex; align-items: center; gap: 0.3rem; font-size: 1.4rem; line-height: 1; }
	.et-mix-char { font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji'; }
	.et-mix-plus { font-size: 0.85rem; color: #a09688; }
	.et-name {
		font-size: 0.72rem; color: #6b5f54; text-align: center; line-height: 1.3;
		text-transform: capitalize; max-width: 160px;
	}
	.et-shortcode { font-size: 0.75rem; color: #6b5f54; font-family: monospace; }

	/* CSS-only inline emoji tooltip */
	:global(.e-tip) {
		position: relative;
		display: inline;
	}
	:global(.e-tip-pop) {
		display: none;
		position: fixed;
		left: 0;
		top: 0;
		width: 160px;
		z-index: 9999;
		pointer-events: none;
		border-radius: 10px;
		flex-direction: column; align-items: center; gap: 0.25rem;
		background: var(--paper, #f7f2ea);
		border: 1.5px solid #ddd7cc;
		box-shadow: 0 4px 18px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		padding: 0.55rem 0.75rem 0.45rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		animation: et-pop 0.12s cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	:global(.e-tip:hover .e-tip-pop) { display: flex; }
	:global(.e-tip-char) {
		font-size: 2.6rem; line-height: 1.1;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji';
	}
	:global(.e-tip-name) {
		font-size: 0.72rem; color: #6b5f54; text-align: center; line-height: 1.3;
		text-transform: capitalize; word-break: break-word;
	}
</style>
