/**
 * Remembered intrinsic sizes for chat attachment images.
 *
 * Attachments are stored as `{ url, filename, mimetype, size }` (see
 * CHAT_STORAGE.md) — no width/height — so a freshly rendered <img> occupies
 * zero height until it decodes, then snaps to its real size and shoves the rest
 * of the timeline around. Scroll anchoring hides that from the reader, but it's
 * still a reflow, and inside the viewport you see it.
 *
 * So we learn the ratio the first time an image loads and keep it. Every later
 * render of that URL — scrolling back through history, reopening the chat,
 * a page reload — reserves the exact box up front, which also makes
 * `loading="lazy"` safe to use on these.
 *
 * Applying `aspect-ratio` before the load reproduces the post-load geometry
 * exactly: the bubble's `width: 100%; height: auto; max-width/max-height` rules
 * resolve against the declared ratio the same way they resolve against the
 * intrinsic one.
 */

const KEY = 'ec:imgdims:v1';
const MAX = 500; // insertion-ordered; oldest entries fall off the front

/** @type {Map<string, string>|null} */
let cache = null;

function load() {
	if (cache) return cache;
	cache = new Map();
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) cache.set(k, v);
	} catch { /* private mode / corrupt entry — start empty */ }
	return cache;
}

let flushT = 0;
function flush() {
	clearTimeout(flushT);
	flushT = setTimeout(() => {
		try {
			while (cache.size > MAX) cache.delete(cache.keys().next().value);
			localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(cache)));
		} catch { /* quota — the in-memory map still works for this session */ }
	}, 1000);
}

/**
 * Svelte action for attachment <img>/<video>: reserve the known box before the
 * bytes arrive, and record the real one once they do.
 *
 * @param {HTMLImageElement|HTMLVideoElement} node
 */
export function reserveAspect(node) {
	const isVideo = node.tagName === 'VIDEO';
	const known = load().get(node.getAttribute('src') ?? '');
	if (known) node.style.aspectRatio = known;

	function record() {
		const w = isVideo ? node.videoWidth : node.naturalWidth;
		const h = isVideo ? node.videoHeight : node.naturalHeight;
		if (!w || !h) return;
		const ratio = `${w} / ${h}`;
		node.style.aspectRatio = ratio;
		const src = node.getAttribute('src') ?? '';
		if (src && load().get(src) !== ratio) { cache.delete(src); cache.set(src, ratio); flush(); }
	}

	const evt = isVideo ? 'loadedmetadata' : 'load';
	node.addEventListener(evt, record);
	// Cached images can already be complete before the action runs.
	if (!isVideo && /** @type {HTMLImageElement} */ (node).complete) record();

	return { destroy() { node.removeEventListener(evt, record); } };
}
