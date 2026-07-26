import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { sanitizeStyle } from '$lib/profile-style.js';

// 100KB is plenty for a hand-written page and keeps the users row sane.
const MAX_HTML = 100_000;

// Save the caller's own profile customization. Two independent payloads:
//   { style: {...} }  — preset picks, validated against the whitelists in
//                       $lib/profile-style.js so nothing user-controlled
//                       lands in the app's own CSS.
//   { html: string | null } — the custom profile page document. Stored
//                       verbatim (that's the point — their CSS/JS, their
//                       rules) because it only ever renders inside a
//                       sandboxed iframe with an opaque origin: no
//                       cookies, no session, no reach into the app.
//                       null / '' clears it.
export async function POST({ locals, request }) {
	const session = await locals.auth();
	if (!session) error(401, 'Not signed in');

	const db = getDb();
	if (!db) error(503, 'Database unavailable');

	const body = await request.json().catch(() => ({}));

	const sets = [];
	const args = [];
	let style = null;

	if ('style' in body) {
		style = sanitizeStyle(body.style);
		sets.push('profile_style = ?');
		args.push(JSON.stringify(style));
	}

	if ('html' in body) {
		let html = typeof body.html === 'string' ? body.html : null;
		if (html != null) {
			if (html.length > MAX_HTML) error(413, `Custom page is too big (max ${MAX_HTML / 1000}KB)`);
			html = html.trim() || null;
		}
		sets.push('profile_html = ?');
		args.push(html);
	}

	if (!sets.length) error(400, 'Nothing to save');

	args.push(session.user.id);
	await db.execute({
		sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
		args
	});

	return json({ ok: true, ...(style ? { style } : {}) });
}
