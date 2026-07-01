import { redirect } from '@sveltejs/kit';

// The Playground tab was renamed to Lab (/app/lab). Redirect any old links,
// bookmarks, or a native WebView still parked on the old route.
export function load() {
	redirect(308, '/app/lab');
}
