// Noto Color Emoji loading.
//
// The emoji picker defaults to Noto rather than the system font, and the
// stylesheet link used to be injected by EmojiPicker's own effect — i.e. the
// first time the picker mounted. That put a Google Fonts CSS round-trip AND a
// multi-megabyte colour-emoji font download on the critical path of the first
// open, and because the face is served `display: swap`, every cell rendered in
// the fallback face first and then re-laid-out when the real one arrived. On a
// grid of a few hundred glyphs that swap is the visible "lags hard at first".
//
// So: warm it during idle time after the app boots, long before anyone taps the
// picker button. By the time the grid mounts the face is in the font cache and
// the first paint is already the right one.

const LINK_ID = 'noto-color-emoji-font';
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';
// One glyph is enough to pull the whole face — it is a single font file.
const PROBE = '16px "Noto Color Emoji"';

let _linked = false;
let _warmed = null;

/** Inject the stylesheet link. Idempotent, safe to call from anywhere. */
export function ensureNotoEmoji() {
	if (typeof document === 'undefined') return;
	if (_linked || document.getElementById(LINK_ID)) { _linked = true; return; }
	_linked = true;

	// Preconnect first: the CSS and the font file come from two different
	// origins, and without this the browser discovers the second only after
	// parsing the first — two serial round-trips instead of one.
	for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
		const pre = document.createElement('link');
		pre.rel = 'preconnect';
		pre.href = href;
		if (href.includes('gstatic')) pre.crossOrigin = 'anonymous';
		document.head.appendChild(pre);
	}

	const link = document.createElement('link');
	link.id = LINK_ID;
	link.rel = 'stylesheet';
	link.href = CSS_URL;
	document.head.appendChild(link);
}

/**
 * Actually fetch the face, not just its stylesheet.
 * Injecting the <link> only makes the font *available*; browsers defer the
 * download until something is laid out in it. `document.fonts.load()` forces
 * it now, so the picker never opens mid-download.
 * @returns {Promise<void>}
 */
export function loadNotoEmoji() {
	if (typeof document === 'undefined') return Promise.resolve();
	if (_warmed) return _warmed;
	ensureNotoEmoji();
	_warmed = (document.fonts?.load ? document.fonts.load(PROBE, '😀') : Promise.resolve())
		.then(() => {})
		.catch(() => { _warmed = null; });
	return _warmed;
}

/**
 * Warm it during idle time. Call once at app start.
 * Skipped when the user has chosen the system face — no reason to pull a large
 * font they will never see.
 */
export function prewarmNotoEmoji() {
	if (typeof window === 'undefined') return;
	let font = 'noto';
	try { font = localStorage.getItem('emoji-font') ?? 'noto'; } catch { /* default */ }
	if (font !== 'noto') return;
	const go = () => loadNotoEmoji();
	if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 });
	else setTimeout(go, 1200);
}
