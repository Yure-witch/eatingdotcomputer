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
	let repeats = $state(14);            // Step & Repeat: number of stacked lines
	let spread = $state(1.6);            // Step & Repeat: wave cycles down the stack
	let reactionSpeed = $state(1.5);     // sim iterations/motion advanced per frame (BZ/CA/flow/walk/cloth)
	let gifSpeed = $state(1);            // playback rate multiplier (frame delay)
	let bzRound = $state(4);             // BZ: wavefront roundedness level (1..6)
	let bzBands = $state(20);            // BZ: gradient steps (posterise the fade)
	let bzSpacing = $state(0.4);         // BZ: distance between waves (refractory length)
	let bzFade = $state(0.5);            // BZ: trailing tail length (0 = single line)

	const activeScene = $derived(SCENES.find((s) => s.id === mode) ?? SCENES[0]);
	const usesPreset = $derived(activeScene.usesPreset);

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
	const RES = [360, 480, 640, 800, 1080, 1280];
	let resolution = $state(720);
	// Export pixel dims at the chosen resolution (long edge = resolution).
	const outDims = $derived.by(() => {
		const b = ASPECTS[aspect];
		const long = Math.max(b.w, b.h);
		const s = resolution / long;
		return { w: Math.round(b.w * s), h: Math.round(b.h * s) };
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

	const dims = $derived(ASPECTS[aspect]);

	// Live opts snapshot read by the active scene each frame (colours, preset,
	// speed update live; text/dims changes rebuild the scene — see below).
	function liveOpts() {
		return {
			text, subtitle: subtitle.trim(), preset, cycles, duration, spread, repeats, reactionSpeed,
			bzRound, bzBands, bzSpacing, bzFade,
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
		void [mode, text, aspect, fontFrac, fontsReady];
		const cv = canvasEl;
		if (!cv) return;
		scene = makeScene(mode, { W: cv.width, H: cv.height, getOpts: liveOpts, seed: 1337 });
		if (previewCtx) scene.render(previewCtx);
	});
	// Repaint on a colour / preset change even while paused.
	$effect(() => {
		void [bg, bg2, fg, accent, bgType, preset, cycles, spread, repeats, reactionSpeed, bzRound, bzBands, bzSpacing, bzFade];
		if (scene && previewCtx && !playing) scene.render(previewCtx);
	});

	onMount(() => {
		hasStretch = supportsFontStretch();
		previewCtx = canvasEl.getContext('2d', { willReadFrequently: true });
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
				const interval = 1 / Math.max(1, fps * gifSpeed); // seconds between displayed frames
				accT += dt;
				if (accT >= interval) {
					accT = 0; // drop extra under lag rather than spiral
					scene.step(1 / fps);
					scene.render(previewCtx);
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
			<div class="preview-frame" class:portrait={dims.h > dims.w}>
				<canvas bind:this={canvasEl} width={dims.w} height={dims.h}></canvas>
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
						<button class="preset mode" class:on={mode === s.id} onclick={() => (mode = s.id)}>{s.name}</button>
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
				{:else}
					<label class="slider">
						<span>Reaction speed <b>{reactionSpeed.toFixed(2)}</b></span>
						<input type="range" min="0.2" max="6" step="0.1" bind:value={reactionSpeed} />
					</label>
				{/if}
				<label class="slider">
					<span>GIF speed <b>{gifSpeed.toFixed(2)}×</b></span>
					<input type="range" min="0.25" max="3" step="0.05" bind:value={gifSpeed} />
				</label>
				{#if mode === 'tile'}
					<label class="slider">
						<span>Wave spread <b>{spread.toFixed(1)}</b></span>
						<input type="range" min="0.4" max="5" step="0.1" bind:value={spread} />
					</label>
				{/if}
				{#if mode === 'bz'}
					<label class="slider">
						<span>Roundedness <b>{bzRound}</b></span>
						<input type="range" min="1" max="6" step="1" bind:value={bzRound} />
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
