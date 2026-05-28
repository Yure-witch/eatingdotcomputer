/**
 * Upload the pulled Telegram animated emoji to R2 under the `telegram-emoji/` prefix,
 * and build a manifest the client uses to drive the picker + bubble rendering.
 *
 * Layout in R2:
 *   telegram-emoji/animated/<cp>.json       gzipped Lottie (Content-Encoding: gzip)
 *   telegram-emoji/animations/<cp>_<i>.json  gzipped Lottie click-animation variants
 *   telegram-emoji/flags/<cp>.webp           animated webp (country flags, no TGS exists)
 *   telegram-emoji/manifest.json             { base, emoji:[{e,cp,cat,anim,av,flag}] }
 *
 * Run:  node examples/upload_telegram_emoji.mjs
 * Reads R2_* creds from .env. Idempotent (overwrites). Delete the prefix to undo.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const ROOT = 'telegram_official_emoji';
const PREFIX = 'telegram-emoji';
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || process.env.PUBLIC_R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const BUCKET = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
if (!BUCKET || !endpoint || !PUBLIC_BASE) { console.error('Missing R2_BUCKET / endpoint / R2_PUBLIC_BASE_URL in .env'); process.exit(1); }

const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

const cpOf = (ch) => Array.from(ch).map(c => c.codePointAt(0).toString(16)).join('-');     // "😀"->"1f600", flags->"1f1eb-1f1f7"
const jsonFor = (tgsFilename) => tgsFilename.replace(/\.tgs$/, '.json');

// cp -> category, precomputed by gen_categories.py (keyed identically: hyphen-joined hex)
const CATEGORIES = existsSync('/tmp/tg_categories.json')
	? JSON.parse(readFileSync('/tmp/tg_categories.json', 'utf8')) : {};

async function put(key, body, contentType, gzip = false) {
	await s3.send(new PutObjectCommand({
		Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
		...(gzip ? { ContentEncoding: 'gzip' } : {}), CacheControl: 'public, max-age=31536000, immutable'
	}));
}

// limited-concurrency runner
async function pool(items, n, fn) {
	let i = 0, done = 0;
	await Promise.all(Array.from({ length: n }, async () => {
		while (i < items.length) { const idx = i++; await fn(items[idx]); if (++done % 100 === 0) console.log(`  ${done}/${items.length}`); }
	}));
}

async function main() {
	const animated = JSON.parse(readFileSync(`${ROOT}/animated_emoji/manifest.json`, 'utf8'));
	const anims = JSON.parse(readFileSync(`${ROOT}/animated_emoji_animations/manifest.json`, 'utf8'));
	const flags = JSON.parse(readFileSync(`${ROOT}/flags/manifest.json`, 'utf8'));

	// group click-animations by emoji
	const animByEmoji = {};
	for (const a of anims) (animByEmoji[a.emoji] ??= []).push(a.filename);

	// one entry per distinct emoji (first doc wins for the primary sticker)
	const seen = new Set();
	const primary = animated.filter(m => !seen.has(m.emoji) && seen.add(m.emoji));

	const manifest = [];

	console.log(`Uploading ${primary.length} animated emoji...`);
	await pool(primary, 16, async (m) => {
		const cp = cpOf(m.emoji);
		const buf = gzipSync(readFileSync(`${ROOT}/animated_emoji/${jsonFor(m.filename)}`));
		await put(`${PREFIX}/animated/${cp}.json`, buf, 'application/json', true);
		const av = (animByEmoji[m.emoji] || []).length;
		manifest.push({ e: m.emoji, cp, cat: CATEGORIES[cp] || 'Other', av, flag: false });
	});

	console.log(`Uploading ${anims.length} click-animation variants...`);
	const idxByEmoji = {};
	await pool(anims, 16, async (a) => {
		const cp = cpOf(a.emoji);
		const i = (idxByEmoji[cp] = (idxByEmoji[cp] || 0) + 1);
		const buf = gzipSync(readFileSync(`${ROOT}/animated_emoji_animations/${jsonFor(a.filename)}`));
		await put(`${PREFIX}/animations/${cp}_${i}.json`, buf, 'application/json', true);
	});

	console.log(`Uploading ${flags.length} flags...`);
	await pool(flags, 16, async (f) => {
		const cp = cpOf(f.emoji);
		await put(`${PREFIX}/flags/${cp}.webp`, readFileSync(`${ROOT}/flags/${f.filename}`), 'image/webp');
		manifest.push({ e: f.emoji, cp, cat: 'Flags', av: 0, flag: true });
	});

	const out = { base: `${PUBLIC_BASE}/${PREFIX}`, count: manifest.length, emoji: manifest };
	await put(`${PREFIX}/manifest.json`, JSON.stringify(out), 'application/json');
	console.log(`\nDone. ${manifest.length} emoji in manifest -> ${PUBLIC_BASE}/${PREFIX}/manifest.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
