import { fetchProjectStats } from '$lib/server/turso.js';
import { listR2Assets } from '$lib/server/r2.js';
import { env } from '$env/dynamic/private';

export async function load() {
	const [stats, assets] = await Promise.all([fetchProjectStats(), listR2Assets()]);

	return {
		stats,
		assets,
		dbReady: Boolean(env.TURSO_DATABASE_URL),
		r2Ready: Boolean(env.R2_BUCKET)
	};
}
