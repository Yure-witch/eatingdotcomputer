// Shared lottie-web worker. Holds N animations rendering to OffscreenCanvases
// transferred from main. lottie-web isn't worker-native, so we polyfill the
// browser globals it touches at module load BEFORE dynamic-importing it.
self.window = self;
// `self.navigator` already exists on WorkerGlobalScope (read-only getter) — don't reassign.
// Workers DON'T have requestAnimationFrame — lottie's playback loop uses it, so
// without this polyfill the animation mounts but never advances a frame.
if (typeof self.requestAnimationFrame !== 'function') {
	self.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
	self.cancelAnimationFrame = (id) => clearTimeout(id);
}
const stubEl = () => ({
	style: {}, appendChild() {}, removeChild() {}, insertBefore() {},
	setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
	addEventListener() {}, removeEventListener() {},
	getContext: () => null,
	getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
	classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
	children: [], childNodes: [], parentNode: null, ownerSVGElement: null
});
self.document = {
	createElement(tag) {
		if (tag === 'canvas') return new OffscreenCanvas(1, 1);
		return stubEl();
	},
	createElementNS(_ns, tag) {
		if (tag === 'canvas') return new OffscreenCanvas(1, 1);
		return stubEl();
	},
	createTextNode() { return stubEl(); },
	getElementsByTagName() { return []; },
	getElementsByClassName() { return []; },
	getElementById() { return null; },
	querySelector() { return null; },
	querySelectorAll() { return []; },
	addEventListener() {},
	removeEventListener() {},
	body: stubEl(),
	documentElement: stubEl(),
	head: stubEl(),
	readyState: 'complete'
};

const { default: lottie } = await import('lottie-web/build/player/lottie_canvas');

const anims = new Map(); // id -> { anim, canvas, w, h, playing }

// Manual playback loop — drive every non-paused animation forward with explicit
// advanceTime() calls. We don't trust lottie's internal animationManager because
// it captures requestAnimationFrame at module load in a way that doesn't always
// pick up our polyfill cleanly in worker context.
let _tickScheduled = false;
let _lastTick = 0;
function scheduleTick() {
	if (_tickScheduled) return;
	_tickScheduled = true;
	setTimeout(() => {
		_tickScheduled = false;
		const now = performance.now();
		const dt = _lastTick ? Math.min(64, now - _lastTick) : 16;
		_lastTick = now;
		let anyPlaying = false;
		for (const a of anims.values()) {
			if (a.playing && a.anim) {
				try { a.anim.advanceTime(dt); } catch {}
				anyPlaying = true;
			}
		}
		if (anyPlaying) scheduleTick();
		else _lastTick = 0;
	}, 16);
}

function mount({ id, offscreen, animationData, loop, autoplay, w, h }) {
	// Set canvas resolution BEFORE getContext — otherwise some engines reset state.
	offscreen.width = w; offscreen.height = h;
	const ctx = offscreen.getContext('2d');
	if (!ctx) { self.postMessage({ type: 'error', id, message: 'no 2d context' }); return; }

	// SMOKE TEST: paint a magenta square so we can verify OffscreenCanvas transfer
	// works at all, independent of whether lottie is rendering correctly. If you
	// see magenta cells in the picker, the transfer is fine and lottie is the bug.
	ctx.fillStyle = 'magenta';
	ctx.fillRect(0, 0, w, h);
	self.postMessage({ type: 'debug', id, message: `painted magenta ${w}x${h}` });

	// DON'T pass a container. With wrapper/container set, lottie's canvas renderer
	// creates its OWN canvas (via createTag) and draws into that instead of our
	// injected context. Omitting both forces the else-branch that uses
	// renderConfig.context — which is what we want.
	try {
		const anim = lottie.loadAnimation({
			renderer: 'canvas',
			loop, autoplay, animationData,
			rendererSettings: {
				context: ctx,
				clearCanvas: true,
				preserveAspectRatio: 'xMidYMid meet'
			}
		});
		// Without a wrapper, lottie's updateContainerSize() can't read offsetWidth
		// from anywhere; tell it the canvas size explicitly.
		try { anim.renderer.updateContainerSize(w, h); } catch {}
		anims.set(id, { anim, canvas: offscreen, w, h, playing: !!autoplay });
		self.postMessage({ type: 'debug', id, message: `lottie mounted, frames=${anim.totalFrames || '?'}` });
		if (autoplay) scheduleTick();
	} catch (e) {
		self.postMessage({ type: 'error', id, message: String(e?.message || e) });
	}
}

self.addEventListener('message', (e) => {
	const m = e.data;
	switch (m.type) {
		case 'mount': mount(m); break;
		case 'play': {
			const a = anims.get(m.id);
			if (a) { a.playing = true; try { a.anim.play(); } catch {} scheduleTick(); }
			break;
		}
		case 'pause': {
			const a = anims.get(m.id);
			if (a) { a.playing = false; try { a.anim.pause(); } catch {} }
			break;
		}
		case 'setFrame': {
			const a = anims.get(m.id);
			if (a) { a.playing = false; try { a.anim.goToAndStop(m.frame, true); } catch {} }
			break;
		}
		case 'destroy': {
			const a = anims.get(m.id);
			if (a) { try { a.anim.destroy(); } catch {} anims.delete(m.id); }
			break;
		}
	}
});
