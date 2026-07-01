// GIF Studio — generative-art engine.
//
// Every scene treats the TYPOGRAPHY as its seed: text is rasterised to a mask,
// and the generative system grows from that shape. Scenes are stateful
// ({ reset, step(dt), render(ctx) }) so simulations advance frame-by-frame; the
// same instance drives the live preview and (a fresh one) the GIF export.
//
// Scenes:
//   type      — kinetic variable-font typography (wraps renderFrame; presets
//               incl. Axis Storm which animates wght/wdth/slant per letter)
//   bz        — Belousov–Zhabotinsky: an excitable medium (Greenberg–Hastings
//               cellular automaton) whose waves radiate OUT from the letters
//   cca       — cyclic cellular automaton → self-organising spirals
//   flow      — Perlin-noise flow field; particles born on the text dissolve
//               into curling streams
//   sort      — pixel-sorting glitch over an animated type frame
//   walk      — random walkers released from the text, weaving a web
//   cloth     — Verlet cloth: the title printed on a waving banner
import { renderFrame, buildRenderOpts, drawTypeLine } from '$lib/gif-studio.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── seedable RNG + Perlin noise ──────────────────────────────────────────────
function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function makePerlin(rng) {
	const perm = Array.from({ length: 256 }, (_, i) => i);
	for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
	const p = new Uint8Array(512);
	for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
	const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
	return (x, y) => {
		const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
		x -= Math.floor(x); y -= Math.floor(y);
		const u = fade(x), v = fade(y);
		const A = p[X] + Y, B = p[X + 1] + Y;
		return lerp(
			lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
			lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u), v
		);
	};
}

// ── colour helpers (rgb triples for ImageData) ───────────────────────────────
function hexToRgb(h) {
	h = String(h).replace('#', '');
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const n = parseInt(h, 16) || 0;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cssRgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

// Shared background painter (solid / linear / radial) at W×H.
function paintBg(ctx, o, W, H) {
	if (o.bgType === 'gradient') {
		const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, o.bg2 || o.bg); g.addColorStop(1, o.bg); ctx.fillStyle = g;
	} else if (o.bgType === 'radial') {
		const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.72); g.addColorStop(0, o.bg2 || o.bg); g.addColorStop(1, o.bg); ctx.fillStyle = g;
	} else ctx.fillStyle = o.bg;
	ctx.fillRect(0, 0, W, H);
}

// ── text → mask ──────────────────────────────────────────────────────────────
function drawFittedText(ctx, text, W, H, fontPx, fontFamily, weight, hasStretch) {
	const letters = Array.from(text || '');
	if (!letters.length) return;
	ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
	ctx.font = `${weight} ${fontPx}px ${fontFamily}`;
	if (hasStretch) ctx.fontStretch = '100%';
	let total = 0;
	const adv = letters.map((ch) => { const w = ctx.measureText(ch).width; total += w; return w; });
	const scale = total > 0 ? Math.min(1.7, (W * 0.86) / total) : 1;
	const px = fontPx * scale;
	ctx.font = `${weight} ${px}px ${fontFamily}`;
	if (hasStretch) ctx.fontStretch = '100%';
	ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	let x = (W - total * scale) / 2;
	for (let i = 0; i < letters.length; i++) { const a = adv[i] * scale; ctx.fillText(letters[i], x + a / 2, H * 0.5); x += a; }
}
// Coverage field (0..1) at gw×gh — 1 inside the letters.
function textMaskAt(gw, gh, o) {
	const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
	const ctx = cv.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, gw, gh);
	ctx.fillStyle = '#fff';
	drawFittedText(ctx, o.text, gw, gh, gh * (o.fontFrac || 0.3), o.fontFamily, 700, o.hasStretch);
	const d = ctx.getImageData(0, 0, gw, gh).data;
	const cov = new Float32Array(gw * gh);
	for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4] / 255;
	return cov;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Scenes
// ═══════════════════════════════════════════════════════════════════════════

// Kinetic variable-font typography.
function sceneType(env) {
	const { W, H, getOpts } = env;
	let t = 0;
	return {
		reset() { t = 0; },
		step(dt) { t += dt; },
		render(ctx) {
			const o = getOpts();
			const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
			renderFrame(ctx, phase, buildRenderOpts(o, W, H));
		}
	};
}

// Belousov–Zhabotinsky — excitable medium (Greenberg–Hastings CA). A cell is
// resting (0), excited (1), or refractory (2..N-1, ticking back to rest). A
// resting cell fires when enough neighbours are excited; refractory cells can't,
// so a wavefront can only travel OUTWARD — giving BZ target/spiral waves. The
// text is a periodic pacemaker, so waves keep radiating from the letters.
function sceneBZ(env) {
	const { W, H, getOpts } = env;
	const N = 20, scale = 0.46, BASE_HZ = 26;
	// Circular neighbourhood → isotropic propagation. A Moore/8 block makes
	// diagonals travel faster (waves square off); a round disk makes wave speed
	// curvature-driven, rounding corners. Radius is LIVE (the Roundedness slider):
	// bigger disk = rounder waves. THRESH scales with the disk so waves still
	// propagate one cell per step.
	let OFF = [], THRESH = 4, radius = -1;
	function ensureOffsets() {
		const r = clamp(getOpts().bzRound || 2.5, 1, 3.6);
		if (r === radius) return;
		radius = r; OFF = []; const r2 = r * r;
		for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++)
			if ((dx || dy) && dx * dx + dy * dy <= r2) OFF.push(dx, dy);
		THRESH = Math.max(1, Math.round((OFF.length / 2) * 0.2));
	}
	let gw, gh, state, next, source, small, sctx, sdata, acc;
	function reset() {
		const o = getOpts();
		gw = Math.max(8, Math.round(W * scale)); gh = Math.max(8, Math.round(H * scale));
		state = new Uint8Array(gw * gh); next = new Uint8Array(gw * gh);
		// The letters ARE the source — a permanent excited region. No random noise,
		// so waves radiate cleanly from the exact typography shape.
		const cov = textMaskAt(gw, gh, o);
		source = new Uint8Array(gw * gh);
		for (let i = 0; i < gw * gh; i++) if (cov[i] > 0.5) { source[i] = 1; state[i] = 1; }
		small = document.createElement('canvas'); small.width = gw; small.height = gh;
		sctx = small.getContext('2d'); sdata = sctx.createImageData(gw, gh);
		acc = 0;
		for (let k = 0; k < N + 4; k++) iterate(); // warm up so frame 0 already has rings
	}
	// Advance the CA by however many iterations `dt` × sim-speed calls for, so the
	// Speed slider actually changes how fast the waves travel (fps-independent).
	function step(dt) {
		acc += (dt || 1 / 30) * BASE_HZ * (getOpts().simSpeed || 1);
		let n = 0;
		while (acc >= 1 && n < 10) { iterate(); acc -= 1; n++; }
	}
	function iterate() {
		ensureOffsets();
		const M = OFF.length;
		for (let y = 0; y < gh; y++) {
			const yc = y * gw;
			for (let x = 0; x < gw; x++) {
				const idx = yc + x, s = state[idx];
				if (s !== 0) { next[idx] = (s + 1) % N; continue; }
				let c = 0;
				for (let k = 0; k < M; k += 2) {
					const nx = x + OFF[k], ny = y + OFF[k + 1];
					if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && state[ny * gw + nx] === 1) { if (++c >= THRESH) break; }
				}
				next[idx] = c >= THRESH ? 1 : 0;
			}
		}
		const tmp = state; state = next; next = tmp;
		// Re-ignite the letters every step → they pace target waves at period N.
		for (let i = 0; i < gw * gh; i++) if (source[i]) state[i] = 1;
	}
	function render(ctx) {
		const o = getOpts();
		const bg = hexToRgb(o.bg), ac = hexToRgb(o.accent), fg = hexToRgb(o.fg);
		// Gradient stepping (bands) posterises the fade so you can see the steps;
		// fade (0..1) controls the falloff from wavefront → background (crisp rings
		// ↔ soft glow).
		const bands = clamp(Math.round(o.bzBands || 20), 2, N);
		const k = lerp(4, 0.7, clamp(o.bzFade ?? 0.4, 0, 1));
		const lut = [bg];
		for (let s = 1; s < N; s++) {
			let a = (s - 1) / (N - 1);                        // 0 fresh front → 1 old
			a = Math.round(a * (bands - 1)) / (bands - 1);    // posterise into `bands` steps
			const bright = Math.pow(1 - a, k);
			const hue = a < 0.25 ? mix3(fg, ac, a / 0.25) : ac;
			lut[s] = mix3(bg, hue, bright);
		}
		const px = sdata.data;
		for (let i = 0; i < gw * gh; i++) { const c = lut[state[i]]; const j = i * 4; px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255; }
		sctx.putImageData(sdata, 0, 0);
		// Light blur on the upscale softens the remaining pixel stair-stepping so the
		// rounded fronts read as smooth, pretty curves. Skipped when bands are low so
		// hard "stepped" gradients stay crisp.
		ctx.imageSmoothingEnabled = true;
		const b = bands >= 6 ? Math.max(0.6, (ctx.canvas.width / gw) * 0.6) : 0;
		ctx.filter = b ? `blur(${b}px)` : 'none';
		ctx.drawImage(small, 0, 0, gw, gh, 0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.filter = 'none';
	}
	return { reset, step, render };
}

// Cyclic cellular automaton — a cell in state s advances to (s+1)%N when enough
// neighbours already hold the next state. From noise it self-organises into
// rotating spirals; the text biases the initial field.
function sceneCCA(env) {
	const { W, H, getOpts, rng } = env;
	const N = 16, THRESH = 1, scale = 0.32, BASE_HZ = 16;
	let gw, gh, state, next, small, sctx, sdata, acc;
	function reset() {
		const o = getOpts();
		gw = Math.max(6, Math.round(W * scale)); gh = Math.max(6, Math.round(H * scale));
		state = new Uint8Array(gw * gh); next = new Uint8Array(gw * gh);
		const mask = textMaskAt(gw, gh, o);
		for (let i = 0; i < gw * gh; i++) state[i] = mask[i] > 0.45 ? 1 : (rng() * N) | 0;
		small = document.createElement('canvas'); small.width = gw; small.height = gh;
		sctx = small.getContext('2d'); sdata = sctx.createImageData(gw, gh);
		acc = 0;
	}
	function step(dt) {
		acc += (dt || 1 / 30) * BASE_HZ * (getOpts().simSpeed || 1);
		let n = 0;
		while (acc >= 1 && n < 8) { iterate(); acc -= 1; n++; }
	}
	function iterate() {
		for (let y = 0; y < gh; y++) {
			const yu = ((y - 1 + gh) % gh) * gw, yd = ((y + 1) % gh) * gw, yc = y * gw;
			for (let x = 0; x < gw; x++) {
				const idx = yc + x, s = state[idx], want = (s + 1) % N;
				const xl = (x - 1 + gw) % gw, xr = (x + 1) % gw;
				let c = 0;
				if (state[yu + x] === want) c++; if (state[yd + x] === want) c++;
				if (state[yc + xl] === want) c++; if (state[yc + xr] === want) c++;
				next[idx] = c >= THRESH ? want : s;
			}
		}
		const tmp = state; state = next; next = tmp;
	}
	function render(ctx) {
		const o = getOpts();
		const stops = [hexToRgb(o.bg), hexToRgb(o.accent), hexToRgb(o.fg)];
		const lut = [];
		for (let s = 0; s < N; s++) {
			const pos = (s / N) * 2, k = Math.min(1, Math.floor(pos)), f = pos - k;
			lut[s] = mix3(stops[k], stops[k + 1], f);
		}
		const px = sdata.data;
		for (let i = 0; i < gw * gh; i++) { const c = lut[state[i]]; const j = i * 4; px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255; }
		sctx.putImageData(sdata, 0, 0);
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(small, 0, 0, gw, gh, 0, 0, ctx.canvas.width, ctx.canvas.height);
	}
	return { reset, step, render };
}

// Perlin flow field — every particle is born ON the letters and streams along a
// smooth curling noise field, fading. Because particles constantly respawn on
// the text, the typography stays legible as the glowing emitter while ribbons
// flow off it. (No off-text spawning → the shape is respected.)
function sceneFlow(env) {
	const { W, H, getOpts, rng, noise } = env;
	let buf, bctx, parts, t, seeds;
	const COUNT = Math.min(4200, Math.round(W * 4.2));
	function spawn(p) {
		const s = seeds[(rng() * seeds.length) | 0];
		p.x = s[0] * W; p.y = s[1] * H; p.life = 22 + rng() * 46;
	}
	function reset() {
		const o = getOpts();
		buf = document.createElement('canvas'); buf.width = W; buf.height = H;
		bctx = buf.getContext('2d'); bctx.lineCap = 'round';
		bctx.fillStyle = o.bg; bctx.fillRect(0, 0, W, H);
		// dense seed points sampled from the letters (higher-res mask = crisp shape)
		const mw = 320, mh = Math.max(2, Math.round(320 * H / W));
		const cov = textMaskAt(mw, mh, o);
		seeds = [];
		for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (cov[y * mw + x] > 0.5) seeds.push([x / mw, y / mh]);
		if (!seeds.length) seeds.push([0.5, 0.5]);
		parts = Array.from({ length: COUNT }, () => { const p = { x: 0, y: 0, life: 0 }; spawn(p); p.life = rng() * 50; return p; });
		t = 0;
		for (let k = 0; k < 45; k++) step(1 / 30); // warm up so frame 0 has streams
	}
	function step(dt) {
		const o = getOpts();
		const spd = o.simSpeed || 1;
		t += dt * spd;
		bctx.globalAlpha = 0.05; bctx.fillStyle = o.bg; bctx.fillRect(0, 0, W, H); bctx.globalAlpha = 1;
		const sp = 1.35 * (W / 960) * spd, ns = 0.0022;
		bctx.lineWidth = 1.2;
		for (const p of parts) {
			const ang = noise(p.x * ns, p.y * ns + t * 0.14) * TAU;
			const nx = p.x + Math.cos(ang) * sp, ny = p.y + Math.sin(ang) * sp;
			bctx.strokeStyle = mixCss(o.fg, o.accent, 0.5 + 0.5 * Math.sin((p.y / H) * 4 + t));
			bctx.globalAlpha = 0.55;
			bctx.beginPath(); bctx.moveTo(p.x, p.y); bctx.lineTo(nx, ny); bctx.stroke();
			p.x = nx; p.y = ny; p.life--;
			if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) spawn(p);
		}
		bctx.globalAlpha = 1;
	}
	function render(ctx) { ctx.drawImage(buf, 0, 0); }
	return { reset, step, render };
}
function mixCss(a, b, t) { return cssRgb(mix3(hexToRgb(a), hexToRgb(b), clamp(t, 0, 1))); }

// Pixel sort — glitch a live kinetic-type frame: within each column, spans
// brighter than a moving threshold get their pixels sorted by brightness.
function sceneSort(env) {
	const { W, H, getOpts } = env;
	let t = 0;
	function reset() { t = 0; }
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
		renderFrame(ctx, phase, buildRenderOpts(o, W, H));
		const thr = 0.28 + 0.34 * (0.5 + 0.5 * Math.sin(TAU * t / (o.duration || 3)));
		const img = ctx.getImageData(0, 0, W, H);
		const d = img.data;
		const lum = (i) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
		for (let x = 0; x < W; x++) {
			let y = 0;
			while (y < H) {
				if (lum((y * W + x) * 4) <= thr) { y++; continue; }
				let y2 = y;
				while (y2 < H && lum((y2 * W + x) * 4) > thr) y2++;
				// collect + sort span by brightness
				const span = [];
				for (let k = y; k < y2; k++) { const i = (k * W + x) * 4; span.push([d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114, d[i], d[i + 1], d[i + 2]]); }
				span.sort((a, b) => a[0] - b[0]);
				for (let k = y; k < y2; k++) { const i = (k * W + x) * 4, s = span[k - y]; d[i] = s[1]; d[i + 1] = s[2]; d[i + 2] = s[3]; }
				y = y2;
			}
		}
		ctx.putImageData(img, 0, 0);
	}
	return { reset, step, render };
}

// Random walk — walkers released from the letters wander under a noise bias,
// weaving a growing web that slowly fades. Reseed keeps it alive.
function sceneWalk(env) {
	const { W, H, getOpts, rng, noise } = env;
	let buf, bctx, walkers, t, seeds;
	const COUNT = Math.min(220, Math.round(W / 5));
	function seedPt() { return seeds.length ? seeds[(rng() * seeds.length) | 0] : [rng(), rng()]; }
	function reset() {
		const o = getOpts();
		buf = document.createElement('canvas'); buf.width = W; buf.height = H;
		bctx = buf.getContext('2d'); bctx.fillStyle = o.bg; bctx.fillRect(0, 0, W, H);
		const mw = 300, mh = Math.max(2, Math.round(300 * H / W));
		const cov = textMaskAt(mw, mh, o);
		seeds = [];
		for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (cov[y * mw + x] > 0.5 && rng() < 0.3) seeds.push([x / mw, y / mh]);
		if (!seeds.length) seeds.push([0.5, 0.5]);
		walkers = Array.from({ length: COUNT }, () => { const s = seedPt(); return { x: s[0] * W, y: s[1] * H, a: rng() * TAU, life: 40 + rng() * 80 }; });
		t = 0;
		for (let k = 0; k < 30; k++) step(1 / 30); // warm up so frame 0 has some web
	}
	function step(dt) {
		const o = getOpts();
		const spd = o.simSpeed || 1;
		t += dt * spd;
		bctx.globalAlpha = 0.02; bctx.fillStyle = o.bg; bctx.fillRect(0, 0, W, H); bctx.globalAlpha = 1;
		const sp = 2.2 * (W / 960) * spd;
		bctx.lineWidth = 1.2; bctx.lineCap = 'round';
		for (const w of walkers) {
			w.a += (noise(w.x * 0.004, w.y * 0.004 + t * 0.1)) * 0.9 + (rng() - 0.5) * 0.9;
			const nx = w.x + Math.cos(w.a) * sp, ny = w.y + Math.sin(w.a) * sp;
			bctx.strokeStyle = mixCss(o.accent, o.fg, 0.35);
			bctx.globalAlpha = 0.8;
			bctx.beginPath(); bctx.moveTo(w.x, w.y); bctx.lineTo(nx, ny); bctx.stroke();
			w.x = nx; w.y = ny; w.life--;
			if (w.life <= 0 || w.x < 0 || w.x > W || w.y < 0 || w.y > H) { const s = seedPt(); w.x = s[0] * W; w.y = s[1] * H; w.a = rng() * TAU; w.life = 40 + rng() * 80; }
		}
		bctx.globalAlpha = 1;
	}
	function render(ctx) { ctx.drawImage(buf, 0, 0); }
	return { reset, step, render };
}

// Cloth — a Verlet spring mesh pinned along the top; the title is printed on it
// and it ripples under gravity + a noise wind. Quads coloured by how much of
// each cell falls inside a letter.
function sceneCloth(env) {
	const { W, H, getOpts, noise } = env;
	const COLS = 52, ROWS = 30, ITER = 3;
	let px, py, ox, oy, mask, mw, mh, t;
	const idx = (i, j) => j * COLS + i;
	function reset() {
		const o = getOpts();
		px = new Float32Array(COLS * ROWS); py = new Float32Array(COLS * ROWS);
		ox = new Float32Array(COLS * ROWS); oy = new Float32Array(COLS * ROWS);
		const padX = W * 0.06, padY = H * 0.08, gwid = W - padX * 2, ghei = H - padY * 2;
		for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
			const x = padX + gwid * (i / (COLS - 1)), y = padY + ghei * (j / (ROWS - 1));
			px[idx(i, j)] = ox[idx(i, j)] = x; py[idx(i, j)] = oy[idx(i, j)] = y;
		}
		mw = 240; mh = Math.max(2, Math.round(240 * H / W));
		mask = textMaskAt(mw, mh, o);
		t = 0;
	}
	function step(dt) {
		dt = Math.min((dt || 1 / 30) * (getOpts().simSpeed || 1), 0.05); // clamp → stable Verlet
		t += dt;
		const grav = H * 0.9, damp = 0.985;
		const windAmp = W * 1.1;
		for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
			const k = idx(i, j);
			if (j === 0) continue; // pinned top row
			const wind = noise(i * 0.12, t * 0.5 + j * 0.05) * windAmp;
			const vx = (px[k] - ox[k]) * damp, vy = (py[k] - oy[k]) * damp;
			ox[k] = px[k]; oy[k] = py[k];
			px[k] += vx + wind * dt * dt;
			py[k] += vy + grav * dt * dt;
		}
		const restX = (W - W * 0.12) / (COLS - 1), restY = (H - H * 0.16) / (ROWS - 1);
		for (let it = 0; it < ITER; it++) {
			for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
				const k = idx(i, j);
				if (i < COLS - 1) solve(k, idx(i + 1, j), restX, j === 0, j === 0);
				if (j < ROWS - 1) solve(k, idx(i, j + 1), restY, j === 0, false);
			}
		}
	}
	function solve(a, b, rlen, aPinned, _bp) {
		const dx = px[b] - px[a], dy = py[b] - py[a];
		const d = Math.hypot(dx, dy) || 1e-4, diff = (d - rlen) / d;
		const bPinned = b < COLS; // top row
		const wa = aPinned ? 0 : (bPinned ? 1 : 0.5), wb = bPinned ? 0 : (aPinned ? 1 : 0.5);
		px[a] += dx * diff * wa; py[a] += dy * diff * wa;
		px[b] -= dx * diff * wb; py[b] -= dy * diff * wb;
	}
	function covAt(u, v) {
		const x = clamp((u * mw) | 0, 0, mw - 1), y = clamp((v * mh) | 0, 0, mh - 1);
		return mask[y * mw + x];
	}
	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		const bg = hexToRgb(o.bg), fg = hexToRgb(o.fg), ac = hexToRgb(o.accent);
		for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS - 1; i++) {
			const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
			const u = (i + 0.5) / (COLS - 1), v = (j + 0.5) / (ROWS - 1);
			const cov = covAt(u, v);
			if (cov < 0.04) continue; // skip empty cells → show background
			const col = mix3(mix3(ac, fg, clamp(cov * 1.4, 0, 1)), bg, 1 - clamp(cov * 1.8, 0, 1));
			ctx.fillStyle = cssRgb(col);
			ctx.beginPath();
			ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); ctx.lineTo(px[d], py[d]);
			ctx.closePath(); ctx.fill();
		}
	}
	return { reset, step, render };
}

// Step & Repeat — the phrase stacked as N full-width lines filling the page,
// each animating the SAME wave but phase-shifted down the stack (spread = how
// many wave cycles span the page). So the wave crest sits at a different spot in
// every repetition and appears to travel down the wall — a whole page of the
// title breathing out of sync. This is where the variable font shows off.
function sceneTile(env) {
	const { W, H, getOpts } = env;
	let t = 0;
	return {
		reset() { t = 0; },
		step(dt) { t += dt; },
		render(ctx) {
			const o = getOpts();
			paintBg(ctx, o, W, H);
			const N = Math.max(2, Math.round(o.repeats || 12));
			const base = ((t / (o.duration || 3)) % 1 + 1) % 1;
			const lineH = H / N;
			const fontPx = lineH * 0.82;
			const spread = o.spread || 1.5; // wave cycles from top row → bottom row
			for (let r = 0; r < N; r++) {
				const cy = (r + 0.5) * lineH;
				const ph = ((base + (r / N) * spread) % 1 + 1) % 1;
				drawTypeLine(ctx, o.text, ph, o, { cx: W / 2, cy, fontPx, fit: W * 0.94 });
			}
		}
	};
}

// ── registry ─────────────────────────────────────────────────────────────────
export const SCENES = [
	{ id: 'type',  name: 'Kinetic Type', make: sceneType,  usesPreset: true },
	{ id: 'tile',  name: 'Step & Repeat', make: sceneTile, usesPreset: true },
	{ id: 'bz',    name: 'BZ Waves',     make: sceneBZ,    usesPreset: false },
	{ id: 'cca',   name: 'Cyclic CA',    make: sceneCCA,   usesPreset: false },
	{ id: 'flow',  name: 'Flow Field',   make: sceneFlow,  usesPreset: false },
	{ id: 'sort',  name: 'Pixel Sort',   make: sceneSort,  usesPreset: true },
	{ id: 'walk',  name: 'Random Walk',  make: sceneWalk,  usesPreset: false },
	{ id: 'cloth', name: 'Cloth',        make: sceneCloth, usesPreset: false }
];
const SCENE_MAP = Object.fromEntries(SCENES.map((s) => [s.id, s]));

// Build + reset a scene. env: { W, H, getOpts, seed }.
export function makeScene(id, env) {
	const def = SCENE_MAP[id] || SCENE_MAP.type;
	const seed = (env.seed ?? 1) | 0 || 1;
	const rng = mulberry32(seed);
	const scene = def.make({ ...env, rng, noise: makePerlin(mulberry32(seed ^ 0x9e3779b9)) });
	scene.reset();
	return scene;
}
