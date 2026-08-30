<script>
	// The tag orbit: every tag in the gallery as a body under gravity, in WebGL.
	//
	// Not decoration — it's a filter you can read at a glance. Mass is how many
	// links carry the tag, and gravity puts the heaviest ones on the tightest
	// inner orbits, so the shape of the collection is legible before you've
	// read a single label: a dense core of what this class is mostly about,
	// stragglers out on the rim.
	//
	// three.js is imported dynamically. It's ~600KB and only this one view of
	// three needs it — nobody who stays on the grid should pay for it.
	import { onMount } from 'svelte';

	let {
		tags = [],           // [{ tag, n }]
		active = new Set(),  // currently filtered tags
		ontoggle = () => {}
	} = $props();

	let host = $state(null);
	let ready = $state(false);
	let failed = $state(false);
	let hovered = $state(null);

	// Everything three.js touches lives here rather than in $state — Svelte's
	// proxying of a scene graph is pure overhead and can confuse three's own
	// bookkeeping.
	let three = null;

	const css = (name, fallback) => {
		if (typeof window === 'undefined') return fallback;
		const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return v || fallback;
	};

	/** A tag rendered to a canvas, ready to become a sprite texture. */
	function labelCanvas(THREE, text, count) {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const fontPx = 44;
		const pad = 18;
		const measure = document.createElement('canvas').getContext('2d');
		measure.font = `600 ${fontPx}px 'Google Sans Flex', system-ui, sans-serif`;
		const label = `${text}`;
		const sub = `${count}`;
		const wLabel = measure.measureText(label).width;
		measure.font = `400 ${fontPx * 0.62}px 'Google Sans Flex', system-ui, sans-serif`;
		const wSub = measure.measureText(sub).width;
		const w = Math.ceil(wLabel + wSub + pad * 3);
		const h = Math.ceil(fontPx * 1.9);

		const cv = document.createElement('canvas');
		cv.width = Math.ceil(w * dpr);
		cv.height = Math.ceil(h * dpr);
		const ctx = cv.getContext('2d');
		ctx.scale(dpr, dpr);

		// Pill, drawn in white so the sprite can be TINTED per state — one
		// texture per tag for the life of the view, no re-rasterising on hover.
		const r = h / 2;
		ctx.beginPath();
		ctx.moveTo(r, 0);
		ctx.arcTo(w, 0, w, h, r);
		ctx.arcTo(w, h, 0, h, r);
		ctx.arcTo(0, h, 0, 0, r);
		ctx.arcTo(0, 0, w, 0, r);
		ctx.closePath();
		ctx.fillStyle = 'rgba(255,255,255,0.10)';
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.strokeStyle = 'rgba(255,255,255,0.55)';
		ctx.stroke();

		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#ffffff';
		ctx.font = `600 ${fontPx}px 'Google Sans Flex', system-ui, sans-serif`;
		ctx.fillText(label, pad, h / 2 + 1);
		ctx.globalAlpha = 0.55;
		ctx.font = `400 ${fontPx * 0.62}px 'Google Sans Flex', system-ui, sans-serif`;
		ctx.fillText(sub, pad + wLabel + pad * 0.7, h / 2 + 2);

		const tex = new THREE.CanvasTexture(cv);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.anisotropy = 4;
		return { tex, aspect: w / h };
	}

	onMount(() => {
		let raf = 0;
		let disposed = false;
		let ro = null;

		(async () => {
			let THREE;
			try {
				THREE = await import('three');
			} catch {
				failed = true;
				return;
			}
			if (disposed || !host) return;

			const slow = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

			const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setClearAlpha(0);
			host.appendChild(renderer.domElement);
			renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;cursor:pointer';

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
			camera.position.set(0, 0, 26);

			const accent = new THREE.Color(css('--accent', '#7c9cff'));
			const ink = new THREE.Color(css('--ink', '#f4f4f5'));

			// ── bodies ────────────────────────────────────────────────────────
			// Heavier tag = more links = tighter, faster inner orbit. Radius is
			// inverse in the count, so the busiest tags make a visible core.
			const maxN = Math.max(1, ...tags.map((t) => t.n));
			const bodies = tags.map((t, i) => {
				const weight = t.n / maxN;                       // 0..1
				const radius = 3.2 + (1 - weight) * 5.0;         // heavy = close in
				// Golden-angle spread so the initial ring never lines up.
				const a = i * 2.399963;
				const tilt = (i % 5 - 2) * 0.16;                 // a little depth
				const pos = new THREE.Vector3(
					Math.cos(a) * radius,
					Math.sin(a) * radius * Math.cos(tilt),
					Math.sin(a) * radius * Math.sin(tilt) * 2.2
				);
				// Circular-orbit speed for this radius, perpendicular to the
				// radius vector — that's what makes it orbit rather than fall in.
				const up = new THREE.Vector3(0.15, 0.2, 1).normalize();
				const vel = new THREE.Vector3().crossVectors(up, pos).normalize()
					.multiplyScalar(Math.sqrt(GRAV / radius));

				const { tex, aspect } = labelCanvas(THREE, t.tag, t.n);
				const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
				const sprite = new THREE.Sprite(mat);
				const scale = 0.62 + Math.sqrt(weight) * 0.72;
				sprite.scale.set(scale * aspect, scale, 1);
				sprite.userData.tag = t.tag;
				scene.add(sprite);

				return { tag: t.tag, pos, vel, sprite, mat, mass: 0.6 + weight, scale, aspect };
			});

			// Zero the system's net momentum and recentre its mass. Without
			// this the whole cloud sails slowly off to one side — the orbits
			// look right, but the thing you're meant to be reading drifts out
			// of the frame over a minute or two.
			{
				const totalMass = bodies.reduce((m, b) => m + b.mass, 0) || 1;
				const meanV = new THREE.Vector3();
				const meanP = new THREE.Vector3();
				for (const b of bodies) {
					meanV.addScaledVector(b.vel, b.mass);
					meanP.addScaledVector(b.pos, b.mass);
				}
				meanV.divideScalar(totalMass);
				meanP.divideScalar(totalMass);
				for (const b of bodies) {
					b.vel.sub(meanV);
					b.pos.sub(meanP);
					b.sprite.position.copy(b.pos);
				}
			}

			function paint() {
				for (const b of bodies) {
					const on = active.has(b.tag);
					const hot = hovered === b.tag;
					b.mat.color.copy(on ? accent : ink);
					b.mat.opacity = on ? 1 : hot ? 0.95 : 0.62;
					const s = b.scale * (on ? 1.18 : hot ? 1.08 : 1);
					b.sprite.scale.set(s * b.aspect, s, 1);
				}
			}
			paint();

			// ── interaction ───────────────────────────────────────────────────
			const ray = new THREE.Raycaster();
			const ndc = new THREE.Vector2();
			let pointerInside = false;

			function pick(ev) {
				const r = renderer.domElement.getBoundingClientRect();
				ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
				ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
				ray.setFromCamera(ndc, camera);
				const hit = ray.intersectObjects(bodies.map((b) => b.sprite), false)[0];
				return hit?.object?.userData?.tag ?? null;
			}
			const onMove = (ev) => { pointerInside = true; hovered = pick(ev); };
			const onLeave = () => { pointerInside = false; hovered = null; };
			const onClick = (ev) => { const t = pick(ev); if (t) ontoggle(t); };
			renderer.domElement.addEventListener('pointermove', onMove);
			renderer.domElement.addEventListener('pointerleave', onLeave);
			renderer.domElement.addEventListener('click', onClick);

			// ── size ──────────────────────────────────────────────────────────
			function resize() {
				const r = host.getBoundingClientRect();
				const w = Math.max(1, r.width), h = Math.max(1, r.height);
				renderer.setSize(w, h, false);
				camera.aspect = w / h;
				// Pull the camera back on a narrow viewport so the whole system
				// stays in frame instead of orbiting off the sides.
				camera.position.z = 26 * Math.max(1, 1.35 - w / 900);
				camera.updateProjectionMatrix();
			}
			ro = new ResizeObserver(resize);
			ro.observe(host);
			resize();

			// ── the sim ───────────────────────────────────────────────────────
			const tmp = new THREE.Vector3();
			let last = performance.now();

			// dt is in SECONDS throughout — the constants are accelerations in
			// units/s², not per-frame nudges, so the motion is identical at 60Hz
			// and 120Hz.
			function step(dt) {
				// Gravity toward the centre, softened near the origin so a body
				// that wanders in doesn't get slingshotted to infinity.
				for (const b of bodies) {
					const d2 = Math.max(2.5, b.pos.lengthSq());
					tmp.copy(b.pos).normalize().multiplyScalar((-GRAV / d2) * dt);
					b.vel.add(tmp);
				}
				// Mutual repulsion — this is what stops labels from stacking on
				// top of each other, which is the whole readability problem with
				// a tag cloud that moves.
				for (let i = 0; i < bodies.length; i++) {
					for (let j = i + 1; j < bodies.length; j++) {
						const a = bodies[i], c = bodies[j];
						tmp.subVectors(a.pos, c.pos);
						const d = Math.max(0.9, tmp.length());
						const f = (REPEL / (d * d)) * dt;
						tmp.normalize().multiplyScalar(f);
						a.vel.addScaledVector(tmp, 1 / a.mass);
						c.vel.addScaledVector(tmp, -1 / c.mass);
					}
				}
				const decay = Math.pow(DAMP_PER_SEC, dt);
				for (const b of bodies) {
					b.vel.multiplyScalar(decay);
					b.pos.addScaledVector(b.vel, dt);
					// Soft wall. Repulsion between a dozen bodies otherwise adds
					// up outward and slowly evacuates the frame; this bounds the
					// system without freezing the orbits.
					const r = b.pos.length();
					if (r > MAX_R) {
						b.pos.multiplyScalar(MAX_R / r);
						b.vel.addScaledVector(b.pos, (-1.5 * dt) / MAX_R);
					}
					b.sprite.position.copy(b.pos);
				}
			}

			const loop = (now) => {
				const dt = Math.min((now - last) / 1000, 0.05) * (slow ? 0.25 : 1);
				last = now;
				step(dt);
				// A slow drift of the whole system, so it reads as alive even
				// when the orbits have settled.
				scene.rotation.y += dt * (slow ? 0.02 : 0.06);
				renderer.render(scene, camera);
				raf = requestAnimationFrame(loop);
			};
			raf = requestAnimationFrame(loop);
			ready = true;

			// Selection and hover are Svelte state; repaint when either moves.
			three = { paint, renderer, scene, bodies, dispose: () => {
				cancelAnimationFrame(raf);
				renderer.domElement.removeEventListener('pointermove', onMove);
				renderer.domElement.removeEventListener('pointerleave', onLeave);
				renderer.domElement.removeEventListener('click', onClick);
				for (const b of bodies) { b.mat.map.dispose(); b.mat.dispose(); }
				renderer.dispose();
				renderer.domElement.remove();
			} };
			void pointerInside;
		})();

		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			ro?.disconnect();
			three?.dispose();
			three = null;
		};
	});

	// Accelerations in units/s², tuned against ~20 bodies in a view whose
	// visible half-height at the origin plane is about 11 units.
	const GRAV = 22;          // circular orbit at r=6 takes roughly 20s
	const REPEL = 5.5;        // labels that touch are unreadable, so bias it high
	const DAMP_PER_SEC = 0.86;
	const MAX_R = 9.5;

	// Repaint on any selection/hover change — cheap, it's only material tweaks.
	$effect(() => {
		void [active, hovered];
		three?.paint();
	});
</script>

<div class="orbit" bind:this={host}>
	{#if failed}
		<p class="fallback">This view needs WebGL, which this browser isn't giving us.</p>
	{:else if !ready}
		<p class="fallback">Starting the orbit…</p>
	{/if}
</div>

<style>
	.orbit {
		position: relative;
		width: 100%;
		height: min(70dvh, 620px);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
		background:
			radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%),
			color-mix(in srgb, var(--ink) 4%, transparent);
		touch-action: manipulation;
	}
	.fallback {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		font-size: 0.82rem;
		color: var(--muted-fg);
	}
</style>
