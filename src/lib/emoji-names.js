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
			return map;
		});
	return promise;
}

// Synchronous lookup — returns null if the map hasn't loaded yet.
export function getEmojiName(char) {
	return map?.[char] ?? null;
}
