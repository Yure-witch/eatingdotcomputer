<script>
	// TEMPORARY live profiler for the emote picker.
	//
	// A synthetic benchmark of ten render approaches — real emotes, 90 cells,
	// on device — put every one of them under 1ms at 60fps with zero jank,
	// while the real picker runs at ~1fps. The cost is demonstrably NOT in
	// drawing frames, so it has to be measured where it actually happens.
	//
	// Every number is a DELTA over the sample window: "ms of that second spent
	// here". Anything approaching 1000 is the bottleneck.
	//
	// Delete together with /renderprobe once the cause is found.
	import { onMount } from 'svelte';

	let live = $state('starting…');
	let report = $state('');
	let recording = $state(0);      // seconds remaining, 0 = idle
	let note = $state('');
	let warmOff = $state(false);

	// The picker dismisses on outside taps AND on wheel/touchmove (that is how
	// scrolling the chat closes it). An overlay inside the picker therefore has
	// to swallow its own events, or every interaction with the profiler shuts
	// the thing it is profiling.
	const swallow = (e) => { e.stopPropagation(); };

	let acc = null;   // accumulating totals while recording

	onMount(() => {
		try { warmOff = localStorage.getItem('noEmoteWarm') === '1'; } catch {}

		let raf = 0, frames = 0, t0 = performance.now();
		let ltMs = 0, ltN = 0, ltWorst = 0;

		let po = null;
		try {
			po = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) {
					ltMs += e.duration; ltN++;
					if (e.duration > ltWorst) ltWorst = e.duration;
				}
			});
			po.observe({ entryTypes: ['longtask'] });
		} catch { /* Safari may not expose longtask */ }

		const tick = () => { frames++; raf = requestAnimationFrame(tick); };
		raf = requestAnimationFrame(tick);

		const iv = setInterval(async () => {
			const now = performance.now();
			const secs = Math.max(0.001, (now - t0) / 1000);
			const fps = frames / secs;
			frames = 0; t0 = now;

			let p = null;
			try { p = (await import('$lib/cpu-atlas.js')).atlasProfile?.(true); } catch {}
			const lt = { ms: ltMs, n: ltN, worst: ltWorst };
			ltMs = 0; ltN = 0;

			live = p
				? `${fps.toFixed(0)}fps · block ${lt.ms.toFixed(0)}ms · baked ${p.rasterN} · pack ${p.pack.toFixed(0)} · read ${p.readback.toFixed(0)}`
				: `${fps.toFixed(0)}fps · block ${lt.ms.toFixed(0)}ms · cpu-atlas idle (wrong engine?)`;

			if (recording > 0) {
				// Tick down even if cpu-atlas gave us nothing — otherwise a
				// missing profile leaves the countdown stuck on 8 forever and
				// the button looks dead.
				if (!p) { recording--; if (recording === 0) finish(); return; }
				acc.secs++; acc.fps += fps;
				acc.lt += lt.ms; acc.ltN += lt.n; acc.worst = Math.max(acc.worst, lt.worst);
				acc.render += p.render; acc.raster += p.raster; acc.pack += p.pack; acc.readback += p.readback;
				acc.rasterN += p.rasterN; acc.pending = p.pending;
				recording--;
				if (recording === 0) finish();
			}
		}, 1000);

		function finish() {
			const a = acc, s = Math.max(1, a.secs);
			const pct = (v) => `${((v / (s * 1000)) * 100).toFixed(0)}%`;
			const ms = (v) => `${(v / s).toFixed(0)}ms/s`;
			report = [
				`${a.secs}s sample · avg ${(a.fps / s).toFixed(1)} fps`,
				`blocked   ${ms(a.lt)}  ${pct(a.lt)}  (${a.ltN} long tasks, worst ${a.worst.toFixed(0)}ms)`,
				`rasterise ${a.rasterN} emotes baked, ${a.pending} queued  (off-thread — no main-thread cost)`,
				`packing   ${ms(a.pack)}  ${pct(a.pack)}`,
				`READBACK  ${ms(a.readback)}  ${pct(a.readback)}  <- disk cache, blocks`,
				`rendering ${ms(a.render)}  ${pct(a.render)}`,
				`warm bake ${warmOff ? 'OFF' : 'ON'}`
			].join('\n');
			note = 'done — Copy it';
			setTimeout(() => { note = ''; }, 4000);
		}

		return () => { cancelAnimationFrame(raf); clearInterval(iv); try { po?.disconnect(); } catch {} };
	});

	function record(e) {
		swallow(e);
		acc = { secs: 0, fps: 0, lt: 0, ltN: 0, worst: 0, render: 0, raster: 0, pack: 0, readback: 0, rasterN: 0, pending: 0 };
		report = '';
		recording = 8;
		note = '● RECORDING — scroll now';
		live = '● recording…';
	}

	async function copy(e) {
		swallow(e);
		const t = report || live;
		try { await navigator.clipboard.writeText(t); note = 'copied'; }
		catch {
			const pre = document.getElementById('ep-out');
			if (pre) {
				const r = document.createRange(); r.selectNodeContents(pre);
				const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
				note = 'selected — hold to Copy';
			}
		}
		setTimeout(() => { note = ''; }, 3000);
	}

	// The A/B is only valid from equal starting states. A warm-ON run bakes the
	// library to disk, so a warm-OFF run straight after reads from the cache the
	// first run just built and looks fast for the wrong reason. Wipe between
	// runs so both start cold.
	async function wipeCache(e) {
		swallow(e);
		note = 'wiping…';
		try {
			await new Promise((res) => {
				const r = indexedDB.deleteDatabase('emote-frame-cache');   // DB_NAME in frame-cache.js
				r.onsuccess = r.onerror = r.onblocked = () => res();
			});
		} catch {}
		location.reload();
	}

	function toggleWarm(e) {
		swallow(e);
		try {
			if (localStorage.getItem('noEmoteWarm') === '1') localStorage.removeItem('noEmoteWarm');
			else localStorage.setItem('noEmoteWarm', '1');
		} catch {}
		location.reload();
	}
</script>

<!-- The bar is click-through: `pointer-events: none` on the container, `auto`
     on just the controls. Swallowing touchmove here was blocking the scroll of
     the grid underneath — the profiler was stopping the very gesture it exists
     to measure. Now touches pass straight through the bar to the picker, and
     only the buttons take input. Each button handler still stops propagation
     on its own event so tapping one cannot dismiss the picker. -->
<div class="ep" role="group" aria-label="emote profiler">

	<div class="ep-live">{live}</div>

	<div class="ep-btns">
		<button class="ep-rec" class:ep-on={recording > 0} onclick={record}>
			{recording > 0 ? `rec ${recording}` : 'Record 8s'}
		</button>
		<button onclick={copy}>Copy</button>
		<button class:ep-warn={warmOff} onclick={toggleWarm}>{warmOff ? 'warm OFF' : 'warm on'}</button>
		<button onclick={wipeCache}>wipe cache</button>
		{#if note}<span class="ep-note">{note}</span>{/if}
	</div>

	{#if report}<pre id="ep-out">{report}</pre>{/if}
</div>

<style>
	.ep {
		/* TOP, not bottom: the picker's rail and the app nav both live at the
		   bottom, and a bar there covers the controls you need. */
		position: fixed; left: 4px; right: 4px; z-index: 2147483000;
		top: calc(env(safe-area-inset-top, 0px) + 4px);
		/* Click-through. Anything that overlaps the grid must not intercept the
		   scroll — see the comment on the markup. */
		pointer-events: none;
		color: #0f0;
		font: 10px/1.35 ui-monospace, monospace;
		display: flex; flex-direction: column; gap: 3px;
		align-items: flex-start;
	}
	/* Only the readout gets a backdrop, and only as wide as its text, so it
	   shades as little of the grid as possible. */
	.ep-live, .ep pre {
		background: rgba(0, 0, 0, 0.82);
		border-radius: 7px; padding: 3px 6px;
	}
	.ep-live { white-space: nowrap; max-width: 100%; overflow-x: auto; }
	.ep-btns { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
	.ep-btns button {
		font: 600 11px system-ui; padding: 7px 11px; border-radius: 7px;
		border: 1px solid #444; background: #1b1b1b; color: #eee;
		/* Big enough to hit while scrolling with a thumb. */
		min-height: 32px;
		pointer-events: auto;   /* the only things that take input */
	}
	.ep pre { pointer-events: auto; }   /* selectable, for the manual-copy path */
	.ep-rec.ep-on {
		background: #dc2626; border-color: #fca5a5; color: #fff;
		animation: ep-pulse 1s steps(2) infinite;
	}
	@keyframes ep-pulse { 50% { opacity: 0.55; } }
	.ep-btns button.ep-warn { background: #7c2d12; border-color: #ea580c; color: #fff; }
	.ep-note { color: #0f0; }
	.ep pre {
		margin: 0; white-space: pre; overflow-x: auto; color: #0f0;
		user-select: text; -webkit-user-select: text;
	}
</style>
