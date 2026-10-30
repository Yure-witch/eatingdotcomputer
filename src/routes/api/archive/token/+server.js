import { json } from '@sveltejs/kit';
import { archiveCaller, requireDb, mintToken, TOKEN_TTL_DAYS } from '$lib/server/work-archive.js';

// The student's personal Work Archive upload token. Session-only on purpose
// (archiveCaller without allowToken rejects a Bearer header): a token can never
// be used to see or mint tokens. The raw value is shown exactly once.

function shape(row) {
	if (!row) return { hasToken: false };
	return {
		hasToken: true,
		last4: String(row.last4),
		createdAt: String(row.created_at),
		expiresAt: String(row.expires_at),
		lastUsedAt: row.last_used_at ? String(row.last_used_at) : null
	};
}

async function current(db, userId) {
	const r = await db.execute({
		sql: `SELECT last4, created_at, expires_at, last_used_at FROM archive_tokens
		      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
		      ORDER BY created_at DESC LIMIT 1`,
		args: [userId]
	});
	return r.rows[0] ?? null;
}

export async function GET(event) {
	const caller = await archiveCaller(event);
	return json(shape(await current(requireDb(), caller.userId)));
}

// Mint a new token, revoking any previous one.
export async function POST(event) {
	const caller = await archiveCaller(event);
	const db = requireDb();
	const { raw, hash, last4 } = await mintToken();
	await db.batch([
		{ sql: `UPDATE archive_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`, args: [caller.userId] },
		{
			sql: `INSERT INTO archive_tokens (id, user_id, token_hash, last4, expires_at)
			      VALUES (?, ?, ?, ?, datetime('now', ?))`,
			args: [crypto.randomUUID(), caller.userId, hash, last4, `+${TOKEN_TTL_DAYS} days`]
		}
	], 'write');
	return json({ token: raw, ...shape(await current(db, caller.userId)) });
}

export async function DELETE(event) {
	const caller = await archiveCaller(event);
	await requireDb().execute({
		sql: `UPDATE archive_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`,
		args: [caller.userId]
	});
	return json({ hasToken: false });
}
