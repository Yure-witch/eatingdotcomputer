import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

const DEFAULT_BASE = 'https://chatterbox.ee.cooper.edu/api/v1';

// Own-key management only: every route operates strictly on the caller's
// row. The raw key is never returned — only its last 4 characters.

export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const db = getDb();
	const res = await db.execute({
		sql: 'SELECT base_url, api_key, updated_at FROM user_ai_keys WHERE user_id = ?',
		args: [session.user.id]
	});
	const row = res.rows[0];
	if (!row) return json({ hasKey: false, baseUrl: DEFAULT_BASE });
	return json({
		hasKey: true,
		baseUrl: row.base_url,
		last4: String(row.api_key).slice(-4),
		updatedAt: Number(row.updated_at)
	});
}

export async function PUT({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const { baseUrl, apiKey } = await request.json();
	const url = String(baseUrl || DEFAULT_BASE).trim().replace(/\/+$/, '');
	if (!/^https:\/\//.test(url)) error(400, 'Base URL must be https');
	const db = getDb();
	if (apiKey) {
		await db.execute({
			sql: `INSERT INTO user_ai_keys (user_id, base_url, api_key, updated_at)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT(user_id) DO UPDATE SET base_url = excluded.base_url,
			        api_key = excluded.api_key, updated_at = excluded.updated_at`,
			args: [session.user.id, url, String(apiKey).trim(), Date.now()]
		});
	} else {
		// base URL change only — keep the stored key
		const res = await db.execute({
			sql: 'UPDATE user_ai_keys SET base_url = ?, updated_at = ? WHERE user_id = ?',
			args: [url, Date.now(), session.user.id]
		});
		if (res.rowsAffected === 0) error(400, 'No key saved yet — enter an API key');
	}
	return json({ ok: true });
}

export async function DELETE({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	await getDb().execute({
		sql: 'DELETE FROM user_ai_keys WHERE user_id = ?',
		args: [session.user.id]
	});
	return json({ ok: true });
}
