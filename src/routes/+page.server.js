import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
	// Already signed in → skip the marketing landing and go straight to the app.
	// This is what lets the native app (which opens at "/") land directly in /app
	// instead of the login screen, so you don't have to tap "Log in" every launch.
	const session = await locals.auth();
	if (session) redirect(302, '/app');
}
