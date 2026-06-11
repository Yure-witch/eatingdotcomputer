import { redirect } from '@sveltejs/kit';

// Files used to be its own page → consolidated into /app/atlas → now
// lives under /app/orbit (atlas was renamed). 301 so the redirect is
// cached by browsers and search engines.
export function load() {
	redirect(301, '/app/orbit');
}
