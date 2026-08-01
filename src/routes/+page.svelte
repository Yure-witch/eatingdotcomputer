<script>
	import { onMount } from 'svelte';

	const phrase = 'eating.computer';
	const SEP = ' '; // gap slot between repeats

	// The cast of display faces each glyph morphs through. `scale` balances
	// their visual size, `weight` picks the loaded cut.
	const fonts = [
		{ css: '"Avara", "Old English Text MT", serif',          scale: 1.5,  weight: 700 },
		{ css: '"Space Grotesk", Arial, sans-serif',             scale: 1.2,  weight: 600 },
		{ css: '"Playfair Display", Georgia, serif',             scale: 1.42, weight: 800 },
		{ css: '"Pacifico", "Brush Script MT", cursive',         scale: 1.25, weight: 400 },
		{ css: '"UnifrakturCook", "Old English Text MT", serif', scale: 1.6,  weight: 700 },
		{ css: '"Bungee", Impact, sans-serif',                   scale: 1.0,  weight: 400 },
		{ css: '"Space Mono", ui-monospace, monospace',          scale: 1.15, weight: 700 },
		{ css: '"Caveat", "Comic Sans MS", cursive',             scale: 1.85, weight: 700 },
		{ css: '"Monoton", sans-serif',                          scale: 1.2,  weight: 400 },
		{ css: '"Rye", Georgia, serif',                          scale: 1.25, weight: 400 },
		{ css: '"Silkscreen", "Press Start 2P", monospace',      scale: 1.05, weight: 400 },
		{ css: '"Press Start 2P", monospace',                    scale: 0.9,  weight: 400 }
	];

	let canvasEl;

	onMount(() => {
		const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		const ctx = canvasEl.getContext('2d');
		let cells = [];              // { ch, cx, cy, w, isDot, fi }
		let dpr = 1, cssW = 0, cssH = 0, fontPx = 34;
		let inkRGB = '10,10,10', accentRGB = '255,163,5';
		let drawQueued = false, ambientTimer = null, destroyed = false;
		let pointer = { x: -1, y: -1, moved: false };
		let lastHover = null;

		const fontStr = (fi, px) => `${fonts[fi].weight} ${px * fonts[fi].scale}px ${fonts[fi].css}`;

		function readColors() {
			const cs = getComputedStyle(document.documentElement);
			const toRGB = (v, fb) => {
				v = (v || '').trim();
				if (/^#([0-9a-f]{6})$/i.test(v)) {
					const n = parseInt(v.slice(1), 16);
					return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
				}
				const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
				return m ? `${m[1]},${m[2]},${m[3]}` : fb;
			};
			inkRGB = toRGB(cs.getPropertyValue('--ink'), '10,10,10');
			accentRGB = toRGB(cs.getPropertyValue('--accent'), '255,163,5');
		}

		// Widest form of each character across all faces (px), so a face swap
		// never changes the cell width.
		function measureSlots() {
			const out = {};
			const pad = fontPx * 0.06;
			for (const ch of new Set([...phrase, SEP])) {
				if (ch === ' ') { out[ch] = fontPx * 0.4; continue; }
				let max = 0;
				for (let fi = 0; fi < fonts.length; fi++) {
					ctx.font = fontStr(fi, fontPx);
					const w = ctx.measureText(ch).width;
					if (w > max) max = w;
				}
				out[ch] = max + pad;
			}
			return out;
		}

		// Lay the repeated phrase out into rows that wrap and bleed past both
		// edges, vertically centered — the same woven field as before.
		function layout() {
			dpr = Math.min(2, window.devicePixelRatio || 1);
			cssW = window.innerWidth;
			cssH = window.innerHeight;
			fontPx = Math.max(20, Math.min(0.034 * cssW, 42));
			canvasEl.width = Math.round(cssW * dpr);
			canvasEl.height = Math.round(cssH * dpr);
			canvasEl.style.width = cssW + 'px';
			canvasEl.style.height = cssH + 'px';
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			const slot = measureSlots();
			const rowH = fontPx * 1.5;
			const rows = Math.ceil(cssH / rowH) + 1;
			const y0 = (cssH - rows * rowH) / 2 + rowH / 2;
			const stream = [...phrase, SEP];
			cells = [];
			let si = 0;
			for (let r = 0; r < rows; r++) {
				// consume chars until the row overflows, then centre it (bleed).
				const row = [];
				let rw = 0;
				while (rw < cssW + fontPx) {
					const ch = stream[si % stream.length]; si++;
					const w = slot[ch];
					row.push({ ch, w });
					rw += w + fontPx * 0.02;
				}
				let x = (cssW - rw) / 2;
				const cy = y0 + r * rowH;
				for (const c of row) {
					if (c.ch !== ' ') {
						cells.push({
							ch: c.ch, cx: x + c.w / 2, cy, w: c.w,
							isDot: c.ch === '.', fi: (cells.length * 7 + 3) % fonts.length
						});
					}
					x += c.w + fontPx * 0.02;
				}
			}
			draw();
		}

		function draw() {
			ctx.clearRect(0, 0, cssW, cssH);
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			for (const cell of cells) {
				ctx.font = fontStr(cell.fi, fontPx);
				ctx.fillStyle = cell.isDot ? `rgba(${accentRGB},0.34)` : `rgba(${inkRGB},0.13)`;
				ctx.fillText(cell.ch, cell.cx, cell.cy);
			}
		}
		// Coalesce redraws to one per frame (a burst of morphs = one draw).
		function queueDraw() {
			if (drawQueued || destroyed) return;
			drawQueued = true;
			requestAnimationFrame(() => { drawQueued = false; draw(); });
		}

		// Hard swap — pick a new face instantly, no transition.
		function morph(cell) {
			if (!cell) return;
			let to = cell.fi; while (to === cell.fi) to = (Math.random() * fonts.length) | 0;
			cell.fi = to;
			queueDraw();
		}

		// Pointer hit-test on a plain-JS cell scan, rAF-throttled.
		function onMove(e) {
			pointer.x = e.clientX; pointer.y = e.clientY;
			if (pointer.moved) return;
			pointer.moved = true;
			requestAnimationFrame(() => {
				pointer.moved = false;
				const half = fontPx * 0.75;
				let hit = null;
				for (const c of cells) {
					if (Math.abs(pointer.x - c.cx) <= c.w / 2 && Math.abs(pointer.y - c.cy) <= half) { hit = c; break; }
				}
				if (hit && hit !== lastHover) morph(hit);
				lastHover = hit;
			});
		}

		// Ambient morphing — a few random cells swap on their own.
		function startAmbient() {
			if (reduced) return;
			ambientTimer = setInterval(() => {
				if (!cells.length || document.hidden) return;
				const n = 2 + ((Math.random() * 3) | 0);
				for (let k = 0; k < n; k++) morph(cells[(Math.random() * cells.length) | 0]);
			}, 400);
		}

		readColors();
		let ro;
		// Fonts must be loaded before measuring or the widths are wrong.
		(document.fonts?.ready ?? Promise.resolve()).then(() => { if (!destroyed) layout(); });
		layout(); // first pass with fallback metrics; re-laid out once fonts land
		startAmbient();
		window.addEventListener('mousemove', onMove, { passive: true });
		window.addEventListener('resize', () => { readColors(); layout(); });

		return () => {
			destroyed = true;
			clearInterval(ambientTimer);
			window.removeEventListener('mousemove', onMove);
		};
	});
</script>

<svelte:head><title>eating.computer</title></svelte:head>

<main class="field-main">
	<h1 class="sr-only">eating.computer</h1>
	<canvas class="field-canvas" bind:this={canvasEl} aria-hidden="true"></canvas>
	<a class="login-chip" href="/login">log in</a>
</main>

<style>
	.field-main {
		position: relative;
		min-height: 100dvh;
		width: 100%;
		overflow: hidden;
		background: var(--paper);
		padding: 0;
		display: block;
	}

	.field-canvas {
		position: absolute;
		inset: 0;
		display: block;
	}

	/* A solid, legible focal point over the shifting field. */
	.login-chip {
		position: absolute;
		left: 50%; top: 50%;
		transform: translate(-50%, -50%);
		z-index: 2;
		font-family: 'Space Grotesk', sans-serif;
		font-size: clamp(0.95rem, 2.4vw, 1.15rem);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--paper);
		background: var(--ink);
		text-decoration: none;
		padding: 0.7rem 1.6rem;
		border-radius: 999px;
		box-shadow: 0 10px 34px rgba(0, 0, 0, 0.22);
		transition: transform 0.15s ease, background 0.2s;
	}
	.login-chip:hover {
		background: var(--accent);
		color: var(--ink);
		transform: translate(-50%, -50%) scale(1.04);
	}

	.sr-only {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
	}
</style>
