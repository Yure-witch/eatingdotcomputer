// Lazy-loads emoji names from the existing emoji-data.json (browser-cached).
// Module-level so the map is shared across all importers.
let map = null;
let promise = null;

export function loadEmojiNames() {
	if (map) return Promise.resolve(map);
	if (!promise) promise = fetch('/emoji-data.json', { cache: 'force-cache' })
		.then(r => r.json())
		.then(data => {
			map = {};
			for (const g of data.groups) for (const item of g.items) map[item.e] = item.n;
			// Register ZWJ composites whose skin-toned variants use different codepoints
			map['\u{1FAF1}\u200D\u{1FAF2}'] = 'handshake';
			map['\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}'] = 'people holding hands';
			map['\u{1F469}\u200D\u{1F91D}\u200D\u{1F468}'] = 'woman and man holding hands';
			map['\u{1F468}\u200D\u{1F91D}\u200D\u{1F468}'] = 'men holding hands';
			map['\u{1F469}\u200D\u{1F91D}\u200D\u{1F469}'] = 'women holding hands';
			map['\u{1F9D1}\u200D\u2764\uFE0F\u200D\u{1F9D1}'] = 'couple with heart';
			map['\u{1F9D1}\u200D\u2764\uFE0F\u200D\u{1F48B}\u200D\u{1F9D1}'] = 'kiss';
			return map;
		});
	return promise;
}

// Synchronous lookup — returns null if the map hasn't loaded yet.
export function getEmojiName(char) {
	return map?.[char] ?? null;
}
