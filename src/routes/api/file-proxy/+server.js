import { error } from '@sveltejs/kit';

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session?.user) error(401, 'Not authenticated');

	const fileUrl = url.searchParams.get('url');
	if (!fileUrl) error(400, 'Missing url');

	try {
		const res = await fetch(fileUrl, { signal: AbortSignal.timeout(10000) });
		if (!res.ok) error(res.status, 'File not found');
		// Pass bytes through untouched — decoding to text here corrupted
		// binary files (docx/zip/images), which broke the in-app Word
		// reader and binary downloads. Text callers still .text() fine.
		const buf = await res.arrayBuffer();
		return new Response(buf, {
			headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream' }
		});
	} catch (e) {
		if (e?.status) throw e;
		error(502, 'Failed to fetch file');
	}
}
