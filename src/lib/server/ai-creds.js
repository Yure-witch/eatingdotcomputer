import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';

export const DEFAULT_BASE = 'https://chatterbox.ee.cooper.edu/api/v1';

/**
 * Resolve the Gemma credentials to use for a given user, in order:
 *   1. the user's own saved key
 *   2. an instructor's key (what the digest pipeline already did)
 *   3. GEMMA_KEY from the environment — the class-wide default
 *
 * The third rung is what lets someone use Gemma before they've gone and
 * fetched a personal key, including the App Store review account.
 *
 * @returns {Promise<{base_url: string, api_key: string}|null>}
 */
export async function resolveAiCreds(userId) {
	const db = getDb();
	if (!db) return null;

	if (userId) {
		const own = await db.execute({
			sql: 'SELECT base_url, api_key FROM user_ai_keys WHERE user_id = ?',
			args: [userId]
		});
		if (own.rows[0]) return own.rows[0];
	}

	const inst = await db.execute({
		sql: `SELECT k.base_url, k.api_key FROM user_ai_keys k JOIN users u ON u.id = k.user_id
		      WHERE u.role = 'instructor' LIMIT 1`
	});
	if (inst.rows[0]) return inst.rows[0];

	if (env.GEMMA_KEY) {
		return { base_url: env.AI_BASE_URL || DEFAULT_BASE, api_key: env.GEMMA_KEY };
	}
	return null;
}

/** True when the user can talk to Gemma at all — own key, instructor's, or the default. */
export async function canUseAi(userId) {
	return !!(await resolveAiCreds(userId));
}
