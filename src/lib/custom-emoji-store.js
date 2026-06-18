// Module-level cache for custom emoji, shared across all importers
let _map = null; // { [shortcode]: { url, shortcode } }
let _promise = null;

export function getCustomEmojiMap() {
	if (_map) return Promise.resolve(_map);
	// `no-store`: the picker fetches fresh, so the render map must too — otherwise
	// the browser/CDN can serve a stale list missing recently-added emotes, and
	// reactions using them render as ":shortcode:" even though the picker shows them.
	if (!_promise) _promise = fetch('/api/custom-emoji', { cache: 'no-store' })
		.then(r => r.json())
		.then(arr => {
			_map = {};
			for (const e of arr) _map[e.shortcode] = { url: e.url, shortcode: e.shortcode };
			return _map;
		})
		.catch(() => { _map = {}; return _map; });
	return _promise;
}

export function getCachedCustomEmojiMap() { return _map ?? {}; }

export function invalidateCustomEmojiCache() { _map = null; _promise = null; }

export function addToCustomEmojiCache(shortcode, url) {
	if (!_map) _map = {};
	_map[shortcode] = { url, shortcode };
}

export function removeFromCustomEmojiCache(shortcode) {
	if (_map) delete _map[shortcode];
}
