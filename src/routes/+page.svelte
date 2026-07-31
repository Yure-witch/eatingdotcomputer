<script>
	import { onMount, tick } from 'svelte';

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

	const chars = [...new Set([...phrase, SEP])];
	let slotEm = $state({});       // char → fixed slot width (em)
	let repeats = $state(24);      // phrase copies — recomputed to fill the page
	let fieldEl;
	let reducedMotion = false;
	let morphTimer = null;

	// One field cell per character across all repeats.
	const cells = $derived.by(() => {
		const unit = [...phrase, SEP];
		const out = [];
		for (let r = 0; r < repeats; r++) for (const ch of unit) out.push(ch);
		return out;
	});

	const fontStyle = (f) => `font-family:${f.css}; font-weight:${f.weight}; font-size:${f.scale}em;`;
	// Deterministic initial font per index (SSR-safe — no Math.random in render).
	const initialStyle = (i) => fontStyle(fonts[(i * 7 + 3) % fonts.length]);

	// Morph a single glyph element directly (no reactive churn across the whole
	// field): flip it edge-on, swap face at the midpoint, settle.
	function morphGlyph(g) {
		if (!g) return;
		const ch = g.dataset.ch;
		const swap = () => {
			const f = fonts[Math.floor(Math.random() * fonts.length)];
			g.textContent = ch === ' ' ? '' : ch;
			g.style.cssText = fontStyle(f);
		};
		if (reducedMotion) { swap(); return; }
		g.classList.remove('flip');
		void g.offsetWidth;
		g.classList.add('flip');
		setTimeout(swap, 200);
		setTimeout(() => g.classList.remove('flip'), 440);
	}

	// Morph whatever glyph is under the cursor — a trail of letters flipping
	// under the pointer. ONE mousemove listener, rAF-throttled, hit-testing via
	// elementsFromPoint. (Per-letter mouseover + a forced reflow each fire was
	// the source of the lag.) Already-flipping glyphs are skipped.
	let _ptrX = 0, _ptrY = 0, _ptrQueued = false;
	function onFieldMove(e) {
		_ptrX = e.clientX; _ptrY = e.clientY;
		if (_ptrQueued) return;
		_ptrQueued = true;
		requestAnimationFrame(() => {
			_ptrQueued = false;
			const g = document.elementsFromPoint(_ptrX, _ptrY).find((el) => el.classList?.contains('glyph'));
			if (g && !g.classList.contains('flip')) morphGlyph(g);
		});
	}

	function startMorphing() {
		if (reducedMotion || !fieldEl) return;
		morphTimer = setInterval(() => {
			const all = fieldEl.querySelectorAll('.glyph');
			if (!all.length) return;
			const n = 2 + Math.floor(Math.random() * 3); // 2–4 letters per tick
			for (let k = 0; k < n; k++) morphGlyph(all[Math.floor(Math.random() * all.length)]);
		}, 260);
	}

	// Measure each char's widest form (em) across all faces, then fill the page.
	async function measure() {
		const REF = 100;
		const sample = document.createElement('span');
		Object.assign(sample.style, {
			position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', top: '-9999px', left: '-9999px'
		});
		document.body.appendChild(sample);
		const widths = {};
		for (const ch of chars) {
			if (ch === ' ') { widths[ch] = 0.4; continue; }
			let max = 0;
			for (const f of fonts) {
				sample.style.fontFamily = f.css;
				sample.style.fontWeight = f.weight;
				sample.style.fontSize = `${REF * f.scale}px`;
				sample.textContent = ch;
				const w = sample.getBoundingClientRect().width;
				if (w > max) max = w;
			}
			widths[ch] = Math.max(0.5, Math.ceil((max / REF) * 1000) / 1000);
		}
		document.body.removeChild(sample);
		slotEm = widths;

		// Enough repeats to overflow the viewport (overflow:hidden clips the rest).
		await tick();
		const fontPx = parseFloat(getComputedStyle(fieldEl).fontSize) || 34;
		const unitEm = [...phrase, SEP].reduce((a, ch) => a + (widths[ch] ?? 0.6) + 0.12, 0);
		const unitPx = unitEm * fontPx;
		const cols = Math.ceil(window.innerWidth / unitPx) + 1;
		const rowPx = fontPx * 1.9;
		const rows = Math.ceil(window.innerHeight / rowPx) + 1;
		repeats = Math.min(160, Math.max(8, cols * rows));
	}

	onMount(() => {
		reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		measure();
		document.fonts?.ready?.then(measure);
		startMorphing();
		const onResize = () => measure();
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
			if (morphTimer) clearInterval(morphTimer);
		};
	});
</script>

<svelte:head><title>eating.computer</title></svelte:head>

<main class="field-main">
	<h1 class="sr-only">eating.computer</h1>
	<div class="field" bind:this={fieldEl} aria-hidden="true" onmousemove={onFieldMove}>
		{#each cells as ch, i}
			<span class="slot" class:dot={ch === '.'} style:width={`${slotEm[ch] ?? 0.6}em`}>
				<span class="glyph" data-ch={ch} style={initialStyle(i)}>{ch === ' ' ? '' : ch}</span>
			</span>
		{/each}
	</div>
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

	.field {
		position: absolute;
		inset: 0;
		display: flex;
		flex-wrap: wrap;
		align-content: center;
		justify-content: center;
		gap: 0.12em 0.02em;
		padding: 0;
		font-size: clamp(1.3rem, 3.4vw, 2.6rem);
		line-height: 1;
		/* Very low contrast against the paper — a quiet texture the log-in
		   button reads clearly over. */
		color: color-mix(in srgb, var(--ink) 12%, var(--paper));
		user-select: none;
		box-sizing: border-box;
	}

	.slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		height: 1.4em;
		perspective: 500px; /* depth for the glyph's split-flap flip */
	}
	/* keep the dot a touch warmer than the letters, still low-contrast */
	.slot.dot .glyph { color: color-mix(in srgb, var(--accent) 30%, var(--paper)); }

	.glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		backface-visibility: hidden;
		white-space: nowrap;
		transform-origin: center;
	}
	.glyph.flip { animation: glyph-flip 0.44s cubic-bezier(0.5, 0, 0.5, 1); }
	@keyframes glyph-flip {
		0%   { transform: rotateX(0deg); }
		46%  { transform: rotateX(88deg); }
		54%  { transform: rotateX(-88deg); }
		100% { transform: rotateX(0deg); }
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

	@media (prefers-reduced-motion: reduce) {
		.glyph.flip { animation: none; }
	}
</style>
