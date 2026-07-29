import { json, error } from '@sveltejs/kit';
import { createFirebaseToken } from '$lib/server/firebase-admin.js';

// A fresh Firebase custom token for the signed-in user. The one baked into
// the page load expires after ~1h, so a tab resumed from sleep needs a new
// one to re-authenticate — the chat reconnect logic fetches this.
export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const token = await createFirebaseToken(session.user.id).catch(() => null);
	if (!token) error(503, 'Could not mint token');
	return json({ token });
}
