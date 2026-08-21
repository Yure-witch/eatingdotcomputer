<script>
	import { onMount } from 'svelte';
	let lines = $state([]);
	let done = $state(false);
	const say = (s) => { lines = [...lines, s]; };

	onMount(async () => {
		const DPR = window.devicePixelRatio || 1;
		const CSS = 28, PX = Math.round(CSS * DPR);
		const COLS = 9, ROWS = 10, N = COLS * ROWS;      // 90 cells — a real viewport
		say(`dpr ${DPR} · ${N} cells @ ${PX}px · visibility ${document.visibilityState}`);
		say('');

		// One shared source atlas. Every variant blits from the SAME pixels, so
		// the only thing that differs is how many canvases we draw into.
		const src = document.createElement('canvas');
		src.width = PX * 8; src.height = PX * 8;
		const sctx = src.getContext('2d');
		for (let i = 0; i < 64; i++) {
			const x = (i % 8) * PX, y = ((i / 8) | 0) * PX;
			sctx.fillStyle = `hsl(${i * 5},70%,55%)`;
			sctx.fillRect(x, y, PX, PX);
			sctx.fillStyle = '#fff';
			sctx.fillRect(x + 4, y + 4, PX - 8, 6);
		}

		const host = document.getElementById('host');

		// Measure the display's actual refresh rate — 60 and 120 imply very
		// different budgets, and assuming 60 made the last run's numbers read
		// better than they were.
		const refresh = await new Promise((res) => {
			let n = 0, t0 = 0;
			const t = (now) => {
				if (!t0) t0 = now;
				if (++n < 30) requestAnimationFrame(t);
				else res(n / ((now - t0) / 1000));
			};
			requestAnimationFrame(t);
		});

		// Each variant returns draw(frame), which blits all N cells once.
		const variants = {
			'A: 90 canvases (current)': () => {
				host.style.cssText = `display:grid;grid-template-columns:repeat(${COLS},${CSS}px)`;
				const ctxs = [];
				for (let i = 0; i < N; i++) {
					const c = document.createElement('canvas');
					c.width = PX; c.height = PX;
					c.style.cssText = `width:${CSS}px;height:${CSS}px;display:block`;
					host.appendChild(c);
					ctxs.push(c.getContext('2d'));
				}
				return (f) => {
					for (let i = 0; i < N; i++) {
						const s = (f + i) % 64;
						ctxs[i].drawImage(src, (s % 8) * PX, ((s / 8) | 0) * PX, PX, PX, 0, 0, PX, PX);
					}
				};
			},
			'B: 1 canvas, 90 regions': () => {
				host.style.cssText = 'display:block';
				const c = document.createElement('canvas');
				c.width = COLS * PX; c.height = ROWS * PX;
				c.style.cssText = `width:${COLS * CSS}px;height:${ROWS * CSS}px;display:block`;
				host.appendChild(c);
				const g = c.getContext('2d');
				return (f) => {
					for (let i = 0; i < N; i++) {
						const s = (f + i) % 64;
						g.drawImage(src, (s % 8) * PX, ((s / 8) | 0) * PX, PX, PX,
							(i % COLS) * PX, ((i / COLS) | 0) * PX, PX, PX);
					}
				};
			},
			'C: 10 row canvases': () => {
				host.style.cssText = 'display:block';
				const gs = [];
				for (let r = 0; r < ROWS; r++) {
					const c = document.createElement('canvas');
					c.width = COLS * PX; c.height = PX;
					c.style.cssText = `width:${COLS * CSS}px;height:${CSS}px;display:block`;
					host.appendChild(c);
					gs.push(c.getContext('2d'));
				}
				return (f) => {
					for (let i = 0; i < N; i++) {
						const s = (f + i) % 64;
						gs[(i / COLS) | 0].drawImage(src, (s % 8) * PX, ((s / 8) | 0) * PX, PX, PX,
							(i % COLS) * PX, 0, PX, PX);
					}
				};
			}
		};

		// D: one WebGL canvas, all 90 cells in ONE draw call.
		// Positions are static; per frame we rewrite only the texture coords
		// (which atlas frame each cell shows) and issue a single drawArrays.
		variants['D: 1 WebGL canvas, 1 draw'] = () => {
			host.style.cssText = 'display:block';
			const c = document.createElement('canvas');
			c.width = COLS * PX; c.height = ROWS * PX;
			c.style.cssText = `width:${COLS * CSS}px;height:${ROWS * CSS}px;display:block`;
			host.appendChild(c);
			const gl = c.getContext('webgl2', { alpha: true, antialias: false });
			if (!gl) { return () => {}; }

			const vs = `#version 300 es
			in vec2 a_pos; in vec2 a_uv; out vec2 v_uv;
			void main() { v_uv = a_uv; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
			const fs = `#version 300 es
			precision mediump float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
			void main() { o = texture(u_tex, v_uv); }`;
			const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
			const prog = gl.createProgram();
			gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
			gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
			gl.linkProgram(prog); gl.useProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
				// A failed shader draws nothing and would post a flatteringly
				// high fps for an empty canvas. Say so instead.
				say('   D: shader failed to link — ' + (gl.getProgramInfoLog(prog) || 'no log'));
				return () => {};
			}

			// Static positions: 90 quads, 6 verts each, in clip space.
			const pos = new Float32Array(N * 12);
			for (let i = 0; i < N; i++) {
				const cx = i % COLS, cy = (i / COLS) | 0;
				const x0 = (cx / COLS) * 2 - 1, x1 = ((cx + 1) / COLS) * 2 - 1;
				const y0 = 1 - (cy / ROWS) * 2, y1 = 1 - ((cy + 1) / ROWS) * 2;
				pos.set([x0,y0, x1,y0, x0,y1, x0,y1, x1,y0, x1,y1], i * 12);
			}
			const pb = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, pb);
			gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
			const aPos = gl.getAttribLocation(prog, 'a_pos');
			gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

			const uv = new Float32Array(N * 12);
			const ub = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, ub);
			gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
			const aUv = gl.getAttribLocation(prog, 'a_uv');
			gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

			// The whole atlas uploaded ONCE.
			const tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
			gl.viewport(0, 0, c.width, c.height);

			return (f) => {
				for (let i = 0; i < N; i++) {
					const sIdx = (f + i) % 64;
					const u0 = (sIdx % 8) / 8, v0 = ((sIdx / 8) | 0) / 8;
					const u1 = u0 + 1 / 8, v1 = v0 + 1 / 8;
					uv.set([u0,v0, u1,v0, u0,v1, u0,v1, u1,v0, u1,v1], i * 12);
				}
				gl.bindBuffer(gl.ARRAY_BUFFER, ub);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, uv);
				gl.drawArrays(gl.TRIANGLES, 0, N * 6);   // ONE call, all 90 cells
			};
		};

		const run = (label, build) => new Promise((resolve) => {
			host.innerHTML = '';
			const draw = build();
			let f = 0, t0 = 0, last = 0;
			const gaps = [];
			const tick = (now) => {
				if (!t0) t0 = now; else gaps.push(now - last);
				last = now;
				draw(f++);
				if (now - t0 < 3000) requestAnimationFrame(tick);
				else {
					const fps = f / ((now - t0) / 1000);
					const sorted = gaps.slice().sort((a, b) => a - b);
					const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
					const worst = sorted[sorted.length - 1] || 0;
					say(`${label.padEnd(26)} ${fps.toFixed(1).padStart(5)} fps   p95 ${p95.toFixed(1).padStart(5)}ms   worst ${worst.toFixed(0).padStart(4)}ms`);
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});

		for (const [label, build] of Object.entries(variants)) {
			await run(label, build);
			await new Promise((r) => setTimeout(r, 400));
		}
		host.innerHTML = '';
		host.style.cssText = '';
		say('');
		say(`higher fps + lower p95 = better; your display caps around ${Math.round(refresh)}Hz,`);
		say(`so the frame budget is ${(1000 / refresh).toFixed(1)}ms — p95 above that means dropped frames.`);
		done = true;
	});
</script>

<div style="font:13px/1.6 ui-monospace,monospace;padding:1rem">
	<h2 style="font:600 15px system-ui">canvas-count probe {done ? '— finished' : '— running, ~15s…'}</h2>
	<div id="host"></div>
	<pre style="white-space:pre-wrap;background:#f4f4f5;padding:.75rem;border-radius:8px;margin-top:1rem">{lines.join('\n')}</pre>
	{#if done}<p>Paste the grey box back.</p>{/if}
</div>
