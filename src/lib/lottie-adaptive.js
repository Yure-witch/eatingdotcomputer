/**
 * Tint helper for Telegram "adaptive" emoji packs.
 *
 * Telegram marks adaptive sticker sets with `text_color: true` on the
 * StickerSet. Every fill/stroke in those Lotties is shipped as pure
 * white ([1,1,1,1]) — a sentinel telling the client to render the
 * emoji in the surrounding text color. Our renderer doesn't know about
 * Telegram's convention, so we walk the Lottie ourselves and swap any
 * near-white fill/stroke for a caller-supplied color (the current
 * `--ink`, dark on light themes; light on dark themes).
 *
 * Operates in place AND returns the same object so callers can chain.
 * Safe to call on a non-adaptive Lottie — only matches white, so a
 * non-white-painted file passes through untouched.
 *
 * The recursion handles:
 *   - layers[].shapes[]                            (shape layers)
 *   - shape groups (ty === 'gr') → it[]            (nested shapes)
 *   - assets[].layers[].shapes[]                   (precomps)
 *   - both static (c.a === 0) and animated (c.a === 1) color tracks
 */

const WHITE_THRESHOLD = 0.99;

function isWhite(color) {
	return Array.isArray(color)
		&& color.length >= 3
		&& color[0] >= WHITE_THRESHOLD
		&& color[1] >= WHITE_THRESHOLD
		&& color[2] >= WHITE_THRESHOLD;
}

function paint(color, ink) {
	color[0] = ink[0];
	color[1] = ink[1];
	color[2] = ink[2];
}

function tintColorProp(c, ink, whiteOnly) {
	if (!c || !c.k) return;
	if (Array.isArray(c.k) && typeof c.k[0] === 'number') {
		if (!whiteOnly || isWhite(c.k)) paint(c.k, ink);
		return;
	}
	if (Array.isArray(c.k)) {
		for (const kf of c.k) {
			if (Array.isArray(kf?.s) && (!whiteOnly || isWhite(kf.s))) paint(kf.s, ink);
			if (Array.isArray(kf?.e) && (!whiteOnly || isWhite(kf.e))) paint(kf.e, ink);
		}
	}
}

function tintShapes(shapes, ink, whiteOnly) {
	if (!Array.isArray(shapes)) return;
	for (const s of shapes) {
		if (!s) continue;
		if (s.ty === 'gr' && Array.isArray(s.it)) tintShapes(s.it, ink, whiteOnly);
		else if (s.ty === 'fl' || s.ty === 'st') tintColorProp(s.c, ink, whiteOnly);
	}
}

function tintLayers(layers, ink, whiteOnly) {
	if (!Array.isArray(layers)) return;
	for (const l of layers) {
		if (l && Array.isArray(l.shapes)) tintShapes(l.shapes, ink, whiteOnly);
	}
}

// `whiteOnly` (default false) tints EVERY fill/stroke to `ink`. Telegram
// `text_color` packs are monochrome and meant to render entirely in the
// text colour, but not all of them ship the pure-white sentinel — some have
// a black (or otherwise coloured) base, which a white-only pass leaves
// untouched (→ black emotes on a dark theme). Since this is only ever called
// for confirmed adaptive packs, tinting all fills is correct. Pass
// whiteOnly:true to restore the conservative white-sentinel-only behaviour.
export function tintLottieAdaptive(lottie, ink, whiteOnly = false) {
	if (!lottie || !Array.isArray(ink) || ink.length < 3) return lottie;
	tintLayers(lottie.layers, ink, whiteOnly);
	if (Array.isArray(lottie.assets)) {
		for (const a of lottie.assets) {
			if (a && Array.isArray(a.layers)) tintLayers(a.layers, ink, whiteOnly);
		}
	}
	return lottie;
}

/**
 * Parse a CSS color (#rrggbb, #rgb, rgb(...), or "r,g,b") into a
 * Lottie-ready [r,g,b] triple in [0,1]. Returns null if it can't
 * be parsed, so callers can fall back without crashing.
 */
export function parseInkColor(css) {
	if (!css || typeof css !== 'string') return null;
	const s = css.trim();
	let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
	if (m) return [parseInt(m[1] + m[1], 16) / 255, parseInt(m[2] + m[2], 16) / 255, parseInt(m[3] + m[3], 16) / 255];
	m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
	if (m) return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
	m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
	if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
	m = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(s);
	if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
	return null;
}
