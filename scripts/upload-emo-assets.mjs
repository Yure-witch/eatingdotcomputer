// Upload everything the Emo emoji-suggestion model loads at runtime to R2, so
// the browser fetches it from our bucket instead of Hugging Face / jsDelivr /
// the Vite bundle. Credentials come from the local environment; generated
// model/runtime files stay out of Git.
//
//   scripts/fetch-emo-model.sh        # first: model files into vendor/emo/<tag>/
//   node scripts/upload-emo-assets.mjs
//   node scripts/upload-emo-assets.mjs --wasm-only
//
// Keys are versioned and served immutable — bump the version segment when the
// SDK, LiteRT or model tag changes; never overwrite in place.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { buildPatchedWasm, PATCH_DIRECTORY, PATCH_PATH, sha256 } from '../vendor/emo/tools/patch-usage.mjs';

const LITERT = '2.5.3';   // @litertjs/core (exact in package.json)
const MODEL = 'v0.7.0';   // Hugging Face tag the SDK pins

// Fails on a different upstream binary; never upload the reporting build again.
buildPatchedWasm();
const files = [
	[PATCH_PATH, `vendor/emo/${PATCH_DIRECTORY}/EmoWeb.wasm`],
	...['litert_wasm_internal', 'litert_wasm_compat_internal'].flatMap((n) => [
		[`node_modules/@litertjs/core/wasm/${n}.js`, `vendor/emo/litert-${LITERT}/${n}.js`],
		[`node_modules/@litertjs/core/wasm/${n}.wasm`, `vendor/emo/litert-${LITERT}/${n}.wasm`]
	]),
	...['emo.tflite', 'emo_meta.json', 'emo_tokenizer.bin'].map((n) => [
		`vendor/emo/${MODEL}/${n}`, `vendor/emo/model-${MODEL}/${n}`
	])
];

const TYPES = { wasm: 'application/wasm', js: 'text/javascript', json: 'application/json' };

const r2 = new S3Client({
	region: 'auto',
	endpoint: process.env.R2_ENDPOINT,
	credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
const Bucket = process.env.R2_BUCKET;

for (const [src, Key] of process.argv.includes('--wasm-only') ? files.slice(0, 1) : files) {
	const Body = readFileSync(src);
	const digest = sha256(Body);
	let head;
	try {
		head = await r2.send(new HeadObjectCommand({ Bucket, Key }));
	} catch (err) {
		if (err.$metadata?.httpStatusCode !== 404) throw err;
	}
	if (head) {
		let existingDigest = head.Metadata?.sha256;
		if (!existingDigest) {
			const object = await r2.send(new GetObjectCommand({ Bucket, Key }));
			existingDigest = sha256(await object.Body.transformToByteArray());
		}
		if (head.ContentLength !== Body.length || existingDigest !== digest) {
			throw new Error(`Immutable object differs: ${Key}; use a new versioned key`);
		}
		console.log(`skip  ${Key} (SHA-256 verified)`);
		continue;
	}
	await r2.send(new PutObjectCommand({
		Bucket, Key, Body,
		IfNoneMatch: '*',
		Metadata: { sha256: digest },
		ContentType: TYPES[src.split('.').pop()] ?? 'application/octet-stream',
		CacheControl: 'public, max-age=31536000, immutable'
	}));
	console.log(`put   ${Key} (${Body.length} bytes, SHA-256 ${digest})`);
}
console.log(`\nbase: ${process.env.R2_PUBLIC_BASE_URL}/vendor/emo/`);
