import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	const targetUrl = url.searchParams.get('url');
	if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) error(400, 'Invalid URL');

	const db = getDb();

	// Return cached result if available
	if (db) {
		const cached = await db.execute({
			sql: 'SELECT title FROM link_previews WHERE url = ?',
			args: [targetUrl]
		});
		if (cached.rows.length) return json({ title: cached.rows[0].title ?? null });
	}

	// Fetch the page
	let title = null;
	try {
		const res = await fetch(targetUrl, {
			signal: AbortSignal.timeout(6000),
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; eating.computer/1.0; +https://eating.computer)' }
		});
		if (res.ok) {
			const ct = res.headers.get('content-type') ?? '';
			if (ct.includes('text/html')) {
				// Only read enough to find the title — avoid downloading huge pages
				const reader = res.body.getReader();
				let chunk = '';
				let done = false;
				while (!done && chunk.length < 32768) {
					const { value, done: d } = await reader.read();
					done = d;
					if (value) chunk += new TextDecoder().decode(value);
					if (/<\/head>/i.test(chunk)) break;
				}
				reader.cancel().catch(() => {});

				// og:title preferred, then <title>
				const og = chunk.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"'<>]+)["']/i)
					?? chunk.match(/<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:title["']/i);
				const t = chunk.match(/<title[^>]*>([^<]*)<\/title>/i);
				title = (og?.[1] ?? t?.[1] ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || null;
			}
		}
	} catch { /* timeout, DNS failure, etc. — cache null so we don't retry forever */ }

	if (db) {
		await db.execute({
			sql: 'INSERT OR REPLACE INTO link_previews (url, title, fetched_at) VALUES (?, ?, datetime("now"))',
			args: [targetUrl, title]
		}).catch(() => {});
	}

	return json({ title });
}
