// Emoji hover-name machinery, shared by chat bubbles and the thread panel.
// wrapEmojiInText() is passed as `wrapEmoji` into createContentRenderer so
// every plain emoji renders inside an `.e-tip` span whose CSS pop shows the
// glyph + CLDR display name (ExpressionTip.svelte positions the pop and owns
// the floating EK/CE card). Names come from $lib/emoji-names' cached map —
// call loadEmojiNames() once per surface so lookups have data.
import { escapeHtml, EMOJI_RE_G } from '$lib/message-render.js';
import { getEmojiName } from '$lib/emoji-names.js';

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
export function wrapEmojiInText(text) {
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
