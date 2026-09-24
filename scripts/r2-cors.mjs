#!/usr/bin/env node
/**
 * Show, and optionally update, the R2 bucket's CORS rules.
 *
 *   node scripts/r2-cors.mjs           # print what's there now
 *   node scripts/r2-cors.mjs --apply   # add the submission-upload PUT rule
 *
 * Why: submissions now upload straight from the browser to R2 with a presigned
 * URL (see /api/upload/presign), because a file posted through a SvelteKit
 * action rides in a serverless function's request body, which Vercel caps at
 * ~4.5MB — under a phone photo and far under any video. A browser PUT needs
 * the bucket to allow PUT from our origins; without it the upload is blocked
 * and the app falls back to posting the file through the action (fine for
 * small files, broken for everything else).
 *
 * PutBucketCors REPLACES the whole rule set. The existing public GET/HEAD rule
 * is what serves every image, emote and video the apps read — including the
 * emoji-wall in the rickydotnow repo — so it is preserved verbatim and the new
 * rule is added alongside. Never write a rule set that doesn't include it.
 */
import { config } from 'dotenv';
import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';

config({ path: '.env', quiet: true });

const Bucket = process.env.R2_BUCKET;
const r2 = new S3Client({
	region: 'auto',
	endpoint: process.env.R2_ENDPOINT,
	credentials: {
		accessKeyId: process.env.R2_ACCESS_KEY_ID,
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
	}
});

/** Where a browser may PUT from. Presigned URLs carry their own authorisation
 *  and expire in minutes, so this grants no standing write access. */
const UPLOAD_RULE = {
	AllowedMethods: ['PUT'],
	AllowedOrigins: [
		'https://www.eating.computer',
		'https://eating.computer',
		'capacitor://localhost',   // the iOS shell's own origin
		'http://localhost:5175',
		'http://localhost:4173'
	],
	AllowedHeaders: ['content-type'],
	ExposeHeaders: ['ETag'],
	MaxAgeSeconds: 3600
};

const current = await r2.send(new GetBucketCorsCommand({ Bucket }))
	.then((r) => r.CORSRules ?? [])
	.catch(() => []);

console.log(`current rules on ${Bucket}:\n${JSON.stringify(current, null, 1)}\n`);

if (!process.argv.includes('--apply')) {
	console.log('dry run. Re-run with --apply to add:\n' + JSON.stringify(UPLOAD_RULE, null, 1));
	process.exit(0);
}

const alreadyThere = current.some(
	(r) => (r.AllowedMethods ?? []).includes('PUT') && (r.AllowedOrigins ?? []).includes(UPLOAD_RULE.AllowedOrigins[0])
);
if (alreadyThere) {
	console.log('a PUT rule for our origin is already present — nothing to do.');
	process.exit(0);
}

// Existing rules first, verbatim.
const next = [...current.filter((r) => !(r.AllowedMethods ?? []).includes('PUT')), UPLOAD_RULE];
await r2.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: next } }));
console.log(`applied. ${next.length} rules now:\n${JSON.stringify(next, null, 1)}`);
