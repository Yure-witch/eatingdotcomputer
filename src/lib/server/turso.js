import { createClient } from '@libsql/client';
import { env } from '$env/dynamic/private';

let client;

export function getDb() {
	if (client) return client;
	if (!env.TURSO_DATABASE_URL) return null;

	client = createClient({
		url: env.TURSO_DATABASE_URL,
		authToken: env.TURSO_AUTH_TOKEN
	});

	return client;
}

export async function fetchProjectStats() {
	const db = getDb();
	if (!db) {
		return { totalEntries: null, lastUpdated: null };
	}

	try {
		const result = await db.execute(
			`select count(*) as totalEntries, max(updated_at) as lastUpdated from entries`
		);

		const row = result.rows?.[0];
		return {
			totalEntries: row?.totalEntries ?? 0,
			lastUpdated: row?.lastUpdated ?? null
		};
	} catch (error) {
		console.error('Turso query failed', error);
		return { totalEntries: null, lastUpdated: null };
	}
}
