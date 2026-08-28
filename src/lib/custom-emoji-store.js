// Module-level cache for custom emoji, shared across all importers.
//
// The map has two layers. The BASE layer is the bundled WeChat emoticon set
// (see wechat-emoji.js) — 114 built-ins whose art ships in `static/`, so they
// are present synchronously from module load and every `[ce:wc_…]` token
// resolves on first paint with no fetch. Layered on top are the class's own
// uploads from `/api/custom-emoji`. Uploads are applied LAST, so if an
// instructor ever uploads a `wc_`-prefixed shortcode their file wins — the
// database is the authority for anything it actually holds.
import { WECHAT_EMOJI } from './wechat-emoji.js';

/** Fresh copy of the built-in layer. Never hand out the same object twice —
 *  `addToCustomEmojiCache` mutates the map in place. */
function baseMap() {
	const m = {};
	for (const e of WECHAT_EMOJI) m[e.shortcode] = { url: e.url, shortcode: e.shortcode };
	return m;
}

let _map = baseMap(); // { [shortcode]: { url, shortcode } }
let _promise = null;
// Tracks whether the UPLOADS layer has been fetched. Separate from `_map`
// being non-empty, which the built-ins now guarantee from the start — using
// emptiness as the "not loaded yet" signal would mean uploads never load.
let _loaded = false;

/** Have the class's uploaded emotes been merged in yet? */
export function isCustomEmojiLoaded() { return _loaded; }

export function getCustomEmojiMap() {
	if (_loaded) return Promise.resolve(_map);
	// `no-store`: the picker fetches fresh, so the render map must too — otherwise
	// the browser/CDN can serve a stale list missing recently-added emotes, and
	// reactions using them render as ":shortcode:" even though the picker shows them.
	if (!_promise) _promise = fetch('/api/custom-emoji', { cache: 'no-store' })
		.then(r => r.json())
		.then(arr => {
			_map = baseMap();
			for (const e of arr) _map[e.shortcode] = { url: e.url, shortcode: e.shortcode };
			_loaded = true;
			return _map;
		})
		.catch(() => { _loaded = true; return _map; });
	return _promise;
}

export function getCachedCustomEmojiMap() { return _map; }

export function invalidateCustomEmojiCache() {
	// Drops the uploads layer only — the built-ins have no server to go stale
	// against, and clearing them would blank every WeChat emote already on
	// screen until the refetch lands.
	_map = baseMap();
	_promise = null;
	_loaded = false;
}

export function addToCustomEmojiCache(shortcode, url) {
	_map[shortcode] = { url, shortcode };
}

export function removeFromCustomEmojiCache(shortcode) {
	delete _map[shortcode];
}
