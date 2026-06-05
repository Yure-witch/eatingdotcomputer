// Resting-frame artwork for the compose-box <img> preview, where an
// atomic <img> (like ce/ek) is simpler than a live player. Flags are
// already raster.
//
// Strategy: render via **rlottie WASM** — the same engine the picker's
// CPU mode uses, which is also the reference implementation Telegram
// itself ships. Earlier passes used lottie-web's canvas renderer, but
// lottie-web has subtle shading bugs on Lotties with gradient fills /
// track mattes (cupid 1f498, white heart 1f90d, brown heart 1f90e were
// the visible cases). rlottie renders those identically to the picker.
//
// Frame choice: the last source frame (`op - 1`). For Telegram emoji
// that's the canonical rest pose — same frame the picker grid lands on
// when idle. No probe heuristics needed once we're on the right
// renderer.
//
// Output is a data: URL cached in-memory per session; the underlying
// Lottie JSON is HTTP-cached by the browser, so the second insert of
// the same emoji costs nothing.
import {
	mount as rlottieMount,
	getFrame as rlottieGetFrame,
	destroy as rlottieDestroy
} from './rlottie-pool.js';
import { fetchLottie, tgAnimatedUrl, tgFlagUrl, tgcUrl } from './telegram-emoji-store.js';

export const TG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// 128 px renders crisply at every realistic inline display size (the
// compose box img maxes out around 1.3em ≈ 24 px; chat bubbles can hit
// jumbo at ~64 px). Matches the size used by the previous lottie-web
// path so the visual footprint is unchanged.
const RENDER_PX = 128;

const _frameCache = new Map();
const _inFlight = new Map();

async function renderFrameFromUrl(cacheKey, url) {
	if (_frameCache.has(cacheKey)) return _frameCache.get(cacheKey);
	// Two simultaneous inserts of the same sticker shouldn't fire two
	// rlottie mounts — dedupe in-flight requests so the second caller
	// awaits the first's promise.
	if (_inFlight.has(cacheKey)) return _inFlight.get(cacheKey);

	const promise = (async () => {
		const data = await fetchLottie(url);
		if (!data) return null;
		let animId = null;
		let out = null;
		try {
			animId = await rlottieMount(JSON.stringify(data), RENDER_PX, RENDER_PX);
			// `op` is the animation's out-point (one past the last
			// frame), `ip` the in-point. The last visually distinct
			// frame is op - 1. rlottie indexes absolute source frames.
			const op = data.op || 60;
			const lastFrame = Math.max(0, op - 1);
			const bitmap = await rlottieGetFrame(animId, lastFrame);
			if (bitmap) {
				const canvas = document.createElement('canvas');
				canvas.width = RENDER_PX;
				canvas.height = RENDER_PX;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(bitmap, 0, 0);
				out = canvas.toDataURL('image/png');
			}
		} catch (e) {
			console.warn('[tg-frame] rlottie render failed', cacheKey, e);
		} finally {
			if (animId) rlottieDestroy(animId);
		}
		_frameCache.set(cacheKey, out);
		return out;
	})();

	_inFlight.set(cacheKey, promise);
	try { return await promise; }
	finally { _inFlight.delete(cacheKey); }
}

export async function tgStaticFrame(cp, flag) {
	if (flag) return tgFlagUrl(cp);
	return renderFrameFromUrl('tg:' + cp, tgAnimatedUrl(cp));
}

export async function tgcStaticFrame(short, id) {
	return renderFrameFromUrl('tgc:' + short + ':' + id, tgcUrl(short, id));
}
