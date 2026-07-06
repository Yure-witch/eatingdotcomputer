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
		level = -99; phase = 0;
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
		const bands = clamp(Math.round(o.bzBands || 20), 2, N);
		const lut = new Array(MAXN);
		lut[0] = bg;
		for (let s = 1; s < MAXN; s++) {
			const a = clamp((s - 1) / (N - 1), 0, 1);         // 0 fresh front → 1 old
			let bright;
			if (fade <= 0.02) {
				bright = s === 1 ? 1 : 0;                     // single emanating line
			} else {
				const u = a / fade;                           // position within the tail
				if (u >= 1) bright = 0;                       // beyond the tail → background
				else { const uu = Math.round(u * (bands - 1)) / (bands - 1); bright = Math.pow(1 - uu, 1.3); }
			}
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
function blob3Scene(env, cellular, speedMul = 1, mass = false) {
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
	const podsBuf = new Float32Array(128); // 32 pod slots — headroom so FADING tail segments never get evicted mid-fade (the "sometimes pops while fading")
	// the living mass (cellular variant): a coarse grid of letter-sized cells
	let gw2 = 2, gh2 = 2, valid = null, alive = null, level = null, ageT = null, phB = null, rateB = null, mBytes = null, massTex = null, simT = 0, hasText = false;
	let cellComp = null, compCells = null, swallows = [], capC = 10; // letter awareness
	// Blob 4 creature: a single mass of feathered-circle nodes
	let nodes = [], heading = 0, addT = 0, remT = 0.8, txCells = [], letterH2 = 50;
	let goal = null, goalT = 0, splitT = 5; // roaming destination + split timer
	let anchorX = 0, anchorY = 0; // low-passed nearest-text point (steering aid)
	let headN = null, dropD = 0; // the permanent head disc + distance since last trail drop
	let headDist = 0, tailDist = 0; // arclength of head travel + the CONTINUOUS tail point

	const VSH = 'attribute vec2 aP; varying vec2 vUV; void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }';
	const FSH = `
precision highp float;
varying vec2 vUV;
#define OUT(c) gl_FragColor = (c)
uniform sampler2D uN;      // distance field: 1 on the letterform -> 0 at max reach
uniform sampler2D uB;      // bead-noise texture — Blob-1-style colour speckle
uniform sampler2D uM;      // cell-mass texture — the living blob organism (CPU sim)
uniform vec4 uPods[32];    // pod/mass variants: x, y (px), amplitude, sigma
uniform float uGate, uSatK;
uniform float uPh;         // TAU * loop phase
uniform float uLump;       // lump spatial frequency (~1 / letter height)
uniform vec2 uMOff;        // ~0.75 mass-texel, for the rounding taps
uniform vec2 uRes;
void main() {
	vec2 st = vec2(vUV.x, 1.0 - vUV.y); // canvas orientation (y down)
	float n = texture2D(uN, st).a;
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
	for (int i = 0; i < 32; i++) {
		vec4 q = uPods[i];
		if (q.z > 0.0005) {
			vec2 dd = p - q.xy;
			m += q.z * exp(-dot(dd, dd) / (2.0 * q.w * q.w));
		}
	}
`}
	m = min(m, 1.0);
	if (m <= 0.02) { OUT(vec4(0.0)); return; }
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
	m = min(m * ${mass ? '(0.78 + 0.42 * bt.r)' : '(0.3 + 1.1 * bt.r)'}, 1.0);
	float sat = min(m * uSatK * (0.2 + 1.6 * n), 1.0); // magnetized influence
	float aMul = 1.0;
	if (uGate > 0.001) {                                // existence gate
		float g = clamp((sat - uGate) / uGate, 0.0, 1.0);
		if (g <= 0.0) { OUT(vec4(0.0)); return; }
		aMul = g * g * (3.0 - 2.0 * g);
	}
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
	float lump = ((w1 + w2 + w3) / 3.0) * (0.04 + 0.22 * reach);
	float feather = clamp(reach * 0.5, 0.008, 0.05); // adaptive feather
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
	float hb = m * uSatK * (0.1 + 2.2 * n) * (0.08 + 0.92 * bn); // deep dips between beads
	float I = pow(clamp(hb * 0.3, 0.0, 1.0), 2.0);
	I = min(1.0, I + clamp((n - 0.88) / 0.12, 0.0, 1.0) * 0.3);
	// plus the big soft temperature patches (subtle, morphing over the loop)
	float mA = sin(uPh), mB = sin(uPh + 2.1), mC = sin(uPh + 4.2);
	float c1 = sin(p.x * uLump * 0.33 + p.y * uLump * 0.21 + 1.7);
	float c2 = sin((p.y * 0.8 - p.x * 0.6) * uLump * 0.27 + 3.1);
	float c3 = sin((p.x + p.y) * uLump * 0.4 + 5.3);
	float mot = (c1 * mA + c2 * mB + c3 * mC) * 0.333 + 0.35 * sin(uPh + 0.9);
	I = clamp(I + mot * 0.05, 0.0, 1.0);
	vec3 col;
	if (I < 0.18) col = vec3(255.0, 40.0, 40.0);
	else if (I < 0.8) { float f = (I - 0.18) / 0.62; col = vec3(255.0, 40.0 + 165.0 * f, 40.0); }
	else { float f = min(1.0, (I - 0.8) / 0.17); col = vec3(255.0, 205.0 - 110.0 * f, 40.0 + 160.0 * f); }
	col = clamp(col * (0.9 + 0.2 * n) * (1.0 + 0.02 * mot) / 255.0, 0.0, 1.0);
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
			lump: gl.getUniformLocation(prog, 'uLump'),
			moff: gl.getUniformLocation(prog, 'uMOff'),
			pods: gl.getUniformLocation(prog, 'uPods'),
			res: gl.getUniformLocation(prog, 'uRes'),
			n: gl.getUniformLocation(prog, 'uN'),
			b: gl.getUniformLocation(prog, 'uB'),
			m: gl.getUniformLocation(prog, 'uM')
		};
		gl.uniform1i(uni.n, 0);
		gl.uniform1i(uni.b, 1);
		gl.uniform1i(uni.m, 2);
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
		// Seed = the full wall in the hairline weight; everything else (cells,
		// pods, beads, distance field) derives from this one bitmap, so all the
		// blob machinery works across the whole wall — goo can bridge rows.
		const seed = document.createElement('canvas'); seed.width = W; seed.height = H;
		const sc = seed.getContext('2d', { willReadFrequently: true });
		sc.fillStyle = '#fff';
		drawWall(sc, o, WGT);
		const sa = sc.getImageData(0, 0, W, H).data;
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
		const maxReach = Math.max(6, letterH * 0.7);
		const nBytes = new Uint8Array(W * H);
		for (let p = 0; p < W * H; p++) nBytes[p] = clamp(1 - Math.sqrt(D[p]) / maxReach, 0, 1) * 255;
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
		nTex = upload(gl.TEXTURE0, nBytes, gl.ALPHA);
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
		if (mass) { stepMass(dt, getOpts()); return; }
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
			if (mass) {
				// Blob 4: newest-first so the HEAD always gets a slot even when
				// the trail overflows the 32-pod budget (overflow = oldest, dim)
				let slot = 0;
				for (let i = nodes.length - 1; i >= 0 && slot < 32; i--, slot++) {
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
		gl.uniform1f(uni.lump, lumpF);
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

// Halftone — a dense dot grid; dot RADIUS comes almost entirely from mask
// coverage (so the letter shapes stay solid and legible — a size-pounding wave
// was what made v1 unreadable) while the travelling wave mostly rides the
// COLOUR plus a light size shimmer. Coverage is supersampled 4× per cell so
// letter edges resolve into clean halftone gradients. Seamless loop.
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
