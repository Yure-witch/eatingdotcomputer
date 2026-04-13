// Module-level cache for custom emoji, shared across all importers
let _map = null; // { [shortcode]: { url, shortcode } }
let _promise = null;

export function getCustomEmojiMap() {
	if (_map) return Promise.resolve(_map);
	if (!_promise) _promise = fetch('/api/custom-emoji')
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
