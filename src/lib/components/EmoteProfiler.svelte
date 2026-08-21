<script>
	// TEMPORARY live profiler for the emote picker.
	//
	// A synthetic benchmark of ten render approaches — real emotes, 90 cells —
	// reported every one of them under 1ms at 60fps with zero jank, while the
	// actual picker ran at ~1fps. That gap is the reason this exists: the cost
	// is demonstrably NOT in drawing frames, so it has to be measured where it
	// actually happens rather than modelled.
	//
	// Samples once a second and reports the DELTA over that second, so every
	// number is "ms of the last 1000ms spent here". Anything approaching 1000
	// is the bottleneck.
	//
	// Delete with /renderprobe once the cause is found.
	import { onMount } from 'svelte';

	let open = $state(false);
	let rows = $state([]);
	let copied = $state('');
	let peak = $state({ longest: 0 });

	onMount(() => {
		let raf = 0, frames = 0, t0 = performance.now();
		let longTaskMs = 0, longTaskN = 0, longest = 0;

		// Long tasks are the ground truth for "the main thread was blocked".
		let po = null;
		try {
			po = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) {
					longTaskMs += e.duration; longTaskN++;
					if (e.duration > longest) { longest = e.duration; peak = { longest }; }
				}
			});
			po.observe({ entryTypes: ['longtask'] });
		} catch { /* Safari may not expose longtask */ }

		const tick = () => { frames++; raf = requestAnimationFrame(tick); };
		raf = requestAnimationFrame(tick);

		const iv = setInterval(async () => {
			const now = performance.now();
			const secs = (now - t0) / 1000;
			const fps = frames / secs;
			frames = 0; t0 = now;

			let p = null;
			try { p = (await import('$lib/cpu-atlas.js')).atlasProfile?.(true); } catch {}
			const lt = { ms: longTaskMs, n: longTaskN };
			longTaskMs = 0; longTaskN = 0;

			const ms = (v) => (v || 0).toFixed(0).padStart(4);
			rows = [
				`fps ${fps.toFixed(0)}   longtasks ${lt.n} = ${ms(lt.ms)}ms   worst ever ${peak.longest.toFixed(0)}ms`,
				p ? `render   ${ms(p.render)}ms / ${p.renderN} frames` : 'cpu-atlas not loaded',
				p ? `raster   ${ms(p.raster)}ms / ${p.rasterN} emotes   (${p.lanesNow} in flight, ${p.pending} queued)` : '',
				p ? `pack     ${ms(p.pack)}ms / ${p.packN}` : '',
				p ? `READBACK ${ms(p.readback)}ms / ${p.readbackN}   <- disk cache, blocks the thread` : ''
			].filter(Boolean);
		}, 1000);

		return () => { cancelAnimationFrame(raf); clearInterval(iv); try { po?.disconnect(); } catch {} };
	});

	async function copy() {
		const t = rows.join('\n');
		try { await navigator.clipboard.writeText(t); copied = 'copied'; }
		catch { copied = 'select manually'; }
		setTimeout(() => { copied = ''; }, 2000);
	}
	function toggleWarm() {
		try {
			const off = localStorage.getItem('noEmoteWarm') === '1';
			if (off) localStorage.removeItem('noEmoteWarm');
			else localStorage.setItem('noEmoteWarm', '1');
			location.reload();
		} catch {}
	}
	const warmOff = () => { try { return localStorage.getItem('noEmoteWarm') === '1'; } catch { return false; } };
</script>

<div class="ep" class:ep-open={open}>
	<button class="ep-tab" onclick={() => (open = !open)}>{open ? '×' : '⏱'}</button>
	{#if open}
		<pre>{rows.join('\n')}</pre>
		<div class="ep-btns">
			<button onclick={copy}>copy</button>
			<button onclick={toggleWarm}>{warmOff() ? 'warm: OFF' : 'warm: on'}</button>
			<a href="/renderprobe">bench</a>
			{#if copied}<span>{copied}</span>{/if}
		</div>
	{/if}
</div>

<style>
	.ep {
		position: fixed; left: 6px; bottom: 6px; z-index: 99999;
		font: 10px/1.35 ui-monospace, monospace;
		pointer-events: auto;
	}
	.ep-tab {
		width: 30px; height: 30px; border-radius: 50%; border: none;
		background: rgba(0, 0, 0, 0.72); color: #fff; font-size: 14px;
	}
	.ep-open {
		background: rgba(0, 0, 0, 0.86); color: #0f0;
		padding: 6px 8px; border-radius: 10px; max-width: 92vw;
	}
	.ep pre { margin: 4px 0; white-space: pre; overflow-x: auto; color: #0f0; }
	.ep-btns { display: flex; gap: 6px; align-items: center; }
	.ep-btns button, .ep-btns a {
		font: 10px ui-monospace, monospace; padding: 3px 7px; border-radius: 6px;
		border: 1px solid #555; background: #222; color: #ddd; text-decoration: none;
	}
	.ep-btns span { color: #0f0; }
</style>
