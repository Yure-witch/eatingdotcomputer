import { deleteFromR2 } from '$lib/server/r2.js';

/**
 * Delete unconfirmed uploads older than `maxAgeMinutes` from R2 and the DB.
 * Called as a non-blocking side effect on each new upload so no cron is needed.
 */
export async function cleanupStaleUploads(db, maxAgeMinutes = 5) {
	try {
		const result = await db.execute({
			sql: `SELECT id, r2_key FROM uploaded_files
			      WHERE confirmed = 0 AND uploaded_at < datetime('now', ?)`,
			args: [`-${maxAgeMinutes} minutes`]
		});
		if (!result.rows.length) return;

		await Promise.all(result.rows.map((row) => deleteFromR2(String(row.r2_key)).catch(() => {})));

		const ids = result.rows.map((r) => r.id);
		await db.execute({
			sql: `DELETE FROM uploaded_files WHERE id IN (${ids.map(() => '?').join(',')})`,
			args: ids
		});
	} catch {
		// Never let cleanup errors surface to callers
	}
}
