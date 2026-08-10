<script>
	import { onMount } from 'svelte';
	import { encodeGif, encodeWebP } from '$lib/gif-studio.js';
	import { makeText3DScene, TEXT_MATERIALS, TEXT_MOTIONS } from '$lib/text-3d.js';

	// ── Content ──────────────────────────────────────────────────────────────
	let text = $state('eating');
	let material = $state('chrome');
	let motion = $state('spin');
	let uppercase = $state(true);
	let depth = $state(1);

	// ── Colour ───────────────────────────────────────────────────────────────
	let color = $state('#ff3b6b');   // tint for candy / glass
	let bgType = $state('gradient'); // solid | gradient | transparent
	let bg = $state('#0b0d12');
	let bg2 = $state('#232838');

	// ── Timing / output ───────────────────────────────────────────────────────
	let duration = $state(3);
	let fps = $state(24);
	let aspect = $state('16:9');
	let resolution = $state(480);
	let exportFmt = $state('gif');

	const ASPECTS = { '1:1': [1, 1], '16:9': [16, 9], '9:16': [9, 16], '4:3': [4, 3] };
	const outDims = $derived.by(() => {
		const [aw, ah] = ASPECTS[aspect] ?? [1, 1];
		if (aw >= ah) return { w: resolution, h: Math.round((resolution * ah) / aw) };
		return { w: Math.round((resolution * aw) / ah), h: resolution };
	});
	const previewDims = $derived.by(() => {
		const { w, h } = outDims;
		const cap = 440;
		const s = Math.min(1, cap / Math.max(w, h));
		return { w: Math.round(w * s), h: Math.round(h * s) };
	});

	// Live options read by the 3D scene each frame — never triggers a renderer
	// rebuild, so sliders stay smooth and GL contexts don't leak.
	const getOpts = () => ({
		text, material, motion, uppercase, depth,
		color, bgType, bg, bg2, duration
	});

	// ── Preview ────────────────────────────────────────────────────────────────
	let canvasEl = $state(null);
	let previewScene = null;
	let sceneW = 0, sceneH = 0;

	function ensurePreviewScene() {
		if (!canvasEl) return;
		if (previewScene && sceneW === canvasEl.width && sceneH === canvasEl.height) return;
		previewScene?.dispose?.();
		sceneW = canvasEl.width; sceneH = canvasEl.height;
		previewScene = makeText3DScene(getOpts, sceneW, sceneH);
		previewScene.ready?.();
	}

	onMount(() => {
		let raf = 0, last = 0;
		const tick = (now) => {
			raf = requestAnimationFrame(tick);
			if (!canvasEl) return;
			ensurePreviewScene();
			const ctx = canvasEl.getContext('2d');
			const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
			last = now;
			previewScene.step(dt);
			previewScene.render(ctx);
		};
		raf = requestAnimationFrame(tick);
		const onUnload = () => { if (renderedKey) deleteRender(renderedKey, true); };
		window.addEventListener('pagehide', onUnload);
		return () => {
			cancelAnimationFrame(raf);
			previewScene?.dispose?.();
			window.removeEventListener('pagehide', onUnload);
		};
	});
	// Recreate the preview scene when the canvas resizes (aspect / resolution).
	$effect(() => { void previewDims; ensurePreviewScene(); });

	// ── Render / export ─────────────────────────────────────────────────────────
	let exporting = $state(false);
	let rendering = $state(false);
	let progress = $state(0);

	async function produceRender() {
		const { w: W, h: H } = outDims;
		const frames = Math.max(2, Math.round(duration * fps));
		const scene = makeText3DScene(getOpts, W, H, { supersample: 2 });
		try {
			await scene.ready();
			await new Promise((r) => setTimeout(r, 60)); // let the env map settle
			const encode = exportFmt === 'webp' ? encodeWebP : encodeGif;
			const bytes = await encode({
				W, H, fps, frames, scene,
				delayMs: 1000 / fps,
				stepDt: duration / frames,
				onProgress: (p) => (progress = p)
			});
			const fmt = exportFmt;
			const name = (text.trim() || 'text').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'text';
			const blob = new Blob([bytes], { type: fmt === 'webp' ? 'image/webp' : 'image/gif' });
			return { blob, name, fmt };
		} finally {
			scene.dispose?.();
		}
	}

	async function exportFile() {
		if (exporting || rendering) return;
		exporting = true; progress = 0;
		try {
			const { blob, name, fmt } = await produceRender();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url; a.download = name + (fmt === 'webp' ? '.webp' : '.gif');
			document.body.appendChild(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		} catch (e) {
			console.error('[text-gifs] export failed', e);
			alert('Export failed — ' + (e?.message || e));
		} finally { exporting = false; }
	}

	// ── Render to page (drag straight into a doc) ──────────────────────────────
	let renderedUrl = $state(null);
	let renderedBlobUrl = $state(null);
	let renderedName = $state('');
	let renderedFmt = $state('gif');
	let renderedKey = null;

	function deleteRender(key, beacon = false) {
		if (!key) return;
		const fd = new FormData();
		fd.append('deleteKey', key);
		if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/gif-upload', fd);
		else fetch('/api/gif-upload', { method: 'POST', body: fd, keepalive: true }).catch(() => {});
	}
	function clearRender() {
		deleteRender(renderedKey);
		if (renderedBlobUrl) URL.revokeObjectURL(renderedBlobUrl);
		renderedKey = null; renderedUrl = null; renderedBlobUrl = null; renderedName = '';
	}
	async function renderToPage() {
		if (exporting || rendering) return;
		rendering = true; progress = 0;
		try {
			const { blob, name, fmt } = await produceRender();
			const filename = name + (fmt === 'webp' ? '.webp' : '.gif');
			const fd = new FormData();
			fd.append('file', blob, filename);
			fd.append('name', name);
			const res = await fetch('/api/gif-upload', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			deleteRender(renderedKey);
			if (renderedBlobUrl) URL.revokeObjectURL(renderedBlobUrl);
			renderedBlobUrl = URL.createObjectURL(blob);
			renderedUrl = data.url; renderedKey = data.key;
			renderedName = data.filename || filename; renderedFmt = fmt;
		} catch (e) {
			console.error('[text-gifs] render failed', e);
			alert('Render failed — ' + (e?.message || e));
		} finally { rendering = false; }
	}
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
	const busy = $derived(exporting || rendering);
</script>

<svelte:head><title>Text GIFs — eating.computer</title></svelte:head>

<div class="shell">
	<div class="topbar">
		<a class="back" href="/app/lab" aria-label="Back to Lab">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
		</a>
		<h1>Text GIFs</h1>
		<button class="render-btn" onclick={renderToPage} disabled={busy || !text.trim()} title="Render and drag it straight into your doc — no download">
			{#if rendering}Rendering {Math.round(progress * 100)}%{:else}Render GIF{/if}
		</button>
		<button class="export-btn" onclick={exportFile} disabled={busy || !text.trim()}>
			{#if exporting}Rendering {Math.round(progress * 100)}%{:else}Download{/if}
		</button>
	</div>

	<div class="body">
		<div class="stage">
			<canvas bind:this={canvasEl} width={previewDims.w} height={previewDims.h}
				class:checker={bgType === 'transparent'}></canvas>

			{#if renderedUrl}
				<div class="result">
					<p class="result-hint">Drag this into Google Slides, Docs, or your desktop ↓</p>
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img src={renderedUrl} alt={renderedName} draggable="true" ondragstart={onRenderedDragStart} />
					<div class="result-actions">
						<a class="mini" href={renderedBlobUrl} download={renderedName}>Download</a>
						<button class="mini" onclick={clearRender}>Dismiss</button>
					</div>
				</div>
			{/if}
		</div>

		<div class="panel">
			<label class="field">
				<span class="lbl">Text</span>
				<input class="text-in" type="text" bind:value={text} maxlength="24" placeholder="Type a word…" />
			</label>

			<div class="group">
				<span class="group-label">Material</span>
				<div class="chips">
					{#each TEXT_MATERIALS as m}
						<button class="chip" class:on={material === m.id} onclick={() => (material = m.id)}>{m.name}</button>
					{/each}
				</div>
			</div>

			<div class="group">
				<span class="group-label">Motion</span>
				<div class="chips">
					{#each TEXT_MOTIONS as m}
						<button class="chip sm" class:on={motion === m.id} onclick={() => (motion = m.id)}>{m.name}</button>
					{/each}
				</div>
				<label class="slider"><span>Depth</span><input type="range" min="0.4" max="2" step="0.1" bind:value={depth} /></label>
				<button class="chip sm" class:on={uppercase} onclick={() => (uppercase = !uppercase)}>UPPERCASE</button>
			</div>

			<div class="group">
				<span class="group-label">Colour</span>
				<div class="row">
					<label class="swatch"><span>Tint</span><input type="color" bind:value={color} /></label>
					<span class="hint">used by Candy / Glass</span>
				</div>
				<div class="chips">
					<button class="chip sm" class:on={bgType === 'solid'} onclick={() => (bgType = 'solid')}>Solid bg</button>
					<button class="chip sm" class:on={bgType === 'gradient'} onclick={() => (bgType = 'gradient')}>Gradient bg</button>
					<button class="chip sm" class:on={bgType === 'transparent'} onclick={() => (bgType = 'transparent')}>Transparent</button>
				</div>
				{#if bgType !== 'transparent'}
					<div class="row">
						<label class="swatch"><span>BG</span><input type="color" bind:value={bg} /></label>
						{#if bgType === 'gradient'}<label class="swatch"><span>BG 2</span><input type="color" bind:value={bg2} /></label>{/if}
					</div>
				{/if}
			</div>

			<div class="group">
				<span class="group-label">Output</span>
				<div class="chips">
					{#each Object.keys(ASPECTS) as a}
						<button class="chip sm" class:on={aspect === a} onclick={() => (aspect = a)}>{a}</button>
					{/each}
				</div>
				<div class="chips">
					{#each [{ v: 320, l: 'Small' }, { v: 480, l: 'Medium' }, { v: 720, l: 'Large' }] as r}
						<button class="chip sm" class:on={resolution === r.v} onclick={() => (resolution = r.v)}>{r.l}</button>
					{/each}
				</div>
				<label class="slider"><span>Loop {duration}s</span><input type="range" min="1" max="6" step="0.5" bind:value={duration} /></label>
				<label class="slider"><span>FPS {fps}</span><input type="range" min="12" max="30" step="1" bind:value={fps} /></label>
				<div class="chips">
					<button class="chip sm" class:on={exportFmt === 'gif'} onclick={() => (exportFmt = 'gif')}>GIF</button>
					<button class="chip sm" class:on={exportFmt === 'webp'} onclick={() => (exportFmt = 'webp')}>WebP</button>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.shell { min-height: 100dvh; display: flex; flex-direction: column; background: var(--paper); }
	.topbar {
		position: sticky; top: 0; z-index: 5;
		display: flex; align-items: center; gap: 0.75rem;
		padding: 0.6rem 1rem; padding-top: calc(0.6rem + var(--header-h, 0px));
		border-bottom: 1px solid var(--border); background: var(--paper);
	}
	.back { display: flex; color: var(--ink); text-decoration: none; }
	h1 { font-family: 'Avara', serif; font-weight: 400; font-size: 1.15rem; margin: 0; color: var(--ink); flex: 1; }
	.render-btn, .export-btn {
		font-family: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer;
		border-radius: 8px; padding: 0.4rem 0.8rem; border: 1.5px solid var(--border);
		background: var(--paper); color: var(--ink);
	}
	.render-btn { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.render-btn:disabled, .export-btn:disabled { opacity: 0.45; cursor: default; }

	.body { flex: 1; display: flex; gap: 1.25rem; padding: 1.25rem; max-width: 1100px; width: 100%; margin: 0 auto; box-sizing: border-box; }
	.stage { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1rem; min-width: 0; }
	canvas { max-width: 100%; border-radius: 12px; box-shadow: 0 8px 30px -12px rgba(0,0,0,0.4); }
	canvas.checker {
		background-image: conic-gradient(#0002 25%, transparent 0 50%, #0002 0 75%, transparent 0);
		background-size: 20px 20px;
	}
	.result { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 0.75rem; border: 1px dashed var(--border); border-radius: 12px; }
	.result-hint { font-size: 0.75rem; color: var(--muted-fg); margin: 0; }
	.result img { max-width: 300px; cursor: grab; border-radius: 8px; }
	.result-actions { display: flex; gap: 0.5rem; }
	.mini { font-size: 0.72rem; padding: 0.25rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--paper); color: var(--ink); text-decoration: none; cursor: pointer; }

	.panel { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 1.1rem; }
	.field { display: flex; flex-direction: column; gap: 0.3rem; }
	.lbl, .group-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-fg); font-weight: 700; }
	.text-in { padding: 0.5rem 0.7rem; border: 1.5px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink); font-family: inherit; font-size: 0.95rem; }
	.group { display: flex; flex-direction: column; gap: 0.5rem; }
	.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.chip { font-family: inherit; font-size: 0.76rem; padding: 0.3rem 0.6rem; border: 1.5px solid var(--border); border-radius: 999px; background: var(--paper); color: var(--muted-fg); cursor: pointer; transition: all 0.12s; }
	.chip.sm { font-size: 0.72rem; padding: 0.25rem 0.55rem; }
	.chip.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.row { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
	.hint { font-size: 0.68rem; color: var(--muted-fg); }
	.slider { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; color: var(--muted-fg); flex: 1; }
	.slider input { width: 100%; }
	.swatch { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: var(--muted-fg); }
	.swatch input { width: 32px; height: 26px; border: 1px solid var(--border); border-radius: 6px; background: none; padding: 0; cursor: pointer; }

	@media (max-width: 780px) {
		.body { flex-direction: column; }
		.panel { width: 100%; }
	}
</style>
