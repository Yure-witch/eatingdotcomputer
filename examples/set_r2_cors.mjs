/**
 * Set CORS on the R2 bucket so browsers can fetch Telegram emoji JSON/webp
 * cross-origin (localhost dev + prod). One-time; idempotent.
 * Run: node examples/set_r2_cors.mjs
 */
import dotenv from 'dotenv';
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
dotenv.config();

const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
const Bucket = process.env.R2_BUCKET;
if (!endpoint || !Bucket) { console.error('Missing R2_ENDPOINT/R2_BUCKET'); process.exit(1); }

const s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

const CORSConfiguration = {
	CORSRules: [
		{
			AllowedMethods: ['GET', 'HEAD'],
			AllowedOrigins: ['*'],
			AllowedHeaders: ['*'],
			ExposeHeaders: ['Content-Encoding', 'Content-Type', 'Content-Length'],
			MaxAgeSeconds: 86400
		}
	]
};

await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration }));
const got = await s3.send(new GetBucketCorsCommand({ Bucket }));
console.log('CORS set OK. Effective rules:');
console.log(JSON.stringify(got.CORSRules, null, 2));
