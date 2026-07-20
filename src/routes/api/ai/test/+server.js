import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

// Server-side connection test with the caller's OWN stored credentials —
// proxied so the key never travels to the browser and CORS never applies.
export async function POST({ locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');
	const res = await getDb().execute({
		sql: 'SELECT base_url, api_key FROM user_ai_keys WHERE user_id = ?',
		args: [session.user.id]
	});
	const row = res.rows[0];
	if (!row) error(400, 'No API key saved');

	try {
		const ctrl = new AbortController();
		const to = setTimeout(() => ctrl.abort(), 10000);
		const r = await fetch(`${row.base_url}/models`, {
			headers: { Authorization: `Bearer ${row.api_key}` },
			signal: ctrl.signal
		});
		clearTimeout(to);
		if (!r.ok) {
			return json({ ok: false, status: r.status, message: r.status === 401 ? 'Key rejected (401)' : `Endpoint returned ${r.status}` });
		}
		const data = await r.json();
		const models = (data.data ?? []).map((m) => ({ id: m.id, name: m.name ?? m.id }));
		return json({ ok: true, models });
	} catch (e) {
		return json({ ok: false, message: e.name === 'AbortError' ? 'Timed out reaching the endpoint' : 'Could not reach the endpoint' });
	}
}
