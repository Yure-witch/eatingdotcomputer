import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';

let client;

export function getR2Client() {
	if (client) return client;
	if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
		return null;
	}

	const endpoint =
		env.R2_ENDPOINT ??
		(env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);

	if (!endpoint) return null;

	client = new S3Client({
		region: 'auto',
		endpoint,
		credentials: {
			accessKeyId: env.R2_ACCESS_KEY_ID,
			secretAccessKey: env.R2_SECRET_ACCESS_KEY
		}
	});

	return client;
}

export async function uploadToR2(key, body, contentType) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) throw new Error('R2 not configured');
	await r2.send(new PutObjectCommand({
		Bucket: env.R2_BUCKET,
		Key: key,
		Body: body,
		ContentType: contentType
	}));
}

/**
 * A short-lived URL the BROWSER can PUT a file to, so the bytes never pass
 * through the serverless function.
 *
 * Vercel caps a function's request body at ~4.5MB. A submission posted through
 * an action carries the whole file in that body, so a phone photo (3-8MB) or
 * any video was rejected by the platform before our code ran — no error of
 * ours, nothing in the logs, just a submission that didn't work. Presigning
 * moves the upload out of that path entirely.
 *
 * The caller builds the key; never let a client choose it.
 */
export async function presignPutToR2(key, contentType, expiresIn = 600) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) throw new Error('R2 not configured');
	return getSignedUrl(
		r2,
		new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType }),
		{ expiresIn }
	);
}

export async function deleteFromR2(key) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) throw new Error('R2 not configured');
	await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}

export async function getR2Stream(key) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) return null;
	const response = await r2.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
	return { body: response.Body, contentType: response.ContentType };
}

// Delete every object under `prefix` older than `maxAgeMs`. Best-effort and
// non-throwing. Used to keep ephemeral GIF Studio renders from lingering.
export async function sweepR2Prefix(prefix, maxAgeMs) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) return 0;
	const cutoff = Date.now() - maxAgeMs;
	let deleted = 0;
	try {
		let token;
		do {
			const res = await r2.send(new ListObjectsV2Command({
				Bucket: env.R2_BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token
			}));
			for (const o of res.Contents ?? []) {
				if (o.Key && o.LastModified && o.LastModified.getTime() < cutoff) {
					try { await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: o.Key })); deleted++; } catch { /* skip one */ }
				}
			}
			token = res.IsTruncated ? res.NextContinuationToken : undefined;
		} while (token);
	} catch (e) { console.error('R2 sweep failed', e); }
	return deleted;
}

export async function listR2Assets() {
	if (!env.R2_BUCKET) return [];
	const r2 = getR2Client();
	if (!r2) return [];

	try {
		const response = await r2.send(
			new ListObjectsV2Command({
				Bucket: env.R2_BUCKET,
				MaxKeys: 4
			})
		);
		return response.Contents?.map((item) => item.Key).filter(Boolean) ?? [];
	} catch (error) {
		console.error('R2 list failed', error);
		return [];
	}
}
