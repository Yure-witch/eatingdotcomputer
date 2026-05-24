import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const key = env.GIPHY_API_KEY;
	if (!key) error(503, 'Giphy API key not configured');

	const action = url.searchParams.get('action') ?? 'trending';
	const q = url.searchParams.get('q') ?? '';
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20') || 20, 50);
	const offset = parseInt(url.searchParams.get('offset') ?? '0') || 0;

	let endpoint;
	const params = new URLSearchParams({
		api_key: key,
		limit: String(limit),
		offset: String(offset),
		rating: 'g',
	});

	if (action === 'search' && q) {
		endpoint = `${GIPHY_BASE}/search`;
		params.set('q', q);
	} else {
		endpoint = `${GIPHY_BASE}/trending`;
	}

	try {
		const res = await fetch(`${endpoint}?${params}`, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) error(res.status, 'Giphy API error');
		const data = await res.json();

		const results = (data.data ?? []).map(r => ({
			id: r.id,
			title: r.title ?? '',
			preview: r.images?.fixed_width_small?.url ?? r.images?.preview_gif?.url ?? '',
			gif: r.images?.original?.url ?? '',
		}));

		const total = data.pagination?.total_count ?? 0;
		const hasMore = offset + limit < total;

		return json({ results, offset: offset + limit, hasMore });
	} catch (e) {
		if (e?.status) throw e;
		error(502, 'Failed to reach Giphy');
	}
}
