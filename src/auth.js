import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import Credentials from '@auth/sveltekit/providers/credentials';
import { compare } from 'bcryptjs';
import { getDb } from '$lib/server/turso';

export const { handle, signIn, signOut } = SvelteKitAuth({
	trustHost: true,
	providers: [
		Google,
		Credentials({
			credentials: {
				email: { label: 'Email', type: 'email' },
				password: { label: 'Password', type: 'password' }
			},
			async authorize(credentials) {
				if (!credentials?.email || !credentials?.password) return null;

				const db = getDb();
				if (!db) return null;

				const result = await db.execute({
					sql: 'SELECT id, email, name, password_hash, role FROM users WHERE email = ?',
					args: [String(credentials.email)]
				});

				const user = result.rows[0];
				if (!user?.password_hash) return null;

				const valid = await compare(String(credentials.password), String(user.password_hash));
				if (!valid) return null;

				return {
					id: String(user.id),
					email: String(user.email),
					name: String(user.name ?? ''),
					role: String(user.role)
				};
			}
		})
	],

	pages: {
		signIn: '/login'
	},

	callbacks: {
		async signIn({ account, user }) {
			// When signing in with Google, create the user record in Turso if it doesn't exist
			if (account?.provider === 'google') {
				const db = getDb();
				if (!db) return false;

				const existing = await db.execute({
					sql: 'SELECT id FROM users WHERE email = ?',
					args: [user.email]
				});

				if (existing.rows.length === 0) {
					await db.execute({
						sql: `INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'student')`,
						args: [crypto.randomUUID(), user.email, user.name ?? '']
					});
				}
			}
			return true;
		},

		async jwt({ token, user, account }) {
			// On initial sign-in, enrich the token with role + internal user id
			if (account?.provider === 'google') {
				const db = getDb();
				if (db) {
					const result = await db.execute({
						sql: 'SELECT id, role FROM users WHERE email = ?',
						args: [token.email]
					});
					if (result.rows[0]) {
						token.role = result.rows[0].role;
						token.userId = result.rows[0].id;
					}
				}
			} else if (user) {
				// Credentials sign-in — user object comes from authorize()
				token.role = user.role ?? 'student';
				token.userId = user.id;
			}
			// Fallback: if userId is still missing (DB was down at sign-in, old token predating
			// userId enrichment, etc.), re-fetch it now so it persists in the token going forward.
			if (!token.userId && token.email) {
				const db = getDb();
				if (db) {
					try {
						const result = await db.execute({
							sql: 'SELECT id, role FROM users WHERE email = ?',
							args: [token.email]
						});
						if (result.rows[0]) {
							token.userId = String(result.rows[0].id);
							if (!token.role) token.role = String(result.rows[0].role);
						}
					} catch { /* non-fatal */ }
				}
			}
			return token;
		},

		async session({ session, token }) {
			session.user.role = token.role;
			session.user.id = token.userId;
			// Fallback for existing sessions where token.userId was never set.
			// Runs on every locals.auth() call until the JWT is refreshed with the fix above.
			if (!session.user.id && token.email) {
				const db = getDb();
				if (db) {
					try {
						const result = await db.execute({
							sql: 'SELECT id, role FROM users WHERE email = ?',
							args: [token.email]
						});
						if (result.rows[0]) {
							session.user.id = String(result.rows[0].id);
							if (!session.user.role) session.user.role = String(result.rows[0].role);
						}
					} catch { /* non-fatal */ }
				}
			}
			return session;
		}
	}
});
