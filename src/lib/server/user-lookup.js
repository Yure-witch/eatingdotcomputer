// Resolving a sign-in address to an account.
//
// Every provider used to do `SELECT … FROM users WHERE email = ?` inline, which
// means one account per address and no way for a person to have two. See
// migration 080 for why that bites: a student who signs up with a .edu address
// and later taps "Continue with Google" on a personal gmail gets a second,
// empty account.
//
// This is the single place that answers "whose account is this address?", so
// the alias table can't be honoured by one provider and forgotten by another.

/**
 * Find the account an address belongs to — its own, or via an alias.
 *
 * Primary addresses win over aliases. That ordering matters: an alias should
 * never shadow a real account, so if the same string somehow ends up in both
 * places the account that actually owns it is the one you get.
 *
 * @param {import('@libsql/client').Client} db
 * @param {string} email
 * @param {string} [columns] — columns to select from `users`
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function findUserByEmail(db, email, columns = 'id, email, name, role') {
	if (!db) return null;
	const addr = String(email ?? '').trim().toLowerCase();
	if (!addr) return null;

	const direct = await db.execute({
		sql: `SELECT ${columns} FROM users WHERE lower(email) = ?`,
		args: [addr]
	});
	if (direct.rows[0]) return direct.rows[0];

	const alias = await db.execute({
		sql: `SELECT ${columns.split(',').map((c) => 'u.' + c.trim()).join(', ')}
		      FROM user_emails ue JOIN users u ON u.id = ue.user_id
		      WHERE ue.email = ?`,
		args: [addr]
	});
	return alias.rows[0] ?? null;
}

/**
 * Point an extra address at an account.
 *
 * Refuses when the address is already a primary — merging is the caller's job,
 * and silently aliasing over a live account would let one person's sign-in
 * land in another person's account.
 *
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function addEmailAlias(db, { email, userId, addedBy = null }) {
	if (!db) return { ok: false, reason: 'no database' };
	const addr = String(email ?? '').trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, reason: 'not an email address' };

	const owner = await db.execute({ sql: 'SELECT id FROM users WHERE lower(email) = ?', args: [addr] });
	if (owner.rows[0]) {
		return String(owner.rows[0].id) === String(userId)
			? { ok: false, reason: 'already this account’s primary address' }
			: { ok: false, reason: 'another account already uses that address' };
	}

	const taken = await db.execute({ sql: 'SELECT user_id FROM user_emails WHERE email = ?', args: [addr] });
	if (taken.rows[0] && String(taken.rows[0].user_id) !== String(userId)) {
		return { ok: false, reason: 'that address is an alias of another account' };
	}

	await db.execute({
		sql: `INSERT INTO user_emails (email, user_id, added_by) VALUES (?, ?, ?)
		      ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id`,
		args: [addr, String(userId), addedBy]
	});
	return { ok: true };
}
