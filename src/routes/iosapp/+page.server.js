import { recordVisit } from '$lib/server/visits.js';

// Counted server-side rather than with a client beacon: these pages are public
// and often opened from a texted link, so an ad blocker or a no-JS visit would
// silently not count. Not awaited — see recordVisit.
export function load({ url }) {
	recordVisit(url.pathname);
	return {};
}
