import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Dev-only harness (see +page.svelte). 404 anywhere else so it can never be
// reachable in production.
export function load() {
	if (!dev) error(404, 'Not found');
	return {};
}
