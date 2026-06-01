/**
 * Upload custom Telegram emoji packs (downloaded by telegram_custom_packs.py)
 * to R2 under telegram-custom/<short_name>/<doc_id>.json (gzipped Lottie).
 * Publishes telegram-custom/manifest.json aggregating every pack's items.
 *
 * Run:  node examples/upload_custom_packs.mjs
 * Idempotent. Delete the prefix to undo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
dotenv.config();

const PREFIX = 'telegram-custom';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || process.env.PUBLIC_R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const Bucket = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
if (!Bucket || !endpoint || !PUBLIC_BASE) { console.error('Missing R2_* in .env'); process.exit(1); }
const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

async function put(key, body, contentType, gzip = false) {
	await s3.send(new PutObjectCommand({
		Bucket, Key: key, Body: body, ContentType: contentType,
		...(gzip ? { ContentEncoding: 'gzip' } : {}),
		CacheControl: 'public, max-age=31536000, immutable'
	}));
}

async function pool(items, n, fn) {
	let i = 0;
	await Promise.all(Array.from({ length: n }, async () => {
		while (i < items.length) await fn(items[i++]);
	}));
}

const ROOT = 'telegram_custom_packs';
const MANIFEST_ONLY = process.argv.includes('--manifest-only');
const packs = readdirSync(ROOT).filter((d) => existsSync(`${ROOT}/${d}/manifest.json`));

const manifestPacks = [];
let totalUploaded = 0;

for (const dir of packs) {
	const pm = JSON.parse(readFileSync(`${ROOT}/${dir}/manifest.json`, 'utf8'));
	const items = pm.emoji;
	console.log(`▶ ${pm.title}  (${pm.short_name})  ${items.length} items${MANIFEST_ONLY ? ' (manifest-only)' : ''}`);
	if (!MANIFEST_ONLY) {
		await pool(items, 16, async (it) => {
			// We need the unpacked .json (Lottie) — present for x-tgsticker docs.
			const jsonPath = `${ROOT}/${dir}/${it.doc_id}.json`;
			if (!existsSync(jsonPath)) return;
			const buf = gzipSync(readFileSync(jsonPath));
			await put(`${PREFIX}/${pm.short_name}/${it.doc_id}.json`, buf, 'application/json', true);
			totalUploaded++;
		});
	}
	manifestPacks.push({
		title: pm.title,
		short_name: pm.short_name,
		count: items.length,
		// `text_color: true` marks a Telegram "adaptive" pack — emoji
		// are shipped as white silhouettes and meant to inherit the
		// surrounding text color. Runtime loaders swap the white fill
		// for the current --ink before handing the JSON to the renderer.
		text_color: !!pm.text_color,
		// Slim emoji entries: doc_id + the Unicode emoji this custom one stands in for
		emoji: items.map((it) => ({ id: it.doc_id, alt: it.alt }))
	});
	console.log(`  ✓ done`);
}

const out = {
	base: `${PUBLIC_BASE}/${PREFIX}`,
	pack_count: manifestPacks.length,
	total: manifestPacks.reduce((s, p) => s + p.count, 0),
	packs: manifestPacks
};
await put(`${PREFIX}/manifest.json`, JSON.stringify(out), 'application/json');
console.log(`\nuploaded ${totalUploaded} files across ${manifestPacks.length} packs`);
console.log(`manifest: ${PUBLIC_BASE}/${PREFIX}/manifest.json`);
