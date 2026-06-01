/**
 * Pack every per-emoji WebP thumbnail in thumbs_out/ into a single sprite
 * sheet + JSON manifest. The picker loads the sheet ONCE on open; every
 * cell then renders with `background-image: url(sheet); background-position`
 * — zero per-cell network requests, fully browser-cached after first hit.
 *
 * Inputs:
 *   thumbs_out/telegram-emoji/thumbs/<cp>.webp
 *   thumbs_out/telegram-custom/<pack>/thumbs/<id>.webp
 *
 * Outputs:
 *   sprite_out/sprite.webp                 (single big WebP, e.g. 2304×2304)
 *   sprite_out/sprite-manifest.json        ({ cellPx, cols, rows, items })
 *
 * Manifest keys:
 *   default: "tg:<cp>"
 *   custom:  "tgc:<short>:<id>"
 *
 * Run:  node examples/pack_sprite_sheet.mjs            # build only
 *       node examples/pack_sprite_sheet.mjs --upload   # build + push to R2
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
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THUMBS_DIR = path.join(ROOT, 'thumbs_out');
const OUT_DIR = path.join(ROOT, 'sprite_out');

const CELL_PX = 48; // device pixels per cell (= 24 CSS px on 2× DPR, no upscale)
const COLS = 48;    // 48² = 2304 capacity, comfortably covers 2011 entries

// ── Collect entries deterministically ───────────────────────────────────
const entries = []; // { key, src, x, y }

const defaultDir = path.join(THUMBS_DIR, 'telegram-emoji/thumbs');
if (existsSync(defaultDir)) {
	for (const name of readdirSync(defaultDir).sort()) {
		if (!name.endsWith('.webp')) continue;
		entries.push({
			key: `tg:${name.replace('.webp', '')}`,
			src: path.join(defaultDir, name)
		});
	}
}

const customRoot = path.join(THUMBS_DIR, 'telegram-custom');
if (existsSync(customRoot)) {
	for (const pack of readdirSync(customRoot).sort()) {
		const thumbs = path.join(customRoot, pack, 'thumbs');
		if (!existsSync(thumbs)) continue;
		for (const name of readdirSync(thumbs).sort()) {
			if (!name.endsWith('.webp')) continue;
			entries.push({
				key: `tgc:${pack}:${name.replace('.webp', '')}`,
				src: path.join(thumbs, name)
			});
		}
	}
}

console.log(`[pack] ${entries.length} entries`);
if (entries.length > COLS * COLS) {
	console.error(`[pack] grid (${COLS}×${COLS}) too small for ${entries.length} entries`);
	process.exit(1);
}

// Assign grid positions
for (let i = 0; i < entries.length; i++) {
	entries[i].x = (i % COLS) * CELL_PX;
	entries[i].y = Math.floor(i / COLS) * CELL_PX;
}
const rows = Math.ceil(entries.length / COLS);
const sheetW = COLS * CELL_PX;
const sheetH = rows * CELL_PX;
console.log(`[pack] sheet ${sheetW}×${sheetH}  (${COLS}×${rows})`);

// ── Resize each thumb to CELL_PX × CELL_PX and queue as a composite op ──
console.log('[pack] preparing inputs...');
const composites = [];
for (let i = 0; i < entries.length; i++) {
	const e = entries[i];
	const buf = await sharp(e.src).resize(CELL_PX, CELL_PX).toBuffer();
	composites.push({ input: buf, left: e.x, top: e.y });
	if ((i + 1) % 250 === 0) console.log(`  prepared ${i + 1}/${entries.length}`);
}

// ── Composite into one transparent canvas ──────────────────────────────
console.log('[pack] compositing sheet...');
mkdirSync(OUT_DIR, { recursive: true });
const sheetPath = path.join(OUT_DIR, 'sprite.webp');
await sharp({
	create: {
		width: sheetW,
		height: sheetH,
		channels: 4,
		background: { r: 0, g: 0, b: 0, alpha: 0 }
	}
})
	.composite(composites)
	.webp({ quality: 85, effort: 6, alphaQuality: 90 })
	.toFile(sheetPath);

const sheetBytes = statSync(sheetPath).size;
console.log(`[pack] sprite.webp: ${(sheetBytes / 1024 / 1024).toFixed(2)} MB`);

// ── Manifest ────────────────────────────────────────────────────────────
const manifest = {
	sheet: 'sprite.webp',
	cellPx: CELL_PX,
	cols: COLS,
	rows,
	sheetW,
	sheetH,
	count: entries.length,
	items: Object.fromEntries(entries.map((e) => [e.key, { x: e.x, y: e.y }]))
};
const manifestPath = path.join(OUT_DIR, 'sprite-manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`[pack] sprite-manifest.json: ${entries.length} items, ${statSync(manifestPath).size} B`);

// ── Optional R2 upload ──────────────────────────────────────────────────
if (process.argv.includes('--upload')) {
	const { default: dotenv } = await import('dotenv');
	const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
	dotenv.config();

	const BUCKET = process.env.R2_BUCKET;
	const endpoint = process.env.R2_ENDPOINT
		|| (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
	if (!BUCKET || !endpoint) {
		console.error('Missing R2_BUCKET / endpoint in .env');
		process.exit(1);
	}
	const s3 = new S3Client({
		region: 'auto', endpoint,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
		}
	});

	for (const file of ['sprite.webp', 'sprite-manifest.json']) {
		const body = readFileSync(path.join(OUT_DIR, file));
		const contentType = file.endsWith('.webp') ? 'image/webp' : 'application/json';
		await s3.send(new PutObjectCommand({
			Bucket: BUCKET,
			Key: `telegram-emoji/${file}`,
			Body: body,
			ContentType: contentType,
			CacheControl: 'public, max-age=31536000, immutable'
		}));
		console.log(`[pack] uploaded telegram-emoji/${file}`);
	}
}
