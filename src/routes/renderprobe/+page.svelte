<script>
	import { onMount } from 'svelte';

	const CSSPX = 50;      // display size
	const FRAMES = 24;     // frames in the loop
	const FPS = 24;        // content rate
	const N = 30;          // emotes on screen

	let lines = $state([]);
	let running = $state('');
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
		const DPR = Math.min(window.devicePixelRatio || 1, 3);
		const PX = Math.round(CSSPX * DPR);

		// Measure the display's real refresh rate — the frame budget depends on it.
		const refresh = await new Promise((res) => {
			let n = 0, t0 = 0;
			const t = (now) => { if (!t0) t0 = now; if (++n < 40) requestAnimationFrame(t); else res(n / ((now - t0) / 1000)); };
			requestAnimationFrame(t);
		});
		const budget = 1000 / refresh;
		header = `${N} cells · ${CSSPX}px @ dpr ${DPR} (${PX}px) · ${FRAMES}f @ ${FPS}fps · ${refresh.toFixed(0)}Hz → ${budget.toFixed(1)}ms budget`;

		// ── Source: ONE horizontal sprite strip, shared by every variant ──
		const strip = document.createElement('canvas');
		strip.width = PX * FRAMES; strip.height = PX;
		{
			const c = strip.getContext('2d');
			for (let i = 0; i < FRAMES; i++) {
				const x = i * PX, a = (i / FRAMES) * Math.PI * 2;
				c.fillStyle = `hsl(${(i * 360) / FRAMES},75%,55%)`;
				c.fillRect(x, 0, PX, PX);
				c.fillStyle = '#fff';
				c.beginPath();
				c.arc(x + PX / 2 + Math.cos(a) * PX * 0.25, PX / 2 + Math.sin(a) * PX * 0.25, PX * 0.16, 0, 7);
				c.fill();
			}
		}
		const stripBmp = await createImageBitmap(strip);
		const stripURL = strip.toDataURL();

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
			return { draw: (f) => { for (let i = 0; i < N; i++) ctxs[i].drawImage(strip, ((f + i) % FRAMES) * PX, 0, PX, PX, 0, 0, PX, PX); } };
		});

		V('2 one canvas, 2D', 'js', () => {
			host.style.cssText = 'display:block';
			const c = document.createElement('canvas');
			c.width = COLS * PX; c.height = ROWS * PX;
			c.style.cssText = `width:${COLS * CSSPX}px;height:${ROWS * CSSPX}px`;
			host.appendChild(c); const g = c.getContext('2d');
			return { draw: (f) => { for (let i = 0; i < N; i++) g.drawImage(strip, ((f + i) % FRAMES) * PX, 0, PX, PX, (i % COLS) * PX, ((i / COLS) | 0) * PX, PX, PX); } };
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
			return { draw: (f) => { for (let i = 0; i < N; i++) gs[(i / COLS) | 0].drawImage(strip, ((f + i) % FRAMES) * PX, 0, PX, PX, (i % COLS) * PX, 0, PX, PX); } };
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
					g.drawImage(strip, fi * PX, 0, PX, PX, (i % COLS) * PX, ((i / COLS) | 0) * PX, PX, PX);
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
					const fi = (f + i) % FRAMES, u0 = fi / FRAMES, u1 = u0 + 1 / FRAMES;
					uv.set([u0, 0, u1, 0, u0, 1, u0, 1, u1, 0, u1, 1], i * 12);
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
			st.textContent = `@keyframes rp-play{from{background-position:0 0}to{background-position:-${FRAMES * CSSPX}px 0}}`;
			host.appendChild(st);
			for (let i = 0; i < N; i++) {
				const d = document.createElement('div');
				d.style.cssText = `width:${CSSPX}px;height:${CSSPX}px;` +
					`background-image:url(${stripURL});background-size:${FRAMES * CSSPX}px ${CSSPX}px;` +
					`animation:rp-play ${FRAMES / FPS}s steps(${FRAMES}) infinite;animation-delay:-${(i * 0.037).toFixed(3)}s`;
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
					`background-image:url(${stripURL});background-size:${FRAMES * CSSPX}px ${CSSPX}px`;
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
					ogs[i].drawImage(strip, ((f + i) % FRAMES) * PX, 0, PX, PX, 0, 0, PX, PX);
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
					for(let i=0;i<N;i++) g.drawImage(strip,((idx+i)%FRAMES)*PX,0,PX,PX,(i%COLS)*PX,((i/COLS)|0)*PX,PX,PX);
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
				start() { w.postMessage({ t: 'init', canvas: off, strip: stripBmp, N, COLS, PX, FRAMES, FPS }, [off]); },
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
			st.textContent = `@keyframes rp-play2{from{background-position:0 0}to{background-position:-${FRAMES * CSSPX}px 0}}`;
			host.appendChild(st);
			for (let i = 0; i < N; i++) {
				const d = document.createElement('div');
				d.style.cssText = `width:${CSSPX}px;height:${CSSPX}px;will-change:background-position;` +
					`transform:translateZ(0);` +
					`background-image:url(${stripURL});background-size:${FRAMES * CSSPX}px ${CSSPX}px;` +
					`animation:rp-play2 ${FRAMES / FPS}s steps(${FRAMES}) infinite;animation-delay:-${(i * 0.037).toFixed(3)}s`;
				host.appendChild(d);
			}
			return { css: true };
		});

		// ── Harness ───────────────────────────────────────────────────────
		const DUR = 3200;
		const results = [];

		const run = (v) => new Promise(async (resolve) => {
			host.innerHTML = ''; host.style.cssText = '';
			running = v.label;
			let inst;
			try { inst = v.build(); } catch (e) { say(`${v.label.padEnd(26)} BUILD FAILED: ${e.message}`); return resolve(); }
			if (inst.fail) { say(`${v.label.padEnd(26)} unavailable — ${inst.fail}`); return resolve(); }
			if (inst.prep) { try { await inst.prep(); } catch {} }
			if (inst.start) inst.start();

			// Content clock: advance the frame index at FPS, not once per tick,
			// so every variant animates at the same rate and we compare cost.
			let f = 0, frames = 0, t0 = 0, last = 0;
			const gaps = [];
			const tick = (now) => {
				if (!t0) { t0 = now; last = now; }
				else { gaps.push(now - last); last = now; }
				frames++;
				if (inst.draw) inst.draw(Math.floor(((now - t0) / 1000) * FPS));
				if (now - t0 < DUR) requestAnimationFrame(tick);
				else {
					if (inst.stop) inst.stop();
					const fps = frames / ((now - t0) / 1000);
					const s = gaps.slice().sort((a, b) => a - b);
					const p50 = s[(s.length * 0.5) | 0] || 0;
					const p95 = s[(s.length * 0.95) | 0] || 0;
					const worst = s[s.length - 1] || 0;
					const jank = gaps.filter((g) => g > budget * 1.8).length;
					results.push({ label: v.label, kind: v.kind, fps, p50, p95, worst, jank });
					const ex = inst.extra ? '  ' + inst.extra() : '';
					say(`${v.label.padEnd(26)}${fps.toFixed(0).padStart(4)}fps  p50 ${p50.toFixed(1).padStart(5)}  p95 ${p95.toFixed(1).padStart(5)}  worst ${worst.toFixed(0).padStart(4)}  jank ${String(jank).padStart(3)}${ex}`);
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});

		say(`${'variant'.padEnd(26)} fps    p50     p95    worst  jank`);
		say('─'.repeat(72));
		for (const v of variants) { await run(v); await new Promise((r) => setTimeout(r, 350)); }

		host.innerHTML = ''; host.style.cssText = ''; running = '';
		const ranked = results.slice().sort((a, b) => (a.p95 - b.p95) || (b.fps - a.fps));
		say('');
		say('BEST → WORST by p95 frame time (lower = smoother):');
		ranked.forEach((r, i) => say(`  ${i + 1}. ${r.label.padEnd(26)} p95 ${r.p95.toFixed(1)}ms  jank ${r.jank}`));
		say('');
		say(`budget ${budget.toFixed(1)}ms · "jank" = frames over 1.8x budget`);
		say('css variants do ZERO js per frame — the compositor animates them');
		done = true;
	});
</script>

<div style="font:12px/1.5 ui-monospace,monospace;padding:.75rem">
	<h2 style="font:600 15px system-ui;margin:0 0 .25rem">render probe {done ? '— done' : running ? `— ${running}` : '— starting…'}</h2>
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
