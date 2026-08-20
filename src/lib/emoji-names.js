// Lazy-loads emoji names from the shared emoji-data.json index.
// Module-level so the map is shared across all importers.
import { loadEmojiData, buildNames } from '$lib/emoji-data.js';

let map = null;
let promise = null;

export function loadEmojiNames() {
	if (map) return Promise.resolve(map);
	if (!promise) promise = loadEmojiData()
		.then(data => {
			// buildNames is memoised in the shared module, so the glyph -> name
			// walk happens once per page no matter who asks. Copy before adding
			// the ZWJ composites below so we don't mutate the shared index.
			map = { ...buildNames(data) };
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
