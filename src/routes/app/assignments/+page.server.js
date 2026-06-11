import { redirect } from '@sveltejs/kit';

// /app/assignments was the original assignments URL → redirected to
// /app/atlas → now redirects to /app/orbit (the page was renamed).
// Kept as a 301 so old bookmarks + chat-link shares continue to work.
export function load() {
	redirect(301, '/app/orbit');
}
