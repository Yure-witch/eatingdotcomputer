import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
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
