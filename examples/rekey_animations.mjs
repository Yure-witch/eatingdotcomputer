/**
 * Re-key the AnimatedEmojiAnimations files in R2 to their TRUE per-emoji
 * mapping (from Sticker.alt attribute, not the buggy packs grouping). Also
 * patches the master manifest so each entry's `av` reflects real variant
 * counts. Reads /tmp/anim_mapping.json (doc_id -> emoji) from probe script.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
dotenv.config();

const PREFIX = 'telegram-emoji';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || process.env.PUBLIC_R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const Bucket = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

const cpOf = (ch) => Array.from(ch).map(c => c.codePointAt(0).toString(16)).join('-');

// Build doc_id -> local .json path from local folder filenames
const LOCAL = 'telegram_official_emoji/animated_emoji_animations';
const localByDocId = {};
for (const f of readdirSync(LOCAL)) {
	if (!f.endsWith('.json') || f === 'manifest.json') continue;
	const m = f.match(/_(\d+)\.json$/);
	if (m) localByDocId[m[1]] = `${LOCAL}/${f}`;
}

const mapping = JSON.parse(readFileSync('/tmp/anim_mapping.json', 'utf8'));
const byEmoji = {};
for (const [docId, emoji] of Object.entries(mapping)) (byEmoji[emoji] ??= []).push(docId);

// 1. Delete every current key under animations/ (cleans the buggy 1f389_* + 31-20e3_*)
const listed = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `${PREFIX}/animations/` }));
const toDelete = (listed.Contents || []).map(o => ({ Key: o.Key }));
if (toDelete.length) {
	await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: toDelete, Quiet: true } }));
	console.log(`deleted ${toDelete.length} old animation keys`);
}

// 2. Upload each animation under correct <cp>_<i>.json
let uploaded = 0;
const avByCp = {};
for (const [emoji, docIds] of Object.entries(byEmoji)) {
	const cp = cpOf(emoji);
	avByCp[cp] = docIds.length;
	for (let i = 0; i < docIds.length; i++) {
		const path = localByDocId[docIds[i]];
		if (!path) { console.warn(`  no local file for doc ${docIds[i]} (${emoji})`); continue; }
		const buf = gzipSync(readFileSync(path));
		await s3.send(new PutObjectCommand({
			Bucket, Key: `${PREFIX}/animations/${cp}_${i + 1}.json`,
			Body: buf, ContentType: 'application/json', ContentEncoding: 'gzip',
			CacheControl: 'public, max-age=31536000, immutable'
		}));
		uploaded++;
	}
}
console.log(`uploaded ${uploaded} animation files across ${Object.keys(byEmoji).length} emoji`);

// 3. Patch master manifest's `av` field
const manifestRes = await s3.send(new GetObjectCommand({ Bucket, Key: `${PREFIX}/manifest.json` }));
const manifestJson = JSON.parse(await manifestRes.Body.transformToString());
let patched = 0;
for (const it of manifestJson.emoji) {
	const av = avByCp[it.cp] || 0;
	if (av !== (it.av || 0)) { it.av = av; patched++; }
}
await s3.send(new PutObjectCommand({
	Bucket, Key: `${PREFIX}/manifest.json`, Body: JSON.stringify(manifestJson),
	ContentType: 'application/json', CacheControl: 'public, max-age=60'
}));
const withAnims = manifestJson.emoji.filter(e => (e.av || 0) > 0).length;
console.log(`manifest: patched av on ${patched} entries; ${withAnims} emoji now have click-animations`);
console.log(`manifest URL: ${PUBLIC_BASE}/${PREFIX}/manifest.json`);
