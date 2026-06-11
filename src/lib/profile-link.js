/**
 * Resolve a profile URL with one rule: if the target user IS the
 * current user, route to the edit page (`/app/profile/edit`) instead
 * of the read-only view (`/app/profile/<id>`). Anywhere in the app
 * that links to a profile should go through this helper so the
 * "click my own name → edit" UX is consistent.
 *
 * Pass `null`/missing `currentUserId` if you don't know it yet —
 * the helper falls back to the view route in that case.
 */
export function profileLink(targetUserId, currentUserId) {
	if (!targetUserId) return '/app';
	if (currentUserId && String(targetUserId) === String(currentUserId)) {
		return '/app/profile/edit';
	}
	return `/app/profile/${targetUserId}`;
}
