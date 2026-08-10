// Text GIFs — animated text effects rendered to a 2D canvas, looping over a
// normalized phase (0..1). Inspired by textstudio-style animated text: pick a
// word, pick an effect, export an animated GIF/WebP.
//
// Each effect is a pure `draw(ctx, phase, o, W, H)` and shares the same scene
// contract the GIF encoder wants ({ step(dt), render(ctx) }) via makeTextScene.

function hexToRgb(hex) {
	const h = String(hex || '#000').replace('#', '');
	const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
	const v = parseInt(n || '0', 16);
	return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
const rgba = ({ r, g, b }, a = 1) => `rgba(${r},${g},${b},${a})`;
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
const TAU = Math.PI * 2;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function fontString(o, px) {
	const weight = o.weight || 700;
	return `${o.italic ? 'italic ' : ''}${weight} ${px}px ${o.font || 'Poppins, sans-serif'}`;
}

// Lay out one centred line: per-glyph x + widths, the font px, and the baseline.
function layout(ctx, o, W, H) {
	const text = (o.text ?? '').length ? o.text : ' ';
	let px = Math.max(8, Math.round(H * (o.sizeFrac ?? 0.34)));
	ctx.font = fontString(o, px);
	const spacing = (o.tracking ?? 0) * px;
	// Shrink to fit width with a margin.
	const measure = (s) => {
		let w = 0;
		for (const ch of s) w += ctx.measureText(ch).width + spacing;
		return w - spacing;
	};
	let total = measure(text);
	const maxW = W * 0.88;
	if (total > maxW) {
		px = Math.max(8, Math.floor(px * (maxW / total)));
		ctx.font = fontString(o, px);
		total = measure(text);
	}
	const glyphs = [];
	let x = (W - total) / 2;
	for (const ch of text) {
		const w = ctx.measureText(ch).width;
		glyphs.push({ ch, x, w, cx: x + w / 2 });
		x += w + spacing;
	}
	return { glyphs, px, total, baseY: H / 2, left: (W - total) / 2 };
}

// ── Background ──────────────────────────────────────────────────────────────
export function paintBg(ctx, o, W, H) {
	if (o.bgType === 'transparent') { ctx.clearRect(0, 0, W, H); return; }
	ctx.clearRect(0, 0, W, H);
	if (o.bgType === 'gradient') {
		const g = ctx.createLinearGradient(0, 0, W, H);
		g.addColorStop(0, o.bg || '#111');
		g.addColorStop(1, o.bg2 || '#333');
		ctx.fillStyle = g;
	} else {
		ctx.fillStyle = o.bg || '#111';
	}
	ctx.fillRect(0, 0, W, H);
}

// ── Effects ─────────────────────────────────────────────────────────────────
function drawGlyphs(ctx, L, o, transform) {
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	ctx.font = fontString(o, L.px);
	for (let i = 0; i < L.glyphs.length; i++) transform(ctx, L.glyphs[i], i, L);
}

const EFFECTS = [
	{
		id: 'rainbow', name: 'Rainbow',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			drawGlyphs(ctx, L, o, (c, g, i, LL) => {
				ctx.fillStyle = hsl(phase * 360 + (i / Math.max(1, LL.glyphs.length)) * 360, 90, 60);
				ctx.fillText(g.ch, g.x, LL.baseY);
			});
		}
	},
	{
		id: 'wave', name: 'Wave',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const amp = L.px * 0.22;
			ctx.fillStyle = o.color || '#fff';
			drawGlyphs(ctx, L, o, (c, g, i, LL) => {
				const y = LL.baseY + Math.sin(phase * TAU + i * 0.6) * amp;
				ctx.fillText(g.ch, g.x, y);
			});
		}
	},
	{
		id: 'neon', name: 'Neon',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const glow = 0.5 + 0.5 * Math.sin(phase * TAU);
			const col = o.color || '#0ff';
			ctx.save();
			ctx.shadowColor = col;
			ctx.shadowBlur = L.px * (0.25 + 0.45 * glow);
			ctx.fillStyle = col;
			// two passes deepen the bloom
			for (let p = 0; p < 2; p++) drawGlyphs(ctx, L, o, (c, g, i, LL) => ctx.fillText(g.ch, g.x, LL.baseY));
			ctx.shadowBlur = 0;
			ctx.fillStyle = '#fff';
			drawGlyphs(ctx, L, o, (c, g, i, LL) => ctx.fillText(g.ch, g.x, LL.baseY));
			ctx.restore();
		}
	},
	{
		id: 'type', name: 'Typewriter',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const n = L.glyphs.length;
			// reveal over the first 70% of the loop, hold, then a blinking cursor
			const shown = Math.floor(Math.min(1, phase / 0.7) * n + 1e-6);
			ctx.fillStyle = o.color || '#fff';
			let cursorX = L.left;
			for (let i = 0; i < shown && i < n; i++) {
				const g = L.glyphs[i];
				ctx.font = fontString(o, L.px);
				ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
				ctx.fillText(g.ch, g.x, L.baseY);
				cursorX = g.x + g.w;
			}
			// caret blink ~4Hz
			if (Math.floor(phase * 8) % 2 === 0) {
				ctx.fillRect(cursorX + L.px * 0.04, L.baseY - L.px * 0.42, Math.max(2, L.px * 0.06), L.px * 0.84);
			}
		}
	},
	{
		id: 'bounce', name: 'Bounce',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const drop = L.px * 0.5;
			ctx.fillStyle = o.color || '#fff';
			drawGlyphs(ctx, L, o, (c, g, i, LL) => {
				const local = ((phase + i * 0.08) % 1);
				// up-and-down bounce with a squashy ease
				const b = Math.abs(Math.sin(local * Math.PI));
				ctx.fillText(g.ch, g.x, LL.baseY - b * drop + drop * 0.5);
			});
		}
	},
	{
		id: 'shine', name: 'Shine',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const base = o.color || '#c9a227';
			ctx.fillStyle = base;
			drawGlyphs(ctx, L, o, (c, g, i, LL) => ctx.fillText(g.ch, g.x, LL.baseY));
			// sweeping specular highlight, clipped to the glyphs
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, W, H);
			ctx.clip(); // (glyph clip below via composite)
			const sweep = (phase * 1.6 - 0.3) * L.total + L.left;
			const w = L.total * 0.28;
			const g = ctx.createLinearGradient(sweep - w, 0, sweep + w, 0);
			g.addColorStop(0, rgba(hexToRgb(base), 0));
			g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
			g.addColorStop(1, rgba(hexToRgb(base), 0));
			ctx.globalCompositeOperation = 'source-atop';
			ctx.fillStyle = g;
			drawGlyphs(ctx, L, o, (c, gl, i, LL) => ctx.fillText(gl.ch, gl.x, LL.baseY));
			ctx.restore();
		}
	},
	{
		id: 'glitch', name: 'Glitch',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			// deterministic jitter from phase so the loop is exact
			const j = (k) => (Math.sin(phase * TAU * 7 + k) * 0.5 + Math.sin(phase * TAU * 13 + k * 2) * 0.5) * L.px * 0.06;
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			const passes = [{ c: '#f00', dx: j(1), dy: j(2) }, { c: '#0f0', dx: -j(3), dy: j(4) }, { c: '#00f', dx: j(5), dy: -j(6) }];
			for (const p of passes) {
				ctx.fillStyle = p.c;
				drawGlyphs(ctx, L, o, (c, g, i, LL) => ctx.fillText(g.ch, g.x + p.dx, LL.baseY + p.dy));
			}
			ctx.restore();
		}
	},
	{
		id: 'pop', name: 'Pop',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const s = 1 + 0.12 * Math.sin(phase * TAU);
			ctx.save();
			ctx.translate(W / 2, H / 2);
			ctx.scale(s, s);
			ctx.translate(-W / 2, -H / 2);
			ctx.fillStyle = o.color || '#fff';
			drawGlyphs(ctx, L, o, (c, g, i, LL) => ctx.fillText(g.ch, g.x, LL.baseY));
			ctx.restore();
		}
	},
	{
		id: 'slide', name: 'Slide in',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			ctx.fillStyle = o.color || '#fff';
			drawGlyphs(ctx, L, o, (c, g, i, LL) => {
				// each glyph slides up into place, staggered; holds, then resets at seam
				const local = Math.min(1, Math.max(0, (phase - i * 0.05) / 0.4));
				const e = easeInOut(local);
				const y = LL.baseY + (1 - e) * H * 0.5;
				ctx.globalAlpha = e;
				ctx.fillText(g.ch, g.x, y);
			});
			ctx.globalAlpha = 1;
		}
	},
	{
		id: 'gradient', name: 'Gradient flow',
		draw(ctx, phase, o, W, H) {
			const L = layout(ctx, o, W, H);
			const a = hexToRgb(o.color || '#ff5f6d');
			const b = hexToRgb(o.color2 || '#ffc371');
			const off = phase * L.total;
			const g = ctx.createLinearGradient(L.left - off, 0, L.left + L.total * 2 - off, 0);
			for (let k = 0; k <= 4; k++) g.addColorStop(k / 4, k % 2 ? rgba(b) : rgba(a));
			ctx.fillStyle = g;
			drawGlyphs(ctx, L, o, (c, gl, i, LL) => ctx.fillText(gl.ch, gl.x, LL.baseY));
		}
	}
];

export const TEXT_EFFECTS = EFFECTS.map((e) => ({ id: e.id, name: e.name }));
const BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

// Scene for the shared GIF encoder. Loops over `o.duration` seconds.
export function makeTextScene(effectId, o, W, H) {
	const eff = BY_ID.get(effectId) ?? EFFECTS[0];
	const duration = Math.max(0.3, o.duration ?? 2);
	let t = 0;
	return {
		step(dt) { t += dt; },
		render(ctx) {
			const phase = ((t / duration) % 1 + 1) % 1;
			paintBg(ctx, o, W, H);
			eff.draw(ctx, phase, o, W, H);
		}
	};
}
