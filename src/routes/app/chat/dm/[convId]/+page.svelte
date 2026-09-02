<script>
	import { onMount, onDestroy, tick, getContext, mount, unmount } from 'svelte';
	import SpriteSticker from '$lib/components/SpriteSticker.svelte';
	import { pageTitle, pageTitleHref } from '$lib/page-title-store.js';
	import { profileLink } from '$lib/profile-link.js';
	import { createScrollAnchor } from '$lib/chat-scroll-anchor.js';
	import { reserveAspect } from '$lib/img-dims.js';
	import { afterNavigate } from '$app/navigation';
	import { db } from '$lib/firebase.js';
	import { ref, onChildAdded, onChildRemoved, onValue, off, query, limitToLast, set, remove, get } from 'firebase/database';
	import { normaliseMessage, buildUserMap, formatTime } from '$lib/chat.js';
	import { resolveMentionsFromText, segmentMentions } from '$lib/mentions.js';
	import { scallopedClip, starburstClip } from '$lib/scalloped.js';
	// EmojiPicker import removed — ExpressionPicker mode="react" replaces it.
	import EmojiKitchen from '$lib/components/EmojiKitchen.svelte';
	import CustomEmojiPanel from '$lib/components/CustomEmojiPanel.svelte';
	import TelegramEmojiPanel from '$lib/components/TelegramEmojiPanel.svelte';
	import GifPicker from '$lib/components/GifPicker.svelte';
	import ExpressionPicker from '$lib/components/ExpressionPicker.svelte';
	import { prewarmPicker } from '$lib/picker-prewarm.js';
	import MediaPicker from '$lib/components/MediaPicker.svelte';
	import { haptic, isNativeApp } from '$lib/native.js';
	import { decodeReactionKey } from '$lib/reaction-key.js';
	import { positionReactionTooltip } from '$lib/reaction-tooltip.js';
	import MentionAutocomplete from '$lib/components/MentionAutocomplete.svelte';
	import lottie from 'lottie-web';
	import { loadTelegramEmoji, getCachedTgEmoji, tgEntry, tgAnimatedUrl, tgFlagUrl, tgAnimationUrl, fetchLottie, cpToToken,
		loadCustomPacks, getCachedCustomPacks, tgcUrl, tgcToToken, tgcEntry, isStaticPack, STATIC_FRAME_INDEX } from '$lib/telegram-emoji-store.js';
	import { tryPlay as _tgTryPlay, yieldPlay as _tgYieldPlay } from '$lib/lottie-throttle.js';
	import { tgStaticFrame, tgcStaticFrame, TG_PLACEHOLDER } from '$lib/tg-frame.js';
	import { mountStaticEmotes, ensureSelectableEmoteShell } from '$lib/emote-mount.js';
	import FileTypeIcon from '$lib/components/FileTypeIcon.svelte';
	import ProfileHover from '$lib/components/ProfileHover.svelte';
	import ExpressionTip from '$lib/components/ExpressionTip.svelte';
	import ThreadPanel from '$lib/components/ThreadPanel.svelte';
	import MessageAttachment from '$lib/components/MessageAttachment.svelte';
	import SpotifyCard from '$lib/components/SpotifyCard.svelte';
	import { parseSpotifyUrl } from '$lib/spotify.js';
	import Avatar from '$lib/components/Avatar.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import { loadEmojiNames, getEmojiName } from '$lib/emoji-names.js';
	import { wrapEmojiInText, tgReactionName } from '$lib/emoji-tip.js';
	import { initSemanticSearch, searchEmoji, cpToChar } from '$lib/emoji-semantic.js';
	import { getCustomEmojiMap, getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import {
		SCREEN_FXS, EXPRESSIVE_FXS, TEXT_FXS, FX_TO_CHAR, CHAR_TO_FX, FX_CLOSE_CHAR, FX_OPEN_CHARS,
		SZ_OPEN, SZ_VEND,
		TEXT_COLORS, WDTH_FX_MAP, WDTH_STEPS, WGHT_FX_MAP, WGHT_STEPS, SZ_FX_MAP, SZ_STEPS,
		JUMBO_SIZES, EMOJI_RE_G,
		escapeHtml, nestedFxHtml, ekTokenToUrl, normalizeLegacyMarkup, unicodeToReadable, readableToUnicode, stripMarkup, _segmenter, _isEmojiSeg,
		stripFormatting, markupToSegments, segmentsToMarkup, jumboEmojiCount, jumboEmojiCountM, bubbleFontSize,
		createContentRenderer, clearJumboCache, encodeLinkToken, decodeLinkToken, LK_RE
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
	// Same live presence map the channel page uses — exposed by the
	// layout via setContext('presenceStatus', ...). Reading `.value`
	// inside template bindings is reactive so RTDB updates fan in
	// without a per-page subscription.
	const presenceStatusCtx = getContext('presenceStatus');
	const otherUserId = data.convId.replace(data.currentUser.id, '').replace(/^_|_$/, '');
	// Gemma digest DMs come from the `gemma` bot user, which isn't a class
	// member — resolve it explicitly so the header/bubbles don't say Unknown.
	const otherUser = data.users.find((u) => u.id === otherUserId)
		?? (otherUserId === 'gemma' ? { name: 'Gemma', id: 'gemma', role: 'student' } : { name: 'Unknown', id: otherUserId });

	const userMap = buildUserMap(data.currentUser, data.users);
	// The gemma bot isn't in the member roster — register it so live compact
	// messages ({u:'gemma'}) resolve a name instead of falling to Unknown.
	userMap.gemma = { name: 'Gemma', role: 'student', avatarKind: 'gen', avatarValue: null };

	// ── Threads (Slack-style) — see the channel page for the contract ──
	const threadConvId = data.convId;
	let threadOpen = $state(null);
	let threadCountsArchived = $state({});
	let threadCountsLive = $state({});
	let threadCountsExact = $state({});
	let threadLiveLastAt = $state({});      // parentId → last live reply ts
	let threadReadAt = $state({});          // parentId → my read cursor (threadReads/{uid})
	// decode ms timestamp from a Firebase push id (first 8 chars)
	const _TPUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
	function _threadPushTs(id) {
		let ts = 0;
		for (let i = 0; i < 8; i++) ts = ts * 64 + _TPUSH.indexOf(id[i]);
		return ts;
	}
	function threadUnread(id) {
		if (!threadCount(id)) return false;
		const last = Math.max(threadLiveLastAt[id] ?? 0, threadCountsArchived[id]?.lastAt ?? 0);
		return last > (threadReadAt[id] ?? 0);
	}
	function threadCount(id) {
		if (threadCountsExact[id] != null) return threadCountsExact[id];
		return (threadCountsArchived[id]?.n ?? 0) + (threadCountsLive[id] ?? 0);
	}
	onMount(() => {
		// Warm every expression-picker tab while the conversation is being read.
		// Idle-scheduled and fire-once, so it never competes with the chat's own
		// first paint — see $lib/picker-prewarm.js for what it covers.
		prewarmPicker();
		fetch(`/api/chat/thread?convId=${encodeURIComponent(threadConvId)}&counts=1`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => { if (d?.counts) threadCountsArchived = d.counts; })
			.catch(() => {});
		const tref = ref(db, `threads/${threadConvId}`);
		onValue(tref, (snap) => {
			const next = {};
			const lastAt = {};
			if (snap.exists()) {
				for (const [pid, node] of Object.entries(snap.val())) {
					const keys = Object.keys(node?.messages ?? {});
					next[pid] = keys.length;
					// push ids sort lexicographically → max key = latest reply
					if (keys.length) lastAt[pid] = _threadPushTs(keys.sort().at(-1));
				}
			}
			threadCountsLive = next;
			threadLiveLastAt = lastAt;
		});
		const trref = ref(db, `threadReads/${data.currentUser.id}`);
		onValue(trref, (snap) => { threadReadAt = snap.val() || {}; });
		return () => { off(tref); off(trref); };
	});

	let messages = $state([...data.history]);
	let hasMoreHistory = $state(data.hasMoreHistory ?? false);
	let loadingMore = $state(false);
	let input = $state('');
	let emojiNames = $state({});
	let emojiTooltip = $state(null);
	let sending = $state(false);
	let slowPendingIds = $state(new Set());
	let uploading = $state(false);
	let listEl = $state(null);
	let inputEl = $state(null);
	let fileInputEl = $state(null);
	let typingUsers = $state([]);
	let keyboardOpen = $state(false);
	let inputAreaHeight = $state(0);
	// Read-receipt index: { [uid]: lastReadTimestamp }. The DM only
	// has two participants, so this maxes out at 2 entries — but the
	// listener and lookup math are identical to the channel page.
	let convReads = $state({});

	// Latest of my messages the other user has actually read past.
	// iMessage-style: the "Seen" pill hangs under the most recent
	// message confirmed delivered to their eyes — not every message
	// in the run.
	const otherSeenAt = $derived(Number(convReads[otherUser.id] ?? 0));
	// The last message the other user has read — ANY message, not just our
	// own — so the marker tracks where they actually are in the thread. Their
	// avatar renders there, position:absolute, so it never changes a
	// message's height (no reflow / scroll-jank).
	const lastSeenMsgId = $derived.by(() => {
		if (!otherSeenAt) return null;
		let id = null;
		for (const m of messages) if ((m.createdAt || 0) <= otherSeenAt) id = m.id;
		return id;
	});

	// Replies
	let replyingTo = $state(null);

	// Pending attachment (preview before send)
	let pendingAttachment = $state(null);

	// Reactions: { [msgId]: { [emoji]: { [userId]: true } } }
	// Seeded from Turso (archived messages) on page load; Firebase onValue merges live reactions on top
	let reactions = $state({ ...(data.initialReactions ?? {}) });

	// Emoji picker
	let pickerMsgId = $state(null);
	let pickerPos = $state({ x: 0, y: 0 });
	let showComposePicker = $state(false);
	// Separate GIFs + Reaction Images picker (own entrypoint to the right).
	let showMediaPicker = $state(false);
	const _anyComposePicker = $derived(showComposePicker || showMediaPicker);
	// True when a compose picker was opened straight from the keyboard. The
	// picker is sized to the keyboard, so in that case the bar is already in
	// its final spot and must NOT play the rise animation — see `.from-kb`.
	// Latched at open time because `keyboardOpen` flips false the moment we
	// blur the compose to dismiss the keyboard.
	let _pickerFromKb = $state(false);
	// Hide the mobile BottomNav while either picker is docked (they share the
	// bottom area). Cross-component signal via a body class.
	$effect(() => {
		if (typeof document === 'undefined') return;
		// `_fxDocked` too: the highlight menu docks in the same strip, so the
		// nav has to clear out for it as well — and .chat-wrap reclaims the
		// 56px the nav was reserving (see chat/+layout.svelte).
		document.body.classList.toggle('expr-picker-open', _anyComposePicker || _fxDocked);
		return () => document.body.classList.remove('expr-picker-open');
	});

	// ── Picker dismissal + scroll anchoring ──────────────────────────
	// Closing routes through these so every exit path (outside tap, chat
	// scroll, swipe-down on the sheet, the picker's own ✕) clears the same
	// state — the rendered-HTML cache has to be dropped because emote
	// tokens render differently once the compose loses its faux caret.
	function closeComposePicker() { showComposePicker = false; _clearHtmlCache(); }
	function closeMediaPicker() { showMediaPicker = false; }

	// Dismissal rides the backdrop (see the markup): a tap closes the picker,
	// and so does the first scroll gesture aimed at the chat behind it — after
	// which the list is live again and scrolls normally. The backdrop has to
	// exist. Besides catching the tap it keeps the picker MODAL, and the whole
	// compose stack's z-index ordering assumes messages underneath aren't
	// being hovered or raised.
	//
	// There is deliberately no ResizeObserver holding the list's scroll
	// position any more. It fired on every height change, so it fought
	// native.js (which already adds the keyboard height to scrollTop on
	// keyboardWillShow) and re-ran throughout the keyboard's open animation —
	// two scroll writes per frame, which is what made this feel jumpy. The
	// picker's own open is compensated once, explicitly, below.
	let _prevPickerOpen = false;
	$effect(() => {
		const open = _anyComposePicker;
		const was = _prevPickerOpen;
		_prevPickerOpen = open;
		if (open === was || !listEl) return;
		// Opening straight from the keyboard needs NO compensation: the picker
		// is the keyboard's height, so the space taken at the bottom is the
		// same before and after and the visible region never changed. The list
		// loses --kb-height of scroll content (the spacer, dropped in the same
		// frame) and an equal slice of viewport, which cancel exactly. Writing
		// scrollTop here would be inventing a jump, then having the spacer's
		// removal appear to undo it — the double shift.
		if (open && _pickerFromKb) return;
		const el = listEl;
		// One shot, after the layout settles: opening shrinks the list by the
		// sheet's height, so shift by the delta to leave the bottom-most
		// message exactly where it was.
		const before = el.clientHeight;
		requestAnimationFrame(() => {
			const delta = before - el.clientHeight;
			if (delta) el.scrollTop = Math.max(0, el.scrollTop + delta);
		});
	});
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
	// Telegram special-effect opt-in. The toggle only appears when the
	// compose renders jumbo (emoji-only) AND contains an av>0 [tg:] emote;
	// small/inline sends never carry the effect.
	let tgFxOn = $state(false);
	let tgManifestReady = $state(false);
	const tgFxEligible = $derived.by(() => {
		if (!tgManifestReady || jumboInput <= 0) return false;
		for (const m of input.matchAll(/\[tg:([0-9a-f-]+)\]/gi)) {
			if ((tgEntry(m[1].toLowerCase())?.av || 0) > 0) return true;
		}
		return false;
	});
	let sizeSliderActive = $state(false);
	let thumbY = $state(0);
	let panelFixedLeft = $state(0);
	let panelFixedRight = $state(0);
	let panelFixedTop = $state(8);
	let panelHeight = $state(200);
	let downRange = $state(80);
	let sendWrapEl = $state(null);
	let _szArmed = false, _szTimer = null, _szInitY = 0, _panelTopY = 8, _szUpPx = 62;
	let _szPendingFont = 1.0;
	let _szPillEl = null;
	let _szRafId = 0;

	const SZ_MIN = 0.55, SZ_MAX = 20.0; // Small → Massive
	const SZ_PILL_H = 36;
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

	// ── Emoji tooltip ─────────────────────────────────────────────────────
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
	// emoji hover-name machinery lives in $lib/emoji-tip.js (shared with threads)


	let revealedInvisible = $state(new Set());
	function revealInvisible(id) { revealedInvisible = new Set([...revealedInvisible, id]); }
	let replayCounts = $state({});
	function replayEffect(id) { replayCounts = { ...replayCounts, [id]: (replayCounts[id] ?? 0) + 1 }; }
	let slamShockSet = $state(new Set());
	const _seenSlams = new Set();

	let showTextFxBar = $state(false);
	// Mobile: typography sliders hidden behind the "Aa" pill (channel parity).
	let showTypoSliders = $state(false);
	// Opening the typography dropdown dismisses the keyboard — one clean
	// transition before any slider touch (see the channel page).
	function openTypoSliders() {
		showTypoSliders = !showTypoSliders;
		if (showTypoSliders && _isMobileWidth) { try { inputEl?.blur(); } catch {} }
	}
	let _isMobileWidth = $state(false);
	let _aaMq = null, _onAaMq = null;

	// ── Highlight menu: dock it where the keyboard was (mobile) ─────────
	// The menu used to stack ON TOP of the keyboard, inside the compose
	// stack — and keyboard + two toolbars + compose bar is taller than the
	// visible strip on a phone, so the menu ended up off the screen. It now
	// behaves like every other sheet here: the keyboard is dismissed and the
	// menu takes the slot it vacates: `.fx-dock` in the mobile CSS reorders it
	// BELOW the compose bar, so the message you highlighted sits right above
	// it. This is the state behind that.
	//
	// Gated on `_fxBlurred`, not merely on being open: until the keyboard is
	// actually on its way down there is no slot to move into, and reordering
	// early would just throw the compose bar around behind the keys. So the
	// menu stays above the compose for those few hundred milliseconds and drops
	// below it the moment the keyboard leaves.
	const _fxDocked = $derived(showTextFxBar && _isMobileWidth && _fxBlurred);
	// True once the compose has been blurred FOR the dock. From then on there
	// is no live selection: applies work off `_savedCeSel`, and the highlight
	// is painted by us rather than by the browser.
	let _fxBlurred = $state(false);
	let _fxDockTimer = 0;
	let _pointerDown = false;

	// Hand the keyboard's slot to the menu — but only once the selection
	// GESTURE is over. Blurring mid-drag fights iOS's own selection teardown
	// and throws the layout around (the same reason the Aa pill blurs on tap
	// rather than on a slider's pointerdown). selectionchange re-arms this on
	// every handle move; the pointer check covers a finger held still.
	function scheduleFxDock() {
		// Touch only: a narrow desktop window is phone-WIDTH but has no soft
		// keyboard, so there'd be no slot to move into — dismissing its compose
		// would be pure loss. Same test BottomNav uses for the keyboard.
		if (!_isMobileWidth || _fxBlurred) return;
		if (!window.matchMedia?.('(pointer: coarse)')?.matches) return;
		clearTimeout(_fxDockTimer);
		_fxDockTimer = setTimeout(() => {
			if (!showTextFxBar || !_isMobileWidth || _fxBlurred) return;
			if (_pointerDown) { scheduleFxDock(); return; }
			const sel = window.getSelection();
			// Back to typing before we got here — leave the keyboard alone.
			if (document.activeElement === inputEl && (!sel || sel.isCollapsed)) return;
			_fxBlurred = true;
			try { inputEl?.blur(); } catch {}
			// Native shell: the web view is resize:'none' and the keyboard is the
			// plugin's to own — a blur SHOULD dismiss it, but ask outright rather
			// than assume, because the whole layout below depends on it leaving.
			if (isNativeApp()) {
				import('@capacitor/keyboard')
					.then((m) => m.Keyboard?.hide?.()?.catch?.(() => {}))
					.catch(() => {});
			}
			paintSavedSel();
		}, 220);
	}
	// The keyboard is coming back, or the menu is done.
	function undockFxBar() {
		clearTimeout(_fxDockTimer);
		_fxBlurred = false;
		clearSelPaint();
	}
	function onCeFocus() {
		keyboardOpen = true;
		// Tapping into the compose means "I want to type": the keyboard is on
		// its way up and would bury the docked menu, so stand it down. A fresh
		// selection brings it straight back.
		if (_fxBlurred) { showTextFxBar = false; undockFxBar(); }
	}

	// A blurred contenteditable stops painting its selection, so the docked
	// menu would be styling text you can no longer see marked. Paint the saved
	// range ourselves. The Custom Highlight API draws over the live DOM without
	// touching it — no wrapper span for serializeCe to trip over. Browsers
	// without it just show no tint.
	// The saved highlight as a live Range against the compose's current DOM.
	// Shared by the painter and the ⌫ key, which both need to act on the
	// selection after the browser has forgotten it.
	function savedSelRange() {
		if (!inputEl || !_savedCeSel || _savedCeSel.start >= _savedCeSel.end) return null;
		try {
			const sp = findDomPos(inputEl, _savedCeSel.start);
			const ep = findDomPos(inputEl, _savedCeSel.end);
			const r = document.createRange();
			r.setStart(sp.node, sp.offset);
			r.setEnd(ep.node, ep.offset);
			return r;
		} catch { return null; }
	}
	function paintSavedSel() {
		const r = savedSelRange();
		if (!r) { clearSelPaint(); return; }
		revealRange(r);
		if (typeof Highlight === 'undefined' || !CSS?.highlights) return;
		try { CSS.highlights.set('compose-sel', new Highlight(r)); } catch { clearSelPaint(); }
	}
	// Scaling type up pushes the highlighted words out of the compose's scroll
	// window — and with no caret in there, nothing scrolls them back, so you end
	// up dragging a size slider at text you can't see. Follow the highlight.
	function revealRange(r) {
		try {
			const rr = r.getBoundingClientRect();
			if (!rr.height || !inputEl) return;
			const cr = inputEl.getBoundingClientRect();
			if (rr.top < cr.top) inputEl.scrollTop -= (cr.top - rr.top) + 6;
			else if (rr.bottom > cr.bottom) inputEl.scrollTop += (rr.bottom - cr.bottom) + 6;
		} catch {}
	}
	function clearSelPaint() {
		try { CSS.highlights?.delete('compose-sel'); } catch {}
	}
	// Every apply rebuilds the compose DOM, detaching the painted range — the
	// offsets are unchanged, so repaint from them whenever the content moves.
	$effect(() => { void input; if (_fxBlurred) paintSavedSel(); });
	$effect(() => () => clearSelPaint());
	// Pointer bookkeeping for scheduleFxDock (above).
	$effect(() => {
		if (typeof document === 'undefined') return;
		const down = () => { _pointerDown = true; };
		const up = () => { _pointerDown = false; };
		document.addEventListener('pointerdown', down, true);
		document.addEventListener('pointerup', up, true);
		document.addEventListener('pointercancel', up, true);
		return () => {
			document.removeEventListener('pointerdown', down, true);
			document.removeEventListener('pointerup', up, true);
			document.removeEventListener('pointercancel', up, true);
		};
	});

	// Largest type in a message as a multiple of base size — see the channel
	// page for the full rationale (content-visibility + iOS momentum).
	function msgSizeFactor(msg) {
		let f = msg.fontSize ?? 1;
		const c = msg.content;
		if (c && c.includes('\uE150')) {
			const re = /\uE150([0-9.]+)\uE151/g;
			let m;
			while ((m = re.exec(c))) { const v = parseFloat(m[1]) / 100; if (v > f) f = v; }
		}
		return f;
	}
	let allowFxNesting = $state(false);
	let allowFxMultiply = $state(false);
	let fxSplitWords = $state(true);
	let showFormatPanel = $state(false);
	// Mobile: text-formatting icons collapse behind one toggle (see the channel
	// page — the two compose bars are kept identical).
	let showFmtTools = $state(false);
	let showCodePanel = $state(false);
	let ceCodeLangPicker = $state(null);
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
	const { contentHtml, contentHtmlM, clearCache: _clearHtmlCache, linkChipFromToken } = createContentRenderer({ hljs, codeIcons: _ci, getCeMap: getCachedCustomEmojiMap, wrapEmoji: wrapEmojiInText });
	// Reaction chips render via contentHtml, which reads the custom-emote map
	// through a plain getter Svelte can't see. Touch the reactive _ceMap here so a
	// reaction re-renders the instant the map loads — otherwise [ce:…] reactions
	// stay on the :shortcode: fallback until some unrelated re-render refreshes them.
	function reactionHtml(emoji) { void _ceMap; return contentHtml(emoji, false); }

	// Wrap contentHtmlM with mention-pill rendering — splits content at
	// each mention's offset, runs surrounding text through the rich
	// renderer, inlines a `.mention-pill` link at each mention slice.
	const _escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
	function bubbleHtmlM(content, mentions, splitWords) {
		if (!Array.isArray(mentions) || !mentions.length) return contentHtmlM(content, splitWords);
		const segs = segmentMentions(content, mentions);
		let html = '';
		for (const s of segs) {
			if (s.type === 'mention') {
				html += `<a class="mention-pill" href="/app/profile/${encodeURIComponent(s.uid)}">@${_escHtml(s.name)}</a>`;
			} else if (s.text) {
				html += contentHtmlM(s.text, splitWords);
			}
		}
		return html;
	}
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
		const sel = window.getSelection();
		let selStart = 0, selEnd = 0, hasSelection = false;
		if (sel && !sel.isCollapsed && inputEl.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			selStart = cePlainOffset(inputEl, range.startContainer, range.startOffset);
			selEnd = cePlainOffset(inputEl, range.endContainer, range.endOffset);
			hasSelection = selEnd > selStart;
		}
		const currentMarkup = serializeCe(inputEl);
		let before, selected, after;
		if (hasSelection) {
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
					selected += seg.text.slice(oStart, oEnd);
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

	// ── Emoji suggestions (semantic) ─────────────────────────────────────
	let emojiSuggestions = $state([]); // [{ e, cp }]
	let _suggDebounce = null;
	let _semanticPausedUntil = 0; // cooldown: skip embedding after a no-match result

	// ── Custom emoji colon-shortcode autocomplete ─────────────────────────
	let ceSuggestions = $state([]); // [{ shortcode, url }]
	const CE_COLON_RE = /:([a-zA-Z0-9_-]*)$/;

	$effect(() => {
		const raw = input;
		clearTimeout(_suggDebounce);
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

	// Serialize contenteditable DOM → Unicode markup string
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
			if (node.nodeType === Node.ELEMENT_NODE && ((node.tagName === 'IMG' && (node.dataset.ek || node.dataset.ce || node.dataset.tg)) || (node.tagName === 'SPAN' && node.dataset.tg))) {
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
				} else if (node.dataset?.lk || node.classList?.contains('lk-chip')) {
					result += node.dataset?.lk || (node.querySelector?.('.lk-chip-url')?.textContent ?? '');
				} else if (node.dataset?.tg) {
					// Compose-box <img data-tg> AND bubble <span class="tg-emoji" data-tg>
					// both carry the [tg:…]/[tgc:…] token in dataset.tg. The bubble span
					// has no text content (its Lottie SVG is empty to the serializer),
					// so without this case copying an animated emoji out of a bubble
					// yielded an empty string.
					result += node.dataset.tg;
				} else if (node.dataset?.fx) {
					// continuous size → sentinel-encoded value; other fx → PUA char
					let open = '', close = 0;
					for (const fx of node.dataset.fx.split(' ')) {
						if (fx.startsWith('sz-')) { open += SZ_OPEN + fx.slice(3) + SZ_VEND; close++; }
						else if (FX_TO_CHAR[fx]) { open += FX_TO_CHAR[fx]; close++; }
					}
					result += open + serializeCe(node) + FX_CLOSE_CHAR.repeat(close);
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
			// flip mirrors the coordinate space — atomic so the caret can't
			// enter (where arrows/selection reverse). scaleX(-1) goes on an
			// inner wrapper so this atomic box keeps a normal hit-box (else
			// clicking left of a flipped emote lands the caret on its right).
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

	// Unicode markup → DOM nodes (nested spans — one per effect for composable CSS animations)
	// Unicode markup → DOM nodes, with EK/CE token support and correct FX wrapping on EK/CE images
	// Tiny syntax highlight wrapper around the module-scope hljs. Used by
	// the code-block builders below (and the file viewer overlay).
	// Previously lived here as `highlightCode`; was dropped during the
	// message-render refactor (commit c70ee12) without updating these
	// callers, which broke "format as code block" with a ReferenceError.
	function highlightCode(code, lang) {
		if (!code) return '';
		try {
			if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
			return hljs.highlightAuto(code).value;
		} catch {
			return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
	}
	let _ceCodeRehighlightTimer = null;
	function rehighlightCodeBlock(pre, lang) {
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
		const LK_RE_CE = /\[lk:([A-Za-z0-9_-]+)\]/g;
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

		function makeLinkChipNode(token) {
			try {
				const mm = /^\[lk:([A-Za-z0-9_-]+)\]$/.exec(token);
				const d = mm ? decodeLinkToken(mm[1]) : null;
				if (!d) return document.createTextNode(token);
				const wrap = document.createElement('span');
				wrap.innerHTML = linkChipFromToken(token);
				const chip = wrap.firstChild;
				if (!chip || chip.nodeType !== Node.ELEMENT_NODE) return document.createTextNode(d.url);
				chip.setAttribute('contenteditable', 'false');
				chip.dataset.lk = token;
				return chip;
			} catch {
				return document.createTextNode(token);
			}
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
				const fx = animFx[i];
				const span = document.createElement('span');
				span.className = `tfx tfx-${fx}`;
				span.dataset.fx = fx;
				// Size/weight/width need an inline style so an inline-sized EMOTE
				// scales in the compose (not just the sent bubble).
				if (fx.startsWith('sz-')) span.style.fontSize = (parseFloat(fx.replace('sz-', '')) / 100 * 0.9).toFixed(2) + 'rem';
				else if (fx.startsWith('wght-')) span.style.fontWeight = fx.replace('wght-', '');
				else if (fx.startsWith('wdth-')) span.style.fontStretch = fx.replace('wdth-', '') + '%';
				// `flip` mirrors the span's coordinate space; make it atomic so
				// the caret can't land inside (where arrows/selection reverse).
				// scaleX(-1) lives on an inner wrapper so the atomic box stays
				// un-mirrored for caret hit-testing (see app.css .tfx-flip-inner).
				if (fx === 'flip') {
					span.setAttribute('contenteditable', 'false');
					const inner = document.createElement('span');
					inner.className = 'tfx-flip-inner';
					inner.appendChild(node); node = inner;
				}
				if (delay) span.style.animationDelay = delay;
				span.appendChild(node); node = span;
			}
			return node;
		}

		function pushText(text, fxStack) {
			if (!text) return;
			if (!fxStack.length) { nodes.push(document.createTextNode(text)); return; }
			// `flip` mirrors each EMOJI grapheme in place; letters keep flow.
			if (fxStack.includes('flip')) {
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
			// `ripple` is per-grapheme. Negative delay → all letters ripple
			// from t=0 at different phases (and any rainbow shows instantly),
			// matching the sent-bubble renderer.
			if (fxStack.includes('ripple')) {
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				gs.forEach((g, i) => {
					if (/^\s+$/.test(g)) nodes.push(document.createTextNode(g));
					else nodes.push(makeFxNode(fxStack, g, `-${((globalWi + i) * 0.08).toFixed(2)}s`));
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
			const hasLk = seg.text.includes('[lk:');
			if (!hasEk && !hasCe && !hasTg && !hasTgc && !hasLk) { pushText(seg.text, seg.fxStack); continue; }
			// Segment contains EK/CE tokens — collect all matches, sort by position, render
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
			if (hasLk) {
				LK_RE_CE.lastIndex = 0;
				let m;
				while ((m = LK_RE_CE.exec(seg.text)) !== null) {
					allMatches.push({ index: m.index, end: LK_RE_CE.lastIndex, type: 'lk', match: m });
				}
			}
			allMatches.sort((a, b) => a.index - b.index);
			let lastIdx = 0;
			for (const item of allMatches) {
				if (item.index > lastIdx) pushText(seg.text.slice(lastIdx, item.index), seg.fxStack);
				if (item.type === 'lk') {
					nodes.push(wrapInFx(makeLinkChipNode(item.match[0]), seg.fxStack, undefined));
				} else if (item.type === 'ek') {
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

	function setCeInput(markup) {
		input = markup;
		if (!inputEl) return;
		inputEl.innerHTML = '';
		if (!markup) return;
		for (const node of ceMarkupToNodes(markup)) inputEl.appendChild(node);
		mountStaticEmotes(inputEl);
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
		if (/^```/.test(text.trim())) return null;
		const plain = text.replace(/[\uE100-\uE1FF]/g, '').replace(/\[ek:[^\]]+\]/g, '').replace(/\[ce:[^\]]+\]/g, '');
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
		if (range.startContainer.nodeType === Node.TEXT_NODE) {
			const txt = range.startContainer.textContent;
			const off = range.startOffset;
			if (txt.slice(0, off).endsWith(query)) {
				range.setStart(range.startContainer, off - query.length);
				range.deleteContents();
			}
		}
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
		if (!input.trim()) {
			messageFontSize = 1.0;
			messageFontWeight = 400;
			messageFontStretch = 100;
			messageEffect = null;
			_savedCeSel = null;
			_lastInlineTypo = {};
		}
		updateCeSuggestions();
		// detectCode sweeps ~15 regexes across the whole message; debounce
		// to 300ms after typing stops (see channel page for rationale).
		clearTimeout(_codeDetectT);
		_codeDetectT = setTimeout(() => { detectedCodeLang = detectCode(input); }, 300);
		onInput();
	}
	let _codeDetectT = null;

	// Plain-text character offset — no PUA chars, matches markupToSegments + findDomPos coordinate space.
	// Use this in applyTextFx so selection bounds align with segment positions.
	function cePlainOffset(el, targetNode, targetOffset) {
		let n = 0, done = false;
		function full(node) {
			if (node.nodeType === Node.TEXT_NODE) { n += node.textContent.length; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node.tagName === 'IMG' && node.dataset.ek) { n += node.dataset.ek.length; return; }
			if (node.tagName === 'IMG' && node.dataset.ce) { n += node.dataset.ce.length; return; }
			if ((node.tagName === 'IMG' || node.tagName === 'SPAN') && node.dataset.tg) { n += node.dataset.tg.length; return; }
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
			if ((node.tagName === 'IMG' || node.tagName === 'SPAN') && node.dataset.tg) { n += node.dataset.tg.length; return; }
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
			if ((node.tagName === 'IMG' || node.tagName === 'SPAN') && node.dataset.tg) { buf += node.dataset.tg; return; }
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
			if ((node.tagName === 'IMG' || node.tagName === 'SPAN') && node.dataset.tg) { buf += node.dataset.tg; return; }
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

	let _savedCeSel = null;
	// Bubble TG emoji are rendered as empty <span class="tg-emoji"> with a
	// Lottie SVG mounted inside; the SVG has pointer-events: none and the
	// span has no text, so browsers don't paint the selection highlight
	// on it natively even though the range mathematically includes it.
	// Highlight every emote ELEMENT (EK/CE images, Telegram + custom emoji
	// spans, flag imgs) whose box intersects the selection — inline-block
	// elements get no native ::selection tint, so we toggle `.emote-sel` and
	// let CSS draw it. Shared by the compose box + message list (plain emoji
	// highlight natively as text).
	function highlightEmotesInSel(container) {
		if (!container) return;
		const els = container.querySelectorAll('.ek-img, .ek-img-ce, .ce-img, .ce-img-ce, .tg-emoji, .tg-emoji-img, .tfx-flip');
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount || !container.contains(sel.getRangeAt(0).commonAncestorContainer)) {
			for (const el of els) el.classList.remove('emote-sel');
			return;
		}
		const range = sel.getRangeAt(0);
		for (const el of els) {
			// Flip wrapper draws the highlight — don't double up on the inner emote.
			const flipWrap = el.closest('.tfx-flip');
			if (flipWrap && flipWrap !== el) { el.classList.remove('emote-sel'); continue; }
			const r = document.createRange();
			r.selectNode(el);
			const hit = range.compareBoundaryPoints(Range.START_TO_END, r) > 0
				&& range.compareBoundaryPoints(Range.END_TO_START, r) < 0;
			el.classList.toggle('emote-sel', hit);
		}
	}
	function onMsgListSelectionChange() {
		highlightEmotesInSel(listEl);
	}

	// Whether the current compose selection is fully flipped (drives the
	// Flip checkbox's checked state).
	let selHasFlip = $state(false);
	// Whether the selection contains an emote — the Flip toggle only shows then.
	let selHasEmote = $state(false);
	function computeSelHasFlip() {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl || !inputEl.contains(sel.anchorNode)) { selHasFlip = false; return; }
		const range = sel.getRangeAt(0);
		const a = cePlainOffset(inputEl, range.startContainer, range.startOffset);
		const b = cePlainOffset(inputEl, range.endContainer, range.endOffset);
		if (a >= b) { selHasFlip = false; return; }
		let p = 0, any = false, all = true;
		for (const seg of markupToSegments(serializeCe(inputEl))) {
			const e = p + seg.text.length;
			if (e > a && p < b) { any = true; if (!seg.fxStack.includes('flip')) { all = false; break; } }
			p = e;
		}
		selHasFlip = any && all;
	}

	function onCeSelect() {
		// Same coalescing + compose-scope guard as the channel page:
		// selectionchange fires document-wide on every caret move, and
		// computeSelHasFlip serialises the whole compose each time.
		if (_selRaf) return;
		_selRaf = requestAnimationFrame(() => {
			_selRaf = 0;
			const _sel = window.getSelection();
			if (_sel && inputEl && _sel.anchorNode && inputEl.contains(_sel.anchorNode)) computeSelHasFlip();
			else selHasFlip = false;
			onCeSelectNow();
		});
	}
	let _selRaf = 0;
	function onCeSelectNow() {
		// Docked: the compose was blurred ON PURPOSE, so there is no live
		// selection. Everything below would read that as "nothing selected"
		// and clear the emote highlights + the Flip toggle out from under the
		// open menu — bail until a real selection comes back.
		if (_fxBlurred) {
			const s = window.getSelection();
			if (!s || s.isCollapsed || !inputEl?.contains(s.anchorNode)) return;
			undockFxBar();
		}
		const sel = window.getSelection();
		// Show the bar on non-collapsed selection in the compose. Don't
		// auto-HIDE when the selection collapses — users want the menu
		// to persist until ✕ is pressed (tapping a slider/button can
		// briefly clear the selection, which used to dismiss the bar
		// mid-edit).
		if (sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode)) {
			showTextFxBar = true;
			scheduleFxDock();   // mobile: give the menu the keyboard's slot
		}
		if (sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			_savedCeSel = {
				start: cePlainOffset(inputEl, range.startContainer, range.startOffset),
				end: cePlainOffset(inputEl, range.endContainer, range.endOffset)
			};
		}
		// Highlight every selected emote element (EK/CE images, Telegram +
		// custom emoji spans, flags) — same helper the message list uses.
		highlightEmotesInSel(inputEl);
		// Flip toggle is for emotes AND emoji — show when the selection has
		// either (an emote element highlighted, or an emoji in the text).
		selHasEmote = !!inputEl?.querySelector('.emote-sel')
			|| /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(window.getSelection()?.toString() || '');
	}

	// Clicking a ce=false emote SPAN (TG/custom) doesn't reliably place the
	// caret before/after it like a replaced <img> (EK/CE) — at a line start you
	// couldn't get the caret to its LEFT. Resolve it from which half was clicked.
	let _ceDownX = 0, _ceDownY = 0;
	// Put the caret just LEFT of an atomic emote. Line breaks are a "\n" in a
	// text node (not a <br>); a parent-level "before the element" boundary
	// renders on the line ABOVE. Land at the END of the preceding text node —
	// after the "\n", on the emote's own line. Shared by click + ArrowLeft.
	function setCaretBeforeUnit(unit) {
		if (!unit) return;
		const range = document.createRange();
		// Skip + clean up empty text nodes left by prior edits — the usual cause
		// of "works at first, breaks after manipulation".
		let prev = unit.previousSibling;
		while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent.length === 0) {
			const dead = prev; prev = prev.previousSibling; dead.remove();
		}
		if (prev && prev.nodeType === Node.TEXT_NODE) {
			// Land at the end of the preceding text (after any "\n") — the logical
			// spot left of the emote. Backspace from here still deletes the "\n".
			// (Dropped the zero-width anchor that used to fix the caret painting —
			// it interfered with Enter/Backspace and left stray characters.)
			range.setStart(prev, prev.textContent.length);
		} else {
			range.setStartBefore(unit);
		}
		range.collapse(true);
		const sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}
	function placeCaretFromEmoteClick(e) {
		if (!inputEl) return false;
		// Only TG/custom emote SPANS need this; EK/CE <img> work natively.
		let unit = e.target?.closest?.('.tg-emoji, .tg-sel-base, .tg-emoji-img');
		if (!unit || !inputEl.contains(unit)) return false;
		unit = unit.closest('.tg-emoji') || unit;
		const flip = unit.closest('.tfx-flip');
		if (flip) unit = flip;
		const rect = unit.getBoundingClientRect();
		if (!rect.width) return false;
		const before = e.clientX < rect.left + rect.width / 2;
		if (before) {
			setCaretBeforeUnit(unit);
		} else {
			const range = document.createRange();
			range.setStartAfter(unit);
			range.collapse(true);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
		return true;
	}

	function applyTextFx(name) {
		const sel = window.getSelection();
		// A live selection is the normal case. With the mobile menu docked the
		// keyboard is down and there is none, so fall back to the offsets saved
		// when the highlight was made — otherwise every button in the docked
		// menu is a no-op.
		const _live = !!(sel && !sel.isCollapsed && inputEl && inputEl.contains(sel.anchorNode));
		if (!_live && !(inputEl && _savedCeSel)) return;
		undoStack = [...undoStack.slice(-99), input];
		redoStack = [];
		const range = _live ? sel.getRangeAt(0) : null;
		const selStart = _live ? cePlainOffset(inputEl, range.startContainer, range.startOffset) : _savedCeSel.start;
		const selEnd = _live ? cePlainOffset(inputEl, range.endContainer, range.endOffset) : _savedCeSel.end;
		if (selStart >= selEnd) return;

		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);

		const isColorFx = name.startsWith('color-') || name === 'rainbow';
		// `flip` is a stackable static-transform format — coexists with
		// colour/weight AND animations (shake etc.), never replaced by them.
		const isFormatFx = name === 'bold' || name === 'italic' || name === 'underline' || name === 'strike' || name === 'flip' || isColorFx;
		const isFmtFx = (fx) => fx === 'bold' || fx === 'italic' || fx === 'underline' || fx === 'strike' || fx === 'flip' || fx === 'rainbow' || fx.startsWith('color-') || fx.startsWith('wdth-') || fx.startsWith('wght-') || fx.startsWith('sz-');

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
		// Build the new nodes BEFORE clearing — if the renderer ever throws,
		// the compose keeps its content instead of being wiped mid-rebuild.
		const newNodes = ceMarkupToNodes(newMarkup);
		inputEl.innerHTML = '';
		for (const node of newNodes) inputEl.appendChild(node);
		mountStaticEmotes(inputEl);

		// Restore selection over the same plain-text range so the bar stays visible
		const startPos = findDomPos(inputEl, selStart);
		const endPos = findDomPos(inputEl, selEnd);
		const newRange = document.createRange();
		newRange.setStart(startPos.node, startPos.offset);
		newRange.setEnd(endPos.node, endPos.offset);
		// Docked: re-selecting would re-focus the compose and bring the keyboard
		// back up over the menu. The offsets haven't moved (only the markup
		// around them), so keep working off the saved ones and repaint instead.
		if (_live) {
			sel.removeAllRanges();
			sel.addRange(newRange);
		}

		input = newMarkup;
		if (_live) inputEl.focus();
		else paintSavedSel();
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
		mountStaticEmotes(inputEl);
		try {
			const startPos = findDomPos(inputEl, selStart);
			const endPos = findDomPos(inputEl, selEnd);
			const newRange = document.createRange();
			newRange.setStart(startPos.node, startPos.offset);
			newRange.setEnd(endPos.node, endPos.offset);
			const sel = window.getSelection();
			// See applyTextFx: while docked, re-selecting summons the keyboard.
			if (!_fxBlurred) { sel.removeAllRanges(); sel.addRange(newRange); }
			showTextFxBar = true;
		} catch {}
		input = newMarkup;
	}
	function applyInlineWidth(val) { applyInlineTypo(val, WDTH_STEPS, 100, WDTH_FX_MAP, 'wdth-'); }
	function applyInlineWeight(val) { applyInlineTypo(val, WGHT_STEPS, 400, WGHT_FX_MAP, 'wght-'); }
	function applyInlineSize(val) { applyInlineTypo(val, SZ_STEPS, 1.0, SZ_FX_MAP, 'sz-'); }

	// Smooth size dragging — wrap the selection once in a `.sz-live` span and
	// scale it with a continuous font-size (CSS transition eases it); commit the
	// stepped inline size on release. Falls back to stepped if wrapping fails.
	let _szLive = null;
	function applyLiveSize(val) {
		if (!_savedCeSel || !inputEl) return;
		if (!_szLive) {
			try {
				const sp = findDomPos(inputEl, _savedCeSel.start);
				const ep = findDomPos(inputEl, _savedCeSel.end);
				const r = document.createRange();
				r.setStart(sp.node, sp.offset);
				r.setEnd(ep.node, ep.offset);
				const span = document.createElement('span');
				span.className = 'sz-live';
				span.appendChild(r.extractContents());
				// Strip existing inline sizes inside so re-sizing replaces them.
				for (const old of span.querySelectorAll('[data-fx^="sz-"], .sz-live')) {
					while (old.firstChild) old.parentNode.insertBefore(old.firstChild, old);
					old.remove();
				}
				r.insertNode(span);
				_szLive = span;
				mountStaticEmotes(inputEl);
			} catch { _szLive = null; }
		}
		if (_szLive) _szLive.style.fontSize = val !== 1.0 ? `${(val * 0.9).toFixed(3)}rem` : '';
		else applyInlineSize(val);
		// The live drag never touches `input`, so the repaint effect can't fire.
		if (_fxBlurred) paintSavedSel();
	}
	function _unwrapLive() {
		if (!_szLive) return;
		const parent = _szLive.parentNode;
		while (_szLive.firstChild) parent.insertBefore(_szLive.firstChild, _szLive);
		parent.removeChild(_szLive);
		_szLive = null;
	}
	function commitLiveSize(val) {
		if (!_szLive) return;
		if (val !== 1.0) {
			const N = Math.round(val * 100);
			_szLive.className = `tfx tfx-sz-${N}`;
			_szLive.dataset.fx = `sz-${N}`;
			_szLive.style.fontSize = `${(N / 100 * 0.9).toFixed(3)}rem`;
			_szLive = null;
		} else {
			_unwrapLive();
		}
		input = serializeCe(inputEl);
		detectedCodeLang = detectCode(input);
	}

	function onCeCopy(e) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl) return;
		const range = sel.getRangeAt(0);
		if (!inputEl.contains(range.commonAncestorContainer)) return;
		// Lone emote selects the base <img> inside the .tg-emoji span — expand to
		// the span so the data-tg token isn't lost.
		let cloneRange = range;
		const _ancEl = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
			? range.commonAncestorContainer.parentElement
			: range.commonAncestorContainer;
		const _emoteAnc = _ancEl?.closest?.('.tg-emoji');
		if (_emoteAnc && inputEl.contains(_emoteAnc)) {
			cloneRange = document.createRange();
			cloneRange.selectNode(_emoteAnc);
		}
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(cloneRange.cloneContents());

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
		// Include the whole-message size/weight/width prefix in the markup too —
		// onCePaste reads x-eating-markup first, so "sent large" pastes back large.
		e.clipboardData.setData('text/x-eating-markup', fontPrefix + rawMarkup);
	}

	function matchPastedImage(clipboardData) {
		const html = clipboardData.getData('text/html');
		if (!html) return null;
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const img = doc.querySelector('img');
		if (!img) return null;
		if (img.dataset?.ce) return { type: 'ce', token: img.dataset.ce };
		if (img.dataset?.ek) return { type: 'ek', token: img.dataset.ek };
		if (img.dataset?.tg) return { type: 'tg', token: img.dataset.tg };
		const src = img.getAttribute('src');
		if (src) {
			const ceMap = getCachedCustomEmojiMap();
			for (const [sc, d] of Object.entries(ceMap)) {
				if (d.url === src) return { type: 'ce', token: `[ce:${sc}]` };
			}
			if (src.includes('/reaction-images/')) {
				return { type: 'reaction', url: src, name: img.alt || 'reaction' };
			}
		}
		return null;
	}

	function onCePaste(e) {
		e.preventDefault();
		const internalMarkup = e.clipboardData.getData('text/x-eating-markup');
		const plainText = e.clipboardData.getData('text/plain');
		const hasMarkupTokens = internalMarkup || (plainText && (/\[ce:|^\[sz:|^\[wght:|^\[wdth:|\[ek:|\[tg:|\[tgc:|\[bold\]|\[italic\]/i.test(plainText)));
		const items = Array.from(e.clipboardData?.items ?? []);
		const fileItem = items.find(i => i.kind === 'file' && (i.type.startsWith('image/') || i.type.startsWith('video/')));
		if (fileItem && !hasMarkupTokens) {
			const match = matchPastedImage(e.clipboardData);
			if (match) {
				if (match.type === 'ce' || match.type === 'ek' || match.type === 'tg') {
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
					if (inputEl) mountStaticEmotes(inputEl);
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
				fd.append('contextType', 'dm');
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
		const rawMarkup = e.clipboardData.getData('text/x-eating-markup');
		let pastedText = rawMarkup || e.clipboardData.getData('text/plain');
		if (!pastedText || !inputEl) return;

		// A leading size/weight/width prefix becomes INLINE formatting wrapping the
		// pasted content (the editable kind the highlight slider changes), NOT a
		// whole-message size. Snap to the nearest inline step.
		{
			let openFx = '', closeN = 0;
			const nearestFx = (val, steps, dflt, map) => {
				const step = steps.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a);
				return step !== dflt ? (map[step] ?? null) : null;
			};
			const addFx = (fx) => { if (fx && FX_TO_CHAR[fx]) { openFx += FX_TO_CHAR[fx]; closeN++; } };
			const szM = pastedText.match(/^\[sz:([\d.]+)\]/);
			if (szM) { addFx(nearestFx(parseFloat(szM[1]), SZ_STEPS, 1.0, SZ_FX_MAP)); pastedText = pastedText.slice(szM[0].length); }
			const wghtM = pastedText.match(/^\[wght:(\d+)\]/);
			if (wghtM) { addFx(nearestFx(parseInt(wghtM[1]), WGHT_STEPS, 400, WGHT_FX_MAP)); pastedText = pastedText.slice(wghtM[0].length); }
			const wdthM = pastedText.match(/^\[wdth:(\d+)\]/);
			if (wdthM) { addFx(nearestFx(parseInt(wdthM[1]), WDTH_STEPS, 100, WDTH_FX_MAP)); pastedText = pastedText.slice(wdthM[0].length); }
			if (!pastedText) return;
			if (closeN) pastedText = openFx + pastedText + FX_CLOSE_CHAR.repeat(closeN);
		}

		// When pasted text contains any image-token (EK/CE/TG/TGC), use direct DOM
		// insertion so markup-level cursor arithmetic doesn't try to slice through
		// an inline <img>. Telegram tokens were previously falling through to the
		// markup path and getting mangled — same fast-path now handles them so a
		// copied TG sticker round-trips back into the compose box intact.
		if (pastedText.indexOf('[ek:') !== -1 || pastedText.indexOf('[ce:') !== -1
			|| pastedText.indexOf('[tg:') !== -1 || pastedText.indexOf('[tgc:') !== -1) {
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
			// Pasted TG/TGC tokens are empty <span>s until a player is mounted.
			if (inputEl) mountStaticEmotes(inputEl);
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
		mountStaticEmotes(inputEl);

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

		// A lone/jumbo emote selects the (replaced) base <img> INSIDE the
		// .tg-emoji span, so cloneContents would lose the data-tg token. Expand
		// the range to the whole span when the selection sits within one emote.
		let cloneRange = range;
		const _ancEl = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
			? range.commonAncestorContainer.parentElement
			: range.commonAncestorContainer;
		const _emoteAnc = _ancEl?.closest?.('.tg-emoji');
		if (_emoteAnc && listEl.contains(_emoteAnc)) {
			cloneRange = document.createRange();
			cloneRange.selectNode(_emoteAnc);
		}

		const tempDiv = document.createElement('div');
		tempDiv.appendChild(cloneRange.cloneContents());
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
			// High-fidelity channel so animated/custom emotes copied from a
			// DM bubble paste exactly into any FormattedInput in the app
			// (onCePaste reads text/x-eating-markup first). text/plain is
			// the readable fallback for external apps / plain inputs. Prefix
			// carries the whole-message size/weight/width so "sent large" pastes
			// back large.
			e.clipboardData.setData('text/x-eating-markup', fontPrefix + markup);
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
				// Center the slider on the touch point — reaches HALF px up
				// (smaller) and HALF px down (bigger), clamped above the keyboard
				// (resize:'none' overlays it) and the top margin.
				const kbH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb-height')) || 0;
				const bottomY = window.innerHeight - 8 - kbH;
				const HALF = 130;
				_szUpPx = Math.max(20, Math.min(HALF, _szInitY - 8));
				const downPx = Math.max(20, Math.min(HALF, bottomY - _szInitY));
				_panelTopY = _szInitY - _szUpPx;               // viewport Y (drag math)
				// Panel is position:absolute inside .send-wrap so it rides with
				// the input bar (keyboard transform) instead of fighting it.
				panelFixedTop = _panelTopY - rect.top;
				panelFixedLeft = 0;
				panelFixedRight = 0;
				panelHeight = _szUpPx + downPx;
				downRange = downPx;
			}
			_szPendingFont = 1.0;
			messageFontSize = 1.0;
			// Applies INLINE size to the WHOLE message — same mechanism as the
			// highlight slider on a selection. "Select" all the text so the commit
			// on release targets everything.
			const _szMarkup = inputEl ? serializeCe(inputEl) : '';
			_savedCeSel = { start: 0, end: markupToSegments(_szMarkup).reduce((s, seg) => s + seg.text.length, 0) };
			_lastInlineTypo = {};
			// Contain layout during drag: font-size changes stay local, don't reflow ancestors
			if (inputEl) inputEl.style.contain = 'layout';
		}, 380);
	}

	function onSendQuickUp() {
		if (_szArmed) { onSendUpArmed(); return; }
		clearTimeout(_szTimer);
		if (!sending && !uploading && (input.trim() || pendingAttachment)) send();
	}

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
			// Live, continuous, value-for-value scale of the whole content via the
			// same .sz-live wrapper the slider uses. Committed on release.
			applyLiveSize(_szPendingFont);
		});
	}

	function onSendUpArmed() {
		cancelAnimationFrame(_szRafId);
		_szArmed = false;
		sizeSliderActive = false;
		if (inputEl) { inputEl.style.contain = ''; inputEl.style.fontSize = ''; }
		// Bake the exact continuous size into the content (.sz-live wrapper).
		commitLiveSize(_szPendingFont);
		messageFontSize = 1.0;
		_savedCeSel = null;
		window.getSelection()?.removeAllRanges();
	}

	function onSendCancel() {
		cancelAnimationFrame(_szRafId);
		clearTimeout(_szTimer);
		_szArmed = false;
		sizeSliderActive = false;
		if (inputEl) { inputEl.style.contain = ''; inputEl.style.fontSize = ''; }
		_unwrapLive();
		messageFontSize = 1.0;
		_savedCeSel = null;
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
		const canvas = heartsCanvas;
		const ctx = heartsCtx;
		if (!canvas || !ctx) { heartsAnimId = null; return; }

		if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
		if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

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

	// Focus the compose unless the expression picker is open on touch — avoids
	// popping the iOS keyboard while tapping emotes.
	function _focusCompose() {
		if (showComposePicker && window.matchMedia?.('(pointer: coarse)')?.matches) return;
		inputEl?.focus();
	}

	// ⌫ key in the docked picker. The mobile picker keeps the compose
	// unfocused (so the iOS keyboard stays down), which means there's no
	// real caret to delete from — so this deletes the last unit at the end
	// of the compose (where inserts land). When a live, non-collapsed
	// selection IS present (desktop popover), it deletes that instead.
	function composeBackspace() {
		if (!inputEl) { input = Array.from(input).slice(0, -1).join(''); return; }
		const sel = window.getSelection();
		// Docked: the compose is blurred, so there is no live selection to
		// delete — the highlight the dialog is acting on lives in _savedCeSel.
		// Without this, ⌫ next to a full selection would quietly trim the last
		// character instead of deleting what's highlighted.
		const savedRange = _fxBlurred ? savedSelRange() : null;
		if (savedRange) {
			savedRange.deleteContents();
			_savedCeSel = null;
			clearSelPaint();
		} else if (sel && sel.rangeCount && !sel.isCollapsed && inputEl.contains(sel.anchorNode)) {
			sel.getRangeAt(0).deleteContents();
		} else if (!_deleteLastUnit(inputEl)) {
			return; // nothing to delete
		}
		input = serializeCe(inputEl);
		_clearHtmlCache();
	}

	// True if a node is one atomic, non-editable unit (emote / image / EK /
	// CE / flipped-fx box) — deleting it means removing the WHOLE node, never
	// descending into its inner base+overlay children. This is the bit the
	// first cut got wrong: a .tg-emoji span holds an invisible selection base
	// AND an animation overlay, so a deepest-leaf walk only caught a piece.
	function _isAtomicUnit(el) {
		if (el.nodeType !== Node.ELEMENT_NODE) return false;
		if (el.tagName === 'IMG') return true;
		if (el.getAttribute('contenteditable') === 'false') return true;
		const c = el.classList;
		return !!c && (c.contains('tg-emoji') || c.contains('tg-emoji-img')
			|| c.contains('ek-img') || c.contains('ek-img-ce')
			|| c.contains('ce-img') || c.contains('ce-img-ce'));
	}

	// Delete exactly one unit from the END of `container`, recursing into
	// editable fx wrappers (bold/italic/size/…) so a trailing char inside a
	// styled run is trimmed rather than the whole run. Returns false when the
	// container is empty. Works top-down from lastChild so atomic emotes are
	// removed whole regardless of how many inner nodes they wrap.
	function _deleteLastUnit(container) {
		const last = container.lastChild;
		if (!last) return false;
		if (last.nodeType === Node.TEXT_NODE) {
			const arr = Array.from(last.data); // by code point — keeps emoji whole
			arr.pop();
			if (arr.length) last.data = arr.join('');
			else last.remove();
			return true;
		}
		if (last.nodeType === Node.ELEMENT_NODE) {
			if (last.tagName === 'BR') { last.remove(); return true; }
			if (_isAtomicUnit(last)) {
				const prev = last.previousSibling;
				last.remove();
				// Drop the ZWSP line-start anchor that sat in front of it.
				if (prev && prev.nodeType === Node.TEXT_NODE && prev.data === '​') prev.remove();
				return true;
			}
			// Editable wrapper with mixed content — trim inside it, then prune
			// the wrapper if it emptied out.
			const did = _deleteLastUnit(last);
			if (last.childNodes.length === 0) last.remove();
			return did;
		}
		last.remove();
		return true;
	}

	function insertEmoji(emoji) {
		if (!inputEl) { input += emoji; return; }
		_focusCompose();
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

	// A contenteditable=false emote sitting directly after a <br> begins a
	// wrapped line with no caret position to its LEFT — you can't click or
	// arrow in front of it to delete the break and pull it back up a line
	// (worse when flipped, since scaleX(-1) mirrors the hit-box). Drop a
	// zero-width-space text node in as that missing left-anchor. ZWSP is
	// counted identically by serializeCe + cePlainOffset (same convention as
	// the code-block anchors), so fx offsets stay aligned. Idempotent — only
	// fires for an emote unit that directly follows a <br>.
	function anchorLineStartEmotes(el) {
		if (!el) return;
		const SEL = '.ek-img, .ek-img-ce, .ce-img, .ce-img-ce, .tg-emoji, .tg-emoji-img';
		for (const em of el.querySelectorAll(SEL)) {
			let unit = em;
			while (unit.parentNode && unit.parentNode !== el
				&& unit.parentNode.nodeType === Node.ELEMENT_NODE
				&& unit.parentNode.classList?.contains('tfx')) {
				unit = unit.parentNode;
			}
			const prev = unit.previousSibling;
			if (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
				unit.parentNode.insertBefore(document.createTextNode('​'), unit);
			}
		}
	}

	function insertEkToken(token) {
		const m = token.match(/^\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]$/i);
		if (!m) return;
		if (!inputEl) { input += token; return; }
		_focusCompose();
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
		anchorLineStartEmotes(inputEl);
		input = serializeCe(inputEl);
	}


	let firebaseRef, typingRef, reactionsRef, convReadsRef;
	let typingTimer;

	let userScrolledUp = false;

	// Scroll anchoring. Holds whatever the reader is looking at in place when
	// content ABOVE it changes height — an attachment decoding, an emote canvas
	// painting, a reaction row appearing, `content-visibility` un-skipping a row
	// that was standing in at its 60px placeholder, a history prepend. Without
	// it every one of those shoves the timeline and reads as a random jump
	// (Chrome's native anchoring catches some; Safari has none). The module
	// measures actual drift rather than predicting a delta, so it composes with
	// native anchoring instead of double-correcting against it.
	let scrollAnchor = null;
	$effect(() => {
		if (!listEl) return;
		const anchor = createScrollAnchor(listEl);
		scrollAnchor = anchor;
		// Initial placement happens HERE, the moment the list binds — not in
		// onMount, where it sat behind a Firebase get() and let the reader watch
		// the list parked at the top until the network came back. A load always
		// lands at the bottom; there is no saved-position restore any more.
		scrollToBottom();
		return () => { anchor.destroy(); if (scrollAnchor === anchor) scrollAnchor = null; };
	});

	// The list's bottom padding is the input area's measured height, which
	// starts at 0 and lands a frame or two after mount (bind:clientHeight), and
	// moves again whenever the compose grows — multi-line drafts, the reply bar.
	// Padding is not a child, so the anchor cannot see it grow; a pinned reader
	// was left exactly one input-bar above the bottom. Re-pin through it.
	$effect(() => {
		void inputAreaHeight;
		if (!listEl || !scrollAnchor?.pinned) return;
		requestAnimationFrame(() => {
			if (listEl && scrollAnchor?.pinned) listEl.scrollTop = listEl.scrollHeight;
		});
	});

	// Live check, as opposed to the `userScrolledUp` flag, which only updates on
	// scroll events and is therefore stale right after mount and after any
	// programmatic scroll.
	function atBottom() {
		return !listEl || listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= 80;
	}

	function scrollToBottom() {
		// Re-pin to the true bottom across late layout shifts (emotes, fonts,
		// images) so the first paint isn't a few px short of the bottom.
		const go = () => { if (listEl) { listEl.scrollTop = listEl.scrollHeight; userScrolledUp = false; scrollAnchor?.setPinned(true); } };
		tick().then(() => { go(); requestAnimationFrame(go); setTimeout(go, 60); });
	}

	// Called from attachment load. The anchor already holds the reader's place
	// when the media pops into its real size, so all this does is keep someone
	// who was AT the bottom there — and it asks where the scroller actually is
	// rather than trusting `userScrolledUp`, which was stale often enough that a
	// late image load could yank a reader who had already scrolled away.
	function scrollIfNearBottom() {
		if (listEl && atBottom()) listEl.scrollTop = listEl.scrollHeight;
	}

	function onListScroll() {
		if (!listEl) return;
		const dist = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
		userScrolledUp = dist > 80;
		if (emojiTooltip) emojiTooltip = null;
		// 600px of runway, not 200: the fetch gets to land while there's still
		// something to scroll, instead of the reader hitting the top, stopping
		// dead, and then having history appear underneath them.
		if (listEl.scrollTop < 600 && hasMoreHistory && !loadingMore) loadMoreHistory();
	}

	async function loadMoreHistory() {
		if (loadingMore || !hasMoreHistory || !messages.length) return;
		loadingMore = true;
		const oldest = messages[0];
		const before = new Date(oldest.createdAt).toISOString();
		try {
			const r = await fetch(`/api/chat/history?channelId=${encodeURIComponent(data.convId)}&before=${encodeURIComponent(before)}&limit=40`);
			if (!r.ok) throw new Error('Failed');
			const { messages: older, hasMore } = await r.json();
			hasMoreHistory = hasMore;
			if (older.length) {
				const existingIds = new Set(messages.map(m => m.id));
				const newMsgs = older.filter(m => !existingIds.has(m.id));
				messages = [...newMsgs, ...messages];
				// No scrollTop bookkeeping here — the anchor sees the childList
				// mutation and puts the reader's row back. Doing it here too
				// meant compensating twice and undoing half of it a frame later.
			}
		} catch (e) { console.error('Load more failed', e); }
		finally { loadingMore = false; }
	}

	function scrollToMessage(id) {
		const el = listEl?.querySelector(`[data-msg-id="${id}"]`);
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el.classList.add('flash');
		setTimeout(() => el.classList.remove('flash'), 1600);
	}

	// `?msg=ID` deep-links scroll to + highlight the targeted bubble.
	function focusFromUrl() {
		const id = new URL(window.location.href).searchParams.get('msg');
		if (id) tick().then(() => scrollToMessage(id));
	}
	afterNavigate(focusFromUrl);

	// Last real interaction on THIS chat page. Seeded to mount time —
	// navigating here is itself an active action.
	let _lastInputAt = Date.now();
	const ACTIVE_WINDOW_MS = 60_000;

	// True only when the user is genuinely reading right now: the tab is
	// foreground + focused AND they've interacted within the active window.
	// A focused-but-idle tab is exactly the "online but didn't actually read
	// it" false positive, so a real interaction is required too.
	// See memory/project_read_receipts_gating.md.
	function isViewingActively() {
		return typeof document !== 'undefined'
			&& document.visibilityState === 'visible'
			&& document.hasFocus()
			&& (Date.now() - _lastInputAt) < ACTIVE_WINDOW_MS;
	}
	// Set when markRead() was called while NOT actively viewing. We flush the
	// deferred receipt the moment the user is active on the page again.
	let _readPending = false;

	// Any real interaction marks the user active and flushes a deferred
	// receipt — making a receipt mean "active on the page since the message
	// arrived" rather than merely "tab was open".
	function onChatActivity(e) {
		if (e && e.isTrusted === false) return;
		const now = Date.now();
		_lastInputAt = now;
		// Same gating as the channel page: mousemove is at pointer-poll rate,
		// so only look at pending reads when one exists, max 1×/s.
		if (!_readPending || now - _lastFlushTry < 1000) return;
		_lastFlushTry = now;
		flushPendingRead();
	}
	let _lastFlushTry = 0;

	function markRead() {
		if (!isViewingActively()) {
			// Defer: there's unseen activity, but we won't acknowledge it
			// until the user genuinely returns to this page.
			_readPending = true;
			return;
		}
		_readPending = false;
		const uid = data.currentUser.id;
		const now = Date.now();
		set(ref(db, `lastRead/${uid}/${data.convId}`), now);
		set(ref(db, `unreadCounts/${uid}/${data.convId}`), 0);
		// Conversation-scoped index for read receipts — see channel
		// page comment. Catch surfaces rules-violations in DevTools
		// so the "pill never shows" failure mode is debuggable.
		set(ref(db, `convReads/${data.convId}/${uid}`), now).catch((e) => {
			console.warn('[read-receipt] convReads write blocked:', e?.message ?? e);
		});
	}

	// On returning to the tab (foreground + focus), flush any read
	// receipt we deferred while the user was away/idle.
	function flushPendingRead() {
		if (_readPending && isViewingActively()) markRead();
	}

	function clearTyping() {
		clearTimeout(typingTimer);
		remove(ref(db, `typing/${data.convId}/${data.currentUser.id}`));
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
		// the textarea holds READABLE markup ([rainbow]…[/rainbow], [sz:150])
		// — convert back to the PUA wire format or effects die on save
		const content = readableToUnicode(editContent.replace(/​/g, '')).trim();
		if (!content || !msgId) { editingMsgId = null; return; }
		editingMsgId = null;
		messages = messages.map((m) => m.id === msgId ? { ...m, content, edited: true } : m);
		await fetch('/api/chat/edit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, conversationId: data.convId, content })
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
				conversationId: data.convId,
				snapshot: { content: msg.content, authorName: msg.userName, authorId: msg.userId, attachment: msg.attachment ?? null, convName: null }
			})
		}).catch(() => {});
	}

	async function deleteMessage(msg) {
		messages = messages.filter((m) => m.id !== msg.id);
		await fetch('/api/chat/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msg.id, conversationId: data.convId, authorId: msg.userId })
		}).catch(() => {});
	}

	// ── Blocking (App Store Guideline 1.2) ──────────────────────────────
	// Same contract as the channel page: the block list is a view-filter.
	// In a DM the whole conversation is with one person, so blocking them
	// also swaps in a notice with an inline Unblock.
	let blockedIds = $state(new Set());
	const visibleMessages = $derived(blockedIds.size ? messages.filter((m) => !blockedIds.has(m.userId)) : messages);
	const otherBlocked = $derived(blockedIds.has(otherUser.id));
	async function loadBlockedIds() {
		try {
			const r = await fetch('/api/moderation/block');
			if (r.ok) {
				const j = await r.json();
				blockedIds = new Set(j.blocked.map((b) => b.userId));
			}
		} catch { /* unfiltered view until it loads */ }
	}
	async function blockUser(msg) {
		if (!confirm(`Block ${msg.userName}? You'll stop seeing their messages. You can unblock them from Edit profile.`)) return;
		try {
			const r = await fetch('/api/moderation/block', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: msg.userId,
					// The message the block was made from — snapshotted into the
					// moderation queue so the instructor sees what prompted it.
					messageId: msg.id,
					convId,
					content: msg.content ?? ''
				})
			});
			if (!r.ok) throw new Error(String(r.status));
			blockedIds = new Set([...blockedIds, msg.userId]);
		} catch {
			alert('Could not block — check your connection and try again.');
		}
	}
	async function unblockOther() {
		try {
			const r = await fetch('/api/moderation/block', {
				method: 'DELETE', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: otherUser.id })
			});
			if (!r.ok) throw new Error(String(r.status));
			const next = new Set(blockedIds);
			next.delete(otherUser.id);
			blockedIds = next;
		} catch {
			alert('Could not unblock — check your connection and try again.');
		}
	}

	// Content reporting (App Store Guideline 1.2): files the message — content
	// snapshotted server-side — for instructor review in Manage → Moderation.
	async function reportMessage(msg) {
		if (!confirm('Report this message to the instructor?')) return;
		try {
			const res = await fetch('/api/moderation/report', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messageId: msg.id,
					convId: data.convId,
					content: msg.content ?? '',
					authorId: msg.userId,
					authorName: msg.userName
				})
			});
			if (!res.ok) throw new Error(String(res.status));
			alert('Reported. The instructor will review it.');
		} catch {
			alert('Could not send the report — check your connection and try again.');
		}
	}

	async function toggleReaction(msgId, emoji) {
		const uid = data.currentUser.id;
		const alreadyReacted = !!reactions[msgId]?.[emoji]?.[uid];
		haptic(alreadyReacted ? 'selection' : 'light'); // native react tick

		// Optimistic local update so chips appear immediately
		const curMsg = reactions[msgId] ?? {};
		const curEmoji = curMsg[emoji] ?? {};
		const newEmoji = alreadyReacted
			? Object.fromEntries(Object.entries(curEmoji).filter(([k]) => k !== uid))
			: { ...curEmoji, [uid]: true };
		reactions = { ...reactions, [msgId]: { ...curMsg, [emoji]: newEmoji } };

		// The new chip row grows the bubble — the anchor absorbs that, so there is
		// no scrollTop arithmetic to do here any more.

		// Always route through the server API — uses firebase-admin which bypasses security rules
		await fetch('/api/chat/react', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ messageId: msgId, emoji, conversationId: data.convId, type: 'dm' })
		});
	}



	onMount(async () => {
		// Publish the DM partner's name + a link to their profile to
		// the global AppHeader, so clicking the name in the header
		// drops you into their profile view (or, if you're somehow
		// DMing yourself, your own edit page — profileLink handles
		// that branch). The page's local chat-header is gone so this
		// is the only place the partner's name surfaces at the top.
		pageTitle.set(otherUser.name);
		pageTitleHref.set(profileLink(otherUser.id, data.currentUser.id));

		loadBlockedIds();

		// ── Performance monitoring ─────────────────────────────────────────────
		if (typeof PerformanceObserver !== 'undefined') {
			try {
				new PerformanceObserver(list => {
					for (const e of list.getEntries()) {
						console.warn('[perf:longtask]', Math.round(e.duration) + 'ms', e.attribution?.[0]?.name ?? '');
					}
				}).observe({ type: 'longtask', buffered: true });
			} catch {}
		}
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
		_cancelFpsLoop = () => cancelAnimationFrame(_fpsRafId);
		// ──────────────────────────────────────────────────────────────────────

		// Snapshot lastRead BEFORE markRead writes Date.now() over it, so we can
		// distinguish "already seen" messages from "still unread" ones for FX auto-play.
		try {
			const snap = await get(ref(db, `lastRead/${data.currentUser.id}/${data.convId}`));
			_lastReadAtMount = snap.exists() ? Number(snap.val()) || 0 : 0;
		} catch { _lastReadAtMount = 0; }
		markRead();
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
		initSemanticSearch();
		// Load emoji names + custom-emote map together → ONE re-render instead
		// of two racing `[...messages]` passes. Cuts first-paint contention.
		Promise.all([loadEmojiNames(), getCustomEmojiMap()]).then(([names, ce]) => {
			emojiNames = names; _ceMap = ce;
			_clearHtmlCache(); clearJumboCache(); messages = [...messages];
		});
		Promise.all([loadTelegramEmoji(), loadCustomPacks()]).then(() => { tgManifestReady = true; mountTgStickers(); });
		document.addEventListener('selectionchange', onCeSelect);
		document.addEventListener('selectionchange', onMsgListSelectionChange);
		// Aa-toggle gate — same 640px breakpoint the CSS uses. Component-scope
		// lets, not consts: the teardown lives in a different scope, and as
		// onMount consts its reference was a silent ReferenceError (leaked
		// listener per visit).
		_aaMq = window.matchMedia('(max-width: 640px)');
		_isMobileWidth = _aaMq.matches;
		_onAaMq = (e) => { _isMobileWidth = e.matches; if (!e.matches) showTypoSliders = false; };
		_aaMq.addEventListener('change', _onAaMq);
		document.addEventListener('visibilitychange', flushPendingRead);
		window.addEventListener('focus', flushPendingRead);
		_lastInputAt = Date.now();
		for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']) {
			document.addEventListener(ev, onChatActivity, { passive: true });
		}
		if (heartsCanvas) {
			heartsCanvas.width = window.innerWidth;
			heartsCanvas.height = window.innerHeight;
			heartsCtx = heartsCanvas.getContext('2d');
			if (messages.some(m => m.fx === 'hearts')) startHeartsLoop();
		}

		firebaseRef = query(ref(db, `dms/${data.convId}/messages`), limitToLast(50));
		onChildAdded(firebaseRef, (snap) => {
			const msg = normaliseMessage(snap.key, snap.val(), userMap);
			if (messages.find((m) => m.id === msg.id)) return;
			// Replace a matching pending optimistic rather than appending (prevents duplicate flash)
			const optIdx = messages.findIndex(m => m.pending && m.userId === msg.userId && m.content === msg.content);
			if (optIdx !== -1) {
				messages = [...messages.slice(0, optIdx), msg, ...messages.slice(optIdx + 1)];
			} else {
				// Only follow the new message if the reader was already at the
				// bottom. Someone else sending while you're reading back through
				// history used to haul you down to the latest bubble.
				const follow = atBottom();
				messages = [...messages, msg];
				if (follow) scrollToBottom();
				markRead();
			}
		});

		// Mirror server-side deletes live so both participants drop the message,
		// not just the one who deleted it (they saw it vanish optimistically).
		onChildRemoved(firebaseRef, (snap) => {
			messages = messages.filter((m) => m.id !== snap.key);
		});

		typingRef = ref(db, `typing/${data.convId}`);
		onValue(typingRef, (snap) => {
			if (!snap.exists()) { typingUsers = []; return; }
			const now = Date.now();
			typingUsers = Object.entries(snap.val())
				.filter(([uid, v]) => uid !== data.currentUser.id && (now - (v.ts ?? 0)) < 5000)
				.map(([, v]) => v.name);
		});

		// Read-receipt subscription — see channel page comment.
		convReadsRef = ref(db, `convReads/${data.convId}`);
		onValue(convReadsRef, (snap) => {
			convReads = snap.exists() ? snap.val() : {};
		});
		// Backfill the other participant's read state from the legacy
		// per-user `lastRead/{uid}/{convId}` path. Anyone who read this
		// conversation before the dual-write to `convReads/…` shipped
		// has their timestamp there but not yet in the new index, so
		// without this the "Seen" pill stays hidden until they happen
		// to re-open the chat. One-shot get; live updates come from
		// the convReads listener once the other side writes.
		get(ref(db, `lastRead/${otherUser.id}/${data.convId}`)).then((snap) => {
			if (!snap.exists()) return;
			const v = Number(snap.val());
			if (!v) return;
			if (!convReads[otherUser.id] || v > Number(convReads[otherUser.id])) {
				convReads = { ...convReads, [otherUser.id]: v };
			}
		}).catch(() => { /* rules may forbid — pill just stays hidden */ });

		reactionsRef = ref(db, `dms/${data.convId}/reactions`);
		onValue(reactionsRef, (snap) => {
			const fbRaw = snap.exists() ? snap.val() : {};
			// Decode escaped Firebase keys back to raw reaction tokens so rich
			// emote reactions ([tg:…], [tgc:…], [ce:…], [ek:…]) render. Plain
			// emoji keys are unchanged by the round-trip.
			const fbReactions = {};
			for (const [mId, ems] of Object.entries(fbRaw)) {
				const decoded = {};
				for (const [k, users] of Object.entries(ems ?? {})) decoded[decodeReactionKey(k)] = users;
				fbReactions[mId] = decoded;
			}
			const base = data.initialReactions ?? {};
			// Deep merge per message: Turso base → current state (optimistic) → Firebase
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
		anchorLineStartEmotes(inputEl);
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
	// Small inline + reaction emotes render through SpriteSticker (the picker's
	// rasterization engine via the shared `engineMode` store) instead of a live
	// lottie-web SVG, to save performance; only jumbo (1–3 emoji-only) messages
	// keep the live SVG path. Real Map so detached spans can be swept.
	const _tgSprites = new Map();
	function mountSpriteEmote(span) {
		if (_tgSprites.has(span)) return;
		const fs = parseFloat(getComputedStyle(span).fontSize) || 16;
		const size = Math.max(16, Math.round(fs * 1.4)); // .tg-emoji is 1.4em
		// oversample 2: sent emotes rasterise at double density — higher
		// resolution than the picker's cells — so they stay crisp through
		// focus previews, zooms and inline text-size effects.
		let props;
		if (span.dataset.tgCp) props = { cp: span.dataset.tgCp, size, oversample: 2 };
		else if (span.dataset.tgPack && span.dataset.tgId) props = { short: span.dataset.tgPack, id: span.dataset.tgId, size, oversample: 2 };
		else return;
		try { _tgSprites.set(span, mount(SpriteSticker, { target: span, props })); } catch {}
	}
	function sweepSpriteEmotes() {
		for (const [sp, comp] of _tgSprites) {
			if (!sp.isConnected) { try { unmount(comp); } catch {} _tgSprites.delete(sp); }
		}
	}
	// Snapshot of lastRead at page open — anything sent AFTER this is "unseen" for
	// auto-play purposes. Default to now so we don't replay anything if the snapshot
	// hasn't resolved yet (the 5-min freshness check still covers very recent msgs).
	let _lastReadAtMount = Date.now();

	// Compose-box TG / TGC tokens are `<span contenteditable="false">`
	// wrappers (same shape as rendered bubble spans) so the shared
	// mountStaticEmotes() helper can drop a lottie-web SVG player
	// inside them and the emote actually animates while the user is
	// typing. data-tg carries the `[tg:…]` / `[tgc:…]` token;
	// serializeCe + cePlainOffset etc. were extended to accept SPAN
	// with data-tg alongside the IMG shapes used by EK / CE (those
	// remain static rasters).
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
		anchorLineStartEmotes(inputEl);
		input = serializeCe(inputEl);
		onInput();
		_clearHtmlCache();
		if (inputEl) mountStaticEmotes(inputEl);
		_focusCompose();
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
		// Mount into the selectable shell's overlay (hidden <img> base makes the
		// emote a replaced element so it selects/caret like EK), not the span.
		const overlay = ensureSelectableEmoteShell(span);
		overlay.replaceChildren();
		const anim = lottie.loadAnimation({
			container: overlay, renderer: 'svg', loop: !frozen, autoplay: false,
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
		// Drop SpriteSticker emotes whose span left the DOM.
		sweepSpriteEmotes();
		// Scan the message list AND the floating reaction preview so emotes in
		// the lifted message copy mount too.
		const _roots = [listEl, document.querySelector('.react-msg-preview'), ...document.querySelectorAll('.reply-bar')].filter(Boolean);
		for (const _root of _roots)
		for (const span of _root.querySelectorAll('.tg-emoji:not([data-tgm])')) {
			span.dataset.tgm = '1';
			// Flags are a static image at any size — handle before the engine split.
			if (span.dataset.tgCp) {
				const _e = tgEntry(span.dataset.tgCp);
				if (_e?.flag) {
					const img = document.createElement('img');
					img.src = tgFlagUrl(span.dataset.tgCp); img.className = 'tg-emoji-img'; img.alt = _e.e;
					span.appendChild(img);
					continue;
				}
			}
			// Small inline + reaction emotes → rasterization engine via SpriteSticker.
			if (!span.closest('.bubble')?.classList.contains('jumbo-emoji')) {
				mountSpriteEmote(span);
				continue;
			}
			// ── Jumbo (1–3 emoji-only message): keep the live SVG player ──────
			if (span.dataset.tgCp) {
				const cp = span.dataset.tgCp;
				const entry = tgEntry(cp);
				_tgObserver.observe(span);
				if ((entry?.av || 0) > 0) span.classList.add('tg-fx');
				const msgId = span.closest('.message[data-msg-id]')?.dataset.msgId;
				const isJumbo = !!span.closest('.bubble')?.classList.contains('jumbo-emoji');
				if (msgId && isJumbo && (entry?.av || 0) > 0) {
					// Auto-play ONLY when the sender opted in via the compose
					// special-effect toggle (msg.tgFx), and either: sent in the
					// last 5 minutes, OR not yet seen by this user (createdAt >
					// the lastRead value at page open).
					const msg = messages.find((m) => m.id === msgId);
					const FRESH_MS = 5 * 60 * 1000;
					const isFresh = msg && (Date.now() - (msg.createdAt || 0)) < FRESH_MS;
					const isUnseen = msg && (msg.createdAt || 0) > _lastReadAtMount;
					const key = msgId + ':' + cp;
					if (msg?.tgFx && (isFresh || isUnseen) && !_tgPlayedFx.has(key)) {
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
	// Click an animated emoji → overlay a big play. Jumbo emotes always get the
	// dedicated special-effect variant on click (the compose checkbox only gates
	// the on-receipt AUTO-play); small/inline emotes never render the special
	// effect — they get the plain enlarged animation.
	async function playTgInteraction(el) {
		const cp = el.dataset.tgCp;
		const entry = tgEntry(cp);
		if (!entry || entry.flag) return;
		const rect = el.getBoundingClientRect();
		const _inJumbo = !!el.closest('.bubble')?.classList.contains('jumbo-emoji');
		const wantFx = _inJumbo && entry.av > 0;
		const url = wantFx ? tgAnimationUrl(cp, 1 + Math.floor(Math.random() * entry.av)) : tgAnimatedUrl(cp);
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

	// Re-run on messages AND reactions so a freshly-added Telegram / custom
	// emote reaction chip gets its <canvas> mounted immediately.
	$effect(() => { messages; reactions; pickerMsgId; replyingTo; tick().then(mountTgStickers); });

	// While the docked reaction picker is open on mobile, hide the bottom
	// nav (it docks as a full-width sheet over the same strip) — same as the
	// compose picker hides the nav. BottomNav watches html.reaction-picker-open.
	$effect(() => {
		const open = !!pickerMsgId;
		if (typeof document !== 'undefined')
			document.documentElement.classList.toggle('reaction-picker-open', open);
		return () => {
			if (typeof document !== 'undefined')
				document.documentElement.classList.remove('reaction-picker-open');
		};
	});

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
		pageTitle.set(null);
		pageTitleHref.set(null);
		_cancelFpsLoop();
		if (firebaseRef) off(firebaseRef);
		if (typingRef) off(typingRef);
		if (reactionsRef) off(reactionsRef);
		if (convReadsRef) off(convReadsRef);
		clearTyping();
		cancelAttachment();
		if (heartsAnimId) cancelAnimationFrame(heartsAnimId);
		document.removeEventListener('selectionchange', onCeSelect);
		document.removeEventListener('selectionchange', onMsgListSelectionChange);
		if (_aaMq && _onAaMq) _aaMq.removeEventListener('change', _onAaMq);
		if (_selRaf) cancelAnimationFrame(_selRaf);
		document.removeEventListener('visibilitychange', flushPendingRead);
		window.removeEventListener('focus', flushPendingRead);
		for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']) {
			document.removeEventListener(ev, onChatActivity);
		}
		_tgObserver?.disconnect();
		while (_tgHeldSlots > 0) { _tgYieldPlay(); _tgHeldSlots--; }
		for (const comp of _tgSprites.values()) { try { unmount(comp); } catch {} }
		_tgSprites.clear();
	});

	async function send() {
		// Strip zero-width caret anchors (compose-box editing artifacts).
		const content = input.replace(/​/g, '').trim();
		const attSnap = pendingAttachment ? { ...pendingAttachment } : null;
		if (!content && !attSnap) return;
		haptic('light'); // native send tap
		clearTyping();
		const replySnap = replyingTo ? { ...replyingTo } : null;
		const fxSnap = messageEffect;
		const hasInlineSz = /[\uE140-\uE150]/.test(content);
		const hasInlineWght = /[\uE130-\uE135]/.test(content);
		const hasInlineWdth = /[\uE120-\uE124]/.test(content);
		const szSnap = (messageFontSize !== 1.0 && !hasInlineSz) ? messageFontSize : undefined;
		const wghtSnap = (messageFontWeight !== 400 && !hasInlineWght) ? messageFontWeight : undefined;
		const wdthSnap = (messageFontStretch !== 100 && !hasInlineWdth) ? messageFontStretch : undefined;
		const noSplit = !fxSplitWords;
		const wigSnap = (fxSnap === 'wiggly' || fxSnap === 'cursed' || fxSnap === 'scalloped' || fxSnap === 'starburst') && wiggleSize !== 6 ? wiggleSize : undefined;
		const tgFxSnap = tgFxEligible && tgFxOn ? true : undefined;
		const _sendContent = content || (attSnap ? attSnap.filename : '');
		const _mentionRoster = [
			...(data.users ?? []),
			{ id: data.currentUser.id, name: data.currentUser.name }
		];
		const _sendMentions = resolveMentionsFromText(_sendContent, _mentionRoster);
		const optimistic = {
			id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId: data.currentUser.id,
			userName: data.currentUser.name, userRole: data.currentUser.role,
			content: _sendContent, createdAt: Date.now(),
			pending: true, replyTo: replySnap, attachment: attSnap, fx: fxSnap,
			fontSize: szSnap ?? 1, fontWeight: wghtSnap ?? 400, fontStretch: wdthSnap ?? 100, noSplit,
			wiggleSize: wigSnap,
			tgFx: !!tgFxSnap,
			mentions: _sendMentions
		};
		messages = [...messages, optimistic];
		setTimeout(() => { if (messages.some(m => m.id === optimistic.id && m.pending)) slowPendingIds = new Set([...slowPendingIds, optimistic.id]); }, 400);
		setCeInput('');
		undoStack = []; redoStack = [];
		_savedCeSel = null; _lastInlineTypo = {};
		// The message is gone, and so is anything it had highlighted.
		showTextFxBar = false; undockFxBar();
		replyingTo = null;
		resetLinkChips();
		pendingAttachment = null;
		messageEffect = null;
		showEffectPanel = false;
		tgFxOn = false;
		messageFontSize = 1.0;
		messageFontWeight = 400;
		messageFontStretch = 100;
		wiggleSize = 6;
		scrollToBottom();
		if (fxSnap && SCREEN_FXS.some(f => f.name === fxSnap)) setTimeout(() => playScreenEffect(fxSnap), 50);
		fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: _sendContent, to: otherUser.id, reply_to: replySnap, attachment: attSnap, effect: fxSnap || undefined, fontSize: szSnap, fontWeight: wghtSnap, fontStretch: wdthSnap, noSplit: noSplit || undefined, wiggleSize: wigSnap, tgFx: tgFxSnap, mentions: _sendMentions.length ? _sendMentions : undefined })
		}).then(() => {
			if (messages.some((m) => m.id === optimistic.id && m.pending)) {
				messages = messages.filter((m) => m.id !== optimistic.id);
			}
		}).catch(() => {
			messages = messages.filter((m) => m.id !== optimistic.id);
			if (!input.trim() && !pendingAttachment) {
				setCeInput(content);
				replyingTo = replySnap;
				pendingAttachment = attSnap;
				messageEffect = fxSnap;
				messageFontSize = szSnap ?? 1.0;
			}
		});
	}

	async function uploadAttachment(file) {
		if (!file) return;
		uploading = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			fd.append('contextType', 'dm');
			fd.append('contextId', data.convId);
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
	async function handleFileSelect(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = '';
		await uploadAttachment(file);
	}

	// Drag-and-drop upload (see channel page for the depth-counter rationale).
	let dragActive = $state(false);
	let _dragDepth = 0;
	const _dragHasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
	function onDragEnter(e) { if (!_dragHasFiles(e)) return; e.preventDefault(); _dragDepth++; dragActive = true; }
	function onDragOver(e) { if (_dragHasFiles(e)) e.preventDefault(); }
	function onDragLeave(e) { if (!_dragHasFiles(e)) return; _dragDepth = Math.max(0, _dragDepth - 1); if (!_dragDepth) dragActive = false; }
	function onDrop(e) {
		_dragDepth = 0; dragActive = false;
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		e.preventDefault();
		uploadAttachment(file);
	}

	// ── Proactive link chip (see channel page for the rationale) ─────────
	let linkSuggestion = $state(null);   // { url, title }
	let _dismissedLinks = new Set();
	let _linkDebounce = null;
	const _URL_DETECT = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
	function detectComposeUrls(text) {
		_URL_DETECT.lastIndex = 0;
		const urls = []; let m;
		while ((m = _URL_DETECT.exec(text)) !== null) {
			const u = m[0].replace(/[.,;:!?'")\]}>…]+$/, '');
			if (u.length > 4) urls.push(u);
		}
		return urls;
	}
	function chipHost(url) {
		try { return new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
	}
	$effect(() => {
		const text = (input || '').replace(/​/g, '');
		clearTimeout(_linkDebounce);
		_linkDebounce = setTimeout(async () => {
			const urls = detectComposeUrls(text);
			const cand = urls.find((u) => !_dismissedLinks.has(u));
			if (!cand) { linkSuggestion = null; return; }
			if (linkSuggestion?.url === cand) return;
			const href = /^www\./i.test(cand) ? 'https://' + cand : cand;
			let title = '';
			try { const r = await fetch(`/api/link-meta?url=${encodeURIComponent(href)}`); if (r.ok) title = (await r.json())?.title ?? ''; } catch { /* offline */ }
			if (!detectComposeUrls(input || '').includes(cand)) return;
			linkSuggestion = { url: cand, title };
		}, 450);
	});
	function acceptLinkChip() {
		if (!linkSuggestion) return;
		const { url, title } = linkSuggestion;
		const token = encodeLinkToken(url, title);
		if (decodeLinkToken(token.slice(4, -1))?.url === url && (input || '').includes(url)) {
			setCeInput((input || '').split(url).join(token));
		}
		linkSuggestion = null;
		inputEl?.focus();
	}
	function dismissLinkChip() {
		if (linkSuggestion) { _dismissedLinks.add(linkSuggestion.url); linkSuggestion = null; }
	}
	function resetLinkChips() {
		linkSuggestion = null; _dismissedLinks = new Set();
	}


	// A Spotify link in a message, whether it was left as a bare URL or turned
	// into a link chip by the composer — the chip stores the URL base64'd inside
	// a [lk:…] token, so a plain regex over the content would miss exactly the
	// messages someone took the trouble to tidy up.
	// Memoised on the message text. Chat re-renders constantly — a reaction, a
	// presence tick, a new message — and this is called twice per message per
	// render; without the cache that's a regex sweep over the whole scrollback
	// every time anything moves.
	const _spotifyCache = new Map();
	function spotifyIn(content) {
		const text = String(content ?? '');
		if (_spotifyCache.has(text)) return _spotifyCache.get(text);
		let hit = parseSpotifyUrl(text);
		if (!hit) {
			for (const m of text.matchAll(/\[lk:([A-Za-z0-9_-]+)\]/g)) {
				hit = parseSpotifyUrl(decodeLinkToken(m[1])?.url ?? '');
				if (hit) break;
			}
		}
		// Bounded: a long-lived channel would otherwise hold every message text
		// it has ever rendered.
		if (_spotifyCache.size > 500) _spotifyCache.clear();
		_spotifyCache.set(text, hit ?? null);
		return hit ?? null;
	}

	function formatSize(bytes) {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	const VIEWABLE_EXTS = new Set(['js','mjs','cjs','ts','tsx','jsx','py','html','htm','css','json','md','txt','csv','sql','sh','bash','env','yml','yaml','xml','svg','toml','ini','cfg','conf','log','c','h','cpp','hpp','rs','go','java','swift','svelte','vue','rb','php','pl','r','lua','kt','scala','ex','exs','hs','ml','clj','dockerfile','makefile','gitignore','env.example','env.local']);
	const MAX_VIEW_SIZE = 500 * 1024;
	// Word documents get their own (bigger) cap — they're rendered in-app
	// via mammoth (docx → HTML), which is way faster on the mobile PWA than
	// bouncing out to the browser/QuickLook for a preview.
	const MAX_DOC_VIEW_SIZE = 15 * 1024 * 1024; // 15 MB
	const isDocxFile = (filename) => (filename ?? '').split('.').pop()?.toLowerCase() === 'docx';
	function isViewableFile(filename, mimetype, size) {
		if (isDocxFile(filename)) return size <= MAX_DOC_VIEW_SIZE;
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
	let fileViewer = $state(null);
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
		if (isDocxFile(filename)) return viewDocx(url, filename);
		try {
			const r = await fetch(`/api/file-proxy?url=${encodeURIComponent(url)}`);
			if (!r.ok) throw new Error('Failed to fetch');
			const text = await r.text();
			const lang = langFromFilename(filename);
			fileViewer = { filename, url, content: text, lang };
		} catch { fileViewer = { filename, url, content: 'Failed to load file.', lang: 'plaintext' }; }
	}
	// In-app Word reader: fetch the bytes and render locally with
	// docx-preview (dynamically imported so the chunk only loads when a doc
	// is actually opened). Unlike mammoth's semantic HTML, docx-preview
	// reproduces the ORIGINAL formatting — fonts, colors, alignment,
	// spacing, page layout. Overlay shows immediately with a loading state.
	async function viewDocx(url, filename) {
		fileViewer = { filename, url, doc: true, docLoading: true, docBuf: null };
		try {
			const r = await fetch(`/api/file-proxy?url=${encodeURIComponent(url)}`);
			if (!r.ok) throw new Error('Failed to fetch');
			const buf = await r.arrayBuffer();
			// Only commit if this viewer is still the open one (user may have
			// closed it or opened another file while we fetched).
			if (fileViewer?.doc && fileViewer.url === url) {
				fileViewer = { filename, url, doc: true, docLoading: false, docBuf: buf };
			}
		} catch {
			if (fileViewer?.doc && fileViewer.url === url) {
				fileViewer = { filename, url, doc: true, docLoading: false, docBuf: null, docError: true };
			}
		}
	}
	// Svelte action: render the fetched docx bytes into the container with
	// original formatting once the overlay's doc div mounts.
	function renderDocx(node, buf) {
		(async () => {
			try {
				const { renderAsync } = await import('docx-preview');
				await renderAsync(buf, node, undefined, { ignoreLastRenderedPageBreak: true });
			} catch {
				node.innerHTML = '<p style="padding:1.5rem">Failed to render document.</p>';
			}
		})();
	}

	// Any atomic emote element: EK/CE/flag <img> or a Telegram/custom emoji
	// <span> (TG/TGC and flipped emotes render as spans).
	function _isAtomicEmote(el) {
		return el && el.nodeType === Node.ELEMENT_NODE && (
			(el.tagName === 'IMG' && (el.dataset.ek || el.dataset.ce || el.dataset.tg)) ||
			(el.tagName === 'SPAN' && (el.dataset.tg || el.classList?.contains('tg-emoji') ||
				el.classList?.contains('tfx-flip')))
		);
	}
	// Outermost node to jump past for atomic emote navigation, so each emote
	// (incl. one wrapped in fx spans like flip/bold) moves as a single
	// "letter". The dive case now handles TG/custom spans too — previously
	// only EK/CE imgs, so flipped TG emotes broke arrow navigation.
	function getEkOutermost(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		// fx wrappers carry data-fx; the flip transform sits on a transparent
		// .tfx-flip-inner span (no data-fx) — treat both as climbable/divable.
		const _passThru = (n) => n && n.nodeType === Node.ELEMENT_NODE &&
			(n.dataset?.fx || n.classList?.contains('tfx-flip-inner'));
		if (_isAtomicEmote(node)) {
			let outer = node;
			while (outer.parentNode && outer.parentNode !== inputEl &&
			       _passThru(outer.parentNode) &&
			       outer.parentNode.childNodes.length === 1) {
				outer = outer.parentNode;
			}
			return outer;
		}
		if (node.dataset?.fx) {
			let child = node;
			while (child.childNodes.length === 1 && child.firstChild?.nodeType === Node.ELEMENT_NODE) {
				child = child.firstChild;
				if (_isAtomicEmote(child)) return node; // node is the outermost wrapper
				if (!_passThru(child)) break;
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
		// MentionAutocomplete's capture-phase keydown listener
		// preempts navigation keys when its popover is open, so this
		// handler doesn't need to coordinate with it explicitly.
		if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); inputEl?.focus(); send(); return; }

		// Shift+Enter: insert exactly ONE newline. Next to atomic emote spans the
		// browser inserts a DOUBLE "\n" (blank line between emotes), so do it
		// ourselves for a single, predictable line break.
		if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
			const sel = window.getSelection();
			if (sel?.rangeCount && inputEl?.contains(sel.anchorNode)) {
				e.preventDefault();
				if (undoStack.length >= 50) undoStack.shift();
				undoStack.push(input); redoStack.length = 0;
				const range = sel.getRangeAt(0);
				range.deleteContents();
				const nl = document.createTextNode('\n');
				range.insertNode(nl);
				const nr = document.createRange();
				nr.setStartAfter(nl); nr.collapse(true);
				sel.removeAllRanges(); sel.addRange(nr);
				input = serializeCe(inputEl);
				detectedCodeLang = detectCode(input);
				onInput();
				return;
			}
		}

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
				// Backspace right after a link chip → turn it back into the raw URL.
				try {
					const rc = sel.getRangeAt(0);
					const before = rc.startContainer.nodeType === Node.TEXT_NODE
						? (rc.startOffset === 0 ? rc.startContainer.previousSibling : null)
						: (rc.startOffset > 0 ? rc.startContainer.childNodes[rc.startOffset - 1] : null);
					const chipEl = before?.classList?.contains('lk-chip') ? before : before?.querySelector?.('.lk-chip');
					if (chipEl?.dataset?.lk) {
						e.preventDefault();
						if (undoStack.length >= 50) undoStack.shift();
						undoStack.push(input); redoStack.length = 0;
						const mm = /\[lk:([A-Za-z0-9_-]+)\]/.exec(chipEl.dataset.lk);
						const d = mm ? decodeLinkToken(mm[1]) : null;
						const tn = document.createTextNode(d ? d.url : '');
						before.replaceWith(tn);
						const rr = document.createRange();
						rr.setStart(tn, tn.length); rr.collapse(true);
						sel.removeAllRanges(); sel.addRange(rr);
						input = serializeCe(inputEl);
						_dismissedLinks.delete(d?.url ?? '');
						return;
					}
				} catch { /* fall through to normal backspace handling */ }
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
				// Caret just before a line-start emote (right after a "\n", possibly
				// plus our zero-width anchor): one backspace removes the whole line
				// break so the emote pulls up a line.
				const _c = r.startContainer, _o = r.startOffset;
				let _ns = _c.nodeType === Node.TEXT_NODE ? _c.nextSibling : null;
				while (_ns && _ns.nodeType === Node.TEXT_NODE && _ns.textContent.length === 0) _ns = _ns.nextSibling;
				if (_c.nodeType === Node.TEXT_NODE && _o === _c.textContent.length && getEkOutermost(_ns)) {
					const _m = _c.textContent.slice(0, _o).match(/\n​*$/);
					if (_m) {
						e.preventDefault();
						if (undoStack.length >= 50) undoStack.shift();
						undoStack.push(input); redoStack.length = 0;
						const _emote = _ns;
						_c.deleteData(_o - _m[0].length, _m[0].length);
						const nr = document.createRange();
						if (_c.textContent.length > 0) {
							nr.setStart(_c, _c.textContent.length);
						} else {
							_c.remove();
							nr.setStartBefore(_emote);
						}
						nr.collapse(true);
						sel.removeAllRanges(); sel.addRange(nr);
						input = serializeCe(inputEl); detectedCodeLang = detectCode(input); return;
					}
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
					if (goRight) {
						const nr = document.createRange();
						nr.setStartAfter(outer); nr.collapse(true);
						sel.removeAllRanges(); sel.addRange(nr);
					} else {
						// End of preceding text node, not the parent boundary —
						// else a line-start emote sends the caret up a line.
						setCaretBeforeUnit(outer);
					}
					return;
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
						let curOff = 0;
						try { const tr = new Range(); tr.setStart(pre, 0); tr.setEnd(sel.anchorNode, sel.anchorOffset); curOff = tr.cloneContents().textContent.length; } catch { curOff = r.toString().length; }
						const atStart = curOff === 0;
						const isAtEnd = curOff >= fullLen;
						const onLastLine = fullText.indexOf('\n', curOff) === -1;
						const onFirstLine = fullText.lastIndexOf('\n', curOff - 1) === -1;
						if ((e.key === 'ArrowLeft' && atStart) || (e.key === 'ArrowUp' && onFirstLine)) {
							e.preventDefault();
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
		set(ref(db, `typing/${data.convId}/${data.currentUser.id}`), { name: data.currentUser.name, ts: Date.now() });
		clearTimeout(typingTimer);
		typingTimer = setTimeout(clearTyping, 4000);
	}
</script>

<svelte:head><title>DM: {otherUser.name} — eating.computer</title></svelte:head>
<svg width="0" height="0" style="position:absolute">
	<filter id="wavy-border-filter">
		<feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="4" result="turb" seed="2" />
		<feDisplacementMap in="SourceGraphic" in2="turb" scale={wiggleSize} xChannelSelector="R" yChannelSelector="G" />
	</filter>
</svg>
<canvas bind:this={heartsCanvas} class="hearts-canvas"></canvas>

{#if dragActive}
	<div class="drop-overlay" aria-hidden="true">
		<div class="drop-card">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="12 3 12 15"/><polyline points="7 8 12 3 17 8"/></svg>
			<span>Drop to send</span>
		</div>
	</div>
{/if}

<!-- expression hover info (EK sources / CE shortcode / emoji names) — shared component -->
<!-- Wheel anywhere over the page's dead space (the margins beside the
     centered 840px message column, the header, etc.) scrolls the chat —
     the list is the scroll container AND the centered column, so those
     margins live outside it and native wheel scrolling never reaches it.
     Real scrollables/popovers are excluded so their own scrolling wins. -->
<svelte:window onwheel={(e) => {
	if (!listEl) return;
	const t = e.target;
	if (t instanceof Element && t.closest('.message-list, .input-area, .compose-picker-pop, .effect-pop, .format-pop, .code-lang-pop, .file-viewer, .picker-overlay, .react-dock, .emoji-picker-pop, aside, nav')) return;
	listEl.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
}} />

<ExpressionTip root={listEl} />

<!-- chat-header removed — partner name now publishes to the global
     AppHeader via pageTitle. On mobile, BottomNav's Chat button opens
     the chat sidebar, replacing what the local sidebar-toggle did. -->
<!-- padding-bottom mirrors the compose so the last message clears it when the
     native keyboard transform lifts the bar OVER the list. While the highlight
     dialog is docked there is no transform (body.expr-picker-open pins it) and
     the bar is a plain flex sibling, so the padding would only add a screenful
     of dead scroll — and every change to it jolts the scroll anchor, which is
     what made opening the typography sliders flash. -->
<div class="message-list" bind:this={listEl} style:padding-bottom="{_fxDocked ? 0 : inputAreaHeight}px" onscroll={onListScroll} oncopy={onMsgListCopy} ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
	{#if loadingMore}
		<div class="load-more-spinner"><span class="sending-spinner"></span></div>
	{/if}
	{#if messages.length === 0}
		<p class="empty">Start your conversation with {otherUser.name}.</p>
	{/if}
	{#if otherBlocked}
		<div class="blocked-notice">
			<p>You've blocked <strong>{otherUser.name}</strong>. Their messages are hidden.</p>
			<button class="btn-unblock-inline" onclick={unblockOther}>Unblock</button>
		</div>
	{/if}
	{#each visibleMessages as msg, i (msg.id)}
		{@const prev = visibleMessages[i - 1]}
		{@const isFirst = !prev || prev.userId !== msg.userId || msg.createdAt - prev.createdAt > 300000}
		{@const isMine = msg.userId === data.currentUser.id}
		{@const msgReactions = reactions[msg.id] ?? {}}
		{@const hasReactions = Object.values(msgReactions).some(u => Object.keys(u).length > 0)}
		{@const _szf = msgSizeFactor(msg)}
		<!-- Resized-text handling for content-visibility — see the channel
		     page: moderate sizes get a scaled reservation, ≥1.5× rows opt out
		     of content-visibility entirely so their first paint can never
		     shove the timeline. -->
		<div class="message" class:mine={isMine} class:first={isFirst} class:starred={starredIds.has(msg.id)} class:slam-shock={slamShockSet.has(msg.id)} class:has-media={!!msg.attachment} class:big-text={!msg.attachment && _szf >= 1.5} data-msg-id={msg.id}
			style:contain-intrinsic-size={!msg.attachment && _szf > 1.01 && _szf < 1.5 ? `auto ${Math.round(40 + _szf * 30)}px` : null}>
			{#if isFirst}
				{@const isMineMeta = msg.userId === data.currentUser.id}
				{@const senderStatus = presenceStatusCtx?.value?.[msg.userId]}
				<div class="meta">
					<ProfileHover userId={msg.userId}>
						<span class="meta-name-row">
							<span class="meta-avatar-wrap">
								<Avatar
									name={msg.userName}
									uid={msg.userId}
									avatarKind={(isMineMeta ? data.currentUser.avatarKind : otherUser.avatarKind) ?? 'gen'}
									avatarValue={(isMineMeta ? data.currentUser.avatarValue : otherUser.avatarValue) ?? null}
									size={22}
								/>
								{#if senderStatus === 'active' || senderStatus === 'idle'}
									<span class="meta-presence-dot" class:idle={senderStatus === 'idle'}></span>
								{/if}
							</span>
							<span class="name">{msg.userName}</span>
						</span>
					</ProfileHover>
					<span class="time">{formatTime(msg.createdAt)}</span>
				</div>
			{/if}
			<div class="bubble-row">
				{#if msg.attachment}
					{#if msg.attachment.mimetype?.startsWith('image/')}
						{#if msg.attachment.isReaction}
							<div class="bubble bubble-img bubble-reaction-img">
								<img src={msg.attachment.url} alt={msg.attachment.filename} loading="lazy" decoding="async" use:reserveAspect onload={scrollIfNearBottom} onerror={(e) => { const img = e.target; const r = parseInt(img.dataset.retries ?? '0'); if (r < 3) { img.dataset.retries = r + 1; setTimeout(() => { img.src = img.src; }, 1000 * (r + 1)); } else { img.replaceWith(Object.assign(document.createElement('div'), { className: 'img-removed', textContent: 'Image removed' })); } }} />
							</div>
						{:else}
							<a href={msg.attachment.url} target="_blank" rel="noopener noreferrer" class="bubble bubble-img">
								<img src={msg.attachment.url} alt={msg.attachment.filename} loading="lazy" decoding="async" use:reserveAspect onload={scrollIfNearBottom} onerror={(e) => { const img = e.target; const r = parseInt(img.dataset.retries ?? '0'); if (r < 3) { img.dataset.retries = r + 1; setTimeout(() => { img.src = img.src; }, 1000 * (r + 1)); } else { img.replaceWith(Object.assign(document.createElement('div'), { className: 'img-removed', textContent: 'Image removed' })); } }} />
							</a>
						{/if}
					{:else if msg.attachment.mimetype?.startsWith('video/')}
						<div class="bubble bubble-video" >
							<video src={msg.attachment.url} controls preload="metadata" class="att-video" use:reserveAspect onloadedmetadata={scrollIfNearBottom}></video>
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
					<p class="bubble" use:scallopedClip={{ active: msg.fx === 'scalloped', ws: msg.wiggleSize || 6 }} use:starburstClip={{ active: msg.fx === 'starburst', ws: msg.wiggleSize || 6 }} class:fx-rainbow={msg.fx === 'rainbow'} class:fx-rainbow-fill={msg.fx === 'rainbow-fill'} class:fx-hearts={msg.fx === 'hearts'} class:fx-slam={msg.fx === 'slam'} class:fx-loud={msg.fx === 'loud'} class:fx-gentle={msg.fx === 'gentle'} class:fx-invisible={msg.fx === 'invisible'} class:fx-shake={msg.fx === 'shake'} class:fx-bounce={msg.fx === 'bounce'} class:fx-wave={msg.fx === 'wave'} class:fx-jitter={msg.fx === 'jitter'} class:fx-big={msg.fx === 'big'} class:fx-small={msg.fx === 'small'} class:fx-wiggly={msg.fx === 'wiggly'} class:fx-cursed={msg.fx === 'cursed'} class:fx-scalloped={msg.fx === 'scalloped'} class:fx-starburst={msg.fx === 'starburst'} class:revealed={revealedInvisible.has(msg.id)} class:jumbo-emoji={jumboEmojiCountM(msg.content) > 0 && !msg.replyTo} class:has-reply={!!msg.replyTo} style:font-size={bubbleFontSize(msg.content, msg.fontSize)} style:font-weight={msg.fontWeight && msg.fontWeight !== 400 ? msg.fontWeight : null} style:font-stretch={msg.fontStretch && msg.fontStretch !== 100 ? `${msg.fontStretch}%` : null} style:--ws={msg.fx === 'wiggly' && msg.wiggleSize ? `${msg.wiggleSize}px` : msg.fx === 'cursed' && msg.wiggleSize ? msg.wiggleSize : null} data-font-size={msg.fontSize && msg.fontSize !== 1 ? msg.fontSize : null} data-font-weight={msg.fontWeight && msg.fontWeight !== 400 ? msg.fontWeight : null} data-font-stretch={msg.fontStretch && msg.fontStretch !== 100 ? msg.fontStretch : null} onclick={msg.fx === 'invisible' && !revealedInvisible.has(msg.id) ? () => revealInvisible(msg.id) : undefined}>{#if msg.replyTo}<button class="reply-quote" onclick={(e) => { e.stopPropagation(); scrollToMessage(msg.replyTo.id); }}><span class="reply-author">{msg.replyTo.userName}</span><span class="reply-text">{@html contentHtmlM(stripFormatting(msg.replyTo.content))}</span></button>{/if}{@html bubbleHtmlM(msg.content, msg.mentions, !msg.noSplit)}{#if msg.edited}<span class="edited-tag"> (edited)</span>{/if}</p>
					{/key}
				{/if}
				<!-- Spotify links render as a card under the bubble, the way they do
				     in a messaging app. The raw URL stays in the message text: the
				     card is an addition, so a message is never worse off if the
				     metadata can't be fetched. -->
				{#if spotifyIn(msg.content)}
					{@const sp = spotifyIn(msg.content)}
					<SpotifyCard link={sp} mine={isMine} />
				{/if}
				{#if !msg.pending}
				<div class="msg-actions-bar">
					<button class="action-btn" onclick={(e) => { e.stopPropagation(); openPicker(msg.id, e); }} title="Add reaction">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
					</button>
					<button class="action-btn" onclick={(e) => { e.stopPropagation(); startReply(msg); }} title="Reply">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
					</button>
					<button class="action-btn" onclick={(e) => { e.stopPropagation(); threadOpen = msg; }} title="Reply in thread">
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
					{:else}
						<div class="kebab-wrap">
							<button class="action-btn" onclick={(e) => { e.stopPropagation(); kebabOpenId = kebabOpenId === msg.id ? null : msg.id; }} title="More">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
							</button>
							{#if kebabOpenId === msg.id}
								<div class="kebab-menu">
									<button class="kebab-item" onclick={(e) => { e.stopPropagation(); kebabOpenId = null; reportMessage(msg); }}>Report</button>
									{#if msg.userRole !== 'instructor' && msg.userId !== 'gemma'}
										<button class="kebab-item" onclick={(e) => { e.stopPropagation(); kebabOpenId = null; blockUser(msg); }}>Block user</button>
									{/if}
									{#if data.currentUser.role === 'instructor'}
										<button class="kebab-item kebab-item-delete" onclick={(e) => { e.stopPropagation(); kebabOpenId = null; if (confirm('Delete this message?')) deleteMessage(msg); }}>Delete</button>
									{/if}
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
							<!-- Reaction key may be a plain emoji OR an inline
							     token (kitchen / custom emote / Telegram); contentHtml
							     handles both shapes consistently. -->
							<button class="reaction-chip" class:reacted={data.currentUser.id in users} onclick={() => toggleReaction(msg.id, emoji)} onmouseenter={positionReactionTooltip}>
								<span class="reaction-emoji">{@html reactionHtml(emoji)}</span> <span class="reaction-count">{count}</span>
								<div class="reaction-tooltip">
									<span class="reaction-tooltip-emoji">{@html reactionHtml(emoji)}</span>
									<div class="reaction-tooltip-text">
										<span class="reaction-tooltip-names">{Object.keys(users).map(uid => userMap[uid]?.name ?? 'Someone').join(', ')}</span>
										<span class="reaction-tooltip-label">reacted with {emojiNames[emoji] ?? tgReactionName(emoji) ?? emoji}</span>
									</div>
								</div>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
			{#if threadCount(msg.id) > 0}
				<button class="thread-chip" class:unread={threadUnread(msg.id)} onclick={() => (threadOpen = msg)} title="Open thread">
					<span class="msi msi-14">forum</span>
					{threadCount(msg.id)} {threadCount(msg.id) === 1 ? 'reply' : 'replies'}
					{#if threadUnread(msg.id)}<span class="thread-chip-dot" aria-label="Unread replies"></span>{/if}
				</button>
			{/if}
			{#if msg.id === lastSeenMsgId}
				<!-- Other user's read marker — absolutely positioned at the
				     row's bottom-right so it overlays without changing the
				     message height (no reflow / scroll-jank). -->
				<div class="read-row" title="Seen by {otherUser.name}">
					<span class="read-dot">
						<Avatar name={otherUser.name} uid={otherUser.id} avatarKind={otherUser.avatarKind ?? 'gen'} avatarValue={otherUser.avatarValue ?? null} size={16} />
					</span>
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
				{#if !fileViewer.doc}
					<button class="file-viewer-dl" onclick={(e) => { const btn = e.currentTarget; navigator.clipboard.writeText(fileViewer.content).then(() => { btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a6e3a1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`; setTimeout(() => { btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`; }, 1500); }); }}>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
						Copy
					</button>
				{/if}
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
			{#if fileViewer.doc}
				{#if fileViewer.docLoading}
					<div class="file-viewer-doc file-viewer-doc-loading">
						<span class="msi msi-18 spin">progress_activity</span> Loading document…
					</div>
				{:else if fileViewer.docError}
					<div class="file-viewer-doc file-viewer-doc-loading">Failed to load document.</div>
				{:else}
					{#key fileViewer.url}
						<div class="file-viewer-doc" use:renderDocx={fileViewer.docBuf}></div>
					{/key}
				{/if}
			{:else}
				<pre class="file-viewer-code"><code>{@html highlightCode(fileViewer.content, fileViewer.lang)}</code></pre>
			{/if}
		</div>
	</div>
{/if}

{#if pickerMsgId}
	{@const pmsg = messages.find((m) => m.id === pickerMsgId)}
	{@const pmReactions = reactions[pickerMsgId] ?? {}}
	<div class="picker-overlay" onclick={() => pickerMsgId = null} onkeydown={(e) => e.key === 'Escape' && (pickerMsgId = null)} role="presentation"></div>
	<!-- Mobile only (CSS-gated): brightly-lit copy of the focused message
	     floating ~100px above the docked picker over the dimmed screen. -->
	{#if pmsg}
		<div class="react-msg-preview" class:mine={pmsg.userId === data.currentUser.id}>
			<div class="rmp-inner">
				{#if pmsg.content}
					<p class="bubble" class:jumbo-emoji={jumboEmojiCountM(pmsg.content) > 0 && !pmsg.replyTo}
						style:font-size={bubbleFontSize(pmsg.content, pmsg.fontSize)}
						style:font-weight={pmsg.fontWeight && pmsg.fontWeight !== 400 ? pmsg.fontWeight : null}
						style:font-stretch={pmsg.fontStretch && pmsg.fontStretch !== 100 ? `${pmsg.fontStretch}%` : null}
					>{@html bubbleHtmlM(pmsg.content, pmsg.mentions, !pmsg.noSplit)}</p>
				{/if}
				{#if pmsg.attachment}
					<MessageAttachment attachment={pmsg.attachment} mine={pmsg.userId === data.currentUser.id} compact />
				{/if}
				{#if Object.values(pmReactions).some((u) => Object.keys(u).length > 0)}
					<div class="reactions">
						{#each Object.entries(pmReactions) as [emoji, users]}
							{@const count = Object.keys(users).length}
							{#if count > 0}
								<span class="reaction-chip" class:reacted={data.currentUser.id in users}>
									<span class="reaction-emoji">{@html reactionHtml(emoji)}</span> <span class="reaction-count">{count}</span>
								</span>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
	<div class="picker-popover" style:left="{pickerPos.x}px" style:top="{pickerPos.y}px">
		<!-- Reaction popover uses ExpressionPicker in inline mode so
		     the user gets the same 4 tabs the assignment form uses
		     (Emoji / Kitchen / Emotes / Animated), without GIFs or
		     the full-size Reactions gallery. -->
		<ExpressionPicker
			inline
			isInstructor={data.currentUser.role === 'instructor'}
			onClose={() => { pickerMsgId = null; }}
			onSelectEmoji={(emoji) => { toggleReaction(pickerMsgId, emoji); pickerMsgId = null; }}
			onInsertKitchen={(token) => { toggleReaction(pickerMsgId, token); pickerMsgId = null; }}
			onInsertCustomEmoji={(emoji) => { toggleReaction(pickerMsgId, `[ce:${emoji.shortcode}]`); pickerMsgId = null; }}
			onInsertTgEmoji={(it) => {
				const tok = it.custom ? `[tgc:${it.short}:${it.id}]` : `[tg:${it.cp}]`;
				toggleReaction(pickerMsgId, tok); pickerMsgId = null;
			}}
		/>
	</div>
{/if}


{#if threadOpen}
	<!-- keyed: opening a different thread remounts the panel (fresh fetch +
	     subscriptions) instead of mutating a live instance -->
	{#key threadOpen.id}
	<ThreadPanel
		convId={threadConvId}
		parent={threadOpen}
		classId={data.currentClass?.id ?? null}
		currentUser={data.currentUser}
		resolveUser={(uid) => userMap[uid] ?? null}
		chatName={otherUser?.name ?? ''}
		{userMap}
		onClose={() => (threadOpen = null)}
		onCountChange={(pid, total) => { threadCountsExact = { ...threadCountsExact, [pid]: total }; }}
	/>
	{/key}
{/if}

<div class="input-area" class:kb-open={keyboardOpen} class:picker-open={_anyComposePicker} class:fx-dock={_fxDocked} class:from-kb={_anyComposePicker && _pickerFromKb} bind:clientHeight={inputAreaHeight} style:--input-area-h="{inputAreaHeight}px" ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
	{#if replyingTo}
		<div class="reply-bar">
			<div class="reply-bar-content">
				<span class="reply-bar-to">Replying to <strong>{replyingTo.userName}</strong></span>
				<!-- Rendered mini-preview at uniform normal size (size/fx + jumbo
				     stripped); emotes incl. animated Telegram render properly. -->
				<span class="reply-bar-text reply-quote-preview">{@html contentHtmlM(stripFormatting(replyingTo.content))}</span>
			</div>
			<button class="reply-bar-close" onclick={() => replyingTo = null}>×</button>
		</div>
	{/if}
	{#if linkSuggestion}
		<div class="link-suggest">
			<button class="link-suggest-chip" onclick={acceptLinkChip} title="Show this link as a card">
				{#if chipHost(linkSuggestion.url)}
					<img class="link-suggest-fav" src="https://www.google.com/s2/favicons?domain={encodeURIComponent(chipHost(linkSuggestion.url))}&sz=64" alt="" onerror={(e) => e.target.remove()} />
				{/if}
				<span class="link-suggest-body">
					<span class="link-suggest-title">{linkSuggestion.title || chipHost(linkSuggestion.url) || linkSuggestion.url}</span>
					<span class="link-suggest-host">{chipHost(linkSuggestion.url)}</span>
				</span>
				<span class="link-suggest-add">Tap to add card</span>
			</button>
			<button class="reply-bar-close" onclick={dismissLinkChip} title="Dismiss">×</button>
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
		<!-- On mobile this wrapper IS the sheet that takes the keyboard's
		     slot; on desktop it's display:contents and the two bars sit in
		     the compose stack exactly as before. -->
		<div class="text-fx-dock">
		<!-- The rows scroll; the ⌫ key does not. It is a sibling of the
		     scroller, anchored to the dialog's own bottom-right, so it holds
		     the spot the expression keyboard's delete key occupies. -->
		<div class="text-fx-scroll">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="text-typo-bar" onfocusin={() => { showTextFxBar = true; }}>
			<!-- Dismiss sits at the dialog's top-left in BOTH states: the
			     typography bar is the top row whether the sliders are open or
			     shut behind the Aa pill. -->
			<button class="text-fx-close" onmousedown={(e) => { e.preventDefault(); showTextFxBar = false; undockFxBar(); }} title="Close">✕</button>
			<!-- Mobile: typography sliders hide behind an "Aa" pill (see the
			     channel page for rationale). -->
			{#if _isMobileWidth}
				<button class="typo-aa-toggle" class:typo-aa-open={showTypoSliders}
					onmousedown={(e) => { e.preventDefault(); openTypoSliders(); }}
					title="Typography" aria-expanded={showTypoSliders}>
					<span class="typo-aa-glyph">Aa</span>
					<span class="msi msi-16 typo-aa-chevron">expand_more</span>
				</button>
			{/if}
			<div class="aa-sliders" class:aa-sliders-open={!_isMobileWidth || showTypoSliders}>
			<div class="typo-inline-row">
				<span class="typo-inline-label">Size</span>
				<input class="typo-inline-range" type="range" min="0.5" max="7" step="0.05"
					bind:value={messageFontSize}
					oninput={() => { if (_savedCeSel) { applyLiveSize(messageFontSize); showTextFxBar = true; } }}
					onchange={() => { if (_savedCeSel) commitLiveSize(messageFontSize); }} />
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
			</div><!-- /.aa-sliders -->
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
			<!-- Flip: only shown when the selection contains emote(s); mirrors
			     each selected emote individually (scaleX(-1)), never text. -->
			{#if selHasEmote}
				<button class="text-fx-layer-toggle" class:text-fx-layer-on={selHasFlip} onmousedown={(e) => { e.preventDefault(); applyTextFx('flip'); selHasFlip = !selHasFlip; }} title="Mirror each selected emoji / emote">
					<span class="layer-toggle-track"><span class="layer-toggle-knob"></span></span>
					Flip
				</button>
			{/if}
			<span class="text-fx-divider"></span>
			<!-- Mobile: bold/italic/underline/strike and the colours live on the
			     compose toolbar, where they are 30px and easy to miss with a
			     selection already made. Repeat them here as full-size buttons,
			     every one visible — nothing behind a popover. -->
			{#if _isMobileWidth}
				<button class="text-fmt-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('bold'); }} title="Bold"><span class="msi msi-20">format_bold</span></button>
				<button class="text-fmt-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('italic'); }} title="Italic"><span class="msi msi-20">format_italic</span></button>
				<button class="text-fmt-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('underline'); }} title="Underline"><span class="msi msi-20">format_underlined</span></button>
				<button class="text-fmt-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('strike'); }} title="Strikethrough"><span class="msi msi-20">format_strikethrough</span></button>
				{#each TEXT_COLORS as c}
					<button class="text-fmt-swatch" style="background:{c.hex}" onmousedown={(e) => { e.preventDefault(); applyTextFx(c.name); }} title={c.name.replace('color-', '')} aria-label={c.name.replace('color-', '')}></button>
				{/each}
				<button class="text-fmt-swatch text-fmt-rainbow" onmousedown={(e) => { e.preventDefault(); applyTextFx('rainbow'); }} title="Rainbow" aria-label="Rainbow"></button>
				<span class="text-fx-divider"></span>
			{/if}
			{#each TEXT_FXS as fx}
				<button class="text-fx-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx(fx.name); }}>
					{#if fx.name === 'ripple'}
						{@html [...fx.label].map((c, i) => `<span class="tfx tfx-ripple" style="animation-delay:-${(i * 0.08).toFixed(2)}s;display:inline-block">${c}</span>`).join('')}
					{:else}
						<span class="tfx tfx-{fx.name}">{fx.label}</span>
					{/if}
				</button>
			{/each}
		</div>
		</div><!-- /.text-fx-scroll -->
		{#if _fxDocked}
			<button type="button" class="text-fx-del" title="Delete" aria-label="Delete"
				onmousedown={(e) => { e.preventDefault(); composeBackspace(); }}>
				<span class="msi msi-20">backspace</span>
			</button>
		{/if}
		</div><!-- /.text-fx-dock -->
	{/if}
	<div class="input-bar">
		<!-- Attach + emoji moved into .compose-fmt-row below so the
		     compose-wrap can take the full width of the input-bar. -->
		<div class="compose-wrap">
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div
				class="compose-ce"
				role="textbox"
				aria-multiline="true"
				aria-label="Message {otherUser.name}"
			contenteditable={!uploading}
			inputmode={showComposePicker ? 'none' : null}
			bind:this={inputEl}
			oninput={onCeInput}
			onkeydown={onKeydown}
			onmousedown={(e) => { _ceDownX = e.clientX; _ceDownY = e.clientY; }}
			onclick={(e) => {
				const moved = Math.hypot(e.clientX - _ceDownX, e.clientY - _ceDownY) > 4;
				if (!moved && placeCaretFromEmoteClick(e)) { onCeSelect(); return; }
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
			onfocus={onCeFocus}
			onblur={() => { keyboardOpen = false; /* text fx bar stays until ✕ is pressed */ }}
			oncopy={onCeCopy}
			onpaste={onCePaste}
			data-placeholder="Message {otherUser.name}"
			style:font-size={(messageFontSize !== 1.0 && !_savedCeSel) ? `${(messageFontSize * 0.9).toFixed(2)}rem` : (jumboInput > 0 ? JUMBO_SIZES[jumboInput - 1] : null)}
			style:font-weight={(messageFontWeight !== 400 && !_savedCeSel) ? messageFontWeight : null}
			style:font-stretch={(messageFontStretch !== 100 && !_savedCeSel) ? `${messageFontStretch}%` : null}
		></div>
			<MentionAutocomplete
				{inputEl}
				members={[...(data.users ?? []), { id: data.currentUser.id, name: data.currentUser.name, role: data.currentUser.role }]}
			/>
			<div class="compose-fmt-row">
				<label class="btn-fmt btn-fmt-attach" class:disabled={uploading || sending} title="Attach file">
					{#if uploading}
						<span class="msi msi-18 spin">progress_activity</span>
					{:else}
						<span class="msi msi-18">attach_file</span>
					{/if}
					<input bind:this={fileInputEl} type="file" style="display:none" onchange={handleFileSelect} disabled={uploading || sending} />
				</label>
				<div class="compose-picker-wrap">
					<button class="btn-fmt btn-fmt-expr" class:active={showComposePicker} title="Expressions"
						onmousedown={(e) => { e.preventDefault(); const opening = !showComposePicker; if (opening) _pickerFromKb = keyboardOpen; showComposePicker = opening; if (opening) { showMediaPicker = false; inputEl?.blur(); } }}>
						<span class="msi msi-18" class:msi-fill={showComposePicker}>mood</span>
					</button>
					{#if showComposePicker}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="compose-picker-backdrop"
							onclick={closeComposePicker}
							onwheel={closeComposePicker}
							ontouchmove={closeComposePicker}></div>
						<div class="compose-picker-pop">
							<ExpressionPicker
								onSelectEmoji={insertEmoji}
								onInsertKitchen={onKitchenInsert}
								onInsertCustomEmoji={onCustomEmojiInsert}
								onInsertTgEmoji={onTgEmojiInsert}
								isInstructor={data.currentUser.role === 'instructor'}
								onClose={closeComposePicker}
								onBackspace={composeBackspace}
							/>
						</div>
					{/if}
				</div>
				<div class="compose-picker-wrap">
					<button class="btn-fmt btn-fmt-media" class:active={showMediaPicker} title="GIFs &amp; reaction images"
						onmousedown={(e) => { e.preventDefault(); const opening = !showMediaPicker; if (opening) _pickerFromKb = keyboardOpen; showMediaPicker = opening; if (opening) { showComposePicker = false; inputEl?.blur(); } }}>
						<span class="msi msi-18" class:msi-fill={showMediaPicker}>gif_box</span>
					</button>
					{#if showMediaPicker}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="compose-picker-backdrop"
							onclick={closeMediaPicker}
							onwheel={closeMediaPicker}
							ontouchmove={closeMediaPicker}></div>
						<div class="compose-picker-pop">
							<MediaPicker
								onSelectGif={onGifSelect}
								onInsertReaction={onReactionInsert}
								isInstructor={data.currentUser.role === 'instructor'}
								onClose={() => { showMediaPicker = false; }}
							/>
						</div>
					{/if}
				</div>
				<span class="fmt-divider" aria-hidden="true"></span>
				<button class="btn-fmt btn-fmt-more" class:active={showFmtTools}
					onmousedown={(e) => { e.preventDefault(); showFmtTools = !showFmtTools; }}
					title="Formatting" aria-expanded={showFmtTools}><span class="msi msi-18">text_format</span></button>
				<div class="fmt-tools" class:open={showFmtTools}>
				<button class="btn-fmt btn-fmt-bold" onmousedown={(e) => { e.preventDefault(); applyTextFx('bold'); }} title="Bold (⌘B)"><span class="msi msi-18">format_bold</span></button>
				<button class="btn-fmt btn-fmt-italic" onmousedown={(e) => { e.preventDefault(); applyTextFx('italic'); }} title="Italic (⌘I)"><span class="msi msi-18">format_italic</span></button>
				<button class="btn-fmt btn-fmt-underline" onmousedown={(e) => { e.preventDefault(); applyTextFx('underline'); }} title="Underline (⌘U)"><span class="msi msi-18">format_underlined</span></button>
				<button class="btn-fmt btn-fmt-strike" onmousedown={(e) => { e.preventDefault(); applyTextFx('strike'); }} title="Strikethrough"><span class="msi msi-18">format_strikethrough</span></button>
				<div class="compose-format-wrap">
					<button class="btn-fmt btn-fmt-color" class:active={showFormatPanel} onmousedown={(e) => { e.preventDefault(); showFormatPanel = !showFormatPanel; showCodePanel = false; }} title="Text color"><span class="msi msi-18">format_color_text</span></button>
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
					<button class="btn-fmt btn-fmt-code" onmousedown={(e) => { e.preventDefault(); toggleCodeBlock(); }} title="Toggle code block"><span class="msi msi-18">code</span></button>
					<button class="btn-fmt btn-fmt-code-arrow" class:active={showCodePanel} onmousedown={(e) => { e.preventDefault(); showCodePanel = !showCodePanel; showFormatPanel = false; }} title="Choose language"><span class="msi msi-18">arrow_drop_down</span></button>
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
				</div><!-- /.fmt-tools -->
			</div>
		</div>
		{#if tgFxEligible}
			<!-- Telegram special-effect opt-in: 40px checkbox, only offered
			     when the compose is emoji-only (renders jumbo) and holds an
			     av>0 emote. Off by default; resets after send. -->
			<label class="tgfx-check" title="Send with special effect">
				<input type="checkbox" bind:checked={tgFxOn} />
				<span class="tgfx-box" aria-hidden="true">✓</span>
				<span class="tgfx-label">Send with special effect</span>
			</label>
		{/if}
		<div class="compose-effect-wrap">
			<button class="btn-effect" class:active={messageEffect !== null || showEffectPanel}
					title="Message effects" onclick={() => showEffectPanel = !showEffectPanel}><span class="msi msi-18" class:msi-fill={messageEffect !== null || showEffectPanel}>auto_awesome</span></button>
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
		<div class="send-wrap" class:behind-picker={showComposePicker || showMediaPicker || !!pickerMsgId} bind:this={sendWrapEl} onpointerdown={onSendDown} onpointerup={onSendQuickUp} onpointermove={sizeSliderActive ? onSendMove : null} onpointercancel={sizeSliderActive ? onSendCancel : null}>
			{#if sizeSliderActive}
				<div class="sz-panel" style:top="{panelFixedTop}px" style:left="{panelFixedLeft}px" style:right="{panelFixedRight}px" style:height="{panelHeight}px">
					<div class="sz-track-line"></div>
					<div class="sz-pill" bind:this={_szPillEl}>Normal</div>
				</div>
			{/if}
			<button class="btn-send" class:btn-send-off={sending || uploading || (!input.trim() && !pendingAttachment)} class:sz-active={sizeSliderActive} aria-label="Send" title="Send">
				{#if !sizeSliderActive}<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/></svg>{/if}
			</button>
		</div>
	</div>
	{#if sizeSliderActive}
		<div class="sz-capture" onpointermove={onSendMove} onpointerup={onSendUpArmed} onpointercancel={onSendCancel}></div>
	{/if}
</div>

<style>
	.chat-header {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 1rem 1.5rem 0.75rem; border-bottom: 1.5px solid var(--border); flex-shrink: 0;
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
	.avatar {
		width: 28px; height: 28px; border-radius: 7px; background: var(--ink); color: var(--paper);
		font-size: 0.8rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
	}
	.badge {
		font-size: 0.65rem; font-weight: 600; background: var(--ink); color: var(--paper);
		padding: 0.1rem 0.4rem; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.04em;
	}
	.message-list {
		flex: 1; overflow-y: auto; overflow-x: clip; padding: 1rem 1.5rem;
		display: flex; flex-direction: column; gap: 0.15rem;
		scrollbar-width: none;
		overscroll-behavior: contain;
		/* Centered reading column on wide desktops — same 840px as
		   the channel page so DMs and channels feel cohesive. Mobile
		   keeps the full-width behaviour via the override below. */
		width: 100%;
		max-width: 840px;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.message-list::-webkit-scrollbar { display: none; }
	.empty { color: var(--muted-fg); font-size: 0.9rem; text-align: center; margin: auto; }
	.load-more-spinner { display: flex; justify-content: center; padding: 0.75rem 0; }
	.message { display: flex; flex-direction: column; max-width: 75%; gap: 0.15rem; position: relative; }
	.message.mine { align-self: flex-end; align-items: flex-end; }
	.message:not(.mine) { align-self: flex-start; align-items: flex-start; }
	.message.first { margin-top: 0.75rem; }
	.meta { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.5rem; }
	.meta-name-row { display: inline-flex; align-items: center; gap: 0.4rem; }
	.meta-avatar-wrap { position: relative; display: inline-flex; }
	.meta-presence-dot {
		position: absolute;
		bottom: -1px; right: -1px;
		width: 8px; height: 8px;
		border-radius: 50%;
		background: #4caf50;
		box-shadow: 0 0 0 2px var(--paper);
	}
	.meta-presence-dot.idle { background: #ffc107; }
	.name { font-size: 0.78rem; font-weight: 600; color: var(--ink); cursor: pointer; }
	.name:hover { text-decoration: underline; text-underline-offset: 2px; }
	.time { font-size: 0.72rem; color: var(--muted-fg); }

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
	.reply-text { display: block; font-size: 0.78rem; color: var(--muted-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.reply-text.jumbo-reply { white-space: normal; text-overflow: clip; line-height: 1.15; }
	/* Overlays inside the sent-bubble are tinted with `currentColor`
	   so they adapt whether the bubble is dark (ink era) or light
	   (primary-container era). */
	.message.mine .bubble .reply-quote { background: color-mix(in srgb, currentColor 12%, transparent); }
	.message.mine .bubble .reply-quote:hover { background: color-mix(in srgb, currentColor 20%, transparent); }
	.message.mine .bubble .reply-author { color: color-mix(in srgb, currentColor 70%, transparent); }
	.message.mine .bubble .reply-text { color: color-mix(in srgb, currentColor 92%, transparent); }

	/* Bubble row */
	.bubble-row { position: relative; display: flex; align-items: flex-end; gap: 0.3rem; max-width: 100%; min-width: 0; }
	.message.mine .bubble-row { flex-direction: row-reverse; }

	/* Lift the hovered message above every sibling and disable mobile paint-
	   containment for it so its floating action bar is never clipped/covered. */
	.message:hover { z-index: 40; content-visibility: visible; }

	/* Thread chip — Slack-style "N replies" under a bubble */
	.thread-chip {
		display: inline-flex; align-items: center; gap: 0.3rem;
		margin-top: 0.25rem; padding: 0.2rem 0.6rem;
		border: 1.5px solid var(--border); border-radius: 999px;
		background: var(--paper); color: var(--md-sys-color-primary, var(--accent));
		font-family: inherit; font-size: 0.72rem; font-weight: 600;
		cursor: pointer; transition: border-color 0.12s, background 0.12s;
	}
	@media (max-width: 640px) {
		/* This is the only way into a thread on a phone, and at desktop size it
		   was a target you had to aim at. Bigger text, and enough padding to
		   clear the 44px the rest of the app's touch targets use. */
		.thread-chip {
			margin-top: 0.4rem;
			padding: 0.5rem 0.85rem;
			font-size: 0.85rem;
			gap: 0.4rem;
		}
		.thread-chip-dot { width: 8px; height: 8px; }
	}
	.thread-chip:hover { border-color: var(--md-sys-color-primary, var(--accent)); background: var(--surface-2); }
	.thread-chip.unread { border-color: var(--md-sys-color-primary, var(--accent)); font-weight: 700; }
	.thread-chip-dot {
		width: 7px; height: 7px; border-radius: 50%;
		/* always RED — unread must read as unread regardless of the theme's
		   primary colour (matches the sidebar's unread dots) */
		background: #e53935;
		flex-shrink: 0;
	}

	.msg-actions-bar {
		position: absolute;
		top: 9px;
		transform: translateY(-100%);
		display: flex;
		flex-direction: row;
		gap: 0;
		background: var(--paper);
		border: 1.5px solid var(--border);
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
		left: max(5px, calc(100% - 148px));
	}

	/* For mine messages: left-anchor when bubble is wide, right-anchor when narrow */
	.message.mine .msg-actions-bar {
		left: min(-5px, calc(100% - 188px));
	}

	/* Show bar on bubble-row hover or when bar itself is hovered */
	.bubble-row:hover .msg-actions-bar,
	.msg-actions-bar:hover {
		opacity: 1;
		pointer-events: auto;
	}

	.action-btn {
		background: transparent; border: none; border-radius: 6px;
		width: 30px; height: 30px; padding: 5px; cursor: pointer; color: var(--muted-fg);
		display: flex; align-items: center; justify-content: center;
		transition: color 0.1s, background 0.1s;
		flex-shrink: 0;
	}
	.action-btn:hover { color: var(--ink); background: rgba(0,0,0,0.06); }
	.action-btn-delete:hover { color: var(--danger); background: rgba(192,57,43,0.08); }
	.action-btn-starred { color: #e6a817; }
	.action-btn-starred:hover { color: #c8900f; background: rgba(230,168,23,0.1); }

	/* Edit mode */
	.edit-bubble { padding: 0.4rem !important; min-width: 220px; background: var(--paper) !important; border: 1.5px solid var(--ink) !important; }
	.edit-textarea {
		width: 100%; min-height: 56px; padding: 0.4rem 0.5rem;
		border: none; background: transparent; font-family: inherit;
		font-size: 0.9rem; color: var(--ink); resize: vertical;
		outline: none; display: block; field-sizing: content;
	}
	.edit-controls { display: flex; gap: 0.25rem; justify-content: flex-end; margin-top: 0.25rem; }
	.edit-cancel {
		padding: 0.25rem 0.65rem; background: none; border: none;
		font-family: inherit; font-size: 0.78rem; color: var(--muted-fg); cursor: pointer; border-radius: 5px;
	}
	.edit-cancel:hover { background: var(--surface-2); color: var(--ink); }
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
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 110px; overflow: hidden;
	}
	.kebab-item {
		display: block; width: 100%; text-align: left;
		padding: 0.5rem 0.85rem; font-family: inherit; font-size: 0.82rem;
		background: none; border: none; cursor: pointer; color: var(--ink);
		transition: background 0.1s;
	}
	.kebab-item:hover { background: var(--surface-2); }
	.kebab-item-delete { color: var(--danger); }
	.kebab-item-delete:hover { background: #fff0f0; }


	.bubble {
		margin: 0; padding: 0.55rem 0.85rem; border-radius: 14px;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		font-size: 0.9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		background: var(--paper); border: 1.5px solid var(--border);
	}
	/* Sent-bubble: M3 primary-container + on-primary-container — the
	   designed-together pair for "user-owned content in the primary
	   family". Previously this was ink-on-paper (near-black bubble,
	   near-white text), which read as pure black-and-white and felt
	   stark. The container variant keeps the chromatic identity of
	   the user's seed while landing in a comfortable contrast range. */
	.message.mine .bubble {
		background: var(--md-sys-color-primary-container, color-mix(in srgb, var(--accent) 30%, var(--paper)));
		color: var(--md-sys-color-on-primary-container, var(--ink));
		border-color: var(--md-sys-color-primary-container, color-mix(in srgb, var(--accent) 30%, var(--paper)));
	}
	.message.starred:not(.mine) .bubble { background: #fff8e6; border-color: #e6cc70; }
	.message.starred.mine .bubble { border-color: #c8900f; }
	.msg-sending-indicator { position: absolute; bottom: -14px; left: 4px; }
	.msg-sending-indicator.mine { left: auto; right: 4px; }
	.sending-spinner { display: block; width: 10px; height: 10px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.7s linear infinite; opacity: 0.35; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.bubble.jumbo-emoji { background: transparent !important; border-color: transparent !important; box-shadow: none !important; padding: 0.1rem 0.4rem; line-height: 1.15; }

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
		/* max-width as well as width: inside a fit-content bubble, `width: 100%`
		   resolves against a parent that already grew to the code's intrinsic
		   width, so one long line dragged the whole PAGE sideways on a phone. */
		max-width: 100%;
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
	:global(.code-body) { display: grid; grid-template-columns: auto minmax(0, 1fr); overflow: auto; }
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
	:global(.message.mine .inline-code) { background: color-mix(in srgb, currentColor 12%, transparent); }
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

	.saved-label {
		display: flex; align-items: center; gap: 0.2rem;
		font-size: 0.62rem; font-weight: 600; color: #c8900f;
		padding: 0.1rem 0.5rem; letter-spacing: 0.02em;
	}
	.message.mine .saved-label { justify-content: flex-end; }

	.bubble-reaction-img { border-radius: 0 !important; }
	.img-removed {
		display: flex; align-items: center; justify-content: center;
		width: 200px; height: 120px; background: var(--surface-2); color: var(--muted-fg);
		font-size: 0.78rem; font-family: inherit; border-radius: 8px;
	}
	:global(.img-removed-inline) {
		display: inline-block; padding: 0.1em 0.4em;
		background: var(--surface-2); color: var(--muted-fg); border-radius: 4px;
		font-size: 0.72em; vertical-align: middle;
	}
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
		border: 1px solid var(--border); background: transparent; color: inherit;
	}
	.att-btn:hover { background: rgba(0,0,0,0.06); }
	.att-btn-icon { width: 13px; height: 13px; flex-shrink: 0; }
	.message.mine .att-btn { border-color: color-mix(in srgb, currentColor 25%, transparent); }
	.message.mine .att-btn:hover { background: color-mix(in srgb, currentColor 10%, transparent); }

	/* Drag-and-drop upload overlay — pointer-events:none, purely visual
	   (the message-list / input-area under it own the drop). */
	.drop-overlay {
		position: fixed; inset: 52px 0 0 0; z-index: 60; pointer-events: none;
		display: flex; align-items: center; justify-content: center;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		backdrop-filter: blur(1.5px);
	}
	.drop-card {
		display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
		padding: 1.6rem 2.4rem; border-radius: 18px;
		border: 2px dashed var(--accent); background: var(--paper); color: var(--accent);
		font-weight: 700; font-size: 0.95rem; box-shadow: 0 12px 40px rgba(0,0,0,0.18);
	}
	.drop-card svg { width: 34px; height: 34px; }

	/* Proactive link chip suggestion above the composer (opt-in). */
	.link-suggest { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.5rem; }
	.link-suggest-chip {
		flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.55rem;
		padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 12px;
		background: var(--surface-2); color: var(--ink); cursor: pointer; text-align: left;
		font-family: inherit; transition: border-color 0.12s, background 0.12s;
	}
	.link-suggest-chip:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); }
	.link-suggest-fav { width: 20px; height: 20px; border-radius: 4px; flex-shrink: 0; }
	.link-suggest-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.link-suggest-title { font-size: 0.85rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.link-suggest-host { font-size: 0.7rem; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.link-suggest-add {
		flex-shrink: 0; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.02em;
		color: var(--accent); text-transform: uppercase;
	}
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
	/* In-app Word document reader (docx-preview — original formatting).
	   The library renders real "pages" (.docx-wrapper > section.docx) with
	   the document's own fonts/colors/spacing; we just give it a PDF-viewer
	   style gray backdrop and let it scroll both axes (pages have a fixed
	   real-world width, so narrow screens pan horizontally). */
	.file-viewer-doc { flex: 1; overflow: auto; background: #525659; }
	.file-viewer-doc :global(.docx-wrapper) { background: transparent; padding: 1.25rem; }
	.file-viewer-doc-loading {
		display: flex; align-items: center; justify-content: center; gap: 0.5rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		color: #ccc; font-size: 0.9rem;
	}

	/* Reactions */
	.reactions { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.2rem; }

	/* Read marker — the other user's avatar at the last message they've
	   read. Absolutely positioned at the row's bottom-right so it overlays
	   the message and never changes its height (no reflow / scroll-jank). */
	.read-row {
		position: absolute;
		right: 4px;
		bottom: -7px;
		display: inline-flex;
		align-items: center;
		pointer-events: none;
		z-index: 3;
	}
	.read-dot {
		display: inline-flex;
		border-radius: 50%;
		box-shadow: 0 0 0 1.5px var(--paper);
	}
	.reaction-chip {
		position: relative;
		display: flex; align-items: center; gap: 0.22rem;
		background: var(--surface-2); border: 1.5px solid var(--border); border-radius: 99px;
		padding: 0.12rem 0.5rem; font-size: 0.85rem; cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
	}
	.reaction-chip:hover { background: var(--surface-2); border-color: var(--border); }
	.reaction-chip.reacted { background: #e8f0fe; border-color: #a0b8f0; }
	.reaction-count { font-size: 0.72rem; color: var(--muted-fg); font-weight: 600; }
	.reaction-tooltip {
		display: none;
		position: absolute;
		top: calc(100% + 6px);
		left: 50%; transform: translateX(-50%);
		min-width: max-content;
		background: var(--paper, var(--paper)); color: var(--ink);
		border: 1.5px solid var(--border);
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
	/* Focused-message preview is a mobile-only affordance. */
	.react-msg-preview { display: none; }

	@media (max-width: 640px) {
		/* Mobile: dock the reaction popover as a full-width bottom sheet
		   (mirrors the compose picker) so it never lands off-screen. The
		   inline ExpressionPicker is height/width:100% on mobile. */
		.picker-overlay { background: rgba(0,0,0,0.82); z-index: 60; }
		.picker-popover {
			left: 0 !important; right: 0;
			top: auto !important; bottom: 0;
			/* No `width: 100vw` — left/right:0 sizes this to the page, while
			   100vw counts the scrollbar and overflows it. */
			height: calc(min(58vh, 22rem) + env(safe-area-inset-bottom, 0px));
			padding-bottom: env(safe-area-inset-bottom, 0px);
			/* Background / radius / shadow live on the ExpressionPicker panel
			   inside (it already draws them on mobile). Keeping them here too
			   would leave an identical slab behind when the panel translates
			   down under a drag-to-dismiss, so the sheet would look stuck. */
			z-index: 61;
		}
		/* Floating, brightly-lit copy of the focused message — bottom edge
		   100px above the picker, content anchored to its bottom (top clipped
		   + masked) so the END of a tall message is always visible. */
		.react-msg-preview {
			display: flex;
			position: fixed;
			left: 0; right: 0;
			bottom: calc(min(58vh, 22rem) + env(safe-area-inset-bottom, 0px) + 100px);
			max-height: calc(100dvh - var(--header-h, 52px) - min(58vh, 22rem)
			            - env(safe-area-inset-bottom, 0px) - 120px);
			padding: 0 14px;
			justify-content: flex-start;
			align-items: flex-end;
			overflow: hidden;
			pointer-events: none;
			z-index: 61;
		}
		.react-msg-preview.mine { justify-content: flex-end; }
		.rmp-inner {
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
			align-items: flex-start;
			gap: 5px;
			max-width: 84%;
			max-height: 100%;
			overflow: hidden;
		}
		.react-msg-preview.mine .rmp-inner { align-items: flex-end; }
		.react-msg-preview.mine .bubble {
			background: var(--md-sys-color-primary-container, color-mix(in srgb, var(--accent) 30%, var(--paper)));
			color: var(--md-sys-color-on-primary-container, var(--ink));
			border-color: var(--md-sys-color-primary-container, color-mix(in srgb, var(--accent) 30%, var(--paper)));
		}
		.react-msg-preview .bubble { box-shadow: 0 6px 22px rgba(0,0,0,0.22); }
	}

	/* Reply bar */
	.reply-bar {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.4rem 1.5rem; border-top: 1px solid var(--border); background: var(--surface-2);
	}
	.reply-bar-content { flex: 1; display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
	.reply-bar-to { font-size: 0.72rem; color: var(--muted-fg); }
	.reply-bar-to strong { color: var(--ink); }
	.reply-bar-text { font-size: 0.78rem; color: var(--muted-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* Reply mini-preview: emotes inline at one uniform size, single normal
	   line (size/effect markup + jumbo already neutralized in the render). */
	.reply-quote-preview { line-height: 1.5; }
	.reply-quote-preview :global(.tg-emoji),
	.reply-quote-preview :global(.ek-img),
	.reply-quote-preview :global(.ek-img-ce),
	.reply-quote-preview :global(.ce-img),
	.reply-quote-preview :global(.ce-img-ce) {
		width: 1.2em !important; height: 1.2em !important; vertical-align: -0.25em;
	}
	.reply-bar-close {
		background: none; border: none; color: var(--muted-fg); font-size: 1.2rem;
		cursor: pointer; line-height: 1; padding: 0.1rem 0.35rem; border-radius: 4px; flex-shrink: 0;
	}
	.reply-bar-close:hover { color: var(--ink); background: var(--surface-2); }

	.att-bar { align-items: center; gap: 0.6rem; }
	.att-img-preview {
		position: relative; padding: 0.5rem 1.5rem; border-top: 1px solid var(--border); background: var(--surface-2);
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

	/* Blocked-conversation notice (sits in the message list flow). */
	.blocked-notice {
		margin: 1rem auto;
		max-width: 420px;
		padding: 0.8rem 1.1rem;
		border: 1.5px solid var(--border);
		border-radius: 12px;
		background: var(--surface-2, rgba(0, 0, 0, 0.04));
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
	}
	.blocked-notice p { margin: 0; font-size: 0.85rem; color: var(--muted-fg); }
	.btn-unblock-inline {
		padding: 0.45rem 1rem;
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; font-weight: 600;
		color: var(--ink); cursor: pointer;
	}
	.btn-unblock-inline:hover { border-color: var(--ink); }

	/* No browser-chrome padding — the --vvh-sized .chat-wrap already ends at
	   the visible bottom (see the note on the channel page). */
	.input-area { flex-shrink: 0; position: relative; }
	.typing-indicator {
		font-size: 0.75rem; color: var(--muted-fg); padding: 0 1.5rem 0.25rem;
		margin: 0; min-height: 1.2rem;
	}
	.input-bar {
		display: flex; align-items: flex-end; gap: 0.5rem;
		padding: 0.75rem 1.5rem 1.5rem;
		/* Matches the message-list column above so compose stays in
		   the same vertical alignment as messages. */
		width: 100%;
		max-width: 840px;
		margin: 0 auto;
		box-sizing: border-box;
		background: var(--paper);
	}
	.tgfx-check {
		position: relative; flex-shrink: 0;
		display: flex; align-items: center; gap: 0.45rem;
		cursor: pointer; user-select: none;
	}
	.tgfx-check input {
		position: absolute; inset: 0; width: 100%; height: 100%;
		opacity: 0; margin: 0; cursor: pointer;
	}
	.tgfx-box {
		width: 40px; height: 40px; box-sizing: border-box; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		border: 2px solid var(--border); border-radius: 10px;
		background: var(--paper); color: transparent;
		font-size: 1.4rem; line-height: 1;
		transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
	}
	.tgfx-label {
		font-size: 0.72rem; line-height: 1.25; color: var(--muted-fg);
		max-width: 5.5rem;
	}
	.tgfx-check input:checked + .tgfx-box { background: var(--ink); border-color: var(--ink); color: var(--paper); }
	.tgfx-check input:checked ~ .tgfx-label { color: var(--ink); }
	.tgfx-check:hover .tgfx-box { border-color: var(--ink); }
	/* Fade lives on .input-area parent so reply-bar / attachment
	   preview aren't washed out (see channel page for the rationale).
	   z-index: 1 keeps it below the message hover action bar (z:50)
	   and kebab menu (z:21). */
	.input-area::before {
		content: '';
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		height: 40px;
		background: linear-gradient(to bottom, transparent 0%, var(--paper) 100%);
		pointer-events: none;
		z-index: 1;
	}
	textarea {
		flex: 1; padding: 0.6rem 0.85rem; border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); font-family: inherit; font-size: 0.9rem; color: var(--ink);
		outline: none; resize: none; field-sizing: content; max-height: 140px; transition: border-color 0.15s;
	}
	textarea:focus { border-color: var(--ink); }
	.compose-wrap {
		flex: 1; display: flex; flex-direction: column;
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); transition: border-color 0.15s; min-width: 0;
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
		/* eases the live whole-message resize from the send-button drag */
		transition: font-size 0.09s ease-out;
	}
	/* live-scaled wrapper while dragging the highlight size slider */
	:global(.sz-live) { transition: font-size 0.09s ease-out; }
	.compose-ce::-webkit-scrollbar { display: none; }
	.compose-ce:empty::before {
		content: attr(data-placeholder);
		color: var(--muted-fg); pointer-events: none;
	}
	.compose-ce[contenteditable="false"] { opacity: 0.5; cursor: default; }
	.compose-fmt-row {
		/* No separator between the editor and the toolbar row — same
		   change as the channel page. */
		/* Wrap the toolbar when it doesn't fit the compose width (phone) so the
		   trailing buttons stay inside the box instead of overflowing onto the
		   effect + send buttons. Same fix as the channel page. */
		display: flex; align-items: center; flex-wrap: wrap; gap: 0.1rem;
		padding: 0.2rem 0.5rem 0.3rem;
	}
	/* Attach + emoji moved INTO .compose-fmt-row as .btn-fmt variants
	   so the input-bar's compose-wrap can take full width. */
	.btn-fmt-attach { color: var(--ink); }
	.btn-fmt-attach.disabled { opacity: 0.4; pointer-events: none; }
	.btn-fmt-expr { color: var(--ink); }
	.fmt-divider {
		display: inline-block;
		width: 1px;
		height: 18px;
		background: var(--border);
		margin: 0 0.3rem;
		flex-shrink: 0;
	}
	.spin { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.compose-picker-wrap { position: relative; flex-shrink: 0; }
	.compose-picker-backdrop { position: fixed; inset: 0; z-index: 49; }
	.compose-picker-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 50; }
	@media (max-width: 640px) {
		/* Mobile: dock at the very bottom (keyboard suppressed via inputmode=none),
		   lift the input bar above. --picker-h drives BOTH the sheet height and
		   the lift so the bar sits flush on the keyboard with no dead gap; the
		   panel inside is forced to height:100% (ExpressionPicker) to fill it.
		   The lift is a MARGIN (not padding) so the bar's bottom edge pins to
		   the picker top and grows UPWARD as it gets taller. The bar's own
		   safe-area bottom padding is dropped — the picker now owns the safe
		   area, so that pad would re-open the gap. */
		/* Fit the compose toolbar in ONE row (see channel page for the full
		   rationale): app.css's 40px .btn-fmt tap target overflowed the row onto
		   the effect + send buttons. Trim these toolbar buttons so it fits. */
		.compose-fmt-row { gap: 0; }
		.compose-fmt-row .btn-fmt {
			min-width: 30px !important; width: 30px;
			min-height: 34px !important; height: 34px;
		}
		.compose-fmt-row .btn-fmt-code-arrow { min-width: 18px !important; width: 18px; }

		/* The picker opens at the height the KEYBOARD occupies, so tapping the
		   expression button while typing swaps one panel for the other without
		   the compose bar moving at all — the iOS Messages behaviour. --kb-h-last
		   is the last real keyboard height (see $lib/keyboard-metrics.js),
		   remembered because by the time the picker lays out the keyboard is
		   already sliding away. The clamp keeps a wrong/absent reading sane, and
		   the 22rem fallback is the old fixed height. */
		/* --picker-h is the FULL height of the docked sheet, measured from the
		   physical bottom of the screen — home indicator included.
		   That definition matters: --kb-h-last is the keyboard's height, and the
		   keyboard already extends to the bottom of the screen. Adding
		   env(safe-area-inset-bottom) on top of it (which this used to do, in
		   both the sheet height and the bar's lift) counted that strip twice, so
		   the sheet came out ~34px taller than the keyboard it was replacing and
		   the compose bar sat that much too high. The picker's own tab strip
		   carries the inset internally, so its buttons still clear the
		   indicator. The fallback keeps the inset because 22rem is a usable
		   height, not a screen-bottom measurement. */
		.input-area {
			/* --expr-grow: extra height from the grabber's pull-up gesture
			   (ExpressionPicker writes it on <html>). It rides inside the same
			   clamp, so the input bar's margin-bottom lift and the sheet grow
			   together from this one number. 86dvh cap = the expanded state. */
			/* Split in two so the search lift can shrink the sheet without
			   restating this formula: --picker-h-base is the height the picker
			   WANTS, --picker-h is what it gets. app.css ("Searching inside a
			   docked picker") re-derives the second from the first when the
			   keyboard is up and the lifted stack no longer fits. */
			--picker-h-base: clamp(
				15rem,
				calc(var(--kb-h-last, calc(22rem + env(safe-area-inset-bottom, 0px))) + var(--expr-grow, 0px)),
				86dvh
			);
			--picker-h: var(--picker-h-base);
		}
		.input-area.picker-open { margin-bottom: var(--picker-h); }
		/* The input area must NEVER be transformed while the picker is open.
		   The picker sheet is `position: fixed` but lives INSIDE .input-area,
		   and a transform on an ancestor (a) makes that ancestor the containing
		   block for fixed descendants, so the sheet anchors to the compose bar
		   instead of the viewport and lurches around, and (b) creates a stacking
		   context, trapping the sheet's z-index so message bubbles paint over
		   it. An earlier `compose-rise` keyframe here did exactly that. app.css
		   carries the same warning for the native keyboard transform.
		   So the bar's move stays a plain one-shot layout change, and only the
		   sheet — which is the fixed element itself, not an ancestor of one —
		   animates. */
		.compose-picker-pop { animation: sheet-rise 0.24s cubic-bezier(0.32, 0.72, 0, 1); }
		@keyframes sheet-rise {
			from { transform: translate3d(0, 100%, 0); }
			to   { transform: translate3d(0, 0, 0); }
		}
		/* Swapping straight from the keyboard: the keyboard is still sliding
		   down over the sheet, so sliding the sheet up as well reads as two
		   things moving past each other. Fade it in under the keyboard instead. */
		.input-area.from-kb .compose-picker-pop {
			animation: sheet-fade 0.18s ease-out;
		}
		@keyframes sheet-fade { from { opacity: 0; } to { opacity: 1; } }
		@media (prefers-reduced-motion: reduce) {
			.compose-picker-pop,
			.input-area.from-kb .compose-picker-pop { animation: none; }
		}
		/* Gap between the bottom of the compose and whatever is docked under it
		   (keyboard or picker). ONE knob — raise it if the bar wants breathing
		   room, drop it to 0 to sit flush.
		   Whenever something IS docked, the home indicator is covered by that
		   thing, so the bar must not reserve safe-area space of its own; the
		   base rule's `max(0.5rem, env(safe-area-inset-bottom, 0.5rem))` would
		   otherwise leave ~34px of dead space on a device with an indicator.
		   This sets the value outright rather than trying to out-specify each
		   contributor, so the result doesn't depend on which rule wins. */
		.input-area { --compose-dock-gap: 0.5rem; }
		.input-area.picker-open .input-bar,
		.input-area.kb-open .input-bar {
			padding-bottom: var(--compose-dock-gap);
		}
		/* Grabber drag = transforms only — see the channel page. */
		:global(html.expr-grow-dragging) .compose-picker-pop {
			transform: translateY(calc(-1 * var(--expr-grow-drag, 0px)));
			will-change: transform;
		}
		:global(html.expr-grow-dragging) .input-area.picker-open > *:not(.compose-picker-pop):not(.compose-picker-backdrop) {
			transform: translateY(calc(-1 * var(--expr-grow-drag, 0px)));
			will-change: transform;
		}
		.compose-picker-pop {
			position: fixed;
			left: 0; right: 0;
			/* Lift by the browser-chrome slice so the sheet's top stays flush
			   with the --vvh-sized compose bar above (see the channel page). */
			bottom: var(--browser-chrome-h, 0px);
			/* left/right:0 already fixes the width; `100vw` used to override that
			   with the viewport width INCLUDING any scrollbar, which is what let
			   the sheet hang past the right edge of the page. */
			height: var(--picker-h);
			/* No padding-bottom: the picker's bottom tab strip carries the
			   safe-area inset so its grey background runs to the screen bottom.
			   No background either: the ExpressionPicker panel inside carries it,
			   so the panel can translate down out of this box during a
			   drag-to-dismiss instead of sliding across a matching slab. */
			z-index: 60;
		}
		/* Faux caret — with the iOS keyboard suppressed the compose loses its
		   native cursor; draw a blinking bar at the insertion point (the end,
		   where the docked picker appends). */
		.input-area.picker-open .compose-ce::after {
			content: '';
			display: inline-block;
			width: 2px;
			height: 1.15em;
			margin-left: 1px;
			vertical-align: text-bottom;
			background: var(--accent);
			border-radius: 1px;
			animation: faux-caret-blink 1.06s steps(1, start) infinite;
		}
	}
	@keyframes faux-caret-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

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
	}
	:global(.ce-img) { height: 1.2em; width: 1.2em; vertical-align: -0.25em; object-fit: contain; }
	:global(.ce-img-ce) { cursor: default; }
	/* Unified selection highlight for emote IMAGES (EK/CE/flags), compose +
	   bubbles. .emote-sel is toggled by highlightEmotesInSel. */
	:global(.ek-img.emote-sel), :global(.ek-img-ce.emote-sel),
	:global(.ce-img.emote-sel), :global(.ce-img-ce.emote-sel),
	:global(.tg-emoji-img.emote-sel), :global(.tfx-flip.emote-sel) {
		outline: 2px solid color-mix(in srgb, var(--accent) 75%, transparent);
		background: color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: 4px;
	}
	/* Telegram animated emoji */
	:global(.tg-img) { height: 1.3em; width: 1.3em; vertical-align: -0.3em; object-fit: contain; }
	:global(.tg-img-ce) { cursor: default; }
	:global(.tg-emoji) { display: inline-block; position: relative; width: 1.4em; height: 1.4em; vertical-align: -0.3em; cursor: default; line-height: 0; }
	/* Selection highlight overlay — see onMsgListSelectionChange. The
	   ::after sits above the Lottie SVG via z-index so the highlight is
	   visible even when the animation is fully painted. pointer-events
	   off so it doesn't swallow clicks meant for the .tg-fx underlay. */
	:global(.tg-emoji.emote-sel::after) {
		content: '';
		position: absolute;
		inset: -1px;
		background: color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: 3px;
		pointer-events: none;
		z-index: 10;
	}
	:global(.tg-emoji.tg-fx) { cursor: pointer; }
	/* Let the parent span catch the click — SVG/canvas inside default to capturing
	   pointer events only on painted pixels, so transparent corners would miss. */
	/* user-select:none so the selection skips the non-text player and crosses
	   the span (else it stalls at the emote and never highlights — see app.css). */
	:global(.tg-emoji svg), :global(.tg-emoji canvas) { pointer-events: none; -webkit-user-select: none; user-select: none; }
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
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); color: var(--muted-fg); cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.btn-kitchen:hover, .btn-kitchen.active { color: var(--ink); border-color: var(--muted-fg); background: var(--surface-2); }
	.btn-gif { font-size: 0.65rem; font-weight: 700; font-family: inherit; letter-spacing: -0.02em; }
	.compose-kitchen-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 50; }
	@media (max-width: 640px) {
		.compose-kitchen-pop {
			position: fixed;
			left: 0; right: 0;
			/* + browser-chrome: fixed resolves against the layout viewport, the
			   input area lives in the --vvh-sized chat above the browser's bar. */
			bottom: calc(var(--input-area-h, 56px) + env(safe-area-inset-bottom, 0px) + var(--browser-chrome-h, 0px));
			z-index: 60;
		}
	}

	.send-wrap.behind-picker { z-index: 1; }
	.send-wrap {
		position: relative; flex-shrink: 0; touch-action: none; user-select: none; z-index: 299;
		/* Stretch to the full height of the compose bar so the send button stands
		   as tall as the message box beside it (input-bar is align-items:flex-end). */
		align-self: stretch;
	}
	.btn-send {
		display: inline-flex; align-items: center; justify-content: center;
		/* Themed rather than flat black: the send button is the one true action in
		   the bar, so it carries the scheme's primary colour. */
		padding: 0.6rem; background: var(--md-sys-color-primary, var(--ink));
		color: var(--md-sys-color-on-primary, var(--paper)); border: none;
		border-radius: 10px; font-family: inherit; font-size: 0.875rem; font-weight: 600;
		cursor: pointer; transition: opacity 0.15s; pointer-events: none;
		position: relative; z-index: 1; width: 44px; height: 100%;
	}
	.btn-send svg { display: block; margin-right: 1px; }
	.btn-send:hover { opacity: 0.8; }
	/* Disabled: a soft tinted chip, not the same slab at 40% — dimming a solid
	   dark fill reads as a grey block sitting on the page rather than an inactive
	   control. */
	.btn-send.btn-send-off {
		opacity: 1; cursor: default;
		background: var(--md-sys-color-surface-container-high, rgba(0,0,0,0.06));
		color: var(--md-sys-color-on-surface-variant, var(--ink));
	}
	.btn-send.sz-active { opacity: 0; }
	/* Slider panel — floats above + below send button */
	.sz-panel {
		position: absolute;
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
		background: none; cursor: pointer; color: var(--ink);
		font-size: 0.85rem; line-height: 1; font-family: inherit;
		transition: background 0.1s;
	}
	.btn-fmt:hover, .btn-fmt.active { background: var(--surface-2); }
	/* Bold/italic/underline/strike/color modifier classes used to style
	   the literal letter inside the button (B / I / U / S / A); now that
	   each button holds a Material Symbols icon, the only remaining job
	   of these class hooks is :class targeting from outside this file
	   if needed. No per-modifier font/decoration styling required. */
	.compose-format-wrap { position: relative; flex-shrink: 0; }
	.format-pop {
		position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
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
		background: none; border: 1.5px solid var(--border); border-radius: 6px;
		padding: 0.25rem 0.5rem; font-size: 0.78rem; font-family: inherit;
		cursor: pointer; text-align: left; color: var(--ink); transition: background 0.1s;
	}
	.format-rainbow-btn:hover { background: var(--surface-2); }

	/* Square off the inner edges of the split code/lang-dropdown pair so
	   they read as one control. Per-button typography is now the icon
	   span's responsibility, not the button itself. */
	.btn-fmt-code { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; }
	.btn-fmt-code-arrow { padding: 0 0.15rem !important; border-top-left-radius: 0 !important; border-bottom-left-radius: 0 !important; margin-left: -1px; min-width: 0; }
	.code-btn-group { display: flex; align-items: center; }
	.fmt-tools { display: contents; }
	.btn-fmt-more { display: none; }
	@media (max-width: 640px) {
		.btn-fmt-more { display: inline-flex; }
		.fmt-tools { display: none; }
		.fmt-tools.open { display: contents; }
	}
	.code-lang-pop {
		display: flex; flex-wrap: wrap; gap: 0.2rem; padding: 0.45rem; width: 200px;
	}
	.code-lang-btn {
		padding: 0.22rem 0.5rem; border: 1px solid #e0d9cc; border-radius: 5px;
		background: var(--paper); font-family: inherit; font-size: 0.7rem; cursor: pointer;
		color: var(--ink); transition: background 0.1s, border-color 0.1s;
	}
	.code-lang-btn:hover { background: #1e1e2e; color: #cdd6f4; border-color: #1e1e2e; }
	.code-lang-icon { width: 14px; height: 14px; vertical-align: -2px; flex-shrink: 0; }
	:global(.code-lang .code-lang-icon) { width: 15px; height: 15px; display: block; margin-top: -2.5px; }

	/* Effects button */
	/* Stretch to the full compose-bar height (input-bar is align-items:flex-end)
	   so it matches the message box and the send button. */
	.compose-effect-wrap { position: relative; flex-shrink: 0; align-self: stretch; }
	.btn-effect {
		display: flex; align-items: center; justify-content: center;
		/* Same footprint as the send button beside it — 36 vs 40 read as a
		   misalignment even though both already match the compose bar's height. */
		width: 44px; height: 100%; font-size: 1rem; line-height: 1;
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); color: var(--ink); cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.btn-effect:hover, .btn-effect.active { border-color: var(--muted-fg); background: var(--surface-2); }
	.effect-pop {
		position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 50;
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 240px; overflow: hidden;
	}
	.typo-sliders { padding: 0.25rem 0.75rem 0.5rem; display: flex; flex-direction: column; gap: 0.45rem; }
	.typo-row { display: flex; align-items: center; gap: 0.4rem; }
	.typo-label { font-size: 0.68rem; font-weight: 600; color: var(--muted-fg); width: 2.8rem; flex-shrink: 0; }
	.typo-range { flex: 1; height: 3px; cursor: pointer; accent-color: var(--ink); }
	.typo-val { font-size: 0.68rem; color: var(--ink); width: 4.2rem; text-align: right; flex-shrink: 0; }
	.typo-reset { background: none; border: none; font-size: 0.85rem; color: var(--muted-fg); cursor: pointer; padding: 0 0 0 0.15rem; line-height: 1; flex-shrink: 0; }
	.typo-reset:hover { color: var(--ink); }
	.effect-pop-title {
		padding: 0.5rem 0.85rem 0.3rem;
		font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em;
		text-transform: uppercase; color: var(--muted-fg);
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
	.effect-tile:hover { background: var(--surface-2); border-color: var(--border); }
	.effect-tile.active { background: color-mix(in srgb, var(--accent) 14%, var(--paper)); border-color: var(--accent); }
	.effect-tile-icon { font-size: 1.25rem; line-height: 1; pointer-events: none; }
	.effect-tile-label { font-size: 0.67rem; font-weight: 600; color: var(--ink); white-space: nowrap; pointer-events: none; }
	.wiggle-slider-row {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.15rem 0.85rem 0.45rem;
	}
	.wiggle-slider-label {
		font-size: 0.68rem; font-weight: 600; color: var(--muted-fg); flex-shrink: 0;
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
		border-top: 1px solid var(--border); background: var(--surface-2);
	}
	.preview-label {
		font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em;
		text-transform: uppercase; color: var(--muted-fg); flex-shrink: 0;
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
		background: none; border: none; font-size: 0.72rem; color: var(--muted-fg);
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
	.emoji-sugg-btn:hover { background: var(--surface-2); }
	.ce-shortcode-suggestions { gap: 0.3rem; }
	.ce-sugg-btn { display: flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.45rem; font-size: 0.78rem; }
	.ce-sugg-img { width: 22px; height: 22px; object-fit: contain; flex-shrink: 0; }
	.ce-sugg-sc { color: var(--ink); font-family: inherit; font-size: 0.78rem; white-space: nowrap; }

	/* Text fx bar */
	/* ── Highlight (selection) menu — one elevated, rounded premium panel ── */
	.text-typo-bar {
		display: flex; gap: 0.55rem 1.25rem; padding: 0.75rem 1.1rem 0.55rem;
		background: var(--surface-2);
		border-top: 1px solid var(--border);
		border-radius: 18px 18px 0 0;
		box-shadow: 0 -8px 26px -16px rgba(0,0,0,0.28);
		flex-wrap: wrap; align-items: center;
	}
	/* Mobile "Aa" pill — typography sliders live behind it (channel parity) */
	.typo-aa-toggle {
		display: flex; align-items: center; gap: 0.15rem; flex-shrink: 0;
		padding: 0.34rem 0.7rem; border: 1px solid var(--border); border-radius: 999px;
		background: var(--paper); cursor: pointer; font-family: inherit;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.typo-aa-open { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.typo-aa-glyph { font-size: 0.8rem; font-weight: 700; line-height: 1; }
	.typo-aa-chevron { transition: transform 0.2s ease; opacity: 0.7; }
	.typo-aa-open .typo-aa-chevron { transform: rotate(180deg); }
	/* Renamed from .typo-sliders — that class already existed for another
	   popover (column layout) and its rules leaked into this wrapper,
	   stacking the slider rows into a screen-tall tower that shoved the
	   compose off-screen on desktop. display:contents makes the wrapper
	   invisible to layout there: the rows sit in the bar's own flex exactly
	   as they did before the Aa pill existed. */
	.aa-sliders { display: contents; }
	@media (max-width: 640px) {
		.aa-sliders {
			display: none; /* collapsed behind the Aa pill */
			flex: 1 1 100%;
			gap: 0.5rem 1rem;
		}
		.aa-sliders.aa-sliders-open { display: flex; flex-wrap: wrap; }
	}
	.typo-inline-row {
		display: flex; align-items: center; gap: 0.6rem; flex: 1 1 150px; min-width: 140px;
	}
	.typo-inline-label {
		font-size: 0.6rem; font-weight: 700; color: var(--muted-fg);
		text-transform: uppercase; letter-spacing: 0.07em; width: 2.7rem; flex-shrink: 0;
	}
	.typo-inline-range {
		flex: 1; height: 6px; -webkit-appearance: none; appearance: none;
		background: color-mix(in srgb, var(--ink) 16%, transparent);
		border-radius: 999px; cursor: pointer; outline: none; accent-color: var(--ink);
	}
	.typo-inline-range::-webkit-slider-thumb {
		-webkit-appearance: none; appearance: none;
		width: 18px; height: 18px; border-radius: 50%;
		background: var(--ink); border: 2.5px solid var(--paper);
		box-shadow: 0 1px 5px rgba(0,0,0,0.3); cursor: grab; transition: transform 0.1s ease;
	}
	.typo-inline-range::-webkit-slider-thumb:active { transform: scale(1.18); cursor: grabbing; }
	.typo-inline-range::-moz-range-thumb {
		width: 18px; height: 18px; border-radius: 50%;
		background: var(--ink); border: 2.5px solid var(--paper);
		box-shadow: 0 1px 5px rgba(0,0,0,0.3); cursor: grab;
	}
	.typo-inline-range::-moz-range-track {
		height: 6px; border-radius: 999px;
		background: color-mix(in srgb, var(--ink) 16%, transparent);
	}
	.typo-inline-reset {
		background: none; border: none; color: var(--muted-fg); font-size: 0.95rem;
		cursor: pointer; padding: 0 0.2rem; line-height: 1; flex-shrink: 0;
		transition: color 0.12s, transform 0.2s;
	}
	.typo-inline-reset:hover { color: var(--ink); transform: rotate(-40deg); }
	.typo-default-btn {
		padding: 0.34rem 0.75rem; border: 1px solid var(--border); border-radius: 999px;
		background: var(--paper); font-family: inherit; font-size: 0.62rem; font-weight: 700;
		color: var(--muted-fg); cursor: pointer; white-space: nowrap; flex-shrink: 0;
		text-transform: uppercase; letter-spacing: 0.05em;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.typo-default-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	/* Desktop: the dock is a no-op wrapper and the two bars stay in the
	   compose stack. The 640px block turns it into a docked sheet. */
	.text-fx-dock { display: contents; }
	/* Desktop: transparent too — the docked mobile rule turns it into the
	   scrolling half of the dialog, beside the fixed ⌫ key. */
	.text-fx-scroll { display: contents; }
	.text-fx-bar {
		display: flex; align-items: center; gap: 0.45rem;
		padding: 0.45rem 1.1rem 0.6rem; background: var(--surface-2);
		flex-wrap: wrap;
	}
	.text-fx-layer-toggle {
		display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;
		background: none; border: none; padding: 0.2rem 0.1rem; cursor: pointer;
		font-size: 0.72rem; font-weight: 600; color: var(--muted-fg); font-family: inherit;
		transition: color 0.15s;
	}
	.text-fx-layer-toggle:hover { color: var(--ink); }
	.text-fx-layer-on { color: var(--ink) !important; }
	.layer-toggle-track {
		position: relative; width: 2rem; height: 1.15rem; flex-shrink: 0;
		background: color-mix(in srgb, var(--ink) 18%, transparent); border-radius: 999px;
		transition: background 0.2s;
	}
	.text-fx-layer-on .layer-toggle-track { background: var(--accent); }
	.layer-toggle-knob {
		position: absolute; top: 0.17rem; left: 0.17rem;
		width: 0.81rem; height: 0.81rem;
		background: white; border-radius: 50%;
		transition: transform 0.2s cubic-bezier(0.3,1.4,0.5,1);
		box-shadow: 0 1px 3px rgba(0,0,0,0.22);
	}
	.text-fx-layer-on .layer-toggle-knob { transform: translateX(0.85rem); }
	.text-fx-divider { width: 1px; height: 1.3rem; background: var(--border); flex-shrink: 0; margin: 0 0.25rem; }
	.text-fx-btn {
		padding: 0.34rem 0.8rem; background: var(--paper); border: 1px solid var(--border);
		border-radius: 999px; font-size: 0.78rem; font-weight: 600; color: var(--ink);
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s, transform 0.12s;
	}
	.text-fx-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); transform: translateY(-1px); }
	.text-fx-btn:active { transform: translateY(0); }
	.text-fx-bar :global(.tfx) { animation-iteration-count: infinite !important; }
	.text-fx-close {
		background: var(--paper); border: 1px solid var(--border);
		align-self: flex-start; order: -1;
		width: 1.75rem; height: 1.75rem; border-radius: 50%; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		font-size: 0.78rem; color: var(--muted-fg); cursor: pointer; line-height: 1;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.text-fx-close:hover { background: var(--danger); color: var(--on-danger); border-color: var(--danger); }
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
			gap: 0.5rem;
			background: var(--paper);
		}
		.chat-header h1 { font-size: 1.1rem; }
		.message-list { padding: 0.75rem 0.875rem; }
		/* Mobile load perf: skip layout/paint of off-screen message rows; the
		   `auto` intrinsic-size makes each row remember its real height after
		   first paint so scrolling stays stable. Mobile-only (desktop hover
		   tooltip/action bar overflow a row and would be clipped). */
		.message {
			max-width: 88%;
			content-visibility: auto;
			contain-intrinsic-size: auto 60px;
		}
		/* 60px is a fair guess for a text bubble and a terrible one for a photo,
		   so a row that hasn't painted yet reserves ~5x too little and expands
		   hard the moment you scroll up into it. The scroll anchor absorbs that,
		   but each correction is a scrollTop write mid-flick, which on iOS costs
		   momentum. Guessing closer means fewer, smaller corrections. */
		.message.has-media { contain-intrinsic-size: auto 300px; }
		/* Oversized type stays always rendered — see the channel page. */
		.message.big-text { content-visibility: visible; contain-intrinsic-size: none; }
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

		/* Highlight menu: roomier, touch-friendly layout on phones */
		.text-typo-bar { padding: 0.85rem 0.95rem 0.6rem; gap: 0.5rem 1rem; }
		.typo-inline-row { flex: 1 1 100%; min-width: 0; }
		.typo-inline-label { width: 3rem; font-size: 0.64rem; }
		.typo-inline-range { height: 8px; }
		.typo-inline-range::-webkit-slider-thumb { width: 24px; height: 24px; }
		.typo-inline-range::-moz-range-thumb { width: 24px; height: 24px; }
		.typo-default-btn { padding: 0.45rem 0.9rem; font-size: 0.66rem; }
		.text-fx-bar { gap: 0.5rem; padding: 0.55rem 0.95rem 0.7rem; }
		.text-fx-btn { padding: 0.45rem 0.85rem; font-size: 0.82rem; }
		.text-fx-layer-toggle { font-size: 0.76rem; }
		.text-fx-close { width: 2.1rem; height: 2.1rem; }

		/* The docked highlight menu — see `_fxDocked` in the script.

		   The dialog is the LAST thing in the compose column (`order: 1`), so it
		   sits UNDER the message bar, in the strip the text input occupied. The
		   message bar then grows UPWARD as the type scales: .input-area's bottom
		   edge is pinned to .chat-wrap's, and the dialog is its last child, so a
		   taller compose takes its space from the conversation above and the
		   dialog underneath does not move. That is what keeps a slider still
		   under your finger — every control in here resizes the box right above
		   it, so the growth has to go the other way.

		   NOTHING here is a fixed or percentage HEIGHT. An earlier pass gave the
		   column `height: calc(100% - 7rem)` and it put the dialog below the
		   viewport on the native shell: the conversation renders inside
		   .fwd-host.conv-layer (absolute, top:0, height:100dvh) which sits
		   outside body.native-app .app-shell's notch padding, while .chat-wrap
		   is sized from --vvh on the assumption that padding still applies. Any
		   disagreement between those lands on a percentage-height child, and it
		   has nowhere to go but off the bottom. Sizes here are content-derived
		   with bounded maxima, so the worst case is a dialog that scrolls. */
		.input-area { display: flex; flex-direction: column; }
		/* Let the column be clamped to the chat rather than overrun it. At the
		   .chat-wrap level the message list's flex-basis is 0, so all of any
		   negative free space lands here; inside, only the dialog gives ground,
		   and it scrolls its own rows. Nothing ends up under the bottom edge. */
		.input-area.fx-dock { flex-shrink: 1; min-height: 0; }
		.input-area.fx-dock > * { flex-shrink: 0; }
		.input-area.fx-dock .text-fx-dock {
			display: flex;
			flex-direction: column;
			position: relative;   /* containing block for the ⌫ key */
			order: 1;
			flex-shrink: 1;
			min-height: 0;
			background: var(--surface-2);
			/* The dialog is at the bottom now — it covers the home indicator. */
			padding-bottom: env(safe-area-inset-bottom, 0px);
			/* Bounded twice on purpose: half the visible height, and a hard
			   26rem ceiling in case --vvh is ever nonsense on a platform we
			   can't measure. Past that the rows scroll. */
			max-height: min(calc(var(--vvh, 100dvh) * 0.5), 26rem);
			overflow: hidden;     /* .text-fx-scroll does the scrolling */
			animation: fx-menu-in 0.18s ease-out;
		}
		/* Only the ROWS scroll. The ⌫ key is outside this box, so it holds its
		   spot however far the rows are scrolled — "fixed in position" without
		   position:fixed and the viewport arithmetic that comes with it. */
		.input-area.fx-dock .text-fx-scroll {
			display: block;
			flex: 1 1 auto;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
			-webkit-overflow-scrolling: touch;
		}
		/* The delete key, in the expression keyboard's spot and at its size.
		   Every number here is read off .expr-del / .expr-panel in
		   ExpressionPicker.svelte — 4rem wide, a 3rem row plus its 8px of
		   padding and border tall, 14px corners, 25px glyph, 6px up from the
		   safe-area edge and 2px in from the side. Swapping between the
		   expression keyboard and this dialog should not move it. */
		.input-area.fx-dock .text-fx-del {
			position: absolute;
			right: 2px;
			bottom: calc(6px + env(safe-area-inset-bottom, 0px));
			width: 4rem;
			height: calc(3rem + 8px);
			box-sizing: border-box;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: 0;
			border-radius: 14px;
			background: var(--sidebar-bg, var(--paper));
			border: 1px solid var(--sidebar-border, var(--border));
			box-shadow:
				0 6px 16px rgba(0, 0, 0, 0.13),
				0 1px 4px rgba(0, 0, 0, 0.06),
				inset 0 1px 0 rgba(255, 255, 255, 0.4);
			color: var(--ink);
			cursor: pointer;
			z-index: 2;
		}
		.input-area.fx-dock .text-fx-del :global(.msi) { font-size: 25px; }
		/* Make room for it rather than letting rows run under it: a gutter down
		   the right of BOTH rows, so neither a wrapped effect button nor a
		   slider can reach the key's column in either state. */
		.input-area.fx-dock .text-typo-bar,
		.input-area.fx-dock .text-fx-bar { padding-right: calc(4rem + 0.6rem); }
		/* The last row of effects still has to clear the key's height. */
		.input-area.fx-dock .text-fx-bar { padding-bottom: 1rem; }
		@media (prefers-reduced-motion: reduce) {
			.input-area.fx-dock .text-fx-dock { animation: none; }
		}
		/* The dialog owns the safe area now, so the message bar above it must
		   not also reserve it — the same rule the docked pickers get. */
		.input-area.fx-dock .input-bar { padding-bottom: var(--compose-dock-gap); }
		/* The message bar takes its full height the moment the dialog opens —
		   expanding UPWARD, since its bottom is pinned to the dialog's top —
		   and then HOLDS it. A fixed height, not a max: scaling the type has to
		   move nothing at all, and the surest way to guarantee that is a box
		   whose size never depends on what is inside it. Two passes tried to
		   let it grow and keep the dialog still by arithmetic; both pushed the
		   sliders around. The text scales and scrolls inside (revealRange keeps
		   the highlighted words in view) and the layout simply doesn't react.
		   A plain length — no percentage, nothing resolved against an ancestor. */
		.input-area.fx-dock .compose-ce { height: 200px; max-height: none; }
		/* Formatting, repeated here at full size (see the markup note). Sized
		   like the effect pills beside them so the row reads as one set. */
		.text-fmt-btn {
			display: inline-flex; align-items: center; justify-content: center;
			width: 2.4rem; height: 2.4rem; flex-shrink: 0;
			background: var(--paper); border: 1px solid var(--border);
			border-radius: 999px; color: var(--ink); cursor: pointer; padding: 0;
		}
		.text-fmt-swatch {
			width: 1.9rem; height: 1.9rem; flex-shrink: 0; padding: 0;
			border: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
			border-radius: 999px; cursor: pointer;
		}
		.text-fmt-rainbow {
			background: linear-gradient(90deg, #ff0040, #ff8c00, #ffd500, #22c55e, #3b82f6, #a855f7);
		}
		/* An expression picker wants the same strip; it wins while it's open. */
		.input-area.picker-open .text-fx-dock { display: none; }
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
		background: var(--paper, var(--paper));
		border: 1.5px solid var(--border);
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
	.et-mix-plus { font-size: 0.85rem; color: var(--muted-fg); }
	.et-name {
		font-size: 0.72rem; color: var(--muted-fg); text-align: center; line-height: 1.3;
		text-transform: capitalize; max-width: 160px;
	}
	.et-shortcode { font-size: 0.75rem; color: var(--muted-fg); font-family: monospace; }

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
		background: var(--paper, var(--paper));
		border: 1.5px solid var(--border);
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
		font-size: 0.72rem; color: var(--muted-fg); text-align: center; line-height: 1.3;
		text-transform: capitalize; word-break: break-word;
	}
</style>
