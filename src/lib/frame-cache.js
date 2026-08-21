// Persistent rasterised-frame cache (IndexedDB) — the browser equivalent of
// Telegram Desktop's on-disk sticker frame cache. Once an emote's frames have
// been rasterised by the Skia/rlottie worker, they're encoded and written here,
// so the NEXT session (or the next time this emote scrolls in) skips the whole
// vector render loop — the dominant per-emote CPU cost — and just re-fills the
// atlas from disk.
//
// Encoding, straight out of Telegram's playbook:
//   1. XOR-DELTA — each frame is XOR'd against the previous one. Animated
//      sticker frames are nearly identical, so the delta is almost all zeros.
//      Frame 0 is stored raw.
//   2. GZIP — the mostly-zero delta stream compresses ~10× vs raw RGBA via the
//      platform CompressionStream (no WASM dependency). A full 120-frame loop
//      that costs ~15 MB raw lands around ~1–2 MB on disk.
//
// Runs inside the render worker (indexedDB + CompressionStream are both
// available in a DedicatedWorkerGlobalScope). Every entry point is defensive:
// any failure (private mode, quota, missing CompressionStream on old Safari)
// degrades to "no cache", never an exception into the render path.

const DB_NAME = 'emote-frame-cache';
const STORE = 'frames';
const DB_VERSION = 1;
// Bump when the on-disk record shape or the encoding changes — old entries are
// then keyed under a different version prefix and never read (and pruned out).
// v2: invalidates entries written by the pre-warm before it got its own render
// sheet (a live bake could interleave and cross-contaminate frames).
const CACHE_VERSION = 3; // 3: picker entries baked to a 24 fps frame count
const MAX_ENTRIES = 500;          // LRU cap on the number of stored emotes
const PRUNE_SLACK = 60;           // prune down to MAX-SLACK so it's not every write

const _hasCompression =
	typeof CompressionStream !== 'undefined' &&
	typeof DecompressionStream !== 'undefined' &&
	typeof indexedDB !== 'undefined';

// A plain monotonic counter is enough for LRU ordering — we never need wall
// time, and it sidesteps needing a clock. Higher = more recently touched.
let _seq = 0;

// Cooperative yield so the encode never blocks the worker's render loop. A
// macrotask (setTimeout) lets any queued 'tick'/'raster' run before we resume.
const _yield = () => new Promise((r) => setTimeout(r, 0));

let _dbPromise = null;
function _db() {
	if (_dbPromise) return _dbPromise;
	_dbPromise = new Promise((resolve, reject) => {
		let req;
		try { req = indexedDB.open(DB_NAME, DB_VERSION); }
		catch (e) { reject(e); return; }
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				const os = db.createObjectStore(STORE, { keyPath: 'key' });
				os.createIndex('seq', 'seq');   // LRU pruning order
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	}).catch(() => null);
	return _dbPromise;
}

function _tx(db, mode) {
	const tx = db.transaction(STORE, mode);
	return { tx, store: tx.objectStore(STORE) };
}
function _reqP(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function _gzip(u8) {
	const cs = new CompressionStream('gzip');
	const w = cs.writable.getWriter();
	w.write(u8); w.close();
	return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function _gunzip(u8) {
	const ds = new DecompressionStream('gzip');
	const w = ds.writable.getWriter();
	w.write(u8); w.close();
	return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function _fullKey(key) { return CACHE_VERSION + '|' + key; }

// Slice one sl×sl frame out of the packed render sheet (width `sheetW`), at
// grid cell (col,row), into a fresh contiguous RGBA buffer.
function _sliceFrame(sheet, sheetW, sl, col, row) {
	const out = new Uint8ClampedArray(sl * sl * 4);
	const rowBytes = sl * 4;
	const x0 = col * sl, y0 = row * sl;
	for (let y = 0; y < sl; y++) {
		const src = ((y0 + y) * sheetW + x0) * 4;
		out.set(sheet.subarray(src, src + rowBytes), y * rowBytes);
	}
	return out;
}

// Store an emote's frames for `key` (= "url@px"). Takes the whole packed render
// SHEET (one Uint8ClampedArray captured with a single getImageData) plus its
// grid geometry, and does ALL the heavy work — per-frame slicing, XOR-delta,
// gzip — asynchronously, yielding between chunks so it never blocks the render
// loop. The caller does one cheap readback and hands off; encoding happens in
// the background.
export async function storeFrames(key, meta) {
	if (!_hasCompression) return;
	const { sl, N, duration, totalFrames, cols, sheetData, sheetW } = meta;
	if (!N || N < 2 || !sl || !sheetData) return;   // static/degenerate — not worth caching
	await _yield();                                  // get off the caller's stack immediately
	const frameBytes = sl * sl * 4;
	let delta;
	try {
		delta = new Uint8Array(N * frameBytes);
		let prev = null;
		for (let i = 0; i < N; i++) {
			const cur = _sliceFrame(sheetData, sheetW, sl, i % cols, (i / cols) | 0);
			const off = i * frameBytes;
			if (!prev) {
				delta.set(cur, off);
			} else {
				for (let j = 0; j < frameBytes; j++) delta[off + j] = cur[j] ^ prev[j];
			}
			prev = cur;
			if ((i & 7) === 7) await _yield();       // keep the render loop responsive
		}
	} catch { return; }

	let gz;
	try { gz = await _gzip(delta); } catch { return; }
	delta = null;

	try {
		const db = await _db(); if (!db) return;
		const { tx, store } = _tx(db, 'readwrite');
		store.put({ key: _fullKey(key), sl, N, duration, totalFrames, gz, seq: ++_seq });
		await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
	} catch { return; }
	_maybePrune();
}

// Load frames for `key`, but only if the stored slot size matches `expectSl`
// (the atlas geometry can change between builds — SUPERSAMPLE, dpr — and a
// mismatched slot would blit garbage). Returns { sl, N, duration, totalFrames,
// frames:[Uint8ClampedArray] } or null.
export async function loadFrames(key, expectSl) {
	if (!_hasCompression) return null;
	let rec;
	try {
		const db = await _db(); if (!db) return null;
		const { store } = _tx(db, 'readonly');
		rec = await _reqP(store.get(_fullKey(key)));
	} catch { return null; }
	if (!rec || rec.sl !== expectSl || !rec.gz) return null;

	let delta;
	try { delta = await _gunzip(rec.gz); } catch { return null; }

	const { sl, N } = rec;
	const frameBytes = sl * sl * 4;
	if (delta.length !== N * frameBytes) return null;
	const frames = new Array(N);
	let prev = null;
	for (let i = 0; i < N; i++) {
		const off = i * frameBytes;
		const cur = new Uint8ClampedArray(frameBytes);
		if (!prev) {
			cur.set(delta.subarray(off, off + frameBytes));
		} else {
			for (let j = 0; j < frameBytes; j++) cur[j] = delta[off + j] ^ prev[j];
		}
		frames[i] = cur;
		prev = cur;
	}
	_touch(rec.key); // fire-and-forget LRU bump
	return { sl, N, duration: rec.duration, totalFrames: rec.totalFrames, frames };
}

// Bump an entry's LRU position on read, without blocking the caller.
async function _touch(fullKey) {
	try {
		const db = await _db(); if (!db) return;
		const { tx, store } = _tx(db, 'readwrite');
		const rec = await _reqP(store.get(fullKey));
		if (rec) { rec.seq = ++_seq; store.put(rec); }
		void tx;
	} catch { /* best effort */ }
}

let _pruning = false;
async function _maybePrune() {
	if (_pruning) return;
	_pruning = true;
	try {
		const db = await _db(); if (!db) return;
		const { store } = _tx(db, 'readonly');
		const count = await _reqP(store.count());
		if (count <= MAX_ENTRIES) return;
		const toDrop = count - (MAX_ENTRIES - PRUNE_SLACK);
		// Delete the lowest-seq (least recently touched) entries.
		const { tx, store: wstore } = _tx(db, 'readwrite');
		const idx = wstore.index('seq');
		await new Promise((resolve) => {
			let dropped = 0;
			const cursorReq = idx.openCursor();
			cursorReq.onsuccess = () => {
				const cur = cursorReq.result;
				if (!cur || dropped >= toDrop) { resolve(); return; }
				cur.delete(); dropped++; cur.continue();
			};
			cursorReq.onerror = () => resolve();
			tx.oncomplete = resolve;
		});
	} catch { /* best effort */ }
	finally { _pruning = false; }
}

// Cheap "is this already cached?" — reads the key only, no decode. Used by the
// background pre-warm so it can skip emotes that are already on disk.
export async function hasFrames(key) {
	if (!_hasCompression) return false;
	try {
		const db = await _db(); if (!db) return false;
		const { store } = _tx(db, 'readonly');
		const k = await _reqP(store.getKey(_fullKey(key)));
		return k !== undefined;
	} catch { return false; }
}

export function frameCacheAvailable() { return _hasCompression; }
