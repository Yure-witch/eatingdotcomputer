// A members-only archive file (see $lib/server/archive-members.js). Checks
// class access, then sends the browser to a short-lived signed R2 URL so the
// bytes never pass through the function.
//
// An HTML file (a guest's interactive talk) isn't navigated to directly: it
// opens full-screen in a sandboxed iframe on this URL. The signed URL is
// already another site, and the sandbox (no allow-same-origin) also gives the
// page an opaque origin, so a guest's script can never reach the app, the
// same rule as custom profile pages.
import { error } from '@sveltejs/kit';
import { requireClassAccess } from '$lib/server/access.js';
import { memberFile, memberFileUrl } from '$lib/server/archive-members.js';

const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function GET({ locals, params }) {
	await requireClassAccess(await locals.auth());
	const url = await memberFileUrl(params.name);
	if (!url) error(404, 'Not found');
	const headers = { 'cache-control': 'private, no-store' };

	if (!params.name.endsWith('.html')) {
		return new Response(null, { status: 302, headers: { ...headers, location: url } });
	}

	const title = memberFile(params.name)?.title ?? params.name;
	const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)} · eating.computer</title>
<style>html,body{margin:0;height:100%;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style>
</head>
<body>
<iframe src="${esc(url)}" title="${esc(title)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" allow="fullscreen"></iframe>
</body>
</html>`;
	return new Response(page, {
		headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer' }
	});
}
