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
			sql: 'SELECT title, description, image, site_name FROM link_previews WHERE url = ?',
			args: [targetUrl]
		});
		if (cached.rows.length) {
			const r = cached.rows[0];
			return json({
				title: r.title ?? null,
				description: r.description ?? null,
				image: r.image ?? null,
				siteName: r.site_name ?? null
			});
		}
	}

	// Fetch the page
	let title = null;
	let description = null;
	let image = null;
	let siteName = null;
	try {
		const res = await fetch(targetUrl, {
			signal: AbortSignal.timeout(6000),
			redirect: 'follow',
			// Many sites serve Open Graph tags only to known link-preview
			// crawlers, so impersonate the conventional unfurl UA. (Login-
			// walled sites like Instagram/LinkedIn still return nothing.)
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)',
				'Accept': 'text/html,application/xhtml+xml'
			}
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

				// og:<name>, written either attribute order — plenty of sites emit
				// content before property.
				const meta = (name) =>
					chunk.match(new RegExp(`<meta[^>]+property=["']og:${name}["'][^>]+content=["']([^"'<>]+)["']`, 'i'))?.[1]
					?? chunk.match(new RegExp(`<meta[^>]+content=["']([^"'<>]+)["'][^>]+property=["']og:${name}["']`, 'i'))?.[1]
					?? null;
				const unescape = (v) => (v ?? '')
					.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
					.replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || null;

				const t = chunk.match(/<title[^>]*>([^<]*)<\/title>/i);
				title = unescape(meta('title') ?? t?.[1]);
				description = unescape(meta('description'));
				siteName = unescape(meta('site_name'));
				const img = unescape(meta('image'));
				// Resolve a relative og:image against the page it came from, and
				// keep only http(s) — a data: or javascript: value has no business
				// reaching an <img> in someone's chat.
				if (img) {
					try {
						const abs = new URL(img, res.url || targetUrl);
						if (abs.protocol === 'http:' || abs.protocol === 'https:') image = abs.toString();
					} catch { /* unusable */ }
				}
			}
		}
	} catch { /* timeout, DNS failure, etc. — cache null so we don't retry forever */ }

	if (db) {
		await db.execute({
			sql: `INSERT OR REPLACE INTO link_previews (url, title, description, image, site_name, fetched_at)
			      VALUES (?, ?, ?, ?, ?, datetime("now"))`,
			args: [targetUrl, title, description, image, siteName]
		}).catch(() => {});
	}

	return json({ title, description, image, siteName });
}
