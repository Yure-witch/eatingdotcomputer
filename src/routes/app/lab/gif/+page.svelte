<script>
	import { onMount } from 'svelte';
	import { PRESETS, encodeGif, encodeWebP, supportsFontStretch } from '$lib/gif-studio.js';
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
	let sphereTilt = $state(10);         // Sphere: camera angle in degrees (+ = above, looking down)
	let coinInk = $state('#0000ff');     // Coin/Sphere: text + line colour (gradient start)
	let coinInk2 = $state('#ff2d2d');    // Coin/Sphere: gradient end colour
	let coinInkGrad = $state(false);     // Coin/Sphere: gradient ink on the object
	let coinInkAnim = $state(false);     // Coin/Sphere: rotate the gradient over the loop
	let coinBg = $state('light');        // Coin/Sphere: 'light' | 'dark' | 'transparent'
	let coinBodyMode = $state('auto');   // Coin/Sphere object body: 'auto' (match bg) | 'solid' | 'gradient'
	let coinBodyColor = $state('#ffffff'); // Coin/Sphere body colour (gradient start)
	let coinBodyColor2 = $state('#ffe3e3'); // Coin/Sphere body gradient end
	let metalEnv = $state('sky');        // Liquid Metal reflection map: 'sky' | 'sunset' | 'forest'
	let metalRipple = $state(0.5);       // Liquid Metal ripple strength (0 = still chrome)
	let metalGoo = $state(0.5);          // Liquid Metal melt radius (0 = crisp glyphs, 1 = mercury puddle)
	let metalBulge = $state(0.5);        // Liquid Metal centre dome toward the viewer
	let metalNoise = $state(0);          // Liquid Metal drifting surface grain
	let metalBlobs = $state(0);          // Liquid Metal orbiting metaball droplets (0 = off)
	let orbSize = $state(1);             // Type Orbit: letter size multiplier
	let orbWrongDelay = $state(false);   // Type Orbit: incoming word waits for the boundary (gap between out/in)
	let flexSolo = $state(false);        // Flex: rows take turns animating instead of together
	// Type Orbit swap easing — the whip's cubic-bezier handles (Coin default)
	let orbX1 = $state(0.28);
	let orbY1 = $state(0);
	let orbX2 = $state(0.1);
	let orbY2 = $state(1);
	let metalFlow = $state(0.6);         // Liquid Metal: liquid behaviour — flow along strokes, bead at terminals
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
	let cloudSeedM = $state(0);          // Clouds: movement seed (relocates the drift through noise space)
	let cloudSeedP = $state(0);          // Clouds: placement seed (re-rolls the letter scatter + trails)
	let cloudScatter = $state(1);        // Clouds: how far letters stray from clean typesetting
	let cloudEnv = $state(0.6);          // Clouds: envelope distortion amount (squash/stretch)
	let cloudEnvAll = $state(false);     // Clouds: distort the whole ensemble instead of per-letter
	let cloudTilt = $state(0.25);        // Clouds: per-letter random lean magnitude (toward/away)
	let cloudLightX = $state(-0.15);     // Clouds: light left <-> right
	let cloudLightZ = $state(0.9);       // Clouds: light in front (+) <-> behind (-)
	let cloudWisp = $state(0.4);         // Clouds: wisp amount (trails, sheets, fibrous edges)
	let cloudSolid = $state(0);          // Clouds: 0 gauzy vapour -> 1 solid white
	let cloudShadow = $state(0.05);      // Clouds: shadow depth
	let cloudSeedT = $state(0);          // Clouds: tilt seed (re-rolls each letter's lean)
	let cloudWispSpread = $state(0.3);   // Clouds: how far wisps stream and sheets roam
	let cloudVeil = $state(0.35);        // Clouds: large translucent windows inside letters
	let cloudTime = $state(0.3333);      // Clouds: SKY time of day (0 dawn, 1/3 midday, 2/3 sunset, 1 night)
	let cloudTimeText = $state(0.3333);  // Clouds: TEXT time of day (cloud lit/shadow palette)
	let cloudTimeLink = $state(true);    // Clouds: text follows the sky's hour
	let cloudRain = $state(0);           // Clouds: rain streaks
	let cloudSnow = $state(0);           // Clouds: snow flakes
	let cloudFog = $state(0);            // Clouds: fog/mist veil
	let garbleSeed = $state(0);          // Garble: re-rolls inks, offsets, glitches
	let garbleInks = $state(4);          // Garble: number of overprint passes
	let garbleScheme = $state('candy');  // Garble: ink scheme (from the reference sheets)
	let garbleAmt = $state(0.6);         // Garble: how garbled
	let garbleClean = $state(false);     // Garble: perfect even contour, no chaos
	let garbleAnim = $state('static');   // Garble: animation mode
	let garbleRecolor = $state(0.75);    // Garble: per-letter pen-swap chance
	let garbleDrift = $state(0.35);      // Garble: drift-run frequency (circles misaligning in a row)
	let garbleDriftMag = $state(0.5);    // Garble: drift displacement strength (0.5 = baseline)
	let garbleDriftLen = $state(0.5);    // Garble: drift run length (0.5 = baseline)
	let garbleVariety = $state(0.35);    // Garble: how differently each ink pass stamps (size/aspect/spacing)
	let garbleLeading = $state(1.25);    // Garble: line spacing (em)
	let garbleSize = $state('random');   // Garble: stamp radius category
	let garbleShape = $state('random');  // Garble: stamp shape category
	let garbleUniform = $state(false);   // Garble: all inks share one random stamp
	let garbleForm = $state('ellipse');  // Garble: stamp form (ellipse / quad / star)
	let garbleFormStretch = $state(false); // Garble: allow stretched quads/stars
	let garbleFormPool = $state({ ellipse: true, quad: true, star: true }); // Garble: forms allowed in Random/Mix

	// Save/load a favourite Garble setup as JSON
	function exportGarble() {
		const s = {
			garbleSeed, garbleInks, garbleScheme, garbleAmt, garbleClean, garbleAnim,
			garbleRecolor, garbleDrift, garbleDriftMag, garbleDriftLen, garbleVariety,
			garbleLeading, garbleSize, garbleShape, garbleUniform, garbleForm, garbleFormStretch,
			garbleSizePool: { ...garbleSizePool }, garbleShapePool: { ...garbleShapePool }, garbleFormPool: { ...garbleFormPool }
		};
		const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = 'garble-settings.json';
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	async function importGarble(ev) {
		const file = ev.target.files?.[0];
		ev.target.value = '';
		if (!file) return;
		try {
			const s = JSON.parse(await file.text());
			if (typeof s.garbleSeed === 'number') garbleSeed = s.garbleSeed;
			if (typeof s.garbleInks === 'number') garbleInks = s.garbleInks;
			if (typeof s.garbleScheme === 'string') garbleScheme = s.garbleScheme;
			if (typeof s.garbleAmt === 'number') garbleAmt = s.garbleAmt;
			if (typeof s.garbleClean === 'boolean') garbleClean = s.garbleClean;
			if (typeof s.garbleAnim === 'string') garbleAnim = s.garbleAnim;
			if (typeof s.garbleRecolor === 'number') garbleRecolor = s.garbleRecolor;
			if (typeof s.garbleDrift === 'number') garbleDrift = s.garbleDrift;
			if (typeof s.garbleDriftMag === 'number') garbleDriftMag = s.garbleDriftMag;
			if (typeof s.garbleDriftLen === 'number') garbleDriftLen = s.garbleDriftLen;
			if (typeof s.garbleVariety === 'number') garbleVariety = s.garbleVariety;
			if (typeof s.garbleLeading === 'number') garbleLeading = s.garbleLeading;
			if (typeof s.garbleSize === 'string') garbleSize = s.garbleSize;
			if (typeof s.garbleShape === 'string') garbleShape = s.garbleShape;
			if (typeof s.garbleUniform === 'boolean') garbleUniform = s.garbleUniform;
			if (typeof s.garbleForm === 'string') garbleForm = s.garbleForm;
			if (typeof s.garbleFormStretch === 'boolean') garbleFormStretch = s.garbleFormStretch;
			if (s.garbleSizePool) for (const k of Object.keys(garbleSizePool)) garbleSizePool[k] = !!s.garbleSizePool[k];
			if (s.garbleShapePool) for (const k of Object.keys(garbleShapePool)) garbleShapePool[k] = !!s.garbleShapePool[k];
			if (s.garbleFormPool) for (const k of Object.keys(garbleFormPool)) garbleFormPool[k] = !!s.garbleFormPool[k];
		} catch {
			alert('Could not read that settings file.');
		}
	}
	let garbleSizePool = $state({ xxxs: false, xxs: false, xs: true, s: true, m: false, l: false, xl: false, xxl: false, xxxl: false });   // Garble: sizes allowed in Random (user default: xs+s)
	let garbleShapePool = $state({ xxxwide: false, xxwide: false, xwide: false, wide: false, round: true, tall: true, xtall: true, xxtall: false, xxxtall: false }); // Garble: shapes allowed in Random (user default: round/tall/xtall)
	let weatherBusy = $state(false);
	let weatherNote = $state('');

	// Match the scene to the real sky: browser geolocation -> Open-Meteo
	// (no API key). Sun position maps to time-of-day, cloud cover to
	// solidity, wind to wisps, and the WMO weather code to rain/snow/fog.
	async function matchWeather() {
		weatherBusy = true; weatherNote = '';
		try {
			const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
			const { latitude, longitude } = pos.coords;
			const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,cloud_cover,is_day,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`);
			const w = await r.json();
			const code = w.current.weather_code, cover = w.current.cloud_cover ?? 50;
			const now = Date.now();
			const sr = new Date(w.daily.sunrise[0]).getTime(), ss = new Date(w.daily.sunset[0]).getTime();
			const tw = 45 * 60 * 1000; // twilight width
			if (now < sr - tw || now > ss + tw) cloudTime = 1;      // night
			else if (now < sr) cloudTime = 0.02;                    // pre-dawn glow
			else if (now > ss) cloudTime = 0.7;                     // dusk
			else {
				const f = (now - sr) / Math.max(1, ss - sr);
				cloudTime = f < 0.5 ? 0.02 + f * 2 * 0.313 : 0.333 + (f - 0.5) * 2 * 0.334;
			}
			cloudTimeLink = true;
			cloudSolid = Math.min(1, (cover / 100) * 0.75);
			cloudWisp = Math.min(1, 0.25 + (w.current.wind_speed_10m || 0) / 40);
			cloudRain = 0; cloudSnow = 0; cloudFog = 0;
			if (code === 45 || code === 48) cloudFog = 0.8;
			else if (code >= 51 && code <= 57) cloudRain = 0.35;
			else if (code >= 61 && code <= 67) cloudRain = Math.min(1, 0.5 + (code - 61) * 0.08);
			else if (code >= 71 && code <= 77) cloudSnow = 0.7;
			else if (code >= 80 && code <= 82) cloudRain = 0.6 + (code - 80) * 0.2;
			else if (code >= 85 && code <= 86) cloudSnow = 0.9;
			else if (code >= 95) { cloudRain = 1; cloudShadow = 0.9; cloudSolid = 0.85; }
			if (code === 3) cloudShadow = Math.max(cloudShadow, 0.35);
			weatherNote = `matched — ${cover}% cover, code ${code}`;
		} catch (e) {
			weatherNote = 'could not match (' + (e?.message || 'location denied') + ')';
		} finally { weatherBusy = false; }
	}

	const activeScene = $derived(SCENES.find((s) => s.id === mode) ?? SCENES[0]);
	const usesPreset = $derived(activeScene.usesPreset);
	// Modes that actually consume the Reaction speed / Wobble slider.
	const SIM_MODES = new Set(['bz', 'cca', 'flow', 'walk', 'cloth', 'meta', 'cmeta', 'blobc', 'blobc2', 'blobc3', 'blobc3n', 'blobc3f', 'blobc4', 'blobc5', 'blobc6', 'blobc62', 'blobc63', 'blobc64', 'blobc65', 'blobc66', 'blobc67', 'blobc68', 'blobc68p', 'blobc69', 'blobc610', 'blobc611', 'blobc612', 'blobc70', 'blobc70p', 'blobc71', 'blobc80', 'blobc90', 'blobc100', 'blobc110', 'blobc120', 'blobc122', 'blobc123', 'blobc124', 'blobc125']);
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
		if (id === 'glass01') {
			// white paper, blue circular type — the sheets carry the colour story
			bgType = 'solid'; bg = '#ffffff'; fg = '#2247ec';
			duration = 14;
		}
		if (id === 'garble') {
			// paper white, plotter inks carry the colour
			bgType = 'solid'; bg = '#ffffff'; fg = '#111111';
			duration = 8;
		}
		if (id === 'clouds') {
			// the sky is painted by the shader; long gentle loop
			duration = 12;
		}
		if (id === 'typeorb') {
			// extruded type on black — white letters
			bgType = 'solid'; bg = '#000000'; fg = '#ffffff';
			duration = 5.8; // flight is real-time in the scene; extra time = longer word hold
			// this mode always opens with the class lockup — whatever text
			// another mode left behind, override it (edit after switching)
			text = 'Interactive Design / Concepts | Thursdays / 6–10 PM 901 41CS';
		}
		if (id === 'flex') {
			// variable-font lockup on paper white
			bgType = 'solid'; bg = '#ffffff'; fg = '#111111';
			duration = 4;
			text = 'Interactive / Design Concepts';
		}
		if (id === 'bleed') {
			// full-frame variable-type lockup, cropped 30% into the letters
			bgType = 'solid'; bg = '#ffffff'; fg = '#111111';
			duration = 5;
			text = 'Interactive / Design Concepts';
		}
		if (id === 'grit') {
			// gritty: white type on black, blur + grain occlusion
			bgType = 'solid'; bg = '#000000'; fg = '#ffffff';
			duration = 5;
			text = 'Interactive / Design Concepts';
		}
		if (id === 'coin') {
			// pure RGB blue wireframe pill on white
			bgType = 'solid'; bg = '#ffffff'; fg = '#0000ff';
			duration = 4.5; // 1.5s per flip: 0.5s accelerate + 1s decelerate
		}
	}
	// Set a colour from a typed hex string (any 3- or 6-digit hex, with/without #).
	function setHex(which, val) {
		let s = String(val).trim();
		if (s && s[0] !== '#') s = '#' + s;
		if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return; // wait for a valid value
		if (which === 'bg') bg = s; else if (which === 'fg') fg = s;
		else if (which === 'accent') accent = s; else if (which === 'bg2') bg2 = s;
		else if (which === 'coinInk') coinInk = s; else if (which === 'coinInk2') coinInk2 = s;
		else if (which === 'coinBodyColor') coinBodyColor = s;
		else if (which === 'coinBodyColor2') coinBodyColor2 = s;
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
			bzRound, bzBands, bzSpacing, bzFade, sphereTilt, coinInk, coinInk2, coinInkGrad, coinInkAnim, coinBg, coinBodyMode, coinBodyColor, coinBodyColor2, metalEnv, metalRipple, metalGoo, metalBulge, metalNoise, metalBlobs, metalFlow, orbSize, orbWrongDelay, flexSolo, orbBez: [orbX1, orbY1, orbX2, orbY2],
			lwRows, lwCols, lwPeriod, lwDiag, lwAmp, lwLoops,
			htSize, moCell, scAmp, cmAmount, cmGate, b3Rows, b3Cols, b3Gap, b3Speed, cloudSeedM, cloudSeedP, cloudScatter, cloudEnv, cloudEnvAll, cloudTilt, cloudLightX, cloudLightZ, cloudWisp, cloudSolid, cloudShadow, cloudSeedT, cloudWispSpread, cloudVeil, cloudTime, cloudTimeText, cloudTimeLink, cloudRain, cloudSnow, cloudFog, garbleSeed, garbleInks, garbleScheme, garbleAmt, garbleClean, garbleAnim, garbleRecolor, garbleDrift, garbleDriftMag, garbleDriftLen, garbleVariety, garbleLeading, garbleSize, garbleShape, garbleUniform, garbleForm, garbleFormStretch,
			garbleFormPool: Object.entries(garbleFormPool).filter(([, v]) => v).map(([k]) => k),
			garbleSizePool: Object.entries(garbleSizePool).filter(([, v]) => v).map(([k]) => k),
			garbleShapePool: Object.entries(garbleShapePool).filter(([, v]) => v).map(([k]) => k),
			bg, bg2, fg, accent, bgType,
			fontFamily: "'Google Sans Flex'", fontFrac, hasStretch
		};
	}

	let scene = null;
	let previewCtx = null;
	let previewT = 0; // sim-seconds the preview scene has advanced (for export-from-current-frame)

	// (Re)build the scene when structural inputs change — mode, text, aspect,
	// text size — so the simulation reseeds from the new typography / dimensions.
	// Colours, preset and speed are read live by the scene and don't rebuild.
	$effect(() => {
		void [mode, text, aspect, resolution, fontFrac, fontsReady, b3Rows, b3Cols, b3Gap];
		const cv = canvasEl;
		if (!cv) return;
		scene = makeScene(mode, { W: cv.width, H: cv.height, getOpts: liveOpts, seed: 1337 });
		previewT = 0;
		if (previewCtx) scene.render(previewCtx);
	});
	// Repaint on a colour / preset change even while paused.
	$effect(() => {
		void [bg, bg2, fg, accent, bgType, preset, cycles, spread, repeats, tileCols, tileGap, reactionSpeed, bzRound, bzBands, bzSpacing, bzFade, sphereTilt, coinInk, coinInk2, coinInkGrad, coinInkAnim, coinBg, coinBodyMode, coinBodyColor, coinBodyColor2, metalEnv, metalRipple, metalGoo, metalBulge, metalNoise, metalBlobs, metalFlow, orbSize, orbWrongDelay, flexSolo, orbX1, orbY1, orbX2, orbY2, lwRows, lwCols, lwPeriod, lwDiag, lwAmp, lwLoops, htSize, moCell, scAmp, cmAmount, cmGate, b3Speed];
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
					previewT += dt * gifSpeed;
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
						previewT += 1 / fps;
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
	let fromCurrent = $state(false); // start the GIF at the preview's current frame instead of frame 0
	let exportFmt = $state('gif');   // 'gif' | 'webp' (animated)

	// Encode the current scene → { blob, name, fmt }. Shared by the download
	// export and the in-page "Render" (drag-into-your-doc) flow.
	async function produceRender() {
		const W = outDims.w, H = outDims.h;
		const frames = Math.max(2, Math.round(duration * fps));
		// Fresh scene at export resolution, reset — encodeGif steps it per frame.
		const exportScene = makeScene(mode, { W, H, getOpts: liveOpts, seed: 1337 });
		// scenes with async init (three.js + font loads) expose ready() —
		// wait it out or the first frames bake as bare background (black
		// flash at the loop seam)
		if (exportScene.ready) await exportScene.ready();
		// "From current frame": replay the preview's elapsed sim-time into the
		// fresh export scene so the GIF starts where the preview is now.
		// Same seed + same step size = the same evolution (capped at 90s of
		// pre-roll so a long-idle preview can't stall the export).
		const preroll = fromCurrent ? Math.min(previewT, 90) : 0;
		const preSteps = Math.round(preroll * fps);
		for (let s = 0; s < preSteps; s++) {
			exportScene.step(1 / fps);
			if (s % 60 === 59) {
				progress = (s / preSteps) * 0.25;
				await new Promise((r) => setTimeout(r)); // let the progress bar paint
			}
		}
		const pBase = preSteps ? 0.25 : 0;
		const encode = exportFmt === 'webp' ? encodeWebP : encodeGif;
		const bytes = await encode({
			W, H, fps, frames, scene: exportScene,
			delayMs: (1000 / fps) / gifSpeed,   // GIF speed = playback rate
			stepDt: duration / frames,          // frames tile the loop exactly — no off-speed seam
			onProgress: (p) => { progress = pBase + p * (1 - pBase); }
		});
		const fmt = exportFmt;
		const name = (text.trim() || 'title').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'title';
		const blob = new Blob([bytes], { type: fmt === 'webp' ? 'image/webp' : 'image/gif' });
		return { blob, name, fmt };
	}

	async function exportGif() {
		if (exporting || rendering) return;
		exporting = true; progress = 0;
		try {
			const { blob, name, fmt } = await produceRender();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = name + (fmt === 'webp' ? '.webp' : '.gif');
			document.body.appendChild(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		} catch (e) {
			console.error('[gif-studio] export failed', e);
			alert('GIF export failed — ' + (e?.message || e));
		} finally {
			exporting = false;
		}
	}

	// ── Render to page (drag straight into Google Slides / any doc) ──────────
	let rendering = $state(false);
	let renderedUrl = $state(null);      // public R2 URL of the last render (drag + <img>)
	let renderedBlobUrl = $state(null);  // local blob URL for a reliable Download
	let renderedName = $state('');       // filename for the drag-out / download
	let renderedFmt = $state('gif');
	let renderedKey = null;              // R2 key, so we can delete it when done

	// Renders are ephemeral — delete from R2 the moment they're replaced or
	// dismissed. `beacon` uses sendBeacon so it survives a page unload.
	function deleteRender(key, beacon = false) {
		if (!key) return;
		const fd = new FormData();
		fd.append('deleteKey', key);
		if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/gif-upload', fd);
		else fetch('/api/gif-upload', { method: 'POST', body: fd, keepalive: true }).catch(() => {});
	}

	function clearRender(beacon = false) {
		deleteRender(renderedKey, beacon);
		if (renderedBlobUrl) URL.revokeObjectURL(renderedBlobUrl);
		renderedKey = null; renderedUrl = null; renderedBlobUrl = null; renderedName = '';
	}

	async function renderToPage() {
		if (exporting || rendering) return;
		rendering = true; progress = 0;
		try {
			const { blob, name, fmt } = await produceRender();
			// Publish to R2 so the result has a real URL a drop target can fetch.
			const filename = name + (fmt === 'webp' ? '.webp' : '.gif');
			const fd = new FormData();
			fd.append('file', blob, filename);
			fd.append('name', name);
			const res = await fetch('/api/gif-upload', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			// Drop the previous render (if any) — only one lives at a time.
			deleteRender(renderedKey);
			if (renderedBlobUrl) URL.revokeObjectURL(renderedBlobUrl);
			renderedBlobUrl = URL.createObjectURL(blob); // same-origin → Download works
			renderedUrl = data.url;
			renderedKey = data.key;
			renderedName = data.filename || filename;
			renderedFmt = fmt;
		} catch (e) {
			console.error('[gif-studio] render failed', e);
			alert('Render failed — ' + (e?.message || e));
		} finally {
			rendering = false;
		}
	}

	// Best-effort cleanup if the tab closes with a render still showing.
	onMount(() => {
		const onUnload = () => { if (renderedKey) deleteRender(renderedKey, true); };
		window.addEventListener('pagehide', onUnload);
		return () => window.removeEventListener('pagehide', onUnload);
	});

	// Make the in-page result drag out as a real file. The <img> already carries
	// its public URL by default; we also set DownloadURL (for drag-to-desktop)
	// and uri-list/plain so more drop targets accept it.
	function onRenderedDragStart(e) {
		if (!renderedUrl) return;
		const mime = renderedFmt === 'webp' ? 'image/webp' : 'image/gif';
		try { e.dataTransfer.setData('DownloadURL', `${mime}:${renderedName}:${renderedUrl}`); } catch { /* Safari */ }
		try {
			e.dataTransfer.setData('text/uri-list', renderedUrl);
			e.dataTransfer.setData('text/plain', renderedUrl);
		} catch { /* ignore */ }
		e.dataTransfer.effectAllowed = 'copy';
	}

	async function copyRenderedUrl() {
		if (!renderedUrl) return;
		try { await navigator.clipboard.writeText(renderedUrl); } catch { /* denied */ }
	}
</script>

<svelte:head><title>GIF Studio — eating.computer</title></svelte:head>

<div class="shell">
	<div class="topbar">
		<a class="back" href="/app/lab" aria-label="Back to Lab">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</a>
		<h1>GIF Studio</h1>
		<button class="render-btn" onclick={renderToPage} disabled={exporting || rendering || !text.trim()} title="Render and drag it straight into your doc — no download">
			{#if rendering}Rendering {Math.round(progress * 100)}%{:else}Render GIF{/if}
		</button>
		<button class="export-btn" onclick={exportGif} disabled={exporting || rendering || !text.trim()}>
			{#if exporting}Rendering {Math.round(progress * 100)}%{:else}Export GIF{/if}
		</button>
	</div>

	{#if renderedUrl}
		<div class="render-result" role="dialog" aria-label="Rendered GIF">
			<div class="rr-head">
				<span class="rr-title">Drag me into your slides ↗</span>
				<button class="rr-close" onclick={() => clearRender()} aria-label="Dismiss">✕</button>
			</div>
			<!-- draggable=true + a real public src = drops into Slides/Docs/desktop -->
			<img
				class="rr-img"
				src={renderedUrl}
				alt={renderedName}
				draggable="true"
				ondragstart={onRenderedDragStart}
			/>
			<p class="rr-hint">Click-drag the image right into Google Slides — no download needed.</p>
			<div class="rr-actions">
				<a class="rr-btn" href={renderedBlobUrl} download={renderedName}>Download</a>
				<button class="rr-btn" onclick={copyRenderedUrl}>Copy link</button>
			</div>
		</div>
	{/if}

	{#if exporting}
		<div class="progress"><span style:width="{progress * 100}%"></span></div>
	{/if}

	<div class="studio">
		<!-- Preview -->
		<div class="preview-wrap">
			<div class="preview-frame" class:portrait={previewDims.h > previewDims.w}>
				<canvas bind:this={canvasEl} width={previewDims.w} height={previewDims.h}
					class:checker={(mode === 'coin' || mode === 'sphere' || mode === 'metal') && coinBg === 'transparent'}></canvas>
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
				<input type="text" bind:value={text} placeholder="Your title" maxlength="120" />
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
					<input type="range" min="1" max="15" step="0.5" bind:value={duration} />
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
				{#if mode === 'garble'}
					<label class="slider">
						<span>Seed <b>{garbleSeed}</b></span>
						<input type="range" min="0" max="99" step="1" bind:value={garbleSeed} />
					</label>
					<label class="slider">
						<span>Inks <b>{garbleInks}</b></span>
						<input type="range" min="1" max="10" step="1" bind:value={garbleInks} />
					</label>
					<label class="check fmt">
						<span>Ink scheme</span>
						<select bind:value={garbleScheme}>
							<option value="candy">Candy rainbow</option>
							<option value="sunviolet">Sun & violet</option>
							<option value="emberpine">Ember & pine</option>
							<option value="plum">Plum family</option>
							<option value="teal">Clean teal</option>
							<option value="complementary">Complementary (seeded)</option>
							<option value="analogous">Analogous (seeded)</option>
							<option value="triadic">Triadic (seeded)</option>
							<option value="tetradic">Tetradic (seeded)</option>
							<option value="pentadic">Pentadic (seeded)</option>
						</select>
					</label>
					<label class="slider">
						<span>Garble <b>{garbleAmt.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={garbleAmt} />
					</label>
					<label class="slider">
						<span>Recolour <b>{garbleRecolor.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={garbleRecolor} />
					</label>
					<label class="slider">
						<span>Drift runs <b>{garbleDrift.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={garbleDrift} />
					</label>
					<label class="slider">
						<span>Drift amount <b>{garbleDriftMag.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={garbleDriftMag} />
					</label>
					<label class="slider">
						<span>Drift length <b>{garbleDriftLen.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={garbleDriftLen} />
					</label>
					<label class="slider">
						<span>Pen variety <b>{garbleVariety.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={garbleVariety} />
					</label>
					<label class="slider">
						<span>Leading <b>{garbleLeading.toFixed(2)}</b></span>
						<input type="range" min="0.7" max="2" step="0.05" bind:value={garbleLeading} />
					</label>
					<label class="check fmt">
						<span>Stamp size</span>
						<select bind:value={garbleSize}>
							<option value="random">Random per ink</option>
							<option value="xxxs">XXX-small</option>
							<option value="xxs">XX-small</option>
							<option value="xs">X-small</option>
							<option value="s">Small</option>
							<option value="m">Medium</option>
							<option value="l">Large</option>
							<option value="xl">X-large</option>
							<option value="xxl">XX-large</option>
							<option value="xxxl">XXX-large</option>
						</select>
					</label>
					{#if garbleSize === 'random'}
						<div class="pool">
							{#each Object.keys(garbleSizePool) as k}
								<label><input type="checkbox" bind:checked={garbleSizePool[k]} />{k.toUpperCase()}</label>
							{/each}
						</div>
					{/if}
					<label class="check fmt">
						<span>Stamp shape</span>
						<select bind:value={garbleShape}>
							<option value="random">Random per ink</option>
							<option value="xxxwide">XXX-wide</option>
							<option value="xxwide">XX-wide</option>
							<option value="xwide">X-wide</option>
							<option value="wide">Wide</option>
							<option value="round">Round</option>
							<option value="tall">Tall</option>
							<option value="xtall">X-tall</option>
							<option value="xxtall">XX-tall</option>
							<option value="xxxtall">XXX-tall</option>
						</select>
					</label>
					{#if garbleShape === 'random'}
						<div class="pool">
							{#each Object.keys(garbleShapePool) as k}
								<label><input type="checkbox" bind:checked={garbleShapePool[k]} />{k}</label>
							{/each}
						</div>
					{/if}
					<label class="check">
						<input type="checkbox" bind:checked={garbleUniform} />
						<span>Uniform pens (all inks share one random stamp)</span>
					</label>
					<label class="check fmt">
						<span>Stamp form</span>
						<select bind:value={garbleForm}>
							<option value="ellipse">Ellipse</option>
							<option value="quad">Quadrilateral</option>
							<option value="star">Star</option>
							<option value="random">Random per ink</option>
							<option value="mix">Mix (rotate per layer)</option>
						</select>
					</label>
					{#if garbleForm === 'random' || garbleForm === 'mix'}
						<div class="pool">
							{#each Object.keys(garbleFormPool) as k}
								<label><input type="checkbox" bind:checked={garbleFormPool[k]} />{k}</label>
							{/each}
						</div>
					{/if}
					<label class="check">
						<input type="checkbox" bind:checked={garbleFormStretch} />
						<span>Allow stretched quads/stars</span>
					</label>
					<label class="check">
						<input type="checkbox" bind:checked={garbleClean} />
						<span>Clean contour (even strokes, no chaos)</span>
					</label>
					<div class="pool">
						<button class="weather-btn" onclick={exportGarble}>Export settings</button>
						<button class="weather-btn" onclick={() => document.getElementById('garble-import').click()}>Import settings</button>
						<input id="garble-import" type="file" accept="application/json,.json" style="display:none" onchange={importGarble} />
					</div>
					<label class="check fmt">
						<span>Animation</span>
						<select bind:value={garbleAnim}>
							<option value="static">Static (full layout)</option>
							<option value="layers">Layers (hard cuts)</option>
							<option value="shuffle">Shuffle (re-seed strobe)</option>
							<option value="draw">Draw (all sweep at once)</option>
							<option value="cascade">Cascade (path-order delays)</option>
							<option value="cascadelayers">Cascade by layers</option>
							<option value="trace">Trace (letter by letter)</option>
							<option value="tracelayers">Trace by letter & layer</option>
							<option value="staggerstart">Stagger start (scheduled pen)</option>
							<option value="wordpar">Trace words in parallel</option>
							<option value="cascadewp">Cascade by layers (words parallel)</option>
						</select>
					</label>
				{/if}
				{#if mode === 'clouds'}
					<label class="slider">
						<span>Movement seed <b>{cloudSeedM}</b></span>
						<input type="range" min="0" max="99" step="1" bind:value={cloudSeedM} />
					</label>
					<label class="slider">
						<span>Placement seed <b>{cloudSeedP}</b></span>
						<input type="range" min="0" max="99" step="1" bind:value={cloudSeedP} />
					</label>
					<label class="slider">
						<span>Scatter <b>{cloudScatter.toFixed(2)}×</b></span>
						<input type="range" min="0" max="2" step="0.05" bind:value={cloudScatter} />
					</label>
					<label class="slider">
						<span>Envelope distort <b>{cloudEnv.toFixed(2)}</b></span>
						<input type="range" min="0" max="1.5" step="0.05" bind:value={cloudEnv} />
					</label>
					<label class="check">
						<input type="checkbox" bind:checked={cloudEnvAll} />
						<span>Distort whole ensemble (instead of per-letter)</span>
					</label>
					<label class="slider">
						<span>Letter tilt scatter <b>{cloudTilt.toFixed(2)}</b></span>
						<input type="range" min="0" max="1.5" step="0.05" bind:value={cloudTilt} />
					</label>
					<label class="slider">
						<span>Tilt seed <b>{cloudSeedT}</b></span>
						<input type="range" min="0" max="99" step="1" bind:value={cloudSeedT} />
					</label>
					<label class="slider">
						<span>Light ⟷ <b>{cloudLightX.toFixed(2)}</b></span>
						<input type="range" min="-1" max="1" step="0.05" bind:value={cloudLightX} />
					</label>
					<label class="slider">
						<span>Light depth <b>{cloudLightZ.toFixed(2)}</b></span>
						<input type="range" min="-1" max="1" step="0.05" bind:value={cloudLightZ} />
					</label>
					<label class="slider">
						<span>Wisps <b>{cloudWisp.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudWisp} />
					</label>
					<label class="slider">
						<span>Solidity <b>{cloudSolid.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudSolid} />
					</label>
					<label class="slider">
						<span>Shadow <b>{cloudShadow.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudShadow} />
					</label>
					<label class="slider">
						<span>Wisp spread <b>{cloudWispSpread.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudWispSpread} />
					</label>
					<label class="slider">
						<span>Inner veils <b>{cloudVeil.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudVeil} />
					</label>
					<label class="slider">
						<span>Sky time <b>{cloudTime < 0.15 ? 'dawn' : cloudTime < 0.5 ? 'midday' : cloudTime < 0.85 ? 'sunset' : 'night'}</b></span>
						<input type="range" min="0" max="1" step="0.01" bind:value={cloudTime} />
					</label>
					<label class="check">
						<input type="checkbox" bind:checked={cloudTimeLink} />
						<span>Text follows sky time</span>
					</label>
					{#if !cloudTimeLink}
						<label class="slider">
							<span>Text time <b>{cloudTimeText < 0.15 ? 'dawn' : cloudTimeText < 0.5 ? 'midday' : cloudTimeText < 0.85 ? 'sunset' : 'night'}</b></span>
							<input type="range" min="0" max="1" step="0.01" bind:value={cloudTimeText} />
						</label>
					{/if}
					<label class="slider">
						<span>Rain <b>{cloudRain.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudRain} />
					</label>
					<label class="slider">
						<span>Snow <b>{cloudSnow.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudSnow} />
					</label>
					<label class="slider">
						<span>Fog <b>{cloudFog.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={cloudFog} />
					</label>
					<button class="weather-btn" onclick={matchWeather} disabled={weatherBusy}>
						{weatherBusy ? 'Fetching sky…' : 'Match my weather'}
					</button>
					{#if weatherNote}<span class="weather-note">{weatherNote}</span>{/if}
				{/if}
				<label class="check">
					<input type="checkbox" bind:checked={fromCurrent} />
					<span>Export from current frame</span>
				</label>
				<label class="check fmt">
					<span>Format</span>
					<select bind:value={exportFmt}>
						<option value="gif">GIF</option>
						<option value="webp">WebP (smaller, full colour)</option>
					</select>
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
				{#if mode.startsWith('blobc3') || mode === 'blobc4' || mode === 'blobc5' || mode.startsWith('blobc6') || mode.startsWith('blobc7') || mode.startsWith('blobc8') || mode.startsWith('blobc9') || mode.startsWith('blobc1')}
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
				{#if mode === 'flex'}
					<label class="orb-check">
						<input type="checkbox" bind:checked={flexSolo} />
						<span>one line at a time <em>&mdash; rows take turns squashing</em></span>
					</label>
				{/if}
				{#if mode === 'scatter'}
					<label class="slider">
						<span>Scatter <b>{scAmp.toFixed(2)}</b></span>
						<input type="range" min="0.3" max="2" step="0.05" bind:value={scAmp} />
					</label>
				{/if}
				{#if mode === 'sphere'}
					<label class="slider">
						<span>Camera angle <b>{sphereTilt}°</b></span>
						<input type="range" min="-60" max="60" step="1" bind:value={sphereTilt} />
					</label>
				{/if}
				{#if mode === 'typeorb'}
					<label class="slider">
						<span>Type size <b>{orbSize.toFixed(2)}×</b></span>
						<input type="range" min="0.4" max="2" step="0.05" bind:value={orbSize} />
					</label>
					<p class="orb-hint">
						<b>|</b> groups words to display together &nbsp;·&nbsp; <b>/</b> forces a line break
						(lines auto-wrap at two words, or after a 10+ letter word)
					</p>
					<label class="orb-check">
						<input type="checkbox" bind:checked={orbWrongDelay} />
						<span>wrongDelay <em>— outgoing word leaves first, incoming waits for the turn</em></span>
					</label>
					<div class="orb-bez">
						<div class="orb-bez-head">
							<span>Easing</span>
							<code>cubic-bezier({orbX1.toFixed(2)}, {orbY1.toFixed(2)}, {orbX2.toFixed(2)}, {orbY2.toFixed(2)})</code>
							<button class="orb-bez-reset" onclick={() => { orbX1 = 0.28; orbY1 = 0; orbX2 = 0.1; orbY2 = 1; }}>↺</button>
						</div>
						<svg class="orb-bez-curve" viewBox="0 0 100 100" preserveAspectRatio="none">
							<line x1="0" y1="100" x2={orbX1 * 100} y2={100 - orbY1 * 100} class="obz-handle" />
							<line x1="100" y1="0" x2={orbX2 * 100} y2={100 - orbY2 * 100} class="obz-handle" />
							<path d={`M 0 100 C ${orbX1 * 100} ${100 - orbY1 * 100}, ${orbX2 * 100} ${100 - orbY2 * 100}, 100 0`} class="obz-path" />
							<circle cx={orbX1 * 100} cy={100 - orbY1 * 100} r="3.5" class="obz-dot" />
							<circle cx={orbX2 * 100} cy={100 - orbY2 * 100} r="3.5" class="obz-dot" />
						</svg>
						<label class="slider"><span>x1 <b>{orbX1.toFixed(2)}</b></span><input type="range" min="0" max="1" step="0.01" bind:value={orbX1} /></label>
						<label class="slider"><span>y1 <b>{orbY1.toFixed(2)}</b></span><input type="range" min="-0.5" max="1.5" step="0.01" bind:value={orbY1} /></label>
						<label class="slider"><span>x2 <b>{orbX2.toFixed(2)}</b></span><input type="range" min="0" max="1" step="0.01" bind:value={orbX2} /></label>
						<label class="slider"><span>y2 <b>{orbY2.toFixed(2)}</b></span><input type="range" min="-0.5" max="1.5" step="0.01" bind:value={orbY2} /></label>
					</div>
				{/if}
				{#if mode === 'metal'}
					<div class="theme-row">
						<span>Reflections</span>
						<div class="theme-btns">
							<button class:on={metalEnv === 'sky'} onclick={() => (metalEnv = 'sky')}>Blue sky</button>
							<button class:on={metalEnv === 'sunset'} onclick={() => (metalEnv = 'sunset')}>Sunset</button>
							<button class:on={metalEnv === 'forest'} onclick={() => (metalEnv = 'forest')}>Trees</button>
						</div>
					</div>
					<label class="slider">
						<span>Ripple <b>{metalRipple.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={metalRipple} />
					</label>
					<label class="slider">
						<span>Goo <b>{metalGoo.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={metalGoo} />
					</label>
					<label class="slider">
						<span>Bulge <b>{metalBulge.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={metalBulge} />
					</label>
					<label class="slider">
						<span>Noise <b>{metalNoise.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={metalNoise} />
					</label>
					<label class="slider">
						<span>Flow <b>{metalFlow.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={metalFlow} />
					</label>
					<label class="slider">
						<span>Metaballs <b>{metalBlobs.toFixed(2)}</b></span>
						<input type="range" min="0" max="1" step="0.02" bind:value={metalBlobs} />
					</label>
					<div class="theme-row">
						<span>Background</span>
						<div class="theme-btns">
							<button class:on={coinBg === 'light'} onclick={() => (coinBg = 'light')}>Light</button>
							<button class:on={coinBg === 'dark'} onclick={() => (coinBg = 'dark')}>Dark</button>
							<button class:on={coinBg === 'transparent'} onclick={() => (coinBg = 'transparent')}>Transparent</button>
						</div>
					</div>
				{/if}
				{#if mode === 'coin' || mode === 'sphere'}
					<div class="theme-row">
						<span>Ink</span>
						<div class="theme-btns">
							<button class:on={!coinInkGrad} onclick={() => (coinInkGrad = false)}>Solid</button>
							<button class:on={coinInkGrad} onclick={() => (coinInkGrad = true)}>Gradient</button>
						</div>
					</div>
					<div class="color-field">
						<span>{coinInkGrad ? 'Gradient start' : 'Text + lines'}</span>
						<span class="ci"><input type="color" bind:value={coinInk} /><input class="hex" value={coinInk} maxlength="7" oninput={(e) => setHex('coinInk', e.currentTarget.value)} /></span>
					</div>
					{#if coinInkGrad}
						<div class="color-field">
							<span>Gradient end</span>
							<span class="ci"><input type="color" bind:value={coinInk2} /><input class="hex" value={coinInk2} maxlength="7" oninput={(e) => setHex('coinInk2', e.currentTarget.value)} /></span>
						</div>
						<label class="check"><input type="checkbox" bind:checked={coinInkAnim} /> Animate gradient</label>
					{/if}
					<div class="theme-row">
						<span>Background</span>
						<div class="theme-btns">
							<button class:on={coinBg === 'light'} onclick={() => (coinBg = 'light')}>Light</button>
							<button class:on={coinBg === 'dark'} onclick={() => (coinBg = 'dark')}>Dark</button>
							<button class:on={coinBg === 'transparent'} onclick={() => (coinBg = 'transparent')}>Transparent</button>
						</div>
					</div>
					<div class="theme-row">
						<span>Object body</span>
						<div class="theme-btns">
							<button class:on={coinBodyMode === 'auto'} onclick={() => (coinBodyMode = 'auto')}>Match bg</button>
							<button class:on={coinBodyMode === 'solid'} onclick={() => (coinBodyMode = 'solid')}>Solid</button>
							<button class:on={coinBodyMode === 'gradient'} onclick={() => (coinBodyMode = 'gradient')}>Gradient</button>
						</div>
					</div>
					{#if coinBodyMode !== 'auto'}
						<div class="color-field">
							<span>{coinBodyMode === 'gradient' ? 'Body gradient start' : 'Body colour'}</span>
							<span class="ci"><input type="color" bind:value={coinBodyColor} /><input class="hex" value={coinBodyColor} maxlength="7" oninput={(e) => setHex('coinBodyColor', e.currentTarget.value)} /></span>
						</div>
					{/if}
					{#if coinBodyMode === 'gradient'}
						<div class="color-field">
							<span>Body gradient end</span>
							<span class="ci"><input type="color" bind:value={coinBodyColor2} /><input class="hex" value={coinBodyColor2} maxlength="7" oninput={(e) => setHex('coinBodyColor2', e.currentTarget.value)} /></span>
						</div>
						{#if !coinInkGrad}
							<label class="check"><input type="checkbox" bind:checked={coinInkAnim} /> Animate gradient</label>
						{/if}
					{/if}
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
					<!-- 50fps ceiling: GIF delays are centiseconds and browsers
					     clamp <20ms to 100ms — 50fps (exactly 2cs) is the fastest
					     rate that plays back true in every decoder -->
					<input type="range" min="10" max="50" step="2" bind:value={fps} />
				</label>
			</div>
		</div>
	</div>
</div>

<style>
	.shell {
		min-height: 100dvh;
		background: var(--paper);
		padding-top: var(--header-h, 52px);
		box-sizing: border-box;
	}
	.topbar {
		position: sticky;
		top: var(--header-h, 52px);
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
	/* Render GIF = accent-filled primary; Export = outline secondary next to it */
	.render-btn {
		border: none; border-radius: 10px;
		padding: 0.55rem 1.15rem;
		background: var(--accent); color: #fff;
		font-family: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
		min-width: 8rem;
	}
	.render-btn:disabled { opacity: 0.5; cursor: default; }
	.export-btn {
		background: transparent; color: var(--ink);
		border: 1.5px solid var(--border);
	}

	.render-result {
		position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 60;
		width: min(320px, calc(100vw - 2rem));
		background: var(--paper); border: 1px solid var(--border); border-radius: 16px;
		box-shadow: 0 16px 44px rgba(0,0,0,0.24); padding: 0.85rem;
		display: flex; flex-direction: column; gap: 0.5rem;
	}
	.rr-head { display: flex; align-items: center; justify-content: space-between; }
	.rr-title { font-size: 0.8rem; font-weight: 700; color: var(--accent); }
	.rr-close { border: none; background: none; cursor: pointer; color: var(--muted-fg); font-size: 1rem; line-height: 1; padding: 0.1rem 0.25rem; }
	.rr-img {
		display: block; width: 100%; height: auto; max-height: 300px; object-fit: contain;
		border-radius: 10px; background: var(--surface-2, #f0ebe3);
		cursor: grab; border: 1px solid var(--border);
	}
	.rr-img:active { cursor: grabbing; }
	.rr-hint { margin: 0; font-size: 0.72rem; color: var(--muted-fg); line-height: 1.35; }
	.rr-actions { display: flex; gap: 0.4rem; }
	.rr-btn {
		flex: 1; text-align: center; text-decoration: none;
		padding: 0.4rem 0.6rem; border-radius: 8px; cursor: pointer;
		border: 1px solid var(--border); background: transparent; color: var(--ink);
		font-family: inherit; font-size: 0.78rem; font-weight: 600;
	}
	.rr-btn:hover { border-color: var(--accent); }
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

	.preview-wrap { position: sticky; top: calc(var(--header-h, 52px) + 4rem); align-self: start; }
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
	/* Coin/Sphere background theme buttons */
	.theme-row { display: flex; flex-direction: column; gap: 0.22rem; }
	.theme-row > span { font-size: 0.72rem; font-weight: 600; color: var(--ink); }
	.theme-btns { display: flex; gap: 0.3rem; }
	.theme-btns button {
		flex: 1; font: inherit; font-size: 0.74rem; color: var(--ink);
		background: transparent; border: 1px solid var(--line, #d5d8de);
		border-radius: 7px; padding: 0.3rem 0.2rem; cursor: pointer;
	}
	.theme-btns button.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); font-weight: 600; }
	/* transparent-bg preview: checkerboard shows through the cleared canvas */
	canvas.checker {
		background-image:
			linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%),
			linear-gradient(45deg, #d8d8d8 25%, transparent 25%, transparent 75%, #d8d8d8 75%);
		background-color: #f2f2f2;
		background-size: 16px 16px;
		background-position: 0 0, 8px 8px;
	}
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
	.orb-hint {
		margin: 0; font-size: 0.7rem; line-height: 1.45; color: var(--muted-fg);
	}
	.orb-hint b { color: var(--ink); font-family: monospace; }
	.orb-check { display: flex; align-items: center; gap: 0.45rem; font-size: 0.75rem; color: var(--ink); cursor: pointer; }
	.orb-check em { color: var(--muted-fg); font-style: normal; font-size: 0.7rem; }
	.orb-bez { display: flex; flex-direction: column; gap: 0.35rem; }
	.orb-bez-head {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.72rem; font-weight: 600; color: var(--ink);
	}
	.orb-bez-head code { font-size: 0.66rem; color: var(--muted-fg); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.orb-bez-reset { background: none; border: none; color: var(--muted-fg); cursor: pointer; font-size: 0.75rem; padding: 0 0.15rem; }
	.orb-bez-reset:hover { color: var(--ink); }
	.orb-bez-curve {
		width: 100%; height: 84px;
		background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
	}
	.orb-bez-curve .obz-path { fill: none; stroke: var(--ink); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
	.orb-bez-curve .obz-handle { stroke: var(--muted-fg); stroke-width: 1; opacity: 0.55; vector-effect: non-scaling-stroke; }
	.orb-bez-curve .obz-dot { fill: var(--accent); }
	.check { display: flex; align-items: center; gap: 0.45rem; font-size: 0.76rem; color: var(--muted-fg); cursor: pointer; }
	.check input { accent-color: var(--ink); }
	.check.fmt { justify-content: space-between; }
	.check.fmt select { font: inherit; font-size: 0.76rem; color: var(--ink); background: transparent; border: 1px solid var(--line, #d5d8de); border-radius: 6px; padding: 0.15rem 0.35rem; }
	.weather-btn { font: inherit; font-size: 0.76rem; color: var(--ink); background: transparent; border: 1px solid var(--line, #d5d8de); border-radius: 6px; padding: 0.3rem 0.5rem; cursor: pointer; }
	.weather-btn:disabled { opacity: 0.5; cursor: default; }
	.weather-note { font-size: 0.7rem; color: var(--muted-fg); }
	.pool { display: flex; flex-wrap: wrap; gap: 0.35rem 0.6rem; padding-left: 0.2rem; }
	.pool label { display: flex; align-items: center; gap: 0.2rem; font-size: 0.68rem; color: var(--muted-fg); cursor: pointer; }
	.pool input { accent-color: var(--ink); }
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
