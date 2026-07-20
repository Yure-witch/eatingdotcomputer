// Shared "recently used" across ALL expression types — emoji, Emoji Kitchen
// mixes, custom emotes, Telegram static + animated stickers. Every insert
// that flows through ExpressionPicker records here (regardless of surface:
// chat compose, DMs, reactions, assignment fields), and the picker's Recent
// tab replays items through the same callbacks. localStorage-backed, newest
// first, deduped so re-using something just moves it to the front.
//
// Item shapes ({ t, v }):
//   { t: 'emoji', v: '😀', f: 'noto' | 'system' }   (f = font it was sent in)
//   { t: 'ek',    v: '[ek:d36:cp:cp]' }                      (kitchen token)
//   { t: 'ce',    v: { shortcode, url } }                    (custom emote)
//   { t: 'tg',    v: { custom, mode, alt, short, id, cp } }  (telegram)
const KEY = 'expr-recent-v1';
const CAP = 40;

export function exprRecentKey(it) {
	if (it.t === 'emoji') return 'e:' + it.v;
	if (it.t === 'ek') return 'k:' + it.v;
	if (it.t === 'ce') return 'c:' + (it.v?.shortcode || '');
	if (it.t === 'tg') return 't:' + (it.v?.custom ? `${it.v.short}:${it.v.id}` : it.v?.cp);
	return JSON.stringify(it);
}

export function getExprRecents() {
	try {
		const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

export function addExprRecent(it) {
	try {
		const k = exprRecentKey(it);
		const arr = getExprRecents().filter((x) => exprRecentKey(x) !== k);
		arr.unshift(it);
		localStorage.setItem(KEY, JSON.stringify(arr.slice(0, CAP)));
	} catch { /* private mode etc. — recents are best-effort */ }
}
