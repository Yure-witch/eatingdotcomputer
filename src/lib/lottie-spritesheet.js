// Pre-rasterised Lottie frame cache.
//
// Each TGS URL is rasterised once via the rlottie worker pool — the same
// renderer Telegram itself uses for animated emoji and stickers, so TGS
// feature coverage is correct by construction. Frames come back from the
// pool as ImageBitmaps; we immediately `createImageBitmap()` to take an
// independent copy that we own. The rlottie animation is destroyed as
// soon as all frames have settled, so the pool's LRU cache can evict
// freely without invalidating our cells.
//
// Two levels of progress reporting so cells never sit blank:
//   - `entry.frame0Ready` resolves as soon as frame 0 is captured (or
//     timed out). Acquirers wait on this before drawing.
//   - `entry.frames` is allocated up front as a sparse array; individual
//     slots fill in as frames arrive. Cells paint `frames[i]` if it exists
//     and fall back to `frames[0]` while later frames are still loading.
//
// Each frame is raced against a timeout — if a worker hangs on a
// malformed animation, the slot resolves null instead of stalling forever.

import {
	mount as rlottieMount,
	getFrame as rlottieGetFrame,
	destroy as rlottieDestroy,
	ensureReady as rlottieEnsureReady,
	workerCount as rlottieWorkerCount
} from './rlottie-pool.js';

// Default when a caller doesn't say what size it needs. Everything that
// cares passes one — see rasterSizeFor.
const TARGET_PX = 48;

// Rasterise at (or just above) the size the caller will DISPLAY at.
//
// This module used to mount every animation at a hardcoded 48×48 and hand
// those frames to every consumer, so anything bigger got an upscale: a
// chat-sent emote at 112 device px was being blown up from 48, which is
// most of why the CPU engine looked soft next to the Skia one. rlottie will
// render at whatever size it's asked for — 48 was a memory budget, not a
// limit.
//
// Sizes snap UP to a small ladder rather than tracking px exactly. Snapping
// up means the atlas always DOWN-scales (crisp, and a free bit of
// supersampling); the ladder means a session holds a handful of distinct
// caches instead of one per unique cell size. The cap matters: frames are
// held as ImageBitmaps until the consumer packs them, so cost is px² × 4 ×
// frames, and a phone has no room for a 256px loop.
const SIZE_STEPS = [48, 64, 96, 128, 192, 256];
// Touch points / coarse pointer rather than the UA: iPadOS Safari and a
// Capacitor WKWebView both report a macOS UA, so the regex alone let exactly
// the wrong devices rasterise at 256px — 4× the pixels per frame, feeding the
// CPU atlas that is now the default engine.
const _isMobileUA = typeof navigator !== 'undefined'
	&& /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const _isTouch = (() => {
	if (typeof navigator === 'undefined') return false;
	if ((navigator.maxTouchPoints || 0) > 1) return true;
	try { return !window.matchMedia('(pointer: fine)').matches; } catch { return false; }
})();
const MAX_RASTER_PX = (_isMobileUA || _isTouch) ? 128 : 256;
export function rasterSizeFor(px) {
	const want = Math.max(1, Math.round(px || TARGET_PX));
	for (const step of SIZE_STEPS) {
		if (step > MAX_RASTER_PX) break;
		if (want <= step) return step;
	}
	return Math.min(MAX_RASTER_PX, SIZE_STEPS[SIZE_STEPS.length - 1]);
}
const _key = (url, px) => url + '@' + px;
// 2× worker count means each worker tends to be juggling two animations'
// frames at once — plenty to keep the worker busy while still giving
// frame 0 of new acquires a fair queue slot. Set lazily after the pool
// has spawned so we can read the detected worker count.
let MAX_CONCURRENT = 8;
let _concurrencyTuned = false;
const FRAME_TIMEOUT_MS = 15000;

const _cache = new Map(); // `url@px` -> entry
const _queue = [];
let _active = 0;

function withSlot(taskFn) {
	return new Promise((resolve, reject) => {
		_queue.push({ taskFn, resolve, reject });
		drain();
	});
}

function drain() {
	while (_active < MAX_CONCURRENT && _queue.length) {
		const { taskFn, resolve, reject } = _queue.shift();
		_active++;
		Promise.resolve()
			.then(taskFn)
			.then(resolve, reject)
			.finally(() => {
				_active--;
				drain();
			});
	}
}

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((r) => setTimeout(() => r(null), ms))
	]);
}

// Kick off worker pool initialisation early (e.g. when the picker opens)
// so the first emoji doesn't pay the worker-spawn + WASM-load cold start.
// Once the pool is up, scale our rasterisation concurrency cap to the
// number of workers it spawned.
export function prewarm() {
	rlottieEnsureReady().then(() => {
		if (_concurrencyTuned) return;
		const wc = rlottieWorkerCount();
		// One concurrent rasterisation per ~2 workers. Each rasterisation
		// queues ~90 frame requests into the pool, so going wider just
		// piles work onto the same workers AND blasts the main thread
		// with createImageBitmap copies. Smaller is smoother when the
		// picker first opens and ~50 cells go visible at once.
		MAX_CONCURRENT = Math.max(4, Math.ceil(wc / 2));
		_concurrencyTuned = true;
		console.log(`[sprite] concurrency cap set to ${MAX_CONCURRENT}`);
		drain(); // wake any queued rasterisations against the bumped cap
	}).catch(() => {});
}

// Acquire (or refcount-bump) the rasterised entry for a URL. Resolves
// once frame 0 is ready (or has timed out) — remaining frames continue
// filling in `entry.frames` asynchronously after this resolves.
export async function acquire(url, data, px = TARGET_PX, maxFps = 0) {
	const sizePx = rasterSizeFor(px);
	const key = _key(url, sizePx);
	let entry = _cache.get(key);
	if (entry) {
		entry.refcount++;
		await entry.frame0Ready;
		return entry;
	}

	let resolveFrame0;
	const frame0Ready = new Promise((r) => { resolveFrame0 = r; });

	entry = {
		refcount: 1,
		frames: null,
		totalFrames: 0,
		fps: 60,
		duration: 1,
		sizePx,
		pending: null,
		frame0Ready
	};
	_cache.set(key, entry);

	entry.pending = withSlot(async () => {
		const sourceFrames = Math.max(1, (data.op || 60) - (data.ip || 0));
		const sourceFps = data.fr || 60;
		// Stride to the caller's target rate — Telegram's `framesPerUpdates`
		// (their `shouldLimitFps` halves the rate for keyboard-sized stickers).
		// Without a target this keeps the old behaviour: 60 fps TGS look
		// identical to humans at 30, and Telegram's own web client renders at
		// 30 too. Striding halves both rasterisation work and bitmap memory.
		const stride = maxFps > 0
			? Math.max(1, Math.round(sourceFps / maxFps))
			: (sourceFps >= 60 ? 2 : 1);
		const totalFrames = Math.max(1, Math.floor(sourceFrames / stride));
		const fps = sourceFps / stride;
		const duration = totalFrames / fps;
		const frames = new Array(totalFrames).fill(null);
		entry.frames = frames;
		entry.totalFrames = totalFrames;
		entry.fps = fps;
		entry.duration = duration;
		entry.stride = stride;
		const shortUrl = url.split('/').slice(-2).join('/');
		const t0 = performance.now();

		let animId;
		try {
			animId = await rlottieMount(JSON.stringify(data), sizePx, sizePx);
		} catch (e) {
			console.warn(`[sprite] mount failed for ${shortUrl}:`, e.message || e);
			resolveFrame0();
			return;
		}

		// Fan out all frame requests. Each one is raced against a timeout
		// so a hung worker can't stall the whole acquire.
		//
		// We push the LAST frame first because for "intro" emoji (kiss,
		// starry-eyed, etc.) frame 0 is blank and only the final frame is
		// the recognisable resting pose. Pool workers process FIFO, so
		// requesting it first means it arrives first and cells can show a
		// usable still immediately. We resolve frame0Ready on whichever of
		// (last, 0) arrives first.
		const lastIdx = totalFrames - 1;
		// `slot` is the stored index (0..totalFrames-1). The actual rlottie
		// frame we render is slot * stride, so a stride-2 stored frame 47
		// is the source's frame 94.
		const fireFrame = (slot) => withTimeout(rlottieGetFrame(animId, slot * stride), FRAME_TIMEOUT_MS)
			.then(async (bm) => {
				if (bm) {
					try {
						frames[slot] = await createImageBitmap(bm);
					} catch {}
				}
				if (slot === lastIdx || slot === 0) resolveFrame0();
			});

		const framePromises = [];
		framePromises.push(fireFrame(lastIdx));
		for (let i = 0; i < totalFrames; i++) {
			if (i === lastIdx) continue;
			framePromises.push(fireFrame(i));
		}

		await Promise.all(framePromises);
		// In case frame 0 timed out (got `null`) without resolving above.
		resolveFrame0();

		// Diagnostic: how many of the requested frames actually populated?
		// If this is well below totalFrames, rlottie is silently dropping
		// renders for this asset and we should look at it.
		const filled = frames.reduce((n, f) => n + (f ? 1 : 0), 0);
		const elapsed = Math.round(performance.now() - t0);
		if (filled < totalFrames) {
			console.warn(`[sprite] ${shortUrl}: ${filled}/${totalFrames} frames in ${elapsed}ms`);
		}

		try { rlottieDestroy(animId); } catch {}
	}).catch((e) => {
		console.warn('[sprite] rasterise error', e);
		resolveFrame0();
		_cache.delete(key);
	});

	await entry.frame0Ready;
	return entry;
}

export function release(url, px = TARGET_PX) {
	const key = _key(url, rasterSizeFor(px));
	const entry = _cache.get(key);
	if (!entry) return;
	entry.refcount--;
	if (entry.refcount > 0) return;
	if (entry.frames) {
		for (const bm of entry.frames) {
			try { bm?.close?.(); } catch {}
		}
	}
	_cache.delete(key);
}

// Peek at the cached entry (frames + metadata) without bumping the refcount.
// Returns null if not yet acquired / still rasterising.
export function peek(url, px = TARGET_PX) {
	const entry = _cache.get(_key(url, rasterSizeFor(px)));
	return entry && entry.frames ? entry : null;
}
