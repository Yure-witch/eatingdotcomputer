import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';

// Client-side error sink. The dev/* subtree is admin-writable only, so the
// browser can't push to it directly — hooks.client.js posts here instead and
// this writes with the same shape hooks.server.js uses, plus side:'client'.
//
// Deliberately unauthenticated: the failures worth catching (a chunk that 404s
// after a deploy) happen before or independently of any session. Everything is
// hard-capped so a hostile caller can only ever write small, bounded rows.
const CAP = 400;

export async function POST({ request }) {
	const body = await request.json().catch(() => null);
	if (!body?.message) return json({ ok: false }, { status: 400 });

	try {
		getAdminDb().ref('dev/errors').push({
			at: Date.now(),
			side: 'client',
			status: null,
			method: 'CLIENT',
			path: String(body.path ?? '').slice(0, 200),
			message: String(body.message).slice(0, CAP),
			code: body.code ? String(body.code).slice(0, 80) : null,
			frame: body.frame ? String(body.frame).slice(0, CAP) : null,
			build: body.build ? String(body.build).slice(0, 40) : null,
			ua: (request.headers.get('user-agent') ?? '').slice(0, 200)
		}).catch(() => {});
	} catch { /* the recorder must never become a second failure */ }

	return json({ ok: true });
}
