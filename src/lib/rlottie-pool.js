// Pool of rlottie workers. Animations are assigned round-robin so renders
// happen in parallel; frames return as transferable ImageBitmaps and are
// cached. Each worker is throttled to a small number of in-flight render
// requests so a flood of incoming work (e.g. scrolling 30 new cells into
// view) doesn't push frame-0 requests behind a 1800-deep queue.
//
// Cancellation: destroy(id) drops everything queued for that animation
// (waiting client-side) and removes any pending Promise resolvers, so the
// worker may still finish in-flight renders but the results are dropped.

// Mobile detection (coarse pointer = touch device). Mobile gets
// tighter caps everywhere: fewer workers (each WASM instance is
// ~310 KB resident), smaller per-worker inflight queue, and a smaller
// frame cache so we don't blow through phone-scale RAM with
// long-running animations.
const _isMobile = typeof window !== 'undefined'
	&& window.matchMedia?.('(pointer: coarse)').matches;

// Worker count is detected from `navigator.hardwareConcurrency` at spawn
// time (we can't read `navigator` at module-eval time because of SSR).
// Desktop cap is 12; mobile cap is 4 — phones have plenty of cores but
// thermal throttling + memory pressure make 12 workers actively worse
// once a few minutes pass.
const MAX_WORKERS = _isMobile ? 4 : 12;
const MIN_WORKERS = 2;
const MAX_INFLIGHT_PER_WORKER = _isMobile ? 2 : 4;
// Frame cache holds ImageBitmaps — at 96² × RGBA8 that's ~37 KB each;
// 8000 = ~290 MB worst case. Phones run out of RAM long before then.
const CACHE_LIMIT = _isMobile ? 2000 : 8000;
const MOUNT_TIMEOUT_MS = 20000;

let WORKER_COUNT = 4; // overwritten in spawnWorkers
let _workers = null;
let _readyPromise = null;
let _allReadyResolve = null;
let _nextId = 1;
const _animWorker = new Map();           // id -> worker index
const _mountResolvers = new Map();       // id -> { resolve, reject, timeout }
const _frameRequests = new Map();        // `${id}:${frame}` -> { resolve, promise }
const _frameCache = new Map();           // `${id}:${frame}` -> ImageBitmap
const _frameLastUse = new Map();         // `${id}:${frame}` -> timestamp

const _inflight = [];                    // _inflight[workerIdx] -> number of unanswered render requests
const _pending = [];                     // _pending[workerIdx] -> array of queued render msgs

function spawnWorkers() {
	const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
	WORKER_COUNT = Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, hw));
	console.log(`[rlottie-pool] spawning ${WORKER_COUNT} workers (hw: ${hw})`);
	_workers = Array.from({ length: WORKER_COUNT }, (_, i) => {
		_inflight[i] = 0;
		_pending[i] = [];
		const w = new Worker('/rlottie/rlottie-worker.js'); // classic worker
		w.addEventListener('message', (e) => onMessage(e.data));
		w.addEventListener('error', (e) => console.warn('[rlottie-worker]', e.message || e));
		return { worker: w, ready: false };
	});
}

// Exposed so other modules (e.g. the spritesheet rasteriser) can scale
// their own concurrency knobs to match the actual pool width.
export function workerCount() {
	return WORKER_COUNT;
}

function onMessage(m) {
	if (m?.type === 'ready') {
		const slot = _workers.find((s) => !s.ready);
		if (slot) slot.ready = true;
		if (_workers.every((s) => s.ready)) _allReadyResolve?.();
		return;
	}
	if (m?.type === 'mounted') {
		const r = _mountResolvers.get(m.id);
		if (r) {
			clearTimeout(r.timeout);
			r.resolve();
			_mountResolvers.delete(m.id);
		}
		return;
	}
	if (m?.type === 'mount_error') {
		const r = _mountResolvers.get(m.id);
		if (r) {
			clearTimeout(r.timeout);
			r.reject(new Error(m.message || 'rlottie mount error'));
			_mountResolvers.delete(m.id);
		}
		_animWorker.delete(m.id);
		console.warn('[rlottie-pool] mount_error', m.id, m.message);
		return;
	}
	if (m?.type === 'frame') {
		const workerIdx = _animWorker.get(m.id);
		if (workerIdx != null) {
			_inflight[workerIdx] = Math.max(0, _inflight[workerIdx] - 1);
			drainPending(workerIdx);
		}
		const key = `${m.id}:${m.frame}`;
		const req = _frameRequests.get(key);
		// Anim may have been destroyed mid-flight; drop the bitmap and don't cache it.
		if (!req && !_animWorker.has(m.id)) { try { m.bitmap.close(); } catch {} return; }
		_frameCache.set(key, m.bitmap);
		_frameLastUse.set(key, performance.now());
		evictIfOver();
		req?.resolve(m.bitmap);
		_frameRequests.delete(key);
		return;
	}
	if (m?.type === 'error') {
		console.warn('[rlottie-worker]', m.id, m.frame, m.message);
		// Free the inflight slot the failed render was holding, drain its
		// worker queue, and resolve the specific waiting frame request as
		// null so the spritesheet's Promise.all doesn't hang on it.
		if (m.id != null) {
			const workerIdx = _animWorker.get(m.id);
			if (workerIdx != null) {
				_inflight[workerIdx] = Math.max(0, _inflight[workerIdx] - 1);
				drainPending(workerIdx);
			}
			if (m.frame != null) {
				const key = `${m.id}:${m.frame}`;
				const req = _frameRequests.get(key);
				if (req) { req.resolve(null); _frameRequests.delete(key); }
			}
		}
	}
}

function drainPending(workerIdx) {
	while (_inflight[workerIdx] < MAX_INFLIGHT_PER_WORKER && _pending[workerIdx].length) {
		const msg = _pending[workerIdx].shift();
		if (!_animWorker.has(msg.id)) continue; // anim destroyed since queueing — drop
		_inflight[workerIdx]++;
		_workers[workerIdx].worker.postMessage(msg);
	}
}

function sendRender(workerIdx, msg) {
	if (_inflight[workerIdx] < MAX_INFLIGHT_PER_WORKER) {
		_inflight[workerIdx]++;
		_workers[workerIdx].worker.postMessage(msg);
	} else {
		_pending[workerIdx].push(msg);
	}
}

export function ensureReady() {
	if (_readyPromise) return _readyPromise;
	if (!_workers) spawnWorkers();
	_readyPromise = new Promise((resolve) => { _allReadyResolve = resolve; });
	return _readyPromise;
}

export async function mount(json, w, h) {
	await ensureReady();
	const id = _nextId++;
	const workerIdx = (id - 1) % WORKER_COUNT;
	_animWorker.set(id, workerIdx);
	const ready = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			_mountResolvers.delete(id);
			_animWorker.delete(id);
			reject(new Error(`rlottie mount timeout (id=${id})`));
		}, MOUNT_TIMEOUT_MS);
		_mountResolvers.set(id, { resolve, reject, timeout });
	});
	// Mount messages bypass the in-flight throttle so they're never starved.
	_workers[workerIdx].worker.postMessage({ type: 'mount', id, json, w, h });
	await ready;
	return id;
}

export function peekCachedFrame(id, frame) {
	const key = `${id}:${frame}`;
	const cached = _frameCache.get(key);
	if (cached) { _frameLastUse.set(key, performance.now()); return cached; }
	return null;
}

export function getFrame(id, frame) {
	const key = `${id}:${frame}`;
	const cached = _frameCache.get(key);
	if (cached) { _frameLastUse.set(key, performance.now()); return Promise.resolve(cached); }
	let req = _frameRequests.get(key);
	if (req) return req.promise;
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	req = { resolve, promise };
	_frameRequests.set(key, req);
	const workerIdx = _animWorker.get(id);
	if (workerIdx == null) { resolve(null); return promise; }
	sendRender(workerIdx, { type: 'render', id, frame });
	return promise;
}

export function destroy(id) {
	if (!id) return;
	const workerIdx = _animWorker.get(id);
	_animWorker.delete(id);
	// Drop queued render requests for this anim (cancels work we haven't sent yet).
	if (workerIdx != null) {
		_pending[workerIdx] = _pending[workerIdx].filter((m) => m.id !== id);
		_workers[workerIdx]?.worker.postMessage({ type: 'destroy', id });
	}
	// Drop pending promise resolvers; any frames still rendering will be dropped on arrival.
	for (const key of [..._frameRequests.keys()]) {
		if (key.startsWith(id + ':')) {
			_frameRequests.get(key)?.resolve(null);
			_frameRequests.delete(key);
		}
	}
	for (const key of [..._frameCache.keys()]) {
		if (key.startsWith(id + ':')) {
			try { _frameCache.get(key)?.close?.(); } catch {}
			_frameCache.delete(key);
			_frameLastUse.delete(key);
		}
	}
}

function evictIfOver() {
	if (_frameCache.size <= CACHE_LIMIT) return;
	const entries = [..._frameLastUse.entries()].sort((a, b) => a[1] - b[1]);
	const dropCount = Math.max(0, _frameCache.size - CACHE_LIMIT + 500);
	for (let i = 0; i < dropCount; i++) {
		const [key] = entries[i];
		try { _frameCache.get(key)?.close?.(); } catch {}
		_frameCache.delete(key);
		_frameLastUse.delete(key);
	}
}
