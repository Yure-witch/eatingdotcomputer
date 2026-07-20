// GIF Studio — variable-font title animation engine.
//
// Renders "mesmerizing" kinetic-typography frames to a Canvas 2D context using
// a variable font (Google Sans Flex: wght 100..700, wdth 25..150), then encodes
// a looping GIF with gifenc. The same renderFrame() drives both the live preview
// and the export, so what you see is what you get.
//
// Variable axes on canvas: `wght` comes through the numeric font-weight in
// ctx.font (browsers interpolate the axis); `wdth` comes through ctx.fontStretch
// (Safari 17.4+/Chrome 116+). Where fontStretch is unsupported, weight animation
// alone still carries the effect.
// gifenc ships ESM for browsers ("module" field) but CJS for Node ("main"), so
// during SSR the named imports don't exist — go through the namespace. In the
// browser the names are on the namespace itself (its `default` is GIFEncoder,
// NOT the module — don't use it); under SSR the CJS exports object comes
// through as `default`. (Encoding itself only ever runs in the browser.)
import * as gifencNS from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifencNS.GIFEncoder ? gifencNS : gifencNS.default;

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── colour helpers ──────────────────────────────────────────────────────────
function hexToRgb(hex) {
	let h = String(hex).replace('#', '').trim();
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const n = parseInt(h, 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbCss({ r, g, b }) { return `rgb(${r | 0},${g | 0},${b | 0})`; }
function mixHex(a, b, t) {
	const A = hexToRgb(a), B = hexToRgb(b);
	return rgbCss({ r: lerp(A.r, B.r, t), g: lerp(A.g, B.g, t), b: lerp(A.b, B.b, t) });
}

// Wrapped distance between letter index `i` and a fractional position `pos`
// around a ring of `n` letters — for travelling "sweep" effects.
function ringDist(i, pos, n) {
	let d = Math.abs(i - pos);
	if (d > n / 2) d = n - d;
	return d;
}

// ── presets: (phase 0..1, i, n, cyc, o) → per-letter { weight, widthPct, dy,
//    alpha, scale, rot, color } ────────────────────────────────────────────────
export const PRESETS = [
	{
		id: 'weightWave', name: 'Weight Wave',
		fn: (t, i, n, cyc) => {
			const s = 0.5 + 0.5 * Math.sin(TAU * (t * cyc - i / Math.max(1, n)));
			return { weight: lerp(120, 680, s), widthPct: 100, dy: 0 };
		}
	},
	{
		id: 'breathe', name: 'Breathe',
		fn: (t, i, n, cyc) => {
			const s = 0.5 + 0.5 * Math.sin(TAU * t * cyc);
			return { weight: lerp(140, 660, s), widthPct: lerp(74, 128, s), dy: 0 };
		}
	},
	{
		id: 'wave', name: 'Wave',
		fn: (t, i, n, cyc) => {
			const u = t * cyc - i / Math.max(1, n);
			const s = Math.sin(TAU * u);
			return { weight: lerp(200, 600, 0.5 + 0.5 * s), widthPct: 100, dy: 0.16 * s };
		}
	},
	{
		id: 'widthMorph', name: 'Width Morph',
		fn: (t, i, n, cyc) => {
			const s = 0.5 + 0.5 * Math.sin(TAU * (t * cyc - i / Math.max(1, n)));
			return { weight: lerp(300, 580, s), widthPct: lerp(30, 150, s), dy: 0 };
		}
	},
	{
		id: 'spotlight', name: 'Spotlight',
		fn: (t, i, n, cyc, o) => {
			const pos = ((t * cyc) % 1) * n;
			const d = ringDist(i, pos, n);
			const b = Math.exp(-(d * d) / (2 * 1.1 * 1.1));
			return {
				weight: lerp(150, 700, b),
				widthPct: lerp(90, 118, b),
				dy: -0.09 * b,
				scale: 1 + 0.07 * b,
				color: mixHex(o.fg, o.accent, b)
			};
		}
	},
	{
		id: 'shimmer', name: 'Shimmer',
		fn: (t, i, n, cyc, o) => {
			const pos = ((t * cyc) % 1) * n;
			const d = ringDist(i, pos, n);
			const b = Math.exp(-(d * d) / (2 * 1.6 * 1.6));
			return {
				weight: 520, widthPct: 100, dy: 0,
				alpha: lerp(0.55, 1, b),
				color: mixHex(o.fg, o.accent, b)
			};
		}
	},
	{
		id: 'stagger', name: 'Cascade',
		fn: (t, i, n, cyc) => {
			// Each letter runs the same thicken+widen+fade cycle, phase-offset so it
			// cascades across the word and loops seamlessly. ZERO vertical motion —
			// letters never rise or fall, so the baseline is locked rock-steady.
			const u = (t * cyc + i / Math.max(1, n)) % 1;
			const s = 0.5 - 0.5 * Math.cos(TAU * u); // smooth 0→1→0
			return { weight: lerp(160, 640, s), widthPct: lerp(88, 116, s), dy: 0, alpha: lerp(0.6, 1, s) };
		}
	},
	{
		id: 'axisStorm', name: 'Axis Storm',
		fn: (t, i, n, cyc) => {
			// Drive EVERY axis independently per letter with layered periodic noise
			// (integer harmonics of the loop → seamless): weight, width, slant (via
			// skew), and vertical drift all churning at once.
			const a = TAU * t * cyc;
			const nz = (k, ph) => Math.sin(a * k + i * ph);
			const wS = 0.5 + 0.5 * (0.6 * nz(1, 0.9) + 0.4 * nz(2, 0.5));
			const dS = 0.5 + 0.5 * (0.5 * nz(1, 1.3) + 0.5 * nz(3, 0.7));
			return {
				weight: lerp(100, 700, clamp(wS, 0, 1)),
				widthPct: lerp(28, 150, clamp(dS, 0, 1)),
				skew: 0.30 * (0.6 * nz(1, 1.7) + 0.4 * nz(2, 1.1)),
				dy: 0.10 * (0.5 * nz(2, 0.6) + 0.5 * nz(1, 2.1))
			};
		}
	}
];
const PRESET_MAP = Object.fromEntries(PRESETS.map((p) => [p.id, p.fn]));

// ── background ──────────────────────────────────────────────────────────────
function paintBackground(ctx, o) {
	const { W, H } = o;
	if (o.bgType === 'gradient') {
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, o.bg2 || o.bg); g.addColorStop(1, o.bg);
		ctx.fillStyle = g;
	} else if (o.bgType === 'radial') {
		const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.72);
		g.addColorStop(0, o.bg2 || o.bg); g.addColorStop(1, o.bg);
		ctx.fillStyle = g;
	} else {
		ctx.fillStyle = o.bg;
	}
	ctx.fillRect(0, 0, W, H);
}

// Export the background painter so tiling / other scenes can reuse it.
export function paintBg(ctx, o) { paintBackground(ctx, o); }

// Fit scale is LOCKED per line across the whole loop: the animation is sampled
// over the cycle once and the line fitted to its WIDEST frame (cached). Re-
// fitting every frame made the drawn font px — and with it the 'middle'-
// baseline offset, which is proportional to px — breathe with the wave, so the
// entire line drifted up/down ~1px per frame in exported GIFs.
const fitCache = new Map();
function maxTotalWidth(ctx, letters, o, basePx, spacing) {
	const n = letters.length, cyc = o.cycles || 1;
	let max = 0;
	for (let k = 0; k < 32; k++) {
		let total = 0;
		for (let i = 0; i < n; i++) {
			const p = PRESET_MAP[o.preset](k / 32, i, n, cyc, o);
			ctx.font = `${Math.round(p.weight)} ${basePx}px ${o.fontFamily}`;
			if (o.hasStretch) ctx.fontStretch = p.widthPct + '%';
			total += ctx.measureText(letters[i]).width + (i < n - 1 ? spacing : 0);
		}
		if (total > max) max = total;
	}
	return max;
}

// Draw ONE animated line of type. `layout` = { cx, cy, fontPx, fit }:
//   cx, cy  — centre point
//   fontPx  — base size
//   fit     — if set, scale the line down to fit this width (else natural size)
// Used by renderFrame (single centred title) AND the Step & Repeat tile scene
// (many lines, each at its own phase). Does NOT paint the background.
export function drawTypeLine(ctx, text, phase, o, layout) {
	const letters = Array.from(text || '');
	if (!letters.length) return;
	const cyc = o.cycles || 1;
	const params = letters.map((ch, i) => PRESET_MAP[o.preset](phase, i, letters.length, cyc, o));
	const basePx = layout.fontPx;
	const spacing = (o.tracking || 0) * basePx;

	ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
	const adv = new Array(letters.length);
	let total = 0;
	for (let i = 0; i < letters.length; i++) {
		const p = params[i];
		ctx.font = `${Math.round(p.weight)} ${basePx}px ${o.fontFamily}`;
		if (o.hasStretch) ctx.fontStretch = p.widthPct + '%';
		adv[i] = ctx.measureText(letters[i]).width;
		total += adv[i] + (i < letters.length - 1 ? spacing : 0);
	}
	let scale = 1;
	if (layout.fit) {
		// Cache key includes a reference measurement so a cache entry computed
		// against the fallback font is invalidated once the real font loads.
		ctx.font = `400 ${basePx}px ${o.fontFamily}`;
		if (o.hasStretch) ctx.fontStretch = '100%';
		const fp = ctx.measureText(text).width | 0;
		const key = `${o.preset}|${cyc}|${text}|${basePx.toFixed(1)}|${layout.fit.toFixed(1)}|${o.fontFamily}|${o.hasStretch ? 1 : 0}|${o.tracking || 0}|${fp}`;
		let maxW = fitCache.get(key);
		if (maxW === undefined) {
			maxW = maxTotalWidth(ctx, letters, o, basePx, spacing);
			if (fitCache.size > 64) fitCache.clear();
			fitCache.set(key, maxW);
		}
		scale = maxW > 0 ? Math.min(1.7, layout.fit / maxW) : 1;
	}
	const px = basePx * scale;
	let x = layout.cx - (total * scale) / 2;

	for (let i = 0; i < letters.length; i++) {
		const p = params[i];
		ctx.save();
		ctx.font = `${Math.round(p.weight)} ${px}px ${o.fontFamily}`;
		if (o.hasStretch) ctx.fontStretch = p.widthPct + '%';
		ctx.fillStyle = p.color || o.fg;
		ctx.globalAlpha = clamp(p.alpha ?? 1, 0, 1);
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		const advScaled = adv[i] * scale;
		ctx.translate(x + advScaled / 2, layout.cy + (p.dy || 0) * px);
		if (p.rot) ctx.rotate(p.rot);
		if (p.scale && p.scale !== 1) ctx.scale(p.scale, p.scale);
		if (p.skew) ctx.transform(1, 0, Math.tan(p.skew), 1, 0, 0); // slant (ital-ish)
		ctx.fillText(letters[i], 0, 0);
		ctx.restore();
		x += advScaled + spacing * scale;
	}
	ctx.globalAlpha = 1;
}

// Draw one frame. `phase` is the loop position in [0,1).
export function renderFrame(ctx, phase, o) {
	const { W, H } = o;
	paintBackground(ctx, o);
	const cy = H * (o.subtitle ? 0.44 : 0.5);
	drawTypeLine(ctx, o.text, phase, o, { cx: W / 2, cy, fontPx: o.fontPx, fit: W * (o.fitW || 0.86) });

	// Optional static subtitle line.
	if (o.subtitle) {
		const subPx = o.fontPx * 0.26;
		ctx.font = `500 ${subPx}px ${o.fontFamily}`;
		if (o.hasStretch) ctx.fontStretch = '100%';
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillStyle = o.subColor || o.fg;
		ctx.globalAlpha = 0.72;
		ctx.fillText(o.subtitle, W / 2, cy + o.fontPx * 0.62);
		ctx.globalAlpha = 1;
	}
}

// True when the browser can drive the `wdth` axis via ctx.fontStretch.
export function supportsFontStretch() {
	return typeof CanvasRenderingContext2D !== 'undefined'
		&& 'fontStretch' in CanvasRenderingContext2D.prototype;
}

// Encode a looping GIF from a stateful `scene` ({ step(dt), render(ctx) }).
// Frame 0 captures the reset state; each subsequent frame steps by 1/fps and
// renders — so stateful simulations (reaction-diffusion, CA, cloth …) advance
// deterministically. Returns a Uint8Array of GIF bytes.
export async function encodeGif(opts) {
	// WORKER path: quantization + palette indexing (the main-thread hogs)
	// run in a dedicated worker; the main thread only renders frames and
	// ships pixels over as transferables. Falls back to inline encoding
	// wherever module workers are unavailable.
	if (typeof Worker !== 'undefined') {
		try {
			return await encodeGifWorker(opts);
		} catch (e) {
			console.warn('[gif-studio] worker encode failed, falling back inline:', e);
		}
	}
	return encodeGifInline(opts);
}

async function encodeGifWorker({ W, H, fps, frames, scene, delayMs, onProgress, signal, stepDt }) {
	const worker = new Worker(new URL('./gif-worker.js', import.meta.url), { type: 'module' });
	try {
		const delay = Math.max(20, Math.round(delayMs || 1000 / fps));
		const dt = stepDt || 1 / fps;
		const cv = document.createElement('canvas');
		cv.width = W; cv.height = H;
		const ctx = cv.getContext('2d', { willReadFrequently: true });
		let doneFrames = 0;
		let resolveDone, rejectDone;
		const donePromise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
		worker.onmessage = (ev) => {
			const m = ev.data;
			if (m.type === 'progress') { doneFrames = m.f + 1; onProgress?.(doneFrames / frames); }
			else if (m.type === 'done') resolveDone(m.bytes);
			else if (m.type === 'error') rejectDone(new Error(m.message));
		};
		worker.onerror = (e) => rejectDone(new Error(e.message || 'worker error'));
		worker.postMessage({ type: 'init', W, H });
		for (let f = 0; f < frames; f++) {
			if (signal?.aborted) throw new Error('aborted');
			if (f > 0) scene.step(dt);
			scene.render(ctx);
			const { data } = ctx.getImageData(0, 0, W, H);
			// transfer the pixels — zero-copy handoff to the worker
			worker.postMessage({ type: 'frame', buf: data.buffer, delay, f }, [data.buffer]);
			// BACKPRESSURE: stay at most 3 frames ahead of the encoder so
			// memory stays flat and the tab stays smooth
			while (f - doneFrames >= 3) {
				if (signal?.aborted) throw new Error('aborted');
				await new Promise((r) => setTimeout(r, 8));
			}
			// yield to the UI between renders
			if ((f & 1) === 0) await new Promise((r) => requestAnimationFrame(r));
		}
		worker.postMessage({ type: 'finish' });
		return await donePromise;
	} finally {
		worker.terminate();
	}
}

async function encodeGifInline({ W, H, fps, frames, scene, delayMs, onProgress, signal, stepDt }) {
	const gif = GIFEncoder();
	const cv = document.createElement('canvas');
	cv.width = W; cv.height = H;
	const ctx = cv.getContext('2d', { willReadFrequently: true });
	// Playback delay per frame (GIF speed). Sim advance uses dt = 1/fps regardless,
	// so GIF speed changes how fast frames PLAY, not how much reaction is baked.
	const delay = Math.max(20, Math.round(delayMs || 1000 / fps));
	// stepDt (usually duration/frames) makes the frames tile the loop EXACTLY:
	// with dt = 1/fps and frames = round(duration*fps), any fractional product
	// left a partial-phase gap at the seam — a few visibly off-speed frames
	// every repeat, glaring on eased motion.
	const dt = stepDt || 1 / fps;

	for (let f = 0; f < frames; f++) {
		if (signal?.aborted) throw new Error('aborted');
		if (f > 0) scene.step(dt);
		scene.render(ctx);
		const { data } = ctx.getImageData(0, 0, W, H);
		// binary alpha for transparent-background scenes — see gif-worker.js
		let hasAlpha = false;
		for (let i = 3; i < data.length; i += 4) if (data[i] < 128) { hasAlpha = true; break; }
		const format = hasAlpha ? 'rgba4444' : 'rgb565';
		const palette = quantize(data, 256, { format, oneBitAlpha: true });
		const index = applyPalette(data, palette, format);
		const ti = hasAlpha ? palette.findIndex((p) => p[3] === 0) : -1;
		gif.writeFrame(index, W, H, {
			palette, delay,
			transparent: ti >= 0, transparentIndex: Math.max(0, ti),
			dispose: ti >= 0 ? 2 : -1
		});
		onProgress?.((f + 1) / frames);
		// Yield periodically so the UI (progress bar) stays responsive.
		if ((f & 3) === 0) await new Promise((r) => requestAnimationFrame(r));
	}
	gif.finish();
	return gif.bytes();
}

// Encode a looping ANIMATED WEBP from the same stateful `scene` contract.
// Each frame is compressed by the browser's native still-WebP encoder
// (canvas.toBlob('image/webp')), then the stills are muxed by hand into an
// animated WebP container: RIFF/WEBP -> VP8X (ANIM flag) -> ANIM (loop
// forever) -> one ANMF per frame wrapping the still's VP8/VP8L (+ALPH)
// bitstream. Far smaller files than GIF at much higher colour fidelity.
export async function encodeWebP({ W, H, fps, frames, scene, delayMs, onProgress, signal, stepDt, quality = 0.9 }) {
	const cv = document.createElement('canvas');
	cv.width = W; cv.height = H;
	const ctx = cv.getContext('2d');
	const delay = Math.max(20, Math.round(delayMs || 1000 / fps));
	const dt = stepDt || 1 / fps; // see encodeGif: exact loop tiling
	const frameChunks = [];
	const toBlob = () => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('webp encode failed'))), 'image/webp', quality));
	for (let f = 0; f < frames; f++) {
		if (signal?.aborted) throw new Error('aborted');
		if (f > 0) scene.step(dt);
		scene.render(ctx);
		const buf = new Uint8Array(await (await toBlob()).arrayBuffer());
		// parse the still's RIFF: collect the image-data chunks (ALPH + VP8/VP8L)
		if (String.fromCharCode(...buf.subarray(0, 4)) !== 'RIFF') throw new Error('not a WebP');
		const chunks = [];
		let p = 12;
		while (p + 8 <= buf.length) {
			const tag = String.fromCharCode(...buf.subarray(p, p + 4));
			const size = buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24);
			if (tag === 'VP8 ' || tag === 'VP8L' || tag === 'ALPH') chunks.push(buf.subarray(p, p + 8 + size + (size & 1)));
			p += 8 + size + (size & 1);
		}
		if (!chunks.length) throw new Error('no image data in WebP frame');
		frameChunks.push(chunks);
		onProgress?.((f + 1) / frames);
		if ((f & 3) === 0) await new Promise((r) => requestAnimationFrame(r));
	}
	// assemble the animation
	const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
	const le24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
	const parts = [];
	// alpha flag (0x10) whenever any frame carries an ALPH chunk (lossy+alpha)
	// or is losslessly coded (VP8L embeds its alpha) — transparent-bg scenes
	const anyAlpha = frameChunks.some((chunks) =>
		chunks.some((c) => (c[0] === 65 && c[1] === 76) || (c[0] === 86 && c[3] === 76)) // 'ALPH' | 'VP8L'
	);
	// VP8X: animation flag (bit 1 of byte 0 = 0x02) + alpha, canvas size minus one
	parts.push([...'VP8X'].map((c) => c.charCodeAt(0)), le32(10), [0x02 | (anyAlpha ? 0x10 : 0), 0, 0, 0, ...le24(W - 1), ...le24(H - 1)]);
	// ANIM: transparent background, loop count 0 = forever
	parts.push([...'ANIM'].map((c) => c.charCodeAt(0)), le32(6), [0, 0, 0, 0, 0, 0]);
	for (const chunks of frameChunks) {
		let inner = 0;
		for (const c of chunks) inner += c.length;
		// ANMF header: x/2, y/2, (w-1), (h-1) as 24-bit, duration 24-bit,
		// flags bit0 = 1: NO blend — each full-canvas frame overwrites, so
		// transparent areas don't composite over the previous frame
		parts.push([...'ANMF'].map((c) => c.charCodeAt(0)), le32(16 + inner), [...le24(0), ...le24(0), ...le24(W - 1), ...le24(H - 1), ...le24(delay), 1]);
		for (const c of chunks) parts.push(c);
	}
	let total = 4; // 'WEBP'
	for (const pt of parts) total += pt.length;
	const out = new Uint8Array(12 + total);
	out.set([82, 73, 70, 70, ...le32(total), 87, 69, 66, 80], 0); // RIFF <size> WEBP
	let q = 12;
	for (const pt of parts) { out.set(pt, q); q += pt.length; }
	return out;
}

// Build the renderFrame options bag from the studio's live opts + target dims.
// Shared by the kinetic-type scene and the pixel-sort scene (which sorts a
// freshly-rendered type frame).
export function buildRenderOpts(o, W, H) {
	return {
		W, H,
		text: o.text,
		subtitle: (o.subtitle || '').trim(),
		preset: o.preset, cycles: o.cycles,
		bg: o.bg, bg2: o.bg2, fg: o.fg, accent: o.accent, subColor: o.fg, bgType: o.bgType,
		fontFamily: o.fontFamily, fontPx: H * (o.fontFrac || 0.3),
		tracking: 0.02, fitW: 0.86, hasStretch: o.hasStretch
	};
}
