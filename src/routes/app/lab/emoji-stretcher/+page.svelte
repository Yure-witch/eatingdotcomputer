<script>
	import { onMount } from 'svelte';
	import { loadEmojiData } from '$lib/emoji-data.js';
	import { dragBox, fitBox, drawStretched, rasterizeEmoji } from '$lib/emoji-stretcher.js';

	const QUICK = ['\u{1f600}', '\u{1f642}', '\u{1f62d}', '\u{1f60e}', '\u{1f914}', '\u{1f633}', '\u{1f480}', '\u{1f438}', '\u{1f431}', '\u{1f355}', '\u{1f525}', '\u{2764}\ufe0f'];
	const HANDLES = [
		{ id: 'nw', name: 'top left', x: 0, y: 0 }, { id: 'n', name: 'top', x: 50, y: 0 },
		{ id: 'ne', name: 'top right', x: 100, y: 0 }, { id: 'e', name: 'right', x: 100, y: 50 },
		{ id: 'se', name: 'bottom right', x: 100, y: 100 }, { id: 's', name: 'bottom', x: 50, y: 100 },
		{ id: 'sw', name: 'bottom left', x: 0, y: 100 }, { id: 'w', name: 'left', x: 0, y: 50 }
	];
	let emoji = $state(QUICK[0]);
	let input = $state(QUICK[0]);
	let mode = $state('stretch');
	let middle = $state(0.08);
	let box = $state({ x: 100, y: 90, w: 280, h: 160 });
	let area = $state({ w: 760, h: 400 });
	let stage, canvas;
	let source = $state.raw(null);
	let drag = $state(null);
	let past = $state([]);
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
	const matches = $derived(catalog.filter((item) => !search.trim() || item.terms.includes(search.toLowerCase().trim())).slice(0, 180));
	const BASE = 160;

	function snapshot() { return { box: { ...box }, middle }; }
	function remember(before = snapshot()) { past = [...past.slice(-29), before]; }
	function undo() {
		if (!past.length || drag) return;
		const before = past[past.length - 1];
		past = past.slice(0, -1);
		box = fitBox(before.box, area.w, area.h);
		middle = before.middle;
	}
	function centerBox(w = Math.min(280, area.w), h = Math.min(BASE, area.h)) {
		return { x: (area.w - w) / 2, y: (area.h - h) / 2, w, h };
	}
	function reset() { remember(); middle = 0.08; box = centerBox(Math.min(BASE, area.w), Math.min(BASE, area.h)); }
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

	function startDrag(event, handle) {
		if (!source || !event.isPrimary || event.button !== 0 || drag) return;
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, handle, before: snapshot() };
	}
	function moveDrag(event) {
		if (!drag || event.pointerId !== drag.id) return;
		box = dragBox(drag.before.box, drag.handle, event.clientX - drag.x, event.clientY - drag.y, area.w, area.h);
	}
	function endDrag(event, cancel = false) {
		if (!drag || (event && event.pointerId !== drag.id)) return;
		const before = drag.before;
		drag = null;
		if (cancel) { box = fitBox(before.box, area.w, area.h); return; }
		if (Object.keys(box).some((key) => Math.abs(box[key] - before.box[key]) > 0.1)) remember(before);
	}
	function keyboard(event, handle) {
		if (event.key === 'Escape') { endDrag(null, true); return; }
		const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		if (!moves[event.key]) return;
		event.preventDefault(); event.stopPropagation();
		remember();
		const [x, y] = moves[event.key], step = event.shiftKey ? 20 : 4;
		box = dragBox(box, handle, x * step, y * step, area.w, area.h);
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
			const scale = Math.min(3, 2048 / Math.max(box.w, box.h));
			drawStretched(output, source, box.w * scale, box.h * scale, BASE * scale, middle);
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
			area = { w, h };
			box = fitBox(box, w, h);
			endDrag(null, true);
		};
		measure(); box = centerBox(); choose(emoji);
		const observer = new ResizeObserver(measure); observer.observe(stage);
		return () => { alive = false; observer.disconnect(); clearTimeout(statusTimer); };
	});
	$effect(() => {
		if (!source || !canvas) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(box.w, box.h));
		drawStretched(canvas, source, box.w * dpr, box.h * dpr, BASE * dpr, middle);
	});
</script>

<svelte:head><title>Emoji Stretcher - Lab - eating.computer</title></svelte:head>

<main class="stretcher">
	<header>
		<div class="heading"><a class="back" href="/app/lab">Lab</a><h1>Emoji Stretcher</h1></div>
		<div class="actions">
			<button onclick={undo} disabled={!past.length || !!drag} title="Undo last change">Undo</button>
			<button onclick={reset}>Reset</button>
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
			<button aria-pressed={mode === 'stretch'} class:active={mode === 'stretch'} onclick={() => mode = 'stretch'}>Stretch</button>
			<button aria-pressed={mode === 'move'} class:active={mode === 'move'} onclick={() => mode = 'move'}>Move</button>
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
		<div class="stage-note" id="drag-help">{mode === 'stretch' ? 'Drag to stretch in any direction. Corners and edges work too.' : 'Drag anywhere inside the emoji to move it.'}</div>
		<div class="work-area">
			<div class="selection" role="group" aria-label="Emoji transform controls" style:left={`${box.x}px`} style:top={`${box.y}px`} style:width={`${box.w}px`} style:height={`${box.h}px`} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={(e) => endDrag(e, true)} onlostpointercapture={endDrag}>
				<button class="emoji-body" class:moving={mode === 'move'} aria-label={mode === 'move' ? 'Move emoji' : 'Stretch emoji'} aria-describedby="drag-help keyboard-help" onpointerdown={(e) => startDrag(e, mode === 'move' ? 'move' : 'se')} onkeydown={(e) => keyboard(e, mode === 'move' ? 'move' : 'se')}>
					<canvas bind:this={canvas} aria-hidden="true"></canvas>
				</button>
				{#each HANDLES as handle}
					<button class="handle {handle.id}" style:left={`${handle.x}%`} style:top={`${handle.y}%`} aria-label={`Stretch ${handle.name} edge`} aria-describedby="keyboard-help" onpointerdown={(e) => startDrag(e, handle.id)} onkeydown={(e) => keyboard(e, handle.id)}></button>
				{/each}
			</div>
		</div>
		<div class="stage-readout" aria-hidden="true">{Math.round(box.w)} &times; {Math.round(box.h)}</div>
	</div>

	<footer>
		<div class="sliders">
			<label>Width <output>{Math.round(box.w)} px</output><input type="range" min="48" max={Math.floor(area.w)} step="1" value={box.w} oninput={(e) => changeSize('w', e.currentTarget.value)} /></label>
			<label>Height <output>{Math.round(box.h)} px</output><input type="range" min="48" max={Math.floor(area.h)} step="1" value={box.h} oninput={(e) => changeSize('h', e.currentTarget.value)} /></label>
			<label>Stretch area <output>{Math.round(middle * 100)}%</output><input type="range" min="0.02" max="1" step="0.01" bind:value={middle} onpointerdown={() => remember()} onkeydown={(e) => { if (e.key.startsWith('Arrow')) remember(); }} /></label>
		</div>
		<div class="footnote"><span id="keyboard-help">Arrow keys adjust the focused control. Shift for bigger steps. Escape cancels a drag.</span><a href="https://websim.com/@maxbittker/emoji-stretcher" target="_blank" rel="noreferrer">Inspired by maxbittker</a></div>
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
	.handle { position: absolute; width: 32px; height: 32px; min-height: 0; padding: 0; transform: translate(-50%, -50%); border: 0; background: transparent; border-radius: 50%; touch-action: none; z-index: 1; }
	.handle::after { content: ''; position: absolute; inset: 10px; border: 2px solid var(--accent); background: var(--paper); border-radius: 3px; }
	.handle:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
	.handle.n, .handle.s { cursor: ns-resize; }
	.handle.w, .handle.e { cursor: ew-resize; }
	.handle.nw, .handle.se { cursor: nwse-resize; }
	.handle.ne, .handle.sw { cursor: nesw-resize; }
	.sliders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 30px; padding: 22px 0 16px; }
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
	}
</style>
