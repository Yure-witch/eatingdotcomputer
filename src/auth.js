import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import Credentials from '@auth/sveltekit/providers/credentials';
import { compare } from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDb } from '$lib/server/turso';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

// Apple publishes the public keys its identity tokens are signed with; the set
// is cached and refreshed by jose, so this is created once per server instance.
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export const { handle, signIn, signOut } = SvelteKitAuth({
	trustHost: true,
	providers: [
		Google,
		// Native iOS Google sign-in. Google refuses OAuth inside an embedded
		// WKWebView (disallowed_useragent), so the Capacitor shell can't use the
		// `google` provider above — it signs in with the native Google SDK and
		// hands us the resulting ID token here. We verify that token against our
		// own client IDs and mint the normal Auth.js session, so the webview ends
		// up with exactly the same cookie a web sign-in would produce.
		// Native iOS "Sign in with Apple". Required by App Store Guideline 4.8
		// wherever we offer Google sign-in. Same shape as google-native above: the
		// native SDK returns an Apple identity token, we verify it against Apple's
		// published keys and mint the ordinary Auth.js session.
		Credentials({
			id: 'apple-native',
			name: 'Apple (native)',
			credentials: {
				idToken: { label: 'Apple identity token', type: 'text' },
				name: { label: 'Full name', type: 'text' }
			},
			async authorize(credentials) {
				const idToken = credentials?.idToken ? String(credentials.idToken) : '';
				if (!idToken) return null;

				let payload;
				try {
					({ payload } = await jwtVerify(idToken, APPLE_JWKS, {
						issuer: 'https://appleid.apple.com',
						audience: 'computer.eating.app'
					}));
				} catch {
					return null;
				}
				if (!payload?.email) return null;
				// Apple only sends email_verified as a string on some flows.
				if (payload.email_verified === false || payload.email_verified === 'false') return null;

				const db = getDb();
				if (!db) return null;

				const email = String(payload.email);
				let result = await db.execute({
					sql: 'SELECT id, email, name, role FROM users WHERE email = ?',
					args: [email]
				});

				if (result.rows.length === 0) {
					// Apple sends the display name ONCE, on the very first
					// authorisation, and never again — so take it from the client
					// when present or we lose it permanently.
					// hide_tg_emoji = 1 by default for Apple sign-ups: the
					// Telegram emote packs and Emoji Kitchen are third-party
					// content, and an account created through Apple's flow
					// starts without them. An instructor can turn them back on
					// per user from Manage → Members.
					await db.execute({
						sql: `INSERT INTO users (id, email, name, role, hide_tg_emoji, gemma_digest, gemma_scan_dms) VALUES (?, ?, ?, 'student', 1, 1, 1)`,
						args: [crypto.randomUUID(), email, credentials?.name ? String(credentials.name) : '']
					});
					result = await db.execute({
						sql: 'SELECT id, email, name, role FROM users WHERE email = ?',
						args: [email]
					});
				}

				const user = result.rows[0];
				if (!user) return null;

				// Land an Apple sign-in that belongs to NO class in the App Store
				// review class. App Review often exercises "Sign in with Apple"
				// itself rather than the demo credentials, and a brand-new account
				// otherwise stops at the enrollment gate — which reads as broken,
				// unfinished software (Guideline 2.1). idc-review is self-contained
				// demo content, so there is nothing real to leak into.
				//
				// Only when they have NO membership at all: this must never touch
				// a real student's enrollment, nor re-add one an instructor denied,
				// and it also repairs an account that signed in before this existed.
				try {
					const existingMembership = await db.execute({
						sql: 'SELECT 1 FROM class_memberships WHERE user_id = ? LIMIT 1',
						args: [String(user.id)]
					});
					if (existingMembership.rows.length === 0) {
						const reviewClass = await db.execute({
							sql: "SELECT id FROM classes WHERE id = 'idc-review'"
						});
						if (reviewClass.rows[0]) {
							await db.execute({
								sql: `INSERT OR IGNORE INTO class_memberships (id, class_id, user_id, status, reviewed_at)
								      VALUES (?, 'idc-review', ?, 'approved', datetime('now'))`,
								args: [crypto.randomUUID(), String(user.id)]
							});
						}
					}
				} catch { /* never block a valid sign-in on the demo enrollment */ }

				return {
					id: String(user.id),
					email: String(user.email),
					name: String(user.name ?? ''),
					role: String(user.role)
				};
			}
		}),
		Credentials({
			id: 'google-native',
			name: 'Google (native)',
			credentials: { idToken: { label: 'Google ID token', type: 'text' } },
			async authorize(credentials) {
				const idToken = credentials?.idToken ? String(credentials.idToken) : '';
				if (!idToken) return null;

				// Accept tokens minted for either OAuth client — the iOS app uses
				// its own client ID, but a token issued to the web client is valid
				// too (e.g. if the plugin is configured with the server client).
				const audience = [publicEnv.PUBLIC_GOOGLE_IOS_CLIENT_ID, env.AUTH_GOOGLE_ID].filter(Boolean);
				if (!audience.length) return null;

				let payload;
				try {
					const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience });
					payload = ticket.getPayload();
				} catch {
					return null; // forged, expired, or wrong-audience token
				}
				// email_verified guards against an account whose address was never
				// confirmed being used to claim an existing user record.
				if (!payload?.email || payload.email_verified === false) return null;

				const db = getDb();
				if (!db) return null;

				const email = String(payload.email);
				let result = await db.execute({
					sql: 'SELECT id, email, name, role FROM users WHERE email = ?',
					args: [email]
				});

				// Same create-on-first-sign-in behaviour as the web Google flow
				// (see the signIn callback below).
				if (result.rows.length === 0) {
					await db.execute({
						sql: `INSERT INTO users (id, email, name, role, gemma_digest, gemma_scan_dms) VALUES (?, ?, ?, 'student', 1, 1)`,
						args: [crypto.randomUUID(), email, payload.name ?? '']
					});
					result = await db.execute({
						sql: 'SELECT id, email, name, role FROM users WHERE email = ?',
						args: [email]
					});
				}

				const user = result.rows[0];
				if (!user) return null;

				return {
					id: String(user.id),
					email: String(user.email),
					name: String(user.name ?? ''),
					role: String(user.role)
				};
			}
		}),
		Credentials({
			credentials: {
				email: { label: 'Email or username', type: 'text' },
				password: { label: 'Password', type: 'password' }
			},
			async authorize(credentials) {
				if (!credentials?.email || !credentials?.password) return null;

				const db = getDb();
				if (!db) return null;

				// The field is named `email` for historical reasons but accepts
				// either an email address or a username.
				const identifier = String(credentials.email);
				const result = await db.execute({
					sql: 'SELECT id, email, name, password_hash, role FROM users WHERE email = ? OR username = ?',
					args: [identifier, identifier]
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
						sql: `INSERT INTO users (id, email, name, role, gemma_digest, gemma_scan_dms) VALUES (?, ?, ?, 'student', 1, 1)`,
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
			// Fallback: if userId or role is missing (DB was down at sign-in, old token, etc.),
			// re-fetch now so it persists in the token going forward.
			if ((!token.userId || !token.role) && token.email) {
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
			// Fallback for sessions where userId or role was never set (DB down at sign-in,
			// old token predating role enrichment, etc.). Without role, an instructor is
			// treated as a student and gets bounced to the profile onboarding page.
			if ((!session.user.id || !session.user.role) && token.email) {
				const db = getDb();
				if (db) {
					try {
						const result = await db.execute({
							sql: 'SELECT id, role FROM users WHERE email = ?',
							args: [token.email]
						});
						if (result.rows[0]) {
							session.user.id = String(result.rows[0].id);
							session.user.role = String(result.rows[0].role);
						}
					} catch { /* non-fatal */ }
				}
			}
			return session;
		}
	}
});
