import { getDb } from '$lib/server/turso';
import { json } from '@sveltejs/kit';

// Temporary, unauthenticated on purpose: the failure we're chasing happens on
// the login screen, before any session exists. Payload is hard-capped and the
// endpoint only ever writes to debug_events. Remove once native sign-in works.
const MAX = 4000;

export async function POST({ request }) {
	const body = await request.json().catch(() => null);
	if (!body?.payload) return json({ ok: false }, { status: 400 });

	const db = getDb();
	if (!db) return json({ ok: false }, { status: 503 });

	await db.execute({
		sql: 'INSERT INTO debug_events (id, kind, payload, user_agent) VALUES (?, ?, ?, ?)',
		args: [
			crypto.randomUUID(),
			String(body.kind ?? 'unknown').slice(0, 64),
			String(body.payload).slice(0, MAX),
			(request.headers.get('user-agent') ?? '').slice(0, 300)
		]
	});
	return json({ ok: true });
}
