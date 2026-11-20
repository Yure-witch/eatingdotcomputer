// Signed-in Archive: the public archive plus members-only links. Waiting on
// the /app layout means its sign-in and class-approval redirects run first, so
// these links never go out to anyone who isn't an approved member.
import { memberWorkForPage } from '$lib/server/archive-members.js';

export async function load({ parent }) {
	await parent();
	return { memberWork: memberWorkForPage() };
}
