// Single owner of `/emoji-data.json` (~546 KB).
//
// Four surfaces need this file — EmojiPicker (groups + popular), EmojiKitchen
// (CLDR order + keyword text), TelegramEmojiPanel (canonical order + per-cp
// meta) and emoji-names (glyph → name). Each used to `fetch()` + `.json()` it
// on its own, so opening the picker could pay the ~546 KB parse up to four
// times. Worse, EmojiPicker asked for `cache: 'no-store'`, which skips the HTTP
// cache outright: every page load re-downloaded the whole file over the network
// before the first emoji could paint.
//
// Now there is one in-flight promise and one parsed object for the page. The
// derived indexes below are memoised on top of it, so each is built at most
// once no matter how many components ask.

let _data = null;
let _p = null;

/** Parsed emoji-data.json, or null if it hasn't resolved yet. Synchronous — use
 *  this to skip an `await` (and the microtask/paint it costs) on warm opens. */
export function getCachedEmojiData() {
	return _data;
}

export function loadEmojiData() {
	if (_data) return Promise.resolve(_data);
	if (!_p) {
		_p = fetch('/emoji-data.json', { cache: 'force-cache' })
			.then((r) => r.json())
			.then((d) => {
				_data = d;
				return d;
			})
			.catch((e) => {
				// Let a later call retry rather than caching the rejection.
				_p = null;
				throw e;
			});
	}
	return _p;
}

/** Warm the cache during idle time so the first picker open doesn't pay for the
 *  network round-trip. Safe to call repeatedly; no-ops once loaded/in flight. */
export function prewarmEmojiData() {
	if (_data || _p || typeof window === 'undefined') return;
	const go = () => loadEmojiData().catch(() => {});
	if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 });
	else setTimeout(go, 800);
}

// ── Derived indexes ────────────────────────────────────────────────────────
// Each walks the full item list once and is cached, so the second consumer of
// an index pays nothing.

let _names = null;
let _cldr = null;
let _byCp = null;

// The two consumers normalise codepoints slightly differently and each builds
// AND looks up with its own rule, so the two must not be merged: the Kitchen
// strips every `-fe0f` substring, while the Telegram panel only strips FE0F
// when it is a whole dash-delimited segment. Keeping both means an index is
// always keyed the same way as the lookups that read it.

/** Emoji Kitchen normalisation. */
export function cpKeyLoose(cp) {
	return String(cp || '').toLowerCase().replace(/-fe0f/g, '');
}

/** Telegram panel normalisation (FE0F only as a full segment). */
export function cpKeySeg(cp) {
	return String(cp || '').toLowerCase().replace(/(?:^|-)fe0f(?=-|$)/g, '');
}

function eachItem(d, fn) {
	for (const g of d.groups || []) for (const it of g.items || []) fn(it);
}

/** glyph → name (`emoji-names.js` extends this with ZWJ composites). */
export function buildNames(d) {
	if (_names) return _names;
	const map = {};
	eachItem(d, (it) => { map[it.e] = it.n; });
	_names = map;
	return map;
}

/** `{ order: Map<cpKey, idx>, terms: Map<cpKey, searchText> }` — Emoji Kitchen. */
export function buildCldr(d) {
	if (_cldr) return _cldr;
	const order = new Map(), terms = new Map();
	let i = 0;
	eachItem(d, (it) => {
		const k = cpKeyLoose(it.cp);
		order.set(k, i++);
		terms.set(k, [it.n || '', ...(it.kw || []), ...(it.st || [])].join(' ').toLowerCase());
	});
	_cldr = { order, terms };
	return _cldr;
}

/** `{ orderMap, metaByCp }` keyed by cpKey — Telegram panel sort + meta. */
export function buildByCp(d) {
	if (_byCp) return _byCp;
	const orderMap = {}, metaByCp = {};
	let i = 0;
	eachItem(d, (it) => {
		const k = cpKeySeg(it.cp);
		orderMap[k] = i++;
		metaByCp[k] = { name: it.n || '', kw: it.kw || [] };
	});
	_byCp = { orderMap, metaByCp };
	return _byCp;
}
