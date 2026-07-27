import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { writeJobRecs } from '$lib/server/recs-rtdb.js';

// Job feed for the Scout worker on kahan. The worker is outside our auth
// world (a headless box), so it authenticates with a shared bearer token.
// kahan can only make OUTBOUND requests — it polls GET for work and POSTs
// results back; the app never connects to it.
function checkToken(request) {
	const token = env.SCOUT_TOKEN;
	if (!token) error(503, 'Scout not configured');
	const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
	if (got !== token) error(401, 'Bad token');
}

// GET — the worker pulls up to 3 queued jobs; claimed jobs flip to
// `running`. Also records a heartbeat and requeues jobs stuck `running`
// for >5 minutes (worker died mid-job).
export async function GET({ request }) {
	checkToken(request);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	await db.execute({
		sql: `INSERT INTO scout_state (k, v) VALUES ('heartbeat', ?)
		      ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
		args: [String(Date.now())]
	});

	await db.execute(
		`UPDATE scout_jobs SET status = 'queued', updated_at = datetime('now')
		 WHERE status = 'running' AND updated_at < datetime('now', '-5 minutes')`
	);

	const rows = (await db.execute(
		`SELECT id, kind, query FROM scout_jobs WHERE status = 'queued' ORDER BY id LIMIT 3`
	)).rows;

	if (rows.length) {
		await db.execute({
			sql: `UPDATE scout_jobs SET status = 'running', updated_at = datetime('now')
			      WHERE id IN (${rows.map(() => '?').join(',')})`,
			args: rows.map((r) => r.id)
		});
	}

	return json({ jobs: rows.map((r) => ({ id: Number(r.id), kind: String(r.kind), query: String(r.query) })) });
}

// POST — the worker reports a finished job: { id, result } or { id, error }.
export async function POST({ request }) {
	checkToken(request);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const body = await request.json().catch(() => ({}));
	const id = Number(body?.id);
	if (!id) error(400, 'Missing job id');

	if (body.error != null) {
		await db.execute({
			sql: `UPDATE scout_jobs SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`,
			args: [String(body.error).slice(0, 500), id]
		});
	} else {
		let result = Array.isArray(body.result) ? body.result : [];
		// Cap stored payload — a result is a handful of links, not a dump.
		result = result.slice(0, 40).map((r) => ({
			kind: String(r?.kind ?? 'link').slice(0, 20),
			title: String(r?.title ?? '').slice(0, 200),
			url: String(r?.url ?? '').slice(0, 500),
			snippet: String(r?.snippet ?? '').slice(0, 300),
			meta: String(r?.meta ?? '').slice(0, 120),
			source: String(r?.source ?? '').slice(0, 40),
			paywalled: r?.paywalled ? 1 : 0,
			image: r?.image ? String(r.image).slice(0, 500) : null
		})).filter((r) => r.url.startsWith('http'));
		// Keep the raw result in Turso (queue history) AND materialize the
		// recommendations straight into RTDB — the single source of truth the
		// app reads. This is "kahan posting recs to RTDB": the worker POSTs
		// here, the app (which holds the Firebase creds) writes them through.
		const job = (await db.execute({ sql: 'SELECT requested_by, query FROM scout_jobs WHERE id = ?', args: [id] })).rows[0];
		await db.execute({
			sql: `UPDATE scout_jobs SET status = 'done', result = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`,
			args: [JSON.stringify(result), id]
		});
		if (job?.requested_by) {
			try { await writeJobRecs(String(job.requested_by), String(job.query ?? ''), result); }
			catch (e) { console.error('writeJobRecs failed', e); }
		}
	}

	return json({ ok: true });
}
