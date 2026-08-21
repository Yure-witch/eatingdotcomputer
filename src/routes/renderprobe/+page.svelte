<script>
	import { onMount } from 'svelte';

	const CSSPX = 50;      // display size
	const FPS_RATE = 24;   // content rate
	const MAX_FRAMES = 48; // per emote — bounds the atlas under max texture size
	const N = 30;          // emotes on screen

	let lines = $state([]);
	let status = $state('starting…');
	let done = $state(false);
	let header = $state('');
	let copied = $state('');
	const say = (s) => { lines = [...lines, s]; };

	async function copyAll() {
		const text = header + '\n\n' + lines.join('\n');
		try {
			await navigator.clipboard.writeText(text);
			copied = 'copied ✓';
		} catch {
			// iOS refuses clipboard writes outside a user gesture / on http
			// origins, and this probe is served over plain http on the LAN —
			// so fall back to selecting the text for a manual copy.
			const pre = document.getElementById('out');
			if (pre) {
				const r = document.createRange();
				r.selectNodeContents(pre);
				const sel = getSelection();
				sel.removeAllRanges(); sel.addRange(r);
				copied = 'selected — press Copy';
			} else copied = 'copy failed';
		}
		setTimeout(() => { copied = ''; }, 2500);
	}

	onMount(async () => {
		const DPR = window.devicePixelRatio || 1;
		// Cap the bake: 30 emotes x 48 frames must fit one texture, and phones
		// commonly stop at 4096. 72px keeps the atlas at 3456x2160.
		const PX = Math.min(Math.round(CSSPX * DPR), 72);

		// Measure the display's real refresh rate — the frame budget depends on it.
		const refresh = await new Promise((res) => {
			let n = 0, t0 = 0;
			const t = (now) => { if (!t0) t0 = now; if (++n < 40) requestAnimationFrame(t); else res(n / ((now - t0) / 1000)); };
			requestAnimationFrame(t);
		});
		const budget = 1000 / refresh;
		// header is set below, once the real emotes are baked and FRAMES is known.

		// ── Bake REAL Telegram emotes through the app's own rlottie pipeline ──
		// Synthetic shapes flatter every approach equally: flat fills, uniform
		// alpha, no antialiased edges. Real emotes have soft edges and partial
		// alpha everywhere, which is what actually costs during a blit.
		status = 'loading emote manifest…';
		let cells = [], FRAMES = 0;
		try {
			const TG = await import('$lib/telegram-emoji-store.js');
			const LS = await import('$lib/lottie-spritesheet.js');
			const man = await TG.loadTelegramEmoji();
			const cps = (man?.emoji || []).filter((e) => !e.flag).slice(0, N).map((e) => e.cp);
			if (!cps.length) throw new Error('no emoji in manifest');
			const srcPx = LS.rasterSizeFor(PX);
			for (let i = 0; i < cps.length; i++) {
				status = `rasterising real emotes… ${i + 1}/${cps.length}`;
				const url = TG.tgAnimatedUrl(cps[i]);
				try {
					const data = await TG.fetchLottie(url);
					if (!data) continue;
					const entry = await LS.acquire(url, data, srcPx, FPS_RATE);
					if (entry.pending) await entry.pending;
					const fr = (entry.frames || []).slice(0, MAX_FRAMES);
					if (fr.length >= 2) cells.push({ url, srcPx, frames: fr, n: fr.length });
					else LS.release(url, srcPx);
				} catch { /* skip */ }
			}
			if (!cells.length) throw new Error('nothing rasterised');
			FRAMES = Math.max(...cells.map((b) => b.n));
		} catch (e) {
			say('could not load real emotes: ' + e.message);
			say('(needs to be online — it pulls the R2 emote manifest)');
			done = true; status = ''; return;
		}

		// One atlas: a row per emote, a column per frame. Every variant samples
		// from this, so the only thing that differs is how pixels reach the screen.
		status = 'packing atlas…';
		const atlas = document.createElement('canvas');
		atlas.width = FRAMES * PX;
		atlas.height = cells.length * PX;
		{
			const c = atlas.getContext('2d');
			for (let r = 0; r < cells.length; r++)
				for (let fi = 0; fi < FRAMES; fi++) {
					const bm = cells[r].frames[Math.min(fi, cells[r].n - 1)];
					if (bm) { try { c.drawImage(bm, 0, 0, bm.width, bm.height, fi * PX, r * PX, PX, PX); } catch {} }
				}
			const LS = await import('$lib/lottie-spritesheet.js');
			for (const b of cells) { try { LS.release(b.url, b.srcPx); } catch {} }
		}
		const stripBmp = await createImageBitmap(atlas);
		// Blob URL, not base64: this atlas is millions of pixels and a data URL
		// would be tens of MB of string for the CSS variants to parse.
		const stripURL = await new Promise((res) => atlas.toBlob((b) => res(URL.createObjectURL(b)), 'image/png'));
		const strip = atlas;
		const ROWS_OF = cells.length;
		const sx = (f) => (((f % FRAMES) + FRAMES) % FRAMES) * PX;
		const sy = (i) => (i % ROWS_OF) * PX;
		header = `${N} cells · ${CSSPX}px @ dpr ${DPR} (baked ${PX}px) · ${ROWS_OF} REAL emotes × ${FRAMES}f @ ${FPS_RATE}fps · ${refresh.toFixed(0)}Hz → ${budget.toFixed(1)}ms budget`;

		const host = document.getElementById('host');
		const grid = (cols) => `display:grid;grid-template-columns:repeat(${cols},${CSSPX}px);gap:2px`;
		const COLS = 6, ROWS = Math.ceil(N / COLS);

		// Every variant returns { draw(frameIdx) } or { css:true } if the
		// compositor animates it and JS does nothing per frame.
		const variants = [];
		const V = (label, kind, build) => variants.push({ label, kind, build });

		V('1 canvas-per-cell 2D', 'js', () => {
			host.style.cssText = grid(COLS);
			const ctxs = [];
			for (let i = 0; i < N; i++) {
				const c = document.createElement('canvas');
				c.width = PX; c.height = PX; c.style.cssText = `width:${CSSPX}px;height:${CSSPX}px`;
				host.appendChild(c); ctxs.push(c.getContext('2d'));
			}
			return { draw: (f) => { for (let i = 0; i < N; i++) ctxs[i].drawImage(strip, sx(f + i), sy(i), PX, PX, 0, 0, PX, PX); } };
		});

		V('2 one canvas, 2D', 'js', () => {
			host.style.cssText = 'display:block';
			const c = document.createElement('canvas');
			c.width = COLS * PX; c.height = ROWS * PX;
			c.style.cssText = `width:${COLS * CSSPX}px;height:${ROWS * CSSPX}px`;
			host.appendChild(c); const g = c.getContext('2d');
			return { draw: (f) => { for (let i = 0; i < N; i++) g.drawImage(strip, sx(f + i), sy(i), PX, PX, (i % COLS) * PX, ((i / COLS) | 0) * PX, PX, PX); } };
		});

		V('3 row canvases, 2D', 'js', () => {
			host.style.cssText = 'display:block';
			const gs = [];
			for (let r = 0; r < ROWS; r++) {
				const c = document.createElement('canvas');
				c.width = COLS * PX; c.height = PX;
				c.style.cssText = `width:${COLS * CSSPX}px;height:${CSSPX}px`;
				host.appendChild(c); gs.push(c.getContext('2d'));
			}
			return { draw: (f) => { for (let i = 0; i < N; i++) gs[(i / COLS) | 0].drawImage(strip, sx(f + i), sy(i), PX, PX, (i % COLS) * PX, 0, PX, PX); } };
		});

		V('4 one canvas, dirty-rect', 'js', () => {
			host.style.cssText = 'display:block';
			const c = document.createElement('canvas');
			c.width = COLS * PX; c.height = ROWS * PX;
			c.style.cssText = `width:${COLS * CSSPX}px;height:${ROWS * CSSPX}px`;
			host.appendChild(c); const g = c.getContext('2d');
			const last = new Int32Array(N).fill(-1);
			// Only touch cells whose frame actually changed — no full clear.
			return { draw: (f) => {
				for (let i = 0; i < N; i++) {
					const fi = (f + i) % FRAMES;
					if (last[i] === fi) continue;
					last[i] = fi;
					g.drawImage(strip, sx(fi), sy(i), PX, PX, (i % COLS) * PX, ((i / COLS) | 0) * PX, PX, PX);
				}
			} };
		});

		V('5 one WebGL, 1 draw call', 'js', () => {
			host.style.cssText = 'display:block';
			const c = document.createElement('canvas');
			c.width = COLS * PX; c.height = ROWS * PX;
			c.style.cssText = `width:${COLS * CSSPX}px;height:${ROWS * CSSPX}px`;
			host.appendChild(c);
			const gl = c.getContext('webgl', { alpha: true, antialias: false, preserveDrawingBuffer: false });
			if (!gl) return { draw: () => {}, fail: 'no webgl' };
			const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
			const p = gl.createProgram();
			gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 a;attribute vec2 u;varying vec2 v;void main(){v=u;gl_Position=vec4(a,0.,1.);}'));
			gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v);}'));
			gl.linkProgram(p); gl.useProgram(p);
			if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return { draw: () => {}, fail: 'shader link failed' };
			const pos = new Float32Array(N * 12), uv = new Float32Array(N * 12);
			for (let i = 0; i < N; i++) {
				const cx = i % COLS, cy = (i / COLS) | 0;
				const x0 = (cx / COLS) * 2 - 1, x1 = ((cx + 1) / COLS) * 2 - 1;
				const y0 = 1 - (cy / ROWS) * 2, y1 = 1 - ((cy + 1) / ROWS) * 2;
				pos.set([x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1], i * 12);
			}
			const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
			gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
			const la = gl.getAttribLocation(p, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
			const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub);
			gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
			const lu = gl.getAttribLocation(p, 'u'); gl.enableVertexAttribArray(lu); gl.vertexAttribPointer(lu, 2, gl.FLOAT, false, 0, 0);
			const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, strip);
			gl.viewport(0, 0, c.width, c.height);
			return { draw: (f) => {
				for (let i = 0; i < N; i++) {
					const u0 = sx(f + i) / atlas.width, u1 = u0 + PX / atlas.width;
					const v0 = sy(i) / atlas.height, v1 = v0 + PX / atlas.height;
					uv.set([u0, v0, u1, v0, u0, v1, u0, v1, u1, v0, u1, v1], i * 12);
				}
				gl.bindBuffer(gl.ARRAY_BUFFER, ub);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, uv);
				gl.drawArrays(gl.TRIANGLES, 0, N * 6);
			} };
		});

		V('6 CSS steps() sprite', 'css', () => {
			// The compositor animates it. JS does nothing per frame at all.
			host.style.cssText = grid(COLS);
			const st = document.createElement('style');
			st.textContent = `@keyframes rp-play{from{background-position-x:0}to{background-position-x:-${FRAMES * CSSPX}px 0}}`;
			host.appendChild(st);
			for (let i = 0; i < N; i++) {
				const d = document.createElement('div');
				d.style.cssText = `width:${CSSPX}px;height:${CSSPX}px;` +
					`background-image:url(${stripURL});background-size:${FRAMES * CSSPX}px ${ROWS_OF * CSSPX}px;background-position-y:-${(i % ROWS_OF) * CSSPX}px;` +
					`animation:rp-play ${FRAMES / FPS_RATE}s steps(${FRAMES}) infinite;animation-delay:-${(i * 0.037).toFixed(3)}s`;
				host.appendChild(d);
			}
			return { css: true };
		});

		V('7 JS background-position', 'js', () => {
			host.style.cssText = grid(COLS);
			const els = [];
			for (let i = 0; i < N; i++) {
				const d = document.createElement('div');
				d.style.cssText = `width:${CSSPX}px;height:${CSSPX}px;` +
					`background-image:url(${stripURL});background-size:${FRAMES * CSSPX}px ${ROWS_OF * CSSPX}px;background-position-y:-${(i % ROWS_OF) * CSSPX}px`;
				host.appendChild(d); els.push(d);
			}
			return { draw: (f) => { for (let i = 0; i < N; i++) els[i].style.backgroundPositionX = `-${((f + i) % FRAMES) * CSSPX}px`; } };
		});

		V('8 bitmaprenderer per cell', 'js', () => {
			host.style.cssText = grid(COLS);
			const ctxs = [], offs = [];
			for (let i = 0; i < N; i++) {
				const c = document.createElement('canvas');
				c.width = PX; c.height = PX; c.style.cssText = `width:${CSSPX}px;height:${CSSPX}px`;
				host.appendChild(c);
				try { ctxs.push(c.getContext('bitmaprenderer')); } catch { ctxs.push(null); }
				// Each cell renders into its own scratch, then hands the result
				// over. transferToImageBitmap CONSUMES the scratch's contents, so
				// this must be redrawn every frame — which is exactly what the
				// real worker path does, minus the worker.
				offs.push(typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(PX, PX) : null);
			}
			if (!offs[0]) return { draw: () => {}, fail: 'no OffscreenCanvas' };
			const ogs = offs.map((o) => o.getContext('2d'));
			return { draw: (f) => {
				for (let i = 0; i < N; i++) {
					if (!ctxs[i] || !ogs[i]) continue;
					ogs[i].drawImage(strip, sx(f + i), sy(i), PX, PX, 0, 0, PX, PX);
					try { ctxs[i].transferFromImageBitmap(offs[i].transferToImageBitmap()); } catch {}
				}
			} };
		});

		V('9 worker → OffscreenCanvas', 'worker', () => {
			host.style.cssText = 'display:block';
			const c = document.createElement('canvas');
			c.width = COLS * PX; c.height = ROWS * PX;
			c.style.cssText = `width:${COLS * CSSPX}px;height:${ROWS * CSSPX}px`;
			host.appendChild(c);
			if (!c.transferControlToOffscreen) return { draw: () => {}, fail: 'no OffscreenCanvas' };
			const src = `
				let g=null,strip=null,cfg=null,raf=0,f=0;
				self.onmessage=(e)=>{
					const m=e.data;
					if(m.t==='init'){ g=m.canvas.getContext('2d'); strip=m.strip; cfg=m; tick(); }
					else if(m.t==='stop'){ self.close(); }
				};
				function tick(){
					const {N,COLS,PX,FRAMES,FPS}=cfg;
					if(!self.__t0) self.__t0=performance.now();
					const idx=Math.floor(((performance.now()-self.__t0)/1000)*FPS);
					for(let i=0;i<N;i++) g.drawImage(strip,((idx+i)%FRAMES)*PX,(i%cfg.ROWS_OF)*PX,PX,PX,(i%COLS)*PX,((i/COLS)|0)*PX,PX,PX);
					f++;
					self.postMessage({t:'f',f,ms:performance.now()-self.__t0});
					raf=requestAnimationFrame(tick);
				}`;
			const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
			const w = new Worker(url);
			const off = c.transferControlToOffscreen();
			let wf = 0, wms = 0;
			w.onmessage = (e) => { if (e.data?.t === 'f') { wf = e.data.f; wms = e.data.ms; } };
			return {
				start() { w.postMessage({ t: 'init', canvas: off, strip: stripBmp, N, COLS, PX, FRAMES, FPS: FPS_RATE, ROWS_OF }, [off]); },
				stop() { try { w.terminate(); } catch {} URL.revokeObjectURL(url); },
				// The main thread does nothing here, so its rAF would look
				// perfect regardless. What matters is whether the WORKER keeps
				// up, so it reports its own rate.
				extra: () => (wms > 0 ? `worker ${(wf / (wms / 1000)).toFixed(0)}fps` : 'worker silent')
			};
		});

		V('10 CSS steps + will-change', 'css', () => {
			host.style.cssText = grid(COLS);
			const st = document.createElement('style');
			st.textContent = `@keyframes rp-play2{from{background-position-x:0}to{background-position-x:-${FRAMES * CSSPX}px 0}}`;
			host.appendChild(st);
			for (let i = 0; i < N; i++) {
				const d = document.createElement('div');
				d.style.cssText = `width:${CSSPX}px;height:${CSSPX}px;will-change:background-position;` +
					`transform:translateZ(0);` +
					`background-image:url(${stripURL});background-size:${FRAMES * CSSPX}px ${ROWS_OF * CSSPX}px;background-position-y:-${(i % ROWS_OF) * CSSPX}px;` +
					`animation:rp-play2 ${FRAMES / FPS_RATE}s steps(${FRAMES}) infinite;animation-delay:-${(i * 0.037).toFixed(3)}s`;
				host.appendChild(d);
			}
			return { css: true };
		});

		// ── Harness ───────────────────────────────────────────────────────
		const DUR = 3200;
		const results = [];

		const run = (v) => new Promise(async (resolve) => {
			host.innerHTML = ''; host.style.cssText = '';
			status = v.label;
			let inst;
			try { inst = v.build(); } catch (e) { say(`${v.label.padEnd(26)} BUILD FAILED: ${e.message}`); return resolve(); }
			if (inst.fail) { say(`${v.label.padEnd(26)} unavailable — ${inst.fail}`); return resolve(); }
			if (inst.prep) { try { await inst.prep(); } catch {} }
			if (inst.start) inst.start();

			// Content clock: advance the frame index at FPS, not once per tick,
			// so every variant animates at the same rate and we compare cost.
			let f = 0, frames = 0, t0 = 0, last = 0;
			const gaps = [], costs = [];
			const WARMUP = 800;   // first paints include layer creation, texture upload, shader compile
			const tick = (now) => {
				if (!t0) { t0 = now; last = now; }
				else if (now - t0 > WARMUP) { gaps.push(now - last); last = now; }
				else last = now;
				frames++;
				if (inst.draw) {
					// THE metric. Frame cadence cannot measure work when vsync is
					// capped (Low Power Mode pins rAF at 30fps, and then every
					// variant reports an identical 33ms p50 no matter what it
					// costs). Time spent inside draw() is hostage to nothing.
					const c0 = performance.now();
					inst.draw(Math.floor(((now - t0) / 1000) * FPS_RATE));
					if (now - t0 > WARMUP) costs.push(performance.now() - c0);
				}
				if (now - t0 < DUR) requestAnimationFrame(tick);
				else {
					if (inst.stop) inst.stop();
					const fps = frames / ((now - t0) / 1000);
					const cs = costs.slice().sort((a, b) => a - b);
					const cost = cs[(cs.length * 0.5) | 0] || 0;      // median ms of work per frame
					const cost95 = cs[(cs.length * 0.95) | 0] || 0;
					const s = gaps.slice().sort((a, b) => a - b);
					const p95 = s[(s.length * 0.95) | 0] || 0;
					const jank = gaps.filter((g) => g > budget * 1.8).length;
					results.push({ label: v.label, kind: v.kind, fps, cost, cost95, p95, jank });
					const ex = inst.extra ? '  ' + inst.extra() : '';
					say(`${v.label.padEnd(26)}${cost.toFixed(2).padStart(7)}${cost95.toFixed(2).padStart(8)}${fps.toFixed(0).padStart(6)}${String(jank).padStart(6)}${ex}`);
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});

		say(`${'variant'.padEnd(26)}${'work'.padStart(7)}${'p95work'.padStart(8)}${'fps'.padStart(6)}${'jank'.padStart(6)}`);
		say(`${''.padEnd(26)}${'ms/frame'.padStart(7)}`);
		say('─'.repeat(60));
		for (const v of variants) { await run(v); await new Promise((r) => setTimeout(r, 350)); }

		host.innerHTML = ''; host.style.cssText = ''; status = '';
		const ranked = results.slice().sort((a, b) => a.cost - b.cost);
		say('');
		say('CHEAPEST → DEAREST by work per frame:');
		ranked.forEach((r, i) => say(`  ${i + 1}. ${r.label.padEnd(26)} ${r.cost.toFixed(2)}ms/frame`));
		say('');
		say(`display ${refresh.toFixed(0)}Hz → ${budget.toFixed(1)}ms budget`);
		if (refresh < 50) say('⚠ 29-31Hz means LOW POWER MODE is on — turn it off and re-run.');
		say('"work" = ms spent in draw() per frame. This is the number that ranks');
		say('the approaches: it measures cost, not how often the OS lets us paint.');
		say('css + worker variants do no main-thread work, so ~0.00 is correct —');
		say('for the worker, judge it by the "worker Nfps" figure instead.');
		done = true;
	});
</script>

<div style="font:12px/1.5 ui-monospace,monospace;padding:.75rem">
	<h2 style="font:600 15px system-ui;margin:0 0 .25rem">render probe {done ? '— done' : status ? `— ${status}` : ''}</h2>
	<p style="margin:0 0 .5rem;color:#666">{header}</p>
	<div id="host" style="margin:.5rem 0;min-height:{Math.ceil(30 / 6) * 52}px"></div>
	<div style="display:flex;gap:.5rem;align-items:center;margin:.5rem 0">
		<button onclick={copyAll}
			style="font:600 13px system-ui;padding:.55rem 1rem;border-radius:999px;border:none;background:#111;color:#fff">
			Copy results
		</button>
		{#if copied}<span style="font:12px system-ui;color:#0a7">{copied}</span>{/if}
	</div>
	<pre id="out" style="white-space:pre;overflow-x:auto;background:#f4f4f5;padding:.6rem;border-radius:8px;font-size:11px;user-select:text;-webkit-user-select:text">{lines.join('\n')}</pre>
	{#if done}<p><b>Tap "Copy results", then paste it back.</b></p>{/if}
</div>
