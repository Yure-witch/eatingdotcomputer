// Render a representative still frame of a Telegram animated emoji to a
// data URL — used for the compose-box <img> preview, where an atomic <img>
// (like ce/ek) is simpler than a live player. Flags are already raster.
//
// Uses lottie-web's CANVAS renderer just for this capture path (SVG can't
// toDataURL); everything else in the app renders via lottie-web's SVG renderer.
import lottie from 'lottie-web';
import { fetchLottie, tgAnimatedUrl, tgFlagUrl, tgcUrl, STATIC_FRAME_INDEX } from './telegram-emoji-store.js';

export const TG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const _frameCache = new Map();

async function renderFrameFromUrl(cacheKey, url) {
	if (_frameCache.has(cacheKey)) return _frameCache.get(cacheKey);
	const data = await fetchLottie(url);
	if (!data) return null;
	const div = document.createElement('div');
	div.style.cssText = 'position:absolute;left:-9999px;top:0;width:128px;height:128px;';
	document.body.appendChild(div);
	let out = null;
	try {
		const anim = lottie.loadAnimation({ container: div, renderer: 'canvas', loop: false, autoplay: false, animationData: data });
		const total = anim.totalFrames || 1;
		anim.goToAndStop(Math.min(STATIC_FRAME_INDEX, Math.max(0, total - 1)), true);
		out = div.querySelector('canvas')?.toDataURL('image/png') ?? null;
		anim.destroy();
	} catch { /* ignore */ }
	div.remove();
	_frameCache.set(cacheKey, out);
	return out;
}

export async function tgStaticFrame(cp, flag) {
	if (flag) return tgFlagUrl(cp);
	return renderFrameFromUrl('tg:' + cp, tgAnimatedUrl(cp));
}

export async function tgcStaticFrame(short, id) {
	return renderFrameFromUrl('tgc:' + short + ':' + id, tgcUrl(short, id));
}
