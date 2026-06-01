/**
 * Scan the existing sprite sheet for emoji cells that came out essentially
 * blank (transparent), then re-render those specific thumbs from a frame
 * in the middle of the animation instead of the last frame. For "intro
 * → resting" emoji the last frame is the recognisable pose, but a number
 * of animations end on a blank/fade-out — those are the cells that look
 * empty in the picker. The middle frame is almost always non-blank.
 *
 * Pipeline:
 *   1. Read sprite_out/sprite-manifest.json + sprite.webp.
 *   2. Decode the sheet to raw RGBA; for each item's (x,y,cellPx,cellPx)
 *      cell, count alpha-thresholded pixels. If <1% of pixels are visible,
 *      mark blank.
 *   3. For each blank, look up its source TGS in telegram_official_emoji/
 *      or telegram_custom_packs/, render the middle frame at 96 px via
 *      rlottie WASM, and overwrite the per-emoji WebP in thumbs_out/.
 *   4. Print the next step (re-run pack_sprite_sheet.mjs --upload).
 *
 * Run:  node examples/fix_blank_thumbs.mjs
 */
import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	existsSync,
	statSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RLOTTIE_DIR = path.join(ROOT, 'static/rlottie');
const SPRITE_DIR = path.join(ROOT, 'sprite_out');
const THUMB_DIR = path.join(ROOT, 'thumbs_out');

const TARGET_PX = 96;        // render at 96 (same as render_thumbs.mjs; pack_sprite_sheet downsamples to 48)
const WEBP_Q = 85;
const ALPHA_THRESHOLD = 10;  // pixels with alpha ≤ this are considered transparent
const MIN_VISIBLE_RATIO = 0.01; // <1% visible pixels → flagged as blank

// ── rlottie WASM boot (same shim as render_thumbs.mjs) ──────────────────
globalThis.self = globalThis;
globalThis.Module = {
	wasmBinary: readFileSync(path.join(RLOTTIE_DIR, 'rlottie-wasm.wasm'))
};
const ready = new Promise((resolve) => {
	globalThis.Module.onRuntimeInitialized = resolve;
});
const rawScript = readFileSync(path.join(RLOTTIE_DIR, 'rlottie-wasm.js'), 'utf8');
const patchedScript = rawScript.replace(
	'var Module=typeof Module!=="undefined"?Module:(self[\'Module\'] = {})',
	'var Module=globalThis.Module'
);
const patchedPath = '/tmp/fix-blank-thumbs-rlottie-wasm.cjs';
writeFileSync(patchedPath, patchedScript);
createRequire(import.meta.url)(patchedPath);
await ready;
const M = globalThis.Module;
console.log('[fix] rlottie ready');

// ── Load sprite manifest + decode sheet ─────────────────────────────────
const manifest = JSON.parse(readFileSync(path.join(SPRITE_DIR, 'sprite-manifest.json'), 'utf8'));
const cellPx = manifest.cellPx;
console.log(`[fix] sprite manifest: ${Object.keys(manifest.items).length} items, ${cellPx} px cells`);

const { data: spriteBuf, info: spriteInfo } = await sharp(path.join(SPRITE_DIR, 'sprite.webp'))
	.raw()
	.toBuffer({ resolveWithObject: true });
const sheetW = spriteInfo.width;
console.log(`[fix] sheet decoded: ${sheetW}×${spriteInfo.height} (${spriteInfo.channels} ch)`);

// ── Scan each cell for transparency ─────────────────────────────────────
const blanks = [];
for (const [key, pos] of Object.entries(manifest.items)) {
	let visible = 0;
	for (let y = 0; y < cellPx; y++) {
		const rowOff = (pos.y + y) * sheetW * 4;
		for (let x = 0; x < cellPx; x++) {
			const a = spriteBuf[rowOff + (pos.x + x) * 4 + 3];
			if (a > ALPHA_THRESHOLD) visible++;
		}
	}
	const ratio = visible / (cellPx * cellPx);
	if (ratio < MIN_VISIBLE_RATIO) blanks.push({ key, pos, visible });
}
console.log(`[fix] flagged ${blanks.length} blank cells (≤${(MIN_VISIBLE_RATIO * 100).toFixed(1)}% visible pixels)`);
for (const b of blanks.slice(0, 20)) console.log(`     ${b.key}  (${b.visible} px)`);
if (blanks.length > 20) console.log(`     ... and ${blanks.length - 20} more`);

// ── Build key → source TGS path map ─────────────────────────────────────
const cpOf = (str) => Array.from(str).map((c) => c.codePointAt(0).toString(16)).join('-');
const cpToFile = new Map();
const animDir = path.join(ROOT, 'telegram_official_emoji/animated_emoji');
if (existsSync(animDir)) {
	const defaultManifest = JSON.parse(readFileSync(path.join(animDir, 'manifest.json'), 'utf8'));
	for (const m of defaultManifest) {
		cpToFile.set(`tg:${cpOf(m.emoji)}`, path.join(animDir, m.filename.replace(/\.tgs$/, '.json')));
	}
}

function lookupSource(key) {
	if (key.startsWith('tg:')) return cpToFile.get(key) || null;
	const m = key.match(/^tgc:([^:]+):(.+)$/);
	if (!m) return null;
	const [, pack, id] = m;
	const p = path.join(ROOT, 'telegram_custom_packs', pack, `${id}.json`);
	return existsSync(p) ? p : null;
}

function thumbOutPath(key) {
	if (key.startsWith('tg:')) {
		return path.join(THUMB_DIR, 'telegram-emoji/thumbs', `${key.slice(3)}.webp`);
	}
	const m = key.match(/^tgc:([^:]+):(.+)$/);
	const [, pack, id] = m;
	return path.join(THUMB_DIR, 'telegram-custom', pack, 'thumbs', `${id}.webp`);
}

// ── Render middle frame for each blank, overwrite the per-emoji WebP ────
function renderMiddleFrame(jsonPath) {
	const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
	const op = data.op || 60;
	const ip = data.ip || 0;
	const totalFrames = Math.max(1, op - ip);
	const middleFrame = Math.max(0, Math.floor(totalFrames / 2));
	const handle = M._lottie_init();
	const json = JSON.stringify(data);
	const bytes = Buffer.from(json, 'utf8');
	const ptr = M._malloc(bytes.length + 1);
	M.HEAPU8.set(bytes, ptr);
	M.HEAPU8[ptr + bytes.length] = 0;
	M._lottie_load_from_data(handle, ptr, bytes.length);
	M._free(ptr);
	M._lottie_resize(handle, TARGET_PX, TARGET_PX);
	M._lottie_render(handle, middleFrame);
	const bufPtr = M._lottie_buffer(handle);
	const pixels = Buffer.from(M.HEAPU8.slice(bufPtr, bufPtr + TARGET_PX * TARGET_PX * 4));
	M._lottie_destroy(handle);
	return { pixels, totalFrames, middleFrame };
}

console.log('\n[fix] re-rendering blank thumbs from middle frame...');
let fixed = 0, stillBlank = 0, missing = 0;
for (const { key } of blanks) {
	const src = lookupSource(key);
	if (!src) { missing++; continue; }
	try {
		const { pixels, totalFrames, middleFrame } = renderMiddleFrame(src);

		// Sanity: is the middle frame also blank? Quick alpha check.
		let aSum = 0;
		for (let i = 3; i < pixels.length; i += 4) {
			if (pixels[i] > ALPHA_THRESHOLD) { aSum++; if (aSum > TARGET_PX * TARGET_PX * MIN_VISIBLE_RATIO) break; }
		}
		if (aSum <= TARGET_PX * TARGET_PX * MIN_VISIBLE_RATIO) {
			stillBlank++;
			console.warn(`     middle frame also blank: ${key} (frames=${totalFrames}, picked frame ${middleFrame})`);
			continue;
		}

		const webp = await sharp(pixels, { raw: { width: TARGET_PX, height: TARGET_PX, channels: 4 } })
			.webp({ quality: WEBP_Q, effort: 4 })
			.toBuffer();
		const outPath = thumbOutPath(key);
		mkdirSync(path.dirname(outPath), { recursive: true });
		writeFileSync(outPath, webp);
		fixed++;
		if (fixed % 20 === 0) console.log(`     fixed ${fixed}/${blanks.length}`);
	} catch (e) {
		console.warn(`     render failed for ${key}: ${e.message}`);
	}
}

console.log(`\n[fix] done.`);
console.log(`     fixed:        ${fixed}`);
console.log(`     still blank:  ${stillBlank}  (middle frame is also empty — different fix needed)`);
console.log(`     missing src:  ${missing}  (couldn't find the TGS locally)`);
console.log(`\nNext:  node examples/pack_sprite_sheet.mjs --upload    # repack + push to R2`);
