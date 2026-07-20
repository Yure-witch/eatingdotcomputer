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
//   lorem     — a wall of repeated type with a travelling weight wave sweeping
//               diagonally across it (rebuild of the Codrops variable-font demo)
//   bz        — Belousov–Zhabotinsky: an excitable medium (Greenberg–Hastings
//               cellular automaton) whose waves radiate OUT from the letters
//   cca       — cyclic cellular automaton → self-organising spirals
//   flow      — Perlin-noise flow field; particles born on the text dissolve
//               into curling streams
//   sort      — pixel-sorting glitch over an animated type frame
//   walk      — random walkers tethered to the letterforms, weaving a web
//   cloth     — Verlet cloth: the title printed on a waving banner
//   dots      — halftone wall: a full-page dot grid where the type emerges as
//               big dots, a travelling wave rippling through every dot
//   mosaic    — micro type: the title rebuilt out of tiny copies of its own
//               letters, weight-wave sweeping through the mosaic
//   scatter   — particle type: the title peels apart into swirling glowing
//               particles and reassembles, once per loop (seamless)
//   echo      — concentric outlined copies of the title expanding outward
//               like sound waves (geometric scale ladder → seamless)
//   cmeta     — colour metaballs: crisp solid type with a HIDDEN metaball
//               field revealed only as vibrant colour patches crawling across
//               the letter surface (soft threshold → fades in/out)
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

// hsl helpers (h in 0..360, s/l in 0..1) — for building vibrant palettes.
function rgbToHsl([r, g, b]) {
	r /= 255; g /= 255; b /= 255;
	const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
	if (mx === mn) return [0, 0, l];
	const d = mx - mn;
	const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
	let h;
	if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
	else if (mx === g) h = ((b - r) / d + 2) * 60;
	else h = ((r - g) / d + 4) * 60;
	return [h, s, l];
}
function hslToRgb(h, s, l) {
	h = ((h % 360) + 360) % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// Vibrant hue-spread around the accent colour — saturation/lightness pushed
// into the vivid zone regardless of how muted the accent itself is.
function vibrantPalette(accentHex) {
	const [h, s] = rgbToHsl(hexToRgb(accentHex));
	const S = Math.max(s, 0.85);
	return [h, h + 45, h - 45, h + 105, h + 170, h - 100].map((hh, i) =>
		hslToRgb(hh, S, i % 2 ? 0.55 : 0.62));
}

// Shared background painter (solid / linear / radial) at W×H.
function paintBg(ctx, o, W, H) {
	if (o.bgType === 'gradient') {
		const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, o.bg2 || o.bg); g.addColorStop(1, o.bg); ctx.fillStyle = g;
	} else if (o.bgType === 'radial') {
		const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.72); g.addColorStop(0, o.bg2 || o.bg); g.addColorStop(1, o.bg); ctx.fillStyle = g;
	} else ctx.fillStyle = o.bg;
	ctx.fillRect(0, 0, W, H);
}

// Coin/Sphere backdrop: fixed light/dark paper, or full transparency for
// sticker-style exports (WebP keeps real alpha; GIF gets binary alpha).
// Falls back to the normal palette bg when the theme opt is absent.
// Returns the solid bg colour, or null when transparent.
function paintThemeBg(ctx, o, W, H) {
	const m = o.coinBg;
	if (m === 'transparent') { ctx.clearRect(0, 0, W, H); return null; }
	if (m === 'dark' || m === 'light') {
		const c = m === 'dark' ? '#0c0c0c' : '#ffffff';
		ctx.fillStyle = c; ctx.fillRect(0, 0, W, H);
		return c;
	}
	paintBg(ctx, o, W, H);
	return o.bg;
}

// Paint the Coin/Sphere ink (lines + text) in the solid picker colour, or
// through a 2-stop gradient ON THE OBJECT (not the background). A gradient
// can't be set as the style directly — face text draws under per-glyph
// transforms which would warp it — so the ink is drawn as a mask on a cached
// layer and the gradient composited through it (source-in), screen-aligned.
// Animated = the gradient axis turns one full revolution per loop, so GIF
// exports stay seamless. `L` is a per-scene {cv, ctx} cache object.
// The Coin/Sphere 2-stop gradient: screen-aligned diagonal; when animation is
// on the axis turns one full revolution per loop (seamless). Shared by the
// ink mask (paintInk) and the gradient body fill so both stay in lockstep.
function inkGradient(c, c1, c2, o, W, H, phase) {
	const ang = o.coinInkAnim ? TAU * phase : Math.PI / 4;
	const r = Math.max(W, H) * 0.55, gx = Math.cos(ang) * r, gy = Math.sin(ang) * r;
	const g = c.createLinearGradient(W / 2 - gx, H / 2 - gy, W / 2 + gx, H / 2 + gy);
	g.addColorStop(0, c1);
	g.addColorStop(1, c2);
	return g;
}

// Object body fill for Coin/Sphere: 'solid' → its own flat colour,
// 'gradient' → its own 2-stop gradient (same axis + animation as the ink
// gradient), 'auto' → whatever the caller's theme default is (null = none).
function bodyFill(c, o, W, H, phase, autoFill) {
	if (o.coinBodyMode === 'solid') return o.coinBodyColor || '#ffffff';
	if (o.coinBodyMode === 'gradient')
		return inkGradient(c, o.coinBodyColor || '#ffffff', o.coinBodyColor2 || '#ffe3e3', o, W, H, phase);
	return autoFill;
}

function paintInk(ctx, drawInk, o, W, H, phase, L) {
	if (!o.coinInkGrad) { drawInk(ctx, o.coinInk || o.fg || '#0000ff'); return; }
	if (!L.cv || L.cv.width !== W || L.cv.height !== H) {
		L.cv = document.createElement('canvas'); L.cv.width = W; L.cv.height = H;
		L.ctx = L.cv.getContext('2d');
	}
	const c = L.ctx;
	c.setTransform(1, 0, 0, 1, 0, 0);
	c.globalCompositeOperation = 'source-over';
	c.clearRect(0, 0, W, H);
	drawInk(c, '#000');
	c.globalCompositeOperation = 'source-in';
	c.fillStyle = inkGradient(c, o.coinInk || '#0000ff', o.coinInk2 || '#ff2d2d', o, W, H, phase);
	c.fillRect(0, 0, W, H);
	c.globalCompositeOperation = 'source-over';
	ctx.drawImage(L.cv, 0, 0);
}

// ── text → mask ──────────────────────────────────────────────────────────────
function drawFittedText(ctx, text, W, H, fontPx, fontFamily, weight, hasStretch, stroke = false) {
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
	for (let i = 0; i < letters.length; i++) {
		const a = adv[i] * scale;
		if (stroke) ctx.strokeText(letters[i], x + a / 2, H * 0.5);
		else ctx.fillText(letters[i], x + a / 2, H * 0.5);
		x += a;
	}
}
// Like drawFittedText, but draws ONE line at an arbitrary centre (cx, cy)
// fitted to fitW — the building block for repeated-text walls.
function drawFittedLineAt(ctx, text, cx, cy, fitW, fontPx, fontFamily, weight, hasStretch) {
	const letters = Array.from(text || '');
	if (!letters.length) return;
	ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
	ctx.font = `${weight} ${fontPx}px ${fontFamily}`;
	if (hasStretch) ctx.fontStretch = '100%';
	let total = 0;
	const adv = letters.map((ch) => { const w2 = ctx.measureText(ch).width; total += w2; return w2; });
	const scale = total > 0 ? Math.min(1.7, fitW / total) : 1;
	const px = fontPx * scale;
	ctx.font = `${weight} ${px}px ${fontFamily}`;
	if (hasStretch) ctx.fontStretch = '100%';
	ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	let x = cx - (total * scale) / 2;
	for (let i = 0; i < letters.length; i++) { const a = adv[i] * scale; ctx.fillText(letters[i], x + a / 2, cy); x += a; }
}

// Coverage field (0..1) at gw×gh — 1 inside the letters.
function textMaskAt(gw, gh, o, weight = 700) {
	const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
	const ctx = cv.getContext('2d', { willReadFrequently: true });
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, gw, gh);
	ctx.fillStyle = '#fff';
	drawFittedText(ctx, o.text, gw, gh, gh * (o.fontFrac || 0.3), o.fontFamily, weight, o.hasStretch);
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
	const MAXN = 96;
	// SCALE INVARIANCE (what makes preview == export at any resolution): the grid
	// is ~0.5× the output, and of the pattern parameters ONLY the neighbourhood
	// radius scales with gridF. Wave speed ≈ radius cells/iteration, so screen-
	// space speed, ring spacing (speed × period N) and front thickness all come
	// out as constant FRACTIONS of the canvas. Scaling N or iterations/frame by
	// gridF too (the old behaviour) double-scaled spacing & speed — exports
	// looked nothing like the preview. N and reaction speed are TIME quantities;
	// they must stay fixed across resolutions.
	// Roundedness is a level 0..15 → the disk radius. Level 0 = tiny disk
	// (diamond-ish waves); higher = big round disk → round rings. No cap: the
	// neighbour count uses per-row prefix sums (O(r) per cell, not O(r²)), which
	// keeps export-size radii affordable.
	let gridF = 1;
	let spans = null, THRESH = 4, level = -99;
	function ensureSpans() {
		const L = clamp(Math.round(getOpts().bzRound ?? 6), 0, 15);
		if (L === level) return;
		level = L;
		const r = Math.min(Math.max(1, lerp(1.0, 5.0, L / 15) * gridF), 24), r2 = r * r, R = Math.ceil(r);
		// disk → per-row half-widths: row dy spans dx ∈ [-w, w]
		spans = [];
		let area = 0;
		for (let dy = -R; dy <= R; dy++) {
			if (dy * dy > r2) continue;
			const w = Math.floor(Math.sqrt(r2 - dy * dy));
			spans.push(dy, w);
			area += 2 * w + 1;
		}
		THRESH = Math.max(1, Math.round((area - 1) * 0.16)); // -1: centre cell (resting → never counts)
	}
	// Wave SPACING = the refractory length N in ITERATIONS (a new ring emits every
	// N steps). NOT scaled by gridF — spatial spacing is speed(∝radius∝gridF) × N,
	// so N itself must stay a pure time quantity or spacing double-scales.
	function curN() { return clamp(Math.round(lerp(6, 80, clamp(getOpts().bzSpacing ?? 0.4, 0, 1))), 6, 84); }
	let gw, gh, state, next, source, blocked, nearD, moat, stateA, rowP, small, sctx, sdata, phase;
	// Crisp-line mode (fade = 0) buffers — see renderCrisp().
	let outImg = null, outW = 0, outH = 0, fieldS = null, fieldT = null, fieldM = null;
	function reset() {
		const o = getOpts();
		const long = Math.max(W, H);
		// Grid ≈ 0.5× the output long edge at EVERY resolution, so the upscale
		// ratio stays ~2× and a 1920 export is as crisp as the preview. (The old
		// 760 cap made high-res exports upscale 2.5×+ → crunchy pixels; the
		// prefix-sum neighbour count is what makes the bigger grids affordable.)
		// The PREVIEW is rendered at a capped canvas (see the page) so its grid
		// stays small and smooth to interact with.
		const gridLong = clamp(Math.round(long * 0.5), 220, 960);
		gw = Math.max(8, Math.round(gridLong * W / long)); gh = Math.max(8, Math.round(gridLong * H / long));
		gridF = gridLong / 300; // reference grid = 300 (where the slider ranges are tuned)
		state = new Uint8Array(gw * gh); next = new Uint8Array(gw * gh);
		rowP = new Int32Array((gw + 1) * gh); // per-row prefix sums of the excited mask
		// The letters ARE the source — a permanent excited region. No random noise,
		// so waves radiate cleanly from the exact typography shape.
		const cov = textMaskAt(gw, gh, o);
		source = new Uint8Array(gw * gh);
		for (let i = 0; i < gw * gh; i++) if (cov[i] > 0.5) { source[i] = 1; state[i] = 1; }
		// Counters (the enclosed holes in e/a/o…) are smaller than one wavelength,
		// so every cell inside sits within firing range of the surrounding letter
		// and re-fires non-stop — the holes saturated near-fg and looked SOLID.
		// Flood-fill the non-source region from the border; whatever isn't reached
		// is inside a counter → blocked: never fires, stays background.
		blocked = new Uint8Array(gw * gh);
		{
			const reach = new Uint8Array(gw * gh);
			const queue = new Int32Array(gw * gh);
			let qh = 0, qt = 0;
			const push = (i) => { if (!reach[i] && !source[i]) { reach[i] = 1; queue[qt++] = i; } };
			for (let x = 0; x < gw; x++) { push(x); push((gh - 1) * gw + x); }
			for (let y = 0; y < gh; y++) { push(y * gw); push(y * gw + gw - 1); }
			while (qh < qt) {
				const i = queue[qh++], x = i % gw, y = (i / gw) | 0;
				if (x > 0) push(i - 1);
				if (x < gw - 1) push(i + 1);
				if (y > 0) push(i - gw);
				if (y < gh - 1) push(i + gw);
			}
			for (let i = 0; i < gw * gh; i++) if (!source[i] && !reach[i]) blocked[i] = 1;
		}
		// Distance-from-letters map (BFS, capped at `moat` ≈ the wavefront radius).
		// Freshly-born fronts hug the letter edge in near-fg colour AT GRID RES —
		// that coarse fringe was the "crunchy letter bottoms". The render fades
		// wave colour in from the background over the first `moat` cells, so rings
		// materialise just outside the crisp type instead of smearing against it.
		{
			const L = clamp(Math.round(o.bzRound ?? 6), 0, 15);
			moat = Math.max(2, Math.ceil(Math.max(1, lerp(1.0, 5.0, L / 15) * gridF) * 0.9) + 1);
			nearD = new Uint8Array(gw * gh); nearD.fill(255);
			const queue = new Int32Array(gw * gh);
			let qh = 0, qt = 0;
			for (let i = 0; i < gw * gh; i++) if (source[i]) { nearD[i] = 0; queue[qt++] = i; }
			while (qh < qt) {
				const i = queue[qh++], d = nearD[i];
				if (d >= moat) continue;
				const x = i % gw, y = (i / gw) | 0;
				if (x > 0 && nearD[i - 1] === 255) { nearD[i - 1] = d + 1; queue[qt++] = i - 1; }
				if (x < gw - 1 && nearD[i + 1] === 255) { nearD[i + 1] = d + 1; queue[qt++] = i + 1; }
				if (y > 0 && nearD[i - gw] === 255) { nearD[i - gw] = d + 1; queue[qt++] = i - gw; }
				if (y < gh - 1 && nearD[i + gw] === 255) { nearD[i + gw] = d + 1; queue[qt++] = i + gw; }
			}
		}
		small = document.createElement('canvas'); small.width = gw; small.height = gh;
		sctx = small.getContext('2d'); sdata = sctx.createImageData(gw, gh);
		level = -99; phase = 0; fieldM = null;
		// Warm up one full wave period so frame 0 already shows rings.
		const warm = curN() + 4;
		for (let k = 0; k < warm; k++) iterate();
		stateA = state.slice(); // prev-state snapshot for cross-fade interpolation
	}
	// Reaction speed = CA iterations advanced PER FRAME (fractional) — a TIME
	// quantity, so it is NOT scaled by gridF (screen-space wave motion per frame
	// already scales through the radius). To keep slow motion SMOOTH (not framey)
	// we cross-fade between the previous and current CA state by `phase` (the
	// sub-iteration remainder), so at <1 iteration/frame the waves still glide
	// instead of jumping every few frames. Playback fps is set by GIF speed /
	// Smoothness and is independent of this.
	function step() {
		phase += getOpts().reactionSpeed || 1.5;
		let guard = 0;
		while (phase >= 1 && guard < 8) { stateA.set(state); iterate(); phase -= 1; guard++; }
		if (guard >= 8) phase = 0;
	}
	function iterate() {
		ensureSpans();
		const N = curN(), M = spans.length, stride = gw + 1;
		// Prefix-sum each row of the excited mask, then any disk count is just a
		// handful of row-range subtractions — O(r) per cell instead of O(r²).
		for (let y = 0; y < gh; y++) {
			const yc = y * gw, yp = y * stride;
			rowP[yp] = 0;
			for (let x = 0; x < gw; x++) rowP[yp + x + 1] = rowP[yp + x] + (state[yc + x] === 1 ? 1 : 0);
		}
		for (let y = 0; y < gh; y++) {
			const yc = y * gw;
			for (let x = 0; x < gw; x++) {
				const idx = yc + x, s = state[idx];
				if (s !== 0) { next[idx] = (s + 1) % N; continue; }
				if (blocked[idx]) { next[idx] = 0; continue; } // inside a counter — inert
				let c = 0;
				for (let k = 0; k < M; k += 2) {
					const ny = y + spans[k];
					if (ny < 0 || ny >= gh) continue;
					const w = spans[k + 1];
					const x0 = x - w < 0 ? 0 : x - w;
					const x1 = x + w + 1 > gw ? gw : x + w + 1;
					c += rowP[ny * stride + x1] - rowP[ny * stride + x0];
				}
				next[idx] = c >= THRESH ? 1 : 0;
			}
		}
		const tmp = state; state = next; next = tmp;
		// Re-ignite the letters every step → they pace target waves at period N.
		for (let i = 0; i < gw * gh; i++) if (source[i]) state[i] = 1;
	}
	// CRISP-LINE MODE (fade = 0). The tail-less front is a ~radius-wide band at
	// GRID resolution; pushing it through the small-canvas blur-upscale is what
	// made it read low-res. Instead: build the front as a scalar field, bilinear-
	// sample it per OUTPUT pixel and smoothstep around the ridge — an SDF-style
	// iso-line with clean anti-aliased edges at any export size. No stateA
	// cross-fade here: a hard threshold turns intensity cross-fades into flicker
	// (a mid-fade front dims below the cut), so this mode snaps to the latest CA
	// state. The moat fade-in near the letters is preserved by sampling the
	// (already smooth) BFS distance as a second field and scaling alpha AFTER
	// the threshold — folding it into the field would re-harden it into a pop.
	function renderCrisp(ctx, bg, fg) {
		const cw = ctx.canvas.width, ch = ctx.canvas.height, n = gw * gh;
		if (!fieldS || fieldS.length !== n) { fieldS = new Float32Array(n); fieldT = new Float32Array(n); }
		if (!fieldM || fieldM.length !== n) {
			fieldM = new Float32Array(n);
			for (let i = 0; i < n; i++) fieldM[i] = nearD[i] < moat ? nearD[i] / moat : 1;
		}
		for (let i = 0; i < n; i++) fieldS[i] = state[i] === 1 ? 1 : 0;
		// One separable 1-2-1 pass rounds the grid stair-steps so the iso-line
		// follows curves, not cells. (A 1-cell ridge peaks at 0.5 after this —
		// the thresholds below sit under that so thin fronts keep a solid core.)
		for (let y = 0; y < gh; y++) {
			const yc = y * gw;
			for (let x = 0; x < gw; x++) {
				const l = fieldS[yc + (x > 0 ? x - 1 : 0)], c = fieldS[yc + x], r = fieldS[yc + (x < gw - 1 ? x + 1 : x)];
				fieldT[yc + x] = (l + 2 * c + r) * 0.25;
			}
		}
		for (let x = 0; x < gw; x++) {
			for (let y = 0; y < gh; y++) {
				const u = fieldT[(y > 0 ? y - 1 : 0) * gw + x], c = fieldT[y * gw + x], d = fieldT[(y < gh - 1 ? y + 1 : y) * gw + x];
				fieldS[y * gw + x] = (u + 2 * c + d) * 0.25;
			}
		}
		if (!outImg || outW !== cw || outH !== ch) { outImg = ctx.createImageData(cw, ch); outW = cw; outH = ch; }
		const px = outImg.data;
		const T0 = 0.2, T1 = 0.42, inv = 1 / (T1 - T0);
		let j = 0;
		for (let y = 0; y < ch; y++) {
			let gy = ((y + 0.5) * gh) / ch - 0.5;
			if (gy < 0) gy = 0; else if (gy > gh - 1.001) gy = gh - 1.001;
			const y0 = gy | 0, fy = gy - y0, r0 = y0 * gw, r1 = r0 + gw;
			for (let x = 0; x < cw; x++, j += 4) {
				let gx = ((x + 0.5) * gw) / cw - 0.5;
				if (gx < 0) gx = 0; else if (gx > gw - 1.001) gx = gw - 1.001;
				const x0 = gx | 0, fx = gx - x0;
				const v = (fieldS[r0 + x0] * (1 - fx) + fieldS[r0 + x0 + 1] * fx) * (1 - fy)
				        + (fieldS[r1 + x0] * (1 - fx) + fieldS[r1 + x0 + 1] * fx) * fy;
				let a = (v - T0) * inv;
				a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
				if (a > 0) {
					const m = (fieldM[r0 + x0] * (1 - fx) + fieldM[r0 + x0 + 1] * fx) * (1 - fy)
					        + (fieldM[r1 + x0] * (1 - fx) + fieldM[r1 + x0 + 1] * fx) * fy;
					a *= m;
				}
				px[j] = bg[0] + (fg[0] - bg[0]) * a;
				px[j + 1] = bg[1] + (fg[1] - bg[1]) * a;
				px[j + 2] = bg[2] + (fg[2] - bg[2]) * a;
				px[j + 3] = 255;
			}
		}
		ctx.putImageData(outImg, 0, 0);
	}
	function render(ctx) {
		const o = getOpts();
		const N = curN();
		const bg = hexToRgb(o.bg), ac = hexToRgb(o.accent), fg = hexToRgb(o.fg);
		// FADE = trailing tail length behind each wavefront (independent of spacing):
		//   0   → only the wavefront shows → a single line emanating from the type
		//   1   → the trail fades across the whole gap to the next wave
		// GRADIENT STEPS posterise that tail so you can see the banding. LUT covers
		// 0..MAXN so a just-lowered N (stale states) never indexes past the end.
		const fade = clamp(o.bzFade ?? 0.5, 0, 1);
		if (fade <= 0.02) {
			// Single-line mode → full-res anti-aliased iso-line (see renderCrisp).
			renderCrisp(ctx, bg, fg);
		} else {
		const bands = clamp(Math.round(o.bzBands || 20), 2, N);
		const lut = new Array(MAXN);
		lut[0] = bg;
		for (let s = 1; s < MAXN; s++) {
			const a = clamp((s - 1) / (N - 1), 0, 1);         // 0 fresh front → 1 old
			const u = a / fade;                               // position within the tail
			let bright;
			if (u >= 1) bright = 0;                           // beyond the tail → background
			else { const uu = Math.round(u * (bands - 1)) / (bands - 1); bright = Math.pow(1 - uu, 1.3); }
			const hue = a < 0.25 ? mix3(fg, ac, a / 0.25) : ac;
			lut[s] = mix3(bg, hue, bright);
		}
		// Cross-fade the previous CA state (stateA) → current (state) by `phase` so
		// slow reaction speeds glide instead of stepping. Letters (steady state) are
		// identical in both, so they don't flicker.
		const ph = clamp(phase, 0, 1);
		const px = sdata.data;
		for (let i = 0; i < gw * gh; i++) {
			const a = lut[stateA[i]] || bg, b = lut[state[i]] || bg, j = i * 4;
			let r_ = a[0] + (b[0] - a[0]) * ph, g_ = a[1] + (b[1] - a[1]) * ph, b_ = a[2] + (b[2] - a[2]) * ph;
			// clearance zone: fade wave colour in from bg over the first `moat`
			// cells from the letters (source cells themselves → pure bg; the
			// crisp type overlay is the only letter paint)
			const dN = nearD[i];
			if (dN < moat) {
				const f = dN / moat;
				r_ = bg[0] + (r_ - bg[0]) * f; g_ = bg[1] + (g_ - bg[1]) * f; b_ = bg[2] + (b_ - bg[2]) * f;
			}
			px[j] = r_; px[j + 1] = g_; px[j + 2] = b_; px[j + 3] = 255;
		}
		sctx.putImageData(sdata, 0, 0);
		// Tiny fixed blur just anti-aliases the (now small) upscale into pretty
		// curves; skipped at low bands so hard "stepped" gradients stay crisp. The
		// grid tracks the output resolution, so the upscale ratio stays ~1.8× and
		// this doesn't smear as resolution grows (which used to make it look low-res).
		ctx.imageSmoothingEnabled = true;
		const b = bands >= 6 ? Math.min(1.0, Math.max(0.4, (ctx.canvas.width / gw) * 0.35)) : 0;
		ctx.filter = b ? `blur(${b}px)` : 'none';
		ctx.drawImage(small, 0, 0, gw, gh, 0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.filter = 'none';
		}
		// Crisp type overlay — the ONLY letter paint (the sim layer renders the
		// source region as background, plus a short fade-in clearance around it,
		// so nothing grid-res ever touches the letter edge). Hairline stroke just
		// covers sub-cell alignment noise; a fat stroke here reads as fake bold.
		const cw = ctx.canvas.width, ch = ctx.canvas.height;
		ctx.fillStyle = o.fg; ctx.strokeStyle = o.fg;
		ctx.lineWidth = Math.max(1, (cw / gw) * 0.6);
		ctx.lineJoin = 'round';
		drawFittedText(ctx, o.text, cw, ch, ch * (o.fontFrac || 0.3), o.fontFamily, 700, o.hasStretch, true);
		drawFittedText(ctx, o.text, cw, ch, ch * (o.fontFrac || 0.3), o.fontFamily, 700, o.hasStretch);
	}
	return { reset, step, render };
}

// Cyclic cellular automaton — a cell in state s advances to (s+1)%N when enough
// neighbours already hold the next state. From noise it self-organises into
// rotating spirals; the text biases the initial field.
function sceneCCA(env) {
	const { W, H, getOpts, rng } = env;
	const THRESH = 1;
	// Grid tracks the output resolution (crisp). SCALE INVARIANCE: the spiral
	// wavelength is ~N cells (front speed is 1 cell/iteration, period N), so N
	// scales with gridF to keep features a constant FRACTION of the canvas —
	// with a fixed N a fine export grid grew much finer spirals than the preview
	// showed. Iterations/frame also scale by gridF (cell-speed is fixed), which
	// keeps screen-space motion and rotation rate consistent per frame.
	let gridF = 1, N = 16;
	let gw, gh, state, next, stateA, small, sctx, sdata, phase;
	function reset() {
		const o = getOpts();
		const long = Math.max(W, H);
		// ≈0.45× the output at every resolution (cap high enough for 1920) → crisp.
		const gridLong = clamp(Math.round(long * 0.45), 190, 900);
		gw = Math.max(6, Math.round(gridLong * W / long)); gh = Math.max(6, Math.round(gridLong * H / long));
		gridF = gridLong / 240;
		N = clamp(Math.round(16 * gridF), 8, 200);
		state = new Uint8Array(gw * gh); next = new Uint8Array(gw * gh);
		const mask = textMaskAt(gw, gh, o);
		for (let i = 0; i < gw * gh; i++) state[i] = mask[i] > 0.45 ? 1 : (rng() * N) | 0;
		small = document.createElement('canvas'); small.width = gw; small.height = gh;
		sctx = small.getContext('2d'); sdata = sctx.createImageData(gw, gh);
		phase = 0; stateA = state.slice();
	}
	// Cross-fade between CA states by `phase` so slow reaction speeds glide (see BZ).
	function step() {
		phase += (getOpts().reactionSpeed || 1.5) * gridF;
		let guard = 0, cap = Math.ceil(14 * gridF) + 2;
		while (phase >= 1 && guard < cap) { stateA.set(state); iterate(); phase -= 1; guard++; }
		if (guard >= cap) phase = 0;
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
		const ph = clamp(phase, 0, 1);
		const px = sdata.data;
		for (let i = 0; i < gw * gh; i++) {
			const a = lut[stateA[i]], b = lut[state[i]], j = i * 4;
			px[j] = a[0] + (b[0] - a[0]) * ph; px[j + 1] = a[1] + (b[1] - a[1]) * ph; px[j + 2] = a[2] + (b[2] - a[2]) * ph; px[j + 3] = 255;
		}
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
	const COUNT = 3600; // fixed (motion scales by W/960) → resolution-independent
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
	function step() {
		const o = getOpts();
		const spd = o.reactionSpeed || 1.5;
		t += 0.033 * spd;
		bctx.globalAlpha = 0.05; bctx.fillStyle = o.bg; bctx.fillRect(0, 0, W, H); bctx.globalAlpha = 1;
		const sp = 0.9 * (W / 960) * spd, ns = 0.0022;
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
// each tethered to its seed point by a soft spring so the web stays gathered
// ON the letterforms and the title keeps reading. Trails live on a TRANSPARENT
// buffer faded with destination-out: fading by overpainting the bg colour never
// fully clears (8-bit rounding leaves a permanent grey smear that eventually
// buries the type — the old bug); knocking alpha out decays to invisible.
function sceneWalk(env) {
	const { W, H, getOpts, rng, noise } = env;
	let trail, tctx, walkers, t, seeds;
	const COUNT = 260; // fixed (motion scales by W/960) → resolution-independent
	function spawn(w) {
		const s = seeds[(rng() * seeds.length) | 0];
		w.hx = s[0] * W; w.hy = s[1] * H;
		w.x = w.hx; w.y = w.hy;
		w.a = rng() * TAU;
		w.life = 50 + rng() * 110;
		w.c = rng(); // per-walker colour position (accent↔fg)
	}
	function reset() {
		const o = getOpts();
		trail = document.createElement('canvas'); trail.width = W; trail.height = H;
		tctx = trail.getContext('2d'); tctx.lineCap = 'round';
		const mw = 320, mh = Math.max(2, Math.round(320 * H / W));
		const cov = textMaskAt(mw, mh, o);
		seeds = [];
		for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (cov[y * mw + x] > 0.5) seeds.push([(x + 0.5) / mw, (y + 0.5) / mh]);
		if (!seeds.length) seeds.push([0.5, 0.5]);
		walkers = Array.from({ length: COUNT }, () => { const w = {}; spawn(w); w.life = 20 + rng() * 120; return w; });
		t = 0;
		for (let k = 0; k < 36; k++) step(); // warm up so frame 0 has some web
	}
	function step() {
		const o = getOpts();
		const spd = o.reactionSpeed || 1.5;
		t += 0.033 * spd;
		// Fade old ink by knocking alpha OUT of the transparent trail buffer.
		tctx.globalCompositeOperation = 'destination-out';
		tctx.globalAlpha = 0.05; tctx.fillStyle = '#000'; tctx.fillRect(0, 0, W, H);
		tctx.globalCompositeOperation = 'source-over'; tctx.globalAlpha = 1;
		const sp = 1.6 * (W / 960) * spd;
		const spring = Math.min(0.012 * spd, 0.05); // pull back toward the seed point
		tctx.lineWidth = Math.max(1, W / 960) * 1.25;
		for (const w of walkers) {
			w.a += noise(w.x * 0.005, w.y * 0.005 + t * 0.12) * 1.1 + (rng() - 0.5) * 0.8;
			const nx = w.x + Math.cos(w.a) * sp + (w.hx - w.x) * spring;
			const ny = w.y + Math.sin(w.a) * sp + (w.hy - w.y) * spring;
			tctx.strokeStyle = mixCss(o.accent, o.fg, w.c * 0.7);
			tctx.globalAlpha = 0.75;
			tctx.beginPath(); tctx.moveTo(w.x, w.y); tctx.lineTo(nx, ny); tctx.stroke();
			w.x = nx; w.y = ny; w.life--;
			if (w.life <= 0 || w.x < -20 || w.x > W + 20 || w.y < -20 || w.y > H + 20) spawn(w);
		}
		tctx.globalAlpha = 1;
	}
	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		// Faint ghost of the title under the web anchors legibility.
		ctx.globalAlpha = 0.07; ctx.fillStyle = o.fg;
		drawFittedText(ctx, o.text, W, H, H * (o.fontFrac || 0.3), o.fontFamily, 700, o.hasStretch);
		ctx.globalAlpha = 1;
		ctx.drawImage(trail, 0, 0);
	}
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
	function step() {
		const dt = Math.min(0.03 * (getOpts().reactionSpeed || 1.5), 0.05); // per-frame, clamped → stable Verlet
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
			const cols = Math.max(1, Math.round(o.tileCols || 1)); // side-by-side copies of the wall
			const base = ((t / (o.duration || 3)) % 1 + 1) % 1;
			const lineH = H / N;
			const fontPx = lineH * 0.82;
			const spread = o.spread || 1.5; // wave cycles from top row → bottom row
			// negative gap → columns overlap (the copies interleave)
			const gutter = cols > 1 ? W * clamp(o.tileGap ?? 0.02, -0.15, 0.15) : 0;
			const colW = (W - gutter * (cols - 1)) / cols;
			for (let col = 0; col < cols; col++) {
				const cx = col * (colW + gutter) + colW / 2;
				for (let r = 0; r < N; r++) {
					const cy = (r + 0.5) * lineH;
					const ph = ((base + (r / N) * spread) % 1 + 1) % 1;
					drawTypeLine(ctx, o.text, ph, o, { cx, cy, fontPx, fit: colW * 0.94 });
				}
			}
		}
	};
}

// Variable-font wave wall — a faithful real-variable-font rebuild of the Codrops
// "cdw-variable-type" demo (which faked the weights with a pre-rendered sprite
// atlas). The canvas is tiled edge-to-edge with rows of the repeated title; a
// travelling sine wave modulates each glyph's WEIGHT (the wght axis) and every
// row is phase-offset, so a diagonal ripple of boldness sweeps across the wall.
// Seamless-looping: over the duration the wave advances an integer number of
// full periods, so the GIF joins with no jump.
//   weight = mix(wLo, wHi, 0.5 + 0.5·cos(2π·(col + row·diag − wavePos) / period))
function sceneLorem(env) {
	const { W, H, getOpts } = env;
	let t = 0;
	return {
		reset() { t = 0; },
		step(dt) { t += dt; },
		render(ctx) {
			const o = getOpts();
			paintBg(ctx, o, W, H);
			const src = Array.from(o.text || 'lorem');
			if (!src.length) return;
			const fam = o.fontFamily;
			const rows = Math.max(2, Math.round(o.lwRows || 18));
			const cols = Math.max(1, Math.round(o.lwCols || 1));    // side-by-side text blocks
			const period = Math.max(2, o.lwPeriod || 8);            // wave length, in glyph cells
			const diag = o.lwDiag ?? 1.2;                           // per-row phase offset → diagonal
			const punch = clamp(o.lwAmp ?? 1, 0, 1);                // fraction of the wght range used
			const loops = Math.max(1, Math.round(o.lwLoops || 1));  // full periods per GIF loop (seamless)
			// wght range 100..700 (Google Sans Flex), centred so 0 punch = flat 400.
			const wLo = lerp(400, 100, punch), wHi = lerp(400, 700, punch);
			const lineH = H / rows;
			const fontPx = lineH * 0.94;
			const base = ((t / (o.duration || 3)) % 1 + 1) % 1;
			const wavePos = base * period * loops;                  // advances `loops` periods → seamless

			// Fixed cell advances measured at a reference weight, so positions stay put as
			// glyphs thicken (mirrors the original's equal-size sprite cells — no jitter).
			ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
			ctx.font = `400 ${fontPx}px ${fam}`;
			if (o.hasStretch) ctx.fontStretch = '100%';
			const adv = src.map((ch) => ctx.measureText(ch).width || fontPx * 0.5);
			const wordW = adv.reduce((a, b) => a + b, 0) || fontPx;
			const cellW = wordW / src.length;                       // mean advance = the wave's spatial unit

			// Split the width into `cols` blocks separated by a gutter. The wave phase is
			// driven by GLOBAL x (not a per-column glyph count), so the diagonal ripple
			// sweeps continuously across every column instead of restarting per block.
			const gutter = cols > 1 ? fontPx * 0.55 : 0;
			const colW = (W - gutter * (cols - 1)) / cols;
			const copies = Math.ceil(colW / wordW) + 2;

			for (let col = 0; col < cols; col++) {
				const x0 = col * (colW + gutter);
				ctx.save();
				ctx.beginPath(); ctx.rect(x0, 0, colW, H); ctx.clip(); // keep each block off its neighbour
				for (let r = 0; r < rows; r++) {
					const cy = (r + 0.5) * lineH;
					let x = x0;
					loop: for (let c = 0; c < copies; c++) {
						for (let i = 0; i < src.length; i++) {
							const s = 0.5 + 0.5 * Math.cos(TAU * (x / cellW + r * diag - wavePos) / period);
							ctx.font = `${Math.round(lerp(wLo, wHi, s))} ${fontPx}px ${fam}`;
							ctx.fillStyle = mixCss(o.fg, o.accent, s * s); // boldest glyphs pick up the accent
							ctx.fillText(src[i], x, cy);
							x += adv[i];
							if (x > x0 + colW) break loop;
						}
					}
				}
				ctx.restore();
			}
		}
	};
}

// Metaballs — the type rendered as gooey merging blobs. Circles are sampled from
// the letterforms and wobble on a noise field; a blur + alpha-threshold "goo"
// pass (the 2D metaball technique) melds nearby blobs into smooth organic shapes
// that read as the typography. Full-res, so it stays crisp at any resolution.
function sceneMeta(env) {
	const { W, H, getOpts, rng } = env;
	let balls, t, off, octx, tmp, tctx, s, canFilter;
	function reset() {
		const o = getOpts();
		s = clamp(H * (o.fontFrac || 0.3) * 0.16, 6, 70); // blob spacing (Text size drives it)
		const step2 = s * 0.6;
		// Rasterise the mask at HIGH res and point-sample it at each cell centre.
		// (Rasterising AT the coarse cell grid drew the title ~5px tall, so the
		// letterforms smeared into one unreadable blob — the old bug.)
		const mw = 480, mh = Math.max(2, Math.round(480 * H / W));
		const cov = textMaskAt(mw, mh, o);
		const gx = Math.max(4, Math.round(W / step2)), gy = Math.max(4, Math.round(H / step2));
		balls = [];
		for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
			const u = (x + 0.5) / gx, v = (y + 0.5) / gy;
			const mi = clamp((v * mh) | 0, 0, mh - 1) * mw + clamp((u * mw) | 0, 0, mw - 1);
			if (cov[mi] > 0.5) {
				const bx = u * W + (rng() - 0.5) * s * 0.4;
				const by = v * H + (rng() - 0.5) * s * 0.4;
				balls.push({ x0: bx, y0: by, x: bx, y: by, r: s * 0.9 * (0.8 + rng() * 0.4), p1: rng() * TAU, p2: rng() * TAU, p3: rng() * TAU });
			}
		}
		off = document.createElement('canvas'); off.width = W; off.height = H;
		octx = off.getContext('2d', { willReadFrequently: true });
		tmp = document.createElement('canvas'); tctx = tmp.getContext('2d');
		// ctx.filter feature-detect (older Safari lacks it) → low-res upscale fallback.
		octx.filter = 'blur(1px)'; canFilter = octx.filter !== 'none'; octx.filter = 'none';
		t = 0;
	}
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		if (!balls || !balls.length) return;
		// Seamless loop: the wobble runs `k` whole sine cycles per GIF loop
		// (k from the Wobble slider), so the last frame joins the first exactly.
		const k = Math.max(1, Math.round(o.reactionSpeed || 1.5));
		const ph = (((t / (o.duration || 3)) % 1) + 1) % 1 * TAU * k;
		const amp = Math.min(W, H) * 0.035;
		for (const b of balls) {
			b.x = b.x0 + Math.sin(ph + b.p1) * amp;
			b.y = b.y0 + Math.cos(ph + b.p2) * amp * 0.8;
			b.rr = b.r * (0.9 + 0.14 * Math.sin(ph * 2 + b.p3));
		}
		const fgc = hexToRgb(o.fg), acc = hexToRgb(o.accent);
		const R = clamp(s * 0.55, 3, 60); // goo blur — merges neighbours within ~s
		octx.clearRect(0, 0, W, H);
		if (canFilter) {
			octx.filter = `blur(${R}px)`;
			octx.fillStyle = o.fg;
			for (const b of balls) { octx.beginPath(); octx.arc(b.x, b.y, b.rr || b.r, 0, TAU); octx.fill(); }
			octx.filter = 'none';
		} else {
			// Draw the balls at 1/f scale and upsample — the bilinear stretch
			// approximates the gaussian well enough for the threshold pass.
			const f = clamp(R / 2.5, 2, 10);
			tmp.width = Math.max(2, Math.round(W / f)); tmp.height = Math.max(2, Math.round(H / f));
			tctx.fillStyle = o.fg;
			for (const b of balls) { tctx.beginPath(); tctx.arc(b.x / f, b.y / f, (b.rr || b.r) / f, 0, TAU); tctx.fill(); }
			octx.imageSmoothingEnabled = true;
			octx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, W, H);
		}
		// Threshold the blurred alpha into hard-but-anti-aliased metaball edges, and
		// tint a thin rim toward the accent so the goo has a little depth.
		const img = octx.getImageData(0, 0, W, H), d = img.data;
		for (let i = 0; i < d.length; i += 4) {
			const a0 = d[i + 3];
			const a = clamp((a0 - 118) * 6, 0, 255);
			if (a <= 0) { d[i + 3] = 0; continue; }
			const rim = a0 < 150 ? (150 - a0) / 32 : 0; // near the edge → toward accent
			const m = clamp(rim, 0, 1);
			d[i] = fgc[0] + (acc[0] - fgc[0]) * m;
			d[i + 1] = fgc[1] + (acc[1] - fgc[1]) * m;
			d[i + 2] = fgc[2] + (acc[2] - fgc[2]) * m;
			d[i + 3] = a;
		}
		octx.putImageData(img, 0, 0);
		ctx.drawImage(off, 0, 0);
	}
	return { reset, step, render };
}

// Colour metaballs — hairline gray type that DEFORMS where hidden metaballs
// press against it: in the influence zones the letterform SWELLS into fat
// gooey colour-filled blobs, easing back to the untouched hairline where the
// influence fades to zero. Mechanically: a soft "inflation field" is pre-built
// by blurring the BOLD cut of the same text; on its own it never crosses the
// visibility threshold, but multiplied up by the metaball field it does — and
// the crossing contour sits further out the stronger the local influence, so
// the type literally inflates with the blobs. Colour comes from the balls
// (vibrant palette, hue-shifting), shaded by field iso-levels so the blob
// topology reads. Seamless loop (all motion = whole sine cycles).
// Shared builder for the two colour-metaball modes:
//   twoState = false → "Color Metaballs": swell grows CONTINUOUSLY with local
//                      influence (the goo inflates by degrees).
//   twoState = true  → "Blob Color": there are exactly TWO letter states — the
//                      hairline default and one fixed BLOB state (bold,
//                      rounded). Influence only chooses WHERE the blob state
//                      shows; it saturates fast, so any touched region snaps
//                      to full blobbiness, and colour is strictly bounded by
//                      that max-blob silhouette (the metaballs are the
//                      selector, never the limit of the shape).
// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, separable
// lower-envelope-of-parabolas) — D holds SQUARED distances in-place (0 = seed,
// large = far). Exact EDT gives perfectly ROUND iso-contours; the old chamfer
// approximation rendered every blob bulge as a faceted octagon (crunchy edges).
function edt2d(D, W, H) {
	const INF = 1e12, L = Math.max(W, H);
	const f = new Float64Array(L), dOut = new Float64Array(L);
	const v = new Int32Array(L), z = new Float64Array(L + 1);
	function scan(get, set, len) {
		for (let q = 0; q < len; q++) f[q] = get(q);
		let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
		for (let q = 1; q < len; q++) {
			let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
			k++; v[k] = q; z[k] = s; z[k + 1] = INF;
		}
		k = 0;
		for (let q = 0; q < len; q++) {
			while (z[k + 1] < q) k++;
			dOut[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
		}
		for (let q = 0; q < len; q++) set(q, dOut[q]);
	}
	for (let x = 0; x < W; x++) scan((y) => D[y * W + x], (y, val) => { D[y * W + x] = val; }, H);
	for (let y = 0; y < H; y++) scan((x) => D[y * W + x], (x, val) => { D[y * W + x] = val; }, W);
}

// exp(-x) table (lerped on read) for the analytic influence field — x ∈ [0,12).
const EXPLUT = new Float32Array(514);
for (let i = 0; i < 514; i++) EXPLUT[i] = Math.exp(-i / 42.6);

// variant: 0 = Color Metaballs (continuous swell), 1 = Blob 1 (viscous
// ferrofluid, tight cling, long red moment), 2 = Blob 2 (smoother contours,
// hotter text glowing through the blob, low emphasis spreads wide/watery).
function colorMetaScene(env, variant) {
	const { W, H, getOpts, rng } = env;
	const twoState = variant >= 1;
	const fluid = variant === 2;
	const WGT = 100; // hairline cut — the resting state of the type
	let balls, clusters, t, field, fctx, tmp, tctx, tsField, tsMax, nField, canFilter, pal, rB, podR, mArrF, imgF;
	function reset() {
		const o = getOpts();
		pal = vibrantPalette(o.accent);
		const fontPx = H * (o.fontFrac || 0.3);
		const mw = 400, mh = Math.max(2, Math.round(400 * H / W));
		const cov = textMaskAt(mw, mh, o, 600);
		const cells = [];
		for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (cov[y * mw + x] > 0.5) cells.push([x, y]);
		field = document.createElement('canvas'); field.width = W; field.height = H;
		fctx = field.getContext('2d', { willReadFrequently: true });
		tmp = document.createElement('canvas'); tctx = tmp.getContext('2d');
		fctx.filter = 'blur(1px)'; canFilter = fctx.filter !== 'none'; fctx.filter = 'none';
		// Bead scale keys off the FITTED letter height measured from the mask —
		// keying off the raw font size made beads oversized whenever a long
		// title got scaled down to fit, so each bead blotted out a glyph chunk
		// instead of tracing it.
		let letterH = fontPx;
		if (cells.length) {
			let minY = mh, maxY = 0;
			for (const c of cells) { if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1]; }
			letterH = Math.max(8, ((maxY - minY + 1) / mh) * H);
		}
		rB = clamp(letterH * 0.2, 3, 60);      // bead radius ≈ stroke scale
		podR = letterH * 1.6;                  // influence-region radius (a few letters)
		// EVEN bead coverage: shuffle the stroke cells, then greedily accept any
		// cell not within one bead-spacing of an accepted bead (grid-hashed).
		// Result: beads finely and EVENLY strung along every letterform — random
		// sampling left clumps and holes, which is why the chain never read as
		// following the letters. Beads are STATIC; all life comes from the pod
		// envelopes below.
		clusters = []; balls = [];
		if (cells.length) {
			const NC = 5;
			let guard = 0;
			while (clusters.length < NC && guard++ < 500) {
				const c = cells[(rng() * cells.length) | 0];
				const cx = ((c[0] + 0.5) / mw) * W, cy = ((c[1] + 0.5) / mh) * H;
				if (clusters.every((q) => Math.hypot(q.x0 - cx, q.y0 - cy) > W * 0.14))
					// offsets packed into ~3/4 of the loop → the last quarter is a
					// QUIET window: plain hairline text, no blobs. Form contrast.
					clusters.push({ x0: cx, y0: cy, off: ((clusters.length + rng() * 0.35) / NC) * 0.75 });
			}
			if (fluid) {
				// Blob 2 computes its influence analytically from the pods (float
				// precision) — beads and the giant canvas blur are skipped: the
				// 8-bit blurred field's quantization terraces were the residual
				// crunch on thin films, and the blur was most of the frame cost.
				mArrF = new Float32Array(W * H);
				imgF = fctx.createImageData(W, H);
				t = 0;
				// (fall through to the distance-field build below)
			} else {
			const order = cells.slice();
			for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const sw = order[i]; order[i] = order[j]; order[j] = sw; }
			const minD = rB * 1.2, cellSz = Math.max(1, minD);
			const gcols = Math.ceil(W / cellSz), grows2 = Math.ceil(H / cellSz);
			const heads = new Int32Array(gcols * grows2).fill(-1);
			const nxt = [];
			outer: for (const c of order) {
				const x = ((c[0] + 0.5) / mw) * W, y = ((c[1] + 0.5) / mh) * H;
				const gx = clamp((x / cellSz) | 0, 0, gcols - 1), gy = clamp((y / cellSz) | 0, 0, grows2 - 1);
				for (let yy = Math.max(0, gy - 1); yy <= Math.min(grows2 - 1, gy + 1); yy++)
					for (let xx = Math.max(0, gx - 1); xx <= Math.min(gcols - 1, gx + 1); xx++) {
						let h = heads[yy * gcols + xx];
						while (h >= 0) {
							const p = balls[h];
							if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minD * minD) continue outer;
							h = nxt[h];
						}
					}
				const pi = (rng() * pal.length) | 0;
				balls.push({
					x, y, r: rB * (0.92 + rng() * 0.16), p2: rng() * TAU,
					cA: pal[pi], cB: pal[(pi + 1 + ((rng() * 3) | 0)) % pal.length]
				});
				nxt.push(heads[gy * gcols + gx]); heads[gy * gcols + gx] = balls.length - 1;
			}
			}
		}
		// twoState (Blob Color): a DISTANCE FIELD from the exact letterform
		// silhouette — the growth ORDER must be "exact text shape first, then
		// outward into blobs". (A blurred-bold hill can't do this: its ridge is
		// highest where strokes are DENSE, so low influence lit random dense
		// patches instead of letter shapes.) nField = 1 on the letters → 0 at
		// max reach (0.7 letter heights out).
		if (twoState) {
			const seed = document.createElement('canvas'); seed.width = W; seed.height = H;
			const sc = seed.getContext('2d', { willReadFrequently: true });
			sc.fillStyle = '#fff';
			// Seed with the SAME hairline weight as the visible text: glyph
			// advances change with weight on a variable font, so a bolder seed
			// laid out at different positions — the clinging film sat visibly
			// offset from the actual letters. The film's slight body comes from
			// the distance ramp, not from a bolder cut.
			drawFittedText(sc, o.text, W, H, fontPx, o.fontFamily, WGT, o.hasStretch);
			const sa = sc.getImageData(0, 0, W, H).data;
			// exact EDT: squared distances, seeds = glyph pixels
			const D = new Float64Array(W * H);
			for (let p = 0; p < W * H; p++) D[p] = sa[p * 4 + 3] > 128 ? 0 : 1e12;
			edt2d(D, W, H);
			const maxReach = Math.max(6, letterH * 0.7);
			nField = new Float32Array(W * H);
			for (let p = 0; p < W * H; p++) nField[p] = clamp(1 - Math.sqrt(D[p]) / maxReach, 0, 1);
			tsField = null; tsMax = 1;
			t = 0;
			return;
		}
		// cmeta: the INFLATION FIELD — the bold cut of the text with a SHORT
		// blur tail, a snug hill hugging every stroke (keeps the swelling ON the
		// letterform path).
		{
			const soft = document.createElement('canvas'); soft.width = W; soft.height = H;
			const sx = soft.getContext('2d', { willReadFrequently: true });
			const Rt = clamp(letterH * 0.16, 2, 40);
			sx.fillStyle = '#fff';
			if (canFilter) {
				sx.filter = `blur(${Rt}px)`;
				drawFittedText(sx, o.text, W, H, fontPx, o.fontFamily, 600, o.hasStretch);
				sx.filter = 'none';
			} else {
				const f = clamp(Rt / 2.5, 2, 10);
				tmp.width = Math.max(2, Math.round(W / f)); tmp.height = Math.max(2, Math.round(H / f));
				tctx.fillStyle = '#fff';
				drawFittedText(tctx, o.text, tmp.width, tmp.height, fontPx / f, o.fontFamily, 600, o.hasStretch);
				sx.imageSmoothingEnabled = true;
				sx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, W, H);
			}
			const sd = sx.getImageData(0, 0, W, H).data;
			tsField = new Uint8Array(W * H);
			tsMax = 1;
			for (let p = 0; p < W * H; p++) { const a = sd[p * 4 + 3]; tsField[p] = a; if (a > tsMax) tsMax = a; }
			tsMax /= 255; // peak of the inflation hill — the wide blur flattens it, so twoState thresholds ADAPT to it
		}
		t = 0;
	}
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
		const k = Math.max(1, Math.round(o.reactionSpeed || 1.5)); // crawl cycles per loop
		const fontPx = H * (o.fontFrac || 0.3);
		paintBg(ctx, o, W, H);
		ctx.fillStyle = o.fg;
		drawFittedText(ctx, o.text, W, H, fontPx, o.fontFamily, WGT, o.hasStretch);
		if (fluid ? !clusters.length : !balls.length) return;
		// pow 3.2 → sharp pulses: a pod is genuinely OFF for ~2/3 of its cycle
		// instead of simmering, so the text keeps surfacing between blooms.
		for (const q of clusters) q.env = Math.pow(0.5 + 0.5 * Math.sin(TAU * (k * phase + q.off)), 3.2);
		if (!fluid) {
			// Influence: geometry is FROZEN — every bead sits on the strokes for
			// the whole loop. Each pod's envelope swells and recedes, its REACH
			// growing with the bloom, so the lit stretch of beads spreads along
			// the letterform from the pod centre and contracts back.
			const drawBalls = (c, s) => {
				for (const b of balls) {
					let lit = 0;
					for (const q of clusters) {
						if (q.env < 0.03) continue;
						const dx = b.x - q.x0, dy = b.y - q.y0;
						const sig = podR * (0.3 + 0.7 * q.env); // reach expands with the bloom
						lit += q.env * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
					}
					if (lit < 0.04) continue;
					c.globalAlpha = 0.9 * Math.min(1, lit);
					c.fillStyle = cssRgb(mix3(b.cA, b.cB, 0.5 + 0.5 * Math.sin(TAU * phase + b.p2)));
					c.beginPath(); c.arc(b.x * s, b.y * s, Math.max(1, b.r * s), 0, TAU); c.fill();
				}
				c.globalAlpha = 1;
			};
			const R = clamp(rB * 0.6, 2, 40);
			fctx.clearRect(0, 0, W, H);
			if (canFilter) {
				fctx.filter = `blur(${R}px)`;
				drawBalls(fctx, 1);
				fctx.filter = 'none';
			} else {
				const f = clamp(R / 2.5, 2, 10);
				tmp.width = Math.max(2, Math.round(W / f)); tmp.height = Math.max(2, Math.round(H / f));
				tctx.clearRect(0, 0, tmp.width, tmp.height);
				drawBalls(tctx, 1 / f);
				fctx.imageSmoothingEnabled = true;
				fctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, W, H);
			}
		} else {
			// fluid: ANALYTIC float influence field — a sum of pod gaussians via
			// a lerped exp() table. No bead canvas, no 8-bit quantization (the
			// old blurred field's shallow gradients banded into terraced,
			// crunchy perimeters on thin films), and no full-canvas blur cost.
			mArrF.fill(0);
			for (const q of clusters) {
				if (q.env <= 0.01) continue;
				const sig = podR * (0.3 + 0.7 * q.env);
				const inv = 1 / (2 * sig * sig), amp = 0.85 * q.env;
				for (let y = 0; y < H; y++) {
					const dy = y - q.y0, dy2 = dy * dy;
					if (dy2 * inv >= 12) continue;
					const row = y * W;
					for (let x = 0; x < W; x++) {
						const xq = ((x - q.x0) * (x - q.x0) + dy2) * inv;
						if (xq >= 12) continue;
						const xi = xq * 42.6, i0 = xi | 0;
						mArrF[row + x] += amp * (EXPLUT[i0] + (EXPLUT[i0 + 1] - EXPLUT[i0]) * (xi - i0));
					}
				}
			}
		}
		// Combine: goo surface g = inflation-hill × (base + boost·influence).
		// influence 0 → g stays under the threshold → untouched hairline.
		// influence ↑ → the g=θ contour slides outward → the letter swells into
		// colour-filled goo, iso-shaded so the blob topology reads.
		const amount = clamp(o.cmAmount ?? 0.5, 0.05, 0.9);
		const boost = lerp(0.9, 2.2, amount); // capped so max swell ≈ bold weight, on-path
		const THETA = 0.62;
		const satK = lerp(1.6, 4, amount); // twoState: how eagerly influence saturates
		const gateT = clamp(o.cmGate ?? 0.12, 0, 0.2); // Blob 2 existence gate (slider)
		const img = fluid ? imgF : fctx.getImageData(0, 0, W, H);
		const d = img.data;
		for (let p = 0; p < W * H; p++) {
			const i = p * 4;
			const m = fluid ? Math.min(1, mArrF[p]) : d[i + 3] / 255;
			if (m <= 0.02) { d[i + 3] = 0; continue; }
			let v, u, aMul = 1;
			if (twoState) {
				// Influence saturates → any touched region shows the FULL blob
				// state; the threshold slides from "nothing" down to the fixed
				// blob contour and STOPS there — colour can never exceed the
				// max-blobbiness silhouette.
				const n = nField[p]; // 1 on the letterform → 0 at max reach
				if (n <= 0) { d[i + 3] = 0; continue; }
				// MAGNETIZED: influence counts more the closer to the letterform.
				const base = m * satK * (0.2 + 1.6 * n);
				const sat = Math.min(1, base);
				// GROWTH ORDER (the ferrofluid rule): reach starts AT the letter
				// silhouette and expands outward with influence. Low intensity →
				// the colour IS the text shape (slightly rounded, clearly
				// legible), racing around the outline as the influence field
				// shifts; full intensity → fat blobs out to max reach. Fading
				// runs the same path in reverse: shrink back onto the letters.
				// Blob 1 (pow 1.6): viscous — reach stays near the text until high
				// influence. Blob 2: the sleeve may be ARBITRARILY thin — what
				// keeps it smooth is (a) the pod-scale field blur above (no bead
				// ripple in the contour) and (b) an ADAPTIVE feather: the AA band
				// never exceeds half the film thickness, so the core is always
				// fully opaque — no partial-alpha fuzz at any thinness.
				let reach, feather;
				if (fluid) {
					// existence gate (Gate slider) — trims sub-threshold shimmer;
					// at 0 the gate is off and blobs thin out to nothing freely.
					if (gateT > 0.001) {
						const g8 = clamp((sat - gateT) / gateT, 0, 1);
						if (g8 <= 0) { d[i + 3] = 0; continue; }
						aMul = g8 * g8 * (3 - 2 * g8);
					} else {
						aMul = 1;
					}
					reach = Math.pow(sat * sat * (3 - 2 * sat), 1.6);
					feather = Math.max(0.008, Math.min(0.05, reach * 0.5));
				} else {
					reach = Math.pow(sat, 1.6);
					feather = 0.06;
				}
				v = clamp((n - (1 - reach)) / feather, 0, 1);
				u = n;
				if (!fluid) {
					// cling-fade: the letter-shaped film dims out in place at the end
					const lf = clamp(sat * 3.5, 0, 1);
					aMul = lf * lf * (3 - 2 * lf);
				}
				// Hue drive rises ~2× slower than visibility (×0.5) and is power-
				// compressed, so colour LAGS the bloom: red arrives first and
				// lives longest, yellow is the transition, pink only near peak
				// influence on the letter core (~20% of the visible time).
				// fluid (Blob 2): the hue drive weights the letter region far more
				// heavily (2.3× on-letter vs 0.1 in the halo), so the TEXT runs
				// well ahead of the blob body on the ramp — hot letters glowing
				// through a cooler blob → the text stays visible underneath.
				const hb = fluid ? m * satK * (0.1 + 2.2 * n) : base;
				let I = Math.pow(clamp(hb * 0.3, 0, 1), 2.0);
				// fluid: inside the glyph gets a fixed head start on the ramp, so
				// the text glows hotter than its blob at ANY emphasis level. The
				// transition band is WIDE (0.88→1) so the hot text melts into the
				// blob body instead of drawing a hard colour line at the glyph edge.
				if (fluid) I = Math.min(1, I + clamp((n - 0.88) / 0.12, 0, 1) * 0.3);
				if (I < 0.18) {
					d[i] = 255; d[i + 1] = 40; d[i + 2] = 40;              // pure red holds
				} else if (I < 0.8) {
					const f2 = (I - 0.18) / 0.62;
					d[i] = 255; d[i + 1] = 40 + 165 * f2; d[i + 2] = 40;   // LONG red → yellow crossfade (the moment)
				} else {
					const f2 = Math.min(1, (I - 0.8) / 0.17);
					d[i] = 255; d[i + 1] = 205 - 110 * f2; d[i + 2] = 40 + 160 * f2; // pink = crest only
				}
			} else {
				const g = (tsField[p] / 255) * (0.5 + boost * m);
				v = clamp((g - THETA) / 0.09, 0, 1);
				u = clamp((g - THETA) / 0.6, 0, 1);
			}
			if (v <= 0) { d[i + 3] = 0; continue; }
			const vv = v * v * (3 - 2 * v);
			// twoState: plain smooth gradient (slightly deeper toward the stroke
			// centreline) — the sinusoidal iso-bands read as a strange texture
			// over the hue ramp. cmeta keeps its banded goo topology.
			const sh = twoState ? 0.9 + 0.2 * u : 1 + 0.24 * Math.sin(u * Math.PI * 3 - 0.6);
			d[i] = clamp(d[i] * sh, 0, 255);
			d[i + 1] = clamp(d[i + 1] * sh, 0, 255);
			d[i + 2] = clamp(d[i + 2] * sh, 0, 255);
			d[i + 3] = vv * aMul * 255;
		}
		fctx.putImageData(img, 0, 0);
		ctx.drawImage(field, 0, 0);
	}
	return { reset, step, render };
}
const sceneCMeta = (env) => colorMetaScene(env, 0);
const sceneBlobColor = (env) => colorMetaScene(env, 1);
const sceneBlob2 = (env) => colorMetaScene(env, 2);

// Blob 3 family — the GPU goo engine (fragment-shader pipeline: influence →
// magnet → gate → reach → gloop boundary → hue ramp, with step & repeat wall
// support). Two influence variants:
//   cellular = true  → "Blob 3-C": a living CELL ORGANISM on the letter grid
//                      (branch / stay / edge-death decisions per second).
//   cellular = false → "Blob 3-N": Blob 2's noise/pod movement — smooth pod
//                      envelopes blooming on a loop-seamless schedule.
// Falls back to the CPU Blob 2 engine if WebGL is unavailable.
// noisy (6-7): re-enable Blob 5's irregularity — patchy spread, full gloop
// lump, bead-marbled hue — on top of the fused-field goo. Edge stays hairline.
function blob3Scene(env, cellular, speedMul = 1, mass = false, letterQ = false, b6 = false, perf6 = false, noisy = false) {
	const { W, H, getOpts, rng } = env;
	// total sim tempo: Reaction speed × the mode's Speed slider × the variant's
	// built-in multiplier (Blob 3-C Fast = 2×)
	const simSpd = (o) => Math.max(0.2, (o.reactionSpeed || 1) * (o.b3Speed || 1)) * speedMul;
	// ONE SHARED WebGL context for every GPU blob scene. Creating a context per
	// scene exhausted the browser's ~16-context cap after enough mode/slider
	// rebuilds, and creation started silently FAILING — the mode fell back to
	// the CPU Blob 2 engine (scheduled popping pods), which is why Blob 4's
	// motion fixes appeared to change nothing.
	if (!blob3Scene._share) {
		const cv = document.createElement('canvas');
		const g = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true });
		blob3Scene._share = { cv, gl: g };
	}
	const glCanvas = blob3Scene._share.cv;
	const gl = blob3Scene._share.gl;
	if (!gl || gl.isContextLost()) return colorMetaScene(env, 2);
	const WGT = 100;
	let lumpF = 0.05, t = 0, prog = null, uni = null, clusters = [], podR = 1;
	let quadBuf = null, aPLoc = -1, nTex = null, bTex = null; // per-scene GL objects on the shared context
	let wallCv = null, wallFg = null; // cached hairline wall (drawing it per frame caused GC/measureText frame spikes)
	const podsBuf = new Float32Array(384); // 96 pod slots — headroom so FADING tail segments never get evicted mid-fade; Blob 8/9's swarm (5 heads x ~12 line-trail points + a dying agent's fading trail) overflowed 64 and dropped pods = flashing creatures
	// the living mass (cellular variant): a coarse grid of letter-sized cells
	let gw2 = 2, gh2 = 2, valid = null, alive = null, level = null, ageT = null, phB = null, rateB = null, mBytes = null, massTex = null, simT = 0, hasText = false;
	let cellComp = null, compCells = null, swallows = [], capC = 10; // letter awareness
	// Blob 4 creature: a single mass of feathered-circle nodes
	let nodes = [], heading = 0, addT = 0, remT = 0.8, txCells = [], letterH2 = 50;
	let goal = null, goalT = 0, splitT = 5; // roaming destination + split timer
	let anchorX = 0, anchorY = 0; // low-passed nearest-text point (steering aid)
	let headN = null, dropD = 0; // the permanent head disc + distance since last trail drop
	let headDist = 0, tailDist = 0; // arclength of head travel + the CONTINUOUS tail point
	// Blob 5 (letterQ): whole-letter swallow machinery
	let lidTex = null, lvlTex = null, lvlBytes = null, letterList = [], nLetters = 1;
	let agents = [], branchT = 3; // Blob 5's colony of invisible roamers
	let com9x = -1e9, com9y = 0; // 6-9: lagging (EMA) colony center of mass
	// Blob 6-5 fused letter field: low-res per-letter sprites stamped+blurred
	// into ONE bitmap per frame
	let gs6 = 6, gw6 = 2, gh6 = 2, sprites6 = null, accum6 = null, tmp6 = null, mBytes6 = null;
	let accumC6 = null, tmpC6 = null; // cooling channel (departing letters)
	let accumD6 = null, tmpD6 = null; // 6-10: dwell channel (occupation time)
	let heatF6 = null, tmpH6 = null, maxH6 = 0; // 6-11/12: persistent diffusing heat field + running max
	let letterDtAcc = 0, fieldDirty = true; // perf6: letter machinery ticks at ~32Hz
	let massTexPrev = null, firstTick6 = true; // perf6: last tick's field, for the GPU cross-fade
	let lastTickDt6 = 1 / 32; // actual duration of the last tick (normalizes the blend clock)

	const VSH = 'attribute vec2 aP; varying vec2 vUV; void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }';
	const FSH = `
precision highp float;
varying vec2 vUV;
#define OUT(c) gl_FragColor = (c)
uniform sampler2D uN;      // distance field: 1 on the letterform -> 0 at max reach
uniform sampler2D uB;      // bead-noise texture — Blob-1-style colour speckle
uniform sampler2D uM;      // cell-mass texture — the living blob organism (CPU sim)
uniform vec4 uPods[96];    // pod/mass variants: x, y (px), amplitude, sigma
uniform float uGate, uSatK;
uniform float uPh;         // TAU * loop phase
uniform float uGPh;        // UNWRAPPED loop count (t/duration, monotonic) — global colour drift that never snaps; uPh wraps every loop and a scaled fract of it flicked ALL colours at once
uniform float uLump;       // lump spatial frequency (~1 / letter height)
uniform vec2 uMOff;        // ~0.75 mass-texel, for the rounding taps
uniform sampler2D uLid;    // Blob 5: nearest-letter Voronoi id (16-bit in L+A)
uniform sampler2D uLvl;    // Blob 5: per-letter swallow level (Nx1)
uniform float uNL;         // Blob 5: letter count
uniform float uHeat;       // Blob 6-4: global temperature (uniform-borne)
uniform vec2 uCom9;        // 6-9: lagging colony center of mass (px)
uniform sampler2D uMPrev;  // Blob 6-6: previous field tick (cross-fade source)
uniform float uMMix;       // Blob 6-6: sub-tick blend fraction
uniform vec2 uRes;
vec2 lvlAt(vec2 uv) {      // Blob 5: (shape S, heat Q) of the letter owning uv
	vec4 q = texture2D(uLid, uv);
	float id = floor(q.r * 255.0 + 0.5) + floor(q.a * 255.0 + 0.5) * 256.0;
	vec4 l2 = texture2D(uLvl, vec2((id + 0.5) / uNL, 0.5));
	return vec2(l2.r, l2.a);
}
void main() {
	vec2 st = vec2(vUV.x, 1.0 - vUV.y); // canvas orientation (y down)
${b6 === 3 ? `
	// WIDE 9-tap level blend (~0.4 letter-heights): per-pixel levels vary
	// smoothly ACROSS letter borders, dissolving the Voronoi seams that a
	// narrow feather left visible during arrivals and departures. Selection
	// stays whole-letter (CPU-side); only the rendering blends.
	float lh5 = (6.2832 / uLump) / 0.85;
	vec2 r1t = (lh5 * 0.2) / uRes;
	vec2 r2t = (lh5 * 0.38) / uRes;
	vec2 SQ = 0.24 * lvlAt(st)
		+ 0.10 * (lvlAt(st + vec2(r1t.x, 0.0)) + lvlAt(st - vec2(r1t.x, 0.0))
			+ lvlAt(st + vec2(0.0, r1t.y)) + lvlAt(st - vec2(0.0, r1t.y)))
		+ 0.09 * (lvlAt(st + r2t * vec2(0.707, 0.707)) + lvlAt(st + r2t * vec2(-0.707, 0.707))
			+ lvlAt(st + r2t * vec2(0.707, -0.707)) + lvlAt(st + r2t * vec2(-0.707, -0.707)));
	if (SQ.x <= 0.01) { OUT(vec4(0.0)); return; }
	// DUAL FIELD: .r = open (true strokes, counters hollow), .a = solid
	// (counters filled). Held letters are solid; a MELTING letter slides
	// toward the open field — the D's belly opens a growing hole and the goo
	// shrinks onto the stroke edges, exactly like an n's natural melt.
	// Engulfing runs it backwards: the hole seals as the letter is taken.
	vec4 nt = texture2D(uN, st);
	float n = mix(nt.r, nt.a, smoothstep(0.2, 0.85, SQ.x));
` : b6 === 5 ? `
${noisy ? `
	// ROUNDER MASS (6-7): the goo's shape is a level set of the letter
	// distance field, so it inherits every notch and crossbar. Averaging the
	// field over a small disc melts concave glyph detail into convex blob
	// contour — the mass reads as blobs that ATE letters, not as fat glyphs.
	float lhR = (6.2832 / uLump) / 0.85;
	vec2 rrA = (lhR * 0.3) / uRes;
	vec2 rrD = rrA * 0.707;
	vec4 nt5raw = texture2D(uN, st);
	vec4 nt5 = 0.28 * nt5raw
		+ 0.12 * (texture2D(uN, st + vec2(rrA.x, 0.0)) + texture2D(uN, st - vec2(rrA.x, 0.0))
			+ texture2D(uN, st + vec2(0.0, rrA.y)) + texture2D(uN, st - vec2(0.0, rrA.y)))
		+ 0.06 * (texture2D(uN, st + rrD) + texture2D(uN, st - rrD)
			+ texture2D(uN, st + vec2(rrD.x, -rrD.y)) + texture2D(uN, st - vec2(rrD.x, -rrD.y)));
${noisy >= 2 ? `
	// 6-8: the OUTER contour departs from the letterforms by ~60%. A second
	// disc average at ~1.1 letter-heights is so wide that glyph anatomy is
	// gone from its level sets; blend toward it as the field thins, so the
	// core still says "letters" while the perimeter says "blob". The 1.25
	// gain offsets the zero-clamp dilution near the field's outer boundary.
	vec2 rrB = (lhR * 1.1) / uRes;
	vec2 rrBd = rrB * 0.707;
	vec4 ntBig = 0.28 * texture2D(uN, st)
		+ 0.12 * (texture2D(uN, st + vec2(rrB.x, 0.0)) + texture2D(uN, st - vec2(rrB.x, 0.0))
			+ texture2D(uN, st + vec2(0.0, rrB.y)) + texture2D(uN, st - vec2(0.0, rrB.y)))
		+ 0.06 * (texture2D(uN, st + rrBd) + texture2D(uN, st - rrBd)
			+ texture2D(uN, st + vec2(rrBd.x, -rrBd.y)) + texture2D(uN, st - vec2(rrBd.x, -rrBd.y)));
	float wEdge = 0.6 * (1.0 - smoothstep(0.35, 0.8, nt5.a));
	nt5 = mix(nt5, min(ntBig * 1.25, vec4(1.0)), wEdge);
` : ''}
` : `
	vec4 nt5 = texture2D(uN, st);
`}
${perf6 ? `
	// 6-6: the field ticks at 32Hz on the CPU; cross-fading the last two
	// snapshots per frame makes the displayed field 60fps-continuous (the
	// same trick as BZ's slow-motion glide) — melts stop stepping.
	vec4 lf6 = mix(texture2D(uMPrev, st), texture2D(uM, st), uMMix);
` : `
	vec4 lf6 = texture2D(uM, st);
`}
	float letterF = lf6.a;
	// OPENNESS = 1 - maturity share: high while ARRIVING and while DEPARTING,
	// zero when fully held. It slides the geometry between the OPEN stroke
	// skeleton and the SOLID slab — letters build up on their letterforms and
	// seal shut; on exit the counters re-open and the goo drains along the
	// skeleton. Symmetric scaffolding, all shape, no opacity.
	float cool5 = 1.0 - min(1.0, lf6.r / max(letterF, 0.03));
${noisy && noisy !== 3 ? `
	// DEPART LIKE 6-6: rounding blurred the open-stroke scaffold, so counters
	// couldn't re-open and melts lost the tiny-hole -> contract-to-strokes
	// ritual. As the letter cools, the geometry hands back to the RAW field —
	// at full cool the scaffold is exactly 6-6's, holes and all. (Arrivals
	// also begin letter-true, then round out as they seal: goo settling.)
	nt5 = mix(nt5, nt5raw, smoothstep(0.1, 0.75, cool5)${noisy >= 4 ? ' * smoothstep(0.28, 0.6, nt5raw.a) /* 6-9: hand back only NEAR the glyph - counters re-open while the outer rim keeps its 60% blob departure */' : ''});
` : ''}
${noisy >= 5 ? `
	// 6-10 DWELL HALO: the dwell channel is stamped per-letter, blurred into
	// the fused field (so it fades smoothly across neighbours), then five
	// WIDE taps here throw the radiance well beyond the glyphs — the longer
	// a letter has been blobbed, the further its heat reaches.
	vec2 rh10 = (lhR * ${noisy >= 7 ? '4.5' : '2.8'}) / uRes;
	vec4 hT1 = texture2D(uM, st + vec2(rh10.x, 0.0));
	vec4 hT2 = texture2D(uM, st - vec2(rh10.x, 0.0));
	vec4 hT3 = texture2D(uM, st + vec2(0.0, rh10.y));
	vec4 hT4 = texture2D(uM, st - vec2(0.0, rh10.y));
	float dwellW10 = 0.3 * lf6.g + 0.175 * (hT1.g + hT2.g + hT3.g + hT4.g);
	// wide MASS density from the same taps: where the blob is thick, its
	// belly runs hot regardless of where the glyphs sit
	float massW10 = 0.3 * lf6.a + 0.175 * (hT1.a + hT2.a + hT3.a + hT4.a);
` : ''}	float n = mix(nt5.a, nt5.r, smoothstep(0.15, 0.9, cool5));
` : `
	float n = texture2D(uN, st).a;
`}
	if (n <= 0.002) { OUT(vec4(0.0)); return; }
	vec2 p = st * uRes;
${cellular ? `
	// Influence = the CELL MASS: a CPU cellular organism (per letter-sized
	// cell: branch to a neighbour / stay / die at the mass edge) uploaded as a
	// tiny texture. Five taps round the cell squares into blobby mounds before
	// the goo math shapes them.
	float m = 0.4 * texture2D(uM, st).a
		+ 0.15 * texture2D(uM, st + vec2(uMOff.x, 0.0)).a
		+ 0.15 * texture2D(uM, st - vec2(uMOff.x, 0.0)).a
		+ 0.15 * texture2D(uM, st + vec2(0.0, uMOff.y)).a
		+ 0.15 * texture2D(uM, st - vec2(0.0, uMOff.y)).a;
` : `
	// Influence = feathered circles (pod gaussians): either scheduled noise
	// envelopes (Blob 3-N) or the persistent creature mass (Blob 4).
	float m = 0.0;
	for (int i = 0; i < 96; i++) {
		vec4 q = uPods[i];
		if (q.z > 0.0005) {
			vec2 dd = p - q.xy;
			m += q.z * exp(-dot(dd, dd) / (2.0 * q.w * q.w));
		}
	}
`}
	m = min(m, 1.0);
${letterQ ? `
	// Blob 5: NO early-out on the creature's field — the field is invisible
	// here, but this cull ran BEFORE the letter lift, so the field's receding
	// edge hard-clipped letters that were still mid-fade (the wiping edge on
	// fade-out; fade-in was fine because the field covered the letter).
` : `
	if (m <= 0.02) { OUT(vec4(0.0)); return; }
`}
	// PATCHY SPREAD (Blob 1's unevenness): medium-scale strength patches along
	// the strokes MULTIPLY the influence — so only parts of a letter blob
	// first, coverage creeps patch by patch instead of sweeping a letter at a
	// time, and the reach front is organically lopsided. The patch field is
	// heavily blurred, so this adds unevenness without any edge crunch.
	vec4 bt = texture2D(uB, st); // .r = patch strength, .a = fine bead marbling
	// mass variant (Blob 4): patches must NOT gate visibility — a travelling
	// mass revealed patch-by-patch reads as popping between nearby spots. The
	// range stays wide for the static variants (their organic unevenness) but
	// flattens to a gentle texture for the mover.
	m = min(m * ${b6 === 5 && !noisy ? '1.0 /* no patch texture: magnetic goo is SMOOTH */' : mass ? '(0.78 + 0.42 * bt.r)' : '(0.3 + 1.1 * bt.r)'}, 1.0);
${letterQ ? `
	// WHOLE-LETTER SWALLOW (Blob 5): every pixel belongs to its nearest letter
	// (Voronoi id texture); a touched letter's level lifts the influence over
	// its cell, so arrival engulfs the whole glyph at once; release hands back
	// to the creature's receding field. The lift wears a SNUG COAT — shaped by
	// distance-to-glyph so it dies out well before the Voronoi border (a full-
	// cell lift clipped at the border drew a hard straight seam between an
	// engulfed letter and its bare neighbour) — and the id lookup is 5-tap
	// averaged so any remaining transition is feathered, never razor-edged.
${(b6 === 3 || b6 === 5) ? '' : `
	// WIDE 9-tap level blend (~0.4 letter-heights): per-pixel levels vary
	// smoothly ACROSS letter borders, dissolving the Voronoi seams that a
	// narrow feather left visible during arrivals and departures. Selection
	// stays whole-letter (CPU-side); only the rendering blends.
	float lh5 = (6.2832 / uLump) / 0.85;
	vec2 r1t = (lh5 * 0.2) / uRes;
	vec2 r2t = (lh5 * 0.38) / uRes;
	vec2 SQ = 0.24 * lvlAt(st)
		+ 0.10 * (lvlAt(st + vec2(r1t.x, 0.0)) + lvlAt(st - vec2(r1t.x, 0.0))
			+ lvlAt(st + vec2(0.0, r1t.y)) + lvlAt(st - vec2(0.0, r1t.y)))
		+ 0.09 * (lvlAt(st + r2t * vec2(0.707, 0.707)) + lvlAt(st + r2t * vec2(-0.707, 0.707))
			+ lvlAt(st + r2t * vec2(0.707, -0.707)) + lvlAt(st + r2t * vec2(-0.707, -0.707)));
	if (SQ.x <= 0.01) { OUT(vec4(0.0)); return; }
`}
	// Blob 5, two channels: S (shape) runs the film->swell GULP on arrival and
	// NEVER deflates on exit; Q (heat) drains on exit so the colours cool down
	// the ramp (pink -> yellow -> deep red) at full opacity — the COLOUR
	// transitions out, no visible mask, no translucent ghost.
${b6 === 3 ? `
	// Blob 6-3: territory follows TEMPERATURE — cold blobs hug the glyphs; as
	// the shared heat climbs, the pool floods outward across the letter gaps
	// toward the field's outer boundary, like molten material expanding.
	float lo6 = mix(0.52, 0.04, SQ.y);
	m = 0.95 * SQ.x * smoothstep(lo6, lo6 + 0.26, n);
` : b6 === 5 ? `
	// ONE SOLID MASS (fused field): every magnetized letter is stamped —
	// weighted by its level — and blurred into a SINGLE bitmap on the CPU
	// (uM); the shader just adds the agents' round bodies to it. One scalar
	// field, one contour, one gradient. No per-letter quantity reaches the
	// pixel, so seams, striations and partitions are structurally impossible;
	// the mass morphs as letters magnetize on and off.
	// letterF & cool5 sampled up top (they also drive the scaffold geometry)
	m = min(m * 0.5 + letterF * ${noisy === 14 || noisy >= 16 ? '1.45 /* Blob 11/12-2: widened field is flatter - extra gain keeps merged lobes solid */' : '1.15'}, 1.0);${noisy >= 7 ? ' // 6-12: heat-grown body REMOVED - m drives sat/reach, so the heat term was bulging the silhouette; structure now matches 6-11 exactly, heat is colour-only' : ''}
` : `
	m = 0.95 * SQ.x * smoothstep(${b6 ? '0.5, 0.78' : '0.62, 0.86'}, n); // ${b6 ? 'wide solid coat' : 'tight coat'}
`}
` : ''}
	float sat = min(m * uSatK * (0.2 + 1.6 * n), 1.0); // magnetized influence
	float aMul = 1.0;
${noisy >= 13 ? `
	// GLOBAL-DRIFT MODES: no mass, no paint. This shader branch has no
	// early-out and no existence gate (removed for the melt look), so pixels
	// at the glyph cores (n ~ 1) always clear the render threshold even at
	// ZERO mass - a letter-surface sliver that the cycling global tint
	// paints before first touch and forever after departure. Gate the
	// alpha on actual mass; arrivals/departures are continuous in m, so
	// the melt choreography is untouched.
	aMul *= smoothstep(0.015, 0.06, m);
` : ''}
${letterQ ? `
	// Blob 5: NO gate — letters already have discrete existence, and the
	// gate's cutoff contour swept across the glyph as a hard wiping edge
	// while the melt drained saturation.
` : `
	if (uGate > 0.001) {                                // existence gate
		float g = clamp((sat - uGate) / uGate, 0.0, 1.0);
		if (g <= 0.0) { OUT(vec4(0.0)); return; }
		aMul = g * g * (3.0 - 2.0 * g);
	}
`}
	float ss = sat * sat * (3.0 - 2.0 * sat);           // tight-hug S-curve
	float reach = pow(ss, 1.6); // same low-end onset for every variant — the
	// flat mass curve (an arrival-smoothing crutch from before the field was
	// continuous) made the thinnest film appear with sudden visible thickness
	// GLOOP: three drifting smooth waves at incommensurate angles dent and
	// bulge the goo boundary (perfect gaussian pods read as too-round CG).
	// Drift terms are sin/cos of the loop phase -> seamless. Lump amplitude
	// grows with reach, so thin films stay clean while full blooms writhe.
	float w1 = sin(p.x * uLump + sin(uPh) * 1.7 + 2.1);
	float w2 = sin((p.x * 0.55 + p.y * 0.83) * uLump * 1.31 + cos(uPh) * 1.3 + 4.7);
	float w3 = sin((p.y * 0.92 - p.x * 0.31) * uLump * 0.77 + sin(uPh + 1.0) * 2.0 + 1.3);
	float lump = ((w1 + w2 + w3) / 3.0) * ${b6 === 5 && !noisy ? '(0.015 + 0.08 * reach) /* hushed: surface-tension smooth */' : '(0.04 + 0.22 * reach)'};
${noisy ? `
	// BIG-SCALE instability (6-7): three slow waves at ~5x the lump wavelength
	// warp the entire silhouette, so the blob never quite settles. Amplitudes
	// stay small — this is a sway, not a wobble; the fine gloop rides on top.
	float g1 = sin(p.x * uLump * 0.19 + sin(uPh + 0.4) * 2.3 + 1.1);
	float g2 = sin((p.x * 0.42 + p.y * 0.91) * uLump * 0.23 + cos(uPh + 2.0) * 1.9 + 3.8);
	float g3 = sin((p.y * 0.78 - p.x * 0.63) * uLump * 0.16 + sin(uPh + 3.1) * 2.6 + 5.2);
	lump += ((g1 + g2 + g3) / 3.0) * (0.02 + 0.04 * reach);
` : ''}${noisy >= 4 ? `
	// VISCOUS CORE (6-9): a lagging average of the colony's center of mass
	// trails the blobs; near it the surface resists deformation — fine gloop
	// and big sway are both damped, so the goo feels thick and settled where
	// the body of the mass lives, and livelier out at the frontier.
	vec2 dCom9 = p - uCom9;
	float sigC9 = lhR * 2.2;
	lump *= (1.0 - 0.65 * exp(-dot(dCom9, dCom9) / (2.0 * sigC9 * sigC9)));
` : ''}	float feather = clamp(reach * 0.5, ${b6 === 5 ? '0.012' : letterQ ? '0.05' : '0.008'}, ${b6 === 5 ? '0.02' : letterQ ? '0.08' : '0.05'}); // 6-5: hairline AA only — a crisp fully-opaque edge; the fused field supplies all the softness the SHAPE needs
	float v = clamp((n - (1.0 - reach) + lump) / feather, 0.0, 1.0);
	if (v <= 0.0) { OUT(vec4(0.0)); return; }
	float vv = v * v * (3.0 - 2.0 * v);
	// BLOB-1 COLOUR IRREGULARITY, ported faithfully: in Blob 1 the hue drive
	// IS the bead field — intensity peaks on bead cores and dips in the gaps
	// between beads, marbling the colour red<->yellow at bead scale along the
	// strokes. Here the SHAPE stays smooth (sat/reach use the clean pod field)
	// but the hue drive is MULTIPLIED by the same poisson bead texture, so the
	// colour carries Blob 1's full-amplitude granularity.
	float bn = bt.a;
	float hb = m * uSatK * ${noisy >= 5 ? '(0.3 + 0.55 * n + 1.5 * smoothstep(0.05, 0.5, letterF) + 0.9 * smoothstep(0.03, 0.4, dwellW10)) /* 6-10: heat rides the DIFFUSED fields, not glyph distance — it dissipates */' : noisy === 4 ? '(0.55 + 1.3 * n + 0.9 * smoothstep(0.12, 0.6, letterF)) /* 6-9: base nears stroke temp; thick mass closes the gap entirely */' : '(0.1 + 2.2 * n)'}${b6 === 5 && !noisy ? ' /* no bead marbling: it read as crunch */' : ' * (0.08 + 0.92 * bn)'}; // ${b6 === 5 && !noisy ? 'smooth magnetic hue field' : 'deep dips between beads'}
	float I = pow(clamp(hb * 0.3, 0.0, 1.0), 2.0);
	I = min(1.0, I + clamp((n - 0.88) / 0.12, 0.0, 1.0) * 0.3);
	// plus the big soft temperature patches (subtle, morphing over the loop)
	float mA = sin(uPh), mB = sin(uPh + 2.1), mC = sin(uPh + 4.2);
	float c1 = sin(p.x * uLump * 0.33 + p.y * uLump * 0.21 + 1.7);
	float c2 = sin((p.y * 0.8 - p.x * 0.6) * uLump * 0.27 + 3.1);
	float c3 = sin((p.x + p.y) * uLump * 0.4 + 5.3);
	float mot = (c1 * mA + c2 * mB + c3 * mC) * 0.333 + 0.35 * sin(uPh + 0.9);
	I = clamp(I + mot * 0.05, 0.0, 1.0);
${b6 === 2 ? `
	// Blob 6-2: HEAT scales the intensity — a fresh cold blob sits in the
	// gray/blue end and climbs the ramp as its shared temperature builds.
	I *= (0.10 + 0.90 * SQ.y);
` : ''}${b6 === 3 ? `
	// Blob 6-3: HEAT SHIFTS the whole ramp instead of scaling it — the entire
	// field (outer edge included) slides up the colour scale together, the
	// core keeping a fixed lead. The edge itself cycles gray -> blue -> green
	// -> yellow -> red as the blob matures, instead of being pinned at gray.
	I = clamp(SQ.y * 0.9 + I * 0.35 - 0.05, 0.0, 1.0);
` : ''}${b6 === 4 ? `
	// Blob 6-4: same additive heat shift as 6-3, but the temperature arrives
	// as a global uniform (Blob 4's continuous mass has no letter channels).
	I = clamp(uHeat * 0.9 + I * 0.35 - 0.05, 0.0, 1.0);
` : ''}${b6 === 5 ? `
	// Blob 6-5: global temperature, MINUS the fused cooling channel — a
	// departing region drops ~2 ramp stops as its lobe shrinks, at full
	// opacity: the goo cools and contracts instead of fading.
${noisy >= 6 ? `
	// 6-11/6-12: TIME-INTEGRATED HEAT (lf6.b) — a persistent CPU field: letters
	// inject, per-tick diffusion spreads it (the footprint grows without
	// bound), slow decay cools. NO CAP anywhere: camp long enough and the
	// ENTIRE blob climbs to pink and pastel. The diffusion's smoothness is
	// what forbids steep jumps (white-pink beside gray), not a ceiling.
	float d11 = pow(clamp((n - (1.0 - reach)) / max(reach, 0.05) / 0.72, 0.0, 1.0), 0.6);
	float heat11 = ${noisy >= 10 ? 'fract(lf6.b * 2.0) /* 7-1/8/9: unwrapped 2-lap window - see pack comment; interpolation passes through TRUE gray */' : noisy === 8 ? 'lf6.b /* 7-0: wheel PHASE, not magnitude */' : noisy >= 7 ? 'pow(min(lf6.b * 1.05, 1.0), 0.85) * smoothstep(0.02, 0.07, lf6.b) /* 6-12: near-LINEAR response (was log) - the log map read anything past half-strength as near-maximum, so the hottest colour flooded instantly. Linear keeps the middle of the ramp populated: cores lead through green/yellow/red while surroundings trail behind, 6-7 style. Floor gate still bounds the lowest band */' : 'lf6.b * 1.16'};
${noisy >= 7 ? `
	// 6-12 BALLOON — the decisive break from the CPU field. ROOT CAUSE of
	// every prior round: accum6/accumD6 are stamped ONLY inside the letter
	// sprite boxes, so all injected heat was letter-shaped at birth and no
	// field physics could ever escape that support. The balloon instead
	// draws an explicit hot FRONT in letter-DISTANCE space (dN12 spans the
	// entire halo out to the body edge): full heat behind the front, band
	// gradient across it, base beyond. Its radius is driven by tenure
	// signals (heat byte + wide dwell halo) that keep growing while
	// letters are held, so it inflates from the strokes to the whole body
	// over ~5-20s of residence, then deflates on departure as they decay.
	float dN12 = 1.0 - n;
	float drv12 = lf6.b + dwellW10 * 0.7;
	float R12 = drv12 * 2.4 - 0.12;
	${(noisy === 8 || noisy >= 10) ? '' : 'heat11 = max(heat11, (1.0 - smoothstep(R12 - 0.45, R12 + 0.05, dN12)) * min(1.0, drv12 * 1.6));'}
${noisy == 7 ? `
	// DEPARTURE COOLING (6-12 only — 7-0 cools via the 6-7 flat tax instead):
	// when a letter starts leaving, its maturity drains and cool5 rises —
	// that departure signal (gated by fused-mass presence so free plumes
	// are untouched) pulls heat11 itself down the ramp.
	heat11 *= 1.0 - smoothstep(0.3, 0.85, cool5) * smoothstep(0.02, 0.12, lf6.a) * 0.85;
` : ''}
` : ''}	I = clamp(${noisy === 17 ? 'fract(uGPh + lf6.b * 0.9 + smoothstep(0.05, 0.5, letterF) * 0.05 + dwellW10 * 0.12 + n * 0.05 + uHeat * 0.05 - clamp(cool5 * 1.2, 0.0, 1.0) * 0.17) /* Blob 12-3: keeps the 2-band cooling reversal (and its fresh-arrival mirror) */' : noisy >= 16 ? 'fract(uGPh + lf6.b * 0.9 + smoothstep(0.05, 0.5, letterF) * 0.05 + dwellW10 * 0.12 + n * 0.05 + uHeat * 0.05) /* Blob 12-2: global drift runs the wheel FORWARD like Blob 9 colour order, at HALF a lap per loop. This trades the tint loop-seam alignment away, but the swarm and heat field are not loop-periodic anyway, so the export seam was never frame-perfect in these modes. The earlier breathing drift retraced backwards, which read as the wrong cycle. Cooling letters REVERSE the scale ~2 bands (0.17 of the 12-stop wheel) as they drain - cool5 rises exactly while a letter fades, so the walk-back completes right before it disappears; fresh arrivals get the mirror effect, starting 2 back and catching up */' : noisy === 15 ? 'fract(uPh * 0.1591549 + lf6.b * 0.14 + smoothstep(0.05, 0.5, letterF) * 0.02 + dwellW10 * 0.027 + n * 0.01 - clamp(cool5 * 1.2, 0.0, 1.0) * 0.17) /* Blob 12: palette at ~1/3 speed - only the loop-locked global drift keeps full (minimum seamless) rate */' : noisy === 14 ? 'fract(uPh * 0.1591549 + lf6.b * 0.64 + smoothstep(0.05, 0.5, letterF) * 0.08 + dwellW10 * 0.11 + n * 0.04 - clamp(cool5 * 1.2, 0.0, 1.0) * 0.17) /* Blob 11: SLOWER palette - the global once-per-loop drift is kept (integer laps = seamless loop) but the fast movers (heat field, dwell lead) run at roughly half gain */' : noisy === 13 ? 'fract(uPh * 0.1591549 + lf6.b * 1.2 + smoothstep(0.05, 0.5, letterF) * 0.12 + dwellW10 * 0.2 + n * 0.06 - clamp(cool5 * 1.2, 0.0, 1.0) * 0.17) /* Blob 10: the WHOLE surface rides one global wheel cycle (uPh/2pi = exactly one lap per GIF loop, so it is seamless); the letter heat field adds a radiating phase lead ON TOP; and freshly-swallowed or departing ground (cool5 high, maturity low) renders ~2 bands BEHIND, catching up quickly as it matures - no fresh letter ever pops in at the current colour */' : (noisy === 8 || noisy >= 10) ? 'fract(heat11 + smoothstep(0.05, 0.5, letterF) * 0.12 + dwellW10 * 0.28 + n * 0.1 + uHeat * 0.05) /* 7-0 wheel phase lead, WIDENED: letterF has letter-stamp support (the old trap), so it keeps only a small crisp pop (~1 band); the bulk of the lead rides dwellW10, whose taps reach 4.5 half-heights - a ~3-band lead spread smoothly far past the strokes - plus a gentle n gradient so the rim is graded, not flat */' : noisy === 9 ? 'heat11 * 1.05 + uHeat * 0.15 - cool5 * 0.34 * (1.0 - smoothstep(0.05, 0.4, dwellW10)) /* 7-0-prev: 6-7\'s FLAT cooling, hold-protected. While letters are held, the wide dwell halo suppresses the tax so heat expands past the glyphs like 6-12; on departure dwellW10 drains and the full -0.34 sweeps the region down the ramp */' : noisy == 7 ? 'heat11 * 1.05 + uHeat * 0.15 - cool5 * 0.3 * smoothstep(0.02, 0.12, lf6.a) * (1.0 - heat11) /* 6-12: cooling is HEAT-SUBORDINATE. cool5 is low only where MATURITY built up, and maturity is letter-stamped - so even mass-gated, the flat tax was a letter-shaped ceiling keeping hot bands within the stroke skirt. Scaled by (1-heat11), a hot cell owes nothing regardless of maturity: pastel is reachable anywhere in the blob, while the cold departing body still cools and darkens exactly as before */' : 'heat11 * (0.55 + 0.45 * d11) * 1.25 + uHeat * 0.1 - cool5 * 0.3'}, 0.0, 1.0);
${noisy >= 7 ? `
	// 6-12 ARRIVAL IMPRINT: freshly-grabbed glyphs glow warm through the
	// still-cold body — visible letters on first touch — then dissolve into
	// the ambient field as the spreading heat catches up ((1 - heat11)
	// gates the imprint out precisely as the surroundings reach it).
${(noisy === 8 || noisy >= 10) ? '' : '\tI = clamp(I + smoothstep(0.84, 0.97, n) * 0.3 * (1.0 - min(1.0, lf6.b * 1.5)), 0.0, 1.0);'}
` : ''}
	I = clamp(I + ((w1 + w2 + w3) / 3.0) * 0.05 + (bn - 0.5) * 0.07, 0.0, 1.0);
` : noisy === 5 ? `
	// 6-10: conduction (as 6-9) PLUS tenure radiance — the wide-sampled
	// dwell halo pushes heat far past the glyphs, strongest around letters
	// that have been blobbed longest, blending smoothly between neighbours.
	float dwell9 = 1.0 - cool5;
	float mass9 = smoothstep(0.04, 0.42, letterF);
	float warm9 = mass9 * (0.35 + 0.65 * dwell9);
	float halo10 = smoothstep(0.015, 0.3, dwellW10);
	I = clamp(uHeat * 0.9 + I * 0.35 - 0.05 - cool5 * 0.3 + warm9 * 0.4 + halo10 * 0.75, 0.0, 1.0);
	// heat shimmer: the drifting gloop waves + bead grain jitter the
	// temperature so isotherms never read as clean distance contours
	I = clamp(I + ((w1 + w2 + w3) / 3.0) * 0.05 + (bn - 0.5) * 0.07, 0.0, 1.0);
` : noisy === 4 ? `
	// 6-9: letters are the heat SOURCE but heat CONDUCTS outward. The fused
	// field is literally a diffusion of the letter stamps, so it doubles as
	// the conduction map: warmth grows where material has built up (letterF)
	// and where it has dwelt (maturity share), heating the whole surface.
	float dwell9 = 1.0 - cool5;
	float mass9 = smoothstep(0.06, 0.5, letterF); // saturates fast: A LOT of blob = hot
	float warm9 = mass9 * (0.4 + 0.6 * dwell9);
	I = clamp(uHeat * 0.9 + I * 0.35 - 0.05 - cool5 * 0.34 + warm9 * 0.45, 0.0, 1.0);
` : `
	I = clamp(uHeat * 0.9 + I * 0.35 - 0.05 - cool5 * 0.34, 0.0, 1.0);
`}
` : ''}
	vec3 col;
${b6 ? `
	// Blob 6 temperature ramp: gray (cold rim) -> blue -> green -> yellow ->
	// red -> pink (hottest core) — still sculpted by distance-to-letter.
	if (I < 0.12) col = vec3(150.0, 150.0, 155.0);
	else if (I < 0.32) { float f = (I - 0.12) / 0.2;  col = mix(vec3(150.0, 150.0, 155.0), vec3(60.0, 110.0, 255.0), f); }
	else if (I < 0.52) { float f = (I - 0.32) / 0.2;  col = mix(vec3(60.0, 110.0, 255.0), vec3(40.0, 200.0, 120.0), f); }
	else if (I < 0.72) { float f = (I - 0.52) / 0.2;  col = mix(vec3(40.0, 200.0, 120.0), vec3(255.0, 205.0, 40.0), f); }
	else if (I < 0.88) { float f = (I - 0.72) / 0.16; col = mix(vec3(255.0, 205.0, 40.0), vec3(255.0, 60.0, 40.0), f); }
	else {
${noisy >= 5 ? `
		// 6-10 overheat: past hot pink lives PASTEL pink — only tenure-
		// saturated zones (long-blobbed letters + their halo cores) reach it
		if (I < 0.96) { float f = (I - 0.88) / 0.08; col = mix(vec3(255.0, 60.0, 40.0), vec3(255.0, 95.0, 200.0), f); }
		else { float f = min(1.0, (I - 0.96) / 0.04); col = mix(vec3(255.0, 95.0, 200.0), vec3(255.0, 198.0, 221.0), f); }
` : `
		float f = min(1.0, (I - 0.88) / 0.12);     col = mix(vec3(255.0, 60.0, 40.0), vec3(255.0, 95.0, 200.0), f);
`}	}
` : `
	if (I < 0.18) col = vec3(255.0, 40.0, 40.0);
	else if (I < 0.8) { float f = (I - 0.18) / 0.62; col = vec3(255.0, 40.0 + 165.0 * f, 40.0); }
	else { float f = min(1.0, (I - 0.8) / 0.17); col = vec3(255.0, 205.0 - 110.0 * f, 40.0 + 160.0 * f); }
`}
${(noisy === 8 || noisy >= 10) ? `
	// 7-0 COLOUR WHEEL — temperature only climbs; the display LOOPS:
	// gray -> blue -> green -> yellow -> red -> hot pink -> pastel pink ->
	// pastel purple -> purple -> dark blue -> cyan -> light blue -> gray...
	// The circle closes (both ends are gray), so the wrap is seamless.
	float t12 = fract(I);
	if (t12 < 0.09)      col = mix(vec3(150.0, 150.0, 155.0), vec3(60.0, 110.0, 255.0),  t12 / 0.09);
	else if (t12 < 0.18) col = mix(vec3(60.0, 110.0, 255.0),  vec3(40.0, 200.0, 120.0), (t12 - 0.09) / 0.09);
	else if (t12 < 0.27) col = mix(vec3(40.0, 200.0, 120.0),  vec3(255.0, 205.0, 40.0), (t12 - 0.18) / 0.09);
	else if (t12 < 0.36) col = mix(vec3(255.0, 205.0, 40.0),  vec3(255.0, 60.0, 40.0),  (t12 - 0.27) / 0.09);
	else if (t12 < 0.45) col = mix(vec3(255.0, 60.0, 40.0),   vec3(255.0, 95.0, 200.0), (t12 - 0.36) / 0.09);
	else if (t12 < 0.54) col = mix(vec3(255.0, 95.0, 200.0),  vec3(255.0, 198.0, 221.0),(t12 - 0.45) / 0.09);
	else if (t12 < 0.63) col = mix(vec3(255.0, 198.0, 221.0), vec3(205.0, 170.0, 235.0),(t12 - 0.54) / 0.09);
	else if (t12 < 0.72) col = mix(vec3(205.0, 170.0, 235.0), vec3(125.0, 60.0, 195.0), (t12 - 0.63) / 0.09);
	else if (t12 < 0.81) col = mix(vec3(125.0, 60.0, 195.0),  vec3(40.0, 65.0, 185.0),  (t12 - 0.72) / 0.09);
	else if (t12 < 0.90) col = mix(vec3(40.0, 65.0, 185.0),   vec3(60.0, 220.0, 235.0), (t12 - 0.81) / 0.09);
	else if (t12 < 0.97) col = mix(vec3(60.0, 220.0, 235.0),  vec3(140.0, 185.0, 255.0),(t12 - 0.90) / 0.07);
	else                 col = mix(vec3(140.0, 185.0, 255.0), vec3(150.0, 150.0, 155.0),(t12 - 0.97) / 0.03);
${noisy >= 10 ? `
	// SEAM SQUEEZE (7-1/8/9): where fresh gray ground borders nearly-lapped
	// ground, the whole wheel is compressed into a couple of pixels — the
	// red filament. Two 1.5px taps measure the local phase gradient; over-
	// compressed pixels fade to gray. Real bands (a lap spread over 40px+)
	// sit far below the threshold and are untouched.
	vec2 e12 = 1.5 / uRes;
	float gA12 = texture2D(uM, st + vec2(e12.x, 0.0)).b;
	float gB12 = texture2D(uM, st + vec2(0.0, e12.y)).b;
	float grad12 = (abs(gA12 - lf6.b) + abs(gB12 - lf6.b)) * 2.0;
	col = mix(col, vec3(150.0, 150.0, 155.0), smoothstep(0.1, 0.25, grad12));
` : ''}
` : ''}	col = clamp(col * ${noisy >= 6 ? '(0.99 + 0.02 * n) /* 6-11: near-flat - glyph shading re-drew the text */' : '(0.9 + 0.2 * n)'} * (1.0 + 0.02 * mot) / 255.0, 0.0, 1.0);
	float a = vv * aMul;
	OUT(vec4(col * a, a)); // premultiplied
}`;
	function compile(type, src) {
		const s = gl.createShader(type);
		gl.shaderSource(s, src); gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
		return s;
	}
	function initGL() {
		if (prog) return;
		prog = gl.createProgram();
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, VSH));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FSH));
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
		gl.useProgram(prog);
		quadBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		aPLoc = gl.getAttribLocation(prog, 'aP');
		gl.enableVertexAttribArray(aPLoc);
		gl.vertexAttribPointer(aPLoc, 2, gl.FLOAT, false, 0, 0);
		uni = {
			gate: gl.getUniformLocation(prog, 'uGate'),
			satK: gl.getUniformLocation(prog, 'uSatK'),
			ph: gl.getUniformLocation(prog, 'uPh'),
			gph: gl.getUniformLocation(prog, 'uGPh'),
			lump: gl.getUniformLocation(prog, 'uLump'),
			moff: gl.getUniformLocation(prog, 'uMOff'),
			pods: gl.getUniformLocation(prog, 'uPods'),
			res: gl.getUniformLocation(prog, 'uRes'),
			n: gl.getUniformLocation(prog, 'uN'),
			b: gl.getUniformLocation(prog, 'uB'),
			m: gl.getUniformLocation(prog, 'uM'),
			mprev: gl.getUniformLocation(prog, 'uMPrev'),
			mmix: gl.getUniformLocation(prog, 'uMMix'),
			lid: gl.getUniformLocation(prog, 'uLid'),
			lvl: gl.getUniformLocation(prog, 'uLvl'),
			nl: gl.getUniformLocation(prog, 'uNL'),
			heat: gl.getUniformLocation(prog, 'uHeat'),
			com9: gl.getUniformLocation(prog, 'uCom9')
		};
		gl.uniform1i(uni.n, 0);
		gl.uniform1i(uni.b, 1);
		gl.uniform1i(uni.m, 2);
		if (uni.lid) gl.uniform1i(uni.lid, 4);
		if (uni.lvl) gl.uniform1i(uni.lvl, 5);
		if (uni.mprev) gl.uniform1i(uni.mprev, 6);
		gl.uniform2f(uni.res, W, H);
		gl.disable(gl.BLEND); // fragment outputs premultiplied straight into a cleared buffer
	}
	// Step & repeat layout: the title as a wall of rows × cols. Single cell
	// (1×1) reproduces the classic centred layout exactly. Rows pack at TIGHT
	// leading (~1.05× the fitted glyph em) with the block centred vertically —
	// spreading rows evenly over the full canvas left huge gaps whenever
	// width-fitting shrank the glyphs.
	const mcv = document.createElement('canvas');
	const mctx = mcv.getContext('2d');
	function wallLayout(o) {
		const rows = Math.max(1, Math.round(o.b3Rows || 1));
		const cols = Math.max(1, Math.round(o.b3Cols || 1));
		const gutter = cols > 1 ? W * clamp(o.b3Gap ?? 0.02, -0.15, 0.15) : 0;
		const colW = (W - gutter * (cols - 1)) / cols;
		const single = rows === 1 && cols === 1;
		if (single) {
			return { rows, cols, gutter, colW, single, fontPx: H * (o.fontFrac || 0.3), fitW: W * 0.86, rowY: () => H * 0.5 };
		}
		mctx.font = `${WGT} 100px ${o.fontFamily}`;
		if (o.hasStretch) mctx.fontStretch = '100%';
		let total = 0;
		for (const ch of Array.from(o.text || ' ')) total += mctx.measureText(ch).width;
		let px = total > 0 ? Math.min(170, ((colW * 0.94) * 100) / total) : 40;
		let pitch = px * 1.05;
		const maxH = H * 0.97;
		if (rows * pitch > maxH) { const s = maxH / (rows * pitch); px *= s; pitch *= s; }
		const y0 = H / 2 - ((rows - 1) * pitch) / 2;
		return { rows, cols, gutter, colW, single, fontPx: px, fitW: colW * 0.94, rowY: (r) => y0 + r * pitch };
	}
	function drawWall(c, o, weight) {
		const L = wallLayout(o);
		for (let col = 0; col < L.cols; col++) {
			const cx = col * (L.colW + L.gutter) + L.colW / 2;
			for (let r = 0; r < L.rows; r++) {
				drawFittedLineAt(c, o.text, cx, L.rowY(r), L.fitW, L.fontPx, o.fontFamily, weight, o.hasStretch);
			}
		}
	}
	function reset() {
		const o = getOpts();
		const L = wallLayout(o);
		let lidBytesR = null; // Blob 5: packed Voronoi letter-id map (built below)
		let saOrig = null;    // Blob 6-3: strokes-only mask, snapshotted before counter-filling
		// Seed = the full wall in the hairline weight; everything else (cells,
		// pods, beads, distance field) derives from this one bitmap, so all the
		// blob machinery works across the whole wall — goo can bridge rows.
		const seed = document.createElement('canvas'); seed.width = W; seed.height = H;
		const sc = seed.getContext('2d', { willReadFrequently: true });
		sc.fillStyle = '#fff';
		drawWall(sc, o, WGT);
		const sa = sc.getImageData(0, 0, W, H).data;
		if (b6) {
			if (b6 === 3 || b6 === 5) {
				// keep the OPEN (true-stroke) mask for the counter-opening melt
				saOrig = new Uint8Array(W * H);
				for (let i = 0; i < W * H; i++) saOrig[i] = sa[i * 4 + 3] > 128 ? 1 : 0;
			}
			// SOLID GLYPHS: flood the exterior from the border; any pixel not
			// reached and not stroke is a COUNTER — fill it. Mutating the seed
			// alpha here means every downstream field (cells, letter components,
			// distance field, Voronoi, beads) sees solid hole-free letters.
			const reach6 = new Uint8Array(W * H);
			const q6 = new Int32Array(W * H);
			let qh6 = 0, qt6 = 0;
			const push6 = (i) => { if (!reach6[i] && sa[i * 4 + 3] <= 128) { reach6[i] = 1; q6[qt6++] = i; } };
			for (let x = 0; x < W; x++) { push6(x); push6((H - 1) * W + x); }
			for (let y = 0; y < H; y++) { push6(y * W); push6(y * W + W - 1); }
			while (qh6 < qt6) {
				const i = q6[qh6++], x = i % W, y = (i / W) | 0;
				if (x > 0) push6(i - 1);
				if (x < W - 1) push6(i + 1);
				if (y > 0) push6(i - W);
				if (y < H - 1) push6(i + W);
			}
			for (let i = 0; i < W * H; i++) if (sa[i * 4 + 3] <= 128 && !reach6[i]) sa[i * 4 + 3] = 255;
		}
		// stroke cells sampled straight off the seed bitmap (canvas px coords)
		const stride = Math.max(2, Math.round(Math.max(W, H) / 420));
		const cells = [];
		for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride)
			if (sa[(y * W + x) * 4 + 3] > 128) cells.push([x, y]);
		// fitted per-line letter height via a direct measurement (bead/pod/reach
		// scales must track the PER-LINE glyph size, not the canvas)
		let letterH = L.fontPx * 0.72;
		{
			sc.font = `${WGT} ${L.fontPx}px ${o.fontFamily}`;
			if (o.hasStretch) sc.fontStretch = '100%';
			let total = 0;
			for (const ch of Array.from(o.text || '')) total += sc.measureText(ch).width;
			const fscale = total > 0 ? Math.min(1.7, L.fitW / total) : 1;
			letterH = Math.max(8, L.fontPx * fscale * 0.72);
		}
		lumpF = TAU / (letterH * 0.85); // gloop lump wavelength ≈ letter height
		hasText = cells.length > 0;
		podR = letterH * 1.6;
		letterH2 = letterH;
		if (mass) {
			// seed the creature: a few nodes on a random letter, staggered ramps
			txCells = cells;
			nodes = []; heading = rng() * TAU; addT = 0.2; remT = 0.9;
			goal = null; goalT = 0; splitT = 5 + rng() * 4; dropD = 0;
			// the HEAD is a permanent full-weight disc that translates — the
			// visible front of the mass is pure motion, never a weight ramp
			const c0 = cells[(rng() * cells.length) | 0];
			headN = { x: c0[0], y: c0[1], r: letterH2 * 0.78, w: 1, tw: 1 };
			anchorX = c0[0]; anchorY = c0[1];
			nodes.push(headN);
			headDist = 0; tailDist = -letterH2 * 2; // short starting body
			if (letterQ) {
				// letters: connected components (8-conn) + centroids
				const lab = new Int32Array(W * H).fill(-1);
				const comps = [];
				{
					const q5 = new Int32Array(W * H);
					for (let p0 = 0; p0 < W * H; p0++) {
						if (lab[p0] >= 0 || sa[p0 * 4 + 3] <= 128) continue;
						const id = comps.length;
						const cp = { sx: 0, sy: 0, cnt: 0, minX: W, maxX: 0, minY: H, maxY: 0 };
						comps.push(cp);
						let qh5 = 0, qt5 = 0;
						q5[qt5++] = p0; lab[p0] = id;
						while (qh5 < qt5) {
							const pp = q5[qh5++], px5 = pp % W, py5 = (pp / W) | 0;
							cp.cnt++; cp.sx += px5; cp.sy += py5;
							if (px5 < cp.minX) cp.minX = px5;
							if (px5 > cp.maxX) cp.maxX = px5;
							if (py5 < cp.minY) cp.minY = py5;
							if (py5 > cp.maxY) cp.maxY = py5;
							for (let dy5 = -1; dy5 <= 1; dy5++) for (let dx5 = -1; dx5 <= 1; dx5++) {
								if (!dx5 && !dy5) continue;
								const nx5 = px5 + dx5, ny5 = py5 + dy5;
								if (nx5 < 0 || nx5 >= W || ny5 < 0 || ny5 >= H) continue;
								const np = ny5 * W + nx5;
								if (lab[np] < 0 && sa[np * 4 + 3] > 128) { lab[np] = id; q5[qt5++] = np; }
							}
						}
					}
				}
				nLetters = Math.max(1, comps.length);
				letterList = comps.map((cp, i) => ({
					i,
					cx: cp.sx / Math.max(1, cp.cnt), cy: cp.sy / Math.max(1, cp.cnt),
					// touch radius ≈ half-diagonal of the glyph's bbox: contact
					// with the letter's EDGE triggers the gulp, not just its core
					rad: Math.hypot(cp.maxX - cp.minX, cp.maxY - cp.minY) * 0.5,
					S: 0, Q: 0, on: false
				}));
				lvlBytes = new Uint8Array(nLetters * 2); // [S, Q] per letter
				// nearest-letter Voronoi via chamfer id propagation, packed 16-bit
				const vDist = new Float32Array(W * H).fill(1e12);
				const vId = new Int32Array(W * H);
				for (let p = 0; p < W * H; p++) if (lab[p] >= 0) { vDist[p] = 0; vId[p] = lab[p]; }
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					const p = y * W + x; let dd = vDist[p], di = vId[p];
					if (x > 0 && vDist[p - 1] + 1 < dd) { dd = vDist[p - 1] + 1; di = vId[p - 1]; }
					if (y > 0) {
						if (vDist[p - W] + 1 < dd) { dd = vDist[p - W] + 1; di = vId[p - W]; }
						if (x > 0 && vDist[p - W - 1] + 1.4 < dd) { dd = vDist[p - W - 1] + 1.4; di = vId[p - W - 1]; }
						if (x < W - 1 && vDist[p - W + 1] + 1.4 < dd) { dd = vDist[p - W + 1] + 1.4; di = vId[p - W + 1]; }
					}
					vDist[p] = dd; vId[p] = di;
				}
				for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
					const p = y * W + x; let dd = vDist[p], di = vId[p];
					if (x < W - 1 && vDist[p + 1] + 1 < dd) { dd = vDist[p + 1] + 1; di = vId[p + 1]; }
					if (y < H - 1) {
						if (vDist[p + W] + 1 < dd) { dd = vDist[p + W] + 1; di = vId[p + W]; }
						if (x < W - 1 && vDist[p + W + 1] + 1.4 < dd) { dd = vDist[p + W + 1] + 1.4; di = vId[p + W + 1]; }
						if (x > 0 && vDist[p + W - 1] + 1.4 < dd) { dd = vDist[p + W - 1] + 1.4; di = vId[p + W - 1]; }
					}
					vDist[p] = dd; vId[p] = di;
				}
				lidBytesR = new Uint8Array(W * H * 2);
				for (let p = 0; p < W * H; p++) { const id = vId[p]; lidBytesR[p * 2] = id & 255; lidBytesR[p * 2 + 1] = id >> 8; }
				if (b6 === 5) {
					// per-letter sprites for the fused field. 3px grid: at 6px the
					// melting contour (letter-field-only, unlike arrivals which the
					// agents' full-res gaussians cover) crawled over visible grid
					// stair-steps — a SPATIAL stutter no temporal fix could touch.
					gs6 = 3;
					gw6 = Math.max(2, Math.ceil(W / gs6));
					gh6 = Math.max(2, Math.ceil(H / gs6));
					sprites6 = comps.map((cp) => {
						const gx = Math.floor(cp.minX / gs6), gy = Math.floor(cp.minY / gs6);
						const w6 = Math.floor(cp.maxX / gs6) - gx + 1;
						const h6 = Math.floor(cp.maxY / gs6) - gy + 1;
						return { gx, gy, w: w6, h: h6, d: new Float32Array(w6 * h6) };
					});
					const inv6 = 1 / (gs6 * gs6);
					for (let p = 0; p < W * H; p++) {
						const id = lab[p];
						if (id < 0) continue;
						const sp = sprites6[id];
						const gx = Math.floor((p % W) / gs6) - sp.gx;
						const gy = Math.floor(((p / W) | 0) / gs6) - sp.gy;
						sp.d[gy * sp.w + gx] += inv6;
					}
					accum6 = new Float32Array(gw6 * gh6);
					tmp6 = new Float32Array(gw6 * gh6);
					accumC6 = new Float32Array(gw6 * gh6);
					tmpC6 = new Float32Array(gw6 * gh6);
					if (noisy >= 5) { accumD6 = new Float32Array(gw6 * gh6); tmpD6 = new Float32Array(gw6 * gh6); }
					if (noisy >= 6) { heatF6 = new Float32Array(gw6 * gh6); tmpH6 = new Float32Array(gw6 * gh6); }
					// 6-10 packs a third (dwell) channel, so the field goes RGBA
					mBytes6 = new Uint8Array(gw6 * gh6 * (noisy >= 5 ? 4 : 2));
				}
				// the colony starts as a single roamer on a random letter
				const ca = cells[(rng() * cells.length) | 0];
				agents = [makeAgent(ca[0], ca[1])];
				branchT = 3;
			}
		}
		clusters = [];
		if (!cellular && !mass && cells.length) {
			// pod variant: well-separated pod anchors on the strokes
			const NC = L.single ? 5 : 8;
			const minPodD = Math.min(W, H) * (L.single ? 0.22 : 0.16);
			let guard = 0;
			while (clusters.length < NC && guard++ < 800) {
				const c = cells[(rng() * cells.length) | 0];
				if (clusters.every((q) => Math.hypot(q.x0 - c[0], q.y0 - c[1]) > minPodD))
					clusters.push({ x0: c[0], y0: c[1], off: ((clusters.length + rng() * 0.35) / NC) * 0.75 });
			}
		}
		// The ORGANISM grid: FINE cells (several per letter) over the wall; a
		// cell is valid if any stroke pixels fall inside it. Letters are
		// segmented as connected components of the glyph pixels, so the
		// organism knows what "a letter" is: branching into one commits to
		// swallowing ALL of it (continuous cascade), departure is cell-by-cell.
		if (cellular) {
			// letter segmentation: 8-connected components of the glyph pixels
			const lab = new Int32Array(W * H).fill(-1);
			{
				const q2 = new Int32Array(W * H);
				let nComp = 0;
				for (let p0 = 0; p0 < W * H; p0++) {
					if (lab[p0] >= 0 || sa[p0 * 4 + 3] <= 128) continue;
					let qh3 = 0, qt3 = 0;
					q2[qt3++] = p0; lab[p0] = nComp;
					while (qh3 < qt3) {
						const pp = q2[qh3++], px2 = pp % W, py2 = (pp / W) | 0;
						for (let dy2 = -1; dy2 <= 1; dy2++) for (let dx2 = -1; dx2 <= 1; dx2++) {
							if (!dx2 && !dy2) continue;
							const nx2 = px2 + dx2, ny2 = py2 + dy2;
							if (nx2 < 0 || nx2 >= W || ny2 < 0 || ny2 >= H) continue;
							const np = ny2 * W + nx2;
							if (lab[np] < 0 && sa[np * 4 + 3] > 128) { lab[np] = nComp; q2[qt3++] = np; }
						}
					}
					nComp++;
				}
			}
			const cellPx = clamp(letterH * 0.5, 4, 140);
			gw2 = Math.max(2, Math.round(W / cellPx));
			gh2 = Math.max(2, Math.round(H / cellPx));
			const cw2 = W / gw2, ch2 = H / gh2;
			valid = new Uint8Array(gw2 * gh2);
			cellComp = new Int32Array(gw2 * gh2).fill(-1);
			for (let gy = 0; gy < gh2; gy++) for (let gx = 0; gx < gw2; gx++) {
				const x0 = Math.floor(gx * cw2), x1 = Math.min(W - 1, Math.floor((gx + 1) * cw2));
				const y0 = Math.floor(gy * ch2), y1 = Math.min(H - 1, Math.floor((gy + 1) * ch2));
				let hit = 0, comp = -1;
				scan: for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2)
					if (sa[(y * W + x) * 4 + 3] > 128) { hit = 1; comp = lab[y * W + x]; break scan; }
				valid[gy * gw2 + gx] = hit;
				cellComp[gy * gw2 + gx] = comp;
			}
			compCells = new Map();
			let validCount = 0;
			for (let i = 0; i < valid.length; i++) {
				if (!valid[i]) continue;
				validCount++;
				const cc = cellComp[i];
				if (!compCells.has(cc)) compCells.set(cc, []);
				compCells.get(cc).push(i);
			}
			// cap = ~10 LETTERS' worth of cells (preserves the creature size the
			// user tuned when a cell ≈ a letter)
			capC = Math.max(6, Math.round(10 * (validCount / Math.max(1, compCells.size))));
			swallows = [];
			alive = new Uint8Array(gw2 * gh2);
			level = new Float32Array(gw2 * gh2);
			ageT = new Float32Array(gw2 * gh2).fill(99); // age in TURNS; seeds start mature
			// per-cell breathing (phase + rate): occupied cells undulate smoothly
			// between decisions, so the surface is NEVER static
			phB = new Float32Array(gw2 * gh2);
			rateB = new Float32Array(gw2 * gh2);
			for (let i = 0; i < phB.length; i++) { phB[i] = rng() * TAU; rateB[i] = 0.5 + rng() * 0.9; }
			mBytes = new Uint8Array(gw2 * gh2);
			simT = 0;
			// seed a few starters, then a few warm-up ticks so frame 0 has a mass
			const vs = [];
			for (let i = 0; i < valid.length; i++) if (valid[i]) vs.push(i);
			const nSeed = Math.min(vs.length, L.single ? 2 : 4);
			for (let s2 = 0; s2 < nSeed; s2++) claimAndSwallow(vs[(rng() * vs.length) | 0]);
			// flush the seed swallows so frame 0 starts on WHOLE letters
			for (const sw of swallows) for (const j of sw.cells) { alive[j] = 1; ageT[j] = 0; }
			swallows = [];
			for (let k2 = 0; k2 < 2; k2++) sweep(0);
			for (const sw of swallows) for (const j of sw.cells) { alive[j] = 1; ageT[j] = 0; }
			swallows = [];
			for (let i = 0; i < level.length; i++) level[i] = alive[i] ? 0.6 + rng() * 0.4 : 0;
		}
		// distance field (exact EDT) → 8-bit ALPHA texture; LINEAR re-smooths.
		const D = new Float64Array(W * H);
		for (let p = 0; p < W * H; p++) D[p] = sa[p * 4 + 3] > 128 ? 0 : 1e12;
		edt2d(D, W, H);
		// 6-12: boundary reverted to the 6-11 footprint (single 0.7 slope) —
		// the 2.2-letter-height tail was the runway the runaway lowest band
		// rode out on. Hot bands march WITHIN this boundary; the blob's total
		// silhouette matches 6-11 exactly.
		const maxReach = Math.max(6, letterH * ((noisy === 8 || noisy >= 10) ? 0.49 : 0.7)); // 7-0: blobbable halo 30% tighter
		const nBytes = new Uint8Array(W * H);
		for (let p = 0; p < W * H; p++) {
			const dd = Math.sqrt(D[p]);
			nBytes[p] = clamp(1 - dd / maxReach, 0, 1) * 255;
		}
		// Bead field for the colour marbling — built the way Blob 1 builds its
		// influence beads: POISSON-thinned stroke cells (even spacing, near-
		// uniform size/strength), drawn sharp then blurred once at ~0.55 bead
		// radii. Even spacing is what gives Blob 1 its characteristic granular
		// texture — random scatter reads as blotch, not beads.
		const rB2 = clamp(letterH * 0.2, 3, 60);
		const bcv = document.createElement('canvas'); bcv.width = W; bcv.height = H;
		const bx = bcv.getContext('2d');
		bx.fillStyle = '#fff';
		if (cells.length) {
			const order = cells.slice();
			for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const sw = order[i]; order[i] = order[j]; order[j] = sw; }
			const minD = rB2 * 1.2, cellSz = Math.max(1, minD);
			const gcols = Math.ceil(W / cellSz), grows2 = Math.ceil(H / cellSz);
			const heads = new Int32Array(gcols * grows2).fill(-1);
			const pts = [], nxt = [];
			outer: for (const c of order) {
				const x = c[0], y = c[1];
				const gx = clamp((x / cellSz) | 0, 0, gcols - 1), gy = clamp((y / cellSz) | 0, 0, grows2 - 1);
				for (let yy = Math.max(0, gy - 1); yy <= Math.min(grows2 - 1, gy + 1); yy++)
					for (let xx = Math.max(0, gx - 1); xx <= Math.min(gcols - 1, gx + 1); xx++) {
						let h = heads[yy * gcols + xx];
						while (h >= 0) {
							const q2 = pts[h];
							if ((q2[0] - x) * (q2[0] - x) + (q2[1] - y) * (q2[1] - y) < minD * minD) continue outer;
							h = nxt[h];
						}
					}
				pts.push([x, y]);
				nxt.push(heads[gy * gcols + gx]); heads[gy * gcols + gx] = pts.length - 1;
				// strong per-bead strength variance → after the heavy blur these
				// become the medium-scale patches that make the spread uneven
				bx.globalAlpha = 0.25 + rng() * 0.75;
				bx.beginPath(); bx.arc(x, y, rB2 * (0.92 + rng() * 0.16), 0, TAU); bx.fill();
			}
			bx.globalAlpha = 1;
		}
		// Two blur levels of the same bead canvas → one LUMINANCE_ALPHA texture:
		//   luminance (.r) = HEAVY blur → smooth medium-scale strength patches
		//                    (drives the uneven, part-of-a-letter-first spread)
		//   alpha     (.a) = light blur → fine bead marbling (drives the colour)
		// Both channels normalized to use the full 0..255 range.
		const blurRead = (radius) => {
			const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H;
			const c2 = cv2.getContext('2d', { willReadFrequently: true });
			c2.filter = `blur(${Math.max(2, Math.round(radius))}px)`;
			c2.drawImage(bcv, 0, 0);
			c2.filter = 'none';
			return c2.getImageData(0, 0, W, H).data;
		};
		const fine = blurRead(rB2 * 0.5), patch = blurRead(rB2 * 2.6);
		let fMax = 1, pMax = 1;
		for (let p = 3; p < fine.length; p += 4) { if (fine[p] > fMax) fMax = fine[p]; if (patch[p] > pMax) pMax = patch[p]; }
		const la = new Uint8Array(W * H * 2);
		for (let p = 0; p < W * H; p++) {
			la[p * 2] = Math.min(255, (patch[p * 4 + 3] * 255 / pMax) | 0);
			la[p * 2 + 1] = Math.min(255, (fine[p * 4 + 3] * 255 / fMax) | 0);
		}

		initGL();
		const upload = (unit, bytes, format) => {
			const tex = gl.createTexture();
			gl.activeTexture(unit);
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(gl.TEXTURE_2D, 0, format, W, H, 0, format, gl.UNSIGNED_BYTE, bytes);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			return tex;
		};
		bTex = upload(gl.TEXTURE1, la, gl.LUMINANCE_ALPHA);
		if ((b6 === 3 || b6 === 5) && saOrig) {
			// dual field: L = open (true strokes), A = solid (counters filled)
			const D2 = new Float64Array(W * H);
			for (let p = 0; p < W * H; p++) D2[p] = saOrig[p] ? 0 : 1e12;
			edt2d(D2, W, H);
			const maxReach2 = Math.max(6, letterH2 * ((noisy === 8 || noisy >= 10) ? 0.49 : 0.7));
			const la0 = new Uint8Array(W * H * 2);
			for (let p = 0; p < W * H; p++) {
				const dd2 = Math.sqrt(D2[p]);
				la0[p * 2] = clamp(1 - dd2 / maxReach2, 0, 1) * 255;
				la0[p * 2 + 1] = nBytes[p];
			}
			nTex = upload(gl.TEXTURE0, la0, gl.LUMINANCE_ALPHA);
		} else {
			nTex = upload(gl.TEXTURE0, nBytes, gl.ALPHA);
		}
		if (cellular) {
			massTex = gl.createTexture();
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, massTex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.uniform2f(uni.moff, 0.75 / gw2, 0.75 / gh2);
		}
		if (letterQ && b6 === 5) {
			// mass texture pair: current tick + previous tick (cross-fade)
			const mkMass = () => {
				const tx6 = gl.createTexture();
				gl.activeTexture(gl.TEXTURE2);
				gl.bindTexture(gl.TEXTURE_2D, tx6);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				return tx6;
			};
			massTex = mkMass();
			massTexPrev = mkMass();
			firstTick6 = true;
		}
		if (letterQ && lidBytesR) {
			// Voronoi id map: NEAREST filtering is mandatory — LINEAR would
			// interpolate between neighbouring letter IDS at cell borders.
			lidTex = gl.createTexture();
			gl.activeTexture(gl.TEXTURE4);
			gl.bindTexture(gl.TEXTURE_2D, lidTex);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, W, H, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, lidBytesR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			lvlTex = gl.createTexture();
			gl.activeTexture(gl.TEXTURE5);
			gl.bindTexture(gl.TEXTURE_2D, lvlTex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, nLetters, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, lvlBytes);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			if (uni.nl) gl.uniform1f(uni.nl, nLetters);
		}
		t = 0;
	}
	// One decision per alive cell (base probabilities, the user's spec):
	//   30% → branch to a random adjacent dead letter-cell (grow/meander)
	//   20% → die — but ONLY if the cell is on the edge of the mass
	//   50% → hold still
	// `press` (0..1) = population pressure once the mass exceeds the cap:
	// branching chokes, edge-death climbs — the creature stays ~CAP cells,
	// migrates (dies on one flank while growing on another) and splits when a
	// neck gets severed.
	// Claim a cell AND commit to its whole letter: the remaining cells of that
	// glyph queue up in flood order from the entry point and get claimed on a
	// steady cadence — the swallow is GUARANTEED and reads as one continuous
	// organic motion instead of claim-stop-claim.
	function claimAndSwallow(j) {
		alive[j] = 1; ageT[j] = 0;
		const cc = cellComp[j];
		const rest = cc >= 0 ? (compCells.get(cc) || []).filter((c2) => !alive[c2]) : [];
		if (!rest.length) return;
		const jx = j % gw2, jy = (j / gw2) | 0;
		rest.sort((a2, b2) => {
			const d1 = Math.abs((a2 % gw2) - jx) + Math.abs(((a2 / gw2) | 0) - jy);
			const d2 = Math.abs((b2 % gw2) - jx) + Math.abs(((b2 / gw2) | 0) - jy);
			return d1 - d2;
		});
		swallows.push({ cells: rest, timer: 0.2 });
	}
	function decide(i, press, snap) {
		const x = i % gw2, y = (i / gw2) | 0;
		const nb = [];
		if (x > 0) nb.push(i - 1);
		if (x < gw2 - 1) nb.push(i + 1);
		if (y > 0) nb.push(i - gw2);
		if (y < gh2 - 1) nb.push(i + gw2);
		const r = rng();
		const pB = 0.3 * (1 - press), pD = 0.2 + 0.5 * press;
		if (r < pB) {
			const opts = nb.filter((j) => valid[j] && !snap[j]);
			if (opts.length) claimAndSwallow(opts[(rng() * opts.length) | 0]);
		} else if (r < pB + pD) {
			// TENURE: a freshly-occupied cell is immune to death for 10 turns —
			// otherwise the blob staggers (claims a letter, instantly abandons it).
			// Departure is cell-by-cell: leaving a letter in parts is allowed.
			const isEdge = nb.length < 4 || nb.some((j) => !valid[j] || !snap[j]);
			if (isEdge && ageT[i] >= 10) alive[i] = 0;
		}
	}
	function sweep(press) { // every alive cell decides once (warm-up only)
		const snap = alive.slice();
		for (let i = 0; i < snap.length; i++) if (snap[i]) decide(i, press, snap);
	}
	// ── Blob 5: the colony of invisible roamers ──────────────────────────────
	// Each agent carries Blob 4's full steering brain; the colony BRANCHES
	// (a new agent splits off from an existing one and treks away) and prunes
	// itself on lifespans. Capacity scales with how many letters there are.
	function makeAgent(x, y) {
		return {
			x, y, heading: rng() * TAU, goal: null, goalT: 0,
			ax: x, ay: y, hist: [], histT: 0,
			life: 15 + rng() * 10, w: 1, dying: false, ph: rng() * TAU
		};
	}
	function steerAgent(a, dt, spd) {
		a.goalT -= dt * spd;
		if (a.goalT <= 0 || !a.goal || Math.hypot(a.goal[0] - a.x, a.goal[1] - a.y) < letterH2 * 2.2) {
			const minTrek = Math.max(letterH2 * 7, Math.min(W, H) * 0.35);
			let bestG = null, bestS = -1e9, anyG = null, anyS = -1e9;
			for (let k3 = 0; k3 < 24; k3++) {
				const c = txCells[(rng() * txCells.length) | 0];
				const dx3 = c[0] - a.x, dy3 = c[1] - a.y;
				const d4 = Math.hypot(dx3, dy3);
				const ali = Math.cos(Math.atan2(dy3, dx3) - a.heading);
				// vertical appetite: destinations on OTHER rows score higher, so
				// the colony dives and climbs the wall instead of commuting
				// horizontally along its home line
				const vert = Math.min(1, Math.abs(dy3) / (letterH2 * 2.5));
				const s5 = (1.2 + ali) * (0.3 + Math.min(2, d4 / (W * 0.3))) * (1 + 0.45 * vert);
				if (s5 > anyS) { anyS = s5; anyG = c; }
				if (d4 < minTrek) continue;
				if (s5 > bestS) { bestS = s5; bestG = c; }
			}
			a.goal = bestG || anyG;
			a.goalT = (8 + rng() * 5) * (noisy >= 10 ? 0.7 : 1); // 7-1: colony re-decides 30% sooner - less hanging on
		}
		let best = null, bd = 1e18;
		const hx2 = Math.cos(a.heading), hy2 = Math.sin(a.heading);
		for (let k2 = 0; k2 < 24; k2++) {
			const c = txCells[(rng() * txCells.length) | 0];
			const dx4 = c[0] - a.x, dy4 = c[1] - a.y;
			const d5 = Math.hypot(dx4, dy4);
			if (d5 < 1) continue;
			const fwd = (dx4 * hx2 + dy4 * hy2) / d5;
			if (fwd < 0.1) continue;
			const gd = a.goal ? Math.hypot(a.goal[0] - c[0], a.goal[1] - c[1]) : 0;
			const score = d5 * (1.6 - fwd) + gd * 0.5;
			if (score < bd) { bd = score; best = c; }
		}
		if (best) {
			const lp = Math.min(1, dt * 1.2);
			a.ax += (best[0] - a.ax) * lp;
			a.ay += (best[1] - a.ay) * lp;
		}
		const tgx = (a.goal ? a.goal[0] : a.ax) * 0.5 + a.ax * 0.5;
		const tgy = (a.goal ? a.goal[1] : a.ay) * 0.5 + a.ay * 0.5;
		const want = Math.atan2(tgy - a.y, tgx - a.x);
		const dh = ((want - a.heading + Math.PI * 3) % TAU) - Math.PI;
		const wander = Math.sin((t + a.ph) * spd * 0.9 + 2.1) * 0.55 + Math.sin((t + a.ph) * spd * 0.53 + 0.4) * 0.3;
		a.heading += clamp(dh * 1.4 + wander, -1.7, 1.7) * dt * spd;
		const v = letterH2 * 1.7 * spd * (1 + 0.12 * Math.sin((t + a.ph) * spd * 0.7 + 1.7));
		if (noisy === 12 || noisy >= 16) {
			// Blob 9/12-2: MANHATTAN motion — the steering brain runs unchanged, but
			// actual travel snaps to up/down/left/right runs; every 0.35-0.85s
			// the creature re-picks the cardinal nearest its desired heading,
			// so paths are straight segments joined by 90-degree corners.
			a.turnT = (a.turnT || 0) - dt * spd;
			if (a.turnT <= 0 || a.card == null) {
				a.turnT = 0.35 + rng() * 0.5;
				a.card = Math.round(a.heading / (Math.PI / 2)) & 3;
			}
			const ca = a.card * (Math.PI / 2);
			a.x += Math.cos(ca) * v * dt;
			a.y += Math.sin(ca) * v * dt;
		} else {
			a.x += Math.cos(a.heading) * v * dt;
			a.y += Math.sin(a.heading) * v * dt;
		}
	}
	function stepCellWalker(a, dt, spd) {
		// Blob 12: the creature walks the TEXT GRID itself — one cell per move,
		// eased glide between cell centres. It remembers its last TWO moves and
		// may not take the opposite of either (moved right -> no left for 2
		// turns, etc.), so runs stay straight for longer, snake-style.
		if (!a.cw) {
			let bc = txCells[0], bd = 1e18;
			for (const c of txCells) { const d9 = (c[0] - a.x) ** 2 + (c[1] - a.y) ** 2; if (d9 < bd) { bd = d9; bc = c; } }
			a.cw = { from: bc, to: bc, prog: 1, mv: [], goal: null, goalT: 0 };
		}
		const cw = a.cw;
		cw.goalT -= dt * spd;
		if (cw.goalT <= 0 || !cw.goal) { cw.goal = txCells[(rng() * txCells.length) | 0]; cw.goalT = 9 + rng() * 6; }
		cw.prog += dt * spd * 2.2 / (cw.len || 1); // ~0.45s per cell hopped (2-cell runs glide at the same pace)
		if (cw.prog >= 1) {
			const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
			const opts = [];
			for (let d = 0; d < 4; d++) {
				let best = null, bs = 1e18;
				for (const c of txCells) {
					const dx = c[0] - cw.to[0], dy = c[1] - cw.to[1];
					const dist = Math.hypot(dx, dy);
					if (dist < 1 || dist > letterH2 * 3.2) continue;
					if ((dx * DIR[d][0] + dy * DIR[d][1]) / dist < 0.8) continue;
					if (dist < bs) { bs = dist; best = c; }
				}
				if (best) opts.push({ d, c: best });
			}
			if (opts.length) {
				const banned = new Set(cw.mv.map((m) => m ^ 1)); // 0<->1, 2<->3 are opposites
				let pool = opts.filter((o) => !banned.has(o.d));
				if (!pool.length) pool = opts; // cornered: reversal allowed as a last resort
				let pick = pool[0], ps = -1e18;
				for (const o of pool) {
					const gx = cw.goal[0] - cw.to[0], gy = cw.goal[1] - cw.to[1];
					const gd = Math.hypot(gx, gy) || 1;
					const s = (o.c[0] - cw.to[0]) * (gx / gd) + (o.c[1] - cw.to[1]) * (gy / gd)
						+ (cw.mv.length && cw.mv[cw.mv.length - 1] === o.d ? letterH2 * 0.6 : 0) // momentum
						- ((cw.seen || []).includes(o.c) ? letterH2 * 2.5 : 0) // NO RETRACING if avoidable: recently-visited cells cost dearly but stay legal, so a cornered walker still moves
						+ rng() * letterH2 * 0.5;
					if (s > ps) { ps = s; pick = o; }
				}
				cw.from = cw.to;
				let dest9 = pick.c, len9 = 1;
				if (rng() < 0.5) {
					// STRIDE 2: half the moves try to run a second cell in the
					// same direction (skipped if that cell was recently visited)
					let b2 = null, s2 = 1e18;
					for (const c of txCells) {
						const dx = c[0] - pick.c[0], dy = c[1] - pick.c[1];
						const dist = Math.hypot(dx, dy);
						if (dist < 1 || dist > letterH2 * 3.2) continue;
						if ((dx * DIR[pick.d][0] + dy * DIR[pick.d][1]) / dist < 0.8) continue;
						if (dist < s2) { s2 = dist; b2 = c; }
					}
					if (b2 && !(cw.seen || []).includes(b2)) { dest9 = b2; len9 = 2; }
				}
				cw.to = dest9; cw.prog = 0; cw.len = len9;
				cw.mv.push(pick.d); if (cw.mv.length > 2) cw.mv.shift();
				cw.seen = cw.seen || []; cw.seen.push(cw.from); if (cw.seen.length > 5) cw.seen.shift();
			} else cw.prog = 1;
		}
		const e9 = cw.prog < 1 ? cw.prog * cw.prog * (3 - 2 * cw.prog) : 1;
		a.x = cw.from[0] + (cw.to[0] - cw.from[0]) * e9;
		a.y = cw.from[1] + (cw.to[1] - cw.from[1]) * e9;
		a.heading = Math.atan2(cw.to[1] - cw.from[1], (cw.to[0] - cw.from[0]) || 1e-6);
	}
	function stepAgents(dt, o) {
		const spd = simSpd(o);
		if (noisy >= 4 && agents.length) {
			// lagging center of mass: trails the colony like the goo's belly
			let sx9 = 0, sy9 = 0, n9 = 0;
			for (const a of agents) if (!a.dying) { sx9 += a.x; sy9 += a.y; n9++; }
			if (n9) {
				const mx9 = sx9 / n9, my9 = sy9 / n9;
				if (com9x < -1e8) { com9x = mx9; com9y = my9; }
				const k9 = Math.min(1, dt * spd * 0.5);
				com9x += (mx9 - com9x) * k9; com9y += (my9 - com9y) * k9;
			}
		}
		if (!txCells.length) return;
		// BRANCHING: only a BIG wall (5+ lines) earns multiple masses — anything
		// smaller keeps the single-roamer intimacy. On big walls a new agent
		// splits off from an existing one's position and treks away.
		const rows5 = Math.max(1, Math.round(o.b3Rows || 1));
		const maxA = noisy >= 11 ? clamp(Math.round(nLetters / 8), 3, 5) : rows5 >= 5 ? clamp(Math.round(nLetters / 12), 2, 4) : 1; // Blob 8: always a small swarm (cap 5: heads + slow-fading line trails must fit the 64 pod slots)
		branchT -= dt * spd;
		if (branchT <= 0) {
			branchT = noisy >= 11 ? 2.5 + rng() * 2 : 6 + rng() * 5;
			const live = agents.filter((a) => !a.dying);
			if (live.length && live.length < maxA) {
				const srcA = live[(rng() * live.length) | 0];
				const na = makeAgent(srcA.x, srcA.y);
				if (noisy >= 11) {
					// Blob 8/9: a separate small mass POPPING in at full weight
					// reads as a glitch — births start near-zero and swell in
					// (~1.5s), heading roughly where the parent was going
					na.w = 0.02;
					na.heading = srcA.heading + (rng() - 0.5) * 0.8;
				}
				agents.push(na);
			}
		}
		let liveCount = 0;
		for (const a of agents) if (!a.dying) liveCount++;
		for (let i2 = agents.length - 1; i2 >= 0; i2--) {
			const a = agents[i2];
			if (!a.dying) {
				a.life -= dt * spd;
				if (a.life <= 0 && liveCount > 1) { a.dying = true; liveCount--; }
			}
			if (a.dying) {
				a.w -= dt * spd * 0.7; // influence dissolves in place; letters release
				if (a.w <= 0) { agents.splice(i2, 1); continue; }
			} else {
				if (noisy === 15) stepCellWalker(a, dt, spd); else steerAgent(a, dt, spd);
				if (a.w < 1) a.w = Math.min(1, a.w + dt * spd * 0.7); // birth swell-in
			}
			// short trail of hold-points so letters linger held behind the head.
			// CONTINUOUS HANDOFF (Blob 4's fix, ported): a new point is born at
			// ZERO weight and matures exactly as the head's own gaussian recedes
			// from it — full-weight drops pumped the rendered field at the
			// ~4.5Hz drop cadence (the stutter 6-4 doesn't have).
			a.histT += dt * spd;
			if (!a.dying && a.histT >= (noisy >= 11 ? 0.3 : 0.22)) {
				a.histT = 0;
				a.hist.push({ x: a.x, y: a.y, w: 0, hand: true });
				// NO shift(): hard-deleting the oldest point every 0.22s dropped
				// ~40%-weight gaussians instantly — the rear field stepped at
				// 4.5Hz (the "back at 5fps"). Births were made continuous by the
				// handoff; deaths must be too: points only DECAY, never vanish.
			}
			const s2a = 2 * (letterH2 * (noisy === 15 ? 0.4 : noisy >= 11 ? 0.55 : 1.4)) ** 2;
			for (let h2 = a.hist.length - 1; h2 >= 0; h2--) {
				const hp = a.hist[h2];
				if (hp.hand && !a.dying) {
					const dxh = hp.x - a.x, dyh = hp.y - a.y;
					hp.w = Math.min(1, 1 - Math.exp(-(dxh * dxh + dyh * dyh) / s2a));
					if (hp.w >= 0.95) { hp.w = 1; hp.hand = false; }
				} else {
					hp.hand = false;
					hp.w -= dt * spd * (noisy >= 11 ? 0.3 : noisy === 10 ? 0.72 : 0.55); // faster decay keeps the list bounded (~8/agent); 7-1: trails let go ~30% faster
					if (hp.w <= 0.03) a.hist.splice(h2, 1);
				}
			}
		}
		// per-agent BLOB TEMPERATURE (Blob 6-2): cold at birth, warming over
		// ~8s, breathing slowly — so every letter an agent holds shifts hue
		// TOGETHER, and the per-letter clock becomes a subtle undertone.
		for (const a of agents) {
			a.age = (a.age || 0) + dt * spd;
			// 6-8 (noisy===2) opens mid-temperature: the warm-up ramp starts at 0.5
			a.heat = Math.min(1, (noisy >= 2 ? 0.5 : 0) + a.age * 0.12) * (0.6 + 0.4 * Math.sin(t * spd * 0.3 + a.ph));
		}
		// Blob 6-3: ONE GLOBAL heat — every blob and every held letter share the
		// same temperature (builds over ~8s from scene start, then breathes).
		const heat6 = Math.min(1, (noisy >= 2 ? 0.5 : 0) + t * spd * 0.12) * (0.6 + 0.4 * Math.sin(t * spd * 0.3 + 0.7));
		// letter swallow levels (same dynamics as before, colony-driven field).
		// perf6 (Blob 6-6): this whole section — the letters×agents influence
		// loop and the level dynamics — ticks at ~32Hz with accumulated dt.
		// Levels move over ~1s, so 32Hz is visually identical; the AGENTS (the
		// fast-moving goo that must be 60fps) keep full rate above.
		if (!letterList.length) return;
		// (perf6 keeps ONLY the distance culling below — throttling the letter
		// tick to 32Hz stuttered the melts even with GPU cross-fade smoothing;
		// full-rate dynamics + culling is smooth AND cheap)
		letterDtAcc += dt;
		const dtL = letterDtAcc;
		lastTickDt6 = Math.max(1e-3, dtL);
		letterDtAcc = 0;
		fieldDirty = true;
		const R5 = letterH2 * (1.35 + 0.4 * Math.sin(t * spd * 0.5 + 0.7)) * (noisy === 15 ? 0.55 : noisy >= 11 ? 0.7 : 1);
		if (noisy === 19) {
			// Blob 12-5 BRIDGING: an unheld letter flanked by two TOUCH-held
			// letters on roughly opposite sides (letter-gap-letter) gets
			// engulfed too — the goo reaches across the gap. Only naturally
			// held letters count as flankers, so bridges don't cascade.
			const rB19 = letterH2 * 2.7;
			for (const L of letterList) {
				L.bridge = false;
				if (L.onT) continue;
				let found19 = false;
				for (let i9 = 0; i9 < letterList.length && !found19; i9++) {
					const A9 = letterList[i9];
					if (!A9.onT) continue;
					const ax9 = A9.cx - L.cx, ay9 = A9.cy - L.cy;
					const da9 = Math.hypot(ax9, ay9);
					if (da9 > rB19 || da9 < 1) continue;
					for (let j9 = i9 + 1; j9 < letterList.length; j9++) {
						const B9 = letterList[j9];
						if (!B9.onT) continue;
						const bx9 = B9.cx - L.cx, by9 = B9.cy - L.cy;
						const db9 = Math.hypot(bx9, by9);
						if (db9 > rB19 || db9 < 1) continue;
						if ((ax9 * bx9 + ay9 * by9) / (da9 * db9) < -0.72) { found19 = true; break; }
					}
				}
				L.bridge = found19;
			}
		}
		const s2h = 2 * R5 * R5, s2t = 2 * (R5 * 0.85) * (R5 * 0.85);
		const cullD = R5 * 3.2; // beyond this, influence < 1% — skip the exps
		for (const Lt of letterList) {
			const wasOn = Lt.on;
			let fTouch = 0, bestA = null, bestC = 0;
			for (const a of agents) {
				const adx = Lt.cx - a.x, ady = Lt.cy - a.y;
				const cd = cullD + Lt.rad;
				if (adx * adx + ady * ady > cd * cd * 2.2) continue; // cheap reject (covers hist spread)
				const dc = Math.hypot(adx, ady);
				const dEdge = Math.max(0, dc - Lt.rad);
				const cHead = a.w * Math.exp(-(dEdge * dEdge) / s2h);
				fTouch += cHead;
				if (cHead > bestC) { bestC = cHead; bestA = a; }
				for (const h2 of a.hist) {
					const dh2 = Math.hypot(Lt.cx - h2.x, Lt.cy - h2.y);
					const dE2 = Math.max(0, dh2 - Lt.rad);
					const cH2 = 0.7 * a.w * h2.w * Math.exp(-(dE2 * dE2) / s2t);
					fTouch += cH2;
					if (cH2 > bestC) { bestC = cH2; bestA = a; }
				}
			}
			if (!Lt.on && fTouch > 0.3) Lt.on = true;
			else if (Lt.on && fTouch < (noisy === 14 ? 0.34 : 0.2)) Lt.on = false; // Blob 11: letters give up earlier (same fade speed, stricter trigger)
			if (noisy >= 10) {
				// 7-1 FULL-CYCLE SHED: a letter held long enough to cycle the
				// ENTIRE colour wheel (~14s) is forcibly released — the goo
				// shrinks off it and the departed-ground decay cools it to
				// gray. A ~6s refractory stops an instant re-grab; then the
				// lap counter resets and the letter can run the wheel again.
				if ((Lt.refr || 0) > 0) {
					Lt.refr -= dtL * spd;
					Lt.on = false;
					if (Lt.refr <= 0) Lt.lap = 0;
				} else if (Lt.on) {
					Lt.lap = (Lt.lap || 0) + (dtL * spd) / 14;
					if (Lt.lap >= 1) { Lt.refr = 6; Lt.on = false; }
				}
			}
			// Blob 6-3: a freshly-engulfed letter starts COLD and runs a 0.6s
			// eased sweep up to the shared global heat — through every colour
			// on the ramp on its way there.
			if ((b6 === 3 || b6 === 5) && !wasOn && Lt.on) Lt.ramp = 0;
			if (noisy === 19) {
				Lt.onT = Lt.on; // remember the TOUCH-driven state (flankers must be naturally held)
				if (!Lt.on && Lt.bridge && !(Lt.refr > 0)) Lt.on = true; // reach across the gap
			}
			if (noisy >= 18) {
				// Blob 12-4 recency: freshly-engulfed letters are BIG, settling
				// over ~6s to a still-puffy baseline (they never get small)
				if (!wasOn && Lt.on) Lt.rec = 1;
				else Lt.rec = Math.max(0, (Lt.rec || 0) - (dtL * spd) / 6);
			}
			const target5 = Lt.on ? 1 : 0;
			// 6-5 rises languidly (~1.3s): the tongue's coverage GROWS over the
			// letter instead of the whole selection popping in at gulp speed
			const rate5 = target5 > Lt.S ? (b6 === 5 ? 0.9 : 4) : 2.0;
			Lt.S += (target5 - Lt.S) * Math.min(1, dtL * spd * rate5);
			lvlBytes[Lt.i * 2] = Lt.S * 255;
			if (noisy >= 5) {
				// 6-10 dwell clock: ~9s of occupation to full radiance, draining
				// at a third of that pace on release — heat is EARNED by tenure
				if (Lt.on) Lt.dw = Math.min(1, (Lt.dw || 0) + (dtL * spd) / 9);
				// (6-12 releases dwell ~3x faster than it holds elsewhere: departing
				// letters should read as cooling, not as a lingering glow)
				else Lt.dw = Math.max(0, (Lt.dw || 0) - (dtL * spd) / (noisy >= 7 ? 8 : 27));
				if (noisy === 9) {
					// 7-0-prev PER-LETTER OVERHEAT CYCLE (latched): ~5s at max arms
					// a shed; shedding pushes dwell to a warm floor (~2.2s of
					// visible cooling, injection collapsed, field vented), then the
					// letter earns its way back up the 9s ramp. Full cycle ~12s.
					if (Lt.shd) {
						Lt.dw = Math.max(0.35, Lt.dw - dtL * spd * 0.3);
						Lt.oh = Math.max(0, (Lt.oh || 0) - (dtL * spd) / 4);
						if (Lt.dw <= 0.36) Lt.shd = false;
					} else if (Lt.on && Lt.dw > 0.85) {
						Lt.oh = Math.min(1, (Lt.oh || 0) + (dtL * spd) / 5);
						if (Lt.oh >= 1) Lt.shd = true;
					} else Lt.oh = Math.max(0, (Lt.oh || 0) - (dtL * spd) / 6);
				}
			}
			if (b6 === 3) {
				// 0.6s smoothstepped run-up from cold to the GLOBAL heat; once
				// arrived, the letter simply tracks the shared temperature
				// (melting letters keep tracking it too — no colour divergence)
				Lt.ramp = Math.min(1, (Lt.ramp ?? 1) + (dtL * spd) / 0.6);
				const e6 = Lt.ramp * Lt.ramp * (3 - 2 * Lt.ramp);
				Lt.H = heat6 * e6;
				lvlBytes[Lt.i * 2 + 1] = Lt.H * 255;
			} else if (b6 === 5) {
				// the raw sweep progress ships to the shader; it drives BOTH the
				// gloopy field-sculpted arrival mask and the colour ignition.
				// ~1.5s so the flow-over is a slow, luxurious crawl.
				Lt.ramp = Math.min(1, (Lt.ramp ?? 1) + (dtL * spd) / 1.5);
				lvlBytes[Lt.i * 2 + 1] = Lt.ramp * 255;
			} else if (b6 === 2) {
				// heat = 78% the owning AGENT's shared temperature (the whole
				// blob shifts together) + 22% per-letter hold time (a subtle
				// undertone, no longer a legible per-letter clock); low-passed
				// so ownership changes never jump the hue
				if (Lt.on) Lt.hold = Math.min(1, (Lt.hold || 0) + dtL * spd * 0.22);
				else Lt.hold = Math.max(0, (Lt.hold || 0) - dtL * spd * 0.6);
				const tH = clamp((bestA ? bestA.heat : 0) * 0.78 + Lt.hold * 0.22, 0, 1);
				Lt.H = (Lt.H || 0) + (tH - (Lt.H || 0)) * Math.min(1, dtL * spd * 2);
				lvlBytes[Lt.i * 2 + 1] = Lt.H * 255;
			} else {
				lvlBytes[Lt.i * 2 + 1] = 255;
			}
		}
	}

	// ── Blob 4: the single-mass creature ─────────────────────────────────────
	// New nodes appear at the leading edge (heading drifts, position snaps
	// toward nearby letters); old nodes dissolve from the tail. Each node's
	// weight EASES toward its target, so adds/removes are feathered — the mass
	// visibly flows. A slow breath oscillates the target size, so the whole
	// organism expands over the letters and contracts back.
	function spawnNode() {
		if (!txCells.length) return;
		// New nodes are born UNDER the head (tiny jitter) and ramp in — the
		// chain grows without any positional pop; all travel comes from the
		// continuous glide in stepMass.
		let bx, by;
		const frontier = nodes.length ? nodes[nodes.length - 1] : null;
		if (frontier) {
			bx = frontier.x + (rng() - 0.5) * frontier.r * 0.3;
			by = frontier.y + (rng() - 0.5) * frontier.r * 0.3;
		} else {
			const c = txCells[(rng() * txCells.length) | 0];
			bx = c[0]; by = c[1];
		}
		nodes.push({ x: bx, y: by, r: letterH2 * (0.55 + rng() * 0.5), w: 0, tw: 1 });
	}
	function stepMass(dt, o) {
		const spd = simSpd(o);
		// GOAL-SEEKING: pick a random letter elsewhere in the composition and
		// trek toward it (new goal when reached or timed out) — cures the
		// creature's habit of homesteading one corner.
		goalT -= dt * spd;
		const head = nodes.length ? nodes[nodes.length - 1] : null;
		// hand off to a NEW goal early (2.2 letter-heights out): steering toward
		// a nearly-reached point makes the bearing swing wildly — the head used
		// to fidget right before every arrival
		if (txCells.length && (goalT <= 0 || !goal || (head && Math.hypot(goal[0] - head.x, goal[1] - head.y) < letterH2 * 2.2))) {
			// COMMIT TO LONG TREKS: destinations must be far away (≥6 letter
			// heights / ~a third of the canvas), roughly ahead, and are held for
			// a long time — the creature crosses the composition in single
			// unbroken journeys instead of renegotiating every few seconds.
			const minTrek = Math.max(letterH2 * 9, Math.min(W, H) * 0.45);
			let bestG = null, bestS = -1e9, anyG = null, anyS = -1e9;
			for (let k3 = 0; k3 < 24; k3++) {
				const c = txCells[(rng() * txCells.length) | 0];
				if (!head) { bestG = c; break; }
				const dx3 = c[0] - head.x, dy3 = c[1] - head.y;
				const d4 = Math.hypot(dx3, dy3);
				const ali = Math.cos(Math.atan2(dy3, dx3) - heading);
				const s5 = (1.2 + ali) * (0.3 + Math.min(2, d4 / (W * 0.3)));
				if (s5 > anyS) { anyS = s5; anyG = c; } // fallback for tiny layouts
				if (d4 < minTrek) continue;
				if (s5 > bestS) { bestS = s5; bestG = c; }
			}
			if (!bestG) bestG = anyG;
			if (bestG) { goal = bestG; goalT = 9 + rng() * 5; }
		}
		// occasional SPLIT: the rear half becomes an ORPHAN lobe that fades in
		// place (a deliberate one-off event) while the tail point jumps forward
		// so the continuous window doesn't double-own that stretch
		splitT -= dt * spd;
		if (splitT <= 0) {
			splitT = 8 + rng() * 7;
			const trail = nodes.filter((nd) => nd !== headN && !nd.orphan);
			if (trail.length >= 9) {
				const cut = trail[Math.floor(trail.length * 0.5)];
				for (const nd of trail) if (nd.s <= cut.s) nd.orphan = true;
				tailDist = Math.max(tailDist, cut.s + 0.01);
			}
		}
		// breath: target BODY LENGTH (arclength) swings → extends / contracts
		const targetN = 6.5 + 3.5 * Math.sin(t * spd * 0.5 + 1.0);
		// CONTINUOUS GLIDE — the snake. The head moves EVERY FRAME: steering
		// eases toward the goal bearing, wander comes from smooth sinusoids
		// (no random kicks), and a soft pull keeps it near the strokes. Every
		// body node eases after the one ahead of it. Motion never stops.
		const head2 = headN;
		if (head2) {
			// NAVIGATE ALONG THE TEXT: steer toward waypoint cells that are
			// ahead, near, and toward the goal — so the creature swims THROUGH
			// the words to its destination. Beelining across empty background
			// made the visible mask die at the origin and materialize at the far
			// end (the goo only exists on letters) — the "teleport".
			let best = null, bd = 1e18;
			const hx2 = Math.cos(heading), hy2 = Math.sin(heading);
			for (let k2 = 0; k2 < 32; k2++) {
				const c = txCells[(rng() * txCells.length) | 0];
				const dx4 = c[0] - head2.x, dy4 = c[1] - head2.y;
				const d5 = Math.hypot(dx4, dy4);
				if (d5 < 1) continue;
				const fwd = (dx4 * hx2 + dy4 * hy2) / d5; // alignment with heading
				if (fwd < 0.1) continue;                   // only waypoints ahead
				const gd = goal ? Math.hypot(goal[0] - c[0], goal[1] - c[1]) : 0;
				const score = d5 * (1.6 - fwd) + gd * 0.5; // near + ahead + goalward
				if (score < bd) { bd = score; best = c; }
			}
			if (best) {
				const lp = Math.min(1, dt * 1.2); // calm anchor — no cell-to-cell tugging
				anchorX += (best[0] - anchorX) * lp;
				anchorY += (best[1] - anchorY) * lp;
			}
			// text waypoints carry HALF the steering — the path hugs the words,
			// the goal supplies the overall direction
			const tgx = (goal ? goal[0] : anchorX) * 0.5 + anchorX * 0.5;
			const tgy = (goal ? goal[1] : anchorY) * 0.5 + anchorY * 0.5;
			const want = Math.atan2(tgy - head2.y, tgx - head2.x);
			const dh = ((want - heading + Math.PI * 3) % TAU) - Math.PI;
			const wander = Math.sin(t * spd * 0.9 + 2.1) * 0.55 + Math.sin(t * spd * 0.53 + 0.4) * 0.3;
			// BOUNDED turn rate: corrections carve wide arcs at full speed —
			// never a pivot-in-place, which read as hesitation
			heading += clamp(dh * 1.4 + wander, -1.7, 1.7) * dt * spd;
			const v = letterH2 * 1.7 * spd * (1 + 0.12 * Math.sin(t * spd * 0.7 + 1.7)); // 2× cruise speed
			head2.x += Math.cos(heading) * v * dt;
			head2.y += Math.sin(heading) * v * dt;
			// TRAIL DROPPING: the body is the head's wake. A new segment is laid
			// every ~one head-radius of travel, born UNDERNEATH the head disc at
			// 55% weight — its ramp-in is hidden by the head, so the visible
			// front is pure constant-velocity translation, never a weight swell.
			headDist += v * dt;
			dropD += v * dt;
			if (dropD >= head2.r * 0.55) {
				dropD = 0;
				// Born at ZERO weight, matured by the HANDOFF below (front stays
				// continuous); retired later by the tail WINDOW (rear stays
				// continuous). No per-node timers anywhere.
				const tn = { x: head2.x, y: head2.y, r: head2.r * (0.88 + rng() * 0.1), s: headDist, w: 0, wh: 0, hand: true };
				nodes.splice(nodes.length - 1, 0, tn); // head stays last
			}
			// CONTINUOUS TAIL: a tail point glides along the path, chasing the
			// breath's target body length — the mirror of the front handoff.
			// Rear retreat speed is a smooth controller output, never a cadence.
			const targetLen = targetN * head2.r * 0.55 + head2.r;
			const bodyLen = headDist - tailDist;
			const vTail = clamp((bodyLen - targetLen) * 1.8, 0, v * 3);
			tailDist += vTail * dt;
		}
		// CONTINUOUS HANDOFF: each maturing trail segment's weight equals
		// exactly what the head's gaussian has STOPPED contributing at its
		// position — head + segment always sum to a constant field. The trail
		// solidifies as a smooth function of head DISTANCE (60fps continuous),
		// not on any drop cadence.
		if (headN) {
			const s2h = 2 * headN.r * headN.r;
			for (let i2 = nodes.length - 2; i2 >= 0; i2--) {
				const nd = nodes[i2];
				if (!nd.hand) break; // only the still-maturing newest segments
				const ddx = nd.x - headN.x, ddy = nd.y - headN.y;
				nd.wh = Math.min(1, 1 - Math.exp(-(ddx * ddx + ddy * ddy) / s2h));
				if (nd.wh >= 0.99) { nd.wh = 1; nd.hand = false; }
			}
		}
		// Final weights: front handoff × tail window, both smooth scalars.
		// Orphan lobes (splits) fade exponentially in place — one-off events.
		const fadeLen = headN ? headN.r * 1.6 : 60;
		for (let i2 = nodes.length - 1; i2 >= 0; i2--) {
			const nd = nodes[i2];
			if (nd === headN) continue;
			if (nd.orphan) {
				nd.w += (0 - nd.w) * Math.min(1, dt * spd * 2.2);
				if (nd.w < 0.02) nodes.splice(i2, 1);
				continue;
			}
			const wT = clamp((nd.s - tailDist) / fadeLen, 0, 1);
			nd.w = (nd.wh ?? 1) * wT * wT * (3 - 2 * wT);
			if (wT <= 0) nodes.splice(i2, 1);
		}
	}
	function step(dt) {
		t += dt;
		if (mass) {
			if (letterQ) stepAgents(dt, getOpts()); // Blob 5: the colony
			else stepMass(dt, getOpts());           // Blob 4: the single mass
			return;
		}
		if (!cellular || !alive) return;
		const spd = simSpd(getOpts()); // avg decisions/sec per cell
		let count = 0;
		for (let i = 0; i < alive.length; i++) if (alive[i]) count++;
		if (!count && !swallows.length) {
			// extinction → a new spore lands on a random letter (and eats it)
			const vs = [];
			for (let i = 0; i < valid.length; i++) if (valid[i]) vs.push(i);
			if (vs.length) claimAndSwallow(vs[(rng() * vs.length) | 0]);
		}
		// committed swallows advance on a steady cadence, regardless of dice
		for (let s3 = swallows.length - 1; s3 >= 0; s3--) {
			const sw = swallows[s3];
			sw.timer -= dt * spd;
			while (sw.timer <= 0 && sw.cells.length) {
				const j = sw.cells.shift();
				if (!alive[j]) { alive[j] = 1; ageT[j] = 0; }
				sw.timer += 0.2;
			}
			if (!sw.cells.length) swallows.splice(s3, 1);
		}
		const press = clamp((count - capC) / (capC * 0.3), 0, 1);
		// POISSON decisions: each cell rolls independently every frame — a turn
		// every ~HALF second per cell (at Reaction speed 1), so with a ~10-cell
		// creature something visibly changes several times a second: constant
		// motion, no perceptible pauses.
		const p = Math.min(0.5, dt * spd * 2);
		const snap = alive.slice();
		for (let i = 0; i < snap.length; i++) {
			if (snap[i] && rng() < p) decide(i, press, snap);
		}
		// quicker ramps so births/deaths read as continuous flowing motion
		const up = (dt * spd) / 0.7, down = (dt * spd) / 1.1;
		const turns = dt * spd * 2; // age advances in half-second turns
		for (let i = 0; i < level.length; i++) {
			if (alive[i]) {
				ageT[i] += turns;
				if ((level[i] += up) > 1) level[i] = 1;
			} else if ((level[i] -= down) < 0) level[i] = 0;
		}
	}
	function render(ctx) {
		const o = getOpts();
		const phase = (((t / (o.duration || 4)) % 1) + 1) % 1;
		paintBg(ctx, o, W, H);
		// Cached wall: re-measuring + re-drawing every glyph per frame at 60fps
		// caused periodic frame spikes (measureText + GC) — invisible during
		// slow fades, but every long frame reads as a JERK on a moving front.
		if (!wallCv || wallFg !== o.fg) {
			if (!wallCv) { wallCv = document.createElement('canvas'); wallCv.width = W; wallCv.height = H; }
			const wc = wallCv.getContext('2d');
			wc.clearRect(0, 0, W, H);
			wc.fillStyle = o.fg;
			drawWall(wc, o, WGT);
			wallFg = o.fg;
		}
		ctx.drawImage(wallCv, 0, 0);
		if (!hasText || !prog || gl.isContextLost()) return;
		// Re-establish OUR state on the shared context every frame — another
		// scene (preview vs export, or a prior mode) may have changed it.
		if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; }
		gl.useProgram(prog);
		gl.disable(gl.BLEND);
		gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
		gl.enableVertexAttribArray(aPLoc);
		gl.vertexAttribPointer(aPLoc, 2, gl.FLOAT, false, 0, 0);
		gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, nTex);
		gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bTex);
		if (letterQ && lvlTex) {
			gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, lidTex);
			gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, lvlTex);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, nLetters, 1, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, lvlBytes);
		}
		const amount = clamp(o.cmAmount ?? 0.5, 0.05, 0.9);
		if (cellular) {
			// The rules decide WHERE the mass is; the breathing makes it ALWAYS
			// move. Each cell's influence undulates ±28% on its own smooth sine,
			// so the goo contour drifts continuously even when no cell is being
			// born or dying — the "constant even movement" quality of the noise
			// variant, on top of rule-based structure.
			const spd2 = simSpd(o);
			for (let i = 0; i < level.length; i++) {
				// THREE incommensurate harmonics (golden-ratio spaced): a single
				// sine dwells at its extremes (breathe…stop…breathe); the layered
				// sum never has all components stationary at once, so the
				// breathing wanders continuously without robotic pauses.
				const a = t * spd2 * rateB[i] + phB[i];
				const br = 0.72
					+ 0.13 * Math.sin(a)
					+ 0.09 * Math.sin(a * 1.618 + phB[i] * 1.7)
					+ 0.06 * Math.sin(a * 2.414 + phB[i] * 2.9);
				mBytes[i] = level[i] * br * 255;
			}
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, massTex);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, gw2, gh2, 0, gl.ALPHA, gl.UNSIGNED_BYTE, mBytes);
		} else {
			const pods = podsBuf;
			pods.fill(0);
			if (letterQ && b6 === 5) {
				// Blob 6-5: ship the COLONY as round bodies, and FUSE all
				// magnetized letters into one blurred low-res field (uM) —
				// stamped fresh every frame from the letter levels.
				let slot = 0;
				// Blob 8: SMALL masses — head ~1.5 letter-cells wide (scales with
				// the letter size), trail pods thinner still so each mass draws a
				// fading LINE across the text instead of pooling into one body
				const sig5 = letterH2 * (noisy === 15 ? 0.4 : noisy >= 11 ? 0.55 : 1.4); // Blob 12: ~1x1-cell mask
				for (const a of (noisy >= 18 ? [] : agents)) { // Blob 12-4: the walker is INVISIBLE - no pods; only its letter choices render
					if (slot >= 96) break;
					pods[slot * 4] = a.x; pods[slot * 4 + 1] = a.y;
					pods[slot * 4 + 2] = a.w; pods[slot * 4 + 3] = sig5;
					slot++;
					for (const h2 of a.hist) {
						if (slot >= 96) break;
						pods[slot * 4] = h2.x; pods[slot * 4 + 1] = h2.y;
						pods[slot * 4 + 2] = 0.7 * a.w * h2.w; pods[slot * 4 + 3] = sig5 * (noisy >= 11 ? 0.62 : 0.85);
						slot++;
					}
				}
				if (accum6 && fieldDirty) {
					// stamp + blur + upload only when the letter tick ran (perf6:
					// ~32Hz) — the fused field changes at level speed, not frame
					// speed, and this was most of the per-frame CPU cost
					fieldDirty = false;
					// rotate: last tick's field becomes the cross-fade source
					const swap6 = massTexPrev; massTexPrev = massTex; massTex = swap6;
					accum6.fill(0);
					accumC6.fill(0);
					if (noisy >= 5) accumD6.fill(0);
					if (noisy >= 4) {
						// MASS CONCENTRATION (6-9): every held letter measures the
						// gaussian-weighted density of held letters around it, so
						// ANY dense cluster — 2x2, 3x3, 5x2, ragged slabs — boosts
						// material in proportion. The fused blur fills the gaps and
						// the conduction model turns that material into heat, so
						// warmth emanates from wherever the mass is concentrated.
						for (const Lt of letterList) Lt.q9t = 0;
						const hot9 = letterList.filter((L9) => L9.S > 0.35);
						for (const L9 of hot9) {
							let dens9 = 0;
							for (const O9 of hot9) {
								if (O9 === L9) continue;
								const dx9 = O9.cx - L9.cx, dy9 = O9.cy - L9.cy;
								const rr9 = Math.max(L9.rad, O9.rad) * 2.1; // ~one letter pitch
								dens9 += O9.S * Math.exp(-(dx9 * dx9 + dy9 * dy9) / (2 * rr9 * rr9));
							}
							// a 2x2 member sees ~2-3 weighted neighbours (mid boost);
							// a 3x3 core ~5-6 (saturated); lone letters ~0 (none)
							L9.q9t = Math.min(1, dens9 / 4.5);
						}
						const kq9 = Math.min(1, lastTickDt6 * 1.4);
						for (const Lt of letterList) Lt.q9 = (Lt.q9 || 0) + ((Lt.q9t || 0) - (Lt.q9 || 0)) * kq9;
					}
					for (const Lt of letterList) {
						if (Lt.S <= 0.006) continue;
						const sp = sprites6[Lt.i];
						if (!sp) continue;
						// MATURITY weight (S²): openness = 1 - maturity/field drives
						// the letterform scaffold + cooling in BOTH directions —
						// arriving letters build up from their strokes and seal;
						// departing ones re-open and drain. One formula, symmetric.
						const mw6 = Lt.S * Lt.S;
				const g18 = noisy >= 18 ? 1.18 + 0.32 * (Lt.rec || 0) : 1;
						for (let yy = 0; yy < sp.h; yy++) {
							const gy = sp.gy + yy;
							if (gy < 0 || gy >= gh6) continue;
							for (let xx = 0; xx < sp.w; xx++) {
								const gx = sp.gx + xx;
								if (gx < 0 || gx >= gw6) continue;
								const v6 = sp.d[yy * sp.w + xx];
								const bq9 = noisy >= 4 && Lt.q9 ? 1 + 0.65 * Lt.q9 : 1;
								accum6[gy * gw6 + gx] += Lt.S * v6 * bq9 * g18;
								accumC6[gy * gw6 + gx] += mw6 * v6 * bq9 * g18;
								if (noisy >= 5) accumD6[gy * gw6 + gx] += Lt.S * (Lt.dw || 0) * v6 * bq9 * (noisy === 9 ? 1 - 0.7 * (Lt.oh || 0) : 1);
								// 7-0-prev shed VENT: drain the field under a shedding letter
								if (noisy === 9 && Lt.shd) heatF6[gy * gw6 + gx] *= 1 - Math.min(0.5, 1.5 * lastTickDt6) * v6;
							}
						}
					}
					// two 3x3 blur passes: the stamps FUSE into one smooth field
					// st6: tap stride in cells — a dilated (a-trous) pass spreads
					// st6^2 times the variance of a plain 3x3 at identical cost
					const bl6 = (src, dst, st6 = 1) => {
						for (let y = 0; y < gh6; y++) for (let x = 0; x < gw6; x++) {
							let s6 = 0, c6 = 0;
							for (let dy6 = -1; dy6 <= 1; dy6++) {
								const yy = y + dy6 * st6;
								if (yy < 0 || yy >= gh6) continue;
								for (let dx6 = -1; dx6 <= 1; dx6++) {
									const xx = x + dx6 * st6;
									if (xx < 0 || xx >= gw6) continue;
									s6 += src[yy * gw6 + xx]; c6++;
								}
							}
							dst[y * gw6 + x] = s6 / c6;
						}
					};
					bl6(accum6, tmp6);
					bl6(tmp6, accum6);
					bl6(accumC6, tmpC6);
					bl6(tmpC6, accumC6);
					if (noisy === 14 || noisy >= 16) {
						// Blob 11/12-2: active letters throw a WIDER field — a stride-2
						// then stride-1 pass on top roughly doubles the spread, so
						// neighbouring active letters fuse into one blobby mass
						bl6(accum6, tmp6, 2); bl6(tmp6, accum6);
						bl6(accumC6, tmpC6, 2); bl6(tmpC6, accumC6);
					}
					if (noisy >= 5) { bl6(accumD6, tmpD6); bl6(tmpD6, accumD6); }
					if (noisy >= 6) {
						// PERSISTENT HEAT (6-11): dwelled letters INJECT heat; per-
						// tick blurs DIFFUSE it — repeated blurs are a growing
						// gaussian, so the footprint expands without bound; a slow
						// decay cools. Camp long enough and the heat floods the
						// entire blob. There is NO hard limit on the hot area.
						// 6-12 (noisy 7): injection up, THREE diffusion passes at a
						// faster blend (~7x the spread rate), decay down — heat
						// escapes the glyph bounds almost immediately and keeps
						// travelling outward.
						const dtH = Math.max(1e-3, lastTickDt6);
						const inj12 = noisy >= 14 ? 0.85 : noisy >= 10 ? 1.45 : noisy >= 7 ? 1.0 : 0.55; // Blob 11: slower heating too - colours drift, not race // 7-1: hotter - the full-cycle shed self-limits, so the wheel can spin faster // 6-12: was 3.0 - tuned blind against a dead shader arm; now that the arm is live, 3.0 saturated the field almost instantly
						if (noisy >= 7) {
							// WIDE SOURCE SKIRT: inject from a dilated copy of the
							// dwell stamps too, so the hot plateau is BORN wider
							// than the glyphs — hot bands start their march from
							// out there instead of from the stroke edge
							bl6(accumD6, tmpD6, 4);
							// BODY WARMTH: the goo itself is a weak heat source wherever
							// it has mass (accum6); letters/dwell are just the strongest
							// source. A per-cell source is what GUARANTEES every part of
							// the blob rises past the lowest band during its residence —
							// no distance-defeating diffusion from the glyphs required.
							// At typical body mass (~0.5) net gain is ~0.02/s after
							// losses: the band ladder sweeps any patch of goo that sits
							// still for ~15-25s.
							for (let i = 0; i < heatF6.length; i++) heatF6[i] = Math.min((noisy === 8 || noisy >= 10) ? 40 : 1.15, heatF6[i] + ((accumD6[i] * 0.6 + tmpD6[i] * 0.55) * inj12 + accum6[i] * 0.025) * dtH); // 7-0: effectively uncapped - the wheel phase just keeps integrating
						} else {
							for (let i = 0; i < heatF6.length; i++) heatF6[i] = Math.min(1.15, heatF6[i] + accumD6[i] * dtH * inj12);
						}
						// 6-12: a-trous stride ladder — verified in 1-D simulation:
						// [2,5,9] at this blend rate marches the HOT iso-lines
						// (the visible bands) ~2.5x faster than [1,3,6] did; the
						// faint envelope was never the problem
						const str12 = noisy >= 7 ? [2, 5, 9] : [1];
						const kD = Math.min(1, dtH * (noisy >= 7 ? 16 : 5));
						// 6-12: losses LOWERED (0.02 -> 0.015 each) — 2-D sim: this is
						// the knob that makes bands march instead of stall. With slow
						// losses the whole field keeps fattening under injection, so
						// the pink radius ~doubles over a minute and the hot band
						// eventually floods the entire blob. The low tail this feeds
						// is bounded by the shader floor gate, not by evaporation.
						const dec = 1 - dtH * (noisy >= 7 ? 0.015 : 0.025);
						for (const s12 of str12) {
							bl6(heatF6, tmpH6, s12);
							for (let i = 0; i < heatF6.length; i++) heatF6[i] += (tmpH6[i] - heatF6[i]) * kD;
						}
						if (noisy >= 7) {
							// ADVECTION — the unshackling: heat is CARRIED by a slow
							// divergence-free swirl (loop-phased sines). Letters stay
							// the SOURCE of heat, but the isotherm GEOMETRY belongs
							// to the flow — plumes and eddies, not glyph echoes.
							const f1 = (Math.PI * 2) / Math.max(8, (letterH2 * 2.5) / gs6);
							const f2 = f1 * 1.7;
							const vA = (letterH2 / gs6) * 0.55 * dtH;
							for (let y = 0; y < gh6; y++) for (let x = 0; x < gw6; x++) {
								const vx = Math.sin(y * f1 + t * 0.7 + 1.3) + 0.6 * Math.sin((x + y) * f2 - t * 0.43);
								const vy = Math.cos(x * f1 - t * 0.61) + 0.6 * Math.cos((x - y) * f2 + t * 0.5);
								let sx = x - vx * vA, sy = y - vy * vA;
								sx = sx < 0 ? 0 : sx > gw6 - 1.001 ? gw6 - 1.001 : sx;
								sy = sy < 0 ? 0 : sy > gh6 - 1.001 ? gh6 - 1.001 : sy;
								const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
								const i00 = y0 * gw6 + x0;
								tmpH6[y * gw6 + x] = heatF6[i00] * (1 - fx) * (1 - fy) + heatF6[i00 + 1] * fx * (1 - fy)
									+ heatF6[i00 + gw6] * (1 - fx) * fy + heatF6[i00 + gw6 + 1] * fx * fy;
							}
							const sw12 = heatF6; heatF6 = tmpH6; tmpH6 = sw12;
						}
						let mx12 = 0;
						// EVAPORATION (6-12): a small linear subtraction — unlike
						// multiplicative decay it has a FLOOR, so the faint far tail
						// dies instead of creeping outward unchecked forever
						const evap12 = (noisy === 8 || noisy >= 10) ? dtH * 0.03 : noisy >= 7 ? dtH * 0.015 : 0;
						// 6-12: heat over ABANDONED ground (no current goo mass under it)
						// decays ~5x faster — a departed site cools through the bands in
						// ~10-15s instead of glowing for a minute after the colony leaves.
						// 7-0 (wheel): occupied goo now decays GENTLY too — under full
						// injection the phase settles ~a dozen laps instead of winding
						// up forever, and any pause lets it drift back toward neutral;
						// departed ground cools HARD, back to gray within ~10s.
						const decGone = 1 - dtH * 0.08;
						const dec8mass = 1 - dtH * 0.015;
						const dec8gone = 1 - dtH * 0.10;
						for (let i = 0; i < heatF6.length; i++) {
							let h12 = heatF6[i] * ((noisy === 8 || noisy >= 10) ? (accum6[i] < 0.02 ? dec8gone : dec8mass) : (noisy >= 7 && accum6[i] < 0.02 ? decGone : dec));
							h12 -= evap12; if (h12 < 0) h12 = 0;
							heatF6[i] = h12;
							if (h12 > mx12) mx12 = h12;
						}
						maxH6 = mx12;
					}
					for (let i = 0; i < accum6.length; i++) {
						if (noisy >= 5) {
							mBytes6[i * 4] = Math.min(255, accumC6[i] * 320);     // maturity
							mBytes6[i * 4 + 1] = Math.min(255, accumD6[i] * 320); // dwell
							if (noisy >= 6) mBytes6[i * 4 + 2] = noisy >= 7
								// 6-12 SATURATED display: denominator CAPS at 0.35 instead of
								// tracking the peak. Auto-gain defined the top band as "cells
								// within a hair of the max" — and a diffusion field's max sits
								// AT the letter sources, so the hottest band was letter-shaped
								// by construction, untunable. With a fixed absolute bar, every
								// cell past 0.35 renders the top band: the plateau is the
								// GROWING region that has cleared the bar (2-D sim: 45px ->
								// 267px over a minute from a 24px source), not the crest.
								// Below-0.35 maxima still normalize relatively, so young sites
								// show their full band ladder from the first seconds.
								// ...UPDATE: the "relative while young" denominator made the
								// very FIRST injected heat render top-band at its core —
								// instant pastel. Scale is now strictly ABSOLUTE (bar 0.35):
								// heat renders low bands first and earns its way up as the
								// field genuinely accumulates, like 6-7's gradual climb.
								? ((noisy === 8 || noisy >= 10)
									// 7-0 WHEEL: byte = phase around the colour circle, one
									// lap per 2.5 heat units. 7-1/8/9: UNWRAPPED over a 2-lap
									// window (fract happens in the shader) - per-texel wrap
									// put byte 255 beside byte 0 at every hot-gray/cold-gray
									// boundary, and bilinear filtering swept the middle of
									// the wheel: the 2px red filament in the gray seam
									? (noisy >= 10 ? Math.min(255, (heatF6[i] / 5.0) * 255) : ((heatF6[i] / 2.5) % 1) * 255)
									: Math.min(255, (heatF6[i] / 0.35) * Math.min(1, maxH6 / 0.22) * 235))
								: Math.min(255, heatF6[i] * 220); // heat
							mBytes6[i * 4 + 3] = Math.min(255, accum6[i] * 320);  // field
						} else {
							mBytes6[i * 2] = Math.min(255, accumC6[i] * 320);     // maturity-weighted field
							mBytes6[i * 2 + 1] = Math.min(255, accum6[i] * 320); // field
						}
					}
					const fmt6 = noisy >= 5 ? gl.RGBA : gl.LUMINANCE_ALPHA;
					gl.activeTexture(gl.TEXTURE2);
					gl.bindTexture(gl.TEXTURE_2D, massTex);
					gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
					gl.texImage2D(gl.TEXTURE_2D, 0, fmt6, gw6, gh6, 0, fmt6, gl.UNSIGNED_BYTE, mBytes6);
					if (firstTick6) {
						// seed the cross-fade source so frame 0 doesn't blend
						// against an empty field
						firstTick6 = false;
						gl.bindTexture(gl.TEXTURE_2D, massTexPrev);
						gl.texImage2D(gl.TEXTURE_2D, 0, fmt6, gw6, gh6, 0, fmt6, gl.UNSIGNED_BYTE, mBytes6);
					}
				}
				// bind the pair + sub-tick blend EVERY frame (the cross-fade is
				// what turns the 32Hz field into 60fps-continuous melts)
				gl.activeTexture(gl.TEXTURE2);
				gl.bindTexture(gl.TEXTURE_2D, massTex);
				gl.activeTexture(gl.TEXTURE6);
				gl.bindTexture(gl.TEXTURE_2D, massTexPrev);
				if (uni.mmix) gl.uniform1f(uni.mmix, 1); // full-rate stamping — no cross-fade needed
			} else if (mass) {
				// Blob 4: newest-first so the HEAD always gets a slot even when
				// the trail overflows the 32-pod budget (overflow = oldest, dim)
				let slot = 0;
				for (let i = nodes.length - 1; i >= 0 && slot < 96; i--, slot++) {
					const nd = nodes[i];
					pods[slot * 4] = nd.x; pods[slot * 4 + 1] = nd.y;
					pods[slot * 4 + 2] = 0.9 * nd.w;
					pods[slot * 4 + 3] = nd.r;
				}
			} else {
				// pod variant: Blob 2's loop-seamless envelope schedule w/ plateau
				const k = Math.max(1, Math.round(o.reactionSpeed || 1));
				for (let i = 0; i < clusters.length && i < 8; i++) {
					const q = clusters[i];
					const env2 = Math.min(1, Math.pow(0.5 + 0.5 * Math.sin(TAU * (k * phase + q.off)), 1.6) * 1.35);
					pods[i * 4] = q.x0; pods[i * 4 + 1] = q.y0;
					pods[i * 4 + 2] = 0.85 * env2;
					pods[i * 4 + 3] = podR * (0.3 + 0.7 * env2);
				}
			}
			gl.uniform4fv(uni.pods, pods);
		}
		gl.uniform1f(uni.gate, clamp(o.cmGate ?? 0.12, 0, 0.2));
		gl.uniform1f(uni.satK, lerp(1.6, 4, amount));
		gl.uniform1f(uni.ph, TAU * phase);
		if (uni.gph) gl.uniform1f(uni.gph, (t / (o.duration || 4)) * 0.5); // half a wheel-lap per loop duration, never wrapping
		gl.uniform1f(uni.lump, lumpF);
		if (uni.heat) {
			const sh6 = simSpd(o);
			gl.uniform1f(uni.heat, Math.min(1, (noisy >= 2 ? 0.5 : 0) + t * sh6 * 0.12) * (0.6 + 0.4 * Math.sin(t * sh6 * 0.3 + 0.7)));
			if (uni.com9) gl.uniform2f(uni.com9, com9x < -1e8 ? -99999 : com9x, com9y);
		}
		gl.viewport(0, 0, W, H);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		ctx.drawImage(glCanvas, 0, 0);
	}
	return { reset, step, render };
}
const sceneBlob3C = (env) => blob3Scene(env, true);
const sceneBlob3N = (env) => blob3Scene(env, false);
const sceneBlob3CF = (env) => blob3Scene(env, true, 2); // 2× expand/contract tempo
const sceneBlob4 = (env) => blob3Scene(env, false, 1, true); // single-mass creature

// Blob 5 — Blob 4 with WHOLE-LETTER swallowing: same creature, same goo,
// same continuous release, but arrival is quantized to entire glyphs (see
// the letterQ machinery inside blob3Scene).
const sceneBlob5 = (env) => blob3Scene(env, false, 1, true, true);
// Blob 6-1 — Blob 5 with SOLID engulfment (counters filled — a swallowed 'e'
// is one solid slab), a wider chunkier coat, and the six-stop temperature
// ramp (gray → blue → green → yellow → red → pink).
const sceneBlob6 = (env) => blob3Scene(env, false, 1, true, true, 1);
// Blob 6-2 — Blob 6-1 plus HEAT OVER TIME: letters arrive cold (gray/blue)
// and warm through the ramp the longer they're held, cooling on release.
const sceneBlob62 = (env) => blob3Scene(env, false, 1, true, true, 2);
// Blob 6-3 — Blob 6-2 plus heat-driven TERRITORY: hot blobs flood outward
// past the letters, pooling across gaps to the field's outer boundary.
const sceneBlob63 = (env) => blob3Scene(env, false, 1, true, true, 3);
// Blob 6-4 — Blob 4's continuous mass movement (partial letters) wearing
// Blob 6-3's colour system (six-stop ramp + global heat shift).
const sceneBlob64 = (env) => blob3Scene(env, false, 1, true, false, 4);
// Blob 6-5 — Blob 6-3 with GLOOPY arrivals: the colony's invisible field
// sculpts each activation, so the goo visibly flows over new letters from
// the approach side instead of the whole glyph rising at once.
const sceneBlob65 = (env) => blob3Scene(env, false, 1, true, true, 5);
// Blob 6-6 — Blob 6-5 with the CPU throttled: letter machinery + field
// stamping tick at ~32Hz (levels move over ~1s — visually identical) while
// the agents and rendering keep full display rate. Same visuals, no lag.
const sceneBlob66 = (env) => blob3Scene(env, false, 1, true, true, 5, true);
// Blob 6-7: 6-6 + Blob 5's noise (patchy spread, gloop lumps, marbled hue)
const sceneBlob67 = (env) => blob3Scene(env, false, 1, true, true, 5, true, true);
// Blob 6-8: 6-7 + the outer contour departs from the letterforms by ~60%
const sceneBlob68 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 2);
// Blob 6-8-prev: 6-8 with the PRE-handback departure (melts on the rounded
// field — no counter re-opening ritual). Kept for posterity.
const sceneBlob68P = (env) => blob3Scene(env, false, 1, true, true, 5, true, 3);
// Blob 6-9: 6-8 + heat conduction — letters as heat source, warmth spreads
// with material buildup and dwell; less stroke/base temperature contrast
const sceneBlob69 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 4);
// Blob 6-10: 6-9 + tenure radiance — a per-letter dwell clock is stamped as
// a third field channel; long-blobbed letters glow hotter and much further
const sceneBlob610 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 5);
// Blob 6-11: 6-10 but the heat gradient rides the blob BODY (rim cool, core
// hot) — the full ramp spans the whole blob once tenure builds
const sceneBlob611 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 6);
// Blob 6-12: 6-11 + arrival imprint (fresh glyphs glow through cold goo) and
// ~7x diffusion — heat escapes the letters almost immediately
const sceneBlob612 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 7);
// Blob 7-0: 6-12's body and expanding heat, but 6-7's COOLING — the flat
// cool5 tax returns at full 6-7 strength, suppressed only while letters are
// actively held (wide dwell halo), so heat still balloons past the glyphs
// during residence and the whole region sweeps down the ramp on departure.
const sceneBlob70 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 8);
// Blob 7-0-prev: the pre-wheel 7-0 — per-letter latched overheat cycle
// (heat ~5s at max, shed ~2s to a warm floor, re-earn), 6-7-style flat
// cooling with hold-protection, 0.7 halo. Kept for posterity.
const sceneBlob70prev = (env) => blob3Scene(env, false, 1, true, true, 5, true, 9);
// Blob 7-1: the wheel (7-0) + full-cycle shed (a letter that has run every
// colour shrinks away and cools), 45% hotter, 30% more willing to let go.
const sceneBlob71 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 10);
// Blob 8: the wheel colours on a SWARM — a few small independent masses
// (~1.5 letter-cells wide, size follows the letters) whose long thin trails
// draw fading lines through the text.
const sceneBlob80 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 11);
// Blob 9: Blob 8's swarm + wheel, but the creatures travel ONLY in cardinal
// runs (up/down/left/right, 90-degree corners) — Manhattan paths.
const sceneBlob90 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 12);
// Blob 10: Blob 8's swarm, but the ENTIRE surface cycles the full colour
// wheel once per loop; letter heat radiates on top; fresh ground starts two
// bands behind and races to catch up.
const sceneBlob100 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 13);
// Blob 11: Blob 10 + active letters throw a wider fused halo (neighbours
// bunch together blobbily) while inactive areas trip their fade earlier.
const sceneBlob110 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 14);
// Blob 12: creatures walk the text grid cell-by-cell (no reversing within
// two moves), 1x1-cell influence mask, slowest colours.
const sceneBlob120 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 15);
// Blob 12-2: Blob 9 (cardinal swarm) + Blob 11's blobby wide fusing of
// active letters, with the text's temperature influence damped well down.
const sceneBlob122 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 16);
// Blob 12-3: 12-2 with the 2-band cooling reversal kept (12-2 dropped it).
const sceneBlob123 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 17);
// Blob 12-4: 12-2 with an INVISIBLE walker (only its letter choices show)
// and recency-puffed letters - newest engulf biggest, all stay puffy.
const sceneBlob124 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 18);
// Blob 12-5: 12-4 + gap bridging - a letter between two held letters gets
// engulfed across the gap.
const sceneBlob125 = (env) => blob3Scene(env, false, 1, true, true, 5, true, 19);

// Halftone — a dense dot grid; dot RADIUS comes almost entirely from mask
// coverage (so the letter shapes stay solid and legible — a size-pounding wave
// was what made v1 unreadable) while the travelling wave mostly rides the
// COLOUR plus a light size shimmer. Coverage is supersampled 4× per cell so
// letter edges resolve into clean halftone gradients. Seamless loop.

// GARBLE — the type path drawn as a dense train of ellipse outlines, like
// a pen plotter coiling a slinky along every stroke. Mostly one ink; extra
// passes land slightly misregistered (deliberate "manual adjustment"
// offsets), overprinting through multiply blending. Seeded glitches: the
// plotter "speeds up" (ellipses spread + elongate) or wanders off the
// path. All lines animate IN and back OUT together, loop-locked.
function sceneGarble(env) {
	const { W, H, getOpts } = env;
	let t = 0, passes = [], cacheKey = '', loops9 = null, loopsMeta9 = [], loopsKey = '', geo9 = null;
	// ink schemes lifted from the reference sheets:
	// candy    — the rainbow marker page (one vivid hue per pass)
	// sunviolet— yellow + violet + oxblood heavy overprint
	// emberpine— orange + deep pine two-ink plate
	// teal     — the single clean teal coil
	// plum     — purple/magenta/blue cool family
	const SCHEMES = {
		candy: ['#7b2fbe', '#0e8a68', '#2a4fd8', '#e0621a', '#c22a8e', '#c9a30a'],
		sunviolet: ['#e3b505', '#6a30c9', '#7a1420'],
		emberpine: ['#e0621a', '#0e5f52'],
		teal: ['#177e8a'],
		plum: ['#7b2fbe', '#c22a8e', '#2a4fd8', '#4a1f7e']
	};
	function contours(cov, w, h, thr) {
		const segs = [];
		const V = (x, y) => (cov[y * w + x] >= thr ? 1 : 0);
		const P = (x1, y1, x2, y2) => {
			const a = cov[y1 * w + x1], b = cov[y2 * w + x2];
			const tt = (thr - a) / ((b - a) || 1e-6);
			return [x1 + (x2 - x1) * tt, y1 + (y2 - y1) * tt];
		};
		for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
			const c = V(x, y) | (V(x + 1, y) << 1) | (V(x + 1, y + 1) << 2) | (V(x, y + 1) << 3);
			if (c === 0 || c === 15) continue;
			const T = () => P(x, y, x + 1, y), R = () => P(x + 1, y, x + 1, y + 1);
			const B = () => P(x, y + 1, x + 1, y + 1), L = () => P(x, y, x, y + 1);
			const add = (a, b) => segs.push([a(), b()]);
			if (c === 1 || c === 14) add(L, T);
			else if (c === 2 || c === 13) add(T, R);
			else if (c === 3 || c === 12) add(L, R);
			else if (c === 4 || c === 11) add(R, B);
			else if (c === 6 || c === 9) add(T, B);
			else if (c === 7 || c === 8) add(L, B);
			else if (c === 5) { add(L, T); add(R, B); }
			else if (c === 10) { add(T, R); add(B, L); }
		}
		// chain segments into loops by quantized endpoints
		const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
		const adj = new Map();
		for (let i = 0; i < segs.length; i++) {
			for (const p of [segs[i][0], segs[i][1]]) {
				const k = key(p);
				if (!adj.has(k)) adj.set(k, []);
				adj.get(k).push(i);
			}
		}
		const used = new Uint8Array(segs.length);
		const loops = [];
		for (let i = 0; i < segs.length; i++) {
			if (used[i]) continue;
			const loop = [segs[i][0]];
			let cur = i, end = segs[i][1];
			used[i] = 1;
			for (let guard = 0; guard < segs.length; guard++) {
				loop.push(end);
				const cands = adj.get(key(end)) || [];
				let nxt = -1;
				for (const j of cands) if (!used[j]) { nxt = j; break; }
				if (nxt < 0) break;
				used[nxt] = 1;
				end = key(segs[nxt][0]) === key(end) ? segs[nxt][1] : segs[nxt][0];
				cur = nxt;
			}
			if (loop.length > 6) loops.push(loop);
		}
		return loops;
	}
	function skeletonPaths(cov, w, h, thr) {
		// Zhang-Suen thinning: the stroke collapses to its 1px CENTRELINE,
		// so the coil follows one path per stroke instead of both outline
		// sides of the glyph.
		const img = new Uint8Array(w * h);
		for (let i = 0; i < img.length; i++) img[i] = cov[i] >= thr ? 1 : 0;
		const at = (x, y) => img[y * w + x];
		let changed = true;
		let guard = 0;
		while (changed && guard++ < 60) {
			changed = false;
			for (let pass = 0; pass < 2; pass++) {
				const del = [];
				for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
					if (!at(x, y)) continue;
					const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
					const B = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
					if (B < 2 || B > 6) continue;
					let A = 0;
					for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
					if (A !== 1) continue;
					if (pass === 0) { if (p[0] * p[2] * p[4] !== 0 || p[2] * p[4] * p[6] !== 0) continue; }
					else { if (p[0] * p[2] * p[6] !== 0 || p[0] * p[4] * p[6] !== 0) continue; }
					del.push(y * w + x);
				}
				if (del.length) { changed = true; for (const i of del) img[i] = 0; }
			}
		}
		// walk the skeleton graph into polylines: split at endpoints/junctions
		const deg = new Uint8Array(w * h);
		const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
		for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
			if (!at(x, y)) continue;
			// degree = CONNECTED GROUPS of neighbours (crossing number), not a
			// raw count: a diagonal step whose orthogonal neighbour is also
			// set is ONE continuation, not a junction. Raw counting shredded
			// smooth curves (the s!) into dozens of fake fragments.
			let d2 = 0;
			for (let k = 0; k < 8; k++) {
				const a1 = at(x + DIRS[k][0], y + DIRS[k][1]);
				const a2 = at(x + DIRS[(k + 1) % 8][0], y + DIRS[(k + 1) % 8][1]);
				if (!a1 && a2) d2++;
			}
			deg[y * w + x] = d2;
		}
		const usedPix = new Uint8Array(w * h);
		const paths = [];
		const walk = (sx, sy) => {
			const path = [[sx, sy]];
			let cx2 = sx, cy2 = sy, px2 = -1, py2 = -1;
			for (let g2 = 0; g2 < w * h; g2++) {
				usedPix[cy2 * w + cx2] = 1;
				let nx = -1, ny = -1;
				for (const [dx, dy] of DIRS) {
					const xx = cx2 + dx, yy = cy2 + dy;
					if (!at(xx, yy) || (xx === px2 && yy === py2) || usedPix[yy * w + xx]) continue;
					nx = xx; ny = yy; break;
				}
				if (nx < 0) break;
				path.push([nx, ny]);
				px2 = cx2; py2 = cy2; cx2 = nx; cy2 = ny;
				if (deg[ny * w + nx] !== 2) { usedPix[ny * w + nx] = 1; break; }
			}
			return path;
		};
		// start at endpoints and junctions first, then sweep leftover loops
		for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
			if (at(x, y) && !usedPix[y * w + x] && deg[y * w + x] !== 2) {
				let p2 = walk(x, y);
				while (p2.length >= 2) { paths.push(p2); usedPix[y * w + x] = 0; p2 = walk(x, y); }
				usedPix[y * w + x] = 1;
			}
		}
		for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
			if (at(x, y) && !usedPix[y * w + x]) {
				const p2 = walk(x, y);
				if (p2.length >= 2) paths.push(p2);
			}
		}
		// light smoothing: the pixel walk staircases; two moving-average
		// passes turn it into a fluent pen line
		for (const p2 of paths) {
			for (let it = 0; it < 2; it++) {
				for (let i = 1; i < p2.length - 1; i++) {
					p2[i] = [(p2[i - 1][0] + p2[i][0] * 2 + p2[i + 1][0]) / 4, (p2[i - 1][1] + p2[i][1] * 2 + p2[i + 1][1]) / 4];
				}
			}
		}
		return paths;
	}
	// quirky marker drawer: the pens someone actually owns. Neons live in a
	// separate rarer pool so they stay a treat, not a theme.
	const QUIRKY = ['#ff5fa2', '#00b3a4', '#ff7a1a', '#8fd400', '#b04ae0', '#0090e8', '#e8003d', '#ff3ec8', '#57d4b0', '#5c53e0'];
	const NEONS = ['#e8f000', '#d4f50a', '#f0e800'];
	function hueShift(hex, deg) {
		const n = parseInt(hex.slice(1), 16);
		let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
		let h = 0, s2 = 0;
		if (mx !== mn) {
			const d = mx - mn;
			s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
			h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
			h /= 6;
		}
		h = ((h + deg / 360) % 1 + 1) % 1;
		const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2, p = 2 * l - q;
		const f = (tt) => {
			tt = ((tt % 1) + 1) % 1;
			if (tt < 1 / 6) return p + (q - p) * 6 * tt;
			if (tt < 1 / 2) return q;
			if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
			return p;
		};
		const to2 = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
		return '#' + to2(f(h + 1 / 3)) + to2(f(h)) + to2(f(h - 1 / 3));
	}
	function labelComponents(cov, w, h, thr) {
		// flood-fill labels: every glyph blob gets an id (a dot of an "i" is
		// its own blob, as it should be)
		const lab = new Int32Array(w * h).fill(-1);
		let next = 0;
		const stack = [];
		for (let i0 = 0; i0 < w * h; i0++) {
			if (cov[i0] < thr || lab[i0] >= 0) continue;
			lab[i0] = next; stack.push(i0);
			while (stack.length) {
				const j = stack.pop();
				const x = j % w, y = (j / w) | 0;
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx, yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
					const k = yy * w + xx;
					if (cov[k] >= thr && lab[k] < 0) { lab[k] = next; stack.push(k); }
				}
			}
			next++;
		}
		return lab;
	}
	function mergePerGlyph(paths, lab, w) {
		// route every glyph's skeleton fragments into ONE continuous pen
		// path: greedy nearest-endpoint chaining with short bridges, the way
		// a plotter operator would sequence a letter without lifting the pen
		const groups = new Map();
		for (const p of paths) {
			const q = p[(p.length / 2) | 0];
			const li = lab[Math.round(q[1]) * w + Math.round(q[0])] ?? -1;
			if (!groups.has(li)) groups.set(li, []);
			groups.get(li).push(p);
		}
		const merged = [];
		for (const group of groups.values()) {
			group.sort((a, b) => b.length - a.length);
			const route = group.shift().slice();
			while (group.length) {
				const end = route[route.length - 1];
				let bi = 0, bRev = false, bD = 1e18;
				for (let i = 0; i < group.length; i++) {
					const g = group[i];
					const d1 = (g[0][0] - end[0]) ** 2 + (g[0][1] - end[1]) ** 2;
					const d2 = (g[g.length - 1][0] - end[0]) ** 2 + (g[g.length - 1][1] - end[1]) ** 2;
					if (d1 < bD) { bD = d1; bi = i; bRev = false; }
					if (d2 < bD) { bD = d2; bi = i; bRev = true; }
				}
				const nxt = group.splice(bi, 1)[0];
				if (bRev) nxt.reverse();
				const st = nxt[0];
				const bl = Math.hypot(st[0] - end[0], st[1] - end[1]);
				const nB = Math.min(8, Math.ceil(bl / 2));
				const up9 = bl > 3 ? 1 : 0; // micro-joins are CONTINUATION (inked); only real hops are pen-up travel
				for (let k = 1; k <= nB; k++) route.push([end[0] + (st[0] - end[0]) * k / (nB + 1), end[1] + (st[1] - end[1]) * k / (nB + 1), up9]);
				route.push(...nxt);
			}
			merged.push(route);
		}
		return merged;
	}
	function ensure(o, seedOff = 0) {
		const seed = (o.garbleSeed || 0) + seedOff, inks = Math.max(1, Math.round(o.garbleInks ?? 3));
		const clean = !!o.garbleClean;
		const gAmt = clean ? 0 : (o.garbleAmt ?? 0.5);
		const recAmt = o.garbleRecolor ?? 0;
		const drftA = clean ? 0 : (o.garbleDrift ?? 0.35);
		const dMag = o.garbleDriftMag ?? 0.5;  // 0.5 = current strength (x1)
		const dLen = o.garbleDriftLen ?? 0.5;  // 0.5 = current run length (x1)
		const vAmt = o.garbleVariety ?? 0.35;
		const lead9 = o.garbleLeading ?? 1.25;
		// discrete stamp categories: pick exactly, or draw from the pool
		const SIZE_CAT = { xxxs: 0.12, xxs: 0.25, xs: 0.45, s: 0.7, m: 1, l: 1.45, xl: 2.0, xxl: 3.0, xxxl: 4.5 };
		const SHAPE_CAT = { xxxwide: [1, 0.08], xxwide: [1, 0.16], xwide: [1, 0.3], wide: [1, 0.62], round: [1, 1], tall: [0.62, 1], xtall: [0.3, 1], xxtall: [0.16, 1], xxxtall: [0.08, 1] };
		const sizeSel = o.garbleSize || 'random';
		const shapeSel = o.garbleShape || 'random';
		const formSel = o.garbleForm || 'ellipse';
		const formStretch = !!o.garbleFormStretch;
		const formPool = o.garbleFormPool && o.garbleFormPool.length ? o.garbleFormPool : ['ellipse', 'quad', 'star'];
		// the RANDOM pools are user-curated: only ticked categories can be drawn
		const sizePool = o.garbleSizePool && o.garbleSizePool.length ? o.garbleSizePool : Object.keys(SIZE_CAT);
		const shapePool = o.garbleShapePool && o.garbleShapePool.length ? o.garbleShapePool : Object.keys(SHAPE_CAT);
		const uniform = !!o.garbleUniform;
		const scheme = SCHEMES[o.garbleScheme] || SCHEMES.candy;
		const key = (o.text || '') + '|' + W + 'x' + H + '|' + seed + '|' + inks + '|' + (o.garbleScheme || 'candy') + '|' + gAmt + '|' + (clean ? 1 : 0) + '|' + recAmt + '|' + drftA + '|' + dMag + '|' + dLen + '|' + vAmt + '|' + lead9 + '|' + sizeSel + '|' + shapeSel + '|' + formSel + '|' + (formStretch ? 1 : 0) + '|' + formPool.join('.') + '|' + (uniform ? 1 : 0) + '|' + sizePool.join('.') + '|' + shapePool.join('.');
		if (key === cacheKey) return;
		cacheKey = key;
		let sd = (4242 + seed * 7919) >>> 0;
		// murmur-style finalizer: nearby seeds (shuffle ticks step by 31) gave
		// CORRELATED early LCG outputs — pass 0's stamp category barely moved
		// between re-rolls. Hash-mixing decorrelates the stream from draw one.
		sd ^= sd >>> 16; sd = Math.imul(sd, 0x85ebca6b) >>> 0;
		sd ^= sd >>> 13; sd = Math.imul(sd, 0xc2b2ae35) >>> 0;
		sd ^= sd >>> 16; sd >>>= 0;
		const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
		const lKey = (o.text || '') + '|' + W + 'x' + H + '|' + lead9;
		if (lKey !== loopsKey) {
		// thin-weight text -> its contour hugs the stroke centreline, so the
		// ellipse train reads as a TUBE along the letter path
		const mw = 512, mh = Math.max(2, Math.round(512 * H / W));
		const cv = document.createElement('canvas'); cv.width = mw; cv.height = mh;
		const c2 = cv.getContext('2d');
		c2.fillStyle = '#000'; c2.fillRect(0, 0, mw, mh);
		const words = ((o.text || 'GARBLE').trim()).split(/\s+/).filter(Boolean);
		let fontPx = mh * 0.22;
		const fam = "'Google Sans Flex', 'Helvetica Neue', sans-serif";
		c2.font = `300 ${fontPx}px ${fam}`;
		let maxW = 0;
		for (const w of words) maxW = Math.max(maxW, c2.measureText(w).width);
		fontPx = Math.min(fontPx * (mw * 0.82) / maxW, (mh * 0.8) / (words.length * Math.max(lead9, 0.7)));
		c2.font = `300 ${fontPx}px ${fam}`;
		const lineH = fontPx * lead9; // LEADING on the slider — tight overlap to airy stack
		const y0 = mh / 2 - (lineH * words.length) / 2 + lineH / 2;
		c2.fillStyle = '#fff';
		c2.textAlign = 'center'; c2.textBaseline = 'middle';
		for (let li = 0; li < words.length; li++) c2.fillText(words[li], mw / 2, y0 + li * lineH);
		const img = c2.getImageData(0, 0, mw, mh).data;
		const cov = new Float32Array(mw * mh);
		for (let i = 0; i < cov.length; i++) cov[i] = img[i * 4] / 255;
		const lab9 = labelComponents(cov, mw, mh, 0.5);
		const loops = mergePerGlyph(skeletonPaths(cov, mw, mh, 0.5), lab9, mw); // ONE continuous pen path per glyph
		// components whose skeleton was too small to trace (the dot of an i,
		// a period) still deserve ink: stamp their centroid
		{
			const seen = new Set();
			for (const lp of loops) { const q = lp[(lp.length / 2) | 0]; seen.add(lab9[Math.round(q[1]) * mw + Math.round(q[0])]); }
			const area = new Map(), cxm = new Map(), cym = new Map();
			for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
				const L2 = lab9[y * mw + x];
				if (L2 < 0) continue;
				area.set(L2, (area.get(L2) || 0) + 1);
				cxm.set(L2, (cxm.get(L2) || 0) + x);
				cym.set(L2, (cym.get(L2) || 0) + y);
			}
			for (const [L2, a2] of area) {
				if (seen.has(L2) || a2 < 4) continue;
				const cx2 = cxm.get(L2) / a2, cy2 = cym.get(L2) / a2;
				loops.push([[cx2 - 1, cy2], [cx2 + 1, cy2]]);
			}
		}
		// sort glyphs into READING ORDER (line by line, left to right) — the
		// skeleton tracer discovers them in scan order, which is not typing
		// order (taller letters surface first)
		const lineCs = words.map((_, li2) => y0 + li2 * lineH);
		const keyed = loops.map((lp) => {
			let sx = 0, sy = 0;
			for (const p of lp) { sx += p[0]; sy += p[1]; }
			const cx2 = sx / lp.length, cy2 = sy / lp.length;
			let best = 0, bd = 1e18;
			for (let k = 0; k < lineCs.length; k++) { const d2 = Math.abs(cy2 - lineCs[k]); if (d2 < bd) { bd = d2; best = k; } }
			return { lp, k: best * 1e6 + cx2 };
		});
		keyed.sort((a, b) => a.k - b.k);
		// per-glyph ordinal WITHIN its word/line — so modes can run words in
		// parallel (letter 3 of every word at once)
		const counts9 = {};
		loopsMeta9 = keyed.map((q) => {
			const li2 = Math.floor(q.k / 1e6);
			counts9[li2] = (counts9[li2] ?? -1) + 1;
			return counts9[li2];
		});
		loops9 = keyed.map((q) => q.lp);
		geo9 = { sc: W / mw, rTube: Math.max(3, fontPx * (W / mw) * 0.1) };
		loopsKey = lKey;
		}
		const loops = loops9;
		const sc = geo9.sc, rTube = geo9.rTube;
		// build ink passes: pass 0 is the faithful trace; extra passes are
		// misregistered, sometimes partial, in other inks
		// COLOUR-THEORY schemes are GENERATED from a seeded base hue — every
		// seed re-rolls the whole harmony around a new anchor. Saturation and
		// lightness jitter slightly per swatch for the marker-drawer feel.
		const HARM = { complementary: [0, 180], analogous: [-30, 0, 30, 60], triadic: [0, 120, 240], tetradic: [0, 90, 180, 270], pentadic: [0, 72, 144, 216, 288] };
		const hsl2hex = (h, s2, l) => {
			h = (((h % 360) + 360) % 360) / 360;
			const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2, p = 2 * l - q;
			const f = (tt) => {
				tt = ((tt % 1) + 1) % 1;
				if (tt < 1 / 6) return p + (q - p) * 6 * tt;
				if (tt < 1 / 2) return q;
				if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
				return p;
			};
			const to2 = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
			return '#' + to2(f(h + 1 / 3)) + to2(f(h)) + to2(f(h - 1 / 3));
		};
		let inkPool;
		const schemeName = o.garbleScheme || 'candy';
		if (HARM[schemeName]) {
			const baseH = rnd() * 360;
			inkPool = HARM[schemeName].map((d) => hsl2hex(baseH + d, 0.68 + rnd() * 0.22, 0.38 + rnd() * 0.16));
		} else {
			inkPool = scheme.slice();
		}
		for (let i = inkPool.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [inkPool[i], inkPool[j]] = [inkPool[j], inkPool[i]]; }
		passes = [];
		const sizeKeys = sizePool, shapeKeys = shapePool;
		// uniform: one seeded draw shared by every ink
		const uSize = sizeKeys[(rnd() * sizeKeys.length) | 0];
		const uShape = shapeKeys[(rnd() * shapeKeys.length) | 0];
		for (let pi = 0; pi < inks; pi++) {
			const off = pi === 0 ? [0, 0] : [(rnd() - 0.5) * rTube * 8 * gAmt, (rnd() - 0.5) * rTube * 6 * gAmt];
			// ONE ellipse per pass: the same shape — same SIZE, same angle —
			// copied and translated along the path. A stamped spring, never a
			// snake. (Speed-glitch elongation is the one sanctioned exception.)
			const passAng = (rnd() - 0.5) * 0.7;
			// stamp category per pass: explicit selection wins; Random draws
			// per ink — unless Uniform pens shares one draw across all inks
			const sizeKey = sizeSel !== 'random' ? sizeSel : uniform ? uSize : sizeKeys[(rnd() * sizeKeys.length) | 0];
			const shapeKey = shapeSel !== 'random' ? shapeSel : uniform ? uShape : shapeKeys[(rnd() * shapeKeys.length) | 0];
			const base9 = rTube * SIZE_CAT[sizeKey];
			let passRx = base9 * SHAPE_CAT[shapeKey][0], passRy = base9 * SHAPE_CAT[shapeKey][1];
			// STAMP FORM: ellipse / quadrilateral / star (random draws per ink).
			// Quads and stars lean REGULAR — 85% snap to equal proportions —
			// unless the stretch checkbox frees them to use the full shape range
			// 'mix' GUARANTEES the spread: layer 1 ellipses, layer 2 quads,
			// layer 3 stars, then round again — unlike random, which can deal
			// three of a kind
			const form9 = formSel === 'mix' ? formPool[pi % formPool.length]
				: formSel === 'random' ? formPool[(rnd() * formPool.length) | 0] : formSel;
			const fIdx = form9 === 'quad' ? 1 : form9 === 'star' ? 2 : 0;
			if (fIdx && !formStretch && rnd() < 0.85) { passRx = base9; passRy = base9; }
			const spaceMul = Math.max(0.4, 1 + (rnd() - 0.4) * 1.2 * vAmt); // variety slider still varies SPACING
			const range = pi === 0 || rnd() > gAmt ? [0, 1] : [rnd() * 0.4, 0.6 + rnd() * 0.4];
			const ells = [];
			for (let gi9 = 0; gi9 < loops.length; gi9++) {
				const loop = loops[gi9];
				// RECOLOUR: with slider-scaled chance, this letter gets a pen
				// swap for this pass — usually a colour-theory partner of the
				// pass ink (triadic/complement), sometimes a quirky marker,
				// and once in a while (semi-uncommon, deliberately) a neon.
				let glyphCol = null, gT0 = 0, gT1 = 1;
				if (rnd() < recAmt) {
					const r2 = rnd();
					if (r2 < 0.55) glyphCol = hueShift(inkPool[pi % inkPool.length], 120 + rnd() * 120);
					else if (r2 < 0.88) glyphCol = QUIRKY[(rnd() * QUIRKY.length) | 0];
					else glyphCol = NEONS[(rnd() * NEONS.length) | 0];
					// usually a SECTION of the letter changes pen (30-40% of the
					// path, mid-letter swap); sometimes the whole letter
					if (rnd() < 0.65) {
						const len9 = 0.3 + rnd() * 0.1;
						gT0 = rnd() * (1 - len9);
						gT1 = gT0 + len9;
					}
				}
				// arc-length resample
				let total = 0;
				const cum = [0];
				for (let i = 1; i < loop.length; i++) { total += Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]); cum.push(total); }
				if (total < 4) continue;
				let s = 0, armX = 0, armY = 0, run = 0, runDx = 0, runDy = 0; // arm offset + drift-run state
				while (s < total) {
					// find point at arc s
					let lo = 0;
					while (lo < cum.length - 2 && cum[lo + 1] < s) lo++;
					const f = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
					const px = loop[lo][0] + (loop[lo + 1][0] - loop[lo][0]) * f;
					const py = loop[lo][1] + (loop[lo + 1][1] - loop[lo][1]) * f;
					const ds = rTube / sc * 0.55 * spaceMul;
					// pen-up bridge segments advance the clock but leave no ink —
					// they are TRAVEL moves, not letter strokes
					if (loop[lo][2] || loop[lo + 1][2]) { s += ds; continue; }
					// ARM BUMP: with a garble-scaled chance per circle, the plotter
					// arm gets knocked. THIS circle snaps (drawn broken, jumping
					// mid-arc from the old position to the new), and every LATER
					// circle in this letter inherits the displacement — the arm is
					// "forever moved" until the next letter re-homes it.
					// DRIFT RUN: sometimes the arm isn't knocked but DRAGGED — a
					// stretch of consecutive circles trends steadily off in one
					// direction, and (per the arm model) the letter keeps the
					// final displacement afterwards: half a letter smoothly
					// warped away from itself
					if (run <= 0 && rnd() < 0.05 * drftA) {
						const steps9 = Math.max(2, Math.round((6 + rnd() * 18) * dLen * 2));
						const ang9 = rnd() * TAU;
						// magnitude rides the garble slider but keeps a floor from
						// the drift slider, so runs read even at low garble; the
						// drift-amount slider scales the whole displacement (0.5 = x1)
						const mag9 = rTube * (2 + rnd() * 6) * Math.max(gAmt, drftA * 0.5) * dMag * 2;
						run = steps9;
						runDx = Math.cos(ang9) * mag9 / steps9;
						runDy = Math.sin(ang9) * mag9 / steps9 * 0.7;
					}
					if (run > 0) { run--; armX += runDx; armY += runDy; }
					let warp = null;
					if (rnd() < 0.002 + 0.06 * gAmt * gAmt) {
						const mag = rTube * (1.5 + rnd() * 5) * (0.4 + 0.6 * gAmt);
						const dxB = (rnd() - 0.5) * 2 * mag, dyB = (rnd() - 0.5) * 1.4 * mag;
						warp = { dx: dxB, dy: dyB, phi: (0.2 + rnd() * 0.55) * TAU, rot: (rnd() - 0.5) * 1.3, st: rnd() * TAU };
						armX += dxB; armY += dyB;
					}
					const wob = clean ? 0 : 0.3 + 0.8 * gAmt;
					ells.push({
						x: px * sc + off[0] + armX, y: py * sc + off[1] + armY,
						a: passAng + (rnd() - 0.5) * wob * 0.4,
						rx: passRx, ry: passRy, f: fIdx,
						t: s / total, warp, r: rnd(), g: gi9, gw: loopsMeta9[gi9] || 0,
						col: glyphCol && s / total >= gT0 && s / total <= gT1 ? glyphCol : null
					});
					s += ds;
				}
			}
			// alpha tapers as the stack grows: many inks overprint translucent
			// (the ghost-stack spirit), few inks stay bold
			passes.push({ color: inkPool[pi % inkPool.length], alpha: pi === 0 ? 0.75 : Math.min(0.55, 3 / inks), ells, range });
		}
		passes.lw = Math.max(1, rTube * 0.16);
		passes.gN = loops.length;
		passes.gwMax = loopsMeta9.length ? Math.max.apply(null, loopsMeta9) + 1 : 1;
		if (recAmt > 0) {
			// COLOUR-AS-LAYER: with Recolour active, every circle regroups by
			// its FINAL ink — each colour becomes its own layer, so drawing
			// order (and every layer-based animation mode) is organised
			// entirely by colour. Layer order = first appearance in pen order.
			// SIMILAR colours share a layer: recoloured circles whose ink sits
			// close to an existing layer's colour (RGB distance < ~70) merge
			// into it and draw on the same frame — only genuinely new colours
			// open new layers. Base pen inks seed the canon in pen order.
			const canon = [];
			const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
			const findLayer = (hex) => {
				const c = toRgb(hex);
				for (const L of canon) {
					const d = (L.rgb[0] - c[0]) ** 2 + (L.rgb[1] - c[1]) ** 2 + (L.rgb[2] - c[2]) ** 2;
					if (d < 4900) return L;
				}
				const L = { color: hex, rgb: c, ells: [] };
				canon.push(L);
				return L;
			};
			for (const pass of passes) findLayer(pass.color);
			for (let pi = 0; pi < passes.length; pi++) {
				const pass = passes[pi];
				for (const e of pass.ells) {
					if (e.t < pass.range[0] || e.t > pass.range[1]) continue;
					findLayer(e.col || pass.color).ells.push({ ...e, col: null, al: pass.alpha });
				}
			}
			const lw9 = passes.lw, gN9 = passes.gN, gwMax9 = passes.gwMax;
			passes = canon.filter((L) => L.ells.length).map((L) => ({ color: L.color, alpha: 1, ells: L.ells, range: [0, 1] }));
			passes.lw = lw9; passes.gN = gN9; passes.gwMax = gwMax9;
		}
	}
	function reset() { t = 0; cacheKey = ''; }
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		const dur = o.duration || 8;
		const phase = (((t / dur) % 1) + 1) % 1;
		const mode = o.garbleAnim || 'static';
		// SHUFFLE: re-roll the composition seed every ~5 frames — the whole
		// layout strobes between different configurations (skeleton cached,
		// only the cheap pass build reruns)
		ensure(o, mode === 'shuffle' ? Math.floor(phase * dur * 4) * 31 : 0);
		paintBg(ctx, o, W, H);
		const tSec = phase * dur;
		const drawing = phase < 0.5;
		const v = drawing ? phase * 2 : (phase - 0.5) * 2;
		const nP = passes.length;
		ctx.save();
		ctx.globalCompositeOperation = 'multiply'; // overprint
		ctx.lineWidth = passes.lw || 1.5;
		for (let pi = 0; pi < nP; pi++) {
			const pass = passes[pi];
			// LAYERS: HARD CUTS at shuffle tempo — a new ink slams in every
			// quarter second until all are stacked, then the full print holds
			// for the rest of the loop
			if (mode === 'layers' && pi >= 1 + Math.floor(tSec * 4)) continue;
			const nG = passes.gN || 1;
			if (mode === 'cascadelayers' && tSec < pi * 2.2) continue;
			ctx.globalAlpha = pass.alpha;
			for (const e of pass.ells) {
				if (e.t < pass.range[0] || e.t > pass.range[1]) continue;
				// per-circle sweep timing — SHARED LOGIC for the three drawing
				// modes: staggered starts (0.5s window), individual sweep rates,
				// so circles never all land on the same frame.
				let sweep = 1;
				if (mode === 'draw') sweep = (tSec - e.r * 0.5) / (0.8 + 0.5 * e.r); // ALL letters at once
				else if (mode === 'cascade' || mode === 'cascadelayers') {
					// CASCADE: every letter runs simultaneously, but within each
					// letter the circles start in tight PATH ORDER (small delay
					// circle-to-circle) with long overlapping sweeps — parallel
					// travelling waves down every letter at once. The layers
					// variant runs one ink's cascade after another.
					const t0 = mode === 'cascadelayers' ? pi * 2.2 : 0;
					const vC = Math.min(1, Math.max(0, (tSec - t0) / 2.2));
					sweep = (vC - 0.55 * e.t) / (0.4 * (0.7 + 0.6 * e.r));
				}
				else if (mode === 'cascadewp') {
					// CASCADE BY LAYERS x WORDS IN PARALLEL: each ink takes its
					// turn; within the ink, letter k of EVERY word cascades at
					// once (path-order circle delays, unhurried sweeps), then
					// letter k+1 across all words — column by column, ink by ink.
					// pacing ADAPTS to fit the loop: layers split the duration,
					// letter columns split each layer (fixed slots overflowed the
					// loop for many-ink long words — late layers never appeared)
					const layerDur9 = (dur * 0.94) / nP;
					const slot9 = Math.max(0.12, (layerDur9 - 1.1) / (passes.gwMax || 1));
					const st9 = pi * layerDur9 + e.gw * slot9 + e.t * Math.min(0.5, slot9 * 0.85);
					sweep = (tSec - st9) / (Math.max(0.22, slot9 * 0.85) * (0.75 + 0.5 * e.r));
				}
				else if (mode === 'wordpar') {
					// WORDS IN PARALLEL: the k-th letter of EVERY word traces at
					// the same moment — the I of INTERACTIVE with the D of DESIGN
					// with the C of CONCEPTS — all inks drawing together, then
					// letter k+1 across all words, and so on. Un-trace mirrors.
					const units9 = passes.gwMax || 1;
					const vG = drawing
						? Math.min(1, Math.max(0, phase * 2 * units9 - e.gw))
						: Math.min(1, Math.max(0, (phase - 0.5) * 2 * units9 - e.gw));
					const s9 = (vG - 0.55 * e.t) / (0.4 * (0.7 + 0.6 * e.r));
					sweep = drawing ? s9 : 1 - s9;
				}
				else if (mode === 'staggerstart') {
					// STAGGER START: every circle's animation BEGINS at the exact
					// moment the scheduled pen (layer -> letter -> path position)
					// reaches it — but the sweep itself takes its own unhurried
					// ~0.5-1s regardless of the schedule's pace. Starts are
					// strictly ordered; completions overlap freely across
					// letters and even layers. The pen's schedule, the ink's
					// leisure.
					const units9 = nP * nG;
					const slot9 = pi * nG + e.g;
					const startSec = (slot9 + e.t * 0.85) * (dur * 0.82) / units9;
					sweep = (tSec - startSec) / (0.5 + 0.45 * e.r);
				}
				else if (mode === 'trace' || mode === 'tracelayers') {
					// STRICT letter order: each letter's path traces to completion
					// before the next letter begins (tracelayers: the whole
					// letter sequence per ink, one ink after another). Un-trace
					// mirrors across the second half of the loop.
					const units = mode === 'trace' ? nG : nP * nG;
					const slot = mode === 'trace' ? e.g : pi * nG + e.g;
					const vG = drawing
						? Math.min(1, Math.max(0, phase * 2 * units - slot))
						: Math.min(1, Math.max(0, (phase - 0.5) * 2 * units - slot));
					// overlapping sweeps: circle STARTS are staggered tightly
					// along the path (~10ms apart) while each sweep itself runs
					// LONG (~40% of the letter window) — many circles drawing at
					// once, a smooth travelling wave instead of rapid-fire pops.
					// Late circles may spill slightly past the slot; that reads
					// as organic pen momentum, not a bug.
					const s9 = (vG - 0.55 * e.t) / (0.4 * (0.7 + 0.6 * e.r));
					sweep = drawing ? s9 : 1 - s9;
				}
				sweep = sweep < 0 ? 0 : sweep > 1 ? 1 : sweep;
				if (sweep <= 0) continue;
				ctx.strokeStyle = e.col || pass.color;
				if (e.al !== undefined) ctx.globalAlpha = e.al; // colour-as-layer keeps each circle's source-ink opacity
				strokeEll(ctx, e, sweep);
			}
		}
		ctx.restore();
	}
	function strokeEll(ctx, e, sweep) {
				if (!e.warp && e.f) { polyStamp(ctx, e, sweep, e.f === 1 ? 4 : 10); return; }
				if (!e.warp) {
					ctx.beginPath();
					ctx.ellipse(e.x, e.y, e.rx, e.ry, e.a, 0, TAU * sweep);
					ctx.stroke();
				} else if (sweep < 1) {
					// mid-sweep warped circle: draw its first arc proportionally;
					// the skid + landing arc pop in as the sweep completes
					const wp = e.warp;
					ctx.beginPath();
					ctx.ellipse(e.x - wp.dx, e.y - wp.dy, e.rx, e.ry, e.a, wp.st, wp.st + wp.phi * Math.min(1, sweep * 1.6));
					ctx.stroke();
				} else {
					// the SNAPPED circle: begins where the arm USED to be, breaks
					// off mid-arc, and finishes warped at the new position — both
					// halves drawn SQUIGGLY (the pen shaking through the shove),
					// joined by a squiggly, broken skid line between break point
					// and touch-down point
					const wp = e.warp;
					const arcPt = (cx0, cy0, rx0, ry0, a0, tt, k1) => {
						const w9 = 1 + 0.11 * Math.sin(tt * 11 + k1) + 0.06 * Math.sin(tt * 21 + k1 * 1.7);
						const lx = Math.cos(tt) * rx0 * w9, ly = Math.sin(tt) * ry0 * w9;
						return [cx0 + lx * Math.cos(a0) - ly * Math.sin(a0), cy0 + lx * Math.sin(a0) + ly * Math.cos(a0)];
					};
					const drawArc = (cx0, cy0, rx0, ry0, a0, t0, t1, k1) => {
						ctx.beginPath();
						let last = null;
						for (let i = 0; i <= 22; i++) {
							const p9 = arcPt(cx0, cy0, rx0, ry0, a0, t0 + (t1 - t0) * i / 22, k1);
							i ? ctx.lineTo(p9[0], p9[1]) : ctx.moveTo(p9[0], p9[1]);
							last = p9;
						}
						ctx.stroke();
						return last;
					};
					const brk = drawArc(e.x - wp.dx, e.y - wp.dy, e.rx, e.ry, e.a, wp.st, wp.st + wp.phi, wp.st * 3.1);
					const land = arcPt(e.x, e.y, e.rx * 1.15, e.ry * 0.85, e.a + wp.rot, wp.st + wp.phi, wp.st * 5.3);
					drawArc(e.x, e.y, e.rx * 1.15, e.ry * 0.85, e.a + wp.rot, wp.st + wp.phi, wp.st + TAU, wp.st * 5.3);
					// the skid: squiggles along the shove, breaking twice where the
					// pen left the paper
					const nx9 = -(land[1] - brk[1]), ny9 = land[0] - brk[0];
					const nl9 = Math.hypot(nx9, ny9) || 1;
					const amp9 = Math.min(e.rx * 0.7, nl9 * 0.3);
					for (const seg of [[0, 0.3], [0.42, 0.66], [0.78, 1]]) {
						ctx.beginPath();
						for (let i = 0; i <= 10; i++) {
							const u = seg[0] + (seg[1] - seg[0]) * i / 10;
							const per = Math.sin(u * Math.PI * (3.0 + wp.rot)) * (0.6 + 0.4 * Math.sin(wp.st + u * 9.0));
							const X = brk[0] + (land[0] - brk[0]) * u + (nx9 / nl9) * per * amp9;
							const Y = brk[1] + (land[1] - brk[1]) * u + (ny9 / nl9) * per * amp9;
							i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
						}
						ctx.stroke();
					}
				}
	}
	function polyStamp(ctx, e, sweep, nV) {
		// quadrilateral or 5-point star stamped as a closed outline; sweep
		// draws a fraction of the perimeter (same reveal language as arcs)
		let pts;
		if (nV === 4) pts = [[-e.rx, -e.ry], [e.rx, -e.ry], [e.rx, e.ry], [-e.rx, e.ry]];
		else {
			pts = [];
			for (let i = 0; i < 10; i++) {
				const a = -Math.PI / 2 + (i * Math.PI) / 5;
				const r = i % 2 ? 0.45 : 1;
				pts.push([Math.cos(a) * e.rx * r, Math.sin(a) * e.ry * r]);
			}
		}
		const ca = Math.cos(e.a), sa = Math.sin(e.a);
		const P = pts.map(([x, y]) => [e.x + x * ca - y * sa, e.y + x * sa + y * ca]);
		P.push(P[0]);
		const segL = [];
		let tot = 0;
		for (let i = 0; i < P.length - 1; i++) { const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); segL.push(L); tot += L; }
		let rem = tot * Math.min(1, sweep);
		ctx.beginPath();
		ctx.moveTo(P[0][0], P[0][1]);
		for (let i = 0; i < segL.length && rem > 0; i++) {
			if (rem >= segL[i]) { ctx.lineTo(P[i + 1][0], P[i + 1][1]); rem -= segL[i]; }
			else { const f = rem / segL[i]; ctx.lineTo(P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f); rem = 0; }
		}
		if (sweep >= 1) ctx.closePath();
		ctx.stroke();
	}
	return { reset, step, render };
}

// CLOUDS — "the words are clouds": a raymarched volumetric cloud bank in
// the shape of the text, drifting gently in a vibrant blue sky. The text
// mask (blurred CPU-side into a puffy coverage field) extrudes into a 3D
// density slab; 4-octave fbm sculpts the cauliflower detail; a march
// toward the sun accumulates real self-shadowing (the heavy shading on
// the puffs). Drift moves the noise domain in a CIRCLE, so the loop is
// exact. WebGL fragment raymarch — no WebGPU needed, runs everywhere.
function sceneClouds(env) {
	const { W, H, getOpts } = env;
	let t = 0, glcv = null, gl = null, prog = null, uni = {}, maskTex = null, maskKey = '', glyphFrac = 0.25;
	const VS = 'attribute vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }';
	const FS = `
precision highp float;
uniform vec2 uRes;
uniform float uPh;
uniform float uGl;   // glyph size as a fraction of canvas height
uniform float uSd;   // movement seed: offsets the whole noise domain
uniform float uTilt; // vertical tilt: letters lean toward/away from the camera
uniform float uWsp;  // wisp amount: trails + fibrous edge streaming
uniform float uSolid; // 0 = gauzy vapour, 1 = solid white cloud
uniform float uShad; // shadow depth: 0 = airy light shadows, 1 = heavy dark
uniform float uSprd; // wisp spread: fibres stream further, sheets roam wider
uniform float uHole; // inner veils: large translucent windows inside letters
uniform float uToD;  // SKY time of day: 0 dawn, 1/3 midday, 2/3 sunset, 1 night
uniform float uToDT; // TEXT time of day (the clouds' lit/shadow palette)
uniform float uRain; // rain amount
uniform float uSnow; // snow amount
uniform float uFog;  // fog/mist amount
vec3 keyMix(vec3 a, vec3 b, vec3 c, vec3 d2, float t){
	return t < 0.3333 ? mix(a, b, t * 3.0) : t < 0.6667 ? mix(b, c, (t - 0.3333) * 3.0) : mix(c, d2, clamp((t - 0.6667) * 3.0, 0.0, 1.0));
}
uniform vec3 uSun;   // light position (normalized in main)
uniform sampler2D uMask;
float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
	vec3 i = floor(x), f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
	               mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
	           mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
	               mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p *= 2.17; a *= 0.5; } return s; }
float fbm2(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 2; i++){ s += a * vnoise(p); p *= 2.17; a *= 0.5; } return s; }
float dens(vec3 p, vec3 dr){
	vec4 mt = texture2D(uMask, vec2(p.x, 1.0 - p.y));
	float m = mt.r;
	float zl = mt.a - 0.5; // per-letter z-lean painted into the mask's alpha
	// EDGE WISPS: faint fibrous echoes of the strokes streaming LEFTWARD —
	// the letters shed wind-drawn hairs at their edges. Tall thin noise
	// (fine in y, coarse in x) breaks the echo into separate fibres.
	float sprd = 1.0 + 2.2 * uSprd;
	float mR = texture2D(uMask, vec2(p.x + 0.055 * sprd, 1.0 - p.y)).r;
	float mR2 = texture2D(uMask, vec2(p.x + 0.12 * sprd, 1.0 - p.y)).r;
	float fib = vnoise(vec3(p.x * 8.0, p.y * 90.0, p.z * 9.0) + dr * 1.3);
	m = max(m, uWsp * max(mR * 0.5, mR2 * 0.28) * fib * (0.35 + 0.65 * fib));
	// GLYPH-RELATIVE scale: every noise wavelength is sized against the
	// letters, not the canvas — big single words stay just as rough (their
	// lobes grow with them), and small multi-word text keeps its counters
	// (the E's gaps) because the features shrink to match
	float sf = clamp(0.55 / max(uGl, 0.04), 0.75, 8.0);
	float th = 0.04 + 0.05 * m + 0.13 * m * fbm2(vec3(p.x * 13.0 * sf, p.y * 13.0 * sf, 7.7) + dr);
	float zt = p.z - (p.x - 0.5) * 0.24 - (p.y - 0.5) * 0.06 - zl * uTilt * 2.6; // per-LETTER lean, amplified — the slider now reaches genuinely violent tilts
	float zf = 1.0 - smoothstep(0.0, th, abs(zt));
	float ar = uRes.x / uRes.y;
	// DOMAIN WARP: a second noise field bends the sampling coordinates of
	// the first — billows curl and smear into wisps instead of staying round
	vec3 q = vec3(p.x * 5.5 * ar * sf, p.y * 5.5 * sf, p.z * 4.0 * sf) + dr;
	vec2 wrp = vec2(fbm2(q * 1.6 + 13.1), fbm2(q * 1.6 + 71.7)) - 0.5;
	float n = fbm(q + vec3(wrp * 1.6, 0.0));
	// COTTON CANDY: mid-scale lobes MULTIPLY the stroke body — the letter
	// itself bulges and pinches along its length (cumulus lobing) instead
	// of holding a constant tube radius that noise merely decorates
	float lump = fbm2(q * 2.4 + 31.7);
	float mB = m * (0.5 + 1.15 * lump);
	// WIND-COMBED EROSION: the edge-eating noise is stretched horizontally
	// (x sampled coarse, y fine), so the tearing forms streaky filaments
	// dragged along the wind rather than round bites; a second finer comb
	// shreds the very edges
	float hf = vnoise(vec3(p.x * 13.0 * ar * sf, p.y * 40.0 * sf, p.z * 14.0 * sf) + dr * 1.6);
	float hf2 = vnoise(vec3(p.x * 28.0 * ar * sf, p.y * 76.0 * sf, p.z * 24.0 * sf) + dr * 2.2);
	float base = mB * (1.3 + 0.25 * clamp(sf - 1.0, 0.0, 1.0)) - 0.33 + (n - 0.5) * 1.35; // small text: strokes push back harder against the erosion
	float edge = 1.0 - clamp(base * 2.0, 0.0, 1.0);
	base -= (hf * 0.52 + hf2 * 0.3) * edge * (0.8 + 0.32 * clamp(sf - 1.0, 0.0, 4.0)); // erosion bites harder as the glyphs shrink
	return clamp(base, 0.0, 1.0) * zf;
}
float densLo(vec3 p, vec3 dr){
	vec4 mt = texture2D(uMask, vec2(p.x, 1.0 - p.y));
	float m = mt.r;
	float zl = mt.a - 0.5;
	float sf = clamp(0.55 / max(uGl, 0.04), 0.75, 8.0);
	float th = 0.05 + 0.17 * m;
	float zt = p.z - (p.x - 0.5) * 0.24 - (p.y - 0.5) * 0.06 - zl * uTilt * 2.6;
	float zf = 1.0 - smoothstep(0.0, th, abs(zt));
	float n = fbm2(vec3(p.x * 5.5 * (uRes.x / uRes.y) * sf, p.y * 5.5 * sf, p.z * 4.0 * sf) + dr);
	return clamp(m * 1.45 - 0.3 + (n - 0.5) * 0.95, 0.0, 1.0) * zf;
}
void main(){
	vec2 uv = gl_FragCoord.xy / uRes;
	// TIME OF DAY: every colour in the scene interpolates through four
	// keyframes — dawn / midday / sunset / night — so the light's gradient
	// lands on the sky AND on the clouds' lit + shadow tints together
	vec3 skyT = keyMix(vec3(0.38, 0.47, 0.86), vec3(0.16, 0.45, 0.96), vec3(0.23, 0.2, 0.5), vec3(0.02, 0.035, 0.1), uToD);
	vec3 skyH = keyMix(vec3(1.0, 0.78, 0.6), vec3(0.78, 0.9, 1.0), vec3(1.0, 0.55, 0.3), vec3(0.06, 0.08, 0.16), uToD);
	vec3 glowC = keyMix(vec3(1.0, 0.72, 0.5), vec3(1.0, 0.97, 0.9), vec3(1.0, 0.5, 0.28), vec3(0.6, 0.7, 1.0), uToD);
	float glowS = keyMix(vec3(0.3), vec3(0.12), vec3(0.36), vec3(0.05), uToD).x;
	vec3 litC = keyMix(vec3(1.14, 0.98, 0.88), vec3(1.14, 1.12, 1.07), vec3(1.18, 0.88, 0.62), vec3(0.3, 0.36, 0.52), uToDT);
	vec3 shLo = keyMix(vec3(0.78, 0.68, 0.75), vec3(0.8, 0.84, 0.93), vec3(0.66, 0.48, 0.56), vec3(0.07, 0.09, 0.16), uToDT);
	vec3 shHi = keyMix(vec3(0.42, 0.3, 0.5), vec3(0.3, 0.38, 0.6), vec3(0.32, 0.2, 0.42), vec3(0.02, 0.03, 0.07), uToDT);
	vec3 sky = mix(skyH, skyT, pow(uv.y, 0.85));
	sky += glowC * glowS * pow(max(0.0, 1.0 - distance(uv, vec2(0.2, 0.92)) * 1.3), 2.0);
	// drift: a slow CIRCLE through noise space — returns exactly, so it loops
	vec3 dr = vec3(cos(uPh) * 0.7 + uSd * 17.31, sin(uPh) * 0.24 + uSd * 9.17, sin(uPh + 1.7) * 0.15 + uSd * 5.43); // movement seed relocates the drift circle in noise space
	vec3 ro = vec3(uv, 0.34);
	vec3 rd = normalize(vec3((uv - 0.5) * 0.1, -1.0));
	vec3 sun = normalize(uSun + vec3(0.0, 0.0, 0.0001)); // light position from the sliders
	float T = 1.0;
	vec3 acc = vec3(0.0);
	const int N = 44; // finer march resolves the small-glyph texture
	float dt2 = 0.68 / float(N);
	for (int i = 0; i < N; i++){
		vec3 p = ro + rd * (float(i) + 0.5) * dt2;
		float d = dens(p, dr);
		if (d > 0.004 && T > 0.02){
			// march toward the sun for self-shadowing — the HEAVY shading
			float sh = densLo(p + sun * 0.032, dr) + densLo(p + sun * 0.08, dr) * 0.6;
			float li = exp(-sh * (1.0 + 2.2 * uShad)) * 0.9 + 0.1;
			// CONTRAST remap: midtones push toward LIT, so integrated interior
			// samples can't drag the sunlit fronts down into gray — lit faces
			// saturate to true white (the lit colour sits past 1 and clamps)
			float li2 = smoothstep(0.08, 0.75, li);
			vec3 shCol = mix(shLo, shHi, uShad); // shadow slider blends within the time-of-day's own shadow palette
			vec3 cc = mix(shCol, litC, li2);
			cc += litC * 0.28 * li2 * li2; // crown tinted by the hour's light
			// SPATIALLY-VARYING extinction: dense cores stay solid (the white
			// crowns keep their body), thin zones go gauzy, and a large-scale
			// patch noise sweeps whole AREAS of the text into translucency —
			// some letters veiled, others puffed solid
			float pat = vnoise(vec3(p.x * 3.2 * (uRes.x / uRes.y), p.y * 3.2, p.z * 2.0) + dr * 0.7 + 91.3);
			float sig = mix(11.0, 30.0, smoothstep(0.12, 0.65, d)) * (0.55 + 0.75 * pat) * mix(0.55, 2.7, uSolid); // solidity: gauze to solid white
			sig *= 1.0 - uHole * smoothstep(0.5, 0.85, pat) * 0.85; // INNER VEILS: the patch field carves big translucent windows straight through dense letter bodies
			float a = 1.0 - exp(-d * sig * dt2);
			acc += T * a * cc;
			T *= 1.0 - a;
		}
	}
	vec3 col = acc + sky * T;
	// WEATHER EFFECTS — all loop-locked (integer sweeps of uPh per loop)
	// fog/mist: wash the frame toward a pale veil
	col = mix(col, mix(skyH, vec3(0.78, 0.8, 0.84), 0.6), uFog * 0.55);
	// rain: sparse slanted streak columns, each falling an integer number
	// of sweeps per loop; density rides the slider
	if (uRain > 0.001) {
		float rx = uv.x * 90.0 + uv.y * 16.0;
		float cid = floor(rx);
		float h1 = hash(vec3(cid, 1.7, 9.2));
		float h2 = hash(vec3(cid, 4.3, 2.8));
		float lane = smoothstep(0.35, 0.5, fract(rx)) * smoothstep(0.65, 0.5, fract(rx));
		float spd = 4.0 + floor(h1 * 3.0);
		float fall = fract(uv.y * 1.4 + h2 * 9.0 + (uPh / 6.2831853) * spd);
		float drop = smoothstep(0.75, 0.98, fall) * step(h1, uRain * 0.75 + 0.05);
		col = mix(col, vec3(0.6, 0.68, 0.82), drop * lane * 0.5);
	}
	// snow: individual flakes with per-flake integer fall rates and a sine
	// sway — every flake returns to its start at the loop seam
	if (uSnow > 0.001) {
		float arx = uRes.x / uRes.y;
		for (int i = 0; i < 22; i++) {
			float fi = float(i);
			float h1 = hash(vec3(fi, 3.3, 7.7));
			float h2 = hash(vec3(fi, 9.1, 1.3));
			float spd = 1.0 + floor(h1 * 2.0);
			vec2 fp = vec2(fract(h1 + sin(uPh + h2 * 6.2831853) * 0.03), fract(h2 + (uPh / 6.2831853) * spd));
			float dd2 = length((uv - fp) * vec2(arx, 1.0));
			float flake = smoothstep(0.007 + h2 * 0.007, 0.002, dd2);
			col = mix(col, vec3(1.0), flake * 0.85 * step(fi / 22.0, uSnow));
		}
	}
	gl_FragColor = vec4(col, 1.0);
}`;
	function initGL() {
		glcv = document.createElement('canvas');
		glcv.width = W; glcv.height = H;
		gl = glcv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
		if (!gl) return;
		const mk = (ty, s) => { const sh = gl.createShader(ty); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
		prog = gl.createProgram();
		gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
		gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
		gl.useProgram(prog);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(prog, 'aP');
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		uni = { res: gl.getUniformLocation(prog, 'uRes'), ph: gl.getUniformLocation(prog, 'uPh'), gl2: gl.getUniformLocation(prog, 'uGl'), sd: gl.getUniformLocation(prog, 'uSd'), tilt: gl.getUniformLocation(prog, 'uTilt'), wsp: gl.getUniformLocation(prog, 'uWsp'), solid: gl.getUniformLocation(prog, 'uSolid'), shad: gl.getUniformLocation(prog, 'uShad'), sprd: gl.getUniformLocation(prog, 'uSprd'), hole: gl.getUniformLocation(prog, 'uHole'), tod: gl.getUniformLocation(prog, 'uToD'), todt: gl.getUniformLocation(prog, 'uToDT'), rain: gl.getUniformLocation(prog, 'uRain'), snow: gl.getUniformLocation(prog, 'uSnow'), fog: gl.getUniformLocation(prog, 'uFog'), sun: gl.getUniformLocation(prog, 'uSun'), mask: gl.getUniformLocation(prog, 'uMask') };
		gl.uniform1i(uni.mask, 0);
		gl.uniform2f(uni.res, W, H);
		gl.viewport(0, 0, W, H);
	}
	function buildMask(o) {
		const key = (o.text || '') + '|' + W + 'x' + H + '|' + (o.cloudSeedP || 0) + '|' + (o.cloudScatter ?? 1) + '|' + (o.cloudEnv ?? 0.6) + '|' + (o.cloudEnvAll ? 1 : 0) + '|' + (o.cloudWisp ?? 0.4) + '|' + (o.cloudSeedT || 0) + '|' + (o.cloudWispSpread ?? 0.3);
		if (key === maskKey || !gl) return;
		maskKey = key;
		const mw = 512, mh = Math.max(2, Math.round(512 * H / W));
		// custom mask painter: each WORD on its own line; every letter set
		// slightly ASKEW (seeded rotation + bob, like real drifting clouds);
		// a few letters get a wispy WIND TRAIL — a tapering smear dragged
		// off to the left, which the blur + fbm turn into torn filaments.
		const mcv = document.createElement('canvas'); mcv.width = mw; mcv.height = mh;
		const mx = mcv.getContext('2d');
		mx.fillStyle = '#000'; mx.fillRect(0, 0, mw, mh);
		// z-lean canvas: mid-gray = neutral; each glyph is painted with a
		// vertical gradient encoding ITS OWN random lean toward/away
		const zcv = document.createElement('canvas'); zcv.width = mw; zcv.height = mh;
		const zx = zcv.getContext('2d');
		zx.fillStyle = 'rgb(128,128,128)'; zx.fillRect(0, 0, mw, mh);
		let sd = (1337 + (o.cloudSeedP || 0) * 9973) >>> 0;
		let sdT = (777 + (o.cloudSeedT || 0) * 7919) >>> 0;
		const rndT = () => ((sdT = (sdT * 1664525 + 1013904223) >>> 0) / 4294967296);
		const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
		const words = ((o.text || 'INTERACTIVE DESIGN CONCEPTS').trim().toUpperCase()).split(/\s+/).filter(Boolean);
		if (words.length) {
			let fontPx = mh * 0.2;
			const fam = "'Google Sans Flex', 'Helvetica Neue', sans-serif";
			mx.font = `600 ${fontPx}px ${fam}`;
			let maxW = 0;
			for (const w of words) maxW = Math.max(maxW, mx.measureText(w).width);
			fontPx = Math.min(fontPx * (mw * 0.78) / maxW, (mh * 0.82) / (words.length * 1.18));
			mx.font = `600 ${fontPx}px ${fam}`;
			glyphFrac = fontPx / mh; // tells the shader how big the letters are
			const lineH = fontPx * 1.18;
			const y0 = mh / 2 - (lineH * words.length) / 2 + lineH / 2;
			mx.fillStyle = '#fff';
			mx.textBaseline = 'middle'; mx.textAlign = 'center';
			const scat = o.cloudScatter ?? 1;
			const env9 = o.cloudEnv ?? 0.6;
			const envAll = !!o.cloudEnvAll;
			if (envAll) {
				// ENSEMBLE mode: one shared squash/stretch/lean warps the whole
				// composition as a single cloud envelope
				mx.save();
				mx.translate(mw / 2, mh / 2);
				mx.rotate((rnd() - 0.5) * 0.1 * env9);
				mx.scale(1 + (rnd() - 0.5) * 0.55 * env9, 1 + (rnd() - 0.5) * 0.55 * env9);
				mx.translate(-mw / 2, -mh / 2);
			}
			// FLAT WISP SHEETS: broad, very thin smears floating around the
			// composition — they render as flat strata of vapour between the
			// letter-clouds (low mask value = thin slab = wispy)
			const nSheets = Math.round((2.5 + rnd() * 3) * (0.35 + 1.3 * (o.cloudWisp ?? 0.4)));
			for (let s9 = 0; s9 < nSheets; s9++) {
				const sx9 = mw * (0.1 + rnd() * 0.8), sy9 = mh * (0.12 + rnd() * 0.76);
				const sw9 = fontPx * (2.4 + rnd() * 3.2) * (1 + 0.9 * (o.cloudWispSpread ?? 0.3)), sh9 = fontPx * (0.1 + rnd() * 0.16);
				mx.save();
				mx.translate(sx9, sy9);
				mx.rotate((rnd() - 0.5) * 0.1);
				const gr9 = mx.createLinearGradient(-sw9 / 2, 0, sw9 / 2, 0);
				gr9.addColorStop(0, 'rgba(255,255,255,0)');
				gr9.addColorStop(0.3, 'rgba(255,255,255,0.3)');
				gr9.addColorStop(0.7, 'rgba(255,255,255,0.3)');
				gr9.addColorStop(1, 'rgba(255,255,255,0)');
				mx.fillStyle = gr9;
				mx.beginPath();
				mx.ellipse(0, 0, sw9 / 2, sh9 / 2, 0, 0, TAU);
				mx.fill();
				mx.restore();
			}
			mx.fillStyle = '#fff';
			for (let li = 0; li < words.length; li++) {
				const gs = Array.from(words[li]);
				const widths = gs.map((g) => mx.measureText(g).width);
				const total = widths.reduce((s, w2) => s + w2, 0);
				// SCATTER: each line drifts off centre, and every letter gets a
				// real vertical excursion + spacing wobble + its own size — no
				// flat baseline, more like clumps that happen to line up
				let x = mw / 2 - total / 2 + (rnd() - 0.5) * fontPx * 0.9 * scat;
				const yy = y0 + li * lineH;
				for (let gi = 0; gi < gs.length; gi++) {
					const gx = x + widths[gi] / 2 + (rnd() - 0.5) * fontPx * 0.16 * scat;
					const gy = yy + (rnd() - 0.5) * fontPx * 0.5 * scat;
					const rot = (rnd() - 0.5) * 0.26 * scat;
					const scl = 1.04 + (rnd() - 0.5) * 0.28 * scat;
					if (rnd() < 0.1 + 0.6 * (o.cloudWisp ?? 0.4)) {
						// wind trail: a tapering smear dragged off leftward
						// (gradient in LOCAL coords — canvas gradients live in the
						// transform space active at fill time)
						const tl = fontPx * (1.6 + rnd() * 1.6) * (1 + 1.6 * (o.cloudWispSpread ?? 0.3)); // spread: trails drag further
						mx.save();
						mx.translate(gx, gy);
						mx.rotate(rot * 0.4 + 0.04);
						const gr = mx.createLinearGradient(0, 0, -tl, fontPx * 0.18);
						gr.addColorStop(0, 'rgba(255,255,255,0.55)');
						gr.addColorStop(1, 'rgba(255,255,255,0)');
						mx.fillStyle = gr;
						mx.beginPath();
						mx.ellipse(-tl / 2, 0, tl / 2, fontPx * 0.16, 0, 0, TAU);
						mx.fill();
						mx.restore();
						mx.fillStyle = '#fff';
					}
					// ENVELOPE DISTORT (per-letter mode): each glyph squashed,
					// expanded or stretched on its own axes — the letterform's
					// whole envelope deforms like a cloud mass, not just its edges
					const ex9 = envAll ? 1 : 1 + (rnd() - 0.5) * 0.6 * env9;
					const ey9 = envAll ? 1 : 1 + (rnd() - 0.5) * 0.6 * env9;
					mx.save();
					mx.translate(gx, gy);
					mx.rotate(rot);
					mx.scale(scl * ex9, scl * ey9);
					mx.fillText(gs[gi], 0, 0);
					mx.restore();
					// this glyph's own lean, top vs bottom (positive or negative)
					const tl9 = (rndT() - 0.5) * 2; // tilt has its OWN seed stream
					zx.save();
					zx.translate(gx, gy);
					zx.rotate(rot);
					zx.scale(scl * ex9, scl * ey9);
					const zg = zx.createLinearGradient(0, -fontPx * 0.55, 0, fontPx * 0.55);
					const gA = Math.round(128 + tl9 * 105), gB = Math.round(128 - tl9 * 105);
					zg.addColorStop(0, `rgb(${gA},${gA},${gA})`);
					zg.addColorStop(1, `rgb(${gB},${gB},${gB})`);
					zx.font = mx.font;
					zx.textBaseline = 'middle'; zx.textAlign = 'center';
					zx.fillStyle = zg;
					zx.fillText(gs[gi], 0, 0);
					zx.restore();
					x += widths[gi];
				}
			}
			if (envAll) mx.restore(); // close the ensemble transform (scoped inside the block that opened it)
		}
		const mdata = mx.getImageData(0, 0, mw, mh).data;
		const cov = new Float32Array(mw * mh);
		for (let i = 0; i < cov.length; i++) cov[i] = mdata[i * 4] / 255;
		// puff the coverage: three box blurs — the soft skirt is what lets
		// the fbm carve puffs OUTSIDE the strokes (crisp masks read as text
		// cut out of fog, not as clouds)
		let a = Float32Array.from(cov), b = new Float32Array(mw * mh);
		// blur radius scales with the TYPE SIZE: a fixed radius swallowed the
		// counters (the E's gaps) whenever the text was small
		const rBlur = Math.max(1, Math.round(glyphFrac * mh * 0.055));
		for (let pass = 0; pass < 3; pass++) {
			const r = rBlur;
			for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
				let s = 0, c = 0;
				for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < mw) { s += a[y * mw + xx]; c++; } }
				b[y * mw + x] = s / c;
			}
			for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) {
				let s = 0, c = 0;
				for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < mh) { s += b[yy * mw + x]; c++; } }
				a[y * mw + x] = s / c;
			}
		}
		// blur the z-lean field once (h+v) so leans blend smoothly between letters
		const zdata = zx.getImageData(0, 0, mw, mh).data;
		let zc = new Float32Array(mw * mh), zb = new Float32Array(mw * mh);
		for (let i = 0; i < zc.length; i++) zc[i] = zdata[i * 4];
		for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
			let s = 0, c = 0;
			for (let k = -rBlur; k <= rBlur; k++) { const xx = x + k; if (xx >= 0 && xx < mw) { s += zc[y * mw + xx]; c++; } }
			zb[y * mw + x] = s / c;
		}
		for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) {
			let s = 0, c = 0;
			for (let k = -rBlur; k <= rBlur; k++) { const yy = y + k; if (yy >= 0 && yy < mh) { s += zb[yy * mw + x]; c++; } }
			zc[y * mw + x] = s / c;
		}
		const bytes = new Uint8Array(mw * mh * 2);
		for (let i = 0; i < mw * mh; i++) {
			bytes[i * 2] = Math.min(255, a[i] * 340);
			bytes[i * 2 + 1] = zc[i];
		}
		maskTex = maskTex || gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, maskTex);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, mw, mh, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, bytes);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}
	function reset() { t = 0; maskKey = ''; if (!gl) initGL(); }
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		if (!gl) initGL();
		if (!gl) { ctx.fillStyle = '#9cc7f5'; ctx.fillRect(0, 0, W, H); return; }
		buildMask(o);
		const phase = (((t / (o.duration || 12)) % 1) + 1) % 1;
		gl.uniform1f(uni.ph, TAU * phase);
		if (uni.gl2) gl.uniform1f(uni.gl2, glyphFrac); // glyph height as a fraction of canvas height (mask shares the canvas aspect)
		if (uni.sd) gl.uniform1f(uni.sd, (o.cloudSeedM || 0) * 0.137);
		if (uni.tilt) gl.uniform1f(uni.tilt, o.cloudTilt ?? 0.25);
		if (uni.wsp) gl.uniform1f(uni.wsp, o.cloudWisp ?? 0.4);
		if (uni.solid) gl.uniform1f(uni.solid, o.cloudSolid ?? 0);
		if (uni.shad) gl.uniform1f(uni.shad, o.cloudShadow ?? 0.05);
		if (uni.sprd) gl.uniform1f(uni.sprd, o.cloudWispSpread ?? 0.3);
		if (uni.hole) gl.uniform1f(uni.hole, o.cloudVeil ?? 0.35);
		if (uni.tod) gl.uniform1f(uni.tod, o.cloudTime ?? 0.3333);
		if (uni.todt) gl.uniform1f(uni.todt, (o.cloudTimeLink ?? true) ? (o.cloudTime ?? 0.3333) : (o.cloudTimeText ?? 0.3333));
		if (uni.rain) gl.uniform1f(uni.rain, o.cloudRain ?? 0);
		if (uni.snow) gl.uniform1f(uni.snow, o.cloudSnow ?? 0);
		if (uni.fog) gl.uniform1f(uni.fog, o.cloudFog ?? 0);
		if (uni.sun) gl.uniform3f(uni.sun, o.cloudLightX ?? -0.14, 0.3, o.cloudLightZ ?? 0.92);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		ctx.drawImage(glcv, 0, 0);
	}
	return { reset, step, render };
}

// COIN — a REAL 3D scene now: the stadium's two faces are 3D point rings
// (z = +/-depth/2), rotated by a genuine Rodrigues rotation about an
// in-plane diagonal axis, composed with a camera tilt (Rx), and
// orthographically projected. The silhouette is the convex hull of the
// projected solid — the exact outline a webgl-outlines pass would find.
// OUTLINES ONLY, pure #0000ff: silhouette + type, nothing else.
// The spin decelerates INTO each edge-on word-change frame and
// accelerates away (easeInOut per edge-to-edge segment). Tilt and axis
// are functions of the SEGMENT clock, so every transform happens at the
// IDENTICAL pose — same apparent thickness, same bar angle, every time.
// The tilt has a floor: the coin never faces the camera dead-on.
function sceneCoin(env) {
	const { W, H, getOpts } = env;
	let t = 0, words = [], fontCss = '', ph = 0, polys = [], cacheKey = '';
	const inkL = {}; // gradient-ink layer cache (see paintInk)
	function ensure(o) {
		const key = (o.text || '') + '|' + W + 'x' + H;
		if (key === cacheKey) return;
		cacheKey = key;
		words = ((o.text || 'INTERACTIVE DESIGN CONCEPTS').trim().toUpperCase()).split(/\s+/).filter(Boolean);
		if (!words.length) words = ['COIN'];
		const probe = document.createElement('canvas').getContext('2d');
		let fontPx = Math.min(H * 0.18, W * 0.2);
		const fam = "'Google Sans Flex', 'Helvetica Neue', Helvetica, sans-serif";
		probe.font = `500 ${fontPx}px ${fam}`;
		let maxW = 0;
		for (const w of words) maxW = Math.max(maxW, probe.measureText(w).width);
		const targetW = W * 0.72;
		fontPx = fontPx * ((targetW - fontPx * 0.9) / maxW);
		// FIXED default scale: cap at the size a longest-word-like
		// "INTERACTIVE" would produce (~0.17 H), so short words keep the
		// same framing instead of inflating to fill the width; genuinely
		// long words still shrink to fit
		fontPx = Math.min(fontPx, H * 0.17);
		probe.font = `500 ${fontPx}px ${fam}`;
		fontCss = probe.font;
		ph = fontPx * 2.3;
		// PER-WORD pills: each word gets its own width with the SAME side
		// padding, so INTERACTIVE isn't cramped and DESIGN doesn't swim.
		// The width change is invisible: it happens at the edge-on frame,
		// where the silhouette is depth x height regardless of pill width.
		polys = words.map((w) => {
			const pw9 = probe.measureText(w).width + fontPx * 1.15;
			const poly9 = [];
			const r = ph / 2, hw = Math.max(0, pw9 / 2 - r);
			for (let i = 0; i <= 30; i++) { const a = -Math.PI / 2 + (i / 30) * Math.PI; poly9.push([hw + r * Math.cos(a), r * Math.sin(a)]); }
			for (let i = 0; i <= 30; i++) { const a = Math.PI / 2 + (i / 30) * Math.PI; poly9.push([-hw + r * Math.cos(a), r * Math.sin(a)]); }
			return poly9;
		});
	}
	function hull(pts) {
		pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		const cross = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]);
		const lo = [];
		for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
		const up = [];
		for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
		lo.pop(); up.pop();
		return lo.concat(up);
	}
	function reset() { t = 0; cacheKey = ''; }
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		ensure(o);
		paintThemeBg(ctx, o, W, H);
		const n = words.length;
		const phase = (((t / (o.duration || 9)) % 1) + 1) % 1;
		const seg = Math.floor(phase * n), f = phase * n - seg;
		// ASYMMETRIC ease, face-to-face: ACCELERATE for the first third of
		// the flip (quadratic, ~0.5s at default duration), hitting PEAK
		// SPEED exactly at the edge-on frame where the word swaps, then a
		// long quartic DECELERATION (~1s) into the readable face. Velocity
		// is continuous at the junction (no jerk): fast change, slow face.
		// back to the C1-smooth curve (the 45%-floor version had a velocity
		// cliff right after the whip — the sudden unexpected slow-down).
		// Same construction as the version that looked right, with the face
		// drift nudged 15% -> 20% so the face keeps visibly turning, and the
		// junction re-solved so the word-change stays on the whip's peak
		// AND the velocity is continuous through it (p = 14 matches slopes).
		// NEW easing construction: constant CRUISE (0.6 — twice the old face
		// speed) + one raised-cosine WHIP bump mid-segment. The velocity
		// profile is smooth everywhere (the bump's ends land at zero slope,
		// so no cliffs are even possible), the swap sits exactly on the
		// bump's peak, and the cruise floor can be anything without
		// breaking the math: e(0.5) = 0.3 + 4.8*(w/2) = 0.5 precisely.
		// ASYMMETRIC whip: sharp cosine attack (wa), long cosine tail (wd) —
		// it snaps up to speed and then POURS smoothly back into the cruise
		// instead of stopping on a dime. Amplitude and peak position are
		// solved so the total still closes and the swap sits on the apex.
		// EASING v2: cruise + your bezier. The slow "face" rotation runs at
		// a brisker 0.55 (less linger), and the fast transition follows
		// cubic-bezier(0.76, 0, 0.3, 0.89) exactly — evaluated by Newton
		// solve — over a window starting earlier in the flip (0.40..0.72).
		// The bezier starts with zero added velocity (y1 = 0), so it blends
		// off the cruise with no kink.
		const b9 = 0.55, s0 = 0.4, s1 = 0.72, D9 = 1 - b9;
		const bzY = (g) => {
			if (g <= 0) return 0;
			if (g >= 1) return 1;
			// y2 raised 0.89 -> 1.0: the original handle left a residual END
			// slope, so the spin dropped ~30% the instant the bezier landed —
			// the visible seam between words. With y2 = 1 the end tangent is
			// exactly zero: the transition lands ON the cruise, kink-free.
			const x1 = 0.76, x2 = 0.3, y2 = 1.0;
			let t9 = g;
			for (let i = 0; i < 5; i++) {
				const it = 1 - t9;
				const x = 3 * it * it * t9 * x1 + 3 * it * t9 * t9 * x2 + t9 * t9 * t9;
				const dx = 3 * it * it * x1 + 6 * it * t9 * (x2 - x1) + 3 * t9 * t9 * (1 - x2);
				if (Math.abs(dx) < 1e-6) break;
				t9 -= (x - g) / dx;
				if (t9 < 0) t9 = 0; else if (t9 > 1) t9 = 1;
			}
			const it = 1 - t9;
			return 3 * it * t9 * t9 * y2 + t9 * t9 * t9;
		};
		const g9 = (f - s0) / (s1 - s0);
		let e = b9 * f + D9 * bzY(g9);
		// JUICE kept: net-zero sag-and-spring right after the bezier lands
		const uJ0 = s1 + 0.03, uJ1 = Math.min(s1 + 0.22, 0.985);
		if (f > uJ0 && f < uJ1) {
			const wJ = uJ1 - uJ0;
			const aw9 = (0.2 * b9) * wJ / Math.PI; // sag gentled: it was compounding the landing kink
			const sJ = Math.sin(Math.PI * (f - uJ0) / wJ);
			e -= aw9 * sJ * sJ;
		}
		const th = Math.PI * (seg + e); // segment boundaries at FACE-ON
		// PITCH: vertical angle only, never dead-on — oscillating gently
		// around its base (0.13..0.25 rad, never zero, never flipping), so
		// the coin slowly noses up and down as it floats.
		const pitch = 0.38 * Math.sin(TAU * phase + 0.5); // full nose-down THROUGH flat TO nose-up (+/-22 deg) - the sweep crosses zero only in passing, and the extra side view reads as dimension
		const cp = Math.cos(pitch), sp = Math.sin(pitch);
		const c9 = Math.cos(th), s9 = -Math.sin(th); // negated sine = spin the OTHER way
		// M = Rx(pitch) * Ry(th) — clean vertical-axis flip, pitched camera
		const M = [
			[c9, 0, s9],
			[sp * s9, cp, -sp * c9],
			[-cp * s9, sp, cp * c9]
		];
		const depth = Math.min(W, H) * 0.2; // properly THICK
		// float: two soft superposed bobs — ever so slight, organic
		// float components at 3 + 6 cycles/loop = whole cycles PER WORD
		// SEGMENT: every word rides the identical bob arc during its face
		// window (INTERACTIVE was owning the trough of the old 1-cycle bob,
		// sitting visibly lower than the others). Amplitudes trimmed so the
		// full arc fits inside the 0.18 floor without the guard clipping it.
		const cx = W / 2, cy = H / 2 + H * (0.034 * Math.sin(TAU * n * phase + 1.0) + 0.012 * Math.sin(TAU * 2 * n * phase + 3.1));
		const proj = (x, y, z) => [
			cx + M[0][0] * x + M[0][1] * y + M[0][2] * z,
			cy + M[1][0] * x + M[1][1] * y + M[1][2] * z
		];
		const wi9 = ((Math.floor(th / Math.PI + 0.5) % n) + n) % n;
		// FORM MORPH: the pill breathes from this word's width to the next
		// word's across a short smoothstep window centred on the whip
		// (~2*wa of the flip, ~8 frames at default speed) — the width
		// change rides inside the fastest motion instead of popping at the
		// swap (with pitch, the rim makes an instant change faintly visible)
		const pA9 = polys[((seg % n) + n) % n], pB9 = polys[(((seg + 1) % n) + n) % n];
		// the morph is pinned to the ROTATION ANGLE around edge-on: it only
		// runs while the pill is within ~28deg of side-to-camera (where the
		// face is foreshortened past ~50% and width is nearly unreadable),
		// centred on the swap. Angle-driven = it inherits the whip's easing
		// automatically AND hides the shape change behind the rim.
		const wAng = 0.48; // radians either side of edge-on
		const d9 = th - Math.PI * (seg + 0.5);
		let mm9 = (d9 + wAng) / (2 * wAng);
		mm9 = mm9 < 0 ? 0 : mm9 > 1 ? 1 : mm9 * mm9 * (3 - 2 * mm9);
		const pts = [];
		for (let i = 0; i < pA9.length; i++) {
			const x9 = pA9[i][0] + (pB9[i][0] - pA9[i][0]) * mm9;
			const y9 = pA9[i][1] + (pB9[i][1] - pA9[i][1]) * mm9;
			pts.push(proj(x9, y9, depth / 2)); pts.push(proj(x9, y9, -depth / 2));
		}
		const lw = Math.max(1.2, W * 0.0028);
		const hu = hull(pts);
		// EDGE GUARD: wide pills swing further vertically when pitched, so
		// the bounce could kiss the frame. Measure the real silhouette and
		// shift the whole coin to keep a margin — smooth, since the
		// geometry (and thus the shift) evolves continuously.
		let maxY9 = -1e9, minY9 = 1e9;
		for (const p of hu) { if (p[1] > maxY9) maxY9 = p[1]; if (p[1] < minY9) minY9 = p[1]; }
		// asymmetric margins: a roomier floor lifts the low bounce (the wide
		// pill was still grazing), while the ceiling stays close. The floor
		// is a SOFT cushion: the corrective shift fades in quadratically
		// across a band around the margin (C1 — no slope kink), so the wide
		// word's rescue blends into the sine arc instead of nudging suddenly.
		const mgnT = H * 0.04, mgnB = H * 0.18, band9 = H * 0.05;
		const pen9 = maxY9 - (H - mgnB);
		let shY = pen9 <= -band9 ? 0 : pen9 >= band9 ? -pen9 : -((pen9 + band9) * (pen9 + band9)) / (4 * band9);
		if (minY9 + shY < mgnT) shY = mgnT - minY9; // ceiling stays a hard stop (rarely hit)
		// the word rides the FRONT face (z' > 0), never mirrored: if the
		// back face is toward the camera, flip the face's local x-basis
		const nz = M[2][2]; // face normal's screen-z
		const fs = nz >= 0 ? 1 : -1;
		const e1 = [M[0][0] * fs, M[1][0] * fs];
		const e2 = [M[0][1], M[1][1]];
		const C = proj(0, 0, fs * depth / 2);
		const det = e1[0] * e2[1] - e1[1] * e2[0];
		// solid/gradient body: fill the silhouette with its own paint BEFORE
		// the ink pass (on the main ctx — the ink's gradient mask must not
		// recolour it), so the coin reads as an opaque pill on a transparent
		// backdrop ('auto' → no fill: wireframe straight on the bg, as ever)
		const body = bodyFill(ctx, o, W, H, phase, null);
		if (body) {
			ctx.fillStyle = body;
			ctx.beginPath();
			ctx.moveTo(hu[0][0], hu[0][1] + shY);
			for (let i = 1; i < hu.length; i++) ctx.lineTo(hu[i][0], hu[i][1] + shY);
			ctx.closePath();
			ctx.fill();
		}
		const drawInk = (c, ink) => {
			c.lineWidth = lw;
			c.lineJoin = 'round'; c.lineCap = 'round';
			c.strokeStyle = ink;
			c.beginPath();
			c.moveTo(hu[0][0], hu[0][1] + shY);
			for (let i = 1; i < hu.length; i++) c.lineTo(hu[i][0], hu[i][1] + shY);
			c.closePath();
			c.stroke();
			if (Math.abs(det) > 0.015) {
				c.save();
				c.setTransform(e1[0], e1[1], e2[0], e2[1], C[0], C[1] + shY);
				c.font = fontCss;
				c.fillStyle = ink;
				c.textAlign = 'center'; c.textBaseline = 'middle';
				c.fillText(words[wi9], 0, 0);
				c.restore();
			}
		};
		paintInk(ctx, drawInk, o, W, H, phase, inkL);
	}
	return { reset, step, render };
}

// Sphere — the Coin lockup mapped onto a slowly turning globe. Each
// space-separated word is its own line of latitude (spacebar = newline, as in
// Clouds), and the whole phrase repeats around the globe as ONE aligned
// lockup — a shared repeat count, every line on the same longitudes. The sphere
// turns rigidly — exactly one revolution per loop under a FIXED camera (no
// wobble), so the GIF closes seamlessly. The sphere is OPAQUE:
// the disc is filled with the bg colour (so it reads as a solid object even
// over gradient backdrops) and only front-hemisphere glyphs draw. The camera
// sits ABOVE the globe — negative tilt pitches the north pole toward view —
// and the rim circle is the only other ink: Coin's line-art economy.
function sceneSphere(env) {
	const { W, H, getOpts } = env;
	let t = 0, cacheKey = '', fontCss = '', lines = [], R = 1;
	const inkL = {}; // gradient-ink layer cache (see paintInk)
	function ensure(o) {
		const key = (o.text || '') + '|' + W + 'x' + H;
		if (key === cacheKey) return;
		cacheKey = key;
		const words = ((o.text || 'INTERACTIVE DESIGN CONCEPTS').trim().toUpperCase()).split(/\s+/).filter(Boolean);
		if (!words.length) words.push('SPHERE');
		R = Math.min(W, H) * 0.38;
		const probe = document.createElement('canvas').getContext('2d');
		const fam = "'Google Sans Flex', 'Helvetica Neue', Helvetica, sans-serif";
		probe.font = '500 100px ' + fam;
		const w100 = words.map((w) => probe.measureText(w).width);
		const n = words.length;
		const maxLat = 0.92; // line stack stays within ±53°, where parallels are still roomy
		// Font caps: Coin-ish base size, the line stack inside ±maxLat, and the
		// longest word around the worst-case (shortest) parallel it could sit on.
		let fontPx = Math.min(
			R * 0.3,
			(2 * maxLat * R) / (1.38 * Math.max(n - 1, 1)),
			(TAU * R * Math.cos(maxLat) * 0.9 * 100) / Math.max(...w100)
		);
		// Second pass with REAL latitudes: each line only needs its own
		// parallel (the worst-case bound over-shrinks equator lines). Shrinking
		// fontPx also shrinks latStep, so one pass is conservative-safe.
		let latStep = (fontPx * 1.38) / R;
		for (let li = 0; li < n; li++) {
			const lat = (li - (n - 1) / 2) * latStep;
			const room = TAU * R * Math.cos(lat) * 0.9;
			const need = fontPx * (w100[li] / 100 + 1.1);
			if (need > room) fontPx *= room / need;
		}
		latStep = (fontPx * 1.38) / R;
		probe.font = `500 ${fontPx}px ${fam}`;
		fontCss = probe.font;
		// The PHRASE repeats as one unit: a single repeat count shared by every
		// line (the most the tightest line allows), all lines aligned to the
		// same longitudes — per-line counts left each parallel tiling on its
		// own rhythm, which shredded the lockup.
		let K = 12;
		for (let li = 0; li < n; li++) {
			const lat = (li - (n - 1) / 2) * latStep;
			const span = (fontPx * (w100[li] / 100 + 1.1)) / (R * Math.cos(lat));
			K = Math.min(K, Math.floor(TAU / span));
		}
		K = Math.max(1, K);
		lines = words.map((word, li) => {
			const lat = (li - (n - 1) / 2) * latStep; // y-down: first word on top
			const cosL = Math.cos(lat);
			const glyphs = Array.from(word);
			const gw2 = glyphs.map((g) => probe.measureText(g).width);
			let x = -gw2.reduce((s, w) => s + w, 0) / 2;
			const offs = gw2.map((w) => { const c = x + w / 2; x += w; return c; });
			return { lat, cosL, k: K, glyphs, offs };
		});
	}
	function reset() { t = 0; cacheKey = ''; }
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		ensure(o);
		const solidBg = paintThemeBg(ctx, o, W, H);
		const phase = (((t / (o.duration || 9)) % 1) + 1) % 1;
		const spin = TAU * phase; // one revolution per loop — seamless
		// Fixed camera, simple orbit — the only motion is the spin. The panel's
		// Camera angle slider is in degrees, POSITIVE = above the globe looking
		// down (hence the sign flip into y-down sphere coords).
		const tilt = (-(o.sphereTilt ?? 10) * Math.PI) / 180;
		const ct = Math.cos(tilt), st = Math.sin(tilt);
		// M = Rx(tilt), applied to y-down sphere coords
		const M = [
			[1, 0, 0],
			[0, ct, -st],
			[0, st, ct]
		];
		const mul = (x, y, z) => [
			M[0][0] * x + M[0][1] * y + M[0][2] * z,
			M[1][0] * x + M[1][1] * y + M[1][2] * z,
			M[2][0] * x + M[2][1] * y + M[2][2] * z
		];
		const cx = W / 2, cy = H / 2;
		// Each glyph is a flat billboard on its tangent plane: local x along the
		// east tangent, local y along the down tangent, both orthographically
		// projected — text bends around the sphere and foreshortens toward the
		// rim for free, exactly like Coin's face text under setTransform.
		const drawPass = (c) => {
			for (const L of lines) {
				const sinLat = Math.sin(L.lat), cosL = L.cosL;
				for (let r = 0; r < L.k; r++) {
					const lon0 = spin + (TAU * r) / L.k;
					for (let gi = 0; gi < L.glyphs.length; gi++) {
						const lon = lon0 + L.offs[gi] / (R * cosL);
						const sinLo = Math.sin(lon), cosLo = Math.cos(lon);
						const u = mul(cosL * sinLo, sinLat, cosL * cosLo);
						if (u[2] <= 0.04) continue; // back hemisphere — hidden
						const east = mul(cosLo, 0, -sinLo);
						const down = mul(-sinLat * sinLo, cosL, -sinLat * cosLo);
						if (Math.abs(east[0] * down[1] - east[1] * down[0]) < 0.03) continue;
						// rim fade so glyphs melt out instead of popping off the edge
						c.globalAlpha = Math.min(1, (u[2] - 0.04) / 0.2);
						c.setTransform(east[0], east[1], down[0], down[1], cx + u[0] * R, cy + u[1] * R);
						c.fillText(L.glyphs[gi], 0, 0);
					}
				}
			}
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.globalAlpha = 1;
		};
		// body: solid/gradient fills the disc with its own paint (so the globe
		// can be an opaque object on a transparent backdrop); 'auto' matches the
		// theme bg — which means hollow (rim + text only) on transparent
		const body = bodyFill(ctx, o, W, H, phase, solidBg);
		if (body) {
			ctx.fillStyle = body;
			ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
		}
		const drawInk = (c, ink) => {
			c.lineWidth = Math.max(1.2, W * 0.0028); // Coin's hairline
			c.strokeStyle = ink;
			c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
			c.font = fontCss;
			c.textAlign = 'center'; c.textBaseline = 'middle';
			c.fillStyle = ink;
			drawPass(c);
		};
		paintInk(ctx, drawInk, o, W, H, phase, inkL);
	}
	return { reset, step, render };
}

// Liquid Metal — molten chrome typography. The text (spacebar = newline, as
// in Clouds) is blurred into a smooth heightfield; a WebGL shader shades it
// as liquid metal: screen-space normals, then a one-bounce "raytrace" — the
// reflected eye ray samples a procedural environment map (blue sky / sunset /
// forest) — plus fresnel rim and a hot studio glint. GPU-fast at any export
// size. Ripples and a subtle domain wobble use INTEGER wave counts of the
// loop phase, so the liquid crawls seamlessly. Background light / dark /
// transparent (premultiplied alpha straight out of the shader).
function sceneMetal(env) {
	const { W, H, getOpts } = env;
	let t = 0, glcv = null, gl = null, uni = null, maskTex = null, maskKey = '', failed = false;
	const VS = `attribute vec2 aP; varying vec2 vUv; void main(){ vUv = aP*0.5+0.5; gl_Position = vec4(aP,0.,1.); }`;
	const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uMask; // R = goo silhouette, G = stroke-tube distance, B = local ink mass
uniform vec2 uRes;
uniform float uPh, uRip, uEnvK, uMode; // uMode: 0 = solid bg, 1 = transparent
uniform float uBulge, uNoise, uBlob, uFlow;
uniform vec3 uBg;

// terminal-ness: inside the ink but with LOW surrounding mass = stroke ends
// and outer extremities — where a real liquid gathers and beads
float termQ(vec4 tx){ return smoothstep(0.5, 0.18, tx.b) * smoothstep(0.2, 0.42, tx.r); }
float swellAt(vec4 tx, vec2 uv){
	return termQ(tx) * (0.5 + 0.5 * sin(uPh * 2.0 + uv.x * 9.0 + uv.y * 5.0)) * uFlow;
}

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
	vec2 i = floor(p), f = fract(p);
	vec2 u = f*f*(3.0-2.0*f);
	return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.13)*0.28 + vnoise(p*4.41)*0.17; }

// Metaball droplets — the blob-family trick: gaussian balls on loop-locked
// orbits (integer laps per revolution) around the text band. Their field
// ADDS to the letter field before thresholding, so a droplet nearing a
// glyph necks into it and fuses, metaball-style.
float blobField(vec2 uv){
	if (uBlob < 0.01) return 0.0;
	float ar = uRes.x / uRes.y;
	float s = 0.0;
	for (int i = 0; i < 6; i++) {
		float fi = float(i);
		float k = 1.0 + mod(fi, 2.0);             // 1 or 2 laps per loop
		float ph = uPh * k + fi * 2.399;
		vec2 c = vec2(0.16 + 0.68 * fract(fi * 0.618 + 0.21),
		              0.5 + (fract(fi * 0.317 + 0.11) - 0.5) * 0.44)
		       + vec2(cos(ph), sin(ph)) * vec2(0.11, 0.15) * (0.6 + 0.5 * fract(fi * 0.83));
		vec2 d = (uv - c) * vec2(ar, 1.0);
		float r = (0.024 + 0.03 * fract(fi * 0.53)) * (0.55 + uBlob * 0.9);
		s += exp(-dot(d, d) / (r * r));
	}
	return s * uBlob;
}

// height = rounded letter body + dome bulge + terminal swell + noise + ripples
float hgt(vec2 uv){
	vec4 tx = texture2D(uMask, uv);
	float bf = blobField(uv);
	float sw = swellAt(tx, uv);
	float body = smoothstep(0.12, 0.62, tx.r + bf + sw * 0.22);
	// Bulge: the distance-transform tube channel crests along each stroke's
	// centreline — taller and rounder right where the letter is; droplets
	// bring their own gaussian dome; swelling terminals rise like beads
	float h = body * (1.0 + uBulge * (tx.g * 1.1 + min(bf, 1.2) * 0.5) + sw * 0.9);
	// drifting grain — the drift orbit is circular in uPh, so it loops
	h += (fbm(uv * 34.0 + vec2(cos(uPh), sin(uPh)) * 0.08) - 0.5) * uNoise * 0.22 * body;
	float r = sin(uv.x*44.0 + uv.y*17.0 + uPh*2.0)
	        + sin(uv.x*21.0 - uv.y*33.0 - uPh)
	        + sin(uv.y*29.0 + uv.x*9.0 + uPh*3.0);
	return h + r * 0.014 * uRip * body;
}

vec3 envMap(vec3 d){
	float el = clamp(d.y, -1.0, 1.0); // +1 = zenith
	float az = atan(d.x, d.z);
	if (uEnvK < 0.5) {
		// BLUE SKY: zenith blue to bright horizon, soft cumulus, warm ground
		vec3 c = mix(vec3(0.98, 0.99, 1.0), vec3(0.18, 0.44, 0.94), smoothstep(-0.05, 0.75, el));
		float cl = fbm(vec2(az*1.6, el*3.0 + 7.0));
		c = mix(c, vec3(1.0), smoothstep(0.55, 0.8, cl) * smoothstep(0.0, 0.35, el) * 0.9);
		return mix(vec3(0.72, 0.66, 0.58), c, smoothstep(-0.35, -0.02, el));
	} else if (uEnvK < 1.5) {
		// SUNSET: violet dome, molten orange horizon band, sun bloom
		vec3 c = mix(vec3(1.0, 0.52, 0.16), vec3(0.26, 0.1, 0.42), smoothstep(0.0, 0.8, el));
		c = mix(vec3(1.0, 0.86, 0.5), c, smoothstep(0.0, 0.22, abs(el - 0.04)));
		float sun = pow(max(0.0, cos(az - 0.7)) * max(0.0, 1.0 - abs(el - 0.06) * 7.0), 24.0);
		c += vec3(1.0, 0.8, 0.45) * sun * 1.6;
		return mix(vec3(0.12, 0.05, 0.1), c, smoothstep(-0.4, -0.02, el));
	}
	// FOREST: pale sky over an azimuth-varying treeline, layered leaf greens
	vec3 sky = mix(vec3(0.85, 0.93, 0.98), vec3(0.55, 0.75, 0.95), smoothstep(0.1, 0.8, el));
	float tl = fbm(vec2(az*3.2, 3.3)) * 0.22 + 0.08;
	float below = smoothstep(tl + 0.03, tl - 0.06, el);
	vec3 trees = mix(vec3(0.04, 0.13, 0.05), vec3(0.32, 0.52, 0.2), fbm(vec2(az*5.0, el*7.0)));
	return mix(sky, trees, below);
}

void main(){
	// gentle domain wobble -> the letters themselves slosh (loop-locked)
	vec2 uv = vUv + vec2(sin(vUv.y*9.0 + uPh), cos(vUv.x*7.0 + uPh)) * (0.004 * uRip + 0.004 * uFlow);
	// LIQUID FLOW: peristaltic width-waves travelling ALONG each stroke —
	// the tube channel's gradient gives the across-stroke axis, so straight
	// runs visibly stretch and neck while the wave streams down them
	vec4 t0 = texture2D(uMask, uv);
	if (uFlow > 0.005) {
		// wide-baseline gradient = smooth tangents (a tight baseline made the
		// direction field noisy at junctions -> ragged edges)
		vec2 e2 = vec2(5.0) / uRes;
		vec2 gv = vec2(texture2D(uMask, uv + vec2(e2.x, 0.0)).g - texture2D(uMask, uv - vec2(e2.x, 0.0)).g,
		               texture2D(uMask, uv + vec2(0.0, e2.y)).g - texture2D(uMask, uv - vec2(0.0, e2.y)).g);
		float gl2 = length(gv);
		if (gl2 > 3e-2) {
			vec2 nrm = gv / gl2;
			vec2 tang = vec2(-nrm.y, nrm.x);
			uv += nrm * sin(dot(uv, tang) * 28.0 + uPh * 2.0) * 0.005 * uFlow * smoothstep(0.05, 0.5, t0.g);
		}
	}
	vec4 tm = texture2D(uMask, uv);
	float m = tm.r + swellAt(tm, uv) * 0.22 + blobField(uv);
	float a = smoothstep(0.36, 0.52, m);
	if (a < 0.004) {
		gl_FragColor = (uMode > 0.5) ? vec4(0.0) : vec4(uBg, 1.0);
		return;
	}
	vec2 e = vec2(1.4) / uRes;
	float hx = hgt(uv + vec2(e.x, 0.0)) - hgt(uv - vec2(e.x, 0.0));
	float hy = hgt(uv + vec2(0.0, e.y)) - hgt(uv - vec2(0.0, e.y));
	vec3 n = normalize(vec3(vec2(-hx, -hy) * 9.0, 1.0));
	// one-bounce raytrace: reflect the (orthographic) eye ray off the surface
	vec3 r = vec3(2.0 * n.z * n.x, 2.0 * n.z * n.y, 2.0 * n.z * n.z - 1.0);
	vec3 col = envMap(normalize(r));
	float fr = pow(1.0 - n.z, 3.0);          // fresnel rim = the chrome edge pop
	col = col * (0.86 + fr * 0.5) + fr * 0.18;
	float sp = pow(max(dot(normalize(r), normalize(vec3(0.35, 0.75, 0.4))), 0.0), 60.0);
	col += sp * 0.9;                          // hot studio glint
	col = pow(col, vec3(0.92));
	gl_FragColor = (uMode > 0.5) ? vec4(col * a, a) : vec4(mix(uBg, col, a), 1.0);
}`;
	function initGL() {
		glcv = document.createElement('canvas');
		glcv.width = W; glcv.height = H;
		gl = glcv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
		if (!gl) { failed = true; return; }
		const mk = (ty, s) => { const sh = gl.createShader(ty); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
		const prog = gl.createProgram();
		gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
		gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
		gl.useProgram(prog);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(prog, 'aP');
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		uni = {
			ph: gl.getUniformLocation(prog, 'uPh'), rip: gl.getUniformLocation(prog, 'uRip'),
			envk: gl.getUniformLocation(prog, 'uEnvK'), mode: gl.getUniformLocation(prog, 'uMode'),
			bg: gl.getUniformLocation(prog, 'uBg'),
			bulge: gl.getUniformLocation(prog, 'uBulge'), noise: gl.getUniformLocation(prog, 'uNoise'),
			blob: gl.getUniformLocation(prog, 'uBlob'), flow: gl.getUniformLocation(prog, 'uFlow')
		};
		gl.uniform1i(gl.getUniformLocation(prog, 'uMask'), 0);
		gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), W, H);
		maskTex = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.viewport(0, 0, W, H);
	}
	function buildMask(o) {
		const key = (o.text || '') + '|' + W + 'x' + H + '|' + (o.metalGoo ?? 0.5);
		if (key === maskKey || !gl) return;
		maskKey = key;
		const mw = 1024, mh = Math.max(2, Math.round(mw * H / W));
		const mcv = document.createElement('canvas'); mcv.width = mw; mcv.height = mh;
		const mx = mcv.getContext('2d');
		mx.fillStyle = '#000'; mx.fillRect(0, 0, mw, mh);
		const words = ((o.text || 'LIQUID METAL').trim().toUpperCase()).split(/\s+/).filter(Boolean);
		let fontPx = mh * 0.3;
		const fam = "'Google Sans Flex', 'Helvetica Neue', sans-serif";
		mx.font = `800 ${fontPx}px ${fam}`;
		let maxW = 0;
		for (const w of words) maxW = Math.max(maxW, mx.measureText(w).width);
		fontPx = Math.min(fontPx * (mw * 0.86) / maxW, (mh * 0.8) / (Math.max(words.length, 1) * 1.12));
		mx.font = `800 ${fontPx}px ${fam}`;
		mx.fillStyle = '#fff'; mx.textAlign = 'center'; mx.textBaseline = 'middle';
		const lineH = fontPx * 1.12, y0 = mh / 2 - (lineH * words.length) / 2 + lineH / 2;
		for (let i = 0; i < words.length; i++) mx.fillText(words[i], mw / 2, y0 + i * lineH);
		// blur = the rounded liquid height profile (and the gooey silhouette)
		const bcv = document.createElement('canvas'); bcv.width = mw; bcv.height = mh;
		const bx = bcv.getContext('2d');
		// Goo = the melt radius: low keeps letterforms crisp-ish, high fuses
		// neighbouring glyphs into one mercury puddle
		bx.filter = `blur(${Math.max(2, fontPx * (0.03 + (o.metalGoo ?? 0.5) * 0.11))}px)`;
		bx.drawImage(mcv, 0, 0);
		// second channel: interior DISTANCE TRANSFORM of the crisp glyphs
		// (two-pass chamfer) shaped into a rounded tube — the Bulge dome
		// follows the letterforms, cresting along each stroke's centreline
		// instead of the old wide blur's whole-word swell
		const td = mx.getImageData(0, 0, mw, mh).data;
		const dist = new Float32Array(mw * mh);
		for (let i = 0; i < mw * mh; i++) dist[i] = td[i * 4] > 127 ? 1e9 : 0;
		for (let y = 0; y < mh; y++) {
			for (let x = 0; x < mw; x++) {
				const i = y * mw + x;
				let d = dist[i];
				if (d === 0) continue;
				if (x > 0) d = Math.min(d, dist[i - 1] + 1);
				if (y > 0) {
					d = Math.min(d, dist[i - mw] + 1);
					if (x > 0) d = Math.min(d, dist[i - mw - 1] + 1.41421356);
					if (x < mw - 1) d = Math.min(d, dist[i - mw + 1] + 1.41421356);
				}
				dist[i] = d;
			}
		}
		for (let y = mh - 1; y >= 0; y--) {
			for (let x = mw - 1; x >= 0; x--) {
				const i = y * mw + x;
				let d = dist[i];
				if (x < mw - 1) d = Math.min(d, dist[i + 1] + 1);
				if (y < mh - 1) {
					d = Math.min(d, dist[i + mw] + 1);
					if (x < mw - 1) d = Math.min(d, dist[i + mw + 1] + 1.41421356);
					if (x > 0) d = Math.min(d, dist[i + mw - 1] + 1.41421356);
				}
				dist[i] = d;
			}
		}
		// third channel: LOCAL INK MASS (a wide blur) — stroke terminals and
		// outer extremities have less ink around them than mid-stroke, which
		// is how the shader finds where the liquid should gather and bead
		const gcv = document.createElement('canvas'); gcv.width = mw; gcv.height = mh;
		const gx2 = gcv.getContext('2d');
		gx2.filter = `blur(${fontPx * 0.3}px)`;
		gx2.drawImage(mcv, 0, 0);
		const md2 = gx2.getImageData(0, 0, mw, mh).data;
		const sd2 = bx.getImageData(0, 0, mw, mh).data;
		const pack = bx.createImageData(mw, mh);
		// rounded-tube cross-section: sin ramps steeply off the edge and
		// flattens at the crest (zero slope) — half-width ≈ the stroke's
		const dmax = fontPx * 0.16;
		for (let i = 0; i < mw * mh; i++) {
			pack.data[i * 4] = sd2[i * 4];
			pack.data[i * 4 + 1] = Math.round(Math.sin(Math.min(dist[i] / dmax, 1) * Math.PI / 2) * 255);
			pack.data[i * 4 + 2] = md2[i * 4];
			pack.data[i * 4 + 3] = 255;
		}
		bx.putImageData(pack, 0, 0);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.bindTexture(gl.TEXTURE_2D, maskTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bcv);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}
	function reset() { t = 0; maskKey = ''; }
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		if (!gl && !failed) { try { initGL(); } catch { failed = true; gl = null; } }
		if (!gl) {
			// no-WebGL fallback: flat type so the mode still shows something
			paintThemeBg(ctx, o, W, H);
			ctx.fillStyle = '#9aa0a6';
			drawFittedText(ctx, o.text || 'LIQUID METAL', W, H, H * (o.fontFrac || 0.3), o.fontFamily, 800, o.hasStretch);
			return;
		}
		buildMask(o);
		const phase = (((t / (o.duration || 8)) % 1) + 1) % 1;
		const transparent = o.coinBg === 'transparent';
		const bg = o.coinBg === 'dark' ? [0.05, 0.05, 0.06] : [0.955, 0.95, 0.935];
		gl.uniform1f(uni.ph, TAU * phase);
		gl.uniform1f(uni.rip, o.metalRipple ?? 0.5);
		gl.uniform1f(uni.bulge, o.metalBulge ?? 0.5);
		gl.uniform1f(uni.noise, o.metalNoise ?? 0);
		gl.uniform1f(uni.blob, o.metalBlobs ?? 0);
		gl.uniform1f(uni.flow, o.metalFlow ?? 0.5);
		gl.uniform1f(uni.envk, { sky: 0, sunset: 1, forest: 2 }[o.metalEnv] ?? 0);
		gl.uniform1f(uni.mode, transparent ? 1 : 0);
		gl.uniform3f(uni.bg, bg[0], bg[1], bg[2]);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		ctx.clearRect(0, 0, W, H);
		ctx.drawImage(glcv, 0, 0);
	}
	return { reset, step, render };
}

// Type Orbit — three.js: extruded ALL-CAPS letters on a turning sphere.
// The flow is word→word, Slack of dead air: during each segment's SWAP
// window the incoming word's letters whip out of orbit into a lockup while
// the outgoing word's letters pour back — they pass each other mid-air —
// and every OTHER letter simultaneously morphs to a fresh Fibonacci lattice
// of the remaining count, so the sphere always reads evenly filled.
// The lockup is anchored IN SPHERE SPACE: it finishes assembly facing the
// camera, rides the rotation, and its letters finish leaving exactly as it
// reaches 90° (perpendicular). Letters are assigned lattice slots in
// word-interleaved order, so no word ever occupies one patch of the sphere.
// Segment rotation is a quarter-turn whose orientation resets inside each
// swap morph — so the loop closes seamlessly for any word count.
// Whip easing = Coin's cubic-bezier(0.76, 0, 0.3, 1). Colours ride the
// standard pickers (black bg / white type set on mode entry).
function sceneTypeOrb(env) {
	const { W, H, getOpts } = env;
	let t = 0, failed = false, loading = false;
	let T = null, initP = null;
	let buildKey = '';

	// Swap-whip easing: a full cubic-bezier, Newton-solved. Default
	// (0.28, 0, 0.1, 1): the "beautiful glide" — quick launch, then nearly
	// half the flight spent floating into place (the normalized shape the
	// stretched entry flights had: windup-compressed 0.65 → 0.28).
	// Panel's Easing controls override it live via o.orbBez = [x1,y1,x2,y2].
	function bez(g, x1, y1, x2, y2) {
		if (g <= 0) return 0;
		if (g >= 1) return 1;
		let u = g;
		for (let i = 0; i < 5; i++) {
			const iu = 1 - u;
			const x = 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u;
			const dx = 3 * iu * iu * x1 + 6 * iu * u * (x2 - x1) + 3 * u * u * (1 - x2);
			if (Math.abs(dx) < 1e-6) break;
			u -= (x - g) / dx;
			if (u < 0) u = 0; else if (u > 1) u = 1;
		}
		const iu = 1 - u;
		return 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u;
	}

	// Fibonacci-lattice slot i of n on the unit sphere — always even
	function slot(i, n) {
		const y = 1 - (2 * (i + 0.5)) / Math.max(1, n);
		const r = Math.sqrt(Math.max(0, 1 - y * y));
		const th = i * 2.399963229728653;
		return [Math.cos(th) * r, y, Math.sin(th) * r];
	}

	async function init() {
		loading = true;
		try {
			const THREE = await import('three');
			const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js');
			const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
			const fontJson = await fetch('/fonts/helvetiker_bold.typeface.json').then((r) => r.json());
			const font = new FontLoader().parse(fontJson);
			const glcv = document.createElement('canvas');
			glcv.width = W; glcv.height = H;
			const renderer = new THREE.WebGLRenderer({ canvas: glcv, antialias: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(W, H, false);
			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
			camera.position.set(0, 0, 8.4);
			scene.add(new THREE.AmbientLight(0xffffff, 0.55));
			const key = new THREE.DirectionalLight(0xffffff, 1.6);
			key.position.set(2, 3, 4);
			scene.add(key);
			const rim = new THREE.DirectionalLight(0xffffff, 0.5);
			rim.position.set(-3, -1, -2);
			scene.add(rim);
			// UNLIT: letters render as flat solid colour (no shading at all)
			const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
			T = { THREE, TextGeometry, renderer, scene, camera, mat, font, glcv, letters: [], v: null };
		} catch (e) {
			console.warn('[typeorb] three init failed', e);
			failed = true;
		}
		loading = false;
	}

	function build(o) {
		const key = (o.text || '') + '|' + W + 'x' + H + '|' + (o.orbSize ?? 1);
		if (!T || key === buildKey) return;
		buildKey = key;
		for (const L of T.letters) { T.scene.remove(L.mesh); L.mesh.geometry.dispose(); }
		T.letters = [];
		// GROUPS: with a `|` anywhere in the text, `|` is the transition
		// delimiter instead of space — everything between pipes displays as
		// ONE unit (internal spaces become gaps in the lockup). Without a
		// pipe, each space-separated word is its own unit, as before.
		const raw = (o.text || 'ORBIT TYPE').trim().toUpperCase();
		// "|" splits the text into display GROUPS (each group shows at once);
		// "/" inside a group forces a line break after the word before it.
		const words = (raw.includes('|')
			? raw.split('|').map((g) => g.trim().replace(/\s+/g, ' '))
			: raw.split(/\s+/)
		).filter((g) => g.replace(/\//g, '').trim().length);
		if (!words.length) words.push('ORBIT');
		const glyphCount = words.join('').replace(/[ /]/g, '').length;
		// requested size (slider) — capped below so the widest group always
		// fits the sphere's usable chord instead of escaping the frame
		let sizeMul = o.orbSize ?? 1;
		if (T.fitCap && T.fitCapKey === raw) sizeMul = Math.min(sizeMul, T.fitCap);
		const size = Math.max(0.12, 0.46 - glyphCount * 0.004) * sizeMul;
		let li = 0;
		const occCount = {};                  // per-character occurrence counter
		const byWord = words.map(() => []);   // glyph letters only (sphere slots)
		const layout = words.map(() => []);   // glyphs + space gaps (lockup layout)
		words.forEach((w, wi) => {
			for (const ch of w) {
				if (ch === ' ') { layout[wi].push({ space: size * 0.62 }); continue; }
				if (ch === '/') { layout[wi].push({ br: true }); continue; }
				const geo = new T.TextGeometry(ch, {
					font: T.font, size, depth: size * 0.049, curveSegments: 6,
					bevelEnabled: true, bevelThickness: size * 0.035, bevelSize: size * 0.02, bevelSegments: 2
				});
				geo.center();
				geo.computeBoundingBox();
				const mesh = new T.THREE.Mesh(geo, T.mat);
				T.scene.add(mesh);
				const occ = occCount[ch] = (occCount[ch] || 0) + 1;
				const L = { mesh, ch, wi, i: li++, occ, w: geo.boundingBox.max.x - geo.boundingBox.min.x };
				T.letters.push(L);
				byWord[wi].push(L);
				layout[wi].push(L);
			}
		});
		T.words = words;
		T.layout = layout;
		// WORD-INTERLEAVED lattice order: one letter from each word in turn,
		// so every word's letters spread across the entire sphere instead of
		// clustering in one band (lattice indices sweep top→bottom).
		const order = [];
		for (let round = 0, more = true; more; round++) {
			more = false;
			for (const list of byWord) {
				if (round < list.length) { order.push(list[round]); more = true; }
			}
		}
		// Per segment k the ORBIT SET is every letter except word k, laid on a
		// fresh even lattice of that count — the redistribution you see during
		// each swap. segIdx[k]: letterIdx → { j, m }.
		T.segIdx = words.map((_, k) => {
			const list = order.filter((L) => L.wi !== k);
			const map = new Map();
			list.forEach((L, j) => map.set(L.i, { j, m: list.length }));
			return map;
		});
		// lockup layout per group: max TWO words per line, lines stacked and
		// centred (multi-word pipe groups wrap instead of running wide)
		const GAP0 = 0.12 * (o.orbSize ?? 1);
		const lineH = size * 1.5;
		T.wordX = [];
		T.wordRaw = [];
		for (const list of layout) {
			// split the entry list into words at the space markers; a `/`
			// break marker flags the preceding word to end its line
			const wordsIn = [[]];
			for (const E of list) {
				if (E.br) {
					// the break belongs to the PRECEDING word — if a space
					// already closed it, reach back one (「WORD / NEXT」)
					const curW = wordsIn.at(-1);
					const target = curW.length ? curW : wordsIn[wordsIn.length - 2];
					if (target) target.br = true;
					if (curW.length) wordsIn.push([]);
				}
				else if (E.space != null) { if (wordsIn.at(-1).length) wordsIn.push([]); }
				else wordsIn.at(-1).push(E);
			}
			if (!wordsIn.at(-1).length) wordsIn.pop();
			// chunk into lines: max 2 words per line; a word longer than 10
			// glyphs OR a `/` break closes its line — auto-wraps that would
			// happen anyway still happen, `/` only ADDS breaks
			const lines = [];
			let cur = [];
			for (const w2 of wordsIn) {
				cur.push(w2);
				if (cur.length === 2 || w2.length > 10 || w2.br) { lines.push(cur); cur = []; }
			}
			if (cur.length) lines.push(cur);
			// word gap must read clearly wider than the letter gap
			const spaceW = size * 1.15;
			const lineWidth = (ws) =>
				ws.reduce((a, w2) => a + w2.reduce((b, E) => b + E.w, 0) + GAP0 * Math.max(0, w2.length - 1), 0)
				+ spaceW * Math.max(0, ws.length - 1);
			const y0 = ((lines.length - 1) * lineH) / 2;
			const xs = new Map();
			let maxW = 0;
			lines.forEach((ws, li) => {
				const lw = lineWidth(ws);
				maxW = Math.max(maxW, lw);
				let x = -lw / 2;
				ws.forEach((w2, wj) => {
					for (const E of w2) { xs.set(E.i, { x: x + E.w / 2, y: y0 - li * lineH }); x += E.w + GAP0; }
					x += spaceW - GAP0;
				});
			});
			T.wordX.push(xs);
			// fit against BOTH axes: width of the widest line, and the stack height
			T.wordRaw.push(Math.max(maxW, lines.length * lineH));
		}
		// FIT CAP: widest group must sit within the sphere (chord = 0.74·2R).
		// Width scales linearly with size, so one corrective rebuild suffices.
		const CHORD = 2 * 2.5 * 0.95; // full diameter, minus a hair
		const widest = Math.max(...T.wordRaw);
		if (widest > CHORD && !T._refitting) {
			T.fitCap = ((o.orbSize ?? 1) * CHORD) / widest * 0.98;
			T.fitCapKey = raw;
			T._refitting = true;
			buildKey = '';
			build(o);
			T._refitting = false;
		}
	}

	function reset() { t = 0; buildKey = ''; }
	function step(dt) { t += dt; }

	// Exporters await this before capturing frame 0 — otherwise the async
	// three.js/font init leaves the first frames as bare background (the
	// "black frame at the loop seam" in exported GIFs).
	function ready() {
		if (!T && !failed && !loading) initP = init();
		return initP || Promise.resolve();
	}

	function render(ctx) {
		const o = getOpts();
		if (!T && !failed && !loading) initP = init();
		if (!T) {
			ctx.fillStyle = o.bg || '#000';
			ctx.fillRect(0, 0, W, H);
			if (failed) {
				ctx.fillStyle = o.fg || '#fff';
				drawFittedText(ctx, (o.text || '').toUpperCase(), W, H, H * 0.2, o.fontFamily, 800, o.hasStretch);
			}
			return;
		}
		build(o);
		const { THREE, renderer, letters, words } = T;
		if (!T.v) {
			T.v = {
				a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
				zero: new THREE.Vector3(0, 0, 0),
				up: new THREE.Vector3(0, 1, 0), xAxis: new THREE.Vector3(1, 0, 0),
				zAxis: new THREE.Vector3(0, 0, 1),
				t1: new THREE.Vector3(), t2: new THREE.Vector3(), t3: new THREE.Vector3(),
				m: new THREE.Matrix4(),
				qa: new THREE.Quaternion(), qb: new THREE.Quaternion(),
				qFlip: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
				qTilt: null, qTmp: new THREE.Quaternion()
			};
		}
		const v = T.v;
		renderer.setClearColor(new THREE.Color(o.bg || '#000000'));
		T.mat.color.set(o.fg || '#ffffff');

		const phase = (((t / (o.duration || 4)) % 1) + 1) % 1;
		const nW = words.length;
		const seg = Math.min(nW - 1, Math.floor(phase * nW));
		const segPrev = (seg + nW - 1) % nW;
		const f = phase * nW - seg;

		const R = 2.5;
		const TILT = 0; // camera dead-level with the sphere's centre
		// One quarter-turn per segment: the word rides from face-on to EXACTLY
		// 90° as its swap-out completes — the transition happens right at
		// perpendicular, never past it. Speed comes from the loop duration
		// (shorter segments = faster words AND faster sphere together).
		const Q = Math.PI / 2;
		// Flight time is REAL-TIME rather than a segment fraction:
		// lengthening the loop duration adds pure word-hold dwell instead of
		// slowing the whip. 0.625s flight + up to 0.18s stagger = the whole
		// transition wave lasts ~0.8s, for EVERY letter (in, out, reshuffle).
		// Capped at 0.6 of the segment so short durations still leave hold.
		const segSec = (o.duration || 5.8) / nW;
		const FLIGHT = Math.min(0.6, 0.625 / segSec);
		const alpha = Q * f;            // this segment's rotation so far
		const [bx1, by1, bx2, by2] = o.orbBez ?? [0.28, 0, 0.1, 1];
		// Per-letter stagger: each glyph launches up to 180ms late (a
		// deterministic hash of its index — no Math.random, the loop must be
		// reproducible). Late letters fly their FULL flight and simply land
		// later — the swap WINDOW stretches to cover the last landing rather
		// than compressing anyone's flight into a snappier (boomier) one.
		const maxDF = Math.min(0.2, 0.18 / segSec);
		const WINDOW = FLIGHT + maxDF;  // first launch → last landing
		const eL = (i, tf) => {
			if (tf >= WINDOW) return 1;
			const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
			const d = (h - Math.floor(h)) * maxDF;
			const g = (tf - d) / FLIGHT;
			return bez(g < 0 ? 0 : g > 1 ? 1 : g, bx1, by1, bx2, by2);
		};
		// The outgoing word starts leaving ~0.5s BEFORE its segment ends —
		// its letters begin pouring back into the (next segment's) lattice
		// while the word is still riding, and the flight continues
		// seamlessly across the boundary. Capped so it never overlaps the
		// entry window.
		// Exit lead: regular mode leaves 0.9s before the boundary (word is
		// only ~57° around — comfortably short of perpendicular — when its
		// dissolve begins); wrongDelay keeps the original 0.5s.
		const LEAD = Math.min((o.orbWrongDelay ? 0.5 : 0.9) / segSec, (1 - WINDOW) * 0.9);
		// Normally the incoming word launches at the SAME moment the
		// outgoing word starts leaving (both LEAD before the boundary) —
		// they cross mid-air. o.orbWrongDelay = the "wrongDelay" look: the
		// incoming word waits for the boundary, leaving a gap of empty
		// sphere between the exit and the entrance.
		// ONE wave: entry, exit and redistribution all launch at the same
		// instant (LEAD before the boundary), fly the same WINDOW, and land
		// together. No stretched flights — a longer entry reads as a second,
		// later wave (its easing windup scales with the flight).
		const ELEAD = o.orbWrongDelay ? 0 : LEAD;
		// The transition INTO the word takes a bit longer: entry flies 25%
		// more time than the exit/reshuffle wave, and its curve puts ~40%
		// of the ease into deceleration (settle v<0.5 = 40% of flight; x2
		// tightened 0.1 → 0.08). x1 is windup-matched to the exit wave in
		// ABSOLUTE time so all waves still visibly launch together. In
		// wrongDelay this reduces exactly to the shared eL.
		const FL_IN = o.orbWrongDelay ? FLIGHT : FLIGHT * 1.25;
		const IN_X2 = o.orbWrongDelay ? bx2 : bx2 * 0.8;
		const eIn = (i, tf) => {
			if (tf >= FL_IN + maxDF) return 1;
			const h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
			const d = (h - Math.floor(h)) * maxDF;
			const g = (tf - d) / FL_IN;
			return bez(g < 0 ? 0 : g > 1 ? 1 : g, bx1 * (FLIGHT / FL_IN), by1, IN_X2, by2);
		};
		const AW = WINDOW - ELEAD + (FL_IN - FLIGHT); // entry completes here
		const RLEAD = ELEAD;            // redistribution: same clock
		if (!v.qTilt) v.qTilt = new THREE.Quaternion().setFromAxisAngle(v.xAxis, TILT);

		// lockup geometry: the word's plane passes through the sphere's
		// CENTRE — the text's midpoint sits exactly on the orbit's midpoint,
		// spinning in place about the vertical axis. Letters keep their
		// natural size (no resizing), so the lockup is just the raw word.
		const lockScale = () => 1;
		// RATE doubles the rigid sphere rotation (lattice + word ride share
		// one clock). SHIFT pulls both word anchors back by 1/5 of a
		// segment-rotation: assembly completes with the word still 36° shy
		// of the camera, it sweeps THROUGH straight-on during the hold, and
		// the hold ends at ~83° — never assembled past perpendicular.
		const RATE = 2;
		// Anchor pull-back. Default mode's early entry lands the word ~31°
		// deeper than wrongDelay's, so its timeline is rotated 1/6 of a
		// segment-rotation FORWARD to land closer to the camera (~37° vs
		// nearly perpendicular). Exit still starts pre-perpendicular (~82°).
		const SHIFT = (RATE * Q) / 5 - (o.orbWrongDelay ? 0 : (RATE * Q) / 6);
		// The word's ride line. OFF = 0 → WR equals the sphere rate exactly
		// (rigid ride, text turns at the same speed as the orbiting
		// letters); a nonzero OFF pulls landing/exit-start angles shallower
		// by riding slower. Sphere-rate ride ⇒ landing ~-62°, exit ~72°.
		const RQ = RATE * Q;
		const T_LAND = AW;              // landing time (may be pre-boundary)
		const T_EXIT = 1 - LEAD;        // exit-start time
		// Asymmetric offsets: landing sits 1/6 turn forward (~-32° instead
		// of ~-62°); exit-start stays put (~72°) — so the ride runs at ~78%
		// of sphere rate between the same two moments.
		const OFF_LAND = o.orbWrongDelay ? 0 : RQ / 6;
		const OFF_EXIT = 0;
		const yawA = RQ * (T_LAND - WINDOW) - SHIFT + OFF_LAND; // landing yaw
		const yawE = RQ * (T_EXIT - WINDOW) - SHIFT - OFF_EXIT; // exit-start yaw
		const WR = (yawE - yawA) / (T_EXIT - T_LAND);      // word ride rate
		const wordYaw = (g) => yawA + WR * (g - T_LAND);
		const yawIn = wordYaw(f);       // active word
		const yawOut = wordYaw(f + 1);  // word leaving (same line, +1 seg)

		// DIR = -1: the sphere orbits the OTHER way; every yaw (orbit spin and
		// the word's ride) negates together so the exit still lands at 90°.
		const DIR = -1;
		const SPIN_TURNS = -5; // uniform pinwheel (negative = reversed); integer only or the seam pops
		if (nW === 1) {
			// Single group: there is no other word to swap with (and the
			// orbit lattice for "everyone except the word" would be empty) —
			// hold the lockup at centre, one full spin per loop (seamless).
			for (const L of letters) lockPoseSingle(L, TAU * phase);
			renderer.render(T.scene, T.camera);
			ctx.drawImage(T.glcv, 0, 0);
			return;
		}
		function orbitPose(L, k, a, pos, quat) {
			// Lattice rides the SAME clock as the active word (one rigid
			// sphere, no speed split), both doubled by RATE.
			a *= 2;
			// guard: a letter can miss a segment map during text edits mid-frame
			const { j, m } = T.segIdx[k]?.get(L.i) ?? { j: L.i, m: T.letters.length };
			const sl = slot(j, m);
			v.t1.set(sl[0], sl[1], sl[2]); // canonical outward normal n̂
			pos.copy(v.t1).multiplyScalar(R).applyAxisAngle(v.up, DIR * a).applyQuaternion(v.qTilt);
			// Tangent frame built at the CANONICAL slot (glyph +z = outward,
			// +y = as upright as the sphere allows), then rotated RIGIDLY with
			// the ball. The old per-frame lookAt kept letters screen-upright,
			// which whirls near the poles (the lookAt-up singularity) — pole
			// letters looked like they spun way faster than equator ones.
			v.t2.set(0, 1, 0).addScaledVector(v.t1, -sl[1]).normalize(); // ŷ
			v.t3.crossVectors(v.t2, v.t1);                               // x̂ = ŷ × ẑ
			v.m.makeBasis(v.t3, v.t2, v.t1);
			quat.setFromRotationMatrix(v.m);
			quat.premultiply(v.qTmp.setFromAxisAngle(v.up, DIR * a));
			quat.premultiply(v.qTilt);
			// Pinwheel in the tangent plane (about the glyph's own normal, so
			// the face always points at/away from the centre — an A stays an
			// A, never edge-on). Riding the ball adds a latitude-dependent
			// roll of DIR·a·(up·n̂); subtract it so every letter's APPARENT
			// spin rate is identical from pole to equator.
			// Same-rate pinwheel, but each COPY of a glyph starts at a
			// golden-angle step from the last (occ x 137.5deg): consecutive
			// copies of the same letter are maximally out of phase, never
			// clones. A small index hash de-syncs different glyphs too.
			// Constant per letter -> loop seam unaffected.
			const h0 = Math.sin(L.i * 91.7 + 133.3) * 43758.5453;
			const off = ((L.occ ?? L.i) * 0.6180339887 % 1) * TAU + (h0 - Math.floor(h0)) * 0.9;
			const roll = TAU * SPIN_TURNS * phase - DIR * a * sl[1] + off;
			quat.multiply(v.qTmp.setFromAxisAngle(v.zAxis, roll));
		}
		function lockPoseSingle(L, yaw) {
			const P = T.wordX[0].get(L.i) ?? { x: 0, y: 0 };
			L.mesh.position.set(P.x, P.y, 0)
				.applyAxisAngle(v.up, DIR * yaw).applyQuaternion(v.qTilt);
			L.mesh.quaternion.setFromAxisAngle(v.up, DIR * yaw).premultiply(v.qTilt);
			L.mesh.scale.setScalar(1);
		}
		function lockPose(L, k, yaw, pos, quat) {
			const P = T.wordX[k].get(L.i) ?? { x: 0, y: 0 };
			pos.set(P.x, P.y, 0).applyAxisAngle(v.up, DIR * yaw).applyQuaternion(v.qTilt);
			quat.setFromAxisAngle(v.up, DIR * yaw).premultiply(v.qTilt);
		}

		const segNext = (seg + 1) % nW;
		for (const L of letters) {
			let px, py, pz, sc;
			const qa = v.qa, qb = v.qb;
			if (L.wi === seg && f < AW) {
				// incoming word: lattice → riding lockup (launched ELEAD
				// before the boundary; see the segNext branch below)
				const e = eIn(L.i, f + ELEAD);
				orbitPose(L, segPrev, Q + alpha, v.a, qa);      // old system, still turning
				lockPose(L, seg, yawIn, v.b, qb);
				px = v.a.x + (v.b.x - v.a.x) * e;
				py = v.a.y + (v.b.y - v.a.y) * e;
				pz = v.a.z + (v.b.z - v.a.z) * e;
				qa.slerp(qb, e);
				sc = 1;
			} else if (L.wi === segNext && f > 1 - ELEAD) {
				// EARLY ENTRY: the next word launches out of the lattice
				// pre-boundary, simultaneous with the current word's early
				// exit — they cross mid-air. Target is next segment's
				// lockup continued backward (alpha − Q).
				const e = eIn(L.i, f - (1 - ELEAD));
				orbitPose(L, seg, alpha, v.a, qa);
				lockPose(L, segNext, wordYaw(f - 1), v.b, qb);
				px = v.a.x + (v.b.x - v.a.x) * e;
				py = v.a.y + (v.b.y - v.a.y) * e;
				pz = v.a.z + (v.b.z - v.a.z) * e;
				qa.slerp(qb, e);
				sc = 1;
			} else if (L.wi === seg && f > 1 - LEAD) {
				// EARLY EXIT: the word starts dissolving into the NEXT
				// segment's lattice before the boundary. The lattice target
				// at angle alpha−Q is exactly where next segment's alpha=0
				// picks up, so the flight is continuous across the seam.
				const e = eL(L.i, f - (1 - LEAD));
				lockPose(L, seg, yawIn, v.a, qa);
				orbitPose(L, segNext, alpha - Q, v.b, qb);
				px = v.a.x + (v.b.x - v.a.x) * e;
				py = v.a.y + (v.b.y - v.a.y) * e;
				pz = v.a.z + (v.b.z - v.a.z) * e;
				qa.slerp(qb, e);
				sc = 1;
			} else if (L.wi === seg) {
				// holding: assembled, riding the rotation
				lockPose(L, seg, yawIn, v.a, qa);
				px = v.a.x; py = v.a.y; pz = v.a.z;
				sc = 1;
			} else if (L.wi === segPrev && f < WINDOW) {
				// outgoing word, continuing the exit that began LEAD before
				// the boundary — it crosses the incoming word mid-air
				const e = eL(L.i, f + LEAD);
				lockPose(L, segPrev, yawOut, v.a, qa);
				orbitPose(L, seg, alpha, v.b, qb);
				px = v.a.x + (v.b.x - v.a.x) * e;
				py = v.a.y + (v.b.y - v.a.y) * e;
				pz = v.a.z + (v.b.z - v.a.z) * e;
				qa.slerp(qb, e);
				sc = 1;
			} else if (f < WINDOW) {
				// everyone else: morph old even lattice → new even lattice
				// (began RLEAD before the boundary — see the branch below)
				const e = eL(L.i, f + RLEAD);
				orbitPose(L, segPrev, Q + alpha, v.a, qa);
				orbitPose(L, seg, alpha, v.b, qb);
				px = v.a.x + (v.b.x - v.a.x) * e;
				py = v.a.y + (v.b.y - v.a.y) * e;
				pz = v.a.z + (v.b.z - v.a.z) * e;
				qa.slerp(qb, e);
				sc = 1;
			} else if (f > 1 - RLEAD) {
				// pre-boundary redistribution: the lattice starts reshuffling
				// the moment the words launch — target is the next segment's
				// lattice continued backward (alpha − Q), seam-continuous
				const e = eL(L.i, f - (1 - RLEAD));
				orbitPose(L, seg, alpha, v.a, qa);
				orbitPose(L, segNext, alpha - Q, v.b, qb);
				px = v.a.x + (v.b.x - v.a.x) * e;
				py = v.a.y + (v.b.y - v.a.y) * e;
				pz = v.a.z + (v.b.z - v.a.z) * e;
				qa.slerp(qb, e);
				sc = 1;
			} else {
				orbitPose(L, seg, alpha, v.a, qa);
				px = v.a.x; py = v.a.y; pz = v.a.z;
				sc = 1;
			}
			L.mesh.position.set(px, py, pz);
			L.mesh.quaternion.copy(qa);
			L.mesh.scale.setScalar(sc);
		}

		renderer.render(T.scene, T.camera);
		ctx.drawImage(T.glcv, 0, 0);
	}
	return { reset, step, render, ready };
}

// GLASS01 — the letters of a justified lockup move INDEPENDENTLY, in
// choreography: every glyph runs the same closed cardinal circuit (right,
// down, left, up — ease-OUT into each stop, blink after landing) but with
// a cascading per-glyph stagger, and alternate lines run the circuit in
// opposite rotation. The lockup dissolves into staggered right-angle
// drift and re-forms, wave after wave. One fixed pane of white frosted
// glass (fine grain, sheen, hairline corners) diffuses whatever passes
// beneath it. No colour in the glass — blue type on white.
function sceneGlass01(env) {
	const { W, H, getOpts } = env;
	let t = 0, glyphs = [], fontCss = '', layer = null, layerCtx = null, grain = null, cacheKey = '';
	const PANE = { x: 0.2, y: 0.16, w: 0.6, h: 0.68 };
	const STEP_X = 0.055, STEP_Y = 0.07; // per-glyph glide distances
	const MV = 0.5;        // share of each segment spent gliding
	const STAGGER = 0.045; // subtle cascade — the rejoin still reads as one clean event
	function layout(o) {
		const words = ((o.text || 'INTERACTIVE DESIGN CONCEPTS').trim().toUpperCase()).split(/\s+/).filter(Boolean);
		glyphs = [];
		if (!words.length) return;
		const probe = document.createElement('canvas').getContext('2d');
		const blockW = W * 0.58;
		let fontPx = Math.min(H * 0.16, W * 0.2);
		const fam = "'Google Sans Flex', 'Helvetica Neue', Helvetica, sans-serif";
		probe.font = `500 ${fontPx}px ${fam}`;
		let maxW = 0;
		for (const w of words) maxW = Math.max(maxW, probe.measureText(w).width);
		fontPx = fontPx * (blockW / maxW);
		const lineH0 = fontPx * 1.04;
		fontPx = Math.min(fontPx, fontPx * (H * 0.6) / Math.max(lineH0 * words.length, 1));
		probe.font = `500 ${fontPx}px ${fam}`;
		fontCss = probe.font;
		const lh2 = fontPx * 1.04;
		const y0 = H / 2 - (lh2 * words.length) / 2 + lh2 / 2;
		let k = 0;
		for (let li = 0; li < words.length; li++) {
			const gs = Array.from(words[li]);
			const widths = gs.map((g) => probe.measureText(g).width);
			const natural = widths.reduce((s, w) => s + w, 0);
			let x = W / 2 - natural / 2; // natural tracking, centred — no justification
			for (let gi = 0; gi < gs.length; gi++) {
				glyphs.push({ ch: gs[gi], x, y: y0 + li * lh2, li, wi: gi, k: k++ });
				x += widths[gi];
			}
		}
	}
	function makeGrain() {
		const gw = Math.max(2, W >> 1), gh = Math.max(2, H >> 1);
		const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
		const c2 = cv.getContext('2d');
		const img = c2.createImageData(gw, gh);
		let s = 1337 >>> 0;
		const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
		for (let i = 0; i < gw * gh; i++) {
			const v = 235 + rnd() * 20;
			img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
			img.data[i * 4 + 3] = 255;
		}
		c2.putImageData(img, 0, 0);
		return cv;
	}
	function ensure(o) {
		const key = (o.text || '') + '|' + W + 'x' + H;
		if (key === cacheKey) return;
		cacheKey = key;
		layout(o);
		layer = document.createElement('canvas'); layer.width = W; layer.height = H;
		layerCtx = layer.getContext('2d');
		grain = grain || makeGrain();
	}
	function reset() { t = 0; cacheKey = ''; }
	function step(dt) { t += dt; }
	// four movements per loop: split VERTICALLY (alternating letters up /
	// down within each word), come back together, split HORIZONTALLY
	// (alternating apart), come back together. Endpoint states per glyph:
	// [home, v-split, home, h-split] -> loop closes at home.
	function render(ctx) {
		const o = getOpts();
		ensure(o);
		const phase = (((t / (o.duration || 14)) % 1) + 1) % 1;
		const n = Math.max(1, glyphs.length);
		// draw the CHOREOGRAPHED glyphs into the scratch layer
		layerCtx.clearRect(0, 0, W, H);
		layerCtx.font = fontCss;
		layerCtx.fillStyle = o.fg || '#2247ec';
		layerCtx.textBaseline = 'middle'; layerCtx.textAlign = 'left';
		for (const g of glyphs) {
			// cascade: each glyph runs the SAME circuit, slightly behind the
			// one before it — the lockup peels apart and re-forms in waves
			const ph = ((phase - (g.k / n) * STAGGER) % 1 + 1) % 1;
			const seg = Math.floor(ph * 4), f = ph * 4 - seg;
			const u = Math.min(1, f / MV);
			const e = 1 - Math.pow(1 - u, 3); // ease-OUT into the stop
			// alternating sign within the word (odd lines flip, so the whole
			// composition breathes in counterpoint rather than in unison)
			const sgn = ((g.wi % 2 ? -1 : 1) * (g.li % 2 ? -1 : 1));
			// endpoint states: home -> v-split -> home -> h-split -> home
			const SX = [0, 0, 0, sgn], SY = [0, sgn, 0, 0];
			const fx = SX[seg], tx = SX[(seg + 1) % 4];
			const fy = SY[seg], ty = SY[(seg + 1) % 4];
			const dx = (fx + (tx - fx) * e) * STEP_X * W;
			const dy = (fy + (ty - fy) * e) * STEP_Y * H;
			// blink once, just after landing
			let alpha = 1;
			if (f > MV) {
				const bf = (f - MV) / (1 - MV);
				if (bf > 0.12 && bf < 0.44) {
					const q = (bf - 0.12) / 0.32;
					alpha = q < 0.35 ? 1 - q / 0.35 : q < 0.6 ? 0 : (q - 0.6) / 0.4;
				}
			}
			layerCtx.globalAlpha = alpha;
			layerCtx.fillText(g.ch, g.x + dx, g.y + dy);
		}
		layerCtx.globalAlpha = 1;
		// composite: crisp layer, then the one frosted pane
		paintBg(ctx, o, W, H);
		ctx.drawImage(layer, 0, 0);
		const px = PANE.x * W, py = PANE.y * H, pw = PANE.w * W, ph2 = PANE.h * H;
		ctx.save();
		ctx.beginPath(); ctx.rect(px, py, pw, ph2); ctx.clip();
		ctx.fillStyle = 'rgba(255,255,255,0.9)';
		ctx.fillRect(px, py, pw, ph2);
		ctx.filter = `blur(${Math.max(1.4, W * 0.0038)}px)`;
		ctx.drawImage(layer, 0, 0); // the moving type through the frost
		ctx.filter = 'none';
		ctx.globalAlpha = 0.16;
		ctx.drawImage(grain, 0, 0, W, H);
		ctx.globalAlpha = 0.06;
		const gr = ctx.createLinearGradient(px, py, px + pw, py + ph2);
		gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, 'rgba(255,255,255,0)');
		gr.addColorStop(0.93, 'rgba(255,255,255,0)'); gr.addColorStop(1, '#ffffff');
		ctx.fillStyle = gr;
		ctx.fillRect(px, py, pw, ph2);
		ctx.globalAlpha = 1;
		ctx.restore();
		const lw = Math.max(1, W * 0.0009);
		ctx.strokeStyle = 'rgba(30,38,55,0.14)';
		ctx.lineWidth = lw;
		ctx.strokeRect(px - lw / 2, py - lw / 2, pw + lw, ph2 + lw);
		ctx.strokeStyle = 'rgba(255,255,255,0.55)';
		ctx.strokeRect(px + lw, py + lw, pw - lw * 2, ph2 - lw * 2);
	}
	return { reset, step, render };
}

function sceneDots(env) {
	const { W, H, getOpts } = env;
	let t, cov, mw, mh;
	function reset() {
		const o = getOpts();
		mw = 480; mh = Math.max(2, Math.round(480 * H / W));
		cov = textMaskAt(mw, mh, o);
		t = 0;
	}
	function step(dt) { t += dt; }
	function covAt(u, v) {
		const x = clamp((u * mw) | 0, 0, mw - 1), y = clamp((v * mh) | 0, 0, mh - 1);
		return cov[y * mw + x];
	}
	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
		const cell = clamp((W / 84) * (o.htSize || 1), 3, 40); // dot pitch — dense enough that strokes span several dots
		const gx = Math.ceil(W / cell), gy = Math.ceil(H / cell);
		const rMax = cell * 0.5;
		const du = (cell * 0.25) / W, dv = (cell * 0.25) / H;
		for (let y = 0; y < gy; y++) {
			for (let x = 0; x < gx; x++) {
				const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
				const u = cx / W, v = cy / H;
				// 4-point supersample → smooth coverage at letter edges
				const c = (covAt(u - du, v - dv) + covAt(u + du, v - dv) + covAt(u - du, v + dv) + covAt(u + du, v + dv)) / 4;
				// phase*2 = two whole wave cycles per loop → seamless
				const wv = 0.5 + 0.5 * Math.sin(TAU * (phase * 2 - (u + v) * 1.5));
				if (c > 0.04) {
					// letter dots: size from coverage (solid, readable), wave = shimmer + colour sweep
					const r = rMax * Math.pow(c, 0.75) * (0.8 + 0.2 * wv);
					if (r < 0.3) continue;
					ctx.fillStyle = mixCss(o.fg, o.accent, wv * wv * c);
					ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
				} else {
					// whisper field between letters — keeps the halftone texture alive
					const r = rMax * (0.05 + 0.06 * wv);
					if (r < 0.3) continue;
					ctx.fillStyle = mixCss(o.bg, o.fg, 0.35);
					ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
				}
			}
		}
	}
	return { reset, step, render };
}

// Micro type — the title rebuilt out of tiny copies of its own letters. Cells
// inside the letterforms carry heavy animated glyphs (a weight wave sweeping
// diagonally — the variable font working at mosaic scale). Coverage is
// supersampled per cell and drives alpha + glyph size CONTINUOUSLY, so the
// letter contour fades out smoothly instead of the ragged hard cutoff v1 had.
// The between-letters field is a near-silent hairline texture. Seamless loop.
function sceneMosaic(env) {
	const { W, H, getOpts } = env;
	let t, cov, mw, mh;
	function reset() {
		const o = getOpts();
		mw = 480; mh = Math.max(2, Math.round(480 * H / W));
		cov = textMaskAt(mw, mh, o);
		t = 0;
	}
	function step(dt) { t += dt; }
	function covAt(u, v) {
		const x = clamp((u * mw) | 0, 0, mw - 1), y = clamp((v * mh) | 0, 0, mh - 1);
		return cov[y * mw + x];
	}
	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		const chars = Array.from((o.text || '*').replace(/\s+/g, ''));
		if (!chars.length) chars.push('*');
		const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
		const cell = clamp((W / 56) * (o.moCell || 1), 6, 64);
		const gx = Math.ceil(W / cell), gy = Math.ceil(H / cell);
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		if (o.hasStretch) ctx.fontStretch = '100%';
		const du = (cell * 0.25) / W, dv = (cell * 0.25) / H;
		for (let y = 0; y < gy; y++) {
			for (let x = 0; x < gx; x++) {
				const cx = (x + 0.5) * cell, cy = (y + 0.5) * cell;
				const u = cx / W, v = cy / H;
				const c = (covAt(u - du, v - dv) + covAt(u + du, v - dv) + covAt(u - du, v + dv) + covAt(u + du, v + dv)) / 4;
				const ch = chars[(x + y * gx) % chars.length];
				const wv = 0.5 + 0.5 * Math.sin(TAU * (phase * 2 - u * 1.3 - v * 0.9));
				if (c > 0.12) {
					// edge cells fade + shrink smoothly → clean letter contour
					const edge = clamp((c - 0.12) / 0.5, 0, 1);
					// weight/size quantised so the canvas font cache gets reuse
					const wgt = Math.round(lerp(250, 700, wv) / 25) * 25;
					const px = Math.round(cell * (0.68 + 0.3 * edge) * 2) / 2;
					ctx.font = `${wgt} ${px}px ${o.fontFamily}`;
					ctx.fillStyle = mixCss(o.fg, o.accent, wv * wv);
					ctx.globalAlpha = 0.35 + 0.65 * edge;
					ctx.fillText(ch, cx, cy);
				} else {
					ctx.font = `100 ${cell * 0.62}px ${o.fontFamily}`;
					ctx.fillStyle = o.fg;
					ctx.globalAlpha = 0.06;
					ctx.fillText(ch, cx, cy);
				}
			}
		}
		ctx.globalAlpha = 1;
	}
	return { reset, step, render };
}

// Particle type — the title peels apart left-to-right into swirling particles
// and reassembles, once per loop. Each particle has a home pixel on the
// letterforms and a polar flight path that CURVES (the launch angle rotates as
// the particle flies → swirl, not a cheap radial burst). The pulse envelope has
// a dead zone around the loop seam, so — with the per-particle peel delays —
// the fully-assembled word holds on screen for a beat before the next burst.
// Particles draw as a soft accent halo + sharp core, so it reads glowy on dark
// palettes without additive blow-out on light ones. Seamless loop.
function sceneScatter(env) {
	const { W, H, getOpts, rng } = env;
	let pts, t;
	const COUNT = 3000;
	// Pulse: 0 (assembled) for p ∈ [0.7, 1)∪{0}, one smooth out-and-back hump
	// across p ∈ (0, 0.7). Periodic and continuous → seamless.
	function pulse(p) {
		if (p >= 0.7) return 0;
		const s = Math.sin(Math.PI * (p / 0.7));
		return s * s;
	}
	function reset() {
		const o = getOpts();
		const mw = 400, mh = Math.max(2, Math.round(400 * H / W));
		const cov = textMaskAt(mw, mh, o);
		const cells = [];
		for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (cov[y * mw + x] > 0.5) cells.push([x, y]);
		if (!cells.length) cells.push([mw / 2, mh / 2]);
		pts = [];
		for (let i = 0; i < COUNT; i++) {
			const c = cells[(rng() * cells.length) | 0];
			const hx = ((c[0] + rng()) / mw) * W, hy = ((c[1] + rng()) / mh) * H;
			pts.push({
				hx, hy,
				ang: rng() * TAU,
				dist: (0.18 + rng() * 0.8) * Math.min(W, H),
				sw: (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 1.1),   // swirl: rad of curve over the flight
				off: (hx / W) * 0.2 + (rng() - 0.5) * 0.06,          // peel sweeps across the word l→r
				sz: 0.6 + rng() * 1.3, c: rng()
			});
		}
		t = 0;
	}
	function step(dt) { t += dt; }
	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
		const amp = clamp(o.scAmp ?? 1, 0.2, 2.5);
		const r0 = Math.max(0.9, W / 640);
		for (const p of pts) {
			const e = pulse((phase + p.off + 1) % 1);
			const a = p.ang + p.sw * e * 1.7;                       // flight path curves as it goes
			const x = p.hx + Math.cos(a) * p.dist * e * amp;
			const y = p.hy + Math.sin(a) * p.dist * e * amp;
			const r = r0 * p.sz * (1 - 0.3 * e);
			// soft halo (accent) under a sharp core → premium glow on any palette
			ctx.globalAlpha = 0.16 * (1 - 0.4 * e);
			ctx.fillStyle = o.accent;
			ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, TAU); ctx.fill();
			ctx.globalAlpha = lerp(0.95, 0.45, e);
			ctx.fillStyle = mixCss(o.fg, o.accent, clamp(e * (0.5 + p.c * 0.7), 0, 1));
			ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
		}
		ctx.globalAlpha = 1;
	}
	return { reset, step, render };
}

// Echo — concentric outlined copies of the title expand outward from the solid
// word like sound waves. Ring i sits at geometric scale g^(i+phase); when phase
// wraps, ring i lands exactly where ring i+1 started, and the innermost ring is
// born hidden behind the solid fill — a perfectly seamless outward pulse.
function sceneEcho(env) {
	const { W, H, getOpts } = env;
	let t = 0;
	const RINGS = 7, G = 1.24;
	return {
		reset() { t = 0; },
		step(dt) { t += dt; },
		render(ctx) {
			const o = getOpts();
			paintBg(ctx, o, W, H);
			const phase = (((t / (o.duration || 3)) % 1) + 1) % 1;
			const fontPx = H * (o.fontFrac || 0.3);
			// rings, outermost first so nearer echoes draw on top
			for (let i = RINGS - 1; i >= 0; i--) {
				const q = i + phase;
				const s = Math.pow(G, q);
				const a = Math.pow(1 - q / RINGS, 1.5) * 0.85;
				if (a <= 0.01) continue;
				ctx.save();
				ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
				ctx.globalAlpha = a;
				ctx.strokeStyle = mixCss(o.accent, o.fg, q / RINGS);
				ctx.lineWidth = (2.4 * (W / 960)) / s; // constant on-screen stroke width
				ctx.lineJoin = 'round';
				drawFittedText(ctx, o.text, W, H, fontPx, o.fontFamily, 600, o.hasStretch, true);
				ctx.restore();
			}
			// the solid word on top — hides each newborn ring at scale ≈ 1
			ctx.globalAlpha = 1;
			ctx.fillStyle = o.fg;
			drawFittedText(ctx, o.text, W, H, fontPx, o.fontFamily, 600, o.hasStretch);
		}
	};
}

// ── registry ─────────────────────────────────────────────────────────────────

// Flex — Google Sans Flex variable-type lockup. Line one spans the measure
// at the font's widest (wdth 150 via font-stretch); every line below is
// fitted to EXACTLY the same measure by searching the width axis for the
// variation whose exact-fit size sits closest to 0.6x the headline. The
// animation is squash & stretch: weight breathes on the REAL wght axis
// (100..700 continuous) while the glyphs squash through per-glyph vector
// transforms (the font's width axis is keyword-quantised in canvas, so the
// vectors carry the continuous motion). Per-glyph slots are re-normalised
// to the measure every frame, so the lockup never stops fitting exactly.
// '/' splits lines. One sine per loop -> seamless.
// Google Sans Flex, registered once per width stop as pinned families
// "GSF-w{v}" (stretch descriptor maps the wdth axis). Needed because
// Chrome's canvas honours font-stretch in measureText but NOT fillText.
// fine-grained stops (every 5 wdth units) — coarse steps read as sudden
// letterform pops when the width animates; at 5 units the switch is
// invisible under the pinned-geometry compensation
const GSF_STOPS = Array.from({ length: 26 }, (_, i) => 25 + i * 5);
const gsfFam = (v) => '"GSF-w' + v + '"';
let _gsfP = null;
function loadGSF() {
	if (!_gsfP) _gsfP = (async () => {
		try {
			const cssURL = 'https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wdth,wght@25..150,100..700&display=swap';
			const css = await (await fetch(cssURL)).text();
			const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]);
			const buf = await (await fetch(urls[urls.length - 1])).arrayBuffer();
			await Promise.all(GSF_STOPS.map(async (v) => {
				const f = new FontFace('GSF-w' + v, buf.slice(0), { stretch: v + '%', weight: '100 700' });
				await f.load();
				document.fonts.add(f);
			}));
		} catch (e) { console.warn('[gsf] font init failed', e); }
	})();
	return _gsfP;
}

function sceneFlex(env) {
	const { W, H, getOpts } = env;
	// Chrome's canvas honours font-stretch in measureText but NOT in
	// fillText — so the wdth axis is unusable via the shorthand. Instead
	// the GSF woff2 is registered once per width stop as its own family
	// with a pinned `stretch` descriptor (which maps the wdth axis), so
	// measurement and drawing always agree. Weight is fixed at 500.
	const STOPS = GSF_STOPS;
	const famOf = gsfFam;
	let t = 0, fontsReady = false, readyP = null;
	let fitKey = '', fit = null;
	const mcv = document.createElement('canvas');
	const mctx = mcv.getContext('2d');

	function ready() {
		if (!readyP) readyP = loadGSF().then(() => { fontsReady = true; });
		return readyP;
	}


	function reset() { t = 0; fitKey = ''; ready(); }
	function step(dt) { t += dt; }

	const meas = (word, stop, wght, size) => {
		mctx.font = wght + ' ' + size + 'px ' + famOf(stop);
		return mctx.measureText(word).width;
	};

	// Type Orbit's whip: Newton-solved cubic-bezier (shares o.orbBez, so
	// the panel's Easing editor drives this mode too)
	function bez(g, x1, y1, x2, y2) {
		if (g <= 0) return 0;
		if (g >= 1) return 1;
		let u = g;
		for (let i = 0; i < 5; i++) {
			const iu = 1 - u;
			const x = 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u;
			const dx = 3 * iu * iu * x1 + 6 * iu * u * (x2 - x1) + 3 * u * u * (1 - x2);
			if (Math.abs(dx) < 1e-6) break;
			u -= (x - g) / dx;
			if (u < 0) u = 0; else if (u > 1) u = 1;
		}
		const iu = 1 - u;
		return 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u;
	}

	// RIGID BOX LOCKUP. One point size everywhere. Rows ('/' splits) stack
	// inside a fixed outer boundary; interior borders slide. Each row gets
	// the width-axis stop whose natural span is closest to the measure —
	// the FONT does the fitting; the animation squashes vectors.
	function doFit(rows, M) {
		const size = Math.max(8, (100 * M) / Math.max(1, meas(rows[0].join(' '), 150, 500, 100)));
		mctx.font = '500 ' + size + 'px ' + famOf(100);
		const mH = mctx.measureText('H');
		const capH = (mH.actualBoundingBoxAscent || size * 0.72);
		const spaceW = size * 0.24;
		const R = rows.map((words) => {
			let best = null;
			for (const stop of STOPS) {
				const ws = words.map((w) => meas(w, stop, 500, size));
				const tot = ws.reduce((a, b) => a + b, 0) + spaceW * (words.length - 1);
				if (!best || Math.abs(tot - M) < Math.abs(best.tot - M)) best = { stop, ws, tot };
			}
			const k = (M - spaceW * (words.length - 1)) / Math.max(1, best.tot - spaceW * (words.length - 1));
			return { stop: best.stop, words, natW: best.ws, baseW: best.ws.map((w) => w * k) };
		});
		// box height: the HERO row at natural cap height + every other row
		// crushed to 0.35 of it — so a hero at "regular size" genuinely
		// dominates the fixed box
		let gap = capH * 0.22;
		let B = capH * (1 + 0.35 * (R.length - 1)) + gap * (R.length - 1);
		// the composition runs 1.5x taller than the natural cap-height
		// stack — rows render vertically stretched at base
		B *= 1.5; gap *= 1.5;
		const availH = H * 0.8;
		let sizeK = 1;
		if (B > availH) { sizeK = availH / B; B = availH; gap *= sizeK; }
		return { R, size: size * sizeK, capH: capH * sizeK, spaceW: spaceW * sizeK, gap, B };
	}

	function render(ctx) {
		const o = getOpts();
		if (o.bgType === 'transparent') ctx.clearRect(0, 0, W, H);
		else paintBg(ctx, o, W, H);
		if (!fontsReady) { ready(); return; }
		const raw = (o.text || 'Interactive / Design Concepts').toUpperCase();
		const rows = raw.split('/').map((r) => r.trim().split(/\s+/).filter(Boolean)).filter((r) => r.length);
		if (!rows.length) return;
		const M = W * 0.88;
		const key = raw + '|' + W + 'x' + H;
		if (fitKey !== key) { fit = doFit(rows, M); fitKey = key; }
		const dur = o.duration || 4;
		const p = (((t / dur) % 1) + 1) % 1;

		ctx.fillStyle = o.fg || '#111111';
		ctx.textBaseline = 'alphabetic';
		ctx.textAlign = 'left';

		// HERO-BEAT choreography. One beat per hero; a hero is a single-
		// word row (it sits at REGULAR size and its row takes most of the
		// fixed box, flattening the others) or one word of a multi-word row
		// (its row grows to regular height — every word in it rises — while
		// the hero also expands horizontally, crushing its siblings).
		// Beats whip hero -> hero with Type Orbit's bezier; each hero is a
		// held keyframe, so every word gets its unmodified moment.
		// o.flexSolo inserts a NEUTRAL keyframe between heroes.
		const heroes = [];
		fit.R.forEach((row, i) => {
			if (row.words.length === 1) heroes.push({ i, q: -1 });
			else row.words.forEach((_, q) => heroes.push({ i, q }));
		});
		const nR = fit.R.length;
		const stateOf = (k) => {
			let hero = null;
			if (o.flexSolo) { if (k % 2 === 1) hero = heroes[(k - 1) / 2]; }
			else hero = heroes[k % heroes.length];
			const hshare = fit.R.map((_, i) => (!hero ? 1 : i === hero.i ? 1 : 0.35));
			const mults = fit.R.map((row, i) => row.words.map((_, q) => {
				if (!hero || hero.i !== i || hero.q < 0) return 1;
				return q === hero.q ? 1.75 : 0.3;
			}));
			return { hshare, mults };
		};
		const segs = o.flexSolo ? heroes.length * 2 : heroes.length;
		const HOLD = 0.45;
		const sN = Math.floor(p * segs), u = p * segs - sN;
		const SA = stateOf(sN), SB = stateOf((sN + 1) % segs);
		const [bx1, by1, bx2, by2] = o.orbBez ?? [0.28, 0, 0.1, 1];
		const m = u < HOLD ? 0 : bez((u - HOLD) / (1 - HOLD), bx1, by1, bx2, by2);
		const mix = (a, b) => a + (b - a) * m;

		const boxTop = (H - fit.B) / 2;
		const boxLeft = (W - M) / 2;
		const hsRaw = fit.R.map((_, i) => mix(SA.hshare[i], SB.hshare[i]));
		const hScale = (fit.B - fit.gap * (nR - 1)) / (hsRaw.reduce((a, b) => a + b, 0) * fit.capH);

		let y = boxTop;
		for (let i = 0; i < nR; i++) {
			const row = fit.R[i];
			const rowH = hsRaw[i] * fit.capH * hScale;
			const n = row.words.length;
			const cw = row.baseW.map((w, q) => w * mix(SA.mults[i][q], SB.mults[i][q]));
			const wScale = (M - fit.spaceW * (n - 1)) / cw.reduce((a, b) => a + b, 0);
			let x = boxLeft;
			for (let q = 0; q < n; q++) {
				const cellW = cw[q] * wScale;
				const nat = row.natW[q] || 1;
				ctx.font = '500 ' + fit.size + 'px ' + famOf(row.stop);
				ctx.save();
				ctx.translate(x, y);
				ctx.scale(cellW / nat, rowH / fit.capH);
				ctx.fillText(row.words[q], 0, fit.capH);
				ctx.restore();
				x += cellW + fit.spaceW;
			}
			y += rowH + fit.gap;
		}
	}
	return { reset, step, render, ready };
}


// Full Bleed — the lockup fills the WHOLE frame and the camera sits ~30%
// INSIDE the letters' edges (everything drawn at 1.3x about centre, so the
// composition crops past the frame). All caps, rows are full-width bands.
// The wdth axis breathes per row (nearest pinned GSF stop each frame)
// while every word's box is pinned — the outer edges never move, the
// letterforms morph in the middle — and a slight italic lean oscillates
// via a baseline skew (GSF's ital axis is binary, so the lean is vector).
function sceneBleed(env) {
	const { W, H, getOpts } = env;
	let t = 0, fontsReady = false, readyP = null;
	let fitKey = '', fit = null;
	const mcv = document.createElement('canvas');
	const mctx = mcv.getContext('2d');

	function ready() {
		if (!readyP) readyP = loadGSF().then(() => { fontsReady = true; });
		return readyP;
	}
	function reset() { t = 0; fitKey = ''; ready(); }
	function step(dt) { t += dt; }

	const meas = (word, stop, size) => {
		mctx.font = '500 ' + size + 'px ' + gsfFam(stop);
		return mctx.measureText(word).width;
	};

	function doFit(rows) {
		const size = 100;
		const spaceW = size * 0.22;
		mctx.font = '500 ' + size + 'px ' + gsfFam(100);
		const capH = mctx.measureText('H').actualBoundingBoxAscent || size * 0.72;
		// each row spans the FULL frame width; word boxes fixed from the
		// wdth-100 proportions (per-frame width breathing re-fits into them)
		const R = rows.map((words) => {
			const nat = words.map((w) => meas(w, 100, size));
			const tot = nat.reduce((a, b) => a + b, 0) + spaceW * (words.length - 1);
			const k = W / Math.max(1, tot);
			return { words, chars: words.map((w) => [...w]), cells: nat.map((w) => w * k), space: spaceW * k };
		});
		const gapPx = H * 0.02;
		const bandH = (H - gapPx * (rows.length - 1)) / rows.length;
		return { R, capH, bandH, gapPx, size };
	}

	function render(ctx) {
		const o = getOpts();
		if (o.bgType === 'transparent') ctx.clearRect(0, 0, W, H);
		else paintBg(ctx, o, W, H);
		if (!fontsReady) { ready(); return; }
		const raw = (o.text || 'Interactive / Design Concepts').toUpperCase();
		const rows = raw.split('/').map((r) => r.trim().split(/\s+/).filter(Boolean)).filter((r) => r.length);
		if (!rows.length) return;
		const key = raw + '|' + W + 'x' + H;
		if (fitKey !== key) { fit = doFit(rows); fitKey = key; }
		const dur = o.duration || 5;
		const p = (((t / dur) % 1) + 1) % 1;

		ctx.save();
		// the camera sits 30% inside the letters: draw at 1.3x about centre
		ctx.translate(W / 2, H / 2); ctx.scale(1.3, 1.3); ctx.translate(-W / 2, -H / 2);
		ctx.fillStyle = o.fg || '#111111';
		ctx.textBaseline = 'alphabetic';
		ctx.textAlign = 'left';

		let y = 0;
		for (let i = 0; i < fit.R.length; i++) {
			const row = fit.R[i];
			// width breathing: pick the nearest pinned stop each frame; the
			// fixed cells re-absorb it so edges stay put
			const wTarget = 100 + 40 * Math.sin(TAU * p + i * Math.PI);
			const stop = GSF_STOPS.reduce((a, b) => (Math.abs(b - wTarget) < Math.abs(a - wTarget) ? b : a));
			ctx.font = '500 ' + fit.size + 'px ' + gsfFam(stop);
			mctx.font = ctx.font;
			const sy = fit.bandH / fit.capH;
			let x = 0;
			let gj = i * 97; // per-letter phase seed, offset per row
			for (let q = 0; q < row.words.length; q++) {
				const cs = row.chars[q];
				const adv = cs.map((c) => mctx.measureText(c).width);
				const natSum = adv.reduce((a, b) => a + b, 0) || 1;
				const kx = row.cells[q] / natSum;
				let lx = 0;
				for (let j = 0; j < cs.length; j++) {
					// RANDOM letters italicise: every letter leans on its own
					// hashed phase (one cycle per loop — seamless), so at any
					// moment a different scattered subset reads as italic
					const h = Math.sin(gj * 127.1 + 311.7) * 43758.5453;
					const ph = (h - Math.floor(h)) * TAU;
					const lean = Math.tan((8 * Math.PI / 180) * Math.sin(TAU * p + ph));
					ctx.save();
					ctx.translate(x + lx, y + fit.bandH);
					ctx.transform(1, 0, lean, 1, 0, 0);
					ctx.scale(kx, sy);
					ctx.fillText(cs[j], 0, 0);
					ctx.restore();
					lx += adv[j] * kx;
					gj++;
				}
				x += row.cells[q] + row.space;
			}
			y += fit.bandH + fit.gapPx;
		}
		ctx.restore();
	}
	return { reset, step, render, ready };
}


// Grit — black bg, white type, EXTREME out-of-focus patches + animated
// grain occlusion. The lockup is drawn twice: sharp (with soft blob-shaped
// holes) and heavily blurred (visible ONLY inside those blobs — true
// out-of-focus areas, not glow). Blobs drift on integer-frequency
// lissajous loops and the blur radius itself animates; chunky phase-seeded
// noise is punched out of the type on top. Seamless: all motion is
// phase-periodic, grain is stochastic per frame (flicker is the point).
function sceneGrit(env) {
	const { W, H, getOpts, noise } = env;
	let t = 0, fontsReady = false, readyP = null;
	let fitKey = '', fit = null;
	let LA = null, LB = null, LM = null, LG = null, LT = null, LH = null, LX = null;
	let LP = null, grainCv = null, grainKey = '';
	const mcv = document.createElement('canvas');
	const mctx = mcv.getContext('2d');

	function ready() {
		if (!readyP) readyP = loadGSF().then(buildPlate).then(() => { fontsReady = true; });
		return readyP;
	}

	// NATURAL grit via the browser's own turbulence API: SVG feTurbulence
	// (fractal noise) at near-pixel frequency, hard-thresholded to WHITE,
	// clustered under soft blob masks, plus solid horizontal/vertical
	// streaks — then the whole plate goes through blur->contrast passes so
	// every edge (grit and streaks alike) comes out organic and white.
	async function buildPlate() {
		try {
			const mkc = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, x: c.getContext('2d') }; };
			const sc = W / 300;
			// ANALOG grain recipe: real film grain is CLUMPY (low-freq
			// turbulence), MULTI-SCALE (fine dust over the clumps), SOFT
			// (no hard pixels) and TONAL (marks vary in brightness). Two
			// turbulence fields with gentle thresholds, then a soft pass.
			const turbSVG = (freq, oct, seed, slope, icept) =>
				'<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
				'<filter id="g" x="0%" y="0%" width="100%" height="100%">' +
				'<feTurbulence type="fractalNoise" baseFrequency="' + freq.toFixed(3) + '" numOctaves="' + oct + '" seed="' + seed + '" stitchTiles="stitch"/>' +
				'<feColorMatrix type="saturate" values="0"/>' +
				'<feComponentTransfer>' +
				'<feFuncR type="linear" slope="' + slope + '" intercept="' + icept + '"/>' +
				'<feFuncG type="linear" slope="' + slope + '" intercept="' + icept + '"/>' +
				'<feFuncB type="linear" slope="' + slope + '" intercept="' + icept + '"/>' +
				'<feFuncA type="linear" slope="0" intercept="1"/>' +
				'</feComponentTransfer>' +
				'</filter><rect width="100%" height="100%" filter="url(#g)"/></svg>';
			const loadSVG = (svgStr) => new Promise((res, rej) => {
				const im = new Image();
				im.onload = () => res(im); im.onerror = rej;
				im.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgStr);
			});
			const sc0 = W / 300;
			// clumpy silver-halide field + fine dust on top
			// top-tail thresholds: midpoint thresholds give connected
			// maze/dither (digital); only the peaks -> discrete soft grains
			const img = await loadSVG(turbSVG(0.45 / Math.max(1, sc0), 4, 11, 5, -3.1));
			const img2 = await loadSVG(turbSVG(0.85 / Math.max(1, sc0), 3, 29, 6.5, -3.9));
			// turbulence layer: fine speckle, clustered — NEVER blurred
			// (blur+contrast on 1px speckle wipes it out; it stays raw)
			const px = mkc(W, H);
			px.x.fillStyle = '#000'; px.x.fillRect(0, 0, W, H);
			px.x.drawImage(img, 0, 0, W, H);
			px.x.globalCompositeOperation = 'screen';
			px.x.globalAlpha = 0.7;
			px.x.drawImage(img2, 0, 0, W, H);
			px.x.globalAlpha = 1;
			px.x.globalCompositeOperation = 'source-over';
			// cluster the grit under soft blobs (+ a faint field of dust)
			const hh0 = (a) => { const v = Math.sin(a * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };
			const mask = mkc(W, H);
			mask.x.fillStyle = '#181818'; mask.x.fillRect(0, 0, W, H);
			for (let k = 0; k < 16; k++) {
				const rr = sc * (14 + 70 * Math.pow(hh0(k * 7.7 + 3), 2));
				const cx = W * hh0(k * 3.1 + 1), cy = H * hh0(k * 5.3 + 2);
				const gr = mask.x.createRadialGradient(cx, cy, 0, cx, cy, rr);
				gr.addColorStop(0, '#fff');
				gr.addColorStop(1, 'rgba(255,255,255,0)');
				mask.x.fillStyle = gr;
				mask.x.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
			}
			px.x.globalCompositeOperation = 'multiply';
			px.x.drawImage(mask.c, 0, 0);
			px.x.globalCompositeOperation = 'source-over';
			// re-whiten the surviving speckle (mask multiply dimmed it) —
			// via a temp canvas: self-drawImage through a filter is flaky
			const tmp = mkc(W, H);
			tmp.x.fillStyle = '#000'; tmp.x.fillRect(0, 0, W, H);
			// soft pass: sub-pixel blur rounds every grain, mild lift keeps
			// the marks tonal — analog, never binary
			tmp.x.filter = 'blur(' + (0.5 * sc0).toFixed(2) + 'px) brightness(2.0) contrast(1.3)';
			tmp.x.drawImage(px.c, 0, 0);
			tmp.x.filter = 'none';
			px.x.globalCompositeOperation = 'copy';
			px.x.drawImage(tmp.c, 0, 0);
			px.x.globalCompositeOperation = 'source-over';
			// SHAPE MODULATORS: randomly placed circles, squares and
			// starbursts, blurred beyond recognition — the dark set
			// multiplies grit AWAY, the light set gates IN a denser
			// turbulence field. Soft continents of more/less grit.
			const shapePath = (g, ty, cx, cy, r, rot) => {
				g.beginPath();
				if (ty === 0) g.arc(cx, cy, r, 0, TAU);
				else if (ty === 1) {
					g.save(); g.translate(cx, cy); g.rotate(rot);
					g.rect(-r, -r, r * 2, r * 2);
					g.restore();
				} else {
					for (let i = 0; i < 20; i++) {
						const rr = i % 2 ? r * 0.42 : r;
						const a = rot + (i / 20) * TAU;
						const X = cx + Math.cos(a) * rr, Y = cy + Math.sin(a) * rr;
						if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
					}
					g.closePath();
				}
			};
			const mkMask = (off, fill, bg) => {
				const raw = mkc(W, H), m = mkc(W, H);
				raw.x.fillStyle = bg; raw.x.fillRect(0, 0, W, H);
				raw.x.fillStyle = fill;
				for (let k = 0; k < 8; k++) {
					const ty = Math.floor(hh0(k * 3.7 + off) * 3);
					const r = W * (0.05 + 0.16 * Math.pow(hh0(k * 5.3 + off + 1), 1.5));
					shapePath(raw.x, ty, W * hh0(k * 7.1 + off + 2), H * hh0(k * 9.7 + off + 3), r, hh0(k * 11.1 + off + 4) * TAU);
					raw.x.fill();
				}
				m.x.fillStyle = bg; m.x.fillRect(0, 0, W, H);
				m.x.filter = 'blur(' + (W * 0.05).toFixed(1) + 'px)';
				m.x.drawImage(raw.c, 0, 0);
				m.x.filter = 'none';
				return m;
			};
			const sub = mkMask(100, '#000', '#fff');
			px.x.globalCompositeOperation = 'multiply';
			px.x.drawImage(sub.c, 0, 0);
			px.x.globalCompositeOperation = 'source-over';
			const addM = mkMask(200, '#fff', '#000');
			const dense = mkc(W, H);
			dense.x.fillStyle = '#000'; dense.x.fillRect(0, 0, W, H);
			dense.x.filter = 'blur(' + (0.4 * sc0).toFixed(2) + 'px) brightness(1.8)';
			dense.x.drawImage(img, 0, 0, W, H);
			dense.x.filter = 'none';
			dense.x.globalCompositeOperation = 'multiply';
			dense.x.drawImage(addM.c, 0, 0);
			dense.x.globalCompositeOperation = 'source-over';
			px.x.globalCompositeOperation = 'screen';
			px.x.drawImage(dense.c, 0, 0);
			px.x.globalCompositeOperation = 'source-over';
			// STREAK layer (separate — this one DOES get the blur+contrast
			// treatment for organic white edges)
			// PILL GRAIN: a capsule filled with a greyscale gradient,
			// multiplied by the fine dust field — a soft pill of grain that
			// thins along its own gradient. Composited with a slow breathe.
			const pill = mkc(W, H);
			pill.x.fillStyle = '#000'; pill.x.fillRect(0, 0, W, H);
			const pw = W * 0.52, ph2 = W * 0.13;
			pill.x.save();
			pill.x.translate(W * 0.56, H * 0.74);
			pill.x.rotate(-0.32);
			const pg = pill.x.createLinearGradient(-pw / 2, 0, pw / 2, 0);
			pg.addColorStop(0, '#ffffff');
			pg.addColorStop(1, '#000000');
			pill.x.fillStyle = pg;
			pill.x.beginPath();
			pill.x.roundRect(-pw / 2, -ph2 / 2, pw, ph2, ph2 / 2);
			pill.x.fill();
			pill.x.restore();
			pill.x.globalCompositeOperation = 'multiply';
			pill.x.drawImage(img2, 0, 0, W, H);
			pill.x.globalCompositeOperation = 'source-over';
			LP = pill;
			const stk = mkc(W, H);
			stk.x.fillStyle = '#000'; stk.x.fillRect(0, 0, W, H);
			// rock scratches + chips (white, sparse)
			for (let k = 0; k < 60; k++) {
				const x0 = W * hh0(k * 3.1 + 21), y0 = H * hh0(k * 5.7 + 8);
				const ang = hh0(k * 7.9 + 3) * TAU;
				const ln = sc * (6 + 40 * Math.pow(hh0(k * 11.3 + 5), 2));
				stk.x.strokeStyle = 'rgba(255,255,255,' + (0.2 + 0.5 * Math.pow(hh0(k * 13.7 + 9), 1.6)).toFixed(3) + ')';
				stk.x.lineWidth = Math.max(0.5, sc * (0.4 + 1.4 * Math.pow(hh0(k * 17.1 + 2), 2.4)));
				stk.x.beginPath();
				stk.x.moveTo(x0, y0);
				stk.x.quadraticCurveTo(
					x0 + Math.cos(ang + 0.5) * ln * 0.5, y0 + Math.sin(ang + 0.5) * ln * 0.5,
					x0 + Math.cos(ang) * ln, y0 + Math.sin(ang) * ln);
				stk.x.stroke();
			}
			// organic edges: blur then hard contrast, twice — streaks and
			// grit alike end up eaten-at but solid WHITE
			const passP = (blur, con) => {
				tmp.x.filter = 'none';
				tmp.x.fillStyle = '#000'; tmp.x.fillRect(0, 0, W, H);
				tmp.x.filter = 'blur(' + blur + 'px) contrast(' + con + ')';
				tmp.x.drawImage(stk.c, 0, 0);
				tmp.x.filter = 'none';
				stk.x.globalCompositeOperation = 'copy';
				stk.x.drawImage(tmp.c, 0, 0);
				stk.x.globalCompositeOperation = 'source-over';
			};
			// gentle: enough to eat the edges organically, not enough to
			// erase blurred thin lines entirely
			passP(0.7, 2.0);
			passP(0.4, 1.5);
			// merge: raw fine speckle + goo'd white streaks
			px.x.globalCompositeOperation = 'screen';
			px.x.drawImage(stk.c, 0, 0);
			px.x.globalCompositeOperation = 'source-over';
			LX = px;
		} catch (e) { console.warn('[grit] plate build failed', e); }
	}
	function reset() { t = 0; fitKey = ''; ready(); }
	function step(dt) { t += dt; }

	function layers() {
		if (LA) return;
		const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, x: c.getContext('2d') }; };
		LA = mk(W, H); LB = mk(W, H); LM = mk(W, H);
		LT = mk(W, H); // alpha-capable temp for feathered patch composites
		LG = mk(W, H); // FULL-res grain — really small, no upscale blocks
		LG.gd = LG.x.createImageData(LG.c.width, LG.c.height);
		// halftone tile: soft dark dot on white; overlay + contrast turns
		// midtones into print dots
		const cell = Math.max(2, Math.round(W / 550));
		LH = mk(cell, cell);
		const hg = LH.x.createRadialGradient(cell / 2, cell / 2, 0, cell / 2, cell / 2, cell * 0.62);
		hg.addColorStop(0, '#000');
		hg.addColorStop(1, '#fff');
		LH.x.fillStyle = hg;
		LH.x.fillRect(0, 0, cell, cell);

	}

	const meas = (word, stop, size) => {
		mctx.font = '700 ' + size + 'px ' + gsfFam(stop);
		return mctx.measureText(word).width;
	};

	function bez(g, x1, y1, x2, y2) {
		if (g <= 0) return 0;
		if (g >= 1) return 1;
		let u = g;
		for (let i = 0; i < 5; i++) {
			const iu = 1 - u;
			const x = 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u;
			const dx = 3 * iu * iu * x1 + 6 * iu * u * (x2 - x1) + 3 * u * u * (1 - x2);
			if (Math.abs(dx) < 1e-6) break;
			u -= (x - g) / dx;
			if (u < 0) u = 0; else if (u > 1) u = 1;
		}
		const iu = 1 - u;
		return 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u;
	}

	// Normal-size lockup, VERY bold (wght 700). Each row spans the measure
	// at the width stop whose natural span fits it best (same recipe as
	// Flex). Letter rects are recorded for the per-letter brightness map.
	function doFit(rows) {
		const M = W * 0.82;
		const size = Math.max(8, (100 * M) / Math.max(1, meas(rows[0].join(' '), 100, 100)));
		mctx.font = '700 ' + size + 'px ' + gsfFam(100);
		const capH = mctx.measureText('H').actualBoundingBoxAscent || size * 0.72;
		const spaceW = size * 0.22;
		const R = rows.map((words) => {
			let best = null;
			for (const stop of GSF_STOPS) {
				const ws = words.map((w) => meas(w, stop, size));
				const tot = ws.reduce((a, b) => a + b, 0) + spaceW * (words.length - 1);
				if (!best || Math.abs(tot - M) < Math.abs(best.tot - M)) best = { stop, ws, tot };
			}
			const k = (M - spaceW * (words.length - 1)) / Math.max(1, best.tot - spaceW * (words.length - 1));
			return { stop: best.stop, words, natW: best.ws, cells: best.ws.map((w) => w * k), space: spaceW };
		});
		const gap = capH * 0.34;
		const B = R.length * capH + gap * (R.length - 1);
		const boxTop = (H - B) / 2, boxLeft = (W - M) / 2;
		// letter rects (absolute) for the brightness map
		const rects = [];
		let y = boxTop;
		R.forEach((row) => {
			let x = boxLeft;
			row.words.forEach((word, q) => {
				const kx = row.cells[q] / (row.natW[q] || 1);
				mctx.font = '700 ' + size + 'px ' + gsfFam(row.stop);
				let lx = 0;
				for (const ch of word) {
					const aw = mctx.measureText(ch).width * kx;
					rects.push({ x: x + lx, y, w: aw, h: capH, cx: x + lx + aw / 2, cy: y + capH / 2 });
					lx += aw;
				}
				x += row.cells[q] + row.space;
			});
			y += capH + gap;
		});
		return { R, size, capH, boxTop, boxLeft, gap, rects, M };
	}

	function drawLockup(g, color) {
		g.fillStyle = color;
		g.textBaseline = 'alphabetic';
		g.textAlign = 'left';
		let y = fit.boxTop;
		for (const row of fit.R) {
			g.font = '700 ' + fit.size + 'px ' + gsfFam(row.stop);
			let x = fit.boxLeft;
			for (let q = 0; q < row.words.length; q++) {
				g.save();
				g.translate(x, y + fit.capH);
				g.scale(row.cells[q] / (row.natW[q] || 1), 1);
				g.fillText(row.words[q], 0, 0);
				g.restore();
				x += row.cells[q] + row.space;
			}
			y += fit.capH + fit.gap;
		}
	}

	function render(ctx) {
		const o = getOpts();
		paintBg(ctx, o, W, H);
		if (!fontsReady) { ready(); return; }
		layers();
		const raw = (o.text || 'Interactive / Design Concepts').toUpperCase();
		const rows = raw.split('/').map((r) => r.trim().split(/\s+/).filter(Boolean)).filter((r) => r.length);
		if (!rows.length) return;
		const key = raw + '|' + W + 'x' + H;
		if (fitKey !== key) { fit = doFit(rows); fitKey = key; }
		const dur = o.duration || 5;
		const p = (((t / dur) % 1) + 1) % 1;
		const ax = LA.x, bx = LB.x, mx = LM.x;

		// 1) bold white type on opaque black (the goo chain needs luminance)
		ax.filter = 'none';
		ax.globalCompositeOperation = 'source-over';
		ax.fillStyle = '#000'; ax.fillRect(0, 0, W, H);
		drawLockup(ax, '#fff');

		// 2) ROUNDING: blur -> hard contrast -> blur -> contrast. The goo
		// threshold rounds every corner artificially; run it twice for a
		// soft pebble-like letterform, then a light animated blur on top.
		const goo = (src, dst, blur, con) => {
			dst.filter = 'none';
			dst.fillStyle = '#000'; dst.fillRect(0, 0, W, H);
			dst.filter = 'blur(' + blur + 'px) contrast(' + con + ')';
			dst.drawImage(src, 0, 0);
			dst.filter = 'none';
		};
		// radius rides the GLYPH size, not the canvas — big enough to round
		// corners, small enough that thin rows stay legible
		const r1 = Math.max(1.2, fit.capH * 0.07);
		goo(LA.c, bx, r1, 18);
		goo(LB.c, ax, r1 * 0.6, 12);

		// 3) letter-by-letter brightness: full at the off-centre focal
		// point (a third off), fading to 60% for the far letters
		const fx = W * 0.62, fy = H * 0.38;
		const rad = Math.hypot(W, H) * 0.52;
		mx.fillStyle = '#000'; mx.fillRect(0, 0, W, H);
		for (const r of fit.rects) {
			const d = Math.min(1, Math.hypot(r.cx - fx, r.cy - fy) / rad);
			const v = Math.round(255 * (1 - 0.28 * d)); // floor ~72%, reads white
			mx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
			mx.fillRect(r.x - 2, r.y - fit.capH * 0.25, r.w + 4, r.h + fit.capH * 0.5);
		}
		ax.globalCompositeOperation = 'multiply';
		ax.drawImage(LM.c, 0, 0);
		if ((o.fg || '#ffffff').toLowerCase() !== '#ffffff') {
			ax.fillStyle = o.fg; ax.fillRect(0, 0, W, H); // tint (still multiply)
		}
		ax.globalCompositeOperation = 'source-over';

		// 4b) MOTION BLUR patches — real directional convolution, like
		// Photoshop's: ~20 sub-pixel-spaced samples of the type layer are
		// AVERAGED along a hashed random direction (a true 1-D box blur),
		// then feather-masked back INTO the luminance layer, replacing the
		// sharp pixels there — no ghost copies, a genuine smear.
		const blkH = fit.R.length * fit.capH + fit.gap * (fit.R.length - 1);
		// GRUNGE finish on the luminance layer: ink blotches, grain-eroded
		// edges, halftone dot structure, then a contrast re-punch — the
		// too-perfect goo edges come out ragged and printy.
		for (let k = 0; k < 8; k++) {
			const hh = (a) => { const v = Math.sin(a * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };
			const bxp = fit.boxLeft + fit.M * hh(k * 3 + 1);
			const byp = fit.boxTop + blkH * hh(k * 7 + 2) + Math.sin(TAU * p + k) * 2;
			const br = fit.capH * (0.5 + 1.4 * hh(k * 13 + 3));
			const gr2 = ax.createRadialGradient(bxp, byp, 0, bxp, byp, br);
			gr2.addColorStop(0, 'rgba(0,0,0,' + (0.18 + 0.2 * hh(k * 17 + 4)).toFixed(2) + ')');
			gr2.addColorStop(1, 'rgba(0,0,0,0)');
			ax.fillStyle = gr2;
			ax.fillRect(bxp - br, byp - br, br * 2, br * 2);
		}
		{
			// fine grain scrubbed into the layer (roughens edges pre-contrast)
			const gd0 = LG.gd, d0 = gd0.data;
			let sd0 = (31 * 2654435761) >>> 0; // static edge-erosion grain
			const r0 = () => ((sd0 = (sd0 * 1664525 + 1013904223) >>> 0) / 4294967296);
			for (let i2 = 0; i2 < d0.length; i2 += 4) {
				const v = 128 + (r0() + r0() - 1) * 120;
				d0[i2] = v; d0[i2 + 1] = v; d0[i2 + 2] = v; d0[i2 + 3] = 255;
			}
			LG.x.putImageData(gd0, 0, 0);
			ax.globalCompositeOperation = 'overlay';
			ax.globalAlpha = 0.5;
			ax.drawImage(LG.c, 0, 0, W, H);
			ax.globalAlpha = 1;
			ax.globalCompositeOperation = 'source-over';
			// DARK rock scratches gouged THROUGH the letters (ink removal)
			const hs2 = (a) => { const v = Math.sin(a * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };
			for (let k = 0; k < 34; k++) {
				const x0 = fit.boxLeft + fit.M * hs2(k * 3.3 + 7);
				const y0 = fit.boxTop - fit.capH * 0.3 + (blkH + fit.capH * 0.6) * hs2(k * 5.1 + 13);
				const ang = hs2(k * 7.7 + 2) * TAU;
				const ln = fit.capH * (0.2 + 1.4 * Math.pow(hs2(k * 9.9 + 4), 2));
				ax.strokeStyle = 'rgba(0,0,0,' + (0.14 + 0.4 * Math.pow(hs2(k * 11.7 + 6), 1.5)).toFixed(3) + ')';
				ax.lineWidth = Math.max(0.5, (W / 300) * (0.4 + 1.4 * Math.pow(hs2(k * 13.1 + 8), 2)));
				ax.beginPath();
				ax.moveTo(x0, y0);
				ax.lineTo(x0 + Math.cos(ang) * ln, y0 + Math.sin(ang) * ln);
				ax.stroke();
			}
			// contrast punch, then SOFTEN: blur the punched ink and press
			// the halftone into the resulting edge ramps — a second, milder
			// contrast turns them into dithered dot edges (soft, printy,
			// never a hard vector contour)
			const pass = (filter) => {
				bx.filter = 'none';
				bx.fillStyle = '#000'; bx.fillRect(0, 0, W, H);
				bx.filter = filter;
				bx.drawImage(LA.c, 0, 0);
				bx.filter = 'none';
				ax.globalCompositeOperation = 'copy';
				ax.drawImage(LB.c, 0, 0);
				ax.globalCompositeOperation = 'source-over';
			};
			pass('contrast(2.1)');
			pass('blur(' + Math.max(0.8, fit.capH * 0.045).toFixed(2) + 'px)');
			ax.globalCompositeOperation = 'overlay';
			ax.globalAlpha = 0.55;
			ax.fillStyle = ax.createPattern(LH.c, 'repeat');
			ax.fillRect(0, 0, W, H);
			ax.globalAlpha = 1;
			ax.globalCompositeOperation = 'source-over';
			pass('brightness(1.65) contrast(1.45)'); // hard white core
		}

		// Patches TRAVEL: the loop is split into segments and each patch
		// retargets a different hashed letter every segment, its smear
		// growing from 0 and dying back to 0 within the segment — so the
		// relocation jumps are invisible and the loop closes perfectly.
		const rects = fit.rects, nLet = rects.length;
		const SEGS = 1; // one relocation per loop — 3x slower than before
		const [ebx1, eby1, ebx2, eby2] = o.orbBez ?? [0.28, 0, 0.1, 1];
		const envE = (g) => bez(g < 0 ? 0 : g > 1 ? 1 : g, ebx1, eby1, ebx2, eby2);
		for (let k = 0; k < 4; k++) {
			const segF = p * SEGS + k / 4;
			const si = ((Math.floor(segF) % SEGS) + SEGS) % SEGS;
			const u = segF - Math.floor(segF);
			// whip-eased pulse (same bezier as the orbiting type): eased
			// rise to full smear, eased fall back to nothing
			const env = u < 0.5 ? envE(u * 2) : envE((1 - u) * 2);
			if (env < 0.06) continue;
			const hh = (a) => { const v = Math.sin(a * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };
			const rct = rects[Math.floor(hh(k * 53 + si * 97 + 11) * nLet) % nLet];
			const cx = rct.cx, cy = rct.cy;
			const ang = hh(k * 31 + si * 71 + 5) * TAU;
			const len = fit.capH * (0.25 + 1.1 * env);
			const dxs = Math.cos(ang), dys = Math.sin(ang);
			const R = Math.max(rct.w, fit.capH) * (1.0 + 0.5 * env);
			const N = Math.max(12, Math.min(22, Math.ceil(len)));
			bx.filter = 'none';
			bx.globalCompositeOperation = 'source-over';
			bx.fillStyle = '#000'; bx.fillRect(0, 0, W, H);
			bx.globalCompositeOperation = 'lighter';
			bx.globalAlpha = 1 / N;
			for (let i2 = 0; i2 < N; i2++) {
				const off = (i2 / (N - 1) - 0.5) * len;
				bx.drawImage(LA.c, dxs * off, dys * off);
			}
			bx.globalAlpha = 1;
			bx.globalCompositeOperation = 'source-over';
			const tx2 = LT.x;
			tx2.clearRect(0, 0, W, H);
			tx2.drawImage(LB.c, 0, 0);
			const fadeA = Math.min(1, env * 1.6);
			const gr = tx2.createRadialGradient(cx, cy, R * 0.4, cx, cy, R);
			gr.addColorStop(0, 'rgba(255,255,255,' + fadeA + ')');
			gr.addColorStop(1, 'rgba(255,255,255,0)');
			tx2.globalCompositeOperation = 'destination-in';
			tx2.fillStyle = gr;
			tx2.fillRect(0, 0, W, H);
			tx2.globalCompositeOperation = 'source-over';
			ax.drawImage(LT.c, 0, 0);
		}

		// 4) composite (luminance -> screen over the bg) with a soft
		// breathing blur — the whole word drifts in and out of focus
		const softB = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(TAU * p));
		ctx.save();
		ctx.globalCompositeOperation = 'screen';
		// brightness after the focus blur re-lifts thin strokes to WHITE
		ctx.filter = 'blur(' + softB.toFixed(2) + 'px) brightness(1.3)';
		ctx.drawImage(LA.c, 0, 0);
		ctx.restore();

		// the white grunge plate — STATIC (the background doesn't animate)
		if (LX) {
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.92;
			ctx.drawImage(LX.c, 0, 0);
			ctx.restore();
		}
		if (LP) {
			// the pill of grain fades in and out, subtly (loop-periodic)
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 0.38 * (0.5 + 0.5 * Math.sin(TAU * p - Math.PI / 2));
			ctx.drawImage(LP.c, 0, 0);
			ctx.restore();
		}
		// GLOBAL FILM GRAIN, the shader way: neutral-grey noise soft-lit
		// over the frame, alpha following 1 - smoothstep(luma)^2 — grain
		// rides the midtones, fades off the bright type/marks, and
		// soft-light leaves pure black untouched. Baked ONCE (static).
		if (!grainCv || grainKey !== fitKey) {
			const fr = ctx.getImageData(0, 0, W, H);
			const gcv = document.createElement('canvas');
			gcv.width = W; gcv.height = H;
			const gx2 = gcv.getContext('2d');
			const gd2 = gx2.createImageData(W, H);
			let sd2 = (97 * 2654435761) >>> 0;
			const rn2 = () => ((sd2 = (sd2 * 1664525 + 1013904223) >>> 0) / 4294967296);
			for (let i2 = 0; i2 < gd2.data.length; i2 += 4) {
				const lum = fr.data[i2] / 255;
				const t2 = Math.min(1, Math.max(0, (lum - 0.3) / 0.6));
				const resp = t2 * t2 * (3 - 2 * t2);
				const n2 = (rn2() + rn2() + rn2() - 1.5) * 60;
				gd2.data[i2] = gd2.data[i2 + 1] = gd2.data[i2 + 2] = 128 + n2;
				gd2.data[i2 + 3] = 255 * 0.5 * (1 - resp * resp);
			}
			gx2.putImageData(gd2, 0, 0);
			grainCv = gcv; grainKey = fitKey;
		}
		ctx.save();
		ctx.globalCompositeOperation = 'soft-light';
		ctx.drawImage(grainCv, 0, 0);
		ctx.restore();
	}
	return { reset, step, render, ready };
}

export const SCENES = [
	// `smooth: true` = the scene's step(dt) is genuinely time-based, so the
	// PREVIEW can run at full display rate (60fps) for silky motion; the export
	// still bakes at the chosen GIF fps. Iteration-based sims (BZ/CA/flow/walk/
	// cloth advance per CALL, not per second) must keep the fixed-step preview.
	{ id: 'type',    name: 'Kinetic Type',  make: sceneType,    usesPreset: true,  smooth: true },
	{ id: 'tile',    name: 'Step & Repeat', make: sceneTile,    usesPreset: true,  smooth: true },
	{ id: 'lorem',   name: 'Wave Wall',     make: sceneLorem,   usesPreset: false, smooth: true },
	{ id: 'meta',    name: 'Metaballs',     make: sceneMeta,    usesPreset: false, smooth: true },
	{ id: 'cmeta',   name: 'Color Metaballs', make: sceneCMeta, usesPreset: false, smooth: true },
	{ id: 'blobc',   name: 'Blob 1',        make: sceneBlobColor, usesPreset: false, smooth: true },
	{ id: 'blobc2',  name: 'Blob 2',        make: sceneBlob2,   usesPreset: false, smooth: true },
	{ id: 'blobc3',  name: 'Blob 3-C',      make: sceneBlob3C,  usesPreset: false, smooth: true },
	{ id: 'blobc3n', name: 'Blob 3-N',      make: sceneBlob3N,  usesPreset: false, smooth: true },
	{ id: 'blobc3f', name: 'Blob 3-C Fast', make: sceneBlob3CF, usesPreset: false, smooth: true },
	{ id: 'blobc4',  name: 'Blob 4',        make: sceneBlob4,   usesPreset: false, smooth: true },
	{ id: 'blobc5',  name: 'Blob 5',        make: sceneBlob5,   usesPreset: false, smooth: true },
	{ id: 'blobc6',  name: 'Blob 6-1',      make: sceneBlob6,   usesPreset: false, smooth: true },
	{ id: 'blobc62', name: 'Blob 6-2',      make: sceneBlob62,  usesPreset: false, smooth: true },
	{ id: 'blobc63', name: 'Blob 6-3',      make: sceneBlob63,  usesPreset: false, smooth: true },
	{ id: 'blobc64', name: 'Blob 6-4',      make: sceneBlob64,  usesPreset: false, smooth: true },
	{ id: 'blobc65', name: 'Blob 6-5',      make: sceneBlob65,  usesPreset: false, smooth: true },
	{ id: 'blobc66', name: 'Blob 6-6',      make: sceneBlob66,  usesPreset: false, smooth: true },
	{ id: 'blobc67', name: 'Blob 6-7',      make: sceneBlob67,  usesPreset: false, smooth: true },
	{ id: 'blobc68', name: 'Blob 6-8',      make: sceneBlob68,  usesPreset: false, smooth: true },
	{ id: 'blobc68p', name: 'Blob 6-8-prev', make: sceneBlob68P, usesPreset: false, smooth: true },
	{ id: 'blobc69', name: 'Blob 6-9',      make: sceneBlob69,  usesPreset: false, smooth: true },
	{ id: 'blobc610', name: 'Blob 6-10',    make: sceneBlob610, usesPreset: false, smooth: true },
	{ id: 'blobc611', name: 'Blob 6-11',    make: sceneBlob611, usesPreset: false, smooth: true },
	{ id: 'blobc612', name: 'Blob 6-12',    make: sceneBlob612, usesPreset: false, smooth: true },
	{ id: 'blobc70',  name: 'Blob 7-0',     make: sceneBlob70,  usesPreset: false, smooth: true },
	{ id: 'blobc70p', name: 'Blob 7-0-prev', make: sceneBlob70prev, usesPreset: false, smooth: true },
	{ id: 'blobc71',  name: 'Blob 7-1',     make: sceneBlob71,  usesPreset: false, smooth: true },
	{ id: 'blobc80',  name: 'Blob 8',       make: sceneBlob80,  usesPreset: false, smooth: true },
	{ id: 'blobc90',  name: 'Blob 9',       make: sceneBlob90,  usesPreset: false, smooth: true },
	{ id: 'blobc100', name: 'Blob 10',      make: sceneBlob100, usesPreset: false, smooth: true },
	{ id: 'blobc110', name: 'Blob 11',      make: sceneBlob110, usesPreset: false, smooth: true },
	{ id: 'blobc120', name: 'Blob 12',      make: sceneBlob120, usesPreset: false, smooth: true },
	{ id: 'blobc122', name: 'Blob 12-2',    make: sceneBlob122, usesPreset: false, smooth: true },
	{ id: 'blobc123', name: 'Blob 12-3',    make: sceneBlob123, usesPreset: false, smooth: true },
	{ id: 'blobc124', name: 'Blob 12-4',    make: sceneBlob124, usesPreset: false, smooth: true },
	{ id: 'blobc125', name: 'Blob 12-5',    make: sceneBlob125, usesPreset: false, smooth: true },
	{ id: 'glass01',  name: 'GLASS01',      make: sceneGlass01, usesPreset: false, smooth: true },
	{ id: 'coin',     name: 'Coin',         make: sceneCoin,    usesPreset: false, smooth: true },
	{ id: 'sphere',   name: 'Sphere',       make: sceneSphere,  usesPreset: false, smooth: true },
	{ id: 'metal',    name: 'Liquid Metal', make: sceneMetal,   usesPreset: false, smooth: true },
	{ id: 'typeorb',  name: 'Type Orbit',   make: sceneTypeOrb, usesPreset: false, smooth: true },
	{ id: 'flex',     name: 'Flex',         make: sceneFlex,    usesPreset: false, smooth: true },
	{ id: 'bleed',    name: 'Full Bleed',   make: sceneBleed,   usesPreset: false, smooth: true },
	{ id: 'grit',     name: 'Grit',         make: sceneGrit,    usesPreset: false, smooth: true },
	{ id: 'clouds',   name: 'Clouds',       make: sceneClouds,  usesPreset: false, smooth: true },
	{ id: 'garble',   name: 'Garble',       make: sceneGarble,  usesPreset: false, smooth: true },
	{ id: 'dots',    name: 'Halftone',      make: sceneDots,    usesPreset: false, smooth: true },
	{ id: 'mosaic',  name: 'Micro Type',    make: sceneMosaic,  usesPreset: false, smooth: true },
	{ id: 'scatter', name: 'Particles',     make: sceneScatter, usesPreset: false, smooth: true },
	{ id: 'echo',    name: 'Echo',          make: sceneEcho,    usesPreset: false, smooth: true },
	{ id: 'bz',      name: 'BZ Waves',      make: sceneBZ,      usesPreset: false },
	{ id: 'cca',     name: 'Cyclic CA',     make: sceneCCA,     usesPreset: false },
	{ id: 'flow',    name: 'Flow Field',    make: sceneFlow,    usesPreset: false },
	{ id: 'sort',    name: 'Pixel Sort',    make: sceneSort,    usesPreset: true,  smooth: true },
	{ id: 'walk',    name: 'Random Walk',   make: sceneWalk,    usesPreset: false },
	{ id: 'cloth',   name: 'Cloth',         make: sceneCloth,   usesPreset: false }
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
