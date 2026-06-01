/**
 * Render a 96×96 WebP "resting pose" thumbnail for every Telegram animated
 * emoji + every custom-pack emoji that lives under this project. Uses the
 * same rlottie WASM the picker uses, so each thumb visually matches the
 * spritesheet's first painted frame.
 *
 * Inputs:
 *   telegram_official_emoji/animated_emoji/*.json    (raw Lottie JSON)
 *   telegram_official_emoji/animated_emoji/manifest.json
 *   telegram_custom_packs/<pack>/*.json
 *
 * Outputs:
 *   thumbs_out/telegram-emoji/thumbs/<cp>.webp
 *   thumbs_out/telegram-custom/<pack>/thumbs/<id>.webp
 *
 * Layout mirrors the R2 prefix structure so a follow-up upload step can
 * just walk thumbs_out/ and PUT each file at its matching key.
 *
 * Run:  node examples/render_thumbs.mjs
 *       (idempotent — skips any thumb that already exists locally)
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
import { tintLottieAdaptive } from '../src/lib/lottie-adaptive.js';

// Color we tint adaptive packs to when baking the static thumbs.
// Matches `--ink` in src/app.css (#0c0c0c). When dark mode lands, the
// thumb sheet should be re-baked against the dark variant.
const ADAPTIVE_INK = [0x0c / 255, 0x0c / 255, 0x0c / 255];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RLOTTIE_DIR = path.join(ROOT, 'static/rlottie');
const OUT_ROOT = path.join(ROOT, 'thumbs_out');

const THUMB_PX = 96;
const WEBP_QUALITY = 85;

// rlottie-wasm.js is Emscripten-built and stores its Module on `self`.
// In Node we stub `self → globalThis`, pre-set Module with our locateFile
// + onRuntimeInitialized, then load the script via createRequire. The
// script's own Node branch handles fs-based WASM loading from there.
// The Emscripten script self-initialises with `var Module = typeof
// Module !== "undefined" ? Module : (self['Module'] = {})`. The `var`
// declaration hoists `Module` to undefined inside the script's own
// scope, so the typeof check ALWAYS takes the else branch and
// overwrites whatever we put on `self.Module`/`globalThis.Module`
// before requiring it. Patch that one line so our pre-configured
// Module survives, write the patched copy to a tmp .cjs file (CJS
// extension regardless of package.json type), and require that.
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
const patchedPath = '/tmp/render-thumbs-rlottie-wasm.cjs';
writeFileSync(patchedPath, patchedScript);

const requireCjs = createRequire(import.meta.url);
requireCjs(patchedPath);

await ready;
const M = globalThis.Module;
console.log('[render_thumbs] rlottie WASM ready');

function renderFrame(jsonString, w, h, frame) {
	const handle = M._lottie_init();
	const bytes = Buffer.from(jsonString, 'utf8');
	const ptr = M._malloc(bytes.length + 1);
	M.HEAPU8.set(bytes, ptr);
	M.HEAPU8[ptr + bytes.length] = 0;
	M._lottie_load_from_data(handle, ptr, bytes.length);
	M._free(ptr);
	M._lottie_resize(handle, w, h);
	M._lottie_render(handle, frame);
	const bufPtr = M._lottie_buffer(handle);
	// Take an owned copy — the WASM heap buffer is reused across renders.
	const pixels = Buffer.from(M.HEAPU8.slice(bufPtr, bufPtr + w * h * 4));
	M._lottie_destroy(handle);
	return pixels;
}

async function encodeWebP(pixels, w, h) {
	return await sharp(pixels, { raw: { width: w, height: h, channels: 4 } })
		.webp({ quality: WEBP_QUALITY, effort: 4 })
		.toBuffer();
}

async function renderOne(jsonPath, outPath, { adaptive = false } = {}) {
	const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
	// For Telegram "adaptive" packs, every fill ships as white as a
	// sentinel for the client to repaint. Without this swap, the
	// baked thumb is a transparent silhouette — invisible against
	// the picker background.
	if (adaptive) tintLottieAdaptive(data, ADAPTIVE_INK);
	const op = data.op || 60;
	// rlottie frame numbers are absolute source frames; the last visually
	// distinct frame is op - 1.
	const lastFrame = Math.max(0, op - 1);
	const pixels = renderFrame(JSON.stringify(data), THUMB_PX, THUMB_PX, lastFrame);
	const webp = await encodeWebP(pixels, THUMB_PX, THUMB_PX);
	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, webp);
}

const cpOf = (str) => Array.from(str).map((c) => c.codePointAt(0).toString(16)).join('-');

// ── Default emoji ───────────────────────────────────────────────────────
const animatedDir = path.join(ROOT, 'telegram_official_emoji/animated_emoji');
const manifest = JSON.parse(
	readFileSync(path.join(animatedDir, 'manifest.json'), 'utf8')
);

console.log(`[render_thumbs] Default emoji: ${manifest.length} entries`);
let okD = 0, skipD = 0, failD = 0;
for (const m of manifest) {
	const cp = cpOf(m.emoji);
	const jsonFile = m.filename.replace(/\.tgs$/, '.json');
	const jsonPath = path.join(animatedDir, jsonFile);
	const outPath = path.join(OUT_ROOT, 'telegram-emoji/thumbs', `${cp}.webp`);
	if (existsSync(outPath)) { skipD++; continue; }
	if (!existsSync(jsonPath)) { failD++; continue; }
	try {
		await renderOne(jsonPath, outPath);
		okD++;
		if ((okD + skipD) % 50 === 0) {
			console.log(`  ${okD + skipD}/${manifest.length}  (ok ${okD}, skip ${skipD}, fail ${failD})`);
		}
	} catch (e) {
		console.warn(`  fail ${cp}: ${e.message}`);
		failD++;
	}
}
console.log(`Default emoji done: ok ${okD}, skipped ${skipD}, failed ${failD}`);

// ── Custom packs ────────────────────────────────────────────────────────
const packsDir = path.join(ROOT, 'telegram_custom_packs');
if (existsSync(packsDir)) {
	for (const pack of readdirSync(packsDir).sort()) {
		const packPath = path.join(packsDir, pack);
		if (!statSync(packPath).isDirectory()) continue;
		// Read pack manifest to know if it's an adaptive (text_color)
		// pack. Older manifests written before the downloader update
		// won't have the field — those are silently treated as not
		// adaptive (matches their previous behavior).
		let adaptive = false;
		const manifestPath = path.join(packPath, 'manifest.json');
		if (existsSync(manifestPath)) {
			try {
				const pm = JSON.parse(readFileSync(manifestPath, 'utf8'));
				adaptive = !!pm.text_color;
			} catch {}
		}
		const files = readdirSync(packPath)
			.filter((f) => f.endsWith('.json') && f !== 'manifest.json')
			.sort();
		let ok = 0, skip = 0, fail = 0;
		for (const f of files) {
			const id = f.replace(/\.json$/, '');
			const jsonPath = path.join(packPath, f);
			const outPath = path.join(OUT_ROOT, 'telegram-custom', pack, 'thumbs', `${id}.webp`);
			// Adaptive packs ALWAYS re-render — any existing thumb
			// was baked from a white sentinel and is invisible.
			if (existsSync(outPath) && !adaptive) { skip++; continue; }
			try {
				await renderOne(jsonPath, outPath, { adaptive });
				ok++;
			} catch (e) {
				fail++;
			}
		}
		const tag = adaptive ? ' ADAPTIVE' : '';
		console.log(`Pack ${pack}${tag}: ok ${ok}, skipped ${skip}, failed ${fail}  (${files.length} total)`);
	}
}

console.log(`\nDone rendering. Output in: ${OUT_ROOT}`);

// ── Optional R2 upload ──────────────────────────────────────────────────
if (process.argv.includes('--upload')) {
	const { default: dotenv } = await import('dotenv');
	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
	dotenv.config();

	const BUCKET = process.env.R2_BUCKET;
	const endpoint = process.env.R2_ENDPOINT
		|| (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
	if (!BUCKET || !endpoint) {
		console.error('Missing R2_BUCKET / R2_ENDPOINT in .env — skipping upload.');
		process.exit(0);
	}
	const s3 = new S3Client({
		region: 'auto', endpoint,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
		}
	});

	async function uploadDir(localDir, keyPrefix) {
		const tasks = [];
		(function walk(dir, rel = '') {
			for (const name of readdirSync(dir)) {
				const full = path.join(dir, name);
				const subRel = rel ? `${rel}/${name}` : name;
				if (statSync(full).isDirectory()) walk(full, subRel);
				else if (name.endsWith('.webp')) tasks.push({ full, key: `${keyPrefix}/${subRel}` });
			}
		})(localDir);
		let done = 0;
		// 16-way concurrency, same pattern as upload_telegram_emoji.mjs
		await Promise.all(Array.from({ length: 16 }, async () => {
			while (tasks.length) {
				const { full, key } = tasks.shift();
				await s3.send(new PutObjectCommand({
					Bucket: BUCKET, Key: key, Body: readFileSync(full),
					ContentType: 'image/webp',
					CacheControl: 'public, max-age=31536000, immutable'
				}));
				done++;
				if (done % 100 === 0) console.log(`  uploaded ${done}`);
			}
		}));
		console.log(`Uploaded ${done} files to ${keyPrefix}/`);
	}

	if (existsSync(path.join(OUT_ROOT, 'telegram-emoji'))) {
		console.log('\nUploading default emoji thumbs...');
		await uploadDir(path.join(OUT_ROOT, 'telegram-emoji'), 'telegram-emoji');
	}
	if (existsSync(path.join(OUT_ROOT, 'telegram-custom'))) {
		console.log('\nUploading custom pack thumbs...');
		await uploadDir(path.join(OUT_ROOT, 'telegram-custom'), 'telegram-custom');
	}
	console.log('\nAll thumbs uploaded.');
}
