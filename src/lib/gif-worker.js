// GIF encode worker — the expensive per-frame work (256-colour quantization
// + palette indexing) plus sequential GIF assembly, all off the main thread
// so the preview/UI stays responsive during exports.
// Same gifenc import dance as gif-studio.js (ESM in browser, CJS under SSR).
import * as gifencNS from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifencNS.GIFEncoder ? gifencNS : gifencNS.default;

let gif = null, W = 0, H = 0;

self.onmessage = (ev) => {
	const m = ev.data;
	try {
		if (m.type === 'init') {
			gif = GIFEncoder();
			W = m.W; H = m.H;
		} else if (m.type === 'frame') {
			const data = new Uint8ClampedArray(m.buf);
			// Transparent-background scenes (Coin/Sphere theme = transparent)
			// need binary GIF alpha: quantize alpha-aware, reserve a
			// transparent index, and dispose-to-background so the holes don't
			// accumulate previous frames.
			let hasAlpha = false;
			for (let i = 3; i < data.length; i += 4) if (data[i] < 128) { hasAlpha = true; break; }
			const format = hasAlpha ? 'rgba4444' : 'rgb565';
			const palette = quantize(data, 256, { format, oneBitAlpha: true });
			const index = applyPalette(data, palette, format);
			const ti = hasAlpha ? palette.findIndex((p) => p[3] === 0) : -1;
			gif.writeFrame(index, W, H, {
				palette, delay: m.delay,
				transparent: ti >= 0, transparentIndex: Math.max(0, ti),
				dispose: ti >= 0 ? 2 : -1
			});
			self.postMessage({ type: 'progress', f: m.f });
		} else if (m.type === 'finish') {
			gif.finish();
			const bytes = gif.bytes();
			self.postMessage({ type: 'done', bytes }, [bytes.buffer]);
			gif = null;
		}
	} catch (e) {
		self.postMessage({ type: 'error', message: e?.message || String(e) });
	}
};
