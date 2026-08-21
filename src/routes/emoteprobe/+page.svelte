<script>
	import { onMount } from 'svelte';
	let lines = $state([]);
	let done = $state(false);
	const say = (s) => { lines = [...lines, s]; };

	onMount(async () => {
		const errs = [];
		window.addEventListener('error', (e) => errs.push('ERROR: ' + e.message));
		window.addEventListener('unhandledrejection', (e) => errs.push('REJECT: ' + (e.reason?.message || e.reason)));

		const TG = await import('$lib/telegram-emoji-store.js');
		const A = await import('$lib/cpu-atlas.js');
		await TG.loadTelegramEmoji();
		const man = TG.getCachedTgEmoji() || {};
		const all = (man.emoji || []).map((e) => TG.tgAnimatedUrl(e.cp)).filter(Boolean);
		if (!all.length) { say('no emoji manifest — stop'); done = true; return; }

		const PX = Math.round(28 * (window.devicePixelRatio || 1));
		const N = 90;                       // ~ a real picker viewport
		say(`device: dpr ${window.devicePixelRatio}, cells ${N} @ ${PX}px`);
		say(`visibility: ${document.visibilityState}   (must be "visible")`);
		say('');

		const host = document.getElementById('host');
		// Count real painted frames by wrapping the cell canvases' 2d contexts.
		let blits = 0;
		const mkCell = (i) => {
			const c = document.createElement('canvas');
			c.width = PX; c.height = PX;
			c.style.cssText = `width:28px;height:28px;`;
			host.appendChild(c);
			const g = c.getContext('2d');
			const orig = g.drawImage.bind(g);
			g.drawImage = (...a) => { blits++; return orig(...a); };
			return c;
		};

		const cycle = async (n) => {
			const ids = [];
			for (let i = 0; i < N; i++)
				ids.push(A.registerCanvasCell({ url: all[i % all.length], canvas: mkCell(i), w: PX, h: PX, visible: true, loop: true, maxFps: 20 }));
			blits = 0;
			const t0 = performance.now();
			await new Promise((r) => setTimeout(r, 3000));
			const secs = (performance.now() - t0) / 1000;
			const st = A.atlasStats();
			say(`cycle ${n}: ${(blits / secs).toFixed(0)} blits/s | ${(blits / secs / N).toFixed(1)} fps/cell | pages ${st.pages}/${st.maxPages} = ${(st.bytes / 1048576).toFixed(0)}MB | ANIMATING ${st.cached}/${N}`);
			for (const id of ids) A.unregisterCanvasCell(id);
			host.innerHTML = '';
			A.reclaimMemory?.();
			const after = A.atlasStats();
			say(`         after close: pages ${after.pages}, ${(after.bytes / 1048576).toFixed(0)}MB, cells ${after.cells}`);
		};

		for (let n = 1; n <= 4; n++) await cycle(n);
		say('');
		say(errs.length ? 'EXCEPTIONS:\n' + errs.slice(0, 5).join('\n') : 'no exceptions');
		const fin = A.atlasStats();
		say(`final: ${JSON.stringify(fin)}`);
		say(fin.pages === 0 ? 'VERDICT: memory fully released ✓' : `VERDICT: ${fin.pages} pages still held ✗`);
		done = true;
	});
</script>

<div style="font:13px/1.5 ui-monospace,monospace;padding:1rem;max-width:100%">
	<h2 style="font:600 15px system-ui">emote probe {done ? '— finished' : '— running, ~15s…'}</h2>
	<div id="host" style="display:grid;grid-template-columns:repeat(9,28px);gap:0;margin:.5rem 0"></div>
	<pre style="white-space:pre-wrap;background:#f4f4f5;padding:.75rem;border-radius:8px">{lines.join('\n')}</pre>
	{#if done}<p>Copy everything in the grey box and paste it back.</p>{/if}
</div>
