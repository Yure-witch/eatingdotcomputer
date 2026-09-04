// Emoji hover-name machinery, shared by chat bubbles and the thread panel.
// wrapEmojiInText() is passed as `wrapEmoji` into createContentRenderer so
// every plain emoji renders inside an `.e-tip` span whose CSS pop shows the
// glyph + CLDR display name (ExpressionTip.svelte positions the pop and owns
// the floating EK/CE card). Names come from $lib/emoji-names' cached map —
// call loadEmojiNames() once per surface so lookups have data.
import { escapeHtml, EMOJI_RE_G } from '$lib/message-render.js';
import { getEmojiName } from '$lib/emoji-names.js';
import { tgEntry, tgcEntry, isStaticPack } from '$lib/telegram-emoji-store.js';

const _isEmojiSeg = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
const _segmenter = new Intl.Segmenter();
// Strip skin-tone modifiers, ZWJ, and variation selectors to get base emoji
const MODIFIER_STRIP_RE = /[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu;
const SKIN_TONE_NAMES = {
	'\u{1F3FB}': 'light skin tone', '\u{1F3FC}': 'medium-light skin tone',
	'\u{1F3FD}': 'medium skin tone', '\u{1F3FE}': 'medium-dark skin tone', '\u{1F3FF}': 'dark skin tone'
};
const SKIN_STRIP_RE = /[\u{1F3FB}-\u{1F3FF}]/gu;
export function emojiDisplayName(g) {
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
// Friendly label for a Telegram reaction key — the reaction-chip tooltip
// ("reacted with …") otherwise falls back to the raw '[tg:…]' / '[tgc:…]'
// token string. Returns null for non-Telegram keys so callers can chain
// their existing fallbacks. Needs loadTelegramEmoji()/loadCustomPacks()
// to have resolved (both chat pages do this on mount).
/**
 * Which picker menu an expression came from — for the reaction chip tooltip.
 *
 * ExpressionTip shows this on hover for expressions inside a MESSAGE, but it is
 * suppressed inside a reaction chip (two stacked hover cards over one small
 * chip). The chip's own tooltip carries the same information instead, and this
 * is where the wording is kept identical to the card's: "Emotes" for static
 * packs, "Animated emotes" for animated ones, pack title underneath.
 *
 * Returns null for a plain unicode emoji — it came from no menu in particular,
 * and the tooltip already names the glyph.
 *
 * @param {string} token — the reaction key
 * @returns {string|null}
 */
export function expressionSource(token) {
	if (typeof token !== 'string') return null;
	// Icons and wording match ExpressionTip's own meta lines exactly — this is
	// the same fact shown in a different card, and two vocabularies for it
	// would read as two different things.
	if (/^\[ek:/i.test(token)) return { msi: 'blender', label: 'Emoji Kitchen' };

	let m = /^\[ce:([a-zA-Z0-9_-]+)\]$/.exec(token);
	if (m) return { msi: 'sentiment_very_satisfied', label: `Custom emotes · :${m[1]}:` };

	m = /^\[tgc:([A-Za-z0-9_]+):(\d+)\]$/.exec(token);
	if (m) {
		const short = m[1];
		const pack = tgcEntry(m[2])?.packTitle ?? short;
		const isStatic = isStaticPack(short);
		return {
			msi: isStatic ? 'sentiment_very_satisfied' : 'animated_images',
			label: `${isStatic ? 'Emotes' : 'Animated emotes'} · ${pack}`
		};
	}

	m = /^\[tg:([0-9a-f-]+)\]$/i.exec(token);
	if (m) {
		const cat = tgEntry(m[1].toLowerCase())?.cat;
		return { msi: 'animated_images', label: cat ? `Animated emotes · ${cat}` : 'Animated emotes' };
	}
	return null;
}

export function tgReactionName(token) {
	if (typeof token !== 'string') return null;
	let m = /^\[tg:([0-9a-f-]+)\]$/i.exec(token);
	if (m) {
		const entry = tgEntry(m[1].toLowerCase());
		if (!entry) return 'a Telegram emoji';
		const name = emojiDisplayName(entry.e) ?? entry.e;
		return `${name} (${entry.cat})`;
	}
	m = /^\[tgc:([A-Za-z0-9_]+):(\d+)\]$/.exec(token);
	if (m) {
		const entry = tgcEntry(m[2]);
		const pack = entry?.packTitle ?? m[1];
		const name = entry?.alt ? (emojiDisplayName(entry.alt) ?? entry.alt) : null;
		return name ? `${name} (${pack})` : `an emote from ${pack}`;
	}
	return null;
}
export function wrapEmojiInText(text) {
	const segs = [..._segmenter.segment(text)];
	return segs.map(seg => {
		const g = seg.segment;
		if (EMOJI_RE_G.test(g)) {
			const esc = escapeHtml(g);
			const name = emojiDisplayName(g);
			const nameHtml = name ? `<span class="e-tip-name">${escapeHtml(name)}</span>` : '';
			// Meta line mirrors the expression-picker tab this comes from —
			// the Emoji tab's `mood` Material icon (same pattern as the
			// EK / custom-emote / Telegram cards in ExpressionTip.svelte).
			const metaHtml = '<span class="e-tip-meta"><span class="msi">mood</span> Emoji</span>';
			return `<span class="e-tip">${esc}<span class="e-tip-pop"><span class="e-tip-char">${esc}</span>${nameHtml}${metaHtml}</span></span>`;
		}
		return escapeHtml(g);
	}).join('');
}
