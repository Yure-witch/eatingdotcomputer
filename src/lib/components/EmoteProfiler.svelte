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
				? `${fps.toFixed(0)}fps · block ${lt.ms.toFixed(0)}ms · rast ${p.raster.toFixed(0)} · pack ${p.pack.toFixed(0)} · read ${p.readback.toFixed(0)}`
				: `${fps.toFixed(0)}fps · block ${lt.ms.toFixed(0)}ms · cpu-atlas idle (wrong engine?)`;

			if (recording > 0 && p) {
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
				`rasterise ${ms(a.raster)}  ${pct(a.raster)}  (${a.rasterN} emotes, ${a.pending} queued)`,
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
		note = 'scroll now — 8s';
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

	function toggleWarm(e) {
		swallow(e);
		try {
			if (localStorage.getItem('noEmoteWarm') === '1') localStorage.removeItem('noEmoteWarm');
			else localStorage.setItem('noEmoteWarm', '1');
		} catch {}
		location.reload();
	}
</script>

<!-- Every pointer event is swallowed: the picker closes on outside taps and on
     wheel/touchmove, so an un-guarded overlay dismisses the surface it exists
     to measure. -->
<div class="ep"
	onclickcapture={swallow} onpointerdowncapture={swallow}
	ontouchstartcapture={swallow} ontouchmovecapture={swallow} onwheelcapture={swallow}
	role="group" aria-label="emote profiler">

	<div class="ep-live">{live}</div>

	<div class="ep-btns">
		<button class="ep-rec" class:ep-on={recording > 0} onclick={record}>
			{recording > 0 ? `rec ${recording}` : 'Record 8s'}
		</button>
		<button onclick={copy}>Copy</button>
		<button class:ep-warn={warmOff} onclick={toggleWarm}>{warmOff ? 'warm OFF' : 'warm on'}</button>
		{#if note}<span class="ep-note">{note}</span>{/if}
	</div>

	{#if report}<pre id="ep-out">{report}</pre>{/if}
</div>

<style>
	.ep {
		position: fixed; left: 4px; right: 4px; bottom: 4px; z-index: 2147483000;
		background: rgba(0, 0, 0, 0.88); color: #0f0;
		font: 10px/1.4 ui-monospace, monospace;
		border-radius: 10px; padding: 5px 7px;
		display: flex; flex-direction: column; gap: 4px;
	}
	.ep-live { white-space: nowrap; overflow-x: auto; }
	.ep-btns { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
	.ep-btns button {
		font: 600 11px system-ui; padding: 7px 11px; border-radius: 7px;
		border: 1px solid #444; background: #1b1b1b; color: #eee;
		/* Big enough to hit while scrolling with a thumb. */
		min-height: 32px;
	}
	.ep-rec.ep-on { background: #7f1d1d; border-color: #b91c1c; color: #fff; }
	.ep-btns button.ep-warn { background: #7c2d12; border-color: #ea580c; color: #fff; }
	.ep-note { color: #0f0; }
	.ep pre {
		margin: 0; white-space: pre; overflow-x: auto; color: #0f0;
		user-select: text; -webkit-user-select: text;
	}
</style>
