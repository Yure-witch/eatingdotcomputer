// Upload a built deck folder (build-deck.py's out/) to R2 for the members-only
// viewer, in a fresh random folder: archive-members/<random>/<slug>/...
//
//   node scripts/decks/upload-deck.mjs <deckdir>/out <slug>
//   node scripts/decks/upload-deck.mjs <file.pdf> <name>.pdf     # a single file
//
// The random folder is what keeps the files private (the bucket has a public
// base URL), so it is never printed or written anywhere; the app finds files
// by listing the prefix. Refuses to upload a slug that is already there:
// to replace a deck, overwrite its keys in place or delete the old folder.
// Then add the deck to MEMBER_WORK in src/lib/server/archive-members.js.
import 'dotenv/config';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const [src, slug] = process.argv.slice(2);
if (!src || !slug) {
	console.error('usage: node scripts/decks/upload-deck.mjs <out-dir | file> <slug | name>');
	process.exit(1);
}
const r2 = new S3Client({
	region: 'auto',
	endpoint: process.env.R2_ENDPOINT,
	credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
const Bucket = process.env.R2_BUCKET;
const TYPES = {
	'.webp': 'image/webp',
	'.mp4': 'video/mp4',
	'.mp3': 'audio/mpeg',
	'.json': 'application/json',
	'.pdf': 'application/pdf',
	'.html': 'text/html; charset=utf-8'
};

const have = new Set();
let token;
do {
	const res = await r2.send(new ListObjectsV2Command({ Bucket, Prefix: 'archive-members/', ContinuationToken: token }));
	for (const o of res.Contents ?? []) have.add(o.Key.split('/').slice(2).join('/'));
	token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token);

const folder = `archive-members/${randomBytes(16).toString('hex')}/`;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let jobs;
if (statSync(src).isDirectory()) {
	if (have.has(`${slug}/deck.json`)) throw new Error(`${slug} is already uploaded`);
	jobs = walk(src).map((f) => ({ f, Key: `${folder}${slug}/${relative(src, f)}` }));
} else {
	if (have.has(slug)) throw new Error(`${slug} is already uploaded`);
	jobs = [{ f: src, Key: folder + slug }];
}

const total = jobs.length;
let done = 0;
let bytes = 0;
async function worker() {
	while (jobs.length) {
		const { f, Key } = jobs.shift();
		const Body = readFileSync(f);
		await r2.send(
			new PutObjectCommand({
				Bucket,
				Key,
				Body,
				ContentType: TYPES[extname(f)] ?? 'application/octet-stream',
				CacheControl: f.endsWith('deck.json') ? 'no-cache' : 'private, max-age=86400'
			})
		);
		done++;
		bytes += Body.length;
	}
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`uploaded ${done}/${total} files, ${(bytes / 1e6).toFixed(0)} MB as ${slug}`);
