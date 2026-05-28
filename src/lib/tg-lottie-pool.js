// Thin client around the shared lottie worker. One worker handles every
// canvas Lottie in the picker grid; main thread only sends play/pause msgs.
import TgLottieWorker from './workers/tg-lottie-worker.js?worker';

let _worker = null;
let _nextId = 1;

function getWorker() {
	if (!_worker) {
		_worker = new TgLottieWorker();
		_worker.addEventListener('error', (e) => console.warn('[tg-lottie-worker]', e.message || e));
		_worker.addEventListener('message', (e) => {
			if (e.data?.type === 'error') console.warn('[tg-lottie-worker]', e.data.message);
			else if (e.data?.type === 'debug') console.log('[tg-lottie-worker]', e.data.message);
		});
	}
	return _worker;
}

export function supportsOffscreenLottie() {
	return typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

/**
 * Transfer a freshly-created (never-2d-contexted) canvas to the worker.
 * The canvas must already have its width/height attributes set.
 */
export function mountWorkerLottie(canvas, animationData, { loop = true, autoplay = true } = {}) {
	if (!supportsOffscreenLottie() || !canvas) return null;
	// Capture size BEFORE transfer — some browsers make these accessors flaky on a placeholder canvas.
	const w = canvas.width || 1;
	const h = canvas.height || 1;
	let offscreen;
	try { offscreen = canvas.transferControlToOffscreen(); }
	catch { return null; }
	const id = _nextId++;
	// lottie-web mutates the parsed JSON after first use (attaches non-cloneable
	// refs/functions), so JSON round-trip to a pristine, structurally-cloneable copy.
	let cloneable;
	try { cloneable = JSON.parse(JSON.stringify(animationData)); }
	catch { return null; }
	getWorker().postMessage(
		{ type: 'mount', id, offscreen, animationData: cloneable, loop, autoplay, w, h },
		[offscreen]
	);
	return id;
}

export function playWorkerLottie(id)        { if (id) getWorker().postMessage({ type: 'play', id }); }
export function pauseWorkerLottie(id)       { if (id) getWorker().postMessage({ type: 'pause', id }); }
export function setFrameWorkerLottie(id, f) { if (id) getWorker().postMessage({ type: 'setFrame', id, frame: f }); }
export function destroyWorkerLottie(id)     { if (id) getWorker().postMessage({ type: 'destroy', id }); }
