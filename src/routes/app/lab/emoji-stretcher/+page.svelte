<script>
	import { onMount } from 'svelte';
	import { loadEmojiData } from '$lib/emoji-data.js';
	import { dragBox, fitBox, drawStretched, rasterizeEmoji, appendTrail, fitTrail, moveTrail, snakeGeometry, drawSnake } from '$lib/emoji-stretcher.js';

	const QUICK = ['\u{1f600}', '\u{1f642}', '\u{1f62d}', '\u{1f60e}', '\u{1f914}', '\u{1f633}', '\u{1f480}', '\u{1f438}', '\u{1f431}', '\u{1f355}', '\u{1f525}', '\u{2764}\ufe0f'];
	const HANDLES = [
		{ id: 'nw', name: 'top left', x: 0, y: 0 }, { id: 'n', name: 'top', x: 50, y: 0 },
		{ id: 'ne', name: 'top right', x: 100, y: 0 }, { id: 'e', name: 'right', x: 100, y: 50 },
		{ id: 'se', name: 'bottom right', x: 100, y: 100 }, { id: 's', name: 'bottom', x: 50, y: 100 },
		{ id: 'sw', name: 'bottom left', x: 0, y: 100 }, { id: 'w', name: 'left', x: 0, y: 50 }
	];
	let emoji = $state(QUICK[0]);
	let input = $state(QUICK[0]);
	let mode = $state('snake');
	let shape = $state('snake');
	let points = $state.raw([]);
	let thickness = $state(100);
	let middle = $state(0.08);
	let box = $state({ x: 100, y: 90, w: 280, h: 160 });
	let area = $state({ w: 760, h: 400 });
	let stage;
	let canvas = $state(null), snakeCanvas = $state(null);
	let source = $state.raw(null);
	let drag = $state.raw(null);
	let past = $state.raw([]);
	let error = $state('');
	let status = $state('');
	let exporting = $state(false);
	let picker = $state(false);
	let search = $state('');
	let catalog = $state([]);
	let loading = $state(false);
	let catalogError = $state('');
	let alive = false;
	let statusTimer;
	let frame = 0;
	const matches = $derived(catalog.filter((item) => !search.trim() || item.terms.includes(search.toLowerCase().trim())).slice(0, 180));
	const BASE = 160;

	const tip = $derived(points.at(-1) || { x: 0, y: 0 });
	function snapshot() { return { box: { ...box }, points: points.map((p) => ({ ...p })), thickness, shape, middle }; }
	function remember(before = snapshot()) { past = [...past.slice(-29), before]; }
	function restore(before) {
		box = fitBox(before.box, area.w, area.h); middle = before.middle;
		thickness = Math.min(before.thickness, area.w - 8, area.h - 8);
		points = fitTrail(before.points, thickness, area.w, area.h);
		shape = before.shape; mode = shape === 'snake' ? 'snake' : 'stretch';
	}
	function undo() {
		if (!past.length || drag) return;
		const before = past[past.length - 1];
		past = past.slice(0, -1);
		restore(before);
	}
	function centerBox(w = Math.min(280, area.w), h = Math.min(BASE, area.h)) {
		return { x: (area.w - w) / 2, y: (area.h - h) / 2, w, h };
	}
	function initialTrail() {
		const y = area.h / 2, half = Math.min(thickness * 0.8, (area.w - thickness - 8) / 2);
		return [{ x: area.w / 2 - half, y }, { x: area.w / 2 + half, y }];
	}
	function reset() {
		if (drag) return;
		remember(); middle = 0.08;
		box = centerBox(Math.min(BASE, area.w), Math.min(BASE, area.h));
		points = initialTrail();
	}
	function setMode(next) {
		if (drag) return;
		mode = next;
		if (next !== 'move') shape = next === 'snake' ? 'snake' : 'box';
	}
	function choose(value) {
		const first = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value.trim())][0]?.segment;
		if (!first || !/(\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(first)) {
			error = 'Enter or paste a single emoji.';
			return;
		}
		try {
			const next = rasterizeEmoji(first);
			source = next; emoji = first; input = first; error = ''; picker = false;
		} catch (e) { error = e.message; }
	}
	async function togglePicker() {
		picker = !picker;
		if (!picker || catalog.length || loading) return;
		loading = true; catalogError = '';
		try {
			const data = await loadEmojiData();
			if (!alive) return;
			catalog = (data.groups || []).flatMap((g) => g.items || []).map((it) => ({
				emoji: it.e, name: it.n, terms: [it.e, it.n, ...(it.kw || [])].join(' ').toLowerCase()
			}));
		} catch { if (alive) catalogError = 'The picker could not load. You can still paste any emoji above.'; }
		finally { if (alive) loading = false; }
	}

	function pointerPoint(event) {
		const rect = stage.getBoundingClientRect();
		return { x: event.clientX - rect.left - stage.clientLeft - 24, y: event.clientY - rect.top - stage.clientTop - 24 };
	}
	function startDrag(event, handle) {
		if (!source || !event.isPrimary || event.button !== 0 || drag) return;
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		const at = pointerPoint(event);
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, handle, before: snapshot(), offset: { x: tip.x - at.x, y: tip.y - at.y } };
	}
	function moveDrag(event) {
		if (!drag || event.pointerId !== drag.id) return;
		if (drag.handle === 'snake') {
			const samples = event.getCoalescedEvents?.() || [];
			let next = points;
			for (const sample of samples.length ? samples : [event]) {
				const at = pointerPoint(sample), padding = thickness / 2 + 2;
				next = appendTrail(next, { x: Math.max(padding, Math.min(area.w - padding, at.x + drag.offset.x)), y: Math.max(padding, Math.min(area.h - padding, at.y + drag.offset.y)) });
			}
			points = next;
		} else if (drag.handle === 'snake-move') {
			points = moveTrail(drag.before.points, event.clientX - drag.x, event.clientY - drag.y, thickness, area.w, area.h);
		} else box = dragBox(drag.before.box, drag.handle, event.clientX - drag.x, event.clientY - drag.y, area.w, area.h);
	}
	function endDrag(event, cancel = false) {
		if (!drag || (event && event.pointerId !== drag.id)) return;
		if (event?.type === 'pointerup') moveDrag(event);
		const before = drag.before;
		const wasSnake = drag.handle.startsWith('snake');
		drag = null;
		if (cancel) { restore(before); return; }
		if (wasSnake ? JSON.stringify(points) !== JSON.stringify(before.points) : Object.keys(box).some((key) => Math.abs(box[key] - before.box[key]) > 0.1)) remember(before);
	}
	function keyboard(event, handle) {
		if (event.key === 'Escape') { endDrag(null, true); return; }
		const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		if (!moves[event.key]) return;
		event.preventDefault(); event.stopPropagation();
		remember();
		const [x, y] = moves[event.key], step = event.shiftKey ? 20 : 4;
		if (handle === 'snake') {
			points = appendTrail(points, { x: Math.max(thickness / 2 + 2, Math.min(area.w - thickness / 2 - 2, tip.x + x * step)), y: Math.max(thickness / 2 + 2, Math.min(area.h - thickness / 2 - 2, tip.y + y * step)) });
		} else if (handle === 'snake-move') points = moveTrail(points, x * step, y * step, thickness, area.w, area.h);
		else box = dragBox(box, handle, x * step, y * step, area.w, area.h);
	}
	function changeThickness(value) {
		thickness = Number(value);
		points = fitTrail(points, thickness, area.w, area.h);
	}
	function changeSize(axis, value) {
		remember();
		box = fitBox({ ...box, [axis]: Number(value) }, area.w, area.h);
	}
	function announce(message) {
		status = message; clearTimeout(statusTimer);
		statusTimer = setTimeout(() => { if (alive) status = ''; }, 3000);
	}
	function pngBlob() {
		return new Promise((resolve, reject) => {
			const output = document.createElement('canvas');
			if (shape === 'snake') {
				const { bounds } = snakeGeometry(points, source.width, source.height, thickness, middle);
				const scale = Math.min(3, 2048 / Math.max(bounds.w, bounds.h));
				drawSnake(output, source, points, thickness, middle, { width: bounds.w, height: bounds.h, scale, offsetX: -bounds.x, offsetY: -bounds.y });
			} else {
				const scale = Math.min(3, 2048 / Math.max(box.w, box.h));
				drawStretched(output, source, box.w * scale, box.h * scale, BASE * scale, middle);
			}
			output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the PNG.')), 'image/png');
		});
	}
	async function exportPng(copy = false) {
		if (!source || exporting) return;
		exporting = true; error = '';
		try {
			if (copy) {
				if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image copying is unavailable here. Use Download PNG instead.');
				await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
				announce('PNG copied.');
			} else {
				const url = URL.createObjectURL(await pngBlob());
				const link = document.createElement('a');
				link.href = url; link.download = 'stretched-emoji.png';
				link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
				announce('PNG downloaded.');
			}
		} catch (e) { if (alive) error = e.message || 'Export failed. Please try again.'; }
		finally { if (alive) exporting = false; }
	}

	onMount(() => {
		alive = true;
		const measure = () => {
			const w = Math.max(48, stage.clientWidth - 48), h = Math.max(48, stage.clientHeight - 48);
			if (w === area.w && h === area.h) return;
			endDrag(null, true);
			area = { w, h };
			box = fitBox(box, w, h);
			thickness = Math.min(thickness, w - 8, h - 8);
			points = fitTrail(points, thickness, w, h);
		};
		measure(); box = centerBox(); points = initialTrail(); choose(emoji);
		const observer = new ResizeObserver(measure); observer.observe(stage);
		return () => { alive = false; observer.disconnect(); clearTimeout(statusTimer); cancelAnimationFrame(frame); };
	});
	$effect(() => {
		if (!source) return;
		const current = { source, canvas, snakeCanvas, shape, points, thickness, middle, box: { ...box }, area: { ...area } };
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const c = current;
			if (c.shape === 'snake' && c.snakeCanvas) {
				drawSnake(c.snakeCanvas, c.source, c.points, c.thickness, c.middle, { width: c.area.w, height: c.area.h, scale: Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(c.area.w, c.area.h)) });
			} else if (c.canvas) {
				const dpr = Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(c.box.w, c.box.h));
				drawStretched(c.canvas, c.source, c.box.w * dpr, c.box.h * dpr, BASE * dpr, c.middle);
			}
		});
	});
</script>

<svelte:head><title>Emoji Stretcher - Lab - eating.computer</title></svelte:head>

<main class="stretcher">
	<header>
		<div class="heading"><a class="back" href="/app/lab">Lab</a><h1>Emoji Stretcher</h1></div>
		<div class="actions">
			<button onclick={undo} disabled={!past.length || !!drag} title="Undo last change">Undo</button>
			<button onclick={reset} disabled={!!drag}>Reset</button>
			<button onclick={() => exportPng(true)} disabled={!source || exporting}>Copy</button>
			<button class="primary" onclick={() => exportPng()} disabled={!source || exporting}>Download PNG</button>
		</div>
	</header>

	<section class="toolstrip" aria-label="Emoji and drag controls">
		<form class="emoji-input" onsubmit={(e) => { e.preventDefault(); choose(input); }}>
			<label for="emoji-input">Emoji</label>
			<input id="emoji-input" bind:value={input} maxlength="40" aria-label="Enter or paste an emoji" onblur={() => { if (input !== emoji) choose(input); }} />
			<button type="submit">Use</button>
		</form>
		<div class="quick" aria-label="Quick emoji choices">
			{#each QUICK as value}<button class:selected={emoji === value} aria-label={`Use ${value}`} onclick={() => choose(value)}>{value}</button>{/each}
		</div>
		<button class="browse" aria-expanded={picker} aria-controls="emoji-picker" onclick={togglePicker}>More emoji</button>
		<div class="modes" aria-label="Drag behavior">
			<button aria-pressed={mode === 'snake'} class:active={mode === 'snake'} onclick={() => setMode('snake')}>Snake</button>
			<button aria-pressed={mode === 'stretch'} class:active={mode === 'stretch'} onclick={() => setMode('stretch')}>Box</button>
			<button aria-pressed={mode === 'move'} class:active={mode === 'move'} onclick={() => setMode('move')}>Move</button>
		</div>
	</section>
	{#if picker}
		<section class="picker" id="emoji-picker" aria-label="Choose an emoji">
			<div class="picker-head"><input aria-label="Search emoji" placeholder="Search emoji" bind:value={search} /><button onclick={() => picker = false}>Close</button></div>
			{#if loading}<p>Loading emoji...</p>{:else if catalogError}<p>{catalogError}</p>{:else}
				<div class="emoji-grid">{#each matches as item}<button title={item.name} aria-label={item.name} onclick={() => choose(item.emoji)}>{item.emoji}</button>{/each}</div>
				{#if !matches.length}<p>No matching emoji.</p>{/if}
			{/if}
		</section>
	{/if}

	<div class="stage" class:dragging={!!drag} bind:this={stage}>
		<div class="stage-note" id="drag-help">{mode === 'snake' ? 'Pull the tip and draw a curve. Release to keep it; grab it again to keep going.' : mode === 'stretch' ? 'Pull an edge or corner to resize.' : 'Drag to move the whole shape.'}</div>
		<div class="work-area">
			{#if shape === 'snake'}
				<div class="snake-layer" role="group" aria-label="Curved emoji controls" onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={(e) => endDrag(e, true)} onlostpointercapture={endDrag}>
					<button class="snake-surface" class:moving={mode === 'move'} aria-label={mode === 'move' ? 'Move curved emoji' : 'Pull emoji along a curve'} aria-describedby="drag-help keyboard-help" onpointerdown={(e) => startDrag(e, mode === 'move' ? 'snake-move' : 'snake')} onkeydown={(e) => keyboard(e, mode === 'move' ? 'snake-move' : 'snake')}>
						<canvas bind:this={snakeCanvas} aria-hidden="true"></canvas>
					</button>
					{#if mode === 'snake'}<button class="snake-tip" style:left={`${tip.x}px`} style:top={`${tip.y}px`} aria-label="Pull emoji tip along a path" aria-describedby="drag-help keyboard-help" onpointerdown={(e) => startDrag(e, 'snake')} onkeydown={(e) => keyboard(e, 'snake')}><span></span></button>{/if}
				</div>
			{:else}
			<div class="selection" role="group" aria-label="Emoji transform controls" style:left={`${box.x}px`} style:top={`${box.y}px`} style:width={`${box.w}px`} style:height={`${box.h}px`} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={(e) => endDrag(e, true)} onlostpointercapture={endDrag}>
				<button class="emoji-body" class:moving={mode === 'move'} aria-label={mode === 'move' ? 'Move emoji' : 'Stretch emoji'} aria-describedby="drag-help keyboard-help" onpointerdown={(e) => startDrag(e, mode === 'move' ? 'move' : 'se')} onkeydown={(e) => keyboard(e, mode === 'move' ? 'move' : 'se')}>
					<canvas bind:this={canvas} aria-hidden="true"></canvas>
				</button>
				{#each HANDLES as handle}
					<button class="handle {handle.id}" style:left={`${handle.x}%`} style:top={`${handle.y}%`} aria-label={`Stretch ${handle.name} edge`} aria-describedby="keyboard-help" onpointerdown={(e) => startDrag(e, handle.id)} onkeydown={(e) => keyboard(e, handle.id)}></button>
				{/each}
			</div>
			{/if}
		</div>
		<div class="stage-readout" aria-hidden="true">{shape === 'snake' ? `${thickness} px thick` : `${Math.round(box.w)} x ${Math.round(box.h)}`}</div>
	</div>

	<footer>
		<div class="sliders" class:snake-sliders={shape === 'snake'}>
			{#if shape === 'snake'}
				<label>Thickness <output>{thickness} px</output><input type="range" min="20" max={Math.min(180, area.w - 8, area.h - 8)} step="1" value={thickness} onpointerdown={() => remember()} onkeydown={(e) => { if (e.key.startsWith('Arrow')) remember(); }} oninput={(e) => changeThickness(e.currentTarget.value)} /></label>
			{:else}
			<label>Width <output>{Math.round(box.w)} px</output><input type="range" min="48" max={Math.floor(area.w)} step="1" value={box.w} oninput={(e) => changeSize('w', e.currentTarget.value)} /></label>
			<label>Height <output>{Math.round(box.h)} px</output><input type="range" min="48" max={Math.floor(area.h)} step="1" value={box.h} oninput={(e) => changeSize('h', e.currentTarget.value)} /></label>
			{/if}
			<label>Stretch area <output>{Math.round(middle * 100)}%</output><input type="range" min="0.02" max="1" step="0.01" bind:value={middle} onpointerdown={() => remember()} onkeydown={(e) => { if (e.key.startsWith('Arrow')) remember(); }} /></label>
		</div>
		<div class="footnote"><span id="keyboard-help">Arrow keys steer the tip or adjust the focused control. Shift for bigger steps. Escape cancels a drag.</span><a href="https://websim.com/@maxbittker/emoji-stretcher" target="_blank" rel="noreferrer">Inspired by maxbittker</a></div>
		<p class="feedback" class:error={!!error} role="status">{error || status || 'Exports have a transparent background.'}</p>
	</footer>
</main>

<style>
	.stretcher { width: 100%; max-width: 1800px; margin: 0 auto; display: block; padding: calc(var(--header-h, 52px) + 20px) 24px 32px; color: var(--ink); }
	header, .heading, .actions, .toolstrip, .emoji-input, .modes, .picker-head, .footnote { display: flex; align-items: center; gap: 10px; }
	header { justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
	.heading { gap: 20px; }
	h1 { font: 700 clamp(1.4rem, 2.5vw, 2rem) 'Avara', serif; margin: 0; }
	.back { color: var(--muted-fg); font-size: 0.875rem; text-underline-offset: 4px; }
	button, input { font: inherit; color: inherit; }
	button { border: 1px solid var(--border); background: var(--paper); padding: 9px 13px; border-radius: 9px; cursor: pointer; font-size: 0.875rem; min-height: 42px; }
	button:hover { background: var(--surface-2); border-color: var(--ink); }
	button:disabled { opacity: 0.4; cursor: default; }
	button:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
	.primary, .modes .active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.primary:hover, .modes .active:hover { background: var(--inverse-surface); color: var(--inverse-on-surface); }
	.toolstrip { flex-wrap: wrap; gap: 14px; border-top: 1px solid var(--border); padding: 14px 0; }
	.emoji-input label { font-size: 0.875rem; }
	.emoji-input input { width: 56px; height: 44px; font-size: 1.65rem; text-align: center; background: var(--paper); border: 1px solid var(--border); border-radius: 9px; }
	.quick { display: flex; gap: 2px; flex-wrap: wrap; }
	.quick button { padding: 6px; min-width: 36px; border-color: transparent; font-size: 1.5rem; line-height: 1; }
	.quick button.selected { background: var(--surface-2); border-color: var(--accent); }
	.modes { margin-left: auto; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: 12px; }
	.modes button { border: 0; }
	.stage { position: relative; height: clamp(330px, 57dvh, 740px); width: 100%; overflow: hidden; border: 1px solid var(--border); border-radius: 16px; background-color: var(--md-sys-color-surface-container-low, var(--paper)); background-image: radial-gradient(color-mix(in srgb, var(--ink) 17%, transparent) 0.8px, transparent 0.8px); background-size: 20px 20px; }
	.work-area { position: absolute; inset: 24px; }
	.stage-note, .stage-readout { position: absolute; pointer-events: none; color: var(--muted-fg); font-size: 0.8rem; padding: 5px 8px; background: color-mix(in srgb, var(--paper) 90%, transparent); border-radius: 5px; z-index: 2; }
	.stage-note { top: 10px; left: 10px; max-width: calc(100% - 20px); }
	.stage-readout { bottom: 10px; right: 10px; font-variant-numeric: tabular-nums; }
	.selection { position: absolute; border: 1px solid var(--accent); touch-action: none; }
	.emoji-body { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; border: 0; border-radius: 0; background: transparent; padding: 0; touch-action: none; user-select: none; -webkit-user-select: none; cursor: nwse-resize; }
	.emoji-body:hover { background: transparent; }
	.emoji-body.moving { cursor: grab; }
	.dragging .emoji-body.moving { cursor: grabbing; }
	canvas { display: block; width: 100%; height: 100%; pointer-events: none; }
	.snake-layer { position: absolute; inset: 0; touch-action: none; }
	.snake-surface { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: crosshair; touch-action: none; user-select: none; -webkit-user-select: none; }
	.snake-surface:hover { background: transparent; }
	.snake-surface.moving { cursor: grab; }
	.dragging .snake-surface.moving { cursor: grabbing; }
	.snake-tip { position: absolute; transform: translate(-50%, -50%); width: 44px; height: 44px; padding: 0; border: 1px dashed var(--accent); border-radius: 50%; background: color-mix(in srgb, var(--paper) 70%, transparent); cursor: grab; touch-action: none; }
	.snake-tip span { display: block; margin: auto; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
	.dragging .snake-tip { cursor: grabbing; }
	.handle { position: absolute; width: 32px; height: 32px; min-height: 0; padding: 0; transform: translate(-50%, -50%); border: 0; background: transparent; border-radius: 50%; touch-action: none; z-index: 1; }
	.handle::after { content: ''; position: absolute; inset: 10px; border: 2px solid var(--accent); background: var(--paper); border-radius: 3px; }
	.handle:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
	.handle.n, .handle.s { cursor: ns-resize; }
	.handle.w, .handle.e { cursor: ew-resize; }
	.handle.nw, .handle.se { cursor: nwse-resize; }
	.handle.ne, .handle.sw { cursor: nesw-resize; }
	.sliders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 30px; padding: 22px 0 16px; }
	.sliders.snake-sliders { grid-template-columns: 1fr 1fr; }
	.sliders label { display: grid; grid-template-columns: 1fr auto; gap: 9px; font-size: 0.875rem; }
	output { color: var(--muted-fg); font-variant-numeric: tabular-nums; }
	input[type='range'] { width: 100%; margin: 0; grid-column: 1 / -1; accent-color: var(--accent); height: 24px; }
	.footnote { justify-content: space-between; flex-wrap: wrap; color: var(--muted-fg); font-size: 0.8rem; line-height: 1.5; }
	.footnote a { color: inherit; text-underline-offset: 3px; }
	.feedback { min-height: 1.5em; font-size: 0.8rem; color: var(--muted-fg); margin: 8px 0 0; }
	.feedback.error { color: var(--danger); }
	.picker { padding: 14px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
	.picker-head input { flex: 1; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); font-size: 1rem; }
	.emoji-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 4px; max-height: 220px; overflow-y: auto; margin-top: 12px; }
	.emoji-grid button { font-size: 1.5rem; padding: 5px; }
	@media (max-width: 640px) {
		.stretcher { padding: calc(var(--header-h, 52px) + 14px) 12px calc(90px + env(safe-area-inset-bottom, 0px)); }
		.heading { gap: 14px; }
		.actions { gap: 6px; width: 100%; }
		.actions button { flex: 1; padding: 8px; white-space: nowrap; }
		.quick { width: 100%; order: 3; justify-content: space-between; }
		.quick button { min-width: 24px; padding: 4px 2px; font-size: 1.3rem; }
		.toolstrip { gap: 8px; }
		.emoji-input { gap: 6px; }
		.emoji-input label, .emoji-input button { display: none; }
		.emoji-input input { width: 44px; }
		.browse { padding: 8px; }
		.modes button { padding: 8px 10px; }
		.stage { height: 46dvh; min-height: 300px; border-radius: 12px; }
		.sliders { gap: 14px; grid-template-columns: 1fr 1fr; padding-top: 16px; }
		.sliders label:last-child { grid-column: 1 / -1; }
		.sliders.snake-sliders label:last-child { grid-column: auto; }
	}
</style>
