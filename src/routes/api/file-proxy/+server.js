import { error } from '@sveltejs/kit';

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const fileUrl = url.searchParams.get('url');
	if (!fileUrl) error(400, 'Missing url');

	try {
		const res = await fetch(fileUrl, { signal: AbortSignal.timeout(10000) });
		if (!res.ok) error(res.status, 'File not found');
		const text = await res.text();
		return new Response(text, {
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	} catch (e) {
		if (e?.status) throw e;
		error(502, 'Failed to fetch file');
	}
}
