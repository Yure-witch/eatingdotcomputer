<script>
	import { onMount } from 'svelte';
	import { PRESETS, encodeGif, supportsFontStretch } from '$lib/gif-studio.js';
	import { SCENES, makeScene } from '$lib/gen-art.js';

	// ── State ──────────────────────────────────────────────────────────────
	let mode = $state('bz');            // scene id
	let text = $state('Interactive Design');
	let subtitle = $state('Fall 2026');
	let preset = $state('spotlight');    // kinetic-type sub-preset
	let cycles = $state(1);
	let fontFrac = $state(0.30);
	let repeats = $state(14);            // Step & Repeat: number of stacked lines (rows)
	let tileCols = $state(1);            // Step & Repeat: number of side-by-side columns
	let tileGap = $state(0.02);          // Step & Repeat: gap between columns (fraction of width)
	let spread = $state(1.6);            // Step & Repeat: wave cycles down the stack
	let reactionSpeed = $state(1.5);     // sim iterations/motion advanced per frame (BZ/CA/flow/walk/cloth)
	let gifSpeed = $state(1);            // playback rate multiplier (frame delay)
	let bzRound = $state(6);             // BZ: wavefront roundedness level (0..15)
	let bzBands = $state(20);            // BZ: gradient steps (posterise the fade)
	let bzSpacing = $state(0.4);         // BZ: distance between waves (refractory length)
	let bzFade = $state(0.5);            // BZ: trailing tail length (0 = single line)
	// Wave Wall (lorem) — travelling weight wave over a wall of repeated type.
	let lwRows = $state(18);             // number of stacked text rows
	let lwCols = $state(2);              // number of side-by-side text columns
	let lwPeriod = $state(8);            // wave length, in glyph cells
	let lwDiag = $state(1.2);            // per-row phase offset → diagonal sweep
	let lwAmp = $state(1);               // weight punch (fraction of the wght range)
	let lwLoops = $state(1);             // full wave periods per GIF loop (seamless)
	let htSize = $state(1);              // Halftone: dot pitch multiplier
	let moCell = $state(1);              // Micro Type: cell size multiplier
	let scAmp = $state(1);               // Particles: scatter distance multiplier
	let cmAmount = $state(0.5);          // Color Metaballs: influence strength / colour coverage
	let cmGate = $state(0.12);           // Blob 2/3: existence gate (min influence before any blob shows)
	let b3Rows = $state(1);              // Blob 3: step & repeat rows
	let b3Cols = $state(1);              // Blob 3: step & repeat columns
	let b3Gap = $state(0.02);            // Blob 3: column gap (fraction of width, can be negative)
	let b3Speed = $state(1);             // Blob 3-C Fast: sim tempo multiplier

	const activeScene = $derived(SCENES.find((s) => s.id === mode) ?? SCENES[0]);
	const usesPreset = $derived(activeScene.usesPreset);
	// Modes that actually consume the Reaction speed / Wobble slider.
	const SIM_MODES = new Set(['bz', 'cca', 'flow', 'walk', 'cloth', 'meta', 'cmeta', 'blobc', 'blobc2', 'blobc3', 'blobc3n', 'blobc3f', 'blobc4', 'blobc5', 'blobc6', 'blobc62', 'blobc63', 'blobc64', 'blobc65', 'blobc66']);
	const WOBBLE_MODES = new Set(['meta', 'cmeta', 'blobc', 'blobc2', 'blobc3n']); // slider = wobble cycles per loop (blob3-c: decisions/sec)

	// Background / colours
	let bgType = $state('radial');
	let bg = $state('#0b0b10');
	let bg2 = $state('#1a1030');
	let fg = $state('#ffffff');
	let accent = $state('#7c9cff');

	// Output
	const ASPECTS = {
		'16:9': { w: 960, h: 540, label: 'Wide 16:9' },
		'1:1':  { w: 720, h: 720, label: 'Square 1:1' },
		'9:16': { w: 540, h: 960, label: 'Story 9:16' },
		'4:3':  { w: 900, h: 675, label: 'Classic 4:3' }
	};
	let aspect = $state('16:9');
	// Resolution = the output's LONG edge in px; the other edge follows the aspect.
	const RES = [360, 480, 640, 720, 960, 1280, 1600, 1920];
	let resolution = $state(720);
	// Export pixel dims at the chosen resolution (long edge = resolution).
	const outDims = $derived.by(() => {
		const b = ASPECTS[aspect];
		const long = Math.max(b.w, b.h);
		const s = resolution / long;
		return { w: Math.round(b.w * s), h: Math.round(b.h * s) };
	});
	// Preview renders at a capped size so the sim grid stays small and the preview
	// stays smooth to interact with; the EXPORT uses full outDims (offline, so it
	// affords a much larger grid → crisp). The look matches because the sim's
	// pattern params scale with grid size.
	const PREVIEW_MAX = 900;
	const previewDims = $derived.by(() => {
		const d = outDims, long = Math.max(d.w, d.h);
		if (long <= PREVIEW_MAX) return d;
		const s = PREVIEW_MAX / long;
		return { w: Math.round(d.w * s), h: Math.round(d.h * s) };
	});
	let duration = $state(3);
	let fps = $state(20);

	// Palette presets (bg, bg2, fg, accent, bgType)
	const PALETTES = [
		{ name: 'Midnight', bg: '#0b0b10', bg2: '#1a1030', fg: '#ffffff', accent: '#7c9cff', bgType: 'radial' },
		{ name: ' Inkwell', bg: '#0c0c0c', bg2: '#0c0c0c', fg: '#f5f2ea', accent: '#e8b84b', bgType: 'solid' },
		{ name: 'Sunset',  bg: '#2a0a2e', bg2: '#7a1f4f', fg: '#ffe9d6', accent: '#ff8f5e', bgType: 'gradient' },
		{ name: 'Mint',    bg: '#04231d', bg2: '#0a4a3a', fg: '#eafff6', accent: '#57e0a8', bgType: 'gradient' },
		{ name: 'Paper',   bg: '#f5f2ea', bg2: '#e6ddc9', fg: '#161512', accent: '#c0392b', bgType: 'radial' },
		{ name: 'Vapor',   bg: '#120a2e', bg2: '#3a1a6e', fg: '#f0eaff', accent: '#ff6ac1', bgType: 'gradient' }
	];
	function applyPalette(p) { bg = p.bg; bg2 = p.bg2; fg = p.fg; accent = p.accent; bgType = p.bgType; }
	function selectMode(id) {
		mode = id;
		// The colour-metaball modes are designed around white paper + gray
		// hairline type, with colour only in the revealed areas — set that
		// stage on entry (still overridable via the colour controls).
		if (id === 'cmeta' || id === 'blobc' || id.startsWith('blobc')) {
			bgType = 'solid'; bg = '#ffffff'; fg = '#9ba1a8';
			reactionSpeed = 1; duration = (id === 'cmeta' || id === 'blobc' || id === 'blobc2') ? 4 : 6;
		}
	}
	// Set a colour from a typed hex string (any 3- or 6-digit hex, with/without #).
	function setHex(which, val) {
		let s = String(val).trim();
		if (s && s[0] !== '#') s = '#' + s;
		if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return; // wait for a valid value
		if (which === 'bg') bg = s; else if (which === 'fg') fg = s;
		else if (which === 'accent') accent = s; else if (which === 'bg2') bg2 = s;
	}

	// ── Canvas / preview ───────────────────────────────────────────────────
	let canvasEl = $state(null);
	let hasStretch = $state(true);
	let fontsReady = $state(false);
	let playing = $state(true);

	// Live opts snapshot read by the active scene each frame (colours, preset,
	// speed update live; text/dims changes rebuild the scene — see below).
	function liveOpts() {
		return {
			text, subtitle: subtitle.trim(), preset, cycles, duration, spread, repeats, tileCols, tileGap, reactionSpeed,
			bzRound, bzBands, bzSpacing, bzFade,
			lwRows, lwCols, lwPeriod, lwDiag, lwAmp, lwLoops,
			htSize, moCell, scAmp, cmAmount, cmGate, b3Rows, b3Cols, b3Gap, b3Speed,
			bg, bg2, fg, accent, bgType,
			fontFamily: "'Google Sans Flex'", fontFrac, hasStretch
		};
	}

	let scene = null;
	let previewCtx = null;

	// (Re)build the scene when structural inputs change — mode, text, aspect,
	// text size — so the simulation reseeds from the new typography / dimensions.
	// Colours, preset and speed are read live by the scene and don't rebuild.
	$effect(() => {
		void [mode, text, aspect, resolution, fontFrac, fontsReady, b3Rows, b3Cols, b3Gap];
		const cv = canvasEl;
		if (!cv) return;
		scene = makeScene(mode, { W: cv.width, H: cv.height, getOpts: liveOpts, seed: 1337 });
		if (previewCtx) scene.render(previewCtx);
	});
	// Repaint on a colour / preset change even while paused.
	$effect(() => {
		void [bg, bg2, fg, accent, bgType, preset, cycles, spread, repeats, tileCols, tileGap, reactionSpeed, bzRound, bzBands, bzSpacing, bzFade, lwRows, lwCols, lwPeriod, lwDiag, lwAmp, lwLoops, htSize, moCell, scAmp, cmAmount, cmGate, b3Speed];
		if (scene && previewCtx && !playing) scene.render(previewCtx);
	});

	onMount(() => {
		hasStretch = supportsFontStretch();
		// NO willReadFrequently here: it forces a CPU-backed canvas, and then
		// every drawImage from a WebGL canvas does a GPU→CPU readback per frame
		// — which throttled the GPU blob modes to a few fps ("position updates
		// every 0.2s"). The preview never reads pixels back; only encodeGif's
		// own offscreen canvas needs that flag.
		previewCtx = canvasEl.getContext('2d');
		// Preload the variable font (both weight extremes) so the first frames
		// aren't drawn in the fallback face.
		(async () => {
			try {
				await Promise.all([
					document.fonts.load("100 80px 'Google Sans Flex'"),
					document.fonts.load("700 80px 'Google Sans Flex'")
				]);
				await document.fonts.ready;
			} catch {}
			fontsReady = true;
		})();

		// Frame-accurate preview: advance ONE GIF-frame per displayed frame, throttled
		// to the actual playback rate (fps × GIF speed). So the preview is exactly what
		// the exported GIF looks like — same per-frame reaction advance, same play rate.
		let raf = 0, last = performance.now(), accT = 0;
		const loop = (now) => {
			const dt = Math.min((now - last) / 1000, 0.1); last = now;
			if (playing && scene && previewCtx) {
				if (activeScene.smooth) {
					// Continuous-time scene: run the PREVIEW at full display rate
					// (step by real elapsed time × GIF speed). The export still
					// bakes at the chosen fps — this only makes the live view silky.
					scene.step(dt * gifSpeed);
					scene.render(previewCtx);
				} else {
					const interval = 1 / Math.max(1, fps * gifSpeed); // seconds between displayed frames
					accT += dt;
					if (accT >= interval) {
						// Carry the REMAINDER instead of zeroing: a zeroed accumulator
						// made the real cadence wander between 3 and 4 display frames
						// per step (50/66.7ms), which reads as micro-stutter on
						// smoothly-translating scenes. Cap at one interval so lag
						// can't spiral.
						accT = Math.min(accT - interval, interval);
						scene.step(1 / fps);
						scene.render(previewCtx);
					}
				}
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});

	// ── Export ───────────────────────────────────────────────────────────────
	let exporting = $state(false);
	let progress = $state(0);

	async function exportGif() {
		if (exporting) return;
		exporting = true; progress = 0;
		try {
			const W = outDims.w, H = outDims.h;
			const frames = Math.max(2, Math.round(duration * fps));
			// Fresh scene at export resolution, reset — encodeGif steps it per frame.
			const exportScene = makeScene(mode, { W, H, getOpts: liveOpts, seed: 1337 });
			const bytes = await encodeGif({
				W, H, fps, frames, scene: exportScene,
				delayMs: (1000 / fps) / gifSpeed,   // GIF speed = playback rate
				onProgress: (p) => { progress = p; }
			});
			const blob = new Blob([bytes], { type: 'image/gif' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = (text.trim() || 'title').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.gif';
			document.body.appendChild(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		} catch (e) {
			console.error('[gif-studio] export failed', e);
			alert('GIF export failed — ' + (e?.message || e));
		} finally {
			exporting = false;
		}
	}
</script>

<svelte:head><title>GIF Studio — eating.computer</title></svelte:head>

<div class="shell">
	<div class="topbar">
		<a class="back" href="/app/lab" aria-label="Back to Lab">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</a>
		<h1>GIF Studio</h1>
		<button class="export-btn" onclick={exportGif} disabled={exporting || !text.trim()}>
			{#if exporting}Rendering {Math.round(progress * 100)}%{:else}Export GIF{/if}
		</button>
	</div>

	{#if exporting}
		<div class="progress"><span style:width="{progress * 100}%"></span></div>
	{/if}

	<div class="studio">
		<!-- Preview -->
		<div class="preview-wrap">
			<div class="preview-frame" class:portrait={previewDims.h > previewDims.w}>
				<canvas bind:this={canvasEl} width={previewDims.w} height={previewDims.h}></canvas>
			</div>
			<div class="preview-actions">
				<button class="chip" onclick={() => (playing = !playing)}>
					{playing ? '⏸ Pause' : '▶ Play'}
				</button>
				{#if !hasStretch}
					<span class="hint">Width axis not supported in this browser — using weight only.</span>
				{/if}
			</div>
		</div>

		<!-- Controls -->
		<div class="controls">
			<label class="field">
				<span>Title</span>
				<input type="text" bind:value={text} placeholder="Your title" maxlength="40" />
			</label>
			<label class="field">
				<span>Subtitle <em>(optional)</em></span>
				<input type="text" bind:value={subtitle} placeholder="e.g. Fall 2026" maxlength="40" />
			</label>

			<div class="group">
				<span class="group-label">Mode</span>
				<div class="preset-grid">
					{#each SCENES as s}
						<button class="preset mode" class:on={mode === s.id} onclick={() => selectMode(s.id)}>{s.name}</button>
					{/each}
				</div>
			</div>

			{#if usesPreset}
				<div class="group">
					<span class="group-label">{mode === 'sort' ? 'Base animation' : 'Animation'}</span>
					<div class="preset-grid">
						{#each PRESETS as p}
							<button class="preset" class:on={preset === p.id} onclick={() => (preset = p.id)}>{p.name}</button>
						{/each}
					</div>
				</div>
			{/if}

			<div class="group">
				<span class="group-label">Palette</span>
				<div class="palette-row">
					{#each PALETTES as p}
						<button class="swatch" title={p.name} onclick={() => applyPalette(p)}
							style="background:{p.bgType === 'solid' ? p.bg : `linear-gradient(135deg, ${p.bg2}, ${p.bg})`}">
							<span class="swatch-dot" style:background={p.accent}></span>
							<span class="swatch-fg" style:background={p.fg}></span>
						</button>
					{/each}
				</div>
				<div class="color-grid">
					<div class="color-field">
						<span>Background</span>
						<span class="ci"><input type="color" bind:value={bg} /><input class="hex" value={bg} maxlength="7" oninput={(e) => setHex('bg', e.currentTarget.value)} /></span>
					</div>
					<div class="color-field">
						<span>Text</span>
						<span class="ci"><input type="color" bind:value={fg} /><input class="hex" value={fg} maxlength="7" oninput={(e) => setHex('fg', e.currentTarget.value)} /></span>
					</div>
					<div class="color-field">
						<span>Accent</span>
						<span class="ci"><input type="color" bind:value={accent} /><input class="hex" value={accent} maxlength="7" oninput={(e) => setHex('accent', e.currentTarget.value)} /></span>
					</div>
					<div class="color-field">
						<span>Bg 2 <em>(gradient)</em></span>
						<span class="ci"><input type="color" bind:value={bg2} /><input class="hex" value={bg2} maxlength="7" oninput={(e) => setHex('bg2', e.currentTarget.value)} /></span>
					</div>
				</div>
				<div class="seg">
					{#each ['solid', 'gradient', 'radial'] as bt}
						<button class:on={bgType === bt} onclick={() => (bgType = bt)}>{bt}</button>
					{/each}
				</div>
			</div>

			<div class="group">
				<span class="group-label">Shape</span>
				<div class="seg wrap">
					{#each Object.entries(ASPECTS) as [key, a]}
						<button class:on={aspect === key} onclick={() => (aspect = key)}>{a.label}</button>
					{/each}
				</div>
				<span class="group-label" style="margin-top:0.35rem">Resolution <em style="font-weight:400;color:var(--muted-fg)">— {outDims.w}×{outDims.h}px</em></span>
				<div class="seg wrap">
					{#each RES as r}
						<button class:on={resolution === r} onclick={() => (resolution = r)}>{r}p</button>
					{/each}
				</div>
			</div>

			<div class="group sliders">
				{#if mode === 'tile'}
					<label class="slider">
						<span>Repeats <b>{repeats}</b></span>
						<input type="range" min="3" max="30" step="1" bind:value={repeats} />
					</label>
				{:else if mode === 'lorem'}
					<label class="slider">
						<span>Rows <b>{lwRows}</b></span>
						<input type="range" min="4" max="40" step="1" bind:value={lwRows} />
					</label>
				{:else}
					<label class="slider">
						<span>Text size <b>{Math.round(fontFrac * 100)}</b></span>
						<input type="range" min="16" max="46" value={Math.round(fontFrac * 100)}
							oninput={(e) => (fontFrac = +e.currentTarget.value / 100)} />
					</label>
				{/if}
				<label class="slider">
					<span>Duration <b>{duration}s</b></span>
					<input type="range" min="1" max="6" step="0.5" bind:value={duration} />
				</label>
				{#if usesPreset}
					<label class="slider">
						<span>Animation speed <b>{cycles}×</b></span>
						<input type="range" min="1" max="4" step="1" bind:value={cycles} />
					</label>
				{:else if SIM_MODES.has(mode)}
					<label class="slider">
						<span>{WOBBLE_MODES.has(mode) ? 'Wobble' : 'Reaction speed'} <b>{WOBBLE_MODES.has(mode) ? Math.max(1, Math.round(reactionSpeed)) + '×' : reactionSpeed.toFixed(2)}</b></span>
						<input type="range" min="0.2" max="6" step="0.1" bind:value={reactionSpeed} />
					</label>
				{/if}
				<label class="slider">
					<span>GIF speed <b>{gifSpeed.toFixed(2)}×</b></span>
					<input type="range" min="0.25" max="3" step="0.05" bind:value={gifSpeed} />
				</label>
				{#if mode === 'tile'}
					<label class="slider">
						<span>Columns <b>{tileCols}</b></span>
						<input type="range" min="1" max="5" step="1" bind:value={tileCols} />
					</label>
					{#if tileCols > 1}
						<label class="slider">
							<span>Column gap <b>{(tileGap * 100).toFixed(1)}%</b></span>
							<input type="range" min="-0.12" max="0.12" step="0.005" bind:value={tileGap} />
						</label>
					{/if}
					<label class="slider">
						<span>Wave spread <b>{spread.toFixed(1)}</b></span>
						<input type="range" min="0.4" max="5" step="0.1" bind:value={spread} />
					</label>
				{/if}
				{#if mode === 'lorem'}
					<label class="slider">
						<span>Columns <b>{lwCols}</b></span>
						<input type="range" min="1" max="5" step="1" bind:value={lwCols} />
					</label>
					<label class="slider">
						<span>Wave speed <b>{lwLoops}×</b></span>
						<input type="range" min="1" max="6" step="1" bind:value={lwLoops} />
					</label>
					<label class="slider">
						<span>Wave length <b>{lwPeriod}</b></span>
						<input type="range" min="2" max="24" step="1" bind:value={lwPeriod} />
					</label>
					<label class="slider">
						<span>Diagonal <b>{lwDiag.toFixed(1)}</b></span>
						<input type="range" min="0" max="4" step="0.1" bind:value={lwDiag} />
					</label>
					<label class="slider">
						<span>Weight punch <b>{Math.round(lwAmp * 100)}</b></span>
						<input type="range" min="0" max="100" value={Math.round(lwAmp * 100)}
							oninput={(e) => (lwAmp = +e.currentTarget.value / 100)} />
					</label>
				{/if}
				{#if mode === 'cmeta' || mode === 'blobc' || mode === 'blobc2' || mode.startsWith('blobc3') || mode === 'blobc4'}
					<label class="slider">
						<span>Color amount <b>{Math.round(cmAmount * 100)}%</b></span>
						<input type="range" min="0.05" max="0.9" step="0.05" bind:value={cmAmount} />
					</label>
				{/if}
				{#if mode === 'blobc2' || mode.startsWith('blobc3') || mode === 'blobc4' || mode === 'blobc64'}
					<label class="slider">
						<span>Gate <b>{cmGate.toFixed(3)}</b></span>
						<input type="range" min="0" max="0.15" step="0.005" bind:value={cmGate} />
					</label>
				{/if}
				{#if mode === 'blobc3f'}
					<label class="slider">
						<span>Speed <b>{b3Speed.toFixed(2)}×</b></span>
						<input type="range" min="0.25" max="4" step="0.05" bind:value={b3Speed} />
					</label>
				{/if}
				{#if mode.startsWith('blobc3') || mode === 'blobc4' || mode === 'blobc5' || mode.startsWith('blobc6')}
					<label class="slider">
						<span>Repeats <b>{b3Rows}</b></span>
						<input type="range" min="1" max="12" step="1" bind:value={b3Rows} />
					</label>
					<label class="slider">
						<span>Columns <b>{b3Cols}</b></span>
						<input type="range" min="1" max="4" step="1" bind:value={b3Cols} />
					</label>
					{#if b3Cols > 1}
						<label class="slider">
							<span>Column gap <b>{(b3Gap * 100).toFixed(1)}%</b></span>
							<input type="range" min="-0.12" max="0.12" step="0.005" bind:value={b3Gap} />
						</label>
					{/if}
				{/if}
				{#if mode === 'dots'}
					<label class="slider">
						<span>Dot size <b>{htSize.toFixed(2)}</b></span>
						<input type="range" min="0.6" max="1.8" step="0.05" bind:value={htSize} />
					</label>
				{/if}
				{#if mode === 'mosaic'}
					<label class="slider">
						<span>Cell size <b>{moCell.toFixed(2)}</b></span>
						<input type="range" min="0.6" max="1.8" step="0.05" bind:value={moCell} />
					</label>
				{/if}
				{#if mode === 'scatter'}
					<label class="slider">
						<span>Scatter <b>{scAmp.toFixed(2)}</b></span>
						<input type="range" min="0.3" max="2" step="0.05" bind:value={scAmp} />
					</label>
				{/if}
				{#if mode === 'bz'}
					<label class="slider">
						<span>Roundedness <b>{bzRound}</b></span>
						<input type="range" min="0" max="15" step="1" bind:value={bzRound} />
					</label>
					<label class="slider">
						<span>Spacing <b>{bzSpacing.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={bzSpacing} />
					</label>
					<label class="slider">
						<span>Fade <b>{bzFade.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={bzFade} />
					</label>
					<label class="slider">
						<span>Gradient steps <b>{bzBands}</b></span>
						<input type="range" min="2" max="24" step="1" bind:value={bzBands} />
					</label>
				{/if}
				<label class="slider">
					<span>Smoothness <b>{fps}fps</b></span>
					<input type="range" min="10" max="30" step="2" bind:value={fps} />
				</label>
			</div>
		</div>
	</div>
</div>

<style>
	.shell {
		min-height: 100dvh;
		background: var(--paper);
		padding-top: 52px;
		box-sizing: border-box;
	}
	.topbar {
		position: sticky;
		top: 52px;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1.25rem;
		background: var(--paper);
		border-bottom: 1.5px solid var(--border);
	}
	.back {
		display: inline-flex; align-items: center; justify-content: center;
		width: 2.1rem; height: 2.1rem; border-radius: 10px;
		color: var(--ink); text-decoration: none;
		background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.05));
	}
	.back:active { background: color-mix(in srgb, var(--ink) 12%, transparent); }
	.topbar h1 { font-family: 'Avara', serif; font-weight: 400; font-size: 1.2rem; margin: 0; flex: 1; color: var(--ink); }
	.export-btn {
		border: none; border-radius: 10px;
		padding: 0.55rem 1.15rem;
		background: var(--accent); color: #fff;
		font-family: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
		min-width: 8rem;
	}
	.export-btn:disabled { opacity: 0.5; cursor: default; }
	.progress { height: 3px; background: color-mix(in srgb, var(--accent) 22%, transparent); }
	.progress span { display: block; height: 100%; background: var(--accent); transition: width 0.1s linear; }

	.studio {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
		gap: 1.5rem;
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem;
		box-sizing: border-box;
	}

	.preview-wrap { position: sticky; top: calc(52px + 4rem); align-self: start; }
	.preview-frame {
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 12px 40px -14px rgba(0,0,0,0.6);
		border: 1px solid var(--border);
		background: #000;
	}
	.preview-frame canvas { display: block; width: 100%; height: auto; }
	.preview-frame.portrait { max-width: 340px; margin: 0 auto; }
	.preview-actions { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.75rem; }
	.hint { font-size: 0.72rem; color: var(--muted-fg); }

	.controls { display: flex; flex-direction: column; gap: 1.15rem; }
	.field { display: flex; flex-direction: column; gap: 0.3rem; }
	.field span { font-size: 0.78rem; font-weight: 600; color: var(--ink); }
	.field em { color: var(--muted-fg); font-weight: 400; font-style: normal; }
	.field input {
		padding: 0.55rem 0.7rem;
		border: 1.5px solid var(--border);
		border-radius: 9px;
		background: var(--paper);
		color: var(--ink);
		font-family: inherit;
		font-size: 0.9rem;
	}
	.field input:focus { outline: none; border-color: var(--accent); }

	.group { display: flex; flex-direction: column; gap: 0.5rem; }
	.group-label { font-size: 0.78rem; font-weight: 600; color: var(--ink); }

	.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 0.4rem; }
	.preset {
		padding: 0.5rem 0.4rem; border: 1.5px solid var(--border); border-radius: 9px;
		background: var(--paper); color: var(--ink);
		font-family: inherit; font-size: 0.78rem; cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.preset.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); font-weight: 600; }
	.preset.mode { font-weight: 500; }
	.preset.mode.on { background: var(--accent); color: #fff; border-color: var(--accent); }

	.palette-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.swatch {
		position: relative; width: 44px; height: 44px; border-radius: 10px;
		border: 1.5px solid var(--border); cursor: pointer; overflow: hidden; padding: 0;
	}
	.swatch-dot { position: absolute; bottom: 5px; right: 5px; width: 9px; height: 9px; border-radius: 50%; }
	.swatch-fg { position: absolute; top: 6px; left: 6px; width: 14px; height: 4px; border-radius: 2px; }

	.color-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 0.7rem; }
	.color-field { display: flex; flex-direction: column; gap: 0.22rem; }
	.color-field > span { font-size: 0.72rem; font-weight: 600; color: var(--ink); }
	.color-field em { color: var(--muted-fg); font-weight: 400; font-style: normal; }
	.ci { display: flex; align-items: center; gap: 0.35rem; }
	.ci input[type='color'] { width: 30px; height: 30px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 7px; background: none; padding: 0; cursor: pointer; }
	.ci .hex {
		flex: 1; min-width: 0; width: 100%;
		padding: 0.34rem 0.45rem; border: 1.5px solid var(--border); border-radius: 7px;
		background: var(--paper); color: var(--ink);
		font-family: ui-monospace, monospace; font-size: 0.78rem; text-transform: lowercase;
	}
	.ci .hex:focus { outline: none; border-color: var(--accent); }

	.seg { display: flex; gap: 0; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; width: fit-content; }
	.seg.wrap { flex-wrap: wrap; width: 100%; }
	.seg button {
		flex: 1; padding: 0.45rem 0.8rem; border: none; background: var(--paper); color: var(--ink);
		font-family: inherit; font-size: 0.78rem; cursor: pointer; text-transform: capitalize;
		border-right: 1px solid var(--border);
	}
	.seg button:last-child { border-right: none; }
	.seg button.on { background: var(--accent); color: #fff; font-weight: 600; }

	.sliders { gap: 0.9rem; }
	.slider { display: flex; flex-direction: column; gap: 0.3rem; }
	.slider span { font-size: 0.76rem; color: var(--muted-fg); display: flex; justify-content: space-between; }
	.slider b { color: var(--ink); }
	.slider input[type='range'] { width: 100%; accent-color: var(--accent); }

	.chip {
		padding: 0.4rem 0.9rem; border: 1.5px solid var(--border); border-radius: 99px;
		background: var(--paper); color: var(--ink); font-family: inherit; font-size: 0.8rem; cursor: pointer;
	}

	@media (max-width: 860px) {
		.studio { grid-template-columns: 1fr; gap: 1.1rem; }
		.preview-wrap { position: static; }
	}
	@media (max-width: 640px) {
		.studio { padding: 1rem; padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 1.5rem); }
		.topbar { padding: 0.7rem 1rem; }
	}
</style>
