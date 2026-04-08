/**
 * Client-side emoji semantic search.
 * - Worker: loads all-MiniLM-L6-v2 + embeddings matrix, runs inference + similarity search
 * - Main thread: sends query text, receives [{cp, score}] — zero ML computation here
 *
 * Usage:
 *   initSemanticSearch()          — call once on app load
 *   await searchEmoji('happy', 6) — returns [{ cp, score }] sorted desc
 *   isSemanticReady()             — true when worker + embeddings are both loaded
 */

let worker = null;
let workerReady = false;
let pending = new Map();  // id → resolve fn
let nextId = 0;
let readyListeners = [];

export function initSemanticSearch() {
	if (typeof window === 'undefined') return;  // SSR guard
	if (worker) return;

	worker = new Worker(
		new URL('./workers/emoji-embed.worker.js', import.meta.url),
		{ type: 'module' }
	);

	worker.onmessage = ({ data }) => {
		if (data.type === 'ready') {
			workerReady = true;
			_notifyReady();
		} else if (data.type === 'results') {
			const resolve = pending.get(data.id);
			if (resolve) { pending.delete(data.id); resolve(data.results ?? []); }
		}
		// errors are silently swallowed — callers handle empty results gracefully
	};
}

function _notifyReady() {
	readyListeners.forEach(fn => fn());
	readyListeners = [];
}

export function isSemanticReady() {
	return workerReady;
}

/** Call fn when worker is ready. fn() called immediately if already ready. */
export function onSemanticReady(fn) {
	if (isSemanticReady()) { fn(); return; }
	readyListeners.push(fn);
	initSemanticSearch(); // ensure started
}

/**
 * Search emoji by text — all computation in the worker, main thread receives results only.
 * @param {string} text
 * @param {number} topN
 * @returns {Promise<{cp: string, score: number}[]>}
 */
export function searchEmoji(text, topN = 10) {
	return new Promise((resolve) => {
		if (!worker || !workerReady) { resolve([]); return; }
		const id = nextId++;
		pending.set(id, resolve);
		setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve([]); } }, 10000);
		worker.postMessage({ type: 'search', text, topN, id });
	});
}

/** Convert a codepoint string (e.g. "1F600" or "1F468 200D 1F9B0") to emoji char */
export function cpToChar(cp) {
	return String.fromCodePoint(...cp.split(' ').map(p => parseInt(p, 16)));
}
