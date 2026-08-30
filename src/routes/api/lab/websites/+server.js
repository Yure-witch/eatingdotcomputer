import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { buildPreview, dropPreviewAssets } from '$lib/server/site-preview.js';

// Lab → Inspiration: the instructor's curated website gallery.
//
// Everyone signed in can read it; only instructors can change it.
//
// Previews are built in BATCHES the client drives, not inline with the add.
// Pasting thirty links would otherwise mean thirty page fetches inside one
// serverless invocation — well past the function timeout, and an all-or-
// nothing failure. Instead the add returns immediately with the rows marked
// `pending`, and the client calls `{ action: 'process' }` until nothing is
// pending, so the gallery fills in visibly and a slow site only holds up
// itself.

const BATCH = 4; // previews built per process call — each is a page fetch plus an image

/**
 * Queue a rendered screenshot for a link that publishes no og:image.
 *
 * The Scout worker on kahan picks these up (it's outbound-only, so it polls)
 * and POSTs the PNG back to ./shot. Until then — or for ever, if the worker is
 * down — the card shows its typographic fallback, which is a fine resting
 * state rather than a hole in the grid.
 */
async function queueShot(db, url) {
	// One in flight per link. Without this every re-process of a stubborn site
	// would piles up another job for the same page.
	const existing = (await db.execute({
		sql: `SELECT id FROM scout_jobs WHERE kind = 'shot' AND query = ? AND status IN ('queued','running') LIMIT 1`,
		args: [url]
	})).rows[0];
	if (existing) return;
	await db.execute({
		sql: `INSERT INTO scout_jobs (kind, query, status) VALUES ('shot', ?, 'queued')`,
		args: [url]
	});
}

const publicBase = () =>
	(env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

const assetUrl = (key) => (key && publicBase() ? `${publicBase()}/${key}` : null);

function row(r) {
	return {
		id: Number(r.id),
		url: String(r.url),
		title: r.title ? String(r.title) : null,
		description: r.description ? String(r.description) : null,
		siteName: r.site_name ? String(r.site_name) : null,
		image: assetUrl(r.image_key),
		icon: assetUrl(r.icon_key),
		accent: r.accent ? String(r.accent) : null,
		note: r.note ? String(r.note) : null,
		status: String(r.status),
		error: r.error ? String(r.error) : null,
		addedBy: r.added_by ? String(r.added_by) : null,
		createdAt: r.created_at ? String(r.created_at) : null
	};
}

async function requireInstructor(locals) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	if (session.user.role !== 'instructor') error(403, 'Instructors only');
	return session;
}

/** Pull every http(s) URL out of pasted text — a list, prose, or Markdown. */
function parseUrls(text) {
	const found = String(text ?? '').match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
	const seen = new Set();
	const out = [];
	for (let raw of found) {
		raw = raw.replace(/[.,;:]+$/, ''); // trailing sentence punctuation
		try {
			const u = new URL(raw);
			if (!/^https?:$/.test(u.protocol)) continue;
			u.hash = '';
			const norm = u.toString();
			if (seen.has(norm)) continue;
			seen.add(norm);
			out.push(norm);
		} catch { /* not a usable URL */ }
	}
	return out;
}

export async function GET({ locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');
	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const res = await db.execute(
		`SELECT * FROM lab_websites ORDER BY position ASC, id ASC`
	);
	const sites = res.rows.map(row);
	return json({
		sites,
		pending: sites.filter((s) => s.status === 'pending').length,
		canEdit: session.user.role === 'instructor'
	});
}

export async function POST({ request, locals }) {
	const session = await requireInstructor(locals);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');
	const body = await request.json().catch(() => ({}));

	// ── Build previews for the next few pending rows ──────────────────────
	if (body?.action === 'process') {
		const pending = (await db.execute({
			sql: `SELECT id, url FROM lab_websites WHERE status = 'pending' ORDER BY position ASC, id ASC LIMIT ?`,
			args: [BATCH]
		})).rows;

		// Concurrently — these are almost entirely network waits, and one slow
		// site shouldn't set the pace for the other three.
		await Promise.all(
			pending.map(async (p) => {
				const url = String(p.url);
				let out;
				try {
					out = await buildPreview(url);
				} catch (e) {
					out = { status: 'failed', error: String(e?.message ?? e).slice(0, 200) };
				}
				await db.execute({
					sql: `UPDATE lab_websites
					      SET title = ?, description = ?, site_name = ?, image_key = ?, icon_key = ?,
					          accent = ?, status = ?, error = ?, fetched_at = datetime('now')
					      WHERE id = ?`,
					args: [
						out.title ?? null, out.description ?? null, out.siteName ?? null,
						out.imageKey ?? null, out.iconKey ?? null, out.accent ?? null,
						out.status, out.error ?? null, Number(p.id)
					]
				}).catch(() => {});

				// Read but pictureless: hand it to the renderer. A page we
				// couldn't read at all gets nothing — a 403 or a dead host
				// won't screenshot any better than it unfurled.
				if (out.status === 'ready' && !out.imageKey) await queueShot(db, url).catch(() => {});
			})
		);

		const left = Number(
			(await db.execute(`SELECT COUNT(*) AS n FROM lab_websites WHERE status = 'pending'`)).rows[0].n
		);
		return json({ processed: pending.length, remaining: left });
	}

	// ── Add links ─────────────────────────────────────────────────────────
	const urls = parseUrls(body?.urls ?? body?.url);
	if (!urls.length) error(400, 'No links found in that');
	if (urls.length > 100) error(400, 'That is more than 100 links — add them in a couple of goes');

	// Paste order is the gallery's order, so new links continue the sequence
	// rather than interleaving with what's already there.
	const start = Number(
		(await db.execute(`SELECT COALESCE(MAX(position), 0) AS p FROM lab_websites`)).rows[0].p
	);

	let added = 0;
	let skipped = 0;
	for (const [i, url] of urls.entries()) {
		const res = await db.execute({
			sql: `INSERT OR IGNORE INTO lab_websites (url, position, status, added_by)
			      VALUES (?, ?, 'pending', ?)`,
			args: [url, start + i + 1, session.user.name || session.user.id]
		});
		if (res.rowsAffected) added++;
		else skipped++; // already in the list
	}

	return json({ added, skipped, total: urls.length });
}

export async function PATCH({ request, locals }) {
	await requireInstructor(locals);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');
	const body = await request.json().catch(() => ({}));
	const id = Number(body?.id);
	if (!id) error(400, 'Missing id');

	// Re-fetch: drop the cached objects and put it back in the pending queue,
	// so the normal process loop rebuilds it.
	if (body?.refetch) {
		const cur = (await db.execute({
			sql: 'SELECT image_key, icon_key FROM lab_websites WHERE id = ?',
			args: [id]
		})).rows[0];
		if (!cur) error(404, 'Not in the list');
		await dropPreviewAssets(cur);
		await db.execute({
			sql: `UPDATE lab_websites SET status = 'pending', error = NULL, image_key = NULL, icon_key = NULL WHERE id = ?`,
			args: [id]
		});
		return json({ ok: true, status: 'pending' });
	}

	if (typeof body?.note === 'string') {
		await db.execute({
			sql: 'UPDATE lab_websites SET note = ? WHERE id = ?',
			args: [body.note.trim().slice(0, 500) || null, id]
		});
		return json({ ok: true });
	}

	error(400, 'Nothing to change');
}

export async function DELETE({ url, locals }) {
	await requireInstructor(locals);
	const db = getDb();
	if (!db) error(503, 'Database unavailable');
	const id = Number(url.searchParams.get('id'));
	if (!id) error(400, 'Missing id');

	const cur = (await db.execute({
		sql: 'SELECT image_key, icon_key FROM lab_websites WHERE id = ?',
		args: [id]
	})).rows[0];
	if (cur) await dropPreviewAssets(cur);
	await db.execute({ sql: 'DELETE FROM lab_websites WHERE id = ?', args: [id] });
	return json({ ok: true });
}
