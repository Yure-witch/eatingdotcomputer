// Text GIFs — REAL 3D. Extruded, beveled letters rendered with three.js PBR
// materials under a studio environment map (RoomEnvironment → PMREM), so metal
// actually reflects and edges catch highlights. Blits its WebGL canvas onto the
// shared 2D export ctx over a painted background, matching the { step, render,
// ready } scene contract the GIF encoder wants (see gif-studio.js encodeGif).
//
// Design notes that keep it from being kitschy:
//   • ACES tone mapping + RoomEnvironment reflections (product-render look).
//   • Beveled geometry (curveSegments/bevelSegments) so edges aren't faceted.
//   • Supersampled offscreen buffer, downscaled on blit, for clean AA.
//   • ONE renderer per scene, options read live via getOpts — never recreate a
//     GL context on a slider change (that exhausts the browser's ~16 contexts).

import { paintBg } from './text-gifs.js';

const TAU = Math.PI * 2;

// Material presets — each returns a configured MeshPhysicalMaterial. `tint` is
// the page's colour picker; presets use it where it reads well.
export const TEXT_MATERIALS = [
	{ id: 'chrome', name: 'Chrome' },
	{ id: 'gold', name: 'Gold' },
	{ id: 'candy', name: 'Candy' },
	{ id: 'holo', name: 'Holographic' },
	{ id: 'glass', name: 'Glass' },
	{ id: 'obsidian', name: 'Obsidian' }
];

export const TEXT_MOTIONS = [
	{ id: 'spin', name: 'Turntable' },
	{ id: 'bob', name: 'Bob' },
	{ id: 'sway', name: 'Sway' },
	{ id: 'tumble', name: 'Tumble' }
];

function makeMaterial(THREE, id, tintHex) {
	const tint = new THREE.Color(tintHex || '#ffffff');
	const base = { envMapIntensity: 1.15 };
	switch (id) {
		case 'gold':
			return new THREE.MeshPhysicalMaterial({ ...base, color: 0xffd27a, metalness: 1, roughness: 0.22, envMapIntensity: 1.3 });
		case 'candy':
			return new THREE.MeshPhysicalMaterial({ ...base, color: tint, metalness: 0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0.3 });
		case 'holo':
			return new THREE.MeshPhysicalMaterial({ ...base, color: 0xdfe7ff, metalness: 1, roughness: 0.18, iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 460] });
		case 'glass':
			return new THREE.MeshPhysicalMaterial({ ...base, color: tint, metalness: 0, roughness: 0.03, transmission: 1, ior: 1.5, thickness: 1.2, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true });
		case 'obsidian':
			return new THREE.MeshPhysicalMaterial({ ...base, color: 0x0a0a0f, metalness: 0.9, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });
		case 'chrome':
		default:
			return new THREE.MeshPhysicalMaterial({ ...base, color: 0xffffff, metalness: 1, roughness: 0.04, envMapIntensity: 1.35 });
	}
}

// Per-frame transform for a motion preset. All loop seamlessly over phase 0..1.
function motionTransform(id, phase) {
	const s = Math.sin(phase * TAU);
	switch (id) {
		case 'bob':    return { rx: -0.12 + s * 0.05, ry: Math.sin(phase * TAU) * 0.28, py: s * 0.14 };
		case 'sway':   return { rx: Math.sin(phase * TAU * 2) * 0.1, ry: s * 0.7, py: 0 };
		case 'tumble': return { rx: -0.16 + Math.sin(phase * TAU) * 0.10, ry: phase * TAU, py: 0 };
		case 'spin':
		default:       return { rx: -0.16, ry: phase * TAU, py: 0 };
	}
}

export function makeText3DScene(getOpts, W, H, { supersample = 1 } = {}) {
	let t = 0, T = null, failed = false, loading = false, initP = null;
	let geoKey = '';
	const ss = Math.max(1, supersample);
	const BW = Math.round(W * ss), BH = Math.round(H * ss);

	async function init() {
		loading = true;
		try {
			const THREE = await import('three');
			const { TextGeometry } = await import('three/examples/jsm/geometries/TextGeometry.js');
			const { FontLoader } = await import('three/examples/jsm/loaders/FontLoader.js');
			const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
			const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
			const fontJson = await fetch('/fonts/helvetiker_bold.typeface.json').then((r) => r.json());
			const font = new FontLoader().parse(fontJson);

			const glcv = document.createElement('canvas');
			glcv.width = BW; glcv.height = BH;
			const renderer = new THREE.WebGLRenderer({ canvas: glcv, antialias: true, alpha: true, preserveDrawingBuffer: true });
			renderer.setPixelRatio(1);
			renderer.setSize(BW, BH, false);
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.05;

			const scene = new THREE.Scene();
			const pmrem = new THREE.PMREMGenerator(renderer);
			const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
			scene.environment = envRT.texture;

			const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
			const CAM_Z = 6;
			camera.position.set(0, 0, CAM_Z);

			// A crisp key light on top of the environment for extra sparkle on edges.
			scene.add(new THREE.AmbientLight(0xffffff, 0.15));
			const key = new THREE.DirectionalLight(0xffffff, 1.6);
			key.position.set(3, 5, 6);
			scene.add(key);

			const group = new THREE.Group();
			scene.add(group);

			T = { THREE, TextGeometry, mergeGeometries, renderer, scene, camera, group, font, glcv, mesh: null, mat: null, matId: null, pmrem, envRT, camZ: CAM_Z };
		} catch (e) {
			console.warn('[text-3d] init failed', e);
			failed = true;
		}
		loading = false;
	}

	function buildGeometry(o) {
		const text = (o.text ?? '').length ? o.text : ' ';
		const key = text + '|' + (o.uppercase ? 'U' : 'u') + '|' + (o.depth ?? 1) + '|' + BW + 'x' + BH;
		if (key === geoKey) return;
		geoKey = key;
		const { THREE, TextGeometry, mergeGeometries, group, font } = T;
		if (T.mesh) { group.remove(T.mesh); T.mesh.geometry.dispose(); T.mesh = null; }

		const str = o.uppercase ? text.toUpperCase() : text;
		const size = 1;
		const depth = size * 0.28 * (o.depth ?? 1);
		// Build one geometry per glyph then merge — TextGeometry on a whole string
		// works too, but per-glyph lets a bad glyph be skipped without failing.
		const geos = [];
		let penX = 0;
		const spacing = size * 0.14;
		for (const ch of str) {
			if (ch === ' ') { penX += size * 0.5; continue; }
			let geo;
			try {
				geo = new TextGeometry(ch, {
					font, size, depth, curveSegments: 10,
					bevelEnabled: true, bevelThickness: size * 0.03, bevelSize: size * 0.02, bevelSegments: 4
				});
			} catch { continue; }
			geo.computeBoundingBox();
			const bb = geo.boundingBox;
			const w = bb.max.x - bb.min.x;
			geo.translate(penX - bb.min.x, 0, 0);
			geos.push(geo);
			penX += w + spacing;
		}
		if (!geos.length) return;
		const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
		if (geos.length > 1) for (const g of geos) g.dispose();
		merged.computeBoundingBox();
		merged.center();
		merged.computeVertexNormals();

		// Scale to fit the frame with margin for rotation/bevel/depth.
		const bb = merged.boundingBox;
		const tw = bb.max.x - bb.min.x, th = bb.max.y - bb.min.y;
		const visH = 2 * T.camZ * Math.tan((32 * Math.PI) / 180 / 2);
		const visW = visH * (W / H);
		const fit = 0.62 * Math.min(visW / tw, visH / th);
		const mat = ensureMaterial(o);
		const mesh = new THREE.Mesh(merged, mat);
		mesh.scale.setScalar(fit);
		group.add(mesh);
		T.mesh = mesh;
	}

	function ensureMaterial(o) {
		const id = o.material || 'chrome';
		if (T.mat && T.matId === id && id !== 'candy' && id !== 'glass') {
			return T.mat;
		}
		// candy/glass read the tint live; rebuild cheaply when it changes handled below
		if (T.mat && (T.matId !== id)) { T.mat.dispose(); T.mat = null; }
		if (!T.mat || T.matId !== id) {
			T.mat = makeMaterial(T.THREE, id, o.color);
			T.matId = id;
			if (T.mesh) T.mesh.material = T.mat;
		}
		return T.mat;
	}

	function step(dt) { t += dt; }
	function ready() {
		if (!T && !failed && !loading) initP = init();
		return initP || Promise.resolve();
	}

	function render(ctx) {
		const o = getOpts();
		// 1) Background is painted on the 2D ctx (solid/gradient/transparent).
		paintBg(ctx, o, W, H);
		if (!T && !failed && !loading) initP = init();
		if (!T) return; // first frames: just the background until three is ready
		buildGeometry(o);
		const mat = ensureMaterial(o);
		// live tint for the presets that use it
		if ((T.matId === 'candy' || T.matId === 'glass') && o.color) mat.color.set(o.color);

		const dur = Math.max(0.3, o.duration ?? 3);
		const phase = (((t / dur) % 1) + 1) % 1;
		const m = motionTransform(o.motion || 'spin', phase);
		T.group.rotation.set(m.rx, m.ry, 0);
		T.group.position.y = m.py;

		T.renderer.render(T.scene, T.camera);
		// 2) Composite the 3D over the painted background, downscaling BW×BH→W×H.
		ctx.drawImage(T.glcv, 0, 0, W, H);
	}

	function dispose() {
		if (!T) return;
		try { if (T.mesh) T.mesh.geometry.dispose(); } catch {}
		try { if (T.mat) T.mat.dispose(); } catch {}
		try { T.envRT?.dispose?.(); T.pmrem?.dispose?.(); } catch {}
		try { T.renderer.dispose(); T.renderer.forceContextLoss?.(); } catch {}
		T = null;
	}

	return { step, render, ready, dispose };
}
