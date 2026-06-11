import { redirect } from '@sveltejs/kit';

// /app/atlas was the previous URL for the Roadmap + Files page. It
// was renamed to /app/orbit (matching the sidebar label) — this 301
// keeps existing bookmarks + deep links from chat working.
export function load() {
	redirect(301, '/app/orbit');
}
